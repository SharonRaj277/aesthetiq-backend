import * as functions from 'firebase-functions';
import { runSimulationPipeline } from '../ai/simulationAI';

// Rate limiting map (in-memory, per instance instance)
// For a production app, use Firestore or Redis for accurate rate limiting
const rateLimits = new Map<string, { count: number, resetTime: number }>();

function isRateLimited(ip: string): boolean {
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

export const simulateTreatment = functions
  .runWith({
    timeoutSeconds: 120, // Pipeline can take a while with Vision models
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
    const { imageUrl } = data as { imageUrl: string };
    
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'Image URL is required.');
    }

    // URL basic validation (should end with image ext or be a valid storage URL)
    try {
      new URL(imageUrl);
    } catch {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid Image URL.');
    }

    // 3. Process the AI Pipeline
    try {
      const simulationResult = await runSimulationPipeline(imageUrl);
      return { success: true, ...simulationResult };
    } catch (error: any) {
      console.error('[Simulation Error]', error);
      throw new functions.https.HttpsError('internal', 'Simulation failed due to internal error');
    }
  });
