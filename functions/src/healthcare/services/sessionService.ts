import { v4 as uuid } from 'uuid';
import {
  SessionTracker,
  SessionEntry,
  TreatmentPlan,
  HealthcareError,
} from '../types';
import { IHealthcareStorage } from '../storage/interface';

// ─────────────────────────────────────────────────────────────────────────────
// SessionService
// ───────────────
// Manages per-treatment session tracking within a plan.
//
// Rules:
//   • Tracker is initialised when a patient accepts a plan.
//   • completedSessions can never exceed totalSessions for a treatment.
//   • When ALL treatments hit their session target the plan auto-completes.
// ─────────────────────────────────────────────────────────────────────────────

export class SessionService {
  constructor(private readonly storage: IHealthcareStorage) {}

  // ─────────────────────────────────────────
  // initSessionTracker
  // ─────────────────────────────────────────

  /**
   * Called immediately after a patient accepts a plan.
   * Creates one SessionEntry per ProtocolEntry with completedSessions = 0.
   *
   * Also advances the plan status to 'accepted' — call this INSTEAD of
   * TreatmentService.acceptTreatmentPlan so both happen atomically (best-effort).
   */
  async initSessionTracker(plan: TreatmentPlan): Promise<SessionTracker> {
    const existing = await this.storage.getSessionTracker(plan.id);
    if (existing) {
      // Idempotent — return existing tracker if already initialised
      return existing;
    }

    const now = new Date();
    const tracker: SessionTracker = {
      id: plan.id,
      planId: plan.id,
      patientId: plan.patientId,
      sessions: plan.protocol.map((entry) => ({
        treatment: entry.treatment,
        totalSessions: entry.sessions,
        completedSessions: 0,
      })),
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveSessionTracker(tracker);
    return tracker;
  }

  // ─────────────────────────────────────────
  // getSessionTracker
  // ─────────────────────────────────────────

  async getSessionTracker(planId: string): Promise<SessionTracker> {
    const tracker = await this.storage.getSessionTracker(planId);
    if (!tracker) {
      throw new HealthcareError(
        'NOT_FOUND',
        `No session tracker found for plan ${planId}. Has the patient accepted the plan?`
      );
    }
    return tracker;
  }

  // ─────────────────────────────────────────
  // completeSession
  // ─────────────────────────────────────────

  /**
   * Mark one session as completed for a given treatment within a plan.
   *
   * Returns:
   *   { tracker, allComplete }
   *
   * Callers should call TreatmentService.updateTreatmentStatus(planId, 'completed')
   * when allComplete === true.
   */
  async completeSession(
    planId: string,
    treatment: string
  ): Promise<{ tracker: SessionTracker; allComplete: boolean }> {
    const tracker = await this.getSessionTracker(planId);

    const entry = tracker.sessions.find(
      (s) => s.treatment.toLowerCase().trim() === treatment.toLowerCase().trim()
    );

    if (!entry) {
      throw new HealthcareError(
        'NOT_FOUND',
        `Treatment '${treatment}' not found in plan ${planId}. ` +
          `Available: [${tracker.sessions.map((s) => s.treatment).join(', ')}]`
      );
    }

    if (entry.completedSessions >= entry.totalSessions) {
      throw new HealthcareError(
        'INVALID_STATE',
        `All ${entry.totalSessions} sessions for '${treatment}' are already complete.`
      );
    }

    // Increment
    entry.completedSessions += 1;

    const updatedSessions: SessionEntry[] = tracker.sessions.map((s) =>
      s.treatment.toLowerCase().trim() === treatment.toLowerCase().trim() ? entry : s
    );

    await this.storage.updateSessionTracker(planId, { sessions: updatedSessions });

    const updatedTracker: SessionTracker = {
      ...tracker,
      sessions: updatedSessions,
      updatedAt: new Date(),
    };

    const allComplete = updatedSessions.every(
      (s) => s.completedSessions >= s.totalSessions
    );

    return { tracker: updatedTracker, allComplete };
  }

  // ─────────────────────────────────────────
  // getProgress
  // ─────────────────────────────────────────

  /**
   * Convenience summary for patient-facing progress views.
   *
   * Returns per-treatment progress + an overall percentage.
   */
  async getProgress(planId: string): Promise<{
    planId: string;
    overallPercentage: number;
    treatments: Array<{
      treatment: string;
      completedSessions: number;
      totalSessions: number;
      percentComplete: number;
      isComplete: boolean;
    }>;
  }> {
    const tracker = await this.getSessionTracker(planId);

    const treatments = tracker.sessions.map((s) => ({
      treatment: s.treatment,
      completedSessions: s.completedSessions,
      totalSessions: s.totalSessions,
      percentComplete:
        s.totalSessions > 0
          ? Math.round((s.completedSessions / s.totalSessions) * 100)
          : 0,
      isComplete: s.completedSessions >= s.totalSessions,
    }));

    const totalSessions = tracker.sessions.reduce((sum, s) => sum + s.totalSessions, 0);
    const completedSessions = tracker.sessions.reduce((sum, s) => sum + s.completedSessions, 0);
    const overallPercentage =
      totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

    return { planId, overallPercentage, treatments };
  }
}
