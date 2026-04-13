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
exports.FirestoreStorage = void 0;
const admin = __importStar(require("firebase-admin"));
// ─────────────────────────────────────────────────────────────────────────────
// FirestoreStorage
// ────────────────
// Firebase Firestore implementation of IHealthcareStorage.
// Converts JS Date ↔ Firestore Timestamp transparently.
// ─────────────────────────────────────────────────────────────────────────────
class FirestoreStorage {
    constructor(db) {
        this.db = db !== null && db !== void 0 ? db : admin.firestore();
    }
    // ── SCAN REPORTS ────────────────────────────────────────────────────────────
    async saveScanReport(report) {
        await this.db
            .collection('scanReports')
            .doc(report.id)
            .set(toFirestore(report));
    }
    async getScanReport(scanId) {
        const doc = await this.db.collection('scanReports').doc(scanId).get();
        if (!doc.exists)
            return null;
        return fromFirestore(Object.assign({ id: doc.id }, doc.data()));
    }
    async updateScanReport(scanId, updates) {
        await this.db
            .collection('scanReports')
            .doc(scanId)
            .update(Object.assign(Object.assign({}, toFirestore(updates)), { updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
    }
    // ── TREATMENT PLANS ─────────────────────────────────────────────────────────
    async saveTreatmentPlan(plan) {
        await this.db
            .collection('treatmentPlans')
            .doc(plan.id)
            .set(toFirestore(plan));
    }
    async getTreatmentPlan(planId) {
        const doc = await this.db.collection('treatmentPlans').doc(planId).get();
        if (!doc.exists)
            return null;
        return fromFirestore(Object.assign({ id: doc.id }, doc.data()));
    }
    async getLatestTreatmentPlanForPatient(patientId) {
        const snap = await this.db
            .collection('treatmentPlans')
            .where('patientId', '==', patientId)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        if (snap.empty)
            return null;
        const doc = snap.docs[0];
        return fromFirestore(Object.assign({ id: doc.id }, doc.data()));
    }
    async getAllTreatmentPlansForPatient(patientId) {
        const snap = await this.db
            .collection('treatmentPlans')
            .where('patientId', '==', patientId)
            .orderBy('createdAt', 'desc')
            .get();
        return snap.docs.map((d) => fromFirestore(Object.assign({ id: d.id }, d.data())));
    }
    async updateTreatmentPlan(planId, updates) {
        await this.db
            .collection('treatmentPlans')
            .doc(planId)
            .update(Object.assign(Object.assign({}, toFirestore(updates)), { updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
    }
    // ── SESSION TRACKERS ────────────────────────────────────────────────────────
    async saveSessionTracker(tracker) {
        await this.db
            .collection('sessionTrackers')
            .doc(tracker.planId)
            .set(toFirestore(tracker));
    }
    async getSessionTracker(planId) {
        const doc = await this.db.collection('sessionTrackers').doc(planId).get();
        if (!doc.exists)
            return null;
        return fromFirestore(Object.assign({ id: doc.id }, doc.data()));
    }
    async updateSessionTracker(planId, updates) {
        await this.db
            .collection('sessionTrackers')
            .doc(planId)
            .update(Object.assign(Object.assign({}, toFirestore(updates)), { updatedAt: admin.firestore.FieldValue.serverTimestamp() }));
    }
}
exports.FirestoreStorage = FirestoreStorage;
// ─────────────────────────────────────────
// DATE ↔ TIMESTAMP CONVERSION
// ─────────────────────────────────────────
/**
 * Recursively convert Date → Firestore Timestamp before writing.
 * Skips nested arrays and null values safely.
 */
function toFirestore(obj) {
    if (obj instanceof Date)
        return admin.firestore.Timestamp.fromDate(obj);
    if (Array.isArray(obj))
        return obj.map(toFirestore);
    if (obj !== null && typeof obj === 'object') {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toFirestore(v)]));
    }
    return obj;
}
/**
 * Recursively convert Firestore Timestamp → Date after reading.
 */
function fromFirestore(obj) {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
        if (val instanceof admin.firestore.Timestamp) {
            result[key] = val.toDate();
        }
        else if (Array.isArray(val)) {
            result[key] = val.map((item) => item !== null && typeof item === 'object' ? fromFirestore(item) : item);
        }
        else if (val !== null && typeof val === 'object') {
            result[key] = fromFirestore(val);
        }
        else {
            result[key] = val;
        }
    }
    return result;
}
//# sourceMappingURL=firestoreStorage.js.map