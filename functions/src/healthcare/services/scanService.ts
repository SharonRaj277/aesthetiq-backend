import { v4 as uuid } from 'uuid';
import { ScanReport, CreateScanReportInput, HealthcareError } from '../types';
import { IHealthcareStorage } from '../storage/interface';
import { generateAISuggestions } from '../ai/scanAnalysis';

// ─────────────────────────────────────────────────────────────────────────────
// ScanService
// ────────────
// Handles the creation of scan reports and AI suggestion generation.
// Storage-agnostic: works with any IHealthcareStorage implementation.
// ─────────────────────────────────────────────────────────────────────────────

export class ScanService {
  constructor(private readonly storage: IHealthcareStorage) {}

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
  async createScanReport(input: CreateScanReportInput): Promise<ScanReport> {
    if (!input.patientId) {
      throw new HealthcareError('INVALID_INPUT', 'patientId is required');
    }
    if (!input.findings?.issues || input.findings.issues.length === 0) {
      throw new HealthcareError('INVALID_INPUT', 'findings.issues must contain at least one issue');
    }

    const now = new Date();
    const report: ScanReport = {
      id: uuid(),
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
      const suggestions = await generateAISuggestions(input.category, input.findings);

      await this.storage.updateScanReport(report.id, {
        aiSuggestions: suggestions,
        status: 'ai_suggested',
      });

      return { ...report, aiSuggestions: suggestions, status: 'ai_suggested' };
    } catch (err) {
      console.error(`[ScanService] AI generation failed for scan ${report.id}:`, err);

      await this.storage.updateScanReport(report.id, { status: 'ai_failed' });

      // Re-throw a typed error so callers can handle it distinctly
      throw new HealthcareError(
        'AI_FAILED',
        `AI suggestion generation failed: ${String(err)}`
      );
    }
  }

  // ─────────────────────────────────────────
  // getScanReport
  // ─────────────────────────────────────────

  async getScanReport(scanId: string): Promise<ScanReport> {
    const report = await this.storage.getScanReport(scanId);
    if (!report) throw new HealthcareError('NOT_FOUND', `Scan report ${scanId} not found`);
    return report;
  }
}
