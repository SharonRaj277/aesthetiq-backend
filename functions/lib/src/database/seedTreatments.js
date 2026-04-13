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
exports.seedAllTreatments = seedAllTreatments;
const admin = __importStar(require("firebase-admin"));
const treatments_1 = require("../healthcare/config/treatments");
const treatments_2 = require("../skin/config/treatments");
const treatments_3 = require("../dental/config/treatments");
// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
async function seedAllTreatments() {
    let count = 0;
    // 1. Seed Facial Treatments
    const facialBatch = db.batch();
    for (const treatment of treatments_1.FACIAL_TREATMENTS) {
        const docRef = db.collection('treatments_facial').doc(treatment.id.toString());
        facialBatch.set(docRef, treatment, { merge: true });
        count++;
    }
    await facialBatch.commit();
    console.log(`Seeded facial treatments.`);
    // 2. Seed Skin Treatments
    const skinBatch = db.batch();
    for (const treatment of treatments_2.SKIN_TREATMENTS) {
        // using SKU as document ID since it's unique
        const docRef = db.collection('treatments_skin').doc(treatment.sku);
        skinBatch.set(docRef, treatment, { merge: true });
        count++;
    }
    await skinBatch.commit();
    console.log(`Seeded skin treatments.`);
    // 3. Seed Dental Treatments
    const dentalBatch = db.batch();
    for (const [key, config] of Object.entries(treatments_3.TREATMENTS)) {
        const docRef = db.collection('treatments_dental').doc(key);
        dentalBatch.set(docRef, Object.assign({ id: key }, config), { merge: true });
        count++;
    }
    await dentalBatch.commit();
    console.log(`Seeded dental treatments.`);
    console.log(`Successfully seeded a total of ${count} treatments across all domains.`);
}
// Allow running this script directly from command line
if (require.main === module) {
    seedAllTreatments().then(() => process.exit(0)).catch(console.error);
}
//# sourceMappingURL=seedTreatments.js.map