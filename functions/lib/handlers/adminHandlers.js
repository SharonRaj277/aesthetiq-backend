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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAnalytics = exports.reassignDoctor = exports.completeConsultation = exports.suspendDoctor = exports.retryEmergencyMatching = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const emergencyMatcher_1 = require("../matching/emergencyMatcher");
const firestoreUtils_1 = require("../utils/firestoreUtils");
const fcmService_1 = require("../notifications/fcmService");
const db = () => admin.firestore();
// ─────────────────────────────────────────
// GUARD: only callable with a valid ID token
// ─────────────────────────────────────────
async function verifyAdmin(context) {
    var _a;
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');
    const adminDoc = await db().collection('admins').doc(context.auth.uid).get();
    if (!adminDoc.exists || ((_a = adminDoc.data()) === null || _a === void 0 ? void 0 : _a.role) !== 'admin') {
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
exports.retryEmergencyMatching = functions
    .runWith({ timeoutSeconds: 60 })
    .https.onCall(async (data, context) => {
    await verifyAdmin(context);
    const { requestId } = data;
    if (!requestId)
        throw new functions.https.HttpsError('invalid-argument', 'requestId required');
    const request = await (0, firestoreUtils_1.getEmergencyRequest)(requestId);
    if (!request)
        throw new functions.https.HttpsError('not-found', 'Request not found');
    if (request.status !== 'searching') {
        return { success: false, message: `Request is already in status: ${request.status}` };
    }
    const patient = await (0, firestoreUtils_1.getUserById)(request.patientId);
    if (!patient)
        throw new functions.https.HttpsError('not-found', 'Patient not found');
    const matched = await (0, emergencyMatcher_1.runMatchingPipeline)(request, patient, true);
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
exports.suspendDoctor = functions
    .runWith({ timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
    await verifyAdmin(context);
    const { doctorId, reason } = data;
    if (!doctorId)
        throw new functions.https.HttpsError('invalid-argument', 'doctorId required');
    await db().collection('doctors').doc(doctorId).update({
        status: 'suspended',
        isOnline: false,
        suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
        suspendReason: reason !== null && reason !== void 0 ? reason : 'Admin action',
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
exports.completeConsultation = functions
    .runWith({ timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');
    }
    const { requestId, amount, platformFeePct = 0.15 } = data;
    if (!requestId || !amount) {
        throw new functions.https.HttpsError('invalid-argument', 'requestId and amount required');
    }
    const request = await (0, firestoreUtils_1.getEmergencyRequest)(requestId);
    if (!request)
        throw new functions.https.HttpsError('not-found', 'Request not found');
    if (request.status !== 'assigned') {
        throw new functions.https.HttpsError('failed-precondition', `Request is ${request.status}, not assigned`);
    }
    // Only the assigned doctor or admin can complete
    const doctorId = request.assignedDoctorId;
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
    const patient = await (0, firestoreUtils_1.getUserById)(request.patientId);
    if (patient === null || patient === void 0 ? void 0 : patient.fcmToken) {
        await (0, fcmService_1.sendPatientNotification)(patient.fcmToken, 'Your consultation is complete. Thank you for using AesthetiQ!', 'CONSULTATION_COMPLETE', { requestId, transactionId: txRef.id });
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
exports.reassignDoctor = functions
    .runWith({ timeoutSeconds: 60 })
    .https.onCall(async (data, context) => {
    var _a, _b;
    await verifyAdmin(context);
    const { requestId } = data;
    if (!requestId)
        throw new functions.https.HttpsError('invalid-argument', 'requestId required');
    const request = await (0, firestoreUtils_1.getEmergencyRequest)(requestId);
    if (!request || request.status !== 'assigned') {
        throw new functions.https.HttpsError('failed-precondition', 'Request not in assigned state');
    }
    const previousDoctorId = request.assignedDoctorId;
    // Free the disconnected doctor
    await db().collection('doctors').doc(previousDoctorId).update({ isBusy: false });
    // Re-open request for re-matching (clear assignment)
    await (0, firestoreUtils_1.updateRequestStatus)(requestId, {
        status: 'searching',
        assignedDoctorId: undefined,
        retryCount: 0,
        notifiedDoctors: [...((_a = request.notifiedDoctors) !== null && _a !== void 0 ? _a : []), previousDoctorId],
    });
    const patient = await (0, firestoreUtils_1.getUserById)(request.patientId);
    if (!patient)
        throw new functions.https.HttpsError('not-found', 'Patient not found');
    if (patient.fcmToken) {
        await (0, fcmService_1.sendPatientNotification)(patient.fcmToken, 'Your doctor disconnected. Finding a new doctor immediately…', 'SEARCHING', { requestId });
    }
    const matched = await (0, emergencyMatcher_1.runMatchingPipeline)(Object.assign(Object.assign({}, request), { status: 'searching', notifiedDoctors: [...((_b = request.notifiedDoctors) !== null && _b !== void 0 ? _b : []), previousDoctorId] }), patient, false);
    return { success: true, reassigning: true, doctorsNotified: matched.length };
});
// ─────────────────────────────────────────
// getAnalytics (callable)
// ─────────────────────────────────────────
exports.getAnalytics = functions
    .runWith({ timeoutSeconds: 30 })
    .https.onCall(async (_data, context) => {
    var _a;
    await verifyAdmin(context);
    const globalDoc = await db().collection('analytics').doc('global').get();
    const last7Days = await db()
        .collection('analytics')
        .orderBy('snapshotDate', 'desc')
        .limit(7)
        .get();
    return {
        global: (_a = globalDoc.data()) !== null && _a !== void 0 ? _a : {},
        daily: last7Days.docs.map((d) => (Object.assign({ id: d.id }, d.data()))),
    };
});
//# sourceMappingURL=adminHandlers.js.map