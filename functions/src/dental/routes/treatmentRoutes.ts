import { Router } from 'express';
import {
  calculatePlan,
  listTreatments,
  validateProtocol,
} from '../controllers/treatmentController';

// ─────────────────────────────────────────────────────────────────────────────
// Dental Treatment Routes
// Mount at:  app.use('/dental', dentalRouter)
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

/**
 * GET  /dental/treatments
 * List the full treatment catalogue (keys + displayNames + categories).
 * Used by the doctor app to populate the treatment picker.
 */
router.get('/treatments', listTreatments);

/**
 * POST /dental/validate-protocol
 * Validate a protocol array without calculating prices.
 * Body: { protocol: ProtocolEntry[] }
 */
router.post('/validate-protocol', validateProtocol);

/**
 * POST /dental/calculate
 * Calculate the full pricing breakdown for a treatment protocol.
 * Body: { protocol: ProtocolEntry[] }
 *
 * NOTE: doctorEarning / platformFee are NEVER exposed to comply with business rules.
 */
router.post('/calculate', calculatePlan);

export default router;
