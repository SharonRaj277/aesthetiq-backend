"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryStorage = void 0;
// ─────────────────────────────────────────────────────────────────────────────
// MemoryStorage
// ─────────────
// In-memory implementation of IHealthcareStorage.
// Use for:  unit tests, local dev, Firebase emulator warm-up.
// NOT suitable for production (data lost on restart).
// ─────────────────────────────────────────────────────────────────────────────
class MemoryStorage {
    constructor() {
        this.scanReports = new Map();
        this.treatmentPlans = new Map();
        this.sessionTrackers = new Map();
    }
    // ── Scan Reports ────────────────────────────────────────────────────────────
    async saveScanReport(report) {
        this.scanReports.set(report.id, structuredClone(report));
    }
    async getScanReport(scanId) {
        var _a;
        return structuredClone((_a = this.scanReports.get(scanId)) !== null && _a !== void 0 ? _a : null);
    }
    async updateScanReport(scanId, updates) {
        const existing = this.scanReports.get(scanId);
        if (!existing)
            throw new Error(`ScanReport ${scanId} not found`);
        this.scanReports.set(scanId, Object.assign(Object.assign(Object.assign({}, existing), updates), { updatedAt: new Date() }));
    }
    // ── Treatment Plans ─────────────────────────────────────────────────────────
    async saveTreatmentPlan(plan) {
        this.treatmentPlans.set(plan.id, structuredClone(plan));
    }
    async getTreatmentPlan(planId) {
        var _a;
        return structuredClone((_a = this.treatmentPlans.get(planId)) !== null && _a !== void 0 ? _a : null);
    }
    async getLatestTreatmentPlanForPatient(patientId) {
        const plans = this._plansForPatient(patientId);
        return plans.length > 0 ? structuredClone(plans[0]) : null;
    }
    async getAllTreatmentPlansForPatient(patientId) {
        return this._plansForPatient(patientId).map((p) => structuredClone(p));
    }
    async updateTreatmentPlan(planId, updates) {
        const existing = this.treatmentPlans.get(planId);
        if (!existing)
            throw new Error(`TreatmentPlan ${planId} not found`);
        this.treatmentPlans.set(planId, Object.assign(Object.assign(Object.assign({}, existing), updates), { updatedAt: new Date() }));
    }
    // ── Session Trackers ────────────────────────────────────────────────────────
    async saveSessionTracker(tracker) {
        this.sessionTrackers.set(tracker.planId, structuredClone(tracker));
    }
    async getSessionTracker(planId) {
        var _a;
        return structuredClone((_a = this.sessionTrackers.get(planId)) !== null && _a !== void 0 ? _a : null);
    }
    async updateSessionTracker(planId, updates) {
        const existing = this.sessionTrackers.get(planId);
        if (!existing)
            throw new Error(`SessionTracker ${planId} not found`);
        this.sessionTrackers.set(planId, Object.assign(Object.assign(Object.assign({}, existing), updates), { updatedAt: new Date() }));
    }
    // ── Helpers ─────────────────────────────────────────────────────────────────
    _plansForPatient(patientId) {
        return Array.from(this.treatmentPlans.values())
            .filter((p) => p.patientId === patientId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    /** Reset all data — useful between test cases. */
    clear() {
        this.scanReports.clear();
        this.treatmentPlans.clear();
        this.sessionTrackers.clear();
    }
}
exports.MemoryStorage = MemoryStorage;
//# sourceMappingURL=memoryStorage.js.map