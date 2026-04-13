import * as admin from 'firebase-admin';
import { Doctor, EmergencyRequest, User } from '../types';

const db = () => admin.firestore();

// ─────────────────────────────────────────
// DOCTOR HELPERS
// ─────────────────────────────────────────

/**
 * Fetch all online, available, active doctors.
 * Optionally exclude specific doctor UIDs.
 */
export async function fetchAvailableDoctors(
  excludeUids: string[] = []
): Promise<Doctor[]> {
  const snapshot = await db()
    .collection('doctors')
    .where('isOnline', '==', true)
    .where('isBusy', '==', false)
    .where('status', '==', 'active')
    .get();

  return snapshot.docs
    .map((doc) => ({ uid: doc.id, ...doc.data() } as Doctor))
    .filter((d) => !excludeUids.includes(d.uid));
}

export async function getDoctorById(uid: string): Promise<Doctor | null> {
  const doc = await db().collection('doctors').doc(uid).get();
  if (!doc.exists) return null;
  return { uid: doc.id, ...doc.data() } as Doctor;
}

export async function setDoctorBusy(uid: string, isBusy: boolean): Promise<void> {
  await db().collection('doctors').doc(uid).update({ isBusy });
}

// ─────────────────────────────────────────
// PATIENT HELPERS
// ─────────────────────────────────────────

export async function getUserById(uid: string): Promise<User | null> {
  const doc = await db().collection('users').doc(uid).get();
  if (!doc.exists) return null;
  return { uid: doc.id, ...doc.data() } as User;
}

// ─────────────────────────────────────────
// EMERGENCY REQUEST HELPERS
// ─────────────────────────────────────────

export async function getEmergencyRequest(
  requestId: string
): Promise<EmergencyRequest | null> {
  const doc = await db().collection('emergencyRequests').doc(requestId).get();
  if (!doc.exists) return null;
  return { requestId: doc.id, ...doc.data() } as EmergencyRequest;
}

export async function updateRequestStatus(
  requestId: string,
  updates: Partial<EmergencyRequest>
): Promise<void> {
  await db().collection('emergencyRequests').doc(requestId).update(updates);
}

// ─────────────────────────────────────────
// DOCTOR RESPONSE HELPERS
// ─────────────────────────────────────────

/**
 * Create a pending doctor response for a new emergency match attempt.
 */
export async function createPendingResponses(
  requestId: string,
  doctorUids: string[]
): Promise<void> {
  const batch = db().batch();

  for (const doctorId of doctorUids) {
    const ref = db()
      .collection('doctorResponses')
      .doc(`${requestId}_${doctorId}`);
    batch.set(ref, {
      requestId,
      doctorId,
      response: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
}

/**
 * Cancel all still-pending responses for a request except the accepted one.
 */
export async function cancelOtherPendingResponses(
  requestId: string,
  acceptedDoctorId: string
): Promise<void> {
  const snapshot = await db()
    .collection('doctorResponses')
    .where('requestId', '==', requestId)
    .where('response', '==', 'pending')
    .get();

  if (snapshot.empty) return;

  const batch = db().batch();
  snapshot.docs.forEach((doc) => {
    if (doc.data().doctorId !== acceptedDoctorId) {
      batch.update(doc.ref, { response: 'cancelled' });
    }
  });

  await batch.commit();
}

/**
 * Mark all pending responses as timeout.
 */
export async function timeoutPendingResponses(requestId: string): Promise<void> {
  const snapshot = await db()
    .collection('doctorResponses')
    .where('requestId', '==', requestId)
    .where('response', '==', 'pending')
    .get();

  if (snapshot.empty) return;

  const batch = db().batch();
  snapshot.docs.forEach((doc) => {
    batch.update(doc.ref, { response: 'timeout' });
  });

  await batch.commit();
}

// ─────────────────────────────────────────
// ANALYTICS HELPERS
// ─────────────────────────────────────────

export async function incrementAnalytic(
  key: string,
  value = 1
): Promise<void> {
  await db()
    .collection('analytics')
    .doc('global')
    .set(
      { [key]: admin.firestore.FieldValue.increment(value) },
      { merge: true }
    );
}
