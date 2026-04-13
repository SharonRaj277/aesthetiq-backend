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
exports.unifiedApiApp = void 0;
const express = require("express");
const cors = require('cors');
const unifiedPricingEngine_1 = require("../healthcare/services/unifiedPricingEngine");
const treatments_1 = require("../healthcare/config/treatments");
const treatments_2 = require("../skin/config/treatments");
const treatments_3 = require("../dental/config/treatments");
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
// ─────────────────────────────────────────
// GET /treatments?domain=...
// ─────────────────────────────────────────
app.get('/treatments', (req, res) => {
    try {
        const domain = req.query.domain;
        if (domain === 'facial') {
            return res.json({ success: true, catalogue: treatments_1.FACIAL_TREATMENTS, domain: 'facial' });
        }
        if (domain === 'skin') {
            return res.json({ success: true, catalogue: treatments_2.SKIN_TREATMENTS, domain: 'skin' });
        }
        if (domain === 'dental') {
            // Map the object to an array format for REST consumption
            const dentalArray = Object.entries(treatments_3.TREATMENTS).map(([key, value]) => (Object.assign({ id: key }, value)));
            return res.json({ success: true, catalogue: dentalArray, domain: 'dental' });
        }
        return res.status(400).json({
            success: false,
            error: 'Missing or invalid domain parameter. Use ?domain=facial|skin|dental'
        });
    }
    catch (error) {
        console.error('Error fetching treatments:', error);
        return res.status(500).json({ success: false, error: error.message || 'Internal error' });
    }
});
// ─────────────────────────────────────────
// POST /treatment-plan
// ─────────────────────────────────────────
app.post('/treatment-plan', (req, res) => {
    try {
        const inputs = req.body;
        if (!Array.isArray(inputs) || inputs.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid payload. Must be an array of treatments.'
            });
        }
        const planData = (0, unifiedPricingEngine_1.calculateUnifiedPlan)(inputs);
        const safeBreakdown = planData.breakdown.map((_a) => {
            var { platformFee, doctorEarning } = _a, rest = __rest(_a, ["platformFee", "doctorEarning"]);
            return rest;
        });
        const { totalPlatformFee, totalDoctorEarning } = planData, safePricing = __rest(planData, ["totalPlatformFee", "totalDoctorEarning"]);
        return res.json({
            success: true,
            data: {
                breakdown: safeBreakdown,
                totalBeforeDeduction: safePricing.totalBeforeDeduction,
                consultationDeduction: safePricing.consultationDeduction,
                finalPayable: safePricing.finalPayable
            }
        });
    }
    catch (error) {
        console.error('Error calculating treatment plan:', error);
        return res.status(400).json({ success: false, error: error.message || 'Calculation error' });
    }
});
exports.unifiedApiApp = app;
//# sourceMappingURL=index.js.map