import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  CreateScanReportInput,
  CreateTreatmentPlanInput,
  TreatmentStatus,
  HealthcareError,
  getScanService,
  getTreatmentService,
  getSessionService,
  ScanCategory,
} from '../healthcare';

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

function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  return context.auth.uid;
}

/** Map HealthcareError codes → Firebase HttpsError codes. */
function toHttpsError(err: unknown): never {
  if (err instanceof HealthcareError) {
    const codeMap: Record<string, functions.https.FunctionsErrorCode> = {
      NOT_FOUND:        'not-found',
      INVALID_STATE:    'failed-precondition',
      PERMISSION_DENIED:'permission-denied',
      INVALID_INPUT:    'invalid-argument',
      AI_FAILED:        'internal',
    };
    throw new functions.https.HttpsError(
      codeMap[err.code] ?? 'internal',
      err.message
    );
  }
  throw new functions.https.HttpsError('internal', String(err));
}

// ─────────────────────────────────────────
// 1. createScanReport
// ─────────────────────────────────────────

export const createScanReport = functions
  .runWith({
    timeoutSeconds: 60,
    memory: '512MB',
    secrets: ['ANTHROPIC_API_KEY'],
  })
  .https.onCall(async (data: CreateScanReportInput, context) => {
    requireAuth(context);

    try {
      const report = await getScanService().createScanReport(data);
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
    } catch (err) {
      toHttpsError(err);
    }
  });

// ─────────────────────────────────────────
// 2. createTreatmentPlan
// ─────────────────────────────────────────

export const createTreatmentPlan = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data: CreateTreatmentPlanInput, context) => {
    const callerId = requireAuth(context);

    // Doctor must be the one creating the plan
    if (data.doctorId !== callerId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'doctorId must match the authenticated caller'
      );
    }

    try {
      const plan = await getTreatmentService().createTreatmentPlan(data);
      return {
        success: true,
        ...serialisePlan(plan)
      };
    } catch (err) {
      toHttpsError(err);
    }
  });

// ─────────────────────────────────────────
// 3. getTreatmentPlan
// ─────────────────────────────────────────

export const getTreatmentPlan = functions
  .runWith({ timeoutSeconds: 15 })
  .https.onCall(
    async (
      data: { patientId?: string; planId?: string; includeHistory?: boolean },
      context
    ) => {
      const callerId = requireAuth(context);

      // Default to fetching the caller's own plan
      const targetPatientId = data.patientId ?? callerId;

      try {
        const svc = getTreatmentService();

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
      } catch (err) {
        toHttpsError(err);
      }
    }
  );

// ─────────────────────────────────────────
// 4. acceptTreatmentPlan
// ─────────────────────────────────────────

export const acceptTreatmentPlan = functions
  .runWith({ timeoutSeconds: 15 })
  .https.onCall(async (data: { planId: string }, context) => {
    requireAuth(context);

    if (!data.planId) {
      throw new functions.https.HttpsError('invalid-argument', 'planId is required');
    }

    try {
      const treatSvc = getTreatmentService();
      const sessionSvc = getSessionService();

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
    } catch (err) {
      toHttpsError(err);
    }
  });

// ─────────────────────────────────────────
// 5. updateTreatmentStatus
// ─────────────────────────────────────────

export const updateTreatmentStatus = functions
  .runWith({ timeoutSeconds: 15 })
  .https.onCall(
    async (data: { planId: string; status: TreatmentStatus }, context) => {
      requireAuth(context);

      if (!data.planId || !data.status) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'planId and status are required'
        );
      }

      try {
        const plan = await getTreatmentService().updateTreatmentStatus(
          data.planId,
          data.status
        );
        return { success: true, planId: plan.id, status: plan.status };
      } catch (err) {
        toHttpsError(err);
      }
    }
  );

// ─────────────────────────────────────────
// 6. completeSession
// ─────────────────────────────────────────

export const completeSession = functions
  .runWith({ timeoutSeconds: 15 })
  .https.onCall(
    async (data: { planId: string; treatment: string }, context) => {
      requireAuth(context);

      if (!data.planId || !data.treatment) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'planId and treatment are required'
        );
      }

      try {
        const sessionSvc = getSessionService();
        const treatSvc = getTreatmentService();

        const { tracker, allComplete } = await sessionSvc.completeSession(
          data.planId,
          data.treatment
        );

        // Auto-complete the plan when every session is done
        if (allComplete) {
          await treatSvc.updateTreatmentStatus(data.planId, 'completed');
        }

        const entry = tracker.sessions.find(
          (s) =>
            s.treatment.toLowerCase().trim() ===
            data.treatment.toLowerCase().trim()
        )!;

        return {
          success: true,
          planId: data.planId,
          treatment: data.treatment,
          completedSessions: entry.completedSessions,
          totalSessions: entry.totalSessions,
          allComplete,
          planStatus: allComplete ? 'completed' : 'in_progress',
        };
      } catch (err) {
        toHttpsError(err);
      }
    }
  );

// ─────────────────────────────────────────
// 7. getSessionProgress
// ─────────────────────────────────────────

export const getSessionProgress = functions
  .runWith({ timeoutSeconds: 15 })
  .https.onCall(async (data: { planId: string }, context) => {
    requireAuth(context);

    if (!data.planId) {
      throw new functions.https.HttpsError('invalid-argument', 'planId is required');
    }

    try {
      return await getSessionService().getProgress(data.planId);
    } catch (err) {
      toHttpsError(err);
    }
  });

// ─────────────────────────────────────────
// SERIALISER
// ─────────────────────────────────────────

function serialisePlan(plan: import('../healthcare').TreatmentPlan) {
  // Strip internal pricing variables from protocol
  const safeProtocol = plan.protocol.map(({ platformFee, doctorEarning, ...rest }) => rest);

  // Strip internal pricing variables from pricing summary
  let safePricing = undefined;
  if (plan.pricing) {
    const { totalPlatformFee, totalDoctorEarning, ...restPricing } = plan.pricing;
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

export const getTreatmentCatalogue = functions
  .runWith({ timeoutSeconds: 15 })
  .https.onCall(async (data: { category?: ScanCategory }, context) => {
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
        ...facialSnap.docs.map(doc => ({ ...doc.data(), _type: 'facial' })),
        ...skinSnap.docs.map(doc => ({ ...doc.data(), _type: 'skin' })),
        ...dentalSnap.docs.map(doc => ({ ...doc.data(), _type: 'dental' }))
      ];
      
      return { success: true, catalogue };
    } catch (err) {
      toHttpsError(err);
    }
  });
