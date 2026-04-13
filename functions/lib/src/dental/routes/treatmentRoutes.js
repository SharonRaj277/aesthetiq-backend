"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const treatmentController_1 = require("../controllers/treatmentController");
// ─────────────────────────────────────────────────────────────────────────────
// Dental Treatment Routes
// Mount at:  app.use('/dental', dentalRouter)
// ─────────────────────────────────────────────────────────────────────────────
const router = (0, express_1.Router)();
/**
 * GET  /dental/treatments
 * List the full treatment catalogue (keys + displayNames + categories).
 * Used by the doctor app to populate the treatment picker.
 */
router.get('/treatments', treatmentController_1.listTreatments);
/**
 * POST /dental/validate-protocol
 * Validate a protocol array without calculating prices.
 * Body: { protocol: ProtocolEntry[] }
 */
router.post('/validate-protocol', treatmentController_1.validateProtocol);
/**
 * POST /dental/calculate
 * Calculate the full pricing breakdown for a treatment protocol.
 * Body: { protocol: ProtocolEntry[] }
 *
 * NOTE: doctorEarning / platformFee are NEVER exposed to comply with business rules.
 */
router.post('/calculate', treatmentController_1.calculatePlan);
exports.default = router;
//# sourceMappingURL=treatmentRoutes.js.map