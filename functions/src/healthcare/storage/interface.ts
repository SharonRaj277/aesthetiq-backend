import {
  ScanReport,
  TreatmentPlan,
  SessionTracker,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// IHealthcareStorage
// ──────────────────
// Pure interface — no Firebase, no HTTP.
// Swap implementations without touching any service code.
// ─────────────────────────────────────────────────────────────────────────────

export interface IHealthcareStorage {
  // ── Scan Reports ────────────────────────────────────────────────────────────
  saveScanReport(report: ScanReport): Promise<void>;
  getScanReport(scanId: string): Promise<ScanReport | null>;
  updateScanReport(scanId: string, updates: Partial<ScanReport>): Promise<void>;

  // ── Treatment Plans ─────────────────────────────────────────────────────────
  saveTreatmentPlan(plan: TreatmentPlan): Promise<void>;
  getTreatmentPlan(planId: string): Promise<TreatmentPlan | null>;
  getLatestTreatmentPlanForPatient(patientId: string): Promise<TreatmentPlan | null>;
  getAllTreatmentPlansForPatient(patientId: string): Promise<TreatmentPlan[]>;
  updateTreatmentPlan(planId: string, updates: Partial<TreatmentPlan>): Promise<void>;

  // ── Session Trackers ────────────────────────────────────────────────────────
  saveSessionTracker(tracker: SessionTracker): Promise<void>;
  getSessionTracker(planId: string): Promise<SessionTracker | null>;
  updateSessionTracker(planId: string, updates: Partial<SessionTracker>): Promise<void>;
}
