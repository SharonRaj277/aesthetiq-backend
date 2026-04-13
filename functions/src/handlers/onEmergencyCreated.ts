import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { EmergencyRequest, User } from '../types';
import { runMatchingPipeline, waitAndRetryIfNeeded } from '../matching/emergencyMatcher';
import { getUserById } from '../utils/firestoreUtils';
import { sendPatientNotification } from '../notifications/fcmService';

/**
 * onEmergencyCreated
 * ──────────────────
 * Triggered whenever a new document is created in `emergencyRequests`.
 *
 * Flow:
 *  1. Validate & load patient.
 *  2. Run matching pipeline → notify top doctors.
 *  3. Notify patient that search is in progress.
 *  4. Wait 8 s — if still unassigned, retry with relaxed criteria.
 */
export const onEmergencyCreated = functions
  .runWith({
    timeoutSeconds: 120,  // enough for 3 retry cycles (8s × 3 + overhead)
    memory: '256MB',
  })
  .firestore.document('emergencyRequests/{requestId}')
  .onCreate(async (snap, context) => {
    const requestId = context.params.requestId;
    const request: EmergencyRequest = {
      requestId,
      notifiedDoctors: [],
      retryCount: 0,
      ...(snap.data() as Omit<EmergencyRequest, 'requestId'>),
    };

    console.log(
      `[onEmergencyCreated] New request ${requestId} — severity: ${request.severity}`
    );

    // ── 1. Load patient ──────────────────────────────────────────────────────
    const patient = await getUserById(request.patientId);
    if (!patient) {
      console.error(`[onEmergencyCreated] Patient ${request.patientId} not found`);
      return;
    }

    // ── 2. Run initial matching ──────────────────────────────────────────────
    const matched = await runMatchingPipeline(request, patient, false);

    // ── 3. Notify patient ────────────────────────────────────────────────────
    if (patient.fcmToken) {
      if (matched.length === 0) {
        await sendPatientNotification(
          patient.fcmToken,
          'No doctors online right now — searching…',
          'NO_DOCTORS_AVAILABLE',
          { requestId }
        );
      } else {
        await sendPatientNotification(
          patient.fcmToken,
          `Connecting you with the best available doctor…`,
          'SEARCHING',
          { requestId }
        );
      }
    }

    // ── 4. Wait & retry if no acceptance ────────────────────────────────────
    await waitAndRetryIfNeeded(requestId, patient);
  });
