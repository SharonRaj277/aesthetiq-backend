"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onScanReportCreated = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const treatmentAI_1 = require("../ai/treatmentAI");
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
exports.onScanReportCreated = functions
    .runWith({
    timeoutSeconds: 60,
    memory: '512MB',
    secrets: ['ANTHROPIC_API_KEY'],
})
    .firestore.document('scanReports/{scanId}')
    .onCreate(async (snap, context) => {
    const scanId = context.params.scanId;
    const report = Object.assign({ id: scanId }, snap.data());
    if (report.status !== 'pending_ai') {
        console.log(`[onScanReportCreated] Skipping ${scanId} — status: ${report.status}`);
        return;
    }
    console.log(`[onScanReportCreated] Generating AI suggestions for scan ${scanId}`);
    try {
        const suggestions = await (0, treatmentAI_1.generateAISuggestions)(report.results);
        await snap.ref.update({
            aiSuggestions: suggestions,
            status: 'ai_suggested',
            aiGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[onScanReportCreated] ${suggestions.length} suggestions generated for ${scanId}:`, suggestions.map((s) => `${s.name} (${s.matchPercentage}%)`));
    }
    catch (err) {
        console.error(`[onScanReportCreated] AI generation failed for ${scanId}:`, err);
        await snap.ref.update({
            status: 'ai_failed',
            aiError: String(err),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
});
//# sourceMappingURL=onScanReportCreated.js.map