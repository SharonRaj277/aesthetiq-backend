import { v4 as uuid } from 'uuid';
import {
  TreatmentPlan,
  TreatmentStatus,
  DoctorAction,
  ProtocolEntry,
  CreateTreatmentPlanInput,
  HealthcareError,
} from '../types';
import { IHealthcareStorage } from '../storage/interface';
import { calculateUnifiedPlan, TreatmentInput } from './unifiedPricingEngine';

// ─────────────────────────────────────────────────────────────────────────────
// TreatmentService
// ─────────────────
// Manages treatment plan creation, retrieval, and status transitions.
//
// Rules enforced here:
//   • Patient cannot create or modify a plan (doctorId required in input).
//   • AI suggestions are stored alongside doctor's protocol for audit.
//   • Status transitions follow a strict one-way lifecycle.
// ─────────────────────────────────────────────────────────────────────────────

// Valid forward-only lifecycle transitions
const ALLOWED_TRANSITIONS: Record<TreatmentStatus, TreatmentStatus[]> = {
  ai_suggested:   ['doctor_created'],
  doctor_created: ['accepted'],
  accepted:       ['in_progress'],
  in_progress:    ['completed'],
  completed:      [],
};

export class TreatmentService {
  constructor(private readonly storage: IHealthcareStorage) {}

  // ─────────────────────────────────────────
  // createTreatmentPlan
  // ─────────────────────────────────────────

  /**
   * Doctor creates a treatment plan after reviewing scan + AI suggestions.
   *
   * doctorAction is auto-detected by comparing the doctor's protocol to
   * the AI suggestions stored on the scan report:
   *   • Same treatments (by name, order-independent) → 'approved_ai'
   *   • Overlapping treatments with edits            → 'modified'
   *   • Completely new treatments                    → 'custom'
   */
  async createTreatmentPlan(input: CreateTreatmentPlanInput): Promise<TreatmentPlan> {
    this.validatePlanInput(input);

    // Load scan
    const scan = await this.storage.getScanReport(input.scanId);
    if (!scan) throw new HealthcareError('NOT_FOUND', `Scan report ${input.scanId} not found`);

    if (scan.status === 'pending_ai') {
      throw new HealthcareError(
        'INVALID_STATE',
        'AI suggestions are still being generated. Please wait and try again.'
      );
    }

    // Detect doctorAction
    const doctorAction = this.detectDoctorAction(
      input.protocol,
      scan.aiSuggestions.map((s) => s.treatment)
    );

    // Calculate Pricing
    const pricingInputs: TreatmentInput[] = input.protocol.map(p => ({
      domain: scan.category,
      treatment: p.treatment,
      name: p.name,
      price: p.pricePerSession, // Passed from client if custom
      sessions: p.sessions,
      purpose: p.purpose,
      isCustom: p.isCustom
    }));

    const planCalc = calculateUnifiedPlan(pricingInputs);

    // Merge pricing back to protocol entries
    const enrichedProtocol = planCalc.breakdown.map((item) => {
      // Find original if it wasn't a complimentary addition
      const original = input.protocol.find(
        (p) => p.treatment === item.name || (p.name && p.name === item.name)
      );
      
      return {
        treatment: item.name,
        name: item.displayName,
        isCustom: item.isCustom,
        purpose: item.purpose,
        sessions: item.sessions,
        frequency: original?.frequency,
        notes: original?.notes,
        pricePerSession: item.pricePerSession,
        totalPrice: item.totalPrice,
        platformFee: item.platformFee,
        doctorEarning: item.doctorEarning,
        isComplimentary: item.isComplimentary,
      };
    });

    const now = new Date();
    const plan: TreatmentPlan = {
      id: uuid(),
      patientId: scan.patientId,
      doctorId: input.doctorId,
      scanId: input.scanId,
      category: scan.category,
      aiSuggestions: scan.aiSuggestions,      // always preserved
      doctorAction,
      protocol: enrichedProtocol,
      medications: input.medications ?? [],
      labTests: input.labTests ?? [],
      notes: input.notes ?? '',
      pricing: {
        totalBeforeDeduction: planCalc.totalBeforeDeduction,
        consultationDeduction: planCalc.consultationDeduction,
        finalPayable: planCalc.finalPayable,
        totalDoctorEarning: planCalc.totalDoctorEarning,
        totalPlatformFee: planCalc.totalPlatformFee,
      },
      status: 'doctor_created',
      createdAt: now,
      updatedAt: now,
    };

    await this.storage.saveTreatmentPlan(plan);

    // Mark scan as having a plan
    await this.storage.updateScanReport(input.scanId, {
      status: 'plan_created',
      treatmentPlanId: plan.id,
    });

    return plan;
  }

  // ─────────────────────────────────────────
  // getTreatmentPlan
  // ─────────────────────────────────────────

  /**
   * Fetch the latest treatment plan for a patient.
   * Returns full plan including both aiSuggestions and finalProtocol.
   */
  async getTreatmentPlan(patientId: string): Promise<TreatmentPlan> {
    const plan = await this.storage.getLatestTreatmentPlanForPatient(patientId);
    if (!plan) {
      throw new HealthcareError('NOT_FOUND', `No treatment plan found for patient ${patientId}`);
    }
    return plan;
  }

  /** Fetch all treatment plans for a patient (full history). */
  async getTreatmentHistory(patientId: string): Promise<TreatmentPlan[]> {
    return this.storage.getAllTreatmentPlansForPatient(patientId);
  }

  /** Fetch a specific plan by ID. */
  async getPlanById(planId: string): Promise<TreatmentPlan> {
    const plan = await this.storage.getTreatmentPlan(planId);
    if (!plan) throw new HealthcareError('NOT_FOUND', `Treatment plan ${planId} not found`);
    return plan;
  }

  // ─────────────────────────────────────────
  // acceptTreatmentPlan
  // ─────────────────────────────────────────

  /**
   * Patient accepts a plan → status: 'doctor_created' → 'accepted'.
   * A SessionTracker is initialised here via the SessionService callback.
   * This method only updates the plan status; call SessionService separately.
   */
  async acceptTreatmentPlan(planId: string): Promise<TreatmentPlan> {
    return this.transitionStatus(planId, 'accepted');
  }

  // ─────────────────────────────────────────
  // updateTreatmentStatus
  // ─────────────────────────────────────────

  /**
   * Advance the plan through its lifecycle.
   * Rejects invalid or backwards transitions.
   *
   * Allowed flow:
   *   ai_suggested → doctor_created → accepted → in_progress → completed
   */
  async updateTreatmentStatus(
    planId: string,
    newStatus: TreatmentStatus
  ): Promise<TreatmentPlan> {
    return this.transitionStatus(planId, newStatus);
  }

  // ─────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────

  private async transitionStatus(
    planId: string,
    newStatus: TreatmentStatus
  ): Promise<TreatmentPlan> {
    const plan = await this.storage.getTreatmentPlan(planId);
    if (!plan) throw new HealthcareError('NOT_FOUND', `Treatment plan ${planId} not found`);

    const allowed = ALLOWED_TRANSITIONS[plan.status];
    if (!allowed.includes(newStatus)) {
      throw new HealthcareError(
        'INVALID_STATE',
        `Cannot transition from '${plan.status}' to '${newStatus}'. ` +
          `Allowed: [${allowed.join(', ') || 'none'}]`
      );
    }

    await this.storage.updateTreatmentPlan(planId, { status: newStatus });
    return { ...plan, status: newStatus, updatedAt: new Date() };
  }

  /**
   * Determine doctorAction by comparing doctor protocol names to AI suggestions.
   *
   *  • All doctor treatments found in AI list (regardless of session edits) → 'approved_ai'
   *  • Some overlap                                                          → 'modified'
   *  • Zero overlap                                                          → 'custom'
   */
  private detectDoctorAction(
    protocol: ProtocolEntry[],
    aiTreatmentNames: string[]
  ): DoctorAction {
    if (aiTreatmentNames.length === 0) return 'custom';

    const doctorNames = new Set(protocol.map((p) => p.treatment.toLowerCase().trim()));
    const aiNames = new Set(aiTreatmentNames.map((n) => n.toLowerCase().trim()));

    const overlap = [...doctorNames].filter((n) => aiNames.has(n));

    if (overlap.length === doctorNames.size && overlap.length === aiNames.size) {
      return 'approved_ai';
    }
    if (overlap.length > 0) {
      return 'modified';
    }
    return 'custom';
  }

  private validatePlanInput(input: CreateTreatmentPlanInput): void {
    if (!input.scanId) throw new HealthcareError('INVALID_INPUT', 'scanId is required');
    if (!input.doctorId) throw new HealthcareError('INVALID_INPUT', 'doctorId is required');
    if (!input.protocol || input.protocol.length === 0) {
      throw new HealthcareError('INVALID_INPUT', 'protocol must contain at least one entry');
    }
    for (const entry of input.protocol) {
      if (!entry.treatment) {
        throw new HealthcareError('INVALID_INPUT', 'Each protocol entry must have a treatment name');
      }
      if (!entry.sessions || entry.sessions < 1) {
        throw new HealthcareError(
          'INVALID_INPUT',
          `Protocol entry '${entry.treatment}' must have sessions ≥ 1`
        );
      }
    }
  }
}
