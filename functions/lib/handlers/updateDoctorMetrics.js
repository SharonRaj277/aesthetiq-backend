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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledMetricsRefresh = exports.updateDoctorMetrics = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = () => admin.firestore();
/**
 * updateDoctorMetrics (HTTP)
 * ──────────────────────────
 * Called by an admin or scheduled job to recompute doctor metrics
 * from stored doctorResponses history.
 *
 * POST /updateDoctorMetrics
 * Body: { doctorId?: string }  — omit to recompute ALL doctors.
 */
exports.updateDoctorMetrics = functions
    .runWith({ timeoutSeconds: 300, memory: '512MB' })
    .https.onRequest(async (req, res) => {
    var _a;
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    const { doctorId } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
    try {
        if (doctorId) {
            await recomputeForDoctor(doctorId);
            res.json({ success: true, doctorId });
        }
        else {
            const doctorsSnap = await db().collection('doctors').get();
            const ids = doctorsSnap.docs.map((d) => d.id);
            // Batch to avoid overwhelming Firestore
            for (let i = 0; i < ids.length; i += 10) {
                await Promise.all(ids.slice(i, i + 10).map(recomputeForDoctor));
            }
            res.json({ success: true, updated: ids.length });
        }
    }
    catch (err) {
        console.error('[updateDoctorMetrics]', err);
        res.status(500).json({ error: String(err) });
    }
});
// ─────────────────────────────────────────
// SCHEDULED METRICS REFRESH
// ─────────────────────────────────────────
/**
 * scheduledMetricsRefresh
 * ───────────────────────
 * Runs every night at midnight UTC to ensure all doctor metrics
 * are up-to-date for the next day's matching.
 */
exports.scheduledMetricsRefresh = functions
    .runWith({ timeoutSeconds: 540, memory: '512MB' })
    .pubsub.schedule('0 0 * * *')
    .timeZone('UTC')
    .onRun(async () => {
    console.log('[scheduledMetricsRefresh] Starting nightly metrics refresh');
    const doctorsSnap = await db().collection('doctors').get();
    const ids = doctorsSnap.docs.map((d) => d.id);
    for (let i = 0; i < ids.length; i += 10) {
        await Promise.all(ids.slice(i, i + 10).map(recomputeForDoctor));
    }
    console.log(`[scheduledMetricsRefresh] Refreshed ${ids.length} doctor records`);
    // Snapshot global analytics for reporting
    await snapshotDailyAnalytics();
});
// ─────────────────────────────────────────
// RECOMPUTE LOGIC
// ─────────────────────────────────────────
async function recomputeForDoctor(doctorId) {
    const responsesSnap = await db()
        .collection('doctorResponses')
        .where('doctorId', '==', doctorId)
        .get();
    if (responsesSnap.empty)
        return;
    const responses = responsesSnap.docs.map((d) => d.data());
    const total = responses.length;
    const accepted = responses.filter((r) => r.response === 'accepted').length;
    const declined = responses.filter((r) => r.response === 'declined').length;
    const timeout = responses.filter((r) => r.response === 'timeout').length;
    const acceptedResponses = responses.filter((r) => r.response === 'accepted' && typeof r.responseTime === 'number');
    const avgResponseTime = acceptedResponses.length > 0
        ? Math.round(acceptedResponses.reduce((sum, r) => sum + r.responseTime, 0) /
            acceptedResponses.length)
        : 120; // default 2 minutes if no data
    const acceptanceRate = total > 0 ? parseFloat((accepted / total).toFixed(2)) : 0;
    await db().collection('doctors').doc(doctorId).update({
        totalNotifications: total,
        acceptedCount: accepted,
        declinedCount: declined,
        timeoutCount: timeout,
        acceptanceRate,
        avgResponseTime,
        totalConsultations: accepted,
        metricsLastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[recompute] doctor=${doctorId} total=${total} accepted=${accepted} ` +
        `acceptanceRate=${acceptanceRate} avgResponse=${avgResponseTime}s`);
}
// ─────────────────────────────────────────
// DAILY ANALYTICS SNAPSHOT
// ─────────────────────────────────────────
async function snapshotDailyAnalytics() {
    const globalDoc = await db().collection('analytics').doc('global').get();
    if (!globalDoc.exists)
        return;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    await db().collection('analytics').doc(`daily_${today}`).set(Object.assign(Object.assign({}, globalDoc.data()), { snapshotDate: today, createdAt: admin.firestore.FieldValue.serverTimestamp() }));
}
//# sourceMappingURL=updateDoctorMetrics.js.map