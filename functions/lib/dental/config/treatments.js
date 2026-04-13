"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// AesthetiQ Dental — Treatment Catalogue
// ─────────────────────────────────────────────────────────────────────────────
// All prices in Indian Rupees (₹).
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCALING_PRICE = exports.SCALING_KEY = exports.CONSULTATION_DEDUCTION = exports.CONSULTATION_KEY = exports.PLATFORM_COMMISSION_RATE = exports.TREATMENTS = void 0;
exports.TREATMENTS = {
    // ── GENERAL DENTISTRY ───────────────────────────────────────────────────────
    Consultation: {
        name: 'Consultation',
        price: 1000,
        category: 'General Dentistry',
    },
    Scaling_Polishing: {
        name: 'Scaling & Polishing',
        price: 1999,
        category: 'General Dentistry',
    },
    Deep_Cleaning: {
        name: 'Deep Cleaning',
        price: 3999,
        category: 'General Dentistry',
    },
    Fluoride_Treatment: {
        name: 'Fluoride Treatment',
        price: 2499,
        category: 'General Dentistry',
    },
    // ── RESTORATIVE DENTISTRY ───────────────────────────────────────────────────
    GIC_Filling: {
        name: 'GIC Filling',
        price: 1499,
        category: 'Restorative Dentistry',
        protocol: ['scaling_free'],
    },
    Composite_Filling: {
        name: 'Composite Filling',
        price: 1999,
        category: 'Restorative Dentistry',
        protocol: ['scaling_free'],
    },
    Anterior_Midline_Correction: {
        name: 'Anterior Midline Correction (Composite)',
        price: 2999,
        category: 'Restorative Dentistry',
        protocol: ['scaling_free'],
    },
    // ── ENDODONTICS (RCT) ───────────────────────────────────────────────────────
    RCT_Anterior: {
        name: 'RCT (Anterior)',
        price: 5999,
        category: 'Endodontics',
        protocol: ['scaling_free', 'pain_management_free'],
    },
    RCT_Premolar: {
        name: 'RCT (Premolar)',
        price: 6999,
        category: 'Endodontics',
        protocol: ['scaling_free', 'pain_management_free'],
    },
    RCT_Molar: {
        name: 'RCT (Molar)',
        price: 8999,
        category: 'Endodontics',
        protocol: ['scaling_free', 'pain_management_free'],
    },
    // ── PROSTHODONTICS (CROWNS) ─────────────────────────────────────────────────
    Metal_Crown: {
        name: 'Metal Crown',
        price: 3999,
        category: 'Prosthodontics',
        protocol: ['scaling_free'],
    },
    PFM_Crown: {
        name: 'PFM Crown (5 yrs warranty)',
        price: 5999,
        category: 'Prosthodontics',
        protocol: ['scaling_free'],
    },
    DMLS_Crown: {
        name: 'DMLS Crown (10 yrs warranty)',
        price: 6999,
        category: 'Prosthodontics',
        protocol: ['scaling_free'],
    },
    Zirconia_Crown: {
        name: 'Zirconia Crown (10 yrs warranty)',
        price: 8999,
        category: 'Prosthodontics',
        protocol: ['scaling_free'],
    },
    Emax_Crown: {
        name: 'E-max Crown (10 yrs warranty)',
        price: 14999,
        category: 'Prosthodontics',
        protocol: ['scaling_free'],
    },
    // ── ORAL SURGERY ────────────────────────────────────────────────────────────
    Simple_Extraction: {
        name: 'Simple Extraction',
        price: 1999,
        category: 'Oral Surgery',
    },
    Wisdom_Tooth_Erupted: {
        name: 'Wisdom Tooth (Fully Erupted)',
        price: 2999,
        category: 'Oral Surgery',
    },
    Wisdom_Tooth_Partially_Impacted: {
        name: 'Wisdom Tooth (Partially Impacted)',
        price: 3999,
        category: 'Oral Surgery',
    },
    Fully_Impacted_Surgical_Extraction: {
        name: 'Fully Impacted Surgical Extraction',
        price: 6999,
        category: 'Oral Surgery',
    },
    // ── COSMETIC DENTISTRY ──────────────────────────────────────────────────────
    Teeth_Whitening: {
        name: 'Teeth Whitening',
        price: 6999,
        category: 'Cosmetic Dentistry',
    },
    Veneers: {
        name: 'Veneers (per tooth)',
        price: 8999,
        category: 'Cosmetic Dentistry',
    },
    Smile_Designing: {
        name: 'Smile Designing',
        price: 29999,
        category: 'Cosmetic Dentistry',
    },
    // ── IMPLANTOLOGY ────────────────────────────────────────────────────────────
    Osstem_Implant: {
        name: 'Osstem Implant',
        price: 34999,
        category: 'Implantology',
    },
    Nobel_Biocare_Implant: {
        name: 'Nobel Biocare Implant',
        price: 49999,
        category: 'Implantology',
    },
    Straumann_Implant: {
        name: 'Straumann Implant',
        price: 64999,
        category: 'Implantology',
    },
    Implant_Zirconia_Crown: {
        name: 'Zirconia Crown (on Implant)',
        price: 8999,
        category: 'Implantology',
    },
    Implant_Emax_Crown: {
        name: 'E-max Crown (on Implant)',
        price: 14999,
        category: 'Implantology',
    },
    // ── PERIODONTICS ────────────────────────────────────────────────────────────
    Deep_Cleaning_Curettage: {
        name: 'Deep Cleaning + Curettage',
        price: 4999,
        category: 'Periodontics',
    },
    Flap_Surgery: {
        name: 'Flap Surgery',
        price: 14999,
        category: 'Periodontics',
    },
    Gum_Contouring: {
        name: 'Gum Contouring',
        price: 6999,
        category: 'Periodontics',
    },
    // ── ORTHODONTICS ────────────────────────────────────────────────────────────
    Metal_Braces: {
        name: 'Metal Braces',
        price: 45000,
        category: 'Orthodontics',
    },
    Ceramic_Braces: {
        name: 'Ceramic Braces',
        price: 65000,
        category: 'Orthodontics',
    },
    Clear_Aligners: {
        name: 'Clear Aligners',
        price: 135000,
        category: 'Orthodontics',
    },
};
// ─────────────────────────────────────────
// SYSTEM LOGIC REQUIRED CONSTANTS
// ─────────────────────────────────────────
exports.PLATFORM_COMMISSION_RATE = 0.18;
exports.CONSULTATION_KEY = 'Consultation';
exports.CONSULTATION_DEDUCTION = 1000;
exports.SCALING_KEY = 'Scaling_Polishing';
exports.SCALING_PRICE = 1999;
//# sourceMappingURL=treatments.js.map