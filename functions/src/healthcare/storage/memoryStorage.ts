import { ScanReport, TreatmentPlan, SessionTracker } from '../types';
import { IHealthcareStorage } from './interface';

// ─────────────────────────────────────────────────────────────────────────────
// MemoryStorage
// ─────────────
// In-memory implementation of IHealthcareStorage.
// Use for:  unit tests, local dev, Firebase emulator warm-up.
// NOT suitable for production (data lost on restart).
// ─────────────────────────────────────────────────────────────────────────────

export class MemoryStorage implements IHealthcareStorage {
  private scanReports = new Map<string, ScanReport>();
  private treatmentPlans = new Map<string, TreatmentPlan>();
  private sessionTrackers = new Map<string, SessionTracker>();

  // ── Scan Reports ────────────────────────────────────────────────────────────

  async saveScanReport(report: ScanReport): Promise<void> {
    this.scanReports.set(report.id, structuredClone(report));
  }

  async getScanReport(scanId: string): Promise<ScanReport | null> {
    return structuredClone(this.scanReports.get(scanId) ?? null);
  }

  async updateScanReport(scanId: string, updates: Partial<ScanReport>): Promise<void> {
    const existing = this.scanReports.get(scanId);
    if (!existing) throw new Error(`ScanReport ${scanId} not found`);
    this.scanReports.set(scanId, { ...existing, ...updates, updatedAt: new Date() });
  }

  // ── Treatment Plans ─────────────────────────────────────────────────────────

  async saveTreatmentPlan(plan: TreatmentPlan): Promise<void> {
    this.treatmentPlans.set(plan.id, structuredClone(plan));
  }

  async getTreatmentPlan(planId: string): Promise<TreatmentPlan | null> {
    return structuredClone(this.treatmentPlans.get(planId) ?? null);
  }

  async getLatestTreatmentPlanForPatient(patientId: string): Promise<TreatmentPlan | null> {
    const plans = this._plansForPatient(patientId);
    return plans.length > 0 ? structuredClone(plans[0]) : null;
  }

  async getAllTreatmentPlansForPatient(patientId: string): Promise<TreatmentPlan[]> {
    return this._plansForPatient(patientId).map((p) => structuredClone(p));
  }

  async updateTreatmentPlan(planId: string, updates: Partial<TreatmentPlan>): Promise<void> {
    const existing = this.treatmentPlans.get(planId);
    if (!existing) throw new Error(`TreatmentPlan ${planId} not found`);
    this.treatmentPlans.set(planId, { ...existing, ...updates, updatedAt: new Date() });
  }

  // ── Session Trackers ────────────────────────────────────────────────────────

  async saveSessionTracker(tracker: SessionTracker): Promise<void> {
    this.sessionTrackers.set(tracker.planId, structuredClone(tracker));
  }

  async getSessionTracker(planId: string): Promise<SessionTracker | null> {
    return structuredClone(this.sessionTrackers.get(planId) ?? null);
  }

  async updateSessionTracker(planId: string, updates: Partial<SessionTracker>): Promise<void> {
    const existing = this.sessionTrackers.get(planId);
    if (!existing) throw new Error(`SessionTracker ${planId} not found`);
    this.sessionTrackers.set(planId, { ...existing, ...updates, updatedAt: new Date() });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _plansForPatient(patientId: string): TreatmentPlan[] {
    return Array.from(this.treatmentPlans.values())
      .filter((p) => p.patientId === patientId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Reset all data — useful between test cases. */
  clear(): void {
    this.scanReports.clear();
    this.treatmentPlans.clear();
    this.sessionTrackers.clear();
  }
}
