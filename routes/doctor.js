'use strict';

const { Router } = require('express');
const db = require('../db/database');

const router = Router();

// ─── Clinical risk score computation ─────────────────────────────────────────
//
// Produces a 0–100 score from patient-reported context + AI analysis output.
// Used so doctors can triage at a glance without reading the full analysis.
//
// Scoring breakdown (additive, clamped to 100):
//   urgencyTier (dental):  emergency=40 | urgent=25 | soon=10 | routine=0
//   painLevel (0–10):      scaled ×3   → max 30 pts
//   swelling = yes:        +15
//   spontaneousPain = yes: +10
//   badTaste = yes:        +5
//   per "severe" finding:  +4  (capped at +20)
//   per "moderate" finding:+2  (capped at +10)

function computeClinicalRiskScore({ aiAnalysis = {}, painLevel, swelling, questionnaireAnswers = {} }) {
  let score = 0;

  // urgencyTier contribution (dental scans)
  const urgency = typeof aiAnalysis.urgencyTier === 'string'
    ? aiAnalysis.urgencyTier.toLowerCase() : '';
  if (urgency === 'emergency') score += 40;
  else if (urgency === 'urgent') score += 25;
  else if (urgency === 'soon')   score += 10;

  // Pain level — 0–10 numeric scale
  const pain = parseFloat(painLevel);
  if (Number.isFinite(pain)) score += Math.round(Math.min(pain, 10) * 3);

  // Swelling
  if (String(swelling).toLowerCase() === 'yes') score += 15;

  // Questionnaire flags
  const qa = questionnaireAnswers || {};
  if (String(qa.spontaneousPain).toLowerCase() === 'yes') score += 10;
  if (String(qa.badTaste).toLowerCase()        === 'yes') score += 5;

  // Severity counts from AI analysis (works for both skin + dental)
  const severity = typeof aiAnalysis.severity === 'object' && aiAnalysis.severity
    ? aiAnalysis.severity : {};
  let severePts = 0, moderatePts = 0;
  for (const grade of Object.values(severity)) {
    const g = String(grade).toLowerCase();
    if (g === 'severe')   severePts   += 4;
    if (g === 'moderate') moderatePts += 2;
  }
  score += Math.min(severePts, 20);
  score += Math.min(moderatePts, 10);

  return Math.min(100, Math.max(0, score));
}

// GET /doctor/patients
router.get('/patients', (_req, res) => {
  try {
    const patients = db.getPatients();
    res.json({ success: true, patients, total: patients.length });
  } catch (err) {
    console.error('[GET /doctor/patients]', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch patients' });
  }
});

// POST /doctor/treatments/create
router.post('/treatments/create', (req, res) => {
  const { patientId, treatments, notes, sessionsTotal, doctorId } = req.body || {};

  if (!patientId || !treatments || !Array.isArray(treatments) || treatments.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'patientId and a non-empty treatments array are required',
    });
  }

  try {
    const patient = db.getPatientById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    const resolvedDoctorId = doctorId || 'doctor-001';
    const doctor = db.getDoctorById(resolvedDoctorId);
    const doctorName = doctor ? doctor.name : 'Unknown Doctor';

    const plan = db.createTreatmentPlan({
      patientId,
      patientName: patient.name,
      doctorId: resolvedDoctorId,
      doctorName,
      treatments,
      notes,
      sessionsTotal,
    });

    res.status(201).json({ success: true, plan });
  } catch (err) {
    console.error('[POST /doctor/treatments/create]', err.message);
    res.status(500).json({ success: false, error: 'Failed to create treatment plan' });
  }
});

// ─── POST /doctor/scans/save ──────────────────────────────────────────────────
// Persists a completed AI scan together with full patient context.
//
// Body:
// {
//   patientId,
//   scanType,          // "skin" | "dental"
//   aiAnalysis,        // full object from /ai/analyze → analysis
//   photoUrls,         // array of image URLs
//   painLevel,         // 0–10
//   swelling,          // "yes" | "no"
//   selectedAreas,     // string[]
//   questionnaireAnswers,
//   clinicalRiskScore, // optional — computed server-side if omitted
//   savedByDoctorId,
//   notes,
// }

router.post('/scans/save', (req, res) => {
  const {
    patientId,
    scanType             = 'skin',
    aiAnalysis,
    photoUrls            = [],
    painLevel            = null,
    swelling             = null,
    selectedAreas        = [],
    questionnaireAnswers = {},
    savedByDoctorId      = null,
    notes                = '',
  } = req.body || {};

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!patientId) {
    return res.status(400).json({ success: false, error: 'patientId is required' });
  }
  if (!aiAnalysis || typeof aiAnalysis !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'aiAnalysis is required and must be the full analysis object from /ai/analyze',
    });
  }

  const validScanTypes = ['skin', 'dental'];
  if (!validScanTypes.includes(scanType)) {
    return res.status(400).json({
      success: false,
      error: `scanType must be one of: ${validScanTypes.join(', ')}`,
    });
  }

  try {
    // Verify the patient exists
    const patient = db.getPatientById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }

    // Always compute server-side so doctors cannot receive a manipulated score
    const clinicalRiskScore = computeClinicalRiskScore({
      aiAnalysis,
      painLevel,
      swelling,
      questionnaireAnswers,
    });

    const scan = db.createScanResult({
      patientId,
      scanType,
      aiAnalysis,
      photoUrls,
      painLevel,
      swelling,
      selectedAreas,
      questionnaireAnswers,
      clinicalRiskScore,
      savedByDoctorId,
      notes,
    });

    return res.status(201).json({ success: true, scan });
  } catch (err) {
    console.error('[POST /doctor/scans/save]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to save scan result' });
  }
});

// ─── GET /doctor/patients/:id/scans ───────────────────────────────────────────
// Returns all saved scan results for a patient — full case view for the doctor.

router.get('/patients/:id/scans', (req, res) => {
  const { id } = req.params;
  try {
    const patient = db.getPatientById(id);
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Patient not found' });
    }
    const scans = db.getScanResultsByPatient(id);
    return res.json({ success: true, patient, scans, total: scans.length });
  } catch (err) {
    console.error('[GET /doctor/patients/:id/scans]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch scan results' });
  }
});

// ─── GET /doctor/scans/:id ────────────────────────────────────────────────────
// Returns a single scan result with full patient context.

router.get('/scans/:id', (req, res) => {
  try {
    const scan = db.getScanResultById(req.params.id);
    if (!scan) {
      return res.status(404).json({ success: false, error: 'Scan result not found' });
    }
    return res.json({ success: true, scan });
  } catch (err) {
    console.error('[GET /doctor/scans/:id]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch scan result' });
  }
});

module.exports = router;
