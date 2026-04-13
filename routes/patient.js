'use strict';

const { Router } = require('express');
const db = require('../db/database');

const router = Router();

// Fields that must never reach the patient-facing response
const HIDDEN_FIELDS = new Set(['platformFee', 'doctorEarning', 'internalNotes']);

function toPatientView(plan) {
  return Object.fromEntries(
    Object.entries(plan).filter(([k]) => !HIDDEN_FIELDS.has(k))
  );
}

// GET /patient/treatments
// Query params: ?patientId=  ?status=
router.get('/treatments', (req, res) => {
  const { patientId, status } = req.query;

  try {
    const plans = db.getTreatmentPlans({ patientId, status });
    const treatments = plans.map(toPatientView);
    res.json({ success: true, treatments, total: treatments.length });
  } catch (err) {
    console.error('[GET /patient/treatments]', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch treatments' });
  }
});

module.exports = router;
