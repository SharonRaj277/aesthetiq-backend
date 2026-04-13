import {
  TREATMENTS,
  PLATFORM_COMMISSION_RATE,
  CONSULTATION_KEY,
  CONSULTATION_DEDUCTION,
  SCALING_KEY,
  TreatmentCategory,
} from '../config/treatments';

// ─────────────────────────────────────────────────────────────────────────────
// INPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A catalogue treatment in the doctor's protocol */
export interface CatalogueEntry {
  treatment: string;   // key from TREATMENTS
  sessions?: number;   // defaults to 1
}

/** A custom treatment added by the doctor (not in catalogue) */
export interface CustomEntry {
  isCustom: true;
  name: string;
  price: number;
  sessions?: number;
}

export type ProtocolEntry = CatalogueEntry | CustomEntry;

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface PricingLineItem {
  key: string;
  displayName: string;
  sessions: number;
  unitPrice: number;         // price per session
  originalPrice: number;     // unitPrice × sessions (before any deduction)
  finalPrice: number;        // what patient pays
  isComplimentary: boolean;
  isCustom: boolean;
  isConsultation: boolean;
  doctorEarning: number;     // finalPrice × 0.82
  platformFee: number;       // finalPrice × 0.18
  category?: TreatmentCategory;
}

export interface TreatmentPlanResult {
  breakdown: PricingLineItem[];
  subtotal: number;            // sum before consultation deduction
  consultationDeduction: number;
  finalPayable: number;        // what patient owes
  totalDoctorEarning: number;
  totalPlatformFee: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateTreatmentPlan
 * ──────────────────────
 * Pure function — no side effects, no DB calls.
 * Deterministic given the same protocol input.
 *
 * Steps:
 *  1. Resolve each protocol entry → PricingLineItem.
 *  2. Check if complimentary Scaling or Pain Management should be added.
 *  3. Apply consultation deduction (once, floor at 0).
 *  4. Split every non-complimentary line into doctorEarning + platformFee.
 *
 * @param protocol  Doctor-defined list of treatments.
 * @returns         Full pricing breakdown + totals.
 * @throws          Error if an unknown treatment key is referenced.
 */
export function calculateTreatmentPlan(
  protocol: ProtocolEntry[]
): TreatmentPlanResult {
  if (!protocol || protocol.length === 0) {
    throw new Error('Protocol must contain at least one treatment.');
  }

  // ── Step 1: Resolve protocol entries ──────────────────────────────────────
  const lineItems: PricingLineItem[] = protocol.map((entry) =>
    resolveLine(entry)
  );

  // ── Step 2: Auto Protocols (Scaling & Pain Management) ────────────────────
  const alreadyHasScaling = lineItems.some(
    (l) => l.key === SCALING_KEY && !l.isCustom
  );

  const needsComplimentaryScaling =
    !alreadyHasScaling &&
    lineItems.some(
      (l) => {
        const config = !l.isCustom ? TREATMENTS[l.key] : null;
        return config && config.protocol && config.protocol.includes('scaling_free');
      }
    );

  if (needsComplimentaryScaling) {
    const scalingConfig = TREATMENTS[SCALING_KEY];
    lineItems.push({
      key: SCALING_KEY,
      displayName: 'Scaling & Polishing',
      sessions: 1,
      unitPrice: scalingConfig.price,
      originalPrice: scalingConfig.price,
      finalPrice: 0, // Complimentary
      isComplimentary: true,
      isCustom: false,
      isConsultation: false,
      doctorEarning: 0,
      platformFee: 0,
      category: scalingConfig.category,
    });
  }

  const alreadyHasPainManagement = lineItems.some(
    (l) => l.key === 'Pain_Management' && !l.isCustom
  );

  const needsPainManagement =
    !alreadyHasPainManagement &&
    lineItems.some(
      (l) => {
        const config = !l.isCustom ? TREATMENTS[l.key] : null;
        return config && config.protocol && config.protocol.includes('pain_management_free');
      }
    );

  if (needsPainManagement) {
    lineItems.push({
      key: 'Pain_Management',
      displayName: 'Post-treatment Pain Management',
      sessions: 1,
      unitPrice: 0,
      originalPrice: 0,
      finalPrice: 0,
      isComplimentary: true,
      isCustom: false,
      isConsultation: false,
      doctorEarning: 0,
      platformFee: 0,
      category: 'General Dentistry',
    });
  }

  // ── Step 3: Subtotal + Consultation deduction ────────────────────────────
  const subtotal = lineItems.reduce((sum, l) => sum + l.finalPrice, 0);

  const hasConsultation = lineItems.some((l) => l.isConsultation);
  const consultationDeduction = hasConsultation
    ? Math.min(CONSULTATION_DEDUCTION, subtotal)
    : 0;

  const finalPayable = Math.max(0, subtotal - consultationDeduction);

  // ── Step 4: Commission split (on finalPrice, not originalPrice) ───────────
  // We scale down each non-complimentary line proportionally if a consultation
  // deduction was applied, so the split is always accurate.
  const deductionRatio =
    subtotal > 0 ? finalPayable / subtotal : 1;

  const breakdown: PricingLineItem[] = lineItems.map((item) => {
    if (item.isComplimentary) return item;   // 0 earning / 0 fee already set

    const effectivePrice = round2(item.finalPrice * deductionRatio);
    return {
      ...item,
      doctorEarning: round2(effectivePrice * (1 - PLATFORM_COMMISSION_RATE)),
      platformFee: round2(effectivePrice * PLATFORM_COMMISSION_RATE),
    };
  });

  const totalDoctorEarning = breakdown.reduce((s, l) => s + l.doctorEarning, 0);
  const totalPlatformFee = breakdown.reduce((s, l) => s + l.platformFee, 0);

  return {
    breakdown,
    subtotal,
    consultationDeduction,
    finalPayable,
    totalDoctorEarning: round2(totalDoctorEarning),
    totalPlatformFee: round2(totalPlatformFee),
  };
}

// ─────────────────────────────────────────
// RESOLVE A SINGLE LINE ITEM
// ─────────────────────────────────────────

function resolveLine(entry: ProtocolEntry): PricingLineItem {
  // Custom treatment
  if ('isCustom' in entry && entry.isCustom) {
    if (!entry.name || entry.name.trim() === '') {
      throw new Error('Custom treatment must have a name.');
    }
    if (typeof entry.price !== 'number' || entry.price < 0) {
      throw new Error(`Custom treatment "${entry.name}" must have a non-negative price.`);
    }
    const sessions = Math.max(1, entry.sessions ?? 1);
    const originalPrice = entry.price * sessions;
    return {
      key: 'custom',
      displayName: entry.name.trim(),
      sessions,
      unitPrice: entry.price,
      originalPrice,
      finalPrice: originalPrice,
      isComplimentary: false,
      isCustom: true,
      isConsultation: false,
      doctorEarning: round2(originalPrice * (1 - PLATFORM_COMMISSION_RATE)),
      platformFee: round2(originalPrice * PLATFORM_COMMISSION_RATE),
    };
  }

  // Catalogue treatment
  const key = (entry as CatalogueEntry).treatment;
  const config = TREATMENTS[key];

  if (!config) {
    throw new Error(
      `Unknown treatment key: "${key}". ` +
        `Valid keys: ${Object.keys(TREATMENTS).join(', ')}`
    );
  }

  const sessions = Math.max(1, (entry as CatalogueEntry).sessions ?? 1);
  const originalPrice = config.price * sessions;
  const isConsultation = key === CONSULTATION_KEY;

  return {
    key,
    displayName: config.name,
    sessions,
    unitPrice: config.price,
    originalPrice,
    finalPrice: originalPrice,
    isComplimentary: false,
    isCustom: false,
    isConsultation,
    doctorEarning: round2(originalPrice * (1 - PLATFORM_COMMISSION_RATE)),
    platformFee: round2(originalPrice * PLATFORM_COMMISSION_RATE),
    category: config.category,
  };
}

// ─────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
