import * as admin from 'firebase-admin';
import { EmergencyRequest, ScoredDoctor, User } from '../types';
import { scoreDoctors, topN } from './scoringEngine';
import {
  fetchAvailableDoctors,
  createPendingResponses,
  updateRequestStatus,
} from '../utils/firestoreUtils';
import {
  sendBulkEmergencyAlerts,
  sendPatientNotification,
} from '../notifications/fcmService';

const db = () => admin.firestore();

// ─────────────────────────────────────────
// CORE MATCHING PIPELINE
// ─────────────────────────────────────────

/**
 * Run the full matching pipeline for an emergency request.
 *
 * 1. Fetch eligible doctors (online / not busy / active).
 * 2. Score & rank them.
 * 3. Pick top N.
 * 4. Create pending doctorResponse docs.
 * 5. Send FCM alerts.
 * 6. Update request with notifiedDoctors list.
 *
 * @returns The scored doctors that were notified, or empty if none found.
 */
export async function runMatchingPipeline(
  request: EmergencyRequest,
  patient: User,
  relaxed = false
): Promise<ScoredDoctor[]> {
  const alreadyNotified = request.notifiedDoctors ?? [];

  // Step 1 — Fetch eligible doctors (excluding already notified)
  const doctors = await fetchAvailableDoctors(alreadyNotified);

  if (doctors.length === 0) {
    console.log(`[Matcher] No eligible doctors for request ${request.requestId}`);
    return [];
  }

  // Step 2 — Score & rank
  const scored = scoreDoctors(doctors, request, relaxed);

  // Step 3 — Pick top N
  const n = topN(request.severity);
  const top = scored.slice(0, n);

  console.log(
    `[Matcher] Top ${top.length} doctors for ${request.requestId}:`,
    top.map((d) => ({
      uid: d.doctor.uid,
      name: d.doctor.name,
      score: d.score.toFixed(3),
    }))
  );

  const topDoctorIds = top.map((d) => d.doctor.uid);
  const allNotified = [...alreadyNotified, ...topDoctorIds];

  // Step 4 — Create pending response docs (Firestore batch)
  await createPendingResponses(request.requestId, topDoctorIds);

  // Step 5 — Update request with notifiedDoctors
  await updateRequestStatus(request.requestId, {
    notifiedDoctors: allNotified as unknown as string[],
  });

  // Step 6 — Send FCM alerts (non-blocking failures)
  await sendBulkEmergencyAlerts(
    top.map((d) => ({ uid: d.doctor.uid, fcmToken: d.doctor.fcmToken })),
    {
      patientName: patient.name,
      issueType: request.issueType,
      severity: request.severity,
      requestId: request.requestId,
    }
  );

  return top;
}

// ─────────────────────────────────────────
// TIMEOUT + RETRY LOGIC
// ─────────────────────────────────────────

const TIMEOUT_MS = 8_000;
const MAX_RETRIES = 3;

/**
 * Wait TIMEOUT_MS then check if the request is still unassigned.
 * If so, expand the search with relaxed criteria.
 */
export async function waitAndRetryIfNeeded(
  requestId: string,
  patient: User
): Promise<void> {
  await sleep(TIMEOUT_MS);

  // Re-read the current state from Firestore
  const doc = await db().collection('emergencyRequests').doc(requestId).get();
  if (!doc.exists) return;

  const request = { requestId: doc.id, ...doc.data() } as EmergencyRequest;

  if (request.status !== 'searching') {
    // Already assigned or cancelled — nothing to do
    return;
  }

  const retryCount = (request.retryCount ?? 0) + 1;
  console.log(
    `[Matcher] Timeout on ${requestId} — retry #${retryCount} (relaxed=${retryCount > 1})`
  );

  if (retryCount > MAX_RETRIES) {
    await handleNoMatchFound(requestId, patient);
    return;
  }

  await updateRequestStatus(requestId, { retryCount });

  // Relaxed mode from retry #2 onward
  const relaxed = retryCount >= 2;
  const matched = await runMatchingPipeline(request, patient, relaxed);

  if (matched.length === 0) {
    if (patient.fcmToken) {
      await sendPatientNotification(
        patient.fcmToken,
        'Still searching for an available doctor…',
        'RETRYING',
        { requestId }
      );
    }
    // Recurse into next wait cycle
    await waitAndRetryIfNeeded(requestId, patient);
  } else {
    if (patient.fcmToken) {
      await sendPatientNotification(
        patient.fcmToken,
        'Found more doctors — waiting for acceptance…',
        'SEARCHING',
        { requestId }
      );
    }
    await waitAndRetryIfNeeded(requestId, patient);
  }
}

// ─────────────────────────────────────────
// NO MATCH FOUND
// ─────────────────────────────────────────

async function handleNoMatchFound(requestId: string, patient: User): Promise<void> {
  console.log(`[Matcher] No match found after ${MAX_RETRIES} retries for ${requestId}`);

  await updateRequestStatus(requestId, {
    status: 'cancelled',
    cancelReason: 'no_doctors_available',
  } as unknown as Partial<EmergencyRequest>);

  if (patient.fcmToken) {
    await sendPatientNotification(
      patient.fcmToken,
      'No doctors are available right now. Please try again or call emergency services.',
      'NO_DOCTORS_FOUND',
      { requestId }
    );
  }

  // Analytics
  await db()
    .collection('analytics')
    .doc('global')
    .set(
      { missedRequests: admin.firestore.FieldValue.increment(1) },
      { merge: true }
    );
}

// ─────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
