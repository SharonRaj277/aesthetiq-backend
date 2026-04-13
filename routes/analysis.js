'use strict';

/**
 * routes/analysis.js
 *
 * POST /analysis/map-treatments
 *   — Accepts facial measurement inputs
 *   — Returns rule-based treatment recommendations
 */

const { Router } = require('express');
const { mapTreatments } = require('../engine/treatmentMapper');
const { matchTreatments } = require('../engine/treatmentMatcher');
const { mapSkinTreatments } = require('../engine/skinLightMapper');
const axios = require('../functions/node_modules/axios');

const router = Router();

// ─── Accepted measurement fields (for validation / unknown-field warning) ─────
const KNOWN_FIELDS = new Set([
  'symmetryScore', 'facialThirdsBalance', 'goldenRatioScore',
  'gonialAngle', 'jawlineDefinition', 'chinProjection',
  'nasolabialAngle', 'noseWidthRatio', 'lipRatio', 'jawToCheekRatio',
]);

// ─── POST /analysis/map-treatments ───────────────────────────────────────────
router.post('/map-treatments', (req, res) => {
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      error: 'Request body must be a JSON object containing facial measurements',
    });
  }

  // Require at least one recognised field
  const provided = Object.keys(body).filter((k) => KNOWN_FIELDS.has(k));
  if (provided.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'No recognised measurement fields provided',
      expected: [...KNOWN_FIELDS],
    });
  }

  // Warn about unknown fields (don't fail — future fields should not break clients)
  const unknown = Object.keys(body).filter((k) => !KNOWN_FIELDS.has(k));

  let recommendations;
  try {
    recommendations = mapTreatments(body);
  } catch (err) {
    console.error('[POST /analysis/map-treatments]', err.message);
    return res.status(500).json({ success: false, error: 'Mapping engine error' });
  }

  return res.json({
    success: true,
    inputFields: provided,
    recommendations,
    total: recommendations.length,
    ...(unknown.length > 0 ? { unknownFields: unknown } : {}),
  });
});

// ─── GET /analysis/fields — list accepted input fields ────────────────────────
router.get('/fields', (_req, res) => {
  res.json({
    success: true,
    fields: [
      { name: 'symmetryScore',      type: 'number',  range: '0–100',    description: 'Bilateral facial symmetry score' },
      { name: 'facialThirdsBalance',type: 'number',  range: '0–100',    description: 'Balance across upper/mid/lower facial thirds' },
      { name: 'goldenRatioScore',   type: 'number',  range: '0–100',    description: 'Adherence to golden ratio proportions' },
      { name: 'gonialAngle',        type: 'number',  range: 'degrees',  description: 'Angle at the gonion (jaw corner). Ideal ~120°' },
      { name: 'jawlineDefinition',  type: 'string',  values: ['sharp', 'defined', 'soft', 'very_soft'], description: 'Qualitative jawline sharpness' },
      { name: 'chinProjection',     type: 'string',  values: ['prominent', 'normal', 'slightly_recessed', 'recessed'], description: 'Chin position relative to E-plane' },
      { name: 'nasolabialAngle',    type: 'number',  range: 'degrees',  description: 'Angle between columella and upper lip. Ideal 90–120°' },
      { name: 'noseWidthRatio',     type: 'string',  values: ['narrow', 'ideal', 'broad'], description: 'Nose width relative to intercanthal distance' },
      { name: 'lipRatio',           type: 'number',  range: '0.5–2.5',  description: 'Upper:lower lip volume ratio. Ideal ≥ 1.2' },
      { name: 'jawToCheekRatio',    type: 'number',  range: '0.5–1.0',  description: 'Jaw width as fraction of cheek width. Ideal 0.70–0.88' },
    ],
  });
});

// ─── POST /analysis/map-skin-treatments ──────────────────────────────────────
router.post('/map-skin-treatments', (req, res) => {
  const { multiLightFindings, crossLightInsights } = req.body || {};

  if (!multiLightFindings || typeof multiLightFindings !== 'object' || Array.isArray(multiLightFindings)) {
    return res.status(400).json({
      success: false,
      error: 'multiLightFindings must be a JSON object containing per-light findings',
      expectedLights: ['natural', 'blueLight', 'greenLight', 'redLight', 'uvLight', 'rakingFlash', 'woodsLamp'],
    });
  }

  let recommendations;
  try {
    recommendations = mapSkinTreatments({ multiLightFindings, crossLightInsights });
  } catch (err) {
    console.error('[POST /analysis/map-skin-treatments]', err.message);
    return res.status(500).json({ success: false, error: 'Skin mapping engine error' });
  }

  return res.json({
    success: true,
    lightsReceived: Object.keys(multiLightFindings),
    crossLightInsightsReceived: !!crossLightInsights,
    recommendations,
    total: recommendations.length,
  });
});

// ─── Catalogue cache ──────────────────────────────────────────────────────────
// Fetched once per process from the internal /api/treatments endpoints.
let _catalogueCache = null;
let _catalogueFetchedAt = 0;
const CATALOGUE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DOMAINS = ['facial', 'skin', 'dental'];
const INTERNAL_BASE = `http://localhost:${process.env.PORT || 5000}`;

async function getCatalogue(domain) {
  const now = Date.now();
  if (_catalogueCache && now - _catalogueFetchedAt < CATALOGUE_TTL_MS) {
    return domain ? (_catalogueCache[domain] || []) : Object.values(_catalogueCache).flat();
  }

  const fetched = {};
  await Promise.all(
    DOMAINS.map(async (d) => {
      try {
        const resp = await axios.default.get(`${INTERNAL_BASE}/api/treatments?domain=${d}`, { timeout: 5000 });
        const data = resp.data;
        // Normalise: array directly or nested under data/treatments key
        fetched[d] = Array.isArray(data) ? data
                   : Array.isArray(data.treatments) ? data.treatments
                   : Array.isArray(data.data) ? data.data
                   : [];
      } catch {
        fetched[d] = [];
      }
    })
  );

  _catalogueCache = fetched;
  _catalogueFetchedAt = now;

  return domain ? (fetched[domain] || []) : Object.values(fetched).flat();
}

// ─── POST /analysis/match-treatments ─────────────────────────────────────────
router.post('/match-treatments', async (req, res) => {
  const { suggestions, domain } = req.body || {};

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'suggestions must be a non-empty array of objects with a "treatment" field',
    });
  }

  // Each element must have a treatment string
  const invalid = suggestions.filter((s) => !s || typeof s.treatment !== 'string' || !s.treatment.trim());
  if (invalid.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Each suggestion must have a non-empty "treatment" string',
    });
  }

  if (domain && !DOMAINS.includes(domain)) {
    return res.status(400).json({
      success: false,
      error: `domain must be one of: ${DOMAINS.join(', ')}`,
    });
  }

  let catalogue;
  try {
    catalogue = await getCatalogue(domain || null);
  } catch (err) {
    console.error('[POST /analysis/match-treatments] catalogue fetch error:', err.message);
    return res.status(503).json({ success: false, error: 'Could not fetch treatment catalogue' });
  }

  if (catalogue.length === 0) {
    return res.json({
      success: true,
      matches: suggestions.map((s) => ({ original: s.treatment, matched: false, note: 'catalogue unavailable' })),
      total: suggestions.length,
      matchedCount: 0,
    });
  }

  let matches;
  try {
    matches = matchTreatments(suggestions, catalogue);
  } catch (err) {
    console.error('[POST /analysis/match-treatments] matcher error:', err.message);
    return res.status(500).json({ success: false, error: 'Matching engine error' });
  }

  const matchedCount = matches.filter((m) => m.matched).length;

  return res.json({
    success: true,
    domain: domain || 'all',
    matches,
    total: matches.length,
    matchedCount,
  });
});

module.exports = router;
