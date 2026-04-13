import { Request, Response } from 'express';
import { calculateTreatmentPlan, ProtocolEntry } from '../services/pricing';
import { TREATMENTS } from '../config/treatments';

// ─────────────────────────────────────────────────────────────────────────────
// TreatmentController
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /dental/calculate
 *
 * Body:
 * {
 *   protocol: [
 *     { treatment: "RCT_Molar", sessions: 1 },
 *     { treatment: "Zirconia", sessions: 1 },
 *     { isCustom: true, name: "Night Guard", price: 4500 }
 *   ],
 *   viewAs?: "patient" | "admin"   // defaults to "patient"
 * }
 *
 * Response (patient view):
 *   breakdown without doctorEarning / platformFee
 *
 * Response (admin view):
 *   full breakdown including commission split
 */
export function calculatePlan(req: Request, res: Response): void {
  const { protocol } = req.body as {
    protocol: ProtocolEntry[];
  };

  if (!Array.isArray(protocol) || protocol.length === 0) {
    res.status(400).json({
      error: 'protocol must be a non-empty array of treatment entries.',
    });
    return;
  }

  try {
    const result = calculateTreatmentPlan(protocol);

    // Business Rule: ALWAYS strip platformFee and doctorEarning from any API response
    const safeBreakdown = result.breakdown.map(({ doctorEarning, platformFee, ...rest }) => rest);

    res.json({
      breakdown: safeBreakdown,
      subtotal: result.subtotal,
      consultationDeduction: result.consultationDeduction,
      finalPayable: result.finalPayable,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(422).json({ error: message });
  }
}

/**
 * GET /dental/treatments
 *
 * Returns the full treatment catalogue.
 * Useful for populating the doctor's treatment selector in the app.
 */
export function listTreatments(_req: Request, res: Response): void {
  const catalogue = Object.entries(TREATMENTS).map(([key, config]) => ({
    key,
    displayName: config.name,
    category: config.category,
  }));

  res.json({ catalogue });
}

/**
 * POST /dental/validate-protocol
 *
 * Validates a protocol without calculating prices.
 * Returns which treatments are valid / invalid.
 * Useful for client-side pre-submission checks.
 */
export function validateProtocol(req: Request, res: Response): void {
  const { protocol } = req.body as { protocol: ProtocolEntry[] };

  if (!Array.isArray(protocol)) {
    res.status(400).json({ error: 'protocol must be an array.' });
    return;
  }

  const results = protocol.map((entry) => {
    if ('isCustom' in entry && entry.isCustom) {
      const valid = Boolean(entry.name?.trim()) && typeof entry.price === 'number' && entry.price >= 0;
      return {
        input: entry,
        valid,
        error: valid ? null : 'Custom treatment requires a non-empty name and a non-negative price.',
      };
    }

    const key = (entry as { treatment: string }).treatment;
    const found = key in TREATMENTS;
    return {
      input: entry,
      valid: found,
      error: found ? null : `Unknown treatment key: "${key}"`,
    };
  });

  const allValid = results.every((r) => r.valid);
  res.status(allValid ? 200 : 422).json({ valid: allValid, results });
}
