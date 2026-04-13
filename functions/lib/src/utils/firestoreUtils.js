"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAvailableDoctors = fetchAvailableDoctors;
exports.getDoctorById = getDoctorById;
exports.setDoctorBusy = setDoctorBusy;
exports.getUserById = getUserById;
exports.getEmergencyRequest = getEmergencyRequest;
exports.updateRequestStatus = updateRequestStatus;
exports.createPendingResponses = createPendingResponses;
exports.cancelOtherPendingResponses = cancelOtherPendingResponses;
exports.timeoutPendingResponses = timeoutPendingResponses;
exports.incrementAnalytic = incrementAnalytic;
const admin = __importStar(require("firebase-admin"));
const db = () => admin.firestore();
// ─────────────────────────────────────────
// DOCTOR HELPERS
// ─────────────────────────────────────────
/**
 * Fetch all online, available, active doctors.
 * Optionally exclude specific doctor UIDs.
 */
async function fetchAvailableDoctors(excludeUids = []) {
    const snapshot = await db()
        .collection('doctors')
        .where('isOnline', '==', true)
        .where('isBusy', '==', false)
        .where('status', '==', 'active')
        .get();
    return snapshot.docs
        .map((doc) => (Object.assign({ uid: doc.id }, doc.data())))
        .filter((d) => !excludeUids.includes(d.uid));
}
async function getDoctorById(uid) {
    const doc = await db().collection('doctors').doc(uid).get();
    if (!doc.exists)
        return null;
    return Object.assign({ uid: doc.id }, doc.data());
}
async function setDoctorBusy(uid, isBusy) {
    await db().collection('doctors').doc(uid).update({ isBusy });
}
// ─────────────────────────────────────────
// PATIENT HELPERS
// ─────────────────────────────────────────
async function getUserById(uid) {
    const doc = await db().collection('users').doc(uid).get();
    if (!doc.exists)
        return null;
    return Object.assign({ uid: doc.id }, doc.data());
}
// ─────────────────────────────────────────
// EMERGENCY REQUEST HELPERS
// ─────────────────────────────────────────
async function getEmergencyRequest(requestId) {
    const doc = await db().collection('emergencyRequests').doc(requestId).get();
    if (!doc.exists)
        return null;
    return Object.assign({ requestId: doc.id }, doc.data());
}
async function updateRequestStatus(requestId, updates) {
    await db().collection('emergencyRequests').doc(requestId).update(updates);
}
// ─────────────────────────────────────────
// DOCTOR RESPONSE HELPERS
// ─────────────────────────────────────────
/**
 * Create a pending doctor response for a new emergency match attempt.
 */
async function createPendingResponses(requestId, doctorUids) {
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
async function cancelOtherPendingResponses(requestId, acceptedDoctorId) {
    const snapshot = await db()
        .collection('doctorResponses')
        .where('requestId', '==', requestId)
        .where('response', '==', 'pending')
        .get();
    if (snapshot.empty)
        return;
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
async function timeoutPendingResponses(requestId) {
    const snapshot = await db()
        .collection('doctorResponses')
        .where('requestId', '==', requestId)
        .where('response', '==', 'pending')
        .get();
    if (snapshot.empty)
        return;
    const batch = db().batch();
    snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, { response: 'timeout' });
    });
    await batch.commit();
}
// ─────────────────────────────────────────
// ANALYTICS HELPERS
// ─────────────────────────────────────────
async function incrementAnalytic(key, value = 1) {
    await db()
        .collection('analytics')
        .doc('global')
        .set({ [key]: admin.firestore.FieldValue.increment(value) }, { merge: true });
}
//# sourceMappingURL=firestoreUtils.js.map