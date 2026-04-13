import * as admin from 'firebase-admin';
import { ScanReport, TreatmentPlan, SessionTracker } from '../types';
import { IHealthcareStorage } from './interface';

// ─────────────────────────────────────────────────────────────────────────────
// FirestoreStorage
// ────────────────
// Firebase Firestore implementation of IHealthcareStorage.
// Converts JS Date ↔ Firestore Timestamp transparently.
// ─────────────────────────────────────────────────────────────────────────────

export class FirestoreStorage implements IHealthcareStorage {
  private db: admin.firestore.Firestore;

  constructor(db?: admin.firestore.Firestore) {
    this.db = db ?? admin.firestore();
  }

  // ── SCAN REPORTS ────────────────────────────────────────────────────────────

  async saveScanReport(report: ScanReport): Promise<void> {
    await this.db
      .collection('scanReports')
      .doc(report.id)
      .set(toFirestore(report));
  }

  async getScanReport(scanId: string): Promise<ScanReport | null> {
    const doc = await this.db.collection('scanReports').doc(scanId).get();
    if (!doc.exists) return null;
    return fromFirestore<ScanReport>({ id: doc.id, ...doc.data()! });
  }

  async updateScanReport(scanId: string, updates: Partial<ScanReport>): Promise<void> {
    await this.db
      .collection('scanReports')
      .doc(scanId)
      .update({
        ...toFirestore(updates),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  }

  // ── TREATMENT PLANS ─────────────────────────────────────────────────────────

  async saveTreatmentPlan(plan: TreatmentPlan): Promise<void> {
    await this.db
      .collection('treatmentPlans')
      .doc(plan.id)
      .set(toFirestore(plan));
  }

  async getTreatmentPlan(planId: string): Promise<TreatmentPlan | null> {
    const doc = await this.db.collection('treatmentPlans').doc(planId).get();
    if (!doc.exists) return null;
    return fromFirestore<TreatmentPlan>({ id: doc.id, ...doc.data()! });
  }

  async getLatestTreatmentPlanForPatient(patientId: string): Promise<TreatmentPlan | null> {
    const snap = await this.db
      .collection('treatmentPlans')
      .where('patientId', '==', patientId)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return fromFirestore<TreatmentPlan>({ id: doc.id, ...doc.data() });
  }

  async getAllTreatmentPlansForPatient(patientId: string): Promise<TreatmentPlan[]> {
    const snap = await this.db
      .collection('treatmentPlans')
      .where('patientId', '==', patientId)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((d) =>
      fromFirestore<TreatmentPlan>({ id: d.id, ...d.data() })
    );
  }

  async updateTreatmentPlan(planId: string, updates: Partial<TreatmentPlan>): Promise<void> {
    await this.db
      .collection('treatmentPlans')
      .doc(planId)
      .update({
        ...toFirestore(updates),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  }

  // ── SESSION TRACKERS ────────────────────────────────────────────────────────

  async saveSessionTracker(tracker: SessionTracker): Promise<void> {
    await this.db
      .collection('sessionTrackers')
      .doc(tracker.planId)
      .set(toFirestore(tracker));
  }

  async getSessionTracker(planId: string): Promise<SessionTracker | null> {
    const doc = await this.db.collection('sessionTrackers').doc(planId).get();
    if (!doc.exists) return null;
    return fromFirestore<SessionTracker>({ id: doc.id, ...doc.data()! });
  }

  async updateSessionTracker(planId: string, updates: Partial<SessionTracker>): Promise<void> {
    await this.db
      .collection('sessionTrackers')
      .doc(planId)
      .update({
        ...toFirestore(updates),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  }
}

// ─────────────────────────────────────────
// DATE ↔ TIMESTAMP CONVERSION
// ─────────────────────────────────────────

/**
 * Recursively convert Date → Firestore Timestamp before writing.
 * Skips nested arrays and null values safely.
 */
function toFirestore(obj: Record<string, unknown> | unknown): unknown {
  if (obj instanceof Date) return admin.firestore.Timestamp.fromDate(obj);
  if (Array.isArray(obj)) return obj.map(toFirestore);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, toFirestore(v)])
    );
  }
  return obj;
}

/**
 * Recursively convert Firestore Timestamp → Date after reading.
 */
function fromFirestore<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val instanceof admin.firestore.Timestamp) {
      result[key] = val.toDate();
    } else if (Array.isArray(val)) {
      result[key] = val.map((item) =>
        item !== null && typeof item === 'object' ? fromFirestore(item as Record<string, unknown>) : item
      );
    } else if (val !== null && typeof val === 'object') {
      result[key] = fromFirestore(val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result as T;
}
