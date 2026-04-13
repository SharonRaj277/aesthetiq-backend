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
exports.simulateTreatment = void 0;
const functions = __importStar(require("firebase-functions"));
const simulationAI_1 = require("../ai/simulationAI");
// Rate limiting map (in-memory, per instance instance)
// For a production app, use Firestore or Redis for accurate rate limiting
const rateLimits = new Map();
function isRateLimited(ip) {
    const now = Date.now();
    const limitWindow = 60 * 1000; // 1 minute
    const maxRequests = 5;
    const record = rateLimits.get(ip);
    if (!record) {
        rateLimits.set(ip, { count: 1, resetTime: now + limitWindow });
        return false;
    }
    if (now > record.resetTime) {
        rateLimits.set(ip, { count: 1, resetTime: now + limitWindow });
        return false;
    }
    if (record.count >= maxRequests) {
        return true;
    }
    record.count += 1;
    return false;
}
// ─────────────────────────────────────────
// simulateTreatment Callable Function
// ─────────────────────────────────────────
exports.simulateTreatment = functions
    .runWith({
    timeoutSeconds: 120,
    memory: '1GB',
})
    .https.onCall(async (data, context) => {
    // 1. Authenticate & Rate Limit
    const ip = context.rawRequest.ip || 'unknown-ip';
    if (isRateLimited(ip)) {
        throw new functions.https.HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
    }
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to use the simulation feature.');
    }
    // 2. Extract and Validate Inputs
    const { imageUrl } = data;
    if (!imageUrl || typeof imageUrl !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'Image URL is required.');
    }
    // URL basic validation (should end with image ext or be a valid storage URL)
    try {
        new URL(imageUrl);
    }
    catch (_a) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid Image URL.');
    }
    // 3. Process the AI Pipeline
    try {
        const simulationResult = await (0, simulationAI_1.runSimulationPipeline)(imageUrl);
        return Object.assign({ success: true }, simulationResult);
    }
    catch (error) {
        console.error('[Simulation Error]', error);
        throw new functions.https.HttpsError('internal', 'Simulation failed due to internal error');
    }
});
//# sourceMappingURL=simulationHandlers.js.map