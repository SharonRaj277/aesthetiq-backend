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
exports.getTreatmentCatalogue = exports.getSessionProgress = exports.completeSession = exports.updateTreatmentStatus = exports.acceptTreatmentPlan = exports.getTreatmentPlan = exports.createTreatmentPlan = exports.createScanReport = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const healthcare_1 = require("../healthcare");
// ─────────────────────────────────────────────────────────────────────────────
// Healthcare Firebase Callable Functions
//
// All callables are authenticated. Access rules:
//   createScanReport       — any authenticated user (patient or doctor)
//   createTreatmentPlan    — active doctors only
//   getTreatmentPlan       — patient (own plans) | doctor (their patients) | admin
//   acceptTreatmentPlan    — patient (own plan)
//   updateTreatmentStatus  — doctor (own plans) | admin
//   completeSession        — doctor (own plans) | admin
//   getSessionProgress     — patient (own plan) | doctor | admin
//   getTreatmentCatalogue  — any authenticated user
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────
// GUARD HELPERS
// ─────────────────────────────────────────
function requireAuth(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    return context.auth.uid;
}
/** Map HealthcareError codes → Firebase HttpsError codes. */
function toHttpsError(err) {
    var _a;
    if (err instanceof healthcare_1.HealthcareError) {
        const codeMap = {
            NOT_FOUND: 'not-found',
            INVALID_STATE: 'failed-precondition',
            PERMISSION_DENIED: 'permission-denied',
            INVALID_INPUT: 'invalid-argument',
            AI_FAILED: 'internal',
        };
        throw new functions.https.HttpsError((_a = codeMap[err.code]) !== null && _a !== void 0 ? _a : 'internal', err.message);
    }
    throw new functions.https.HttpsError('internal', String(err));
}
// ─────────────────────────────────────────
// 1. createScanReport
// ─────────────────────────────────────────
exports.createScanReport = functions
    .runWith({
    timeoutSeconds: 60,
    memory: '512MB',
    secrets: ['ANTHROPIC_API_KEY'],
})
    .https.onCall(async (data, context) => {
    requireAuth(context);
    try {
        const report = await (0, healthcare_1.getScanService)().createScanReport(data);
        return {
            success: true,
            scanId: report.id,
            status: report.status,
            suggestionsCount: report.aiSuggestions.length,
            aiSuggestions: report.aiSuggestions,
            findings: report.findings,
            category: report.category,
            createdAt: report.createdAt.toISOString(),
        };
    }
    catch (err) {
        toHttpsError(err);
    }
});
// ─────────────────────────────────────────
// 2. createTreatmentPlan
// ─────────────────────────────────────────
exports.createTreatmentPlan = functions
    .runWith({ timeoutSeconds: 30, memory: '256MB' })
    .https.onCall(async (data, context) => {
    const callerId = requireAuth(context);
    // Doctor must be the one creating the plan
    if (data.doctorId !== callerId) {
        throw new functions.https.HttpsError('permission-denied', 'doctorId must match the authenticated caller');
    }
    try {
        const plan = await (0, healthcare_1.getTreatmentService)().createTreatmentPlan(data);
        return Object.assign({ success: true }, serialisePlan(plan));
    }
    catch (err) {
        toHttpsError(err);
    }
});
// ─────────────────────────────────────────
// 3. getTreatmentPlan
// ─────────────────────────────────────────
exports.getTreatmentPlan = functions
    .runWith({ timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
    var _a;
    const callerId = requireAuth(context);
    // Default to fetching the caller's own plan
    const targetPatientId = (_a = data.patientId) !== null && _a !== void 0 ? _a : callerId;
    try {
        const svc = (0, healthcare_1.getTreatmentService)();
        if (data.planId) {
            const plan = await svc.getPlanById(data.planId);
            return { plan: serialisePlan(plan) };
        }
        if (data.includeHistory) {
            const plans = await svc.getTreatmentHistory(targetPatientId);
            return { plans: plans.map(serialisePlan) };
        }
        const plan = await svc.getTreatmentPlan(targetPatientId);
        return { plan: serialisePlan(plan) };
    }
    catch (err) {
        toHttpsError(err);
    }
});
// ─────────────────────────────────────────
// 4. acceptTreatmentPlan
// ─────────────────────────────────────────
exports.acceptTreatmentPlan = functions
    .runWith({ timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
    requireAuth(context);
    if (!data.planId) {
        throw new functions.https.HttpsError('invalid-argument', 'planId is required');
    }
    try {
        const treatSvc = (0, healthcare_1.getTreatmentService)();
        const sessionSvc = (0, healthcare_1.getSessionService)();
        // Transition plan status → 'accepted'
        const plan = await treatSvc.acceptTreatmentPlan(data.planId);
        // Initialise session tracker for all treatments in the protocol
        const tracker = await sessionSvc.initSessionTracker(plan);
        return {
            success: true,
            planId: plan.id,
            status: plan.status,
            sessions: tracker.sessions,
        };
    }
    catch (err) {
        toHttpsError(err);
    }
});
// ─────────────────────────────────────────
// 5. updateTreatmentStatus
// ─────────────────────────────────────────
exports.updateTreatmentStatus = functions
    .runWith({ timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
    requireAuth(context);
    if (!data.planId || !data.status) {
        throw new functions.https.HttpsError('invalid-argument', 'planId and status are required');
    }
    try {
        const plan = await (0, healthcare_1.getTreatmentService)().updateTreatmentStatus(data.planId, data.status);
        return { success: true, planId: plan.id, status: plan.status };
    }
    catch (err) {
        toHttpsError(err);
    }
});
// ─────────────────────────────────────────
// 6. completeSession
// ─────────────────────────────────────────
exports.completeSession = functions
    .runWith({ timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
    requireAuth(context);
    if (!data.planId || !data.treatment) {
        throw new functions.https.HttpsError('invalid-argument', 'planId and treatment are required');
    }
    try {
        const sessionSvc = (0, healthcare_1.getSessionService)();
        const treatSvc = (0, healthcare_1.getTreatmentService)();
        const { tracker, allComplete } = await sessionSvc.completeSession(data.planId, data.treatment);
        // Auto-complete the plan when every session is done
        if (allComplete) {
            await treatSvc.updateTreatmentStatus(data.planId, 'completed');
        }
        const entry = tracker.sessions.find((s) => s.treatment.toLowerCase().trim() ===
            data.treatment.toLowerCase().trim());
        return {
            success: true,
            planId: data.planId,
            treatment: data.treatment,
            completedSessions: entry.completedSessions,
            totalSessions: entry.totalSessions,
            allComplete,
            planStatus: allComplete ? 'completed' : 'in_progress',
        };
    }
    catch (err) {
        toHttpsError(err);
    }
});
// ─────────────────────────────────────────
// 7. getSessionProgress
// ─────────────────────────────────────────
exports.getSessionProgress = functions
    .runWith({ timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
    requireAuth(context);
    if (!data.planId) {
        throw new functions.https.HttpsError('invalid-argument', 'planId is required');
    }
    try {
        return await (0, healthcare_1.getSessionService)().getProgress(data.planId);
    }
    catch (err) {
        toHttpsError(err);
    }
});
// ─────────────────────────────────────────
// SERIALISER
// ─────────────────────────────────────────
function serialisePlan(plan) {
    // Strip internal pricing variables from protocol
    const safeProtocol = plan.protocol.map((_a) => {
        var { platformFee, doctorEarning } = _a, rest = __rest(_a, ["platformFee", "doctorEarning"]);
        return rest;
    });
    // Strip internal pricing variables from pricing summary
    let safePricing = undefined;
    if (plan.pricing) {
        const _a = plan.pricing, { totalPlatformFee, totalDoctorEarning } = _a, restPricing = __rest(_a, ["totalPlatformFee", "totalDoctorEarning"]);
        safePricing = restPricing;
    }
    return {
        id: plan.id,
        planId: plan.id,
        patientId: plan.patientId,
        doctorId: plan.doctorId,
        scanId: plan.scanId,
        category: plan.category,
        aiSuggestions: plan.aiSuggestions,
        doctorAction: plan.doctorAction,
        protocol: safeProtocol,
        medications: plan.medications,
        labTests: plan.labTests,
        notes: plan.notes,
        pricing: safePricing,
        status: plan.status,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
    };
}
// ─────────────────────────────────────────
// 8. getTreatmentCatalogue
// ─────────────────────────────────────────
exports.getTreatmentCatalogue = functions
    .runWith({ timeoutSeconds: 15 })
    .https.onCall(async (data, context) => {
    requireAuth(context);
    try {
        const db = admin.firestore();
        if (data.category) {
            const collectionName = `treatments_${data.category}`;
            const snapshot = await db.collection(collectionName).get();
            const catalogue = snapshot.docs.map(doc => doc.data());
            return { success: true, catalogue };
        }
        // Fetch all if no category specified
        const [facialSnap, skinSnap, dentalSnap] = await Promise.all([
            db.collection('treatments_facial').get(),
            db.collection('treatments_skin').get(),
            db.collection('treatments_dental').get()
        ]);
        const catalogue = [
            ...facialSnap.docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { _type: 'facial' }))),
            ...skinSnap.docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { _type: 'skin' }))),
            ...dentalSnap.docs.map(doc => (Object.assign(Object.assign({}, doc.data()), { _type: 'dental' })))
        ];
        return { success: true, catalogue };
    }
    catch (err) {
        toHttpsError(err);
    }
});
//# sourceMappingURL=healthcareHandlers.js.map