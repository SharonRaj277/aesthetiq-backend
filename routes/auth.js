'use strict';

const { Router } = require('express');
const router = Router();

// ─── Mock credentials (replace with real Firebase Auth when ready) ────────────
const ADMIN_CREDENTIALS = { email: 'admin@aesthetiq.com', password: 'admin123' };
const DOCTOR_CREDENTIALS = { email: 'doctor@aesthetiq.com', password: 'doctor123' };

function mockToken(role, id) {
  // Not a real JWT — placeholder until Firebase Auth is wired in
  const payload = Buffer.from(JSON.stringify({ role, id, iat: Date.now() })).toString('base64');
  return `mock.${payload}.token`;
}

// POST /auth/admin-login
router.post('/admin-login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required' });
  }

  if (email === ADMIN_CREDENTIALS.email && password === ADMIN_CREDENTIALS.password) {
    return res.json({
      success: true,
      token: mockToken('admin', 'admin-001'),
      user: { id: 'admin-001', email, role: 'admin', name: 'Admin User' },
    });
  }

  return res.status(401).json({ success: false, error: 'Invalid credentials' });
});

// POST /auth/doctor-login
router.post('/doctor-login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'email and password are required' });
  }

  if (email === DOCTOR_CREDENTIALS.email && password === DOCTOR_CREDENTIALS.password) {
    return res.json({
      success: true,
      token: mockToken('doctor', 'doctor-001'),
      user: { id: 'doctor-001', email, role: 'doctor', name: 'Dr. Sarah Lee', specialty: 'Dermatology' },
    });
  }

  return res.status(401).json({ success: false, error: 'Invalid credentials' });
});

module.exports = router;
