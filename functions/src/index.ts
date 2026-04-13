/**
 * AesthetiQ — Firebase Cloud Functions Entry Point
 * ─────────────────────────────────────────────────
 * All exported functions are registered here.
 */

import * as admin from 'firebase-admin';

// Initialise Firebase Admin SDK (once)
admin.initializeApp();

// ─────────────────────────────────────────
// FIRESTORE TRIGGERS
// ─────────────────────────────────────────

export { onEmergencyCreated } from './handlers/onEmergencyCreated';
export { onDoctorResponse } from './handlers/onDoctorResponse';

// ─────────────────────────────────────────
// HTTP / CALLABLE FUNCTIONS
// ─────────────────────────────────────────

export {
  retryEmergencyMatching,
  suspendDoctor,
  completeConsultation,
  reassignDoctor,
  getAnalytics,
} from './handlers/adminHandlers';

export { scheduleConsultation, runAIAnalysis, generateTreatmentPlan } from './handlers/aiHandlers';
export { simulateTreatment } from './handlers/simulationHandlers';

// ─────────────────────────────────────────
// SCHEDULED FUNCTIONS
// ─────────────────────────────────────────

export {
  updateDoctorMetrics,
  scheduledMetricsRefresh,
} from './handlers/updateDoctorMetrics';

// ─────────────────────────────────────────
// TREATMENT & PRESCRIPTION SYSTEM (v1)
// ─────────────────────────────────────────

export { onScanReportCreated } from './handlers/onScanReportCreated';
export {
  createTreatmentPlan as createTreatmentPlanV1,
  getTreatmentPlan as getTreatmentPlanV1,
  updateTreatmentStatus as updateTreatmentStatusV1,
  regenerateAISuggestions,
} from './handlers/treatmentHandlers';

// ─────────────────────────────────────────
// HEALTHCARE SYSTEM — Scan · Protocol · Sessions
// ─────────────────────────────────────────

export {
  createScanReport,
  createTreatmentPlan,
  getTreatmentPlan,
  acceptTreatmentPlan,
  updateTreatmentStatus,
  completeSession,
  getSessionProgress,
  getTreatmentCatalogue,
} from './handlers/healthcareHandlers';

// ─────────────────────────────────────────
// DENTAL PRICING ENGINE — HTTP function
// ─────────────────────────────────────────

import * as functions from 'firebase-functions';
import { dentalApp } from './dental';

/**
 * dental
 * ──────
 * All dental pricing endpoints exposed as a single Firebase HTTPS function.
 *
 *   GET  https://.../dental/treatments
 *   POST https://.../dental/validate-protocol
 *   POST https://.../dental/calculate
 */
export const dental = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(dentalApp);

// ─────────────────────────────────────────
// UNIFIED HEALTHCARE API
// ─────────────────────────────────────────
import { unifiedApiApp } from './api';

export const unifiedApi = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(unifiedApiApp);
