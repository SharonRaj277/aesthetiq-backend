"use strict";
/**
 * AesthetiQ — Firebase Cloud Functions Entry Point
 * ─────────────────────────────────────────────────
 * All exported functions are registered here.
 */
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
exports.unifiedApi = exports.dental = exports.getTreatmentCatalogue = exports.getSessionProgress = exports.completeSession = exports.updateTreatmentStatus = exports.acceptTreatmentPlan = exports.getTreatmentPlan = exports.createTreatmentPlan = exports.createScanReport = exports.regenerateAISuggestions = exports.updateTreatmentStatusV1 = exports.getTreatmentPlanV1 = exports.createTreatmentPlanV1 = exports.onScanReportCreated = exports.scheduledMetricsRefresh = exports.updateDoctorMetrics = exports.getAnalytics = exports.reassignDoctor = exports.completeConsultation = exports.suspendDoctor = exports.retryEmergencyMatching = exports.onDoctorResponse = exports.onEmergencyCreated = void 0;
const admin = __importStar(require("firebase-admin"));
// Initialise Firebase Admin SDK (once)
admin.initializeApp();
// ─────────────────────────────────────────
// FIRESTORE TRIGGERS
// ─────────────────────────────────────────
var onEmergencyCreated_1 = require("./handlers/onEmergencyCreated");
Object.defineProperty(exports, "onEmergencyCreated", { enumerable: true, get: function () { return onEmergencyCreated_1.onEmergencyCreated; } });
var onDoctorResponse_1 = require("./handlers/onDoctorResponse");
Object.defineProperty(exports, "onDoctorResponse", { enumerable: true, get: function () { return onDoctorResponse_1.onDoctorResponse; } });
// ─────────────────────────────────────────
// HTTP / CALLABLE FUNCTIONS
// ─────────────────────────────────────────
var adminHandlers_1 = require("./handlers/adminHandlers");
Object.defineProperty(exports, "retryEmergencyMatching", { enumerable: true, get: function () { return adminHandlers_1.retryEmergencyMatching; } });
Object.defineProperty(exports, "suspendDoctor", { enumerable: true, get: function () { return adminHandlers_1.suspendDoctor; } });
Object.defineProperty(exports, "completeConsultation", { enumerable: true, get: function () { return adminHandlers_1.completeConsultation; } });
Object.defineProperty(exports, "reassignDoctor", { enumerable: true, get: function () { return adminHandlers_1.reassignDoctor; } });
Object.defineProperty(exports, "getAnalytics", { enumerable: true, get: function () { return adminHandlers_1.getAnalytics; } });
// ─────────────────────────────────────────
// SCHEDULED FUNCTIONS
// ─────────────────────────────────────────
var updateDoctorMetrics_1 = require("./handlers/updateDoctorMetrics");
Object.defineProperty(exports, "updateDoctorMetrics", { enumerable: true, get: function () { return updateDoctorMetrics_1.updateDoctorMetrics; } });
Object.defineProperty(exports, "scheduledMetricsRefresh", { enumerable: true, get: function () { return updateDoctorMetrics_1.scheduledMetricsRefresh; } });
// ─────────────────────────────────────────
// TREATMENT & PRESCRIPTION SYSTEM (v1)
// ─────────────────────────────────────────
var onScanReportCreated_1 = require("./handlers/onScanReportCreated");
Object.defineProperty(exports, "onScanReportCreated", { enumerable: true, get: function () { return onScanReportCreated_1.onScanReportCreated; } });
var treatmentHandlers_1 = require("./handlers/treatmentHandlers");
Object.defineProperty(exports, "createTreatmentPlanV1", { enumerable: true, get: function () { return treatmentHandlers_1.createTreatmentPlan; } });
Object.defineProperty(exports, "getTreatmentPlanV1", { enumerable: true, get: function () { return treatmentHandlers_1.getTreatmentPlan; } });
Object.defineProperty(exports, "updateTreatmentStatusV1", { enumerable: true, get: function () { return treatmentHandlers_1.updateTreatmentStatus; } });
Object.defineProperty(exports, "regenerateAISuggestions", { enumerable: true, get: function () { return treatmentHandlers_1.regenerateAISuggestions; } });
// ─────────────────────────────────────────
// HEALTHCARE SYSTEM — Scan · Protocol · Sessions
// ─────────────────────────────────────────
var healthcareHandlers_1 = require("./handlers/healthcareHandlers");
Object.defineProperty(exports, "createScanReport", { enumerable: true, get: function () { return healthcareHandlers_1.createScanReport; } });
Object.defineProperty(exports, "createTreatmentPlan", { enumerable: true, get: function () { return healthcareHandlers_1.createTreatmentPlan; } });
Object.defineProperty(exports, "getTreatmentPlan", { enumerable: true, get: function () { return healthcareHandlers_1.getTreatmentPlan; } });
Object.defineProperty(exports, "acceptTreatmentPlan", { enumerable: true, get: function () { return healthcareHandlers_1.acceptTreatmentPlan; } });
Object.defineProperty(exports, "updateTreatmentStatus", { enumerable: true, get: function () { return healthcareHandlers_1.updateTreatmentStatus; } });
Object.defineProperty(exports, "completeSession", { enumerable: true, get: function () { return healthcareHandlers_1.completeSession; } });
Object.defineProperty(exports, "getSessionProgress", { enumerable: true, get: function () { return healthcareHandlers_1.getSessionProgress; } });
Object.defineProperty(exports, "getTreatmentCatalogue", { enumerable: true, get: function () { return healthcareHandlers_1.getTreatmentCatalogue; } });
// ─────────────────────────────────────────
// DENTAL PRICING ENGINE — HTTP function
// ─────────────────────────────────────────
const functions = __importStar(require("firebase-functions"));
const dental_1 = require("./dental");
/**
 * dental
 * ──────
 * All dental pricing endpoints exposed as a single Firebase HTTPS function.
 *
 *   GET  https://.../dental/treatments
 *   POST https://.../dental/validate-protocol
 *   POST https://.../dental/calculate
 */
exports.dental = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .https.onRequest(dental_1.dentalApp);
// ─────────────────────────────────────────
// UNIFIED HEALTHCARE API
// ─────────────────────────────────────────
const api_1 = require("./api");
exports.unifiedApi = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .https.onRequest(api_1.unifiedApiApp);
//# sourceMappingURL=index.js.map