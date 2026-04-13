import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import {
  ScanReport,
  TreatmentPlan,
  Treatment,
  DoctorAction,
  TreatmentStatus,
  CreateTreatmentPlanInput,
  GetTreatmentPlanInput,
} from '../types/treatment';
import { generateAISuggestions } from '../ai/treatmentAI';

const db = () => admin.firestore();

// ─────────────────────────────────────────
// createTreatmentPlan (callable)
// ─────────────────────────────────────────

/**
 * Called by the Doctor App after reviewing scan results.
 *
 * doctorAction variants:
 *  "approved_ai" — accept all AI suggestions as-is
 *  "modified"    — edit/mix AI suggestions (provide finalTreatments)
 *  "custom"      — ignore AI, write a brand-new plan (provide finalTreatments)
 *
 * Always stores BOTH aiSuggestions and finalTreatments for audit trail.
 */
export const createTreatmentPlan = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data: CreateTreatmentPlanInput, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');
    }

    const doctorId = context.auth.uid;

    // ── Guard: only active doctors can create plans ───────────────────────────
    const doctorDoc = await db().collection('doctors').doc(doctorId).get();
    if (!doctorDoc.exists || doctorDoc.data()?.status !== 'active') {
      throw new functions.https.HttpsError('permission-denied', 'Active doctor account required');
    }

    const { scanId, doctorAction, finalTreatments, medications, labTests, notes } = data;

    if (!scanId || !doctorAction) {
      throw new functions.https.HttpsError('invalid-argument', 'scanId and doctorAction are required');
    }

    if (['modified', 'custom'].includes(doctorAction) && (!finalTreatments || finalTreatments.length === 0)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `finalTreatments is required when doctorAction is "${doctorAction}"`
      );
    }

    // ── Load scan report ────────────────────────────────────────────────────
    const scanDoc = await db().collection('scanReports').doc(scanId).get();
    if (!scanDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Scan report not found');
    }
    const scan = { id: scanDoc.id, ...scanDoc.data() } as ScanReport;

    if (scan.status === 'pending_ai') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'AI suggestions are still being generated. Please wait and try again.'
      );
    }

    // ── Resolve final treatments + status based on doctor action ─────────────
    let resolvedTreatments: Treatment[];
    let status: TreatmentStatus;

    switch (doctorAction as DoctorAction) {
      case 'approved_ai':
        // Convert AI suggestions to Treatment objects, preserving source = 'AI'
        resolvedTreatments = scan.aiSuggestions.map((s) => ({
          name: s.name,
          sessions: s.estimatedSessions,
          pricePerSession: s.estimatedPricePerSession,
          totalPrice: parseFloat((s.estimatedSessions * s.estimatedPricePerSession).toFixed(2)),
          source: 'AI' as const,
          category: s.category,
        }));
        status = 'doctor_approved';
        break;

      case 'modified':
        // Doctor provides their own list — can be AI items with edits, new items, or both
        resolvedTreatments = finalTreatments!.map((t) => ({
          ...t,
          source: (t.source ?? 'Doctor') as 'AI' | 'Doctor',
          totalPrice: parseFloat((t.sessions * t.pricePerSession).toFixed(2)),
        }));
        status = 'doctor_modified';
        break;

      case 'custom':
        // Entirely doctor-defined — all source = 'Doctor'
        resolvedTreatments = finalTreatments!.map((t) => ({
          ...t,
          source: 'Doctor' as const,
          totalPrice: parseFloat((t.sessions * t.pricePerSession).toFixed(2)),
        }));
        status = 'doctor_defined';
        break;

      default:
        throw new functions.https.HttpsError('invalid-argument', `Unknown doctorAction: ${doctorAction}`);
    }

    const totalCost = parseFloat(
      resolvedTreatments.reduce((sum, t) => sum + t.totalPrice, 0).toFixed(2)
    );

    const now = admin.firestore.FieldValue.serverTimestamp();

    // ── Write plan + update scan report in a batch ───────────────────────────
    const planRef = db().collection('treatmentPlans').doc();

    const planData: Omit<TreatmentPlan, 'id'> = {
      patientId: scan.patientId,
      doctorId,
      scanId,
      aiSuggestions: scan.aiSuggestions,   // always preserve original AI output
      doctorAction: doctorAction as DoctorAction,
      finalTreatments: resolvedTreatments,
      medications: medications ?? [],
      labTests: labTests ?? [],
      notes: notes ?? '',
      totalCost,
      status,
      createdAt: now as unknown as admin.firestore.Timestamp,
      updatedAt: now as unknown as admin.firestore.Timestamp,
    };

    const batch = db().batch();
    batch.set(planRef, planData);
    batch.update(db().collection('scanReports').doc(scanId), {
      status: 'plan_created',
      treatmentPlanId: planRef.id,
      updatedAt: now,
    });
    await batch.commit();

    console.log(
      `[createTreatmentPlan] plan=${planRef.id} action=${doctorAction} ` +
      `patient=${scan.patientId} treatments=${resolvedTreatments.length} total=$${totalCost}`
    );

    return {
      success: true,
      planId: planRef.id,
      patientId: scan.patientId,
      doctorAction,
      status,
      totalCost,
      treatmentCount: resolvedTreatments.length,
      finalTreatments: resolvedTreatments,
    };
  });

// ─────────────────────────────────────────
// getTreatmentPlan (callable)
// ─────────────────────────────────────────

/**
 * Fetch a treatment plan for the Patient App, Doctor App, or Admin Panel.
 *
 * Access rules:
 *  - Patient: can only see their own plans
 *  - Doctor: can see plans they created + their patients' plans
 *  - Admin: full access
 */
export const getTreatmentPlan = functions
  .runWith({ timeoutSeconds: 15 })
  .https.onCall(async (data: GetTreatmentPlanInput, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');
    }

    const { planId, patientId, includeHistory = false } = data;
    const callerId = context.auth.uid;

    // ── Fetch by specific plan ID ─────────────────────────────────────────────
    if (planId) {
      const doc = await db().collection('treatmentPlans').doc(planId).get();
      if (!doc.exists) throw new functions.https.HttpsError('not-found', 'Treatment plan not found');

      const plan = { id: doc.id, ...doc.data() } as TreatmentPlan;
      await assertReadAccess(callerId, plan);
      return { plan: formatPlan(plan) };
    }

    // ── Fetch plan(s) for a patient ───────────────────────────────────────────
    const targetPatientId = patientId ?? callerId;

    if (targetPatientId !== callerId) {
      await assertCallerIsDocOrAdmin(callerId);
    }

    const snap = await db()
      .collection('treatmentPlans')
      .where('patientId', '==', targetPatientId)
      .orderBy('createdAt', 'desc')
      .limit(includeHistory ? 10 : 1)
      .get();

    if (snap.empty) {
      return includeHistory ? { plans: [] } : { plan: null };
    }

    const plans = snap.docs.map((d) => formatPlan({ id: d.id, ...d.data() } as TreatmentPlan));

    return includeHistory ? { plans } : { plan: plans[0] };
  });

// ─────────────────────────────────────────
// updateTreatmentStatus (callable)
// ─────────────────────────────────────────

/**
 * Advance a treatment plan through its lifecycle:
 *   doctor_approved / doctor_modified / doctor_defined → active → completed
 */
export const updateTreatmentStatus = functions
  .runWith({ timeoutSeconds: 15 })
  .https.onCall(
    async (data: { planId: string; status: TreatmentStatus }, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');
      }

      const { planId, status } = data;
      if (!planId || !status) {
        throw new functions.https.HttpsError('invalid-argument', 'planId and status are required');
      }

      const planDoc = await db().collection('treatmentPlans').doc(planId).get();
      if (!planDoc.exists) throw new functions.https.HttpsError('not-found', 'Plan not found');

      const plan = planDoc.data() as TreatmentPlan;

      // Only the assigned doctor or admin can change status
      const isAssignedDoctor = plan.doctorId === context.auth.uid;
      if (!isAssignedDoctor) {
        await assertCallerIsAdmin(context.auth.uid);
      }

      await planDoc.ref.update({
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true, planId, status };
    }
  );

// ─────────────────────────────────────────
// regenerateAISuggestions (callable)
// ─────────────────────────────────────────

/**
 * Re-run the AI on an existing scan report.
 * Useful when the first generation failed or the doctor wants a fresh perspective.
 * Only doctors and admins can trigger this.
 */
export const regenerateAISuggestions = functions
  .runWith({
    timeoutSeconds: 60,
    memory: '512MB',
    secrets: ['ANTHROPIC_API_KEY'],
  })
  .https.onCall(async (data: { scanId: string }, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Not authenticated');
    }

    await assertCallerIsDocOrAdmin(context.auth.uid);

    const { scanId } = data;
    if (!scanId) throw new functions.https.HttpsError('invalid-argument', 'scanId required');

    const scanDoc = await db().collection('scanReports').doc(scanId).get();
    if (!scanDoc.exists) throw new functions.https.HttpsError('not-found', 'Scan not found');

    const scan = { id: scanDoc.id, ...scanDoc.data() } as ScanReport;
    const suggestions = await generateAISuggestions(scan.results);

    await scanDoc.ref.update({
      aiSuggestions: suggestions,
      status: 'ai_suggested',
      aiError: admin.firestore.FieldValue.delete(),
      aiGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      scanId,
      suggestionsCount: suggestions.length,
      suggestions,
    };
  });

// ─────────────────────────────────────────
// ACCESS CONTROL HELPERS
// ─────────────────────────────────────────

async function assertReadAccess(uid: string, plan: TreatmentPlan): Promise<void> {
  if (plan.patientId === uid || plan.doctorId === uid) return;
  const adminDoc = await db().collection('admins').doc(uid).get();
  if (adminDoc.exists) return;
  throw new functions.https.HttpsError('permission-denied', 'Access denied');
}

async function assertCallerIsDocOrAdmin(uid: string): Promise<void> {
  const [doctorDoc, adminDoc] = await Promise.all([
    db().collection('doctors').doc(uid).get(),
    db().collection('admins').doc(uid).get(),
  ]);
  if (!doctorDoc.exists && !adminDoc.exists) {
    throw new functions.https.HttpsError('permission-denied', 'Doctor or admin access required');
  }
}

async function assertCallerIsAdmin(uid: string): Promise<void> {
  const adminDoc = await db().collection('admins').doc(uid).get();
  if (!adminDoc.exists) {
    throw new functions.https.HttpsError('permission-denied', 'Admin access required');
  }
}

// ─────────────────────────────────────────
// RESPONSE FORMATTER
// ─────────────────────────────────────────

function formatPlan(plan: TreatmentPlan) {
  return {
    id: plan.id,
    patientId: plan.patientId,
    doctorId: plan.doctorId,
    scanId: plan.scanId,

    // Full AI output — always returned so client can show what AI suggested
    aiSuggestions: plan.aiSuggestions,

    // Doctor decision
    doctorAction: plan.doctorAction,

    // Final validated treatments the patient should receive
    finalTreatments: plan.finalTreatments,

    // Prescription
    medications: plan.medications,
    labTests: plan.labTests,
    notes: plan.notes,

    // Summary
    totalCost: plan.totalCost,
    status: plan.status,

    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}
