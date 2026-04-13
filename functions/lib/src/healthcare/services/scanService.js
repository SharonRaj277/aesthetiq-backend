"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScanService = void 0;
const uuid_1 = require("uuid");
const types_1 = require("../types");
const scanAnalysis_1 = require("../ai/scanAnalysis");
// ─────────────────────────────────────────────────────────────────────────────
// ScanService
// ────────────
// Handles the creation of scan reports and AI suggestion generation.
// Storage-agnostic: works with any IHealthcareStorage implementation.
// ─────────────────────────────────────────────────────────────────────────────
class ScanService {
    constructor(storage) {
        this.storage = storage;
    }
    // ─────────────────────────────────────────
    // createScanReport
    // ─────────────────────────────────────────
    /**
     * 1. Persist a scan report with status = 'pending_ai'.
     * 2. Call Claude to generate AI treatment suggestions.
     * 3. Update the report — status = 'ai_suggested' on success, 'ai_failed' on error.
     * 4. Return the completed ScanReport.
     *
     * AI suggestions are advisory only and do not constrain the doctor.
     */
    async createScanReport(input) {
        var _a;
        if (!input.patientId) {
            throw new types_1.HealthcareError('INVALID_INPUT', 'patientId is required');
        }
        if (!((_a = input.findings) === null || _a === void 0 ? void 0 : _a.issues) || input.findings.issues.length === 0) {
            throw new types_1.HealthcareError('INVALID_INPUT', 'findings.issues must contain at least one issue');
        }
        const now = new Date();
        const report = {
            id: (0, uuid_1.v4)(),
            patientId: input.patientId,
            category: input.category,
            findings: {
                issues: input.findings.issues,
                severity: input.findings.severity,
            },
            aiSuggestions: [],
            status: 'pending_ai',
            createdAt: now,
            updatedAt: now,
        };
        // Persist early — so the record exists even if AI fails
        await this.storage.saveScanReport(report);
        // Generate AI suggestions
        try {
            const suggestions = await (0, scanAnalysis_1.generateAISuggestions)(input.category, input.findings);
            await this.storage.updateScanReport(report.id, {
                aiSuggestions: suggestions,
                status: 'ai_suggested',
            });
            return Object.assign(Object.assign({}, report), { aiSuggestions: suggestions, status: 'ai_suggested' });
        }
        catch (err) {
            console.error(`[ScanService] AI generation failed for scan ${report.id}:`, err);
            await this.storage.updateScanReport(report.id, { status: 'ai_failed' });
            // Re-throw a typed error so callers can handle it distinctly
            throw new types_1.HealthcareError('AI_FAILED', `AI suggestion generation failed: ${String(err)}`);
        }
    }
    // ─────────────────────────────────────────
    // getScanReport
    // ─────────────────────────────────────────
    async getScanReport(scanId) {
        const report = await this.storage.getScanReport(scanId);
        if (!report)
            throw new types_1.HealthcareError('NOT_FOUND', `Scan report ${scanId} not found`);
        return report;
    }
}
exports.ScanService = ScanService;
//# sourceMappingURL=scanService.js.map