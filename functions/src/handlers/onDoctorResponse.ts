import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { DoctorResponse, EmergencyRequest } from '../types';
import {
  cancelOtherPendingResponses,
  getDoctorById,
  getUserById,
} from '../utils/firestoreUtils';
import { sendPatientNotification } from '../notifications/fcmService';

const db = () => admin.firestore();

/**
 * onDoctorResponse
 * ────────────────
 * Triggered when a `doctorResponses` document is updated
 * (doctor changes their response from "pending" → "accepted" | "declined" | "timeout").
 *
 * On ACCEPTED:
 *   - Transactionally assigns the doctor to the request (prevents races).
 *   - Marks the doctor as busy.
 *   - Cancels other pending responses.
 *   - Notifies the patient.
 *   - Triggers doctor metric update.
 *
 * On DECLINED / TIMEOUT:
 *   - Logs the negative response.
 *   - (The onEmergencyCreated timeout loop handles further retry logic.)
 */
export const onDoctorResponse = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('doctorResponses/{responseId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as DoctorResponse;
    const after = change.after.data() as DoctorResponse;

    // Only act when transitioning out of "pending"
    if (before.response !== 'pending' || after.response === 'pending') return;

    const { requestId, doctorId, response } = after;
    const responseDocRef = change.after.ref;

    console.log(
      `[onDoctorResponse] doctor=${doctorId} response=${response} request=${requestId}`
    );

    if (response === 'accepted') {
      await handleAcceptance(requestId, doctorId, responseDocRef);
    } else {
      // declined | timeout | cancelled — nothing extra to do here;
      // the retry loop in onEmergencyCreated handles escalation.
      console.log(
        `[onDoctorResponse] Doctor ${doctorId} ${response} — no action needed.`
      );
    }
  });

// ─────────────────────────────────────────
// ACCEPTANCE HANDLER
// ─────────────────────────────────────────

async function handleAcceptance(
  requestId: string,
  doctorId: string,
  responseDocRef: admin.firestore.DocumentReference
): Promise<void> {
  const requestRef = db().collection('emergencyRequests').doc(requestId);
  let assigned = false;
  let responseTimeSeconds = 0;

  // ── Transactional assignment (prevents two doctors both "winning") ─────────
  await db().runTransaction(async (tx) => {
    const requestDoc = await tx.get(requestRef);
    if (!requestDoc.exists) return;

    const request = requestDoc.data() as EmergencyRequest;
    if (request.status !== 'searching') {
      // Already assigned by a faster doctor — skip
      console.log(`[onDoctorResponse] Request ${requestId} already ${request.status} — skipping.`);
      return;
    }

    const createdAt = (request.createdAt as admin.firestore.Timestamp).toDate();
    responseTimeSeconds = Math.round((Date.now() - createdAt.getTime()) / 1000);

    tx.update(requestRef, {
      status: 'assigned',
      assignedDoctorId: doctorId,
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    tx.update(db().collection('doctors').doc(doctorId), { isBusy: true });

    tx.update(responseDocRef, { responseTime: responseTimeSeconds });

    assigned = true;
  });

  if (!assigned) return;

  console.log(
    `[onDoctorResponse] Assigned doctor ${doctorId} to ${requestId} in ${responseTimeSeconds}s`
  );

  // ── Cancel all other pending responses ───────────────────────────────────
  await cancelOtherPendingResponses(requestId, doctorId);

  // ── Notify patient ────────────────────────────────────────────────────────
  const [requestDoc, doctor] = await Promise.all([
    requestRef.get(),
    getDoctorById(doctorId),
  ]);

  const request = requestDoc.data() as EmergencyRequest;
  const patient = request?.patientId
    ? await getUserById(request.patientId)
    : null;

  if (patient?.fcmToken) {
    await sendPatientNotification(
      patient.fcmToken,
      `Dr. ${doctor?.name ?? 'Your doctor'} accepted — connecting now!`,
      'DOCTOR_ASSIGNED',
      {
        requestId,
        doctorId,
        doctorName: doctor?.name ?? '',
        doctorSpecialization: doctor?.specialization ?? '',
        responseTime: responseTimeSeconds.toString(),
      }
    );
  }

  // ── Update doctor metrics ─────────────────────────────────────────────────
  await updateDoctorMetrics(doctorId, responseTimeSeconds, true);

  // ── Analytics ─────────────────────────────────────────────────────────────
  await db()
    .collection('analytics')
    .doc('global')
    .set(
      {
        totalSuccessfulMatches: admin.firestore.FieldValue.increment(1),
        avgResponseTimeSum: admin.firestore.FieldValue.increment(responseTimeSeconds),
        avgResponseTimeCount: admin.firestore.FieldValue.increment(1),
      },
      { merge: true }
    );
}

// ─────────────────────────────────────────
// METRIC UPDATE (inline, called from this handler)
// ─────────────────────────────────────────

async function updateDoctorMetrics(
  doctorId: string,
  responseTime: number,
  accepted: boolean
): Promise<void> {
  const doctorRef = db().collection('doctors').doc(doctorId);

  await db().runTransaction(async (tx) => {
    const doc = await tx.get(doctorRef);
    if (!doc.exists) return;

    const data = doc.data()!;
    const totalConsultations = (data.totalConsultations ?? 0) + (accepted ? 1 : 0);
    const prevAvg = data.avgResponseTime ?? 0;
    const prevCount = data.ratingCount ?? 1;

    // Rolling average for response time
    const newAvgResponse =
      totalConsultations > 0
        ? Math.round((prevAvg * (prevCount - 1) + responseTime) / prevCount)
        : responseTime;

    // Acceptance rate: acceptedCount / totalNotifications (stored separately)
    const totalNotifications = (data.totalNotifications ?? 0) + 1;
    const acceptedCount = (data.acceptedCount ?? 0) + (accepted ? 1 : 0);
    const acceptanceRate = acceptedCount / totalNotifications;

    tx.update(doctorRef, {
      totalConsultations,
      avgResponseTime: newAvgResponse,
      totalNotifications,
      acceptedCount,
      acceptanceRate: parseFloat(acceptanceRate.toFixed(2)),
    });
  });
}
