import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { EmergencyRequest } from '../types';
import { runMatchingPipeline } from '../matching/emergencyMatcher';
import { getUserById, getEmergencyRequest, updateRequestStatus } from '../utils/firestoreUtils';
import { sendPatientNotification } from '../notifications/fcmService';

const db = () => admin.firestore();

// ─────────────────────────────────────────
// GUARD: only callable with a valid ID token
// ─────────────────────────────────────────

async function verifyAdmin(context: functions.https.CallableContext): Promise<void> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');

  const adminDoc = await db().collection('admins').doc(context.auth.uid).get();
  if (!adminDoc.exists || adminDoc.data()?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
}

// ─────────────────────────────────────────
// retryEmergencyMatching (callable)
// ─────────────────────────────────────────

/**
 * Manually trigger a retry of the matching engine for a stuck request.
 * Useful from the admin panel without needing to wait for the timeout loop.
 *
 * Call: functions.httpsCallable('retryEmergencyMatching')({ requestId })
 */
export const retryEmergencyMatching = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    await verifyAdmin(context);

    const { requestId } = data as { requestId: string };
    if (!requestId) throw new functions.https.HttpsError('invalid-argument', 'requestId required');

    const request = await getEmergencyRequest(requestId);
    if (!request) throw new functions.https.HttpsError('not-found', 'Request not found');

    if (request.status !== 'searching') {
      return { success: false, message: `Request is already in status: ${request.status}` };
    }

    const patient = await getUserById(request.patientId);
    if (!patient) throw new functions.https.HttpsError('not-found', 'Patient not found');

    const matched = await runMatchingPipeline(request, patient, true);

    return {
      success: true,
      doctorsNotified: matched.length,
      doctors: matched.map((d) => ({
        uid: d.doctor.uid,
        name: d.doctor.name,
        score: parseFloat(d.score.toFixed(3)),
      })),
    };
  });

// ─────────────────────────────────────────
// suspendDoctor (callable)
// ─────────────────────────────────────────

export const suspendDoctor = functions
  .runWith({ timeoutSeconds: 15 })
  .https.onCall(async (data, context) => {
    await verifyAdmin(context);

    const { doctorId, reason } = data as { doctorId: string; reason?: string };
    if (!doctorId) throw new functions.https.HttpsError('invalid-argument', 'doctorId required');

    await db().collection('doctors').doc(doctorId).update({
      status: 'suspended',
      isOnline: false,
      suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
      suspendReason: reason ?? 'Admin action',
    });

    return { success: true, doctorId };
  });

// ─────────────────────────────────────────
// completeConsultation (callable)
// ─────────────────────────────────────────

/**
 * Marks an emergency consultation as complete, frees the doctor,
 * and creates a transaction record.
 */
export const completeConsultation = functions
  .runWith({ timeoutSeconds: 30 })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');
    }

    const { requestId, amount, platformFeePct = 0.15 } = data as {
      requestId: string;
      amount: number;
      platformFeePct?: number;
    };

    if (!requestId || !amount) {
      throw new functions.https.HttpsError('invalid-argument', 'requestId and amount required');
    }

    const request = await getEmergencyRequest(requestId);
    if (!request) throw new functions.https.HttpsError('not-found', 'Request not found');

    if (request.status !== 'assigned') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Request is ${request.status}, not assigned`
      );
    }

    // Only the assigned doctor or admin can complete
    const doctorId = request.assignedDoctorId!;
    const isAssignedDoctor = context.auth.uid === doctorId;
    const isAdminUser = await db()
      .collection('admins')
      .doc(context.auth.uid)
      .get()
      .then((d) => d.exists);

    if (!isAssignedDoctor && !isAdminUser) {
      throw new functions.https.HttpsError('permission-denied', 'Only the assigned doctor can complete');
    }

    const platformFee = parseFloat((amount * platformFeePct).toFixed(2));
    const doctorPayout = parseFloat((amount - platformFee).toFixed(2));

    const batch = db().batch();

    // Mark request complete
    batch.update(db().collection('emergencyRequests').doc(requestId), {
      status: 'completed',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Free the doctor
    batch.update(db().collection('doctors').doc(doctorId), { isBusy: false });

    // Create transaction record
    const txRef = db().collection('transactions').doc();
    batch.set(txRef, {
      id: txRef.id,
      patientId: request.patientId,
      doctorId,
      emergencyRequestId: requestId,
      amount,
      platformFee,
      doctorPayout,
      currency: 'USD',
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Create appointment record
    const apptRef = db().collection('appointments').doc();
    batch.set(apptRef, {
      id: apptRef.id,
      patientId: request.patientId,
      doctorId,
      emergencyRequestId: requestId,
      status: 'completed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    // Notify patient
    const patient = await getUserById(request.patientId);
    if (patient?.fcmToken) {
      await sendPatientNotification(
        patient.fcmToken,
        'Your consultation is complete. Thank you for using AesthetiQ!',
        'CONSULTATION_COMPLETE',
        { requestId, transactionId: txRef.id }
      );
    }

    return {
      success: true,
      transactionId: txRef.id,
      appointmentId: apptRef.id,
    };
  });

// ─────────────────────────────────────────
// reassignDoctorIfDisconnected (callable)
// ─────────────────────────────────────────

/**
 * Called when a doctor's connection drops during an active consultation.
 * Re-opens the request for re-matching immediately.
 */
export const reassignDoctor = functions
  .runWith({ timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    await verifyAdmin(context);

    const { requestId } = data as { requestId: string };
    if (!requestId) throw new functions.https.HttpsError('invalid-argument', 'requestId required');

    const request = await getEmergencyRequest(requestId);
    if (!request || request.status !== 'assigned') {
      throw new functions.https.HttpsError('failed-precondition', 'Request not in assigned state');
    }

    const previousDoctorId = request.assignedDoctorId!;

    // Free the disconnected doctor
    await db().collection('doctors').doc(previousDoctorId).update({ isBusy: false });

    // Re-open request for re-matching (clear assignment)
    await updateRequestStatus(requestId, {
      status: 'searching',
      assignedDoctorId: undefined,
      retryCount: 0,
      notifiedDoctors: [...(request.notifiedDoctors ?? []), previousDoctorId],
    } as unknown as Partial<EmergencyRequest>);

    const patient = await getUserById(request.patientId);
    if (!patient) throw new functions.https.HttpsError('not-found', 'Patient not found');

    if (patient.fcmToken) {
      await sendPatientNotification(
        patient.fcmToken,
        'Your doctor disconnected. Finding a new doctor immediately…',
        'SEARCHING',
        { requestId }
      );
    }

    const matched = await runMatchingPipeline(
      { ...request, status: 'searching', notifiedDoctors: [...(request.notifiedDoctors ?? []), previousDoctorId] },
      patient,
      false
    );

    return { success: true, reassigning: true, doctorsNotified: matched.length };
  });

// ─────────────────────────────────────────
// getAnalytics (callable)
// ─────────────────────────────────────────

export const getAnalytics = functions
  .runWith({ timeoutSeconds: 30 })
  .https.onCall(async (_data, context) => {
    await verifyAdmin(context);

    const globalDoc = await db().collection('analytics').doc('global').get();

    const last7Days = await db()
      .collection('analytics')
      .orderBy('snapshotDate', 'desc')
      .limit(7)
      .get();

    return {
      global: globalDoc.data() ?? {},
      daily: last7Days.docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  });
