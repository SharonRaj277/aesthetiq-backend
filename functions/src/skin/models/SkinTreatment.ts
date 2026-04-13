export type SkinTreatmentCategory = 
  | 'Skin Glow Therapy'
  | 'Acne Control Therapy'
  | 'Pigmentation Correction'
  | 'Anti-Aging Therapy'
  | 'Deep Skin Repair'
  | 'Skin Tightening Therapy'
  | 'Laser Hair Reduction'
  | 'Advanced Skin Therapies'
  | 'Hair Restoration';

export type SkinTreatmentTier = 'Entry' | 'Core' | 'Premium' | 'Signature' | 'Surgical';

export interface SkinTreatmentCatalogueItem {
  id: number;
  sku: string;
  name: string;
  displayName: string;
  category: SkinTreatmentCategory;
  subCategory: string;
  procedureType: string;
  tier: SkinTreatmentTier;
  price: number; // in INR
  description: string;
}
