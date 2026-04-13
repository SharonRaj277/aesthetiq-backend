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
exports.onDoctorResponse = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const firestoreUtils_1 = require("../utils/firestoreUtils");
const fcmService_1 = require("../notifications/fcmService");
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
exports.onDoctorResponse = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .firestore.document('doctorResponses/{responseId}')
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    // Only act when transitioning out of "pending"
    if (before.response !== 'pending' || after.response === 'pending')
        return;
    const { requestId, doctorId, response } = after;
    const responseDocRef = change.after.ref;
    console.log(`[onDoctorResponse] doctor=${doctorId} response=${response} request=${requestId}`);
    if (response === 'accepted') {
        await handleAcceptance(requestId, doctorId, responseDocRef);
    }
    else {
        // declined | timeout | cancelled — nothing extra to do here;
        // the retry loop in onEmergencyCreated handles escalation.
        console.log(`[onDoctorResponse] Doctor ${doctorId} ${response} — no action needed.`);
    }
});
// ─────────────────────────────────────────
// ACCEPTANCE HANDLER
// ─────────────────────────────────────────
async function handleAcceptance(requestId, doctorId, responseDocRef) {
    var _a, _b, _c;
    const requestRef = db().collection('emergencyRequests').doc(requestId);
    let assigned = false;
    let responseTimeSeconds = 0;
    // ── Transactional assignment (prevents two doctors both "winning") ─────────
    await db().runTransaction(async (tx) => {
        const requestDoc = await tx.get(requestRef);
        if (!requestDoc.exists)
            return;
        const request = requestDoc.data();
        if (request.status !== 'searching') {
            // Already assigned by a faster doctor — skip
            console.log(`[onDoctorResponse] Request ${requestId} already ${request.status} — skipping.`);
            return;
        }
        const createdAt = request.createdAt.toDate();
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
    if (!assigned)
        return;
    console.log(`[onDoctorResponse] Assigned doctor ${doctorId} to ${requestId} in ${responseTimeSeconds}s`);
    // ── Cancel all other pending responses ───────────────────────────────────
    await (0, firestoreUtils_1.cancelOtherPendingResponses)(requestId, doctorId);
    // ── Notify patient ────────────────────────────────────────────────────────
    const [requestDoc, doctor] = await Promise.all([
        requestRef.get(),
        (0, firestoreUtils_1.getDoctorById)(doctorId),
    ]);
    const request = requestDoc.data();
    const patient = (request === null || request === void 0 ? void 0 : request.patientId)
        ? await (0, firestoreUtils_1.getUserById)(request.patientId)
        : null;
    if (patient === null || patient === void 0 ? void 0 : patient.fcmToken) {
        await (0, fcmService_1.sendPatientNotification)(patient.fcmToken, `Dr. ${(_a = doctor === null || doctor === void 0 ? void 0 : doctor.name) !== null && _a !== void 0 ? _a : 'Your doctor'} accepted — connecting now!`, 'DOCTOR_ASSIGNED', {
            requestId,
            doctorId,
            doctorName: (_b = doctor === null || doctor === void 0 ? void 0 : doctor.name) !== null && _b !== void 0 ? _b : '',
            doctorSpecialization: (_c = doctor === null || doctor === void 0 ? void 0 : doctor.specialization) !== null && _c !== void 0 ? _c : '',
            responseTime: responseTimeSeconds.toString(),
        });
    }
    // ── Update doctor metrics ─────────────────────────────────────────────────
    await updateDoctorMetrics(doctorId, responseTimeSeconds, true);
    // ── Analytics ─────────────────────────────────────────────────────────────
    await db()
        .collection('analytics')
        .doc('global')
        .set({
        totalSuccessfulMatches: admin.firestore.FieldValue.increment(1),
        avgResponseTimeSum: admin.firestore.FieldValue.increment(responseTimeSeconds),
        avgResponseTimeCount: admin.firestore.FieldValue.increment(1),
    }, { merge: true });
}
// ─────────────────────────────────────────
// METRIC UPDATE (inline, called from this handler)
// ─────────────────────────────────────────
async function updateDoctorMetrics(doctorId, responseTime, accepted) {
    const doctorRef = db().collection('doctors').doc(doctorId);
    await db().runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e;
        const doc = await tx.get(doctorRef);
        if (!doc.exists)
            return;
        const data = doc.data();
        const totalConsultations = ((_a = data.totalConsultations) !== null && _a !== void 0 ? _a : 0) + (accepted ? 1 : 0);
        const prevAvg = (_b = data.avgResponseTime) !== null && _b !== void 0 ? _b : 0;
        const prevCount = (_c = data.ratingCount) !== null && _c !== void 0 ? _c : 1;
        // Rolling average for response time
        const newAvgResponse = totalConsultations > 0
            ? Math.round((prevAvg * (prevCount - 1) + responseTime) / prevCount)
            : responseTime;
        // Acceptance rate: acceptedCount / totalNotifications (stored separately)
        const totalNotifications = ((_d = data.totalNotifications) !== null && _d !== void 0 ? _d : 0) + 1;
        const acceptedCount = ((_e = data.acceptedCount) !== null && _e !== void 0 ? _e : 0) + (accepted ? 1 : 0);
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
//# sourceMappingURL=onDoctorResponse.js.map