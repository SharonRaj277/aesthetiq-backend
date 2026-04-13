import * as admin from 'firebase-admin';
import { FACIAL_TREATMENTS } from '../healthcare/config/treatments';
import { SKIN_TREATMENTS } from '../skin/config/treatments';
import { TREATMENTS as DENTAL_TREATMENTS } from '../dental/config/treatments';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export async function seedAllTreatments() {
  let count = 0;

  // 1. Seed Facial Treatments
  const facialBatch = db.batch();
  for (const treatment of FACIAL_TREATMENTS) {
    const docRef = db.collection('treatments_facial').doc(treatment.id.toString());
    facialBatch.set(docRef, treatment, { merge: true });
    count++;
  }
  await facialBatch.commit();
  console.log(`Seeded facial treatments.`);

  // 2. Seed Skin Treatments
  const skinBatch = db.batch();
  for (const treatment of SKIN_TREATMENTS) {
    // using SKU as document ID since it's unique
    const docRef = db.collection('treatments_skin').doc(treatment.sku);
    skinBatch.set(docRef, treatment, { merge: true });
    count++;
  }
  await skinBatch.commit();
  console.log(`Seeded skin treatments.`);

  // 3. Seed Dental Treatments
  const dentalBatch = db.batch();
  for (const [key, config] of Object.entries(DENTAL_TREATMENTS)) {
    const docRef = db.collection('treatments_dental').doc(key);
    dentalBatch.set(docRef, { id: key, ...config }, { merge: true });
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
