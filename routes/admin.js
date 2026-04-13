'use strict';

const { Router } = require('express');
const db = require('../db/database');

const router = Router();

const VALID_STATUSES = ['active', 'suspended', 'inactive'];

// GET /admin/doctors
router.get('/doctors', (_req, res) => {
  try {
    const doctors = db.getDoctors();
    res.json({ success: true, doctors, total: doctors.length });
  } catch (err) {
    console.error('[GET /admin/doctors]', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch doctors' });
  }
});

// POST /admin/doctors/create
router.post('/doctors/create', (req, res) => {
  const { name, email, specialty } = req.body || {};

  if (!name || !email || !specialty) {
    return res.status(400).json({ success: false, error: 'name, email, and specialty are required' });
  }

  try {
    if (db.getDoctorByEmail(email)) {
      return res.status(409).json({ success: false, error: 'A doctor with this email already exists' });
    }
    const doctor = db.createDoctor({ name, email, specialty });
    res.status(201).json({ success: true, doctor });
  } catch (err) {
    console.error('[POST /admin/doctors/create]', err.message);
    res.status(500).json({ success: false, error: 'Failed to create doctor' });
  }
});

// PATCH /admin/doctors/:id/status
router.patch('/doctors/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      error: `status must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }

  try {
    if (!db.getDoctorById(id)) {
      return res.status(404).json({ success: false, error: 'Doctor not found' });
    }
    const doctor = db.updateDoctorStatus(id, status);
    res.json({ success: true, doctor });
  } catch (err) {
    console.error('[PATCH /admin/doctors/:id/status]', err.message);
    res.status(500).json({ success: false, error: 'Failed to update doctor status' });
  }
});

module.exports = router;
