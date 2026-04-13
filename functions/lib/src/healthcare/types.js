"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// AesthetiQ Healthcare — Core Data Models
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthcareError = void 0;
// ─────────────────────────────────────────
// SERVICE ERRORS
// ─────────────────────────────────────────
class HealthcareError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'HealthcareError';
    }
}
exports.HealthcareError = HealthcareError;
//# sourceMappingURL=types.js.map