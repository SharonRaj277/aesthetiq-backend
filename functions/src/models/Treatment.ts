export type TreatmentCategory =
  | 'Lip Enhancement'
  | 'Jawline & Chin Sculpting'
  | 'Nose Correction'
  | 'Under Eye & Midface'
  | 'Botox-Based Treatments'
  | 'Skin Boosters / Rejuvenation'
  | 'Thread Lift / Tightening'
  | 'HIFU / Non-Surgical Lift'
  | 'Full Face Harmony'
  | 'Combination Treatments';

export type TreatmentTier = 'Entry' | 'Core' | 'Premium' | 'Signature' | 'Surgical';
export type ProcedureType = 'non-surgical' | 'surgical';

export interface TreatmentCatalogueItem {
  id: number;
  name: string;
  displayName: string;
  category: TreatmentCategory;
  tier: TreatmentTier;
  price: number; // in INR
  procedureType: ProcedureType;
  sessions: string | number;
  description: string;
}
