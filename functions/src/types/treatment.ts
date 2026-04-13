import * as admin from 'firebase-admin';

// ─────────────────────────────────────────
// SCAN RESULTS
// Each field is a severity / score on a 0–10 scale.
// ─────────────────────────────────────────

export interface ScanResults {
  acne?: number;          // 0–10  (higher = more severe)
  pigmentation?: number;  // 0–10
  hydration?: number;     // 0–10  (0 = severely dry, 10 = well-hydrated)
  wrinkles?: number;      // 0–10
  sensitivity?: number;   // 0–10
  pores?: number;         // 0–10  (pore visibility)
  oiliness?: number;      // 0–10
  darkCircles?: number;   // 0–10
  scarring?: number;      // 0–10
  redness?: number;       // 0–10
  [key: string]: number | undefined;
}

// ─────────────────────────────────────────
// AI SUGGESTION
// ─────────────────────────────────────────

export interface AISuggestion {
  name: string;
  matchPercentage: number;         // 0–100 relevance score
  category: string;                // acne | pigmentation | anti-aging | hydration | general
  estimatedSessions: number;
  estimatedPricePerSession: number; // USD
  rationale: string;               // why this treatment was chosen
}

// ─────────────────────────────────────────
// SCAN REPORT
// ─────────────────────────────────────────

export type ScanReportStatus = 'pending_ai' | 'ai_suggested' | 'ai_failed' | 'plan_created';

export interface ScanReport {
  id: string;
  patientId: string;
  doctorId?: string;
  imageUrl?: string;
  results: ScanResults;
  aiSuggestions: AISuggestion[];
  treatmentPlanId?: string;
  status: ScanReportStatus;
  aiGeneratedAt?: admin.firestore.Timestamp;
  aiError?: string;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

// ─────────────────────────────────────────
// TREATMENT PLAN
// ─────────────────────────────────────────

export interface Treatment {
  name: string;
  sessions: number;
  pricePerSession: number;   // USD
  totalPrice: number;        // sessions × pricePerSession
  source: 'AI' | 'Doctor';
  category?: string;
  description?: string;
}

export interface Medication {
  name: string;
  dosage: string;
  instructions: string;
  duration?: string;
  frequency?: string;
}

export type DoctorAction = 'approved_ai' | 'modified' | 'custom';

export type TreatmentStatus =
  | 'ai_suggested'
  | 'doctor_approved'
  | 'doctor_modified'
  | 'doctor_defined'
  | 'active'
  | 'completed';

export interface TreatmentPlan {
  id: string;
  patientId: string;
  doctorId: string;
  scanId: string;

  // Both always stored — full audit trail
  aiSuggestions: AISuggestion[];
  doctorAction: DoctorAction;
  finalTreatments: Treatment[];

  medications: Medication[];
  labTests: string[];
  notes: string;

  totalCost: number;
  status: TreatmentStatus;

  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

// ─────────────────────────────────────────
// CALLABLE INPUT SHAPES
// ─────────────────────────────────────────

export interface CreateTreatmentPlanInput {
  scanId: string;
  doctorAction: DoctorAction;
  /** Required for 'modified' and 'custom' actions */
  finalTreatments?: Omit<Treatment, 'totalPrice'>[];
  medications?: Medication[];
  labTests?: string[];
  notes?: string;
}

export interface GetTreatmentPlanInput {
  /** Fetch a specific plan by its document ID */
  planId?: string;
  /** Fetch latest plan(s) for a patient (defaults to current auth user) */
  patientId?: string;
  /** Return full history instead of just the latest plan */
  includeHistory?: boolean;
}
