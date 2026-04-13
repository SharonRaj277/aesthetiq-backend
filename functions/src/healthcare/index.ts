// ─────────────────────────────────────────────────────────────────────────────
// AesthetiQ Healthcare Module — Public API
// ─────────────────────────────────────────────────────────────────────────────
//
// Import the pre-wired instances for use inside Firebase Cloud Functions:
//
//   import { scanService, treatmentService, sessionService } from '../healthcare';
//
// Or import the classes + IHealthcareStorage to wire your own storage:
//
//   import { ScanService, MemoryStorage } from '../healthcare';
//   const storage = new MemoryStorage();
//   const scanService = new ScanService(storage);
//
// ─────────────────────────────────────────────────────────────────────────────

export * from './types';
export { IHealthcareStorage } from './storage/interface';
export { MemoryStorage } from './storage/memoryStorage';
export { FirestoreStorage } from './storage/firestoreStorage';
export { ScanService } from './services/scanService';
export { TreatmentService } from './services/treatmentService';
export { SessionService } from './services/sessionService';
export { generateAISuggestions } from './ai/scanAnalysis';

// ─────────────────────────────────────────
// DEFAULT WIRED INSTANCES (Firestore)
// ─────────────────────────────────────────
// These are lazy-initialised so Firebase Admin is only required at runtime,
// not at module load time (avoids issues when running unit tests).

import { FirestoreStorage } from './storage/firestoreStorage';
import { ScanService } from './services/scanService';
import { TreatmentService } from './services/treatmentService';
import { SessionService } from './services/sessionService';

let _storage: FirestoreStorage | null = null;
let _scanService: ScanService | null = null;
let _treatmentService: TreatmentService | null = null;
let _sessionService: SessionService | null = null;

function getStorage(): FirestoreStorage {
  if (!_storage) _storage = new FirestoreStorage();
  return _storage;
}

export function getScanService(): ScanService {
  if (!_scanService) _scanService = new ScanService(getStorage());
  return _scanService;
}

export function getTreatmentService(): TreatmentService {
  if (!_treatmentService) _treatmentService = new TreatmentService(getStorage());
  return _treatmentService;
}

export function getSessionService(): SessionService {
  if (!_sessionService) _sessionService = new SessionService(getStorage());
  return _sessionService;
}
