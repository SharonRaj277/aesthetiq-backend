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
exports.onEmergencyCreated = void 0;
const functions = __importStar(require("firebase-functions"));
const emergencyMatcher_1 = require("../matching/emergencyMatcher");
const firestoreUtils_1 = require("../utils/firestoreUtils");
const fcmService_1 = require("../notifications/fcmService");
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
exports.onEmergencyCreated = functions
    .runWith({
    timeoutSeconds: 120,
    memory: '256MB',
})
    .firestore.document('emergencyRequests/{requestId}')
    .onCreate(async (snap, context) => {
    const requestId = context.params.requestId;
    const request = Object.assign({ requestId, notifiedDoctors: [], retryCount: 0 }, snap.data());
    console.log(`[onEmergencyCreated] New request ${requestId} — severity: ${request.severity}`);
    // ── 1. Load patient ──────────────────────────────────────────────────────
    const patient = await (0, firestoreUtils_1.getUserById)(request.patientId);
    if (!patient) {
        console.error(`[onEmergencyCreated] Patient ${request.patientId} not found`);
        return;
    }
    // ── 2. Run initial matching ──────────────────────────────────────────────
    const matched = await (0, emergencyMatcher_1.runMatchingPipeline)(request, patient, false);
    // ── 3. Notify patient ────────────────────────────────────────────────────
    if (patient.fcmToken) {
        if (matched.length === 0) {
            await (0, fcmService_1.sendPatientNotification)(patient.fcmToken, 'No doctors online right now — searching…', 'NO_DOCTORS_AVAILABLE', { requestId });
        }
        else {
            await (0, fcmService_1.sendPatientNotification)(patient.fcmToken, `Connecting you with the best available doctor…`, 'SEARCHING', { requestId });
        }
    }
    // ── 4. Wait & retry if no acceptance ────────────────────────────────────
    await (0, emergencyMatcher_1.waitAndRetryIfNeeded)(requestId, patient);
});
//# sourceMappingURL=onEmergencyCreated.js.map