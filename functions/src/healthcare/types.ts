// ─────────────────────────────────────────────────────────────────────────────
// AesthetiQ Healthcare — Core Data Models
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────
// SHARED
// ─────────────────────────────────────────

export type ScanCategory = 'skin' | 'dental' | 'facial';

export type Severity = 'low' | 'medium' | 'high';

// ─────────────────────────────────────────
// SCAN REPORT
// ─────────────────────────────────────────

export interface ScanFindings {
  issues: string[];
  severity: Severity;
}

export interface AISuggestion {
  treatment: string;
  matchPercentage: number;   // 0 – 100
  rationale: string;         // why this treatment was chosen
  recommendedSessions: number;
  frequency?: string;        // e.g. "weekly", "bi-weekly"
}

export type ScanReportStatus = 'pending_ai' | 'ai_suggested' | 'ai_failed' | 'plan_created';

export interface ScanReport {
  id: string;
  patientId: string;
  category: ScanCategory;
  findings: ScanFindings;
  aiSuggestions: AISuggestion[];
  treatmentPlanId?: string;
  status: ScanReportStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────
// TREATMENT PLAN
// ─────────────────────────────────────────

export type DoctorAction = 'approved_ai' | 'modified' | 'custom';

export type TreatmentStatus =
  | 'ai_suggested'
  | 'doctor_created'
  | 'accepted'
  | 'in_progress'
  | 'completed';

export interface ProtocolEntry {
  treatment: string;
  name?: string;
  isCustom?: boolean;
  purpose: string; // Required per business rules
  sessions: number;
  frequency?: string;
  notes?: string;
  pricePerSession?: number;
  totalPrice?: number;
  platformFee?: number;
  doctorEarning?: number;
  isComplimentary?: boolean;
}

export interface PricingSummary {
  totalBeforeDeduction: number;
  consultationDeduction: number;
  finalPayable: number;
  totalDoctorEarning: number;
  totalPlatformFee: number;
}

export interface Medication {
  name: string;
  dosage: string;
  instructions: string;
}

export interface TreatmentPlan {
  id: string;
  patientId: string;
  doctorId: string;
  scanId: string;
  category: ScanCategory;

  aiSuggestions: AISuggestion[];   // original AI output — always stored
  doctorAction: DoctorAction;
  protocol: ProtocolEntry[];

  medications: Medication[];
  labTests: string[];
  notes: string;

  pricing?: PricingSummary;

  status: TreatmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────
// SESSION TRACKER
// ─────────────────────────────────────────

export interface SessionEntry {
  treatment: string;
  totalSessions: number;
  completedSessions: number;
}

export interface SessionTracker {
  id: string;           // same as planId
  planId: string;
  patientId: string;
  sessions: SessionEntry[];
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────
// INPUT SHAPES
// ─────────────────────────────────────────

export interface CreateScanReportInput {
  patientId: string;
  category: ScanCategory;
  findings: ScanFindings;
}

export interface CreateTreatmentPlanInput {
  scanId: string;
  doctorId: string;
  protocol: ProtocolEntry[];
  medications?: Medication[];
  labTests?: string[];
  notes?: string;
}

export interface CompleteSessionInput {
  planId: string;
  treatment: string;
}

// ─────────────────────────────────────────
// SERVICE ERRORS
// ─────────────────────────────────────────

export class HealthcareError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'INVALID_STATE'
      | 'PERMISSION_DENIED'
      | 'INVALID_INPUT'
      | 'AI_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'HealthcareError';
  }
}
