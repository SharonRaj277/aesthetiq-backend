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
exports.waitAndRetryIfNeeded = exports.runMatchingPipeline = void 0;
const admin = __importStar(require("firebase-admin"));
const scoringEngine_1 = require("./scoringEngine");
const firestoreUtils_1 = require("../utils/firestoreUtils");
const fcmService_1 = require("../notifications/fcmService");
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
async function runMatchingPipeline(request, patient, relaxed = false) {
    var _a;
    const alreadyNotified = (_a = request.notifiedDoctors) !== null && _a !== void 0 ? _a : [];
    // Step 1 — Fetch eligible doctors (excluding already notified)
    const doctors = await (0, firestoreUtils_1.fetchAvailableDoctors)(alreadyNotified);
    if (doctors.length === 0) {
        console.log(`[Matcher] No eligible doctors for request ${request.requestId}`);
        return [];
    }
    // Step 2 — Score & rank
    const scored = (0, scoringEngine_1.scoreDoctors)(doctors, request, relaxed);
    // Step 3 — Pick top N
    const n = (0, scoringEngine_1.topN)(request.severity);
    const top = scored.slice(0, n);
    console.log(`[Matcher] Top ${top.length} doctors for ${request.requestId}:`, top.map((d) => ({
        uid: d.doctor.uid,
        name: d.doctor.name,
        score: d.score.toFixed(3),
    })));
    const topDoctorIds = top.map((d) => d.doctor.uid);
    const allNotified = [...alreadyNotified, ...topDoctorIds];
    // Step 4 — Create pending response docs (Firestore batch)
    await (0, firestoreUtils_1.createPendingResponses)(request.requestId, topDoctorIds);
    // Step 5 — Update request with notifiedDoctors
    await (0, firestoreUtils_1.updateRequestStatus)(request.requestId, {
        notifiedDoctors: allNotified,
    });
    // Step 6 — Send FCM alerts (non-blocking failures)
    await (0, fcmService_1.sendBulkEmergencyAlerts)(top.map((d) => ({ uid: d.doctor.uid, fcmToken: d.doctor.fcmToken })), {
        patientName: patient.name,
        issueType: request.issueType,
        severity: request.severity,
        requestId: request.requestId,
    });
    return top;
}
exports.runMatchingPipeline = runMatchingPipeline;
// ─────────────────────────────────────────
// TIMEOUT + RETRY LOGIC
// ─────────────────────────────────────────
const TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;
/**
 * Wait TIMEOUT_MS then check if the request is still unassigned.
 * If so, expand the search with relaxed criteria.
 */
async function waitAndRetryIfNeeded(requestId, patient) {
    var _a;
    await sleep(TIMEOUT_MS);
    // Re-read the current state from Firestore
    const doc = await db().collection('emergencyRequests').doc(requestId).get();
    if (!doc.exists)
        return;
    const request = Object.assign({ requestId: doc.id }, doc.data());
    if (request.status !== 'searching') {
        // Already assigned or cancelled — nothing to do
        return;
    }
    const retryCount = ((_a = request.retryCount) !== null && _a !== void 0 ? _a : 0) + 1;
    console.log(`[Matcher] Timeout on ${requestId} — retry #${retryCount} (relaxed=${retryCount > 1})`);
    if (retryCount > MAX_RETRIES) {
        await handleNoMatchFound(requestId, patient);
        return;
    }
    await (0, firestoreUtils_1.updateRequestStatus)(requestId, { retryCount });
    // Relaxed mode from retry #2 onward
    const relaxed = retryCount >= 2;
    const matched = await runMatchingPipeline(request, patient, relaxed);
    if (matched.length === 0) {
        if (patient.fcmToken) {
            await (0, fcmService_1.sendPatientNotification)(patient.fcmToken, 'Still searching for an available doctor…', 'RETRYING', { requestId });
        }
        // Recurse into next wait cycle
        await waitAndRetryIfNeeded(requestId, patient);
    }
    else {
        if (patient.fcmToken) {
            await (0, fcmService_1.sendPatientNotification)(patient.fcmToken, 'Found more doctors — waiting for acceptance…', 'SEARCHING', { requestId });
        }
        await waitAndRetryIfNeeded(requestId, patient);
    }
}
exports.waitAndRetryIfNeeded = waitAndRetryIfNeeded;
// ─────────────────────────────────────────
// NO MATCH FOUND
// ─────────────────────────────────────────
async function handleNoMatchFound(requestId, patient) {
    console.log(`[Matcher] No match found after ${MAX_RETRIES} retries for ${requestId}`);
    await (0, firestoreUtils_1.updateRequestStatus)(requestId, {
        status: 'cancelled',
        cancelReason: 'no_doctors_available',
    });
    if (patient.fcmToken) {
        await (0, fcmService_1.sendPatientNotification)(patient.fcmToken, 'No doctors are available right now. Please try again or call emergency services.', 'NO_DOCTORS_FOUND', { requestId });
    }
    // Analytics
    await db()
        .collection('analytics')
        .doc('global')
        .set({ missedRequests: admin.firestore.FieldValue.increment(1) }, { merge: true });
}
// ─────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=emergencyMatcher.js.map