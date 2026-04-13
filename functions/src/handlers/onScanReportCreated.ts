import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { ScanReport } from '../types/treatment';
import { generateAISuggestions } from '../ai/treatmentAI';

/**
 * onScanReportCreated
 * ────────────────────
 * Firestore trigger: fires when a new document is created in `scanReports`.
 *
 * Flow:
 *  1. Guard — only process documents with status === 'pending_ai'.
 *  2. Call Claude to generate ranked treatment suggestions.
 *  3. Update the document: aiSuggestions + status = 'ai_suggested'.
 *  4. On failure: set status = 'ai_failed' for retry visibility.
 */
export const onScanReportCreated = functions
  .runWith({
    timeoutSeconds: 60,
    memory: '512MB',
    secrets: ['ANTHROPIC_API_KEY'],
  })
  .firestore.document('scanReports/{scanId}')
  .onCreate(async (snap, context) => {
    const scanId = context.params.scanId;
    const report: ScanReport = { id: scanId, ...snap.data() } as ScanReport;

    if (report.status !== 'pending_ai') {
      console.log(`[onScanReportCreated] Skipping ${scanId} — status: ${report.status}`);
      return;
    }

    console.log(`[onScanReportCreated] Generating AI suggestions for scan ${scanId}`);

    try {
      const suggestions = await generateAISuggestions(report.results);

      await snap.ref.update({
        aiSuggestions: suggestions,
        status: 'ai_suggested',
        aiGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(
        `[onScanReportCreated] ${suggestions.length} suggestions generated for ${scanId}:`,
        suggestions.map((s) => `${s.name} (${s.matchPercentage}%)`)
      );
    } catch (err) {
      console.error(`[onScanReportCreated] AI generation failed for ${scanId}:`, err);

      await snap.ref.update({
        status: 'ai_failed',
        aiError: String(err),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });
