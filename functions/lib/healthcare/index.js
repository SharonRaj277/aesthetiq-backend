"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessionService = exports.getTreatmentService = exports.getScanService = exports.generateAISuggestions = exports.SessionService = exports.TreatmentService = exports.ScanService = exports.FirestoreStorage = exports.MemoryStorage = void 0;
__exportStar(require("./types"), exports);
var memoryStorage_1 = require("./storage/memoryStorage");
Object.defineProperty(exports, "MemoryStorage", { enumerable: true, get: function () { return memoryStorage_1.MemoryStorage; } });
var firestoreStorage_1 = require("./storage/firestoreStorage");
Object.defineProperty(exports, "FirestoreStorage", { enumerable: true, get: function () { return firestoreStorage_1.FirestoreStorage; } });
var scanService_1 = require("./services/scanService");
Object.defineProperty(exports, "ScanService", { enumerable: true, get: function () { return scanService_1.ScanService; } });
var treatmentService_1 = require("./services/treatmentService");
Object.defineProperty(exports, "TreatmentService", { enumerable: true, get: function () { return treatmentService_1.TreatmentService; } });
var sessionService_1 = require("./services/sessionService");
Object.defineProperty(exports, "SessionService", { enumerable: true, get: function () { return sessionService_1.SessionService; } });
var scanAnalysis_1 = require("./ai/scanAnalysis");
Object.defineProperty(exports, "generateAISuggestions", { enumerable: true, get: function () { return scanAnalysis_1.generateAISuggestions; } });
// ─────────────────────────────────────────
// DEFAULT WIRED INSTANCES (Firestore)
// ─────────────────────────────────────────
// These are lazy-initialised so Firebase Admin is only required at runtime,
// not at module load time (avoids issues when running unit tests).
const firestoreStorage_2 = require("./storage/firestoreStorage");
const scanService_2 = require("./services/scanService");
const treatmentService_2 = require("./services/treatmentService");
const sessionService_2 = require("./services/sessionService");
let _storage = null;
let _scanService = null;
let _treatmentService = null;
let _sessionService = null;
function getStorage() {
    if (!_storage)
        _storage = new firestoreStorage_2.FirestoreStorage();
    return _storage;
}
function getScanService() {
    if (!_scanService)
        _scanService = new scanService_2.ScanService(getStorage());
    return _scanService;
}
exports.getScanService = getScanService;
function getTreatmentService() {
    if (!_treatmentService)
        _treatmentService = new treatmentService_2.TreatmentService(getStorage());
    return _treatmentService;
}
exports.getTreatmentService = getTreatmentService;
function getSessionService() {
    if (!_sessionService)
        _sessionService = new sessionService_2.SessionService(getStorage());
    return _sessionService;
}
exports.getSessionService = getSessionService;
//# sourceMappingURL=index.js.map