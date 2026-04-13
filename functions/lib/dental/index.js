"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// AesthetiQ Dental Module — Public API
// ─────────────────────────────────────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dentalApp = exports.calculateTreatmentPlan = exports.PLATFORM_COMMISSION_RATE = exports.COMPLIMENTARY_SCALING_TRIGGERS = exports.TREATMENTS = void 0;
var treatments_1 = require("./config/treatments");
Object.defineProperty(exports, "TREATMENTS", { enumerable: true, get: function () { return treatments_1.TREATMENTS; } });
Object.defineProperty(exports, "COMPLIMENTARY_SCALING_TRIGGERS", { enumerable: true, get: function () { return treatments_1.COMPLIMENTARY_SCALING_TRIGGERS; } });
Object.defineProperty(exports, "PLATFORM_COMMISSION_RATE", { enumerable: true, get: function () { return treatments_1.PLATFORM_COMMISSION_RATE; } });
var pricing_1 = require("./services/pricing");
Object.defineProperty(exports, "calculateTreatmentPlan", { enumerable: true, get: function () { return pricing_1.calculateTreatmentPlan; } });
var app_1 = require("./app");
Object.defineProperty(exports, "dentalApp", { enumerable: true, get: function () { return __importDefault(app_1).default; } });
//# sourceMappingURL=index.js.map