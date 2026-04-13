"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProtocol = exports.listTreatments = exports.calculatePlan = void 0;
const pricing_1 = require("../services/pricing");
const treatments_1 = require("../config/treatments");
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
function calculatePlan(req, res) {
    const { protocol } = req.body;
    if (!Array.isArray(protocol) || protocol.length === 0) {
        res.status(400).json({
            error: 'protocol must be a non-empty array of treatment entries.',
        });
        return;
    }
    try {
        const result = (0, pricing_1.calculateTreatmentPlan)(protocol);
        // Business Rule: ALWAYS strip platformFee and doctorEarning from any API response
        const safeBreakdown = result.breakdown.map((_a) => {
            var { doctorEarning, platformFee } = _a, rest = __rest(_a, ["doctorEarning", "platformFee"]);
            return rest;
        });
        res.json({
            breakdown: safeBreakdown,
            subtotal: result.subtotal,
            consultationDeduction: result.consultationDeduction,
            finalPayable: result.finalPayable,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(422).json({ error: message });
    }
}
exports.calculatePlan = calculatePlan;
/**
 * GET /dental/treatments
 *
 * Returns the full treatment catalogue.
 * Useful for populating the doctor's treatment selector in the app.
 */
function listTreatments(_req, res) {
    const catalogue = Object.entries(treatments_1.TREATMENTS).map(([key, config]) => ({
        key,
        displayName: config.name,
        category: config.category,
    }));
    res.json({ catalogue });
}
exports.listTreatments = listTreatments;
/**
 * POST /dental/validate-protocol
 *
 * Validates a protocol without calculating prices.
 * Returns which treatments are valid / invalid.
 * Useful for client-side pre-submission checks.
 */
function validateProtocol(req, res) {
    const { protocol } = req.body;
    if (!Array.isArray(protocol)) {
        res.status(400).json({ error: 'protocol must be an array.' });
        return;
    }
    const results = protocol.map((entry) => {
        var _a;
        if ('isCustom' in entry && entry.isCustom) {
            const valid = Boolean((_a = entry.name) === null || _a === void 0 ? void 0 : _a.trim()) && typeof entry.price === 'number' && entry.price >= 0;
            return {
                input: entry,
                valid,
                error: valid ? null : 'Custom treatment requires a non-empty name and a non-negative price.',
            };
        }
        const key = entry.treatment;
        const found = key in treatments_1.TREATMENTS;
        return {
            input: entry,
            valid: found,
            error: found ? null : `Unknown treatment key: "${key}"`,
        };
    });
    const allValid = results.every((r) => r.valid);
    res.status(allValid ? 200 : 422).json({ valid: allValid, results });
}
exports.validateProtocol = validateProtocol;
//# sourceMappingURL=treatmentController.js.map