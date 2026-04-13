// ─────────────────────────────────────────────────────────────────────────────
// AesthetiQ Dental Module — Public API
// ─────────────────────────────────────────────────────────────────────────────

export { TREATMENTS, COMPLIMENTARY_SCALING_TRIGGERS, PLATFORM_COMMISSION_RATE } from './config/treatments';
export type { TreatmentConfig, TreatmentCategory } from './config/treatments';

export { calculateTreatmentPlan } from './services/pricing';
export type { ProtocolEntry, CatalogueEntry, CustomEntry, PricingLineItem, TreatmentPlanResult } from './services/pricing';

export { default as dentalApp } from './app';
