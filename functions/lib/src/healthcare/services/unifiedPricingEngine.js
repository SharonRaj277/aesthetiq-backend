"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateUnifiedPlan = calculateUnifiedPlan;
const treatments_1 = require("../config/treatments");
const treatments_2 = require("../../skin/config/treatments");
const treatments_3 = require("../../dental/config/treatments");
const PLATFORM_FEE_RATE = 0.18;
const DOCTOR_FEE_RATE = 0.82;
const CONSULTATION_DEDUCTION = 1000;
function calculateUnifiedPlan(inputs) {
    var _a;
    if (!inputs || inputs.length === 0) {
        throw new Error('At least one treatment must be provided.');
    }
    const breakdown = [];
    let needsScalingFree = false;
    let alreadyHasScaling = false;
    for (const input of inputs) {
        // 1. Validation
        if (!input.purpose || input.purpose.trim() === '') {
            throw new Error(`Purpose is REQUIRED for all treatments. Missing on: ${input.treatment || input.name}`);
        }
        const isCustom = !!input.isCustom;
        let sessions = Math.max(1, input.sessions || 1);
        // Sessions ONLY apply to skin
        if (input.domain === 'dental' || input.domain === 'facial') {
            sessions = 1;
        }
        let pricePerSession = 0;
        let name = '';
        let displayName = '';
        let category = 'Custom';
        // 2. Price Fetch
        if (isCustom) {
            if (!input.name)
                throw new Error('Custom treatments require a name.');
            if (typeof input.price !== 'number' || input.price <= 0) {
                throw new Error('Custom treatments must have a price > 0.');
            }
            name = input.name;
            displayName = input.name;
            pricePerSession = input.price;
            category = 'Custom';
        }
        else {
            if (!input.treatment)
                throw new Error('Predefined treatments require a treatment identifier.');
            let found = false;
            if (input.domain === 'skin') {
                const t = treatments_2.SKIN_TREATMENTS.find(t => t.sku === input.treatment || t.name === input.treatment || t.displayName === input.treatment);
                if (t) {
                    pricePerSession = t.price;
                    name = t.name;
                    displayName = t.displayName;
                    category = t.category;
                    found = true;
                }
            }
            else if (input.domain === 'facial') {
                const t = treatments_1.FACIAL_TREATMENTS.find(t => t.id.toString() === input.treatment || t.name === input.treatment);
                if (t) {
                    pricePerSession = t.price;
                    name = t.name;
                    displayName = t.displayName;
                    category = t.category;
                    found = true;
                }
            }
            else if (input.domain === 'dental') {
                const tKey = Object.keys(treatments_3.TREATMENTS).find(k => k === input.treatment || treatments_3.TREATMENTS[k].name === input.treatment);
                if (tKey) {
                    const t = treatments_3.TREATMENTS[tKey];
                    pricePerSession = t.price;
                    name = tKey; // Unique ID key
                    displayName = t.name;
                    category = t.category;
                    if ((_a = t.protocol) === null || _a === void 0 ? void 0 : _a.includes('scaling_free')) {
                        needsScalingFree = true;
                    }
                    if (tKey === 'Scaling_Polishing')
                        alreadyHasScaling = true;
                    found = true;
                }
            }
            if (!found) {
                throw new Error(`Treatment '${input.treatment}' not found in domain '${input.domain}'`);
            }
        }
        // fallback mapping if they just typed "Scaling & Polishing" as custom
        if (name === 'Scaling_Polishing' || name === 'Scaling & Polishing')
            alreadyHasScaling = true;
        // 3. Domain-Based Pricing
        const totalPrice = (input.domain === 'skin')
            ? pricePerSession * sessions
            : pricePerSession;
        // 4. Commission (Apply to all)
        const platformFee = Math.round(totalPrice * PLATFORM_FEE_RATE);
        const doctorEarning = Math.round(totalPrice * DOCTOR_FEE_RATE);
        breakdown.push({
            domain: input.domain,
            name,
            displayName,
            category,
            sessions,
            pricePerSession,
            totalPrice,
            purpose: input.purpose,
            isCustom,
            isComplimentary: false,
            platformFee,
            doctorEarning,
        });
    }
    // 5. Dental Protocol (Auto Add)
    // Or check explicitly for RCT/Crown/Filling in category or name if protocol flag wasn't perfectly caught
    if (!needsScalingFree) {
        const triggers = ['RCT', 'Crown', 'Filling', 'Endodontics', 'Restorative', 'Prosthodontics'];
        needsScalingFree = breakdown.some(b => b.domain === 'dental' &&
            triggers.some(t => b.displayName.toLowerCase().includes(t.toLowerCase()) || b.category.toLowerCase().includes(t.toLowerCase())));
    }
    if (needsScalingFree && !alreadyHasScaling) {
        breakdown.push({
            name: 'Scaling_Polishing',
            displayName: 'Scaling & Polishing',
            domain: 'dental',
            category: 'General Dentistry',
            sessions: 1,
            pricePerSession: 1999,
            totalPrice: 0,
            purpose: 'Standard clinical prep & hygiene protocol',
            isCustom: false,
            isComplimentary: true,
            platformFee: 0,
            doctorEarning: 0,
        });
    }
    // 6. Subtotal & Consultation Deduction
    const totalBeforeDeduction = breakdown.reduce((acc, curr) => acc + curr.totalPrice, 0);
    // ALWAYS subtract 1000 according to prompt ONCE per plan
    const finalPayable = Math.max(0, totalBeforeDeduction - CONSULTATION_DEDUCTION);
    const totalDoctorEarning = breakdown.reduce((acc, curr) => acc + curr.doctorEarning, 0);
    const totalPlatformFee = breakdown.reduce((acc, curr) => acc + curr.platformFee, 0);
    // 7. Response Format
    return {
        breakdown,
        totalBeforeDeduction,
        consultationDeduction: CONSULTATION_DEDUCTION,
        finalPayable,
        totalDoctorEarning,
        totalPlatformFee
    };
}
//# sourceMappingURL=unifiedPricingEngine.js.map