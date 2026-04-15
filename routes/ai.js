'use strict';

/**
 * routes/ai.js — Real AI implementation
 *
 * /ai/analyze  — Gemini 2.5 Flash Lite vision → structured skin analysis
 * /ai/simulate — Gemini text → treatment simulation plan
 *                (image generation via Imagen requires paid tier;
 *                 returns before URL + structured improvement directives)
 *
 * Both routes have full fallback: any AI failure returns mock data, never crashes.
 */

const { Router } = require('express');
const https = require('https');
const http = require('http');
const axios = require('axios');
const { mapSkinTreatments } = require('../engine/skinLightMapper');

const router = Router();

// ─── Config ───────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDGEVaWc4odTn74VYS1ShxdUVMQMo9qh2w';
const GEMINI_VISION_MODEL = 'gemini-2.5-flash-lite';
const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models`;
const AI_TIMEOUT_MS = 30_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch an image from a URL and return its base64-encoded content + mime type.
 * Follows redirects manually (Node's https.get does not auto-redirect).
 */
function fetchImageAsBase64(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error('Too many redirects'));

    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'AesthetiQ-AI/1.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        return resolve(fetchImageAsBase64(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Image fetch returned HTTP ${res.statusCode}`));
      }

      const contentType = res.headers['content-type'] || 'image/jpeg';
      const mimeType = contentType.split(';')[0].trim();

      if (!mimeType.startsWith('image/')) {
        return reject(new Error(`URL did not return an image (got: ${mimeType})`));
      }

      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ data: Buffer.concat(chunks).toString('base64'), mimeType }));
      res.on('error', reject);
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Image fetch timed out')); });
    req.on('error', reject);
  });
}

/**
 * Call Gemini with vision (inline base64 image) or text-only.
 * Returns the raw text response.
 */
async function callGemini({ textPrompt, imageBase64, imageMimeType, jsonMode = true }) {
  const parts = [{ text: textPrompt }];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: imageMimeType || 'image/jpeg', data: imageBase64 } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const resp = await axios.post(
    `${GEMINI_BASE}/${GEMINI_VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    body,
    { timeout: AI_TIMEOUT_MS }
  );

  const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

/**
 * Like callGemini but accepts an array of already-fetched images.
 * images: [{ data: base64string, mimeType: string }, ...]
 */
async function callGeminiMultiImage({ textPrompt, images = [], jsonMode = true }) {
  const parts = [{ text: textPrompt }];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mimeType || 'image/jpeg', data: img.data } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const resp = await axios.post(
    `${GEMINI_BASE}/${GEMINI_VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    body,
    { timeout: AI_TIMEOUT_MS }
  );

  const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const ANALYZE_PROMPT = `You are an aesthetic skincare AI assistant working alongside licensed dermatologists.
Analyze this image for visible skin concerns only. Do NOT provide medical diagnoses.

Output ONLY a valid JSON object — no markdown, no explanation — with this exact structure:
{
  "concerns": ["acne", "pigmentation"],
  "severity": {
    "acne": "mild",
    "pigmentation": "moderate"
  },
  "notes": "Brief factual observation about visible skin condition."
}

Rules:
- concerns: array of zero or more issues visible in the image, chosen ONLY from:
    acne, pigmentation, dryness, oiliness, sensitivity, uneven_tone, fine_lines, dark_spots, redness, enlarged_pores
- severity: include an entry for each concern listed, values must be: none, mild, moderate, or severe
- notes: 1–2 factual sentences describing what is visually observed; no diagnosis, no prescriptions
- If the image is NOT a face or skin photo, return:
    {"concerns":[],"severity":{},"notes":"Unable to analyze: image does not appear to show skin."}
- Be conservative — only flag concerns that are clearly visible`;

// ─── Dental prompt builder ────────────────────────────────────────────────────

/**
 * Builds the full dental analysis prompt, inserting validated patient context
 * ahead of the image(s) so the model can correlate symptoms with visual findings.
 *
 * @param {object} ctx — { painLevel, swelling, selectedAreas, questionnaireAnswers }
 * @returns {string}
 */
function buildDentalPrompt(ctx = {}) {
  const {
    painLevel          = 'not reported',
    swelling           = 'not reported',
    selectedAreas      = [],
    questionnaireAnswers = {},
  } = ctx;

  const qa = questionnaireAnswers;
  const areas = Array.isArray(selectedAreas) && selectedAreas.length > 0
    ? selectedAreas.join(', ')
    : 'not reported';

  const context = `Patient-reported context:

Pain level: ${painLevel}
Swelling: ${swelling}
Pain locations: ${areas}

Symptoms:
- Pain type: ${qa.painType          ?? 'not reported'}
- Triggers: ${qa.painTriggers        ?? 'not reported'}
- Duration: ${qa.painDuration        ?? 'not reported'}
- Night pain: ${qa.sleepPain         ?? 'not reported'}
- Spontaneous pain: ${qa.spontaneousPain ?? 'not reported'}
- Bad taste: ${qa.badTaste           ?? 'not reported'}
- Previous treatment: ${qa.previousTreatment ?? 'not reported'}

Use this context to:
- Improve urgencyTier
- Improve interpretation
- Improve treatment suggestions

DO NOT diagnose. Only correlate symptoms with visible findings.`;

  return `${context}

---

You are a dental imaging AI assistant working alongside licensed dentists.
Analyze the provided dental photo(s) for visible clinical findings only. Do NOT provide medical diagnoses.

Output ONLY a valid JSON object — no markdown, no explanation — with this exact structure:
{
  "findings": ["calculus", "gingival_inflammation"],
  "severity": {
    "calculus": "moderate",
    "gingival_inflammation": "mild"
  },
  "urgencyTier": "routine",
  "interpretation": "Brief factual description of visible conditions, correlated with patient-reported symptoms where relevant.",
  "suggestedActions": ["Professional cleaning", "Gingival assessment"]
}

Rules:
- findings: array of zero or more issues clearly visible, chosen ONLY from:
    calculus, plaque, gingival_inflammation, recession, caries, fracture, erosion,
    staining, missing_tooth, crowding, spacing, periapical_lesion, abscess_signs,
    restoration_issue, bruxism_wear, dry_socket
- severity: entry for each finding — values: none, mild, moderate, or severe
- urgencyTier: one of — emergency (see dentist today), urgent (within 48h), soon (within 2 weeks), routine (next scheduled visit)
  - Elevate urgencyTier if patient-reported pain level ≥ 7, spontaneous pain = yes, swelling = yes, or bad taste = yes
- interpretation: 2–4 factual sentences; correlate visible findings with patient context where appropriate; no prescriptions
- suggestedActions: 1–5 plain-language next steps; never include prices
- If images are NOT dental photos, return:
    {"findings":[],"severity":{},"urgencyTier":"routine","interpretation":"Unable to analyze: images do not appear to show dental structures.","suggestedActions":[]}
- Be conservative — only flag findings clearly visible in the images`;
}

const DENTAL_MOCK_ANALYSIS = {
  findings: ['calculus', 'gingival_inflammation', 'staining'],
  severity: { calculus: 'moderate', gingival_inflammation: 'mild', staining: 'mild' },
  urgencyTier: 'routine',
  interpretation: 'Visible supragingival calculus deposits along the lower anterior teeth with mild gingival inflammation at the margins. Extrinsic staining noted on posterior surfaces. AI service temporarily unavailable — showing estimated result.',
  suggestedActions: [
    'Professional scaling and polishing',
    'Improve interdental cleaning routine',
    'Follow up at next scheduled appointment',
  ],
};

const SIMULATE_PROMPT = (analysis) => `You are an aesthetic treatment simulation AI.
Given this skin analysis, generate a realistic improvement simulation plan.

SKIN ANALYSIS:
${JSON.stringify(analysis, null, 2)}

Output ONLY a valid JSON object with this exact structure:
{
  "targetImprovements": ["Reduce acne redness by ~25%", "Improve skin tone evenness"],
  "simulationDirectives": "One paragraph of specific, conservative visual improvement instructions for image editing. Identity must be preserved. No structural changes. Improvements capped at 20-40%.",
  "estimatedOutcome": {
    "overallImprovement": "25%",
    "timeframeWeeks": 8,
    "confidence": "moderate"
  }
}

Rules:
- Improvements must be subtle (20–40% max) and medically realistic
- No beauty filter effects — only address the identified concerns
- Do NOT suggest changing facial structure, bone structure, or identity
- If no concerns detected, return improvements as empty array with 0% improvement`;

// ─── Mock fallbacks ───────────────────────────────────────────────────────────

const MOCK_ANALYSIS = {
  concerns: ['acne', 'pigmentation'],
  severity: { acne: 'mild', pigmentation: 'moderate' },
  notes: 'Visible mild acne primarily on the forehead area with some uneven skin tone on the cheeks. AI service temporarily unavailable — showing estimated result.',
};

const MOCK_SIMULATE = (imageUrl, analysis) => ({
  success: true,
  before: imageUrl,
  after: imageUrl,
  targetImprovements: ['Reduce acne visibility by ~25%', 'Even skin tone on cheeks', 'Reduce redness'],
  simulationDirectives: 'Subtle reduction in redness and acne spots. Slight brightening of uneven areas. No structural changes.',
  estimatedOutcome: { overallImprovement: '25%', timeframeWeeks: 8, confidence: 'moderate' },
  disclaimer: 'This is a simulated outcome for planning purposes only. Actual results depend on individual response to treatment. This is not a medical diagnosis.',
  mock: true,
});

// ─── Analysis → multi-light adapter ──────────────────────────────────────────
//
// Converts a Gemini skin analysis { concerns, severity } into the synthetic
// multiLightFindings + crossLightInsights structure that skinLightMapper expects.
//
// This is a best-effort projection: a single-camera image cannot produce true
// multi-light data, so we synthesise plausible light-source signals from the
// reported concerns and their severity grades. The engine then applies its full
// cross-validation logic on top of these signals.
//
// Severity scale used internally:
//   none / absent → 0  |  mild → 1  |  moderate → 2  |  severe → 3

const SEV_SCORE = { none: 0, absent: 0, mild: 1, moderate: 2, severe: 3 };

function sevScore(analysis, concern) {
  const raw = (analysis.severity || {})[concern];
  const key = typeof raw === 'string' ? raw.toLowerCase() : 'none';
  return SEV_SCORE[key] ?? 0;
}

function analysisToLightFindings(analysis) {
  const concerns = Array.isArray(analysis.concerns) ? analysis.concerns : [];
  const has = (c) => concerns.includes(c);

  // ── Numeric proxies derived from severity ──────────────────────────────────
  const acneSev    = sevScore(analysis, 'acne');
  const pigSev     = sevScore(analysis, 'pigmentation');
  const darkSev    = sevScore(analysis, 'dark_spots');
  const rednSev    = sevScore(analysis, 'redness');
  const senseSev   = sevScore(analysis, 'sensitivity');
  const drySev     = sevScore(analysis, 'dryness');
  const oilSev     = sevScore(analysis, 'oiliness');
  const poreSev    = sevScore(analysis, 'enlarged_pores');
  const fineSev    = sevScore(analysis, 'fine_lines');
  const unevenSev  = sevScore(analysis, 'uneven_tone');

  // ── multiLightFindings ────────────────────────────────────────────────────
  const multiLightFindings = {

    natural: {
      texture:    (has('fine_lines') || has('uneven_tone')) ? (unevenSev >= 2 ? 'rough' : 'uneven') : 'normal',
      redness:    has('redness') ? (rednSev >= 2 ? 'diffuse' : 'localised') : 'none',
      unevenTone: has('uneven_tone') ? (unevenSev >= 2 ? 'moderate' : 'mild') : 'none',
    },

    blueLight: {
      // Blue light maps sebaceous / acne activity
      sebumPattern: has('acne') || has('oiliness')
        ? (acneSev >= 3 || oilSev >= 3 ? 'high' : acneSev >= 2 || oilSev >= 2 ? 'moderate' : 'normal')
        : 'normal',
      acneScore:    has('acne') ? acneSev * 25 : 0,          // 0, 25, 50, 75
      poreClogging: has('enlarged_pores') || has('acne')
        ? (poreSev >= 2 || acneSev >= 2 ? 'significant' : 'mild')
        : 'none',
    },

    greenLight: {
      // Green selectively shows oxyhemoglobin → redness / vascular
      erythemaPattern:  has('redness') || has('sensitivity')
        ? (rednSev >= 3 ? 'severe' : rednSev >= 2 ? 'diffuse' : 'localised')
        : 'absent',
      vascularActivity: has('redness') ? (rednSev >= 2 ? 'elevated' : 'mildly_elevated') : 'normal',
      sensitivityIndex: has('sensitivity') ? senseSev * 25 : (has('redness') ? 30 : 0),
    },

    redLight: {
      // Red light penetrates deep → dermal pigmentation
      deepPigmentation: (has('pigmentation') && pigSev >= 2) || has('dark_spots')
        ? (pigSev >= 3 || darkSev >= 3 ? 'severe' : 'moderate')
        : 'none',
      subdermalActivity: (has('pigmentation') && pigSev >= 3) ? 'elevated' : 'normal',
    },

    uvLight: {
      // UV maps sun damage and surface porphyrins / pigmentation
      sunDamage:              (has('pigmentation') || has('dark_spots'))
        ? (pigSev >= 3 ? 'severe' : pigSev >= 2 ? 'moderate' : 'mild')
        : 'none',
      superficialPigmentation: has('pigmentation') || has('dark_spots')
        ? (pigSev >= 2 || darkSev >= 2 ? 'present' : 'faint')
        : 'none',
    },

    rakingFlash: {
      // Raking (oblique) light reveals surface relief — texture, scars, pore depth
      scarDepth:    'none',          // single-image AI cannot confirm scar depth
      textureRidges: has('fine_lines') || has('uneven_tone')
        ? (fineSev >= 2 || unevenSev >= 2 ? 'prominent' : 'mild')
        : 'minimal',
      poreDepth:    has('enlarged_pores')
        ? (poreSev >= 2 ? 'enlarged' : 'mildly_enlarged')
        : 'normal',
    },

    woodsLamp: {
      // Wood's lamp is best for dehydration / fungal
      dehydration: has('dryness')
        ? (drySev >= 3 ? 'severe' : drySev >= 2 ? 'moderate' : 'mild')
        : 'none',
      fungalPresence: 'none',
    },
  };

  // ── crossLightInsights ────────────────────────────────────────────────────
  // Track which synthetic light sources each finding appears in, to activate
  // the cross-light priority boost inside skinLightMapper.
  const crossLightInsights = {};

  // Pigmentation: project across all lights where signal was generated
  if (has('pigmentation') || has('dark_spots')) {
    const pigLights = ['uvLight'];
    if (pigSev >= 2 || darkSev >= 2) pigLights.push('natural');
    if (pigSev >= 2)                 pigLights.push('blueLight');
    if (pigSev >= 2)                 pigLights.push('redLight');
    crossLightInsights.pigmentation = {
      visibleInNatural: pigSev >= 2 || darkSev >= 2,
      visibleInBlue:    pigSev >= 2,
      visibleInRed:     pigSev >= 2,
      confirmedAcross:  pigLights,
    };
  }

  // Sebum / acne
  if (has('acne') || has('oiliness')) {
    const sebLights = ['blueLight'];
    if (has('acne') && acneSev >= 2) sebLights.push('natural');
    crossLightInsights.sebum = { confirmedAcross: sebLights };
  }

  // Redness
  if (has('redness') || has('sensitivity')) {
    const redLights = ['greenLight'];
    if (has('redness') && rednSev >= 2) redLights.push('natural');
    crossLightInsights.redness = { confirmedAcross: redLights };
  }

  // Pores
  if (has('enlarged_pores')) {
    crossLightInsights.pores = { confirmedAcross: ['blueLight', 'rakingFlash'] };
  }

  // Dehydration
  if (has('dryness')) {
    crossLightInsights.dehydration = { confirmedAcross: ['woodsLamp'] };
  }

  // Texture
  if (has('fine_lines') || has('uneven_tone')) {
    crossLightInsights.texture = { confirmedAcross: ['natural', 'rakingFlash'] };
  }

  return { multiLightFindings, crossLightInsights };
}

/**
 * deriveRecommendedTreatments(analysis)
 *
 * Runs the multi-light skin mapping engine on a Gemini analysis object.
 * Returns a clean array — no price fields, always includes measuredJustification.
 * Never throws; returns [] on engine error.
 */
function deriveRecommendedTreatments(analysis) {
  try {
    const { multiLightFindings, crossLightInsights } = analysisToLightFindings(analysis);
    const raw = mapSkinTreatments({ multiLightFindings, crossLightInsights });

    // Strip any price/cost fields that may surface from catalogue joins later
    return raw.map(({ treatment, target, priority, lightsInvolved, measuredJustification }) => ({
      treatment,
      target,
      priority,
      lightsInvolved,
      measuredJustification,
    }));
  } catch (err) {
    console.warn('[ai/analyze] treatment mapping error (non-fatal):', err.message);
    return [];
  }
}

// ─── Input validation helpers ─────────────────────────────────────────────────

/** Validate a single URL string — must be http or https. Returns error string or null. */
function validateHttpUrl(url) {
  try {
    const p = new URL(url);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return 'Only http/https URLs are accepted';
    return null;
  } catch {
    return 'Invalid URL format';
  }
}

// ─── POST /ai/analyze ─────────────────────────────────────────────────────────
// Skin (default):
//   Body: { imageUrl } | { imageBase64, mimeType }
//
// Dental:
//   Body: {
//     scanType: "dental",
//     photoURLs: ["https://..."],          // one or more dental images
//     painLevel, swelling, selectedAreas,  // patient context
//     questionnaireAnswers: { ... }
//   }

router.post('/analyze', async (req, res) => {
  const body = req.body || {};
  const scanType = typeof body.scanType === 'string' ? body.scanType.toLowerCase() : 'skin';

  // ── Branch: dental ──────────────────────────────────────────────────────────
  if (scanType === 'dental') {
    return handleDentalAnalysis(body, res);
  }

  // ── Branch: skin (original behaviour) ───────────────────────────────────────
  return handleSkinAnalysis(body, res);
});

// ── Skin handler ──────────────────────────────────────────────────────────────
async function handleSkinAnalysis({ imageUrl, imageBase64, mimeType }, res) {
  if (!imageUrl && !imageBase64) {
    return res.status(400).json({
      success: false,
      error: 'Provide imageUrl or imageBase64 in the request body',
    });
  }

  if (imageUrl) {
    const err = validateHttpUrl(imageUrl);
    if (err) return res.status(400).json({ success: false, error: `Invalid imageUrl: ${err}` });
  }

  try {
    let base64Data, imageMimeType;

    if (imageBase64) {
      base64Data    = imageBase64;
      imageMimeType = mimeType || 'image/jpeg';
    } else {
      const fetched = await fetchImageAsBase64(imageUrl);
      base64Data    = fetched.data;
      imageMimeType = fetched.mimeType;
    }

    const rawText = await callGemini({
      textPrompt: ANALYZE_PROMPT,
      imageBase64: base64Data,
      imageMimeType,
      jsonMode: true,
    });

    let analysis;
    try { analysis = JSON.parse(rawText); }
    catch { throw new Error(`Gemini returned non-JSON: ${rawText.slice(0, 100)}`); }

    if (!Array.isArray(analysis.concerns) || typeof analysis.severity !== 'object') {
      throw new Error('Unexpected analysis shape from Gemini');
    }

    return res.json({
      success: true,
      scanType: 'skin',
      analysis,
      recommendedTreatments: deriveRecommendedTreatments(analysis),
    });

  } catch (err) {
    console.error('[/ai/analyze skin] AI error, using fallback:', err.message);
    return res.json({
      success: true,
      scanType: 'skin',
      analysis: MOCK_ANALYSIS,
      recommendedTreatments: deriveRecommendedTreatments(MOCK_ANALYSIS),
      mock: true,
      _error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

// ── Dental handler ────────────────────────────────────────────────────────────
async function handleDentalAnalysis(body, res) {
  const {
    photoURLs            = [],
    painLevel,
    swelling,
    selectedAreas,
    questionnaireAnswers = {},
  } = body;

  // Require at least one photo URL
  if (!Array.isArray(photoURLs) || photoURLs.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Dental analysis requires at least one URL in photoURLs[]',
    });
  }

  // Cap at 5 images to avoid oversized payloads
  const urlsToProcess = photoURLs.slice(0, 5);

  // Validate every URL before fetching
  for (const url of urlsToProcess) {
    if (typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'Each photoURL must be a string' });
    }
    const err = validateHttpUrl(url);
    if (err) return res.status(400).json({ success: false, error: `Invalid photoURL "${url}": ${err}` });
  }

  // Build patient-context-aware prompt
  const prompt = buildDentalPrompt({
    painLevel,
    swelling,
    selectedAreas,
    questionnaireAnswers,
  });

  try {
    // Fetch all images in parallel
    const images = await Promise.all(
      urlsToProcess.map((url) => fetchImageAsBase64(url))
    );

    const rawText = await callGeminiMultiImage({ textPrompt: prompt, images, jsonMode: true });

    let analysis;
    try { analysis = JSON.parse(rawText); }
    catch { throw new Error(`Gemini returned non-JSON: ${rawText.slice(0, 100)}`); }

    // Validate dental response shape
    if (!Array.isArray(analysis.findings) || typeof analysis.severity !== 'object') {
      throw new Error('Unexpected dental analysis shape from Gemini');
    }

    return res.json({
      success: true,
      scanType: 'dental',
      photoCount: images.length,
      patientContext: {
        painLevel:           painLevel          ?? null,
        swelling:            swelling           ?? null,
        selectedAreas:       selectedAreas      ?? [],
        questionnaireAnswers,
      },
      analysis,
    });

  } catch (err) {
    console.error('[/ai/analyze dental] AI error, using fallback:', err.message);

    // Elevate urgency in mock if patient signals emergency (best-effort)
    const mock = { ...DENTAL_MOCK_ANALYSIS };
    const pain = parseFloat(painLevel);
    const qa   = questionnaireAnswers;
    if (
      (Number.isFinite(pain) && pain >= 7) ||
      String(swelling).toLowerCase() === 'yes' ||
      String(qa.spontaneousPain).toLowerCase() === 'yes' ||
      String(qa.badTaste).toLowerCase() === 'yes'
    ) {
      mock.urgencyTier = 'urgent';
      mock.interpretation =
        'Patient-reported high pain or swelling detected. ' + mock.interpretation;
    }

    return res.json({
      success: true,
      scanType: 'dental',
      photoCount: urlsToProcess.length,
      patientContext: {
        painLevel:           painLevel          ?? null,
        swelling:            swelling           ?? null,
        selectedAreas:       selectedAreas      ?? [],
        questionnaireAnswers,
      },
      analysis: mock,
      mock: true,
      _error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}

// ─── POST /ai/simulate ────────────────────────────────────────────────────────
// Body: { imageUrl: "...", analysis?: { concerns, severity, notes } }
// If analysis is not provided, a text-based simulation plan is generated without vision.

router.post('/simulate', async (req, res) => {
  const { imageUrl, analysis } = req.body || {};

  if (!imageUrl || typeof imageUrl !== 'string') {
    return res.status(400).json({ success: false, error: 'imageUrl is required' });
  }

  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only http/https URLs are accepted');
    }
  } catch (e) {
    return res.status(400).json({ success: false, error: `Invalid imageUrl: ${e.message}` });
  }

  // Use provided analysis or a minimal placeholder
  const skinAnalysis = analysis || {
    concerns: [],
    severity: {},
    notes: 'No prior analysis provided.',
  };

  try {
    const rawText = await callGemini({
      textPrompt: SIMULATE_PROMPT(skinAnalysis),
      jsonMode: true,
    });

    let plan;
    try {
      plan = JSON.parse(rawText);
    } catch {
      throw new Error(`Gemini returned non-JSON: ${rawText.slice(0, 100)}`);
    }

    return res.json({
      success: true,
      before: imageUrl,
      after: imageUrl,            // Image generation (Imagen) requires paid Gemini tier.
      targetImprovements: plan.targetImprovements || [],
      simulationDirectives: plan.simulationDirectives || '',
      estimatedOutcome: plan.estimatedOutcome || {},
      disclaimer: 'This simulation plan is for aesthetic planning purposes only and does not constitute medical advice. Actual results vary per individual.',
    });

  } catch (err) {
    console.error('[/ai/simulate] AI error, using fallback:', err.message);
    return res.json({
      ...MOCK_SIMULATE(imageUrl, skinAnalysis),
      _error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
});

module.exports = router;
