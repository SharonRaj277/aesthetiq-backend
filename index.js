'use strict';

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
}));

app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'AesthetiQ Backend', port: 5000 }));

// ─── Feature routes ───────────────────────────────────────────────────────────
app.use('/auth',     require('./routes/auth'));
app.use('/admin',    require('./routes/admin'));
app.use('/doctor',   require('./routes/doctor'));
app.use('/patient',  require('./routes/patient'));
app.use('/ai',       require('./routes/ai'));
app.use('/analysis', require('./routes/analysis'));
console.log('  ✓ /auth, /admin, /doctor, /patient, /ai, /analysis routes mounted');

// ─── Scan unlock ──────────────────────────────────────────────────────────────
// POST /api/scan/unlock  — called by frontend after successful payment
//
// Security checks (in order):
//   1. Valid Bearer token required (patient or doctor role).
//   2. Scan must exist.
//   3. Ownership: patient can only unlock their own scan;
//                 doctor/admin can unlock any scan.
//   4. Optional: paymentVerified must be true if provided.
const db = require('./db/database');
const { requireAuth } = require('./middleware/auth');

app.post('/api/scan/unlock', requireAuth(['patient', 'doctor', 'admin']), (req, res) => {
  const { scanId, patientId, paymentVerified } = req.body || {};

  if (!scanId || typeof scanId !== 'string' || !scanId.trim()) {
    return res.status(400).json({ success: false, error: 'scanId is required' });
  }

  // If caller supplied paymentVerified explicitly and it is false, reject early.
  if (paymentVerified !== undefined && paymentVerified !== true) {
    return res.status(402).json({
      success: false,
      error: 'Payment not verified — scan cannot be unlocked',
    });
  }

  try {
    const existing = db.getScanResultById(scanId.trim());
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Scan not found' });
    }

    // Ownership check — patients may only unlock their own scans
    const { id: callerId, role } = req.user;
    if (role === 'patient') {
      // The scan's patientId must match either the token id or the supplied patientId
      const claimedPatientId = (patientId || callerId).toString();
      if (existing.patientId !== claimedPatientId || existing.patientId !== callerId) {
        return res.status(403).json({
          success: false,
          error: 'You are not authorised to unlock this scan',
        });
      }
    }
    // Doctors and admins pass the ownership check unconditionally.

    if (existing.isUnlocked) {
      // Already unlocked — idempotent success
      return res.json({ success: true, alreadyUnlocked: true });
    }

    const updated = db.unlockScanResult(scanId.trim());
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Failed to unlock scan' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /api/scan/unlock]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to unlock scan' });
  }
});

// ─── GET /api/analytics/funnel ───────────────────────────────────────────────
// Returns funnel step counts and conversion rates.
// Expected event names (sent by frontend):
//   scan_started | scan_completed | teaser_viewed | unlock_clicked | payment_success
const FUNNEL_EVENTS = ['scan_started', 'scan_completed', 'teaser_viewed', 'unlock_clicked', 'payment_success'];

function rate(numerator, denominator) {
  if (!denominator) return null;
  return parseFloat((numerator / denominator).toFixed(4));
}

app.get('/api/analytics/funnel', (req, res) => {
  try {
    const counts = db.getFunnelCounts(FUNNEL_EVENTS);
    const {
      scan_started:    started,
      scan_completed:  completed,
      teaser_viewed:   teaserViewed,
      unlock_clicked:  unlockClicked,
      payment_success: paymentSuccess,
    } = counts;

    return res.json({
      success: true,
      funnel: {
        scanStarted:    started,
        scanCompleted:  completed,
        teaserViewed:   teaserViewed,
        unlockClicked:  unlockClicked,
        paymentSuccess: paymentSuccess,
      },
      conversionRates: {
        completionRate: rate(completed,      started),       // completed / started
        clickRate:      rate(unlockClicked,  teaserViewed),  // unlock_clicked / teaser_viewed
        paymentRate:    rate(paymentSuccess, unlockClicked), // payment_success / unlock_clicked
      },
    });
  } catch (err) {
    console.error('[GET /api/analytics/funnel]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to query funnel analytics' });
  }
});

// ─── GET /api/analytics/summary ─────────────────────────────────────────────
// Flat summary of funnel counts + four conversion rates + per-scanType breakdown.
const SCAN_TYPES = ['facial', 'skin', 'dental'];
const BREAKDOWN_EVENTS = ['teaser_viewed', 'unlock_clicked', 'payment_success'];

app.get('/api/analytics/summary', (req, res) => {
  try {
    const counts   = db.getFunnelCounts(FUNNEL_EVENTS);
    const byType   = db.getFunnelCountsByScanType(BREAKDOWN_EVENTS, SCAN_TYPES);

    const total_scans      = counts.scan_started    || 0;
    const completed_scans  = counts.scan_completed  || 0;
    const teaser_views     = counts.teaser_viewed   || 0;
    const unlock_clicks    = counts.unlock_clicked  || 0;
    const payments         = counts.payment_success || 0;

    // Build per-scanType breakdown
    const byTypeFormatted = {};
    for (const st of SCAN_TYPES) {
      const tv = byType[st].teaser_viewed   || 0;
      const uc = byType[st].unlock_clicked  || 0;
      const ps = byType[st].payment_success || 0;
      byTypeFormatted[st] = {
        teaser_views:  tv,
        unlock_clicks: uc,
        payments:      ps,
        click_rate:    rate(uc, tv),
        payment_rate:  rate(ps, uc),
        conversion:    rate(ps, tv),
      };
    }

    return res.json({
      total_scans,
      completed_scans,
      teaser_views,
      unlock_clicks,
      payments,
      completion_rate:    rate(completed_scans, total_scans),
      click_rate:         rate(unlock_clicks,   teaser_views),
      payment_rate:       rate(payments,        unlock_clicks),
      overall_conversion: rate(payments,        teaser_views),
      by_scan_type:       byTypeFormatted,
    });
  } catch (err) {
    console.error('[GET /api/analytics/summary]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to query analytics summary' });
  }
});

// ─── POST /api/analytics/event ───────────────────────────────────────────────
// Stores a funnel event. Auth is optional — anonymous events are accepted so
// pre-login funnel steps (scan_started, scan_viewed) are not lost.
app.post('/api/analytics/event', (req, res) => {
  const { eventName, userId, scanId, scanType, timestamp } = req.body || {};

  if (!eventName || typeof eventName !== 'string' || !eventName.trim()) {
    return res.status(400).json({ success: false, error: 'eventName is required' });
  }

  try {
    const event = db.createAnalyticsEvent({ eventName: eventName.trim(), userId, scanId, scanType, timestamp });
    return res.status(201).json({ success: true, event });
  } catch (err) {
    console.error('[POST /api/analytics/event]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to store event' });
  }
});

// ─── Mount compiled sub-apps ──────────────────────────────────────────────────
try {
  const dentalApp = require('./functions/lib/dental/app').default;
  app.use('/dental', dentalApp);
  console.log('  ✓ /dental routes mounted');
} catch (e) {
  console.warn('  ✗ Could not mount /dental:', e.message);
}

try {
  const { unifiedApiApp } = require('./functions/lib/api/index');
  app.use('/api', unifiedApiApp);
  console.log('  ✓ /api routes mounted');
} catch (e) {
  console.warn('  ✗ Could not mount /api:', e.message);
}

// ─── 404 fallback ─────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ─── JSON parse error handler ─────────────────────────────────────────────────
// Catches malformed JSON bodies (e.g. bare strings, trailing commas) and returns
// a clean 400 JSON response instead of Express's default HTML error page.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON in request body' });
  }
  console.error('[unhandled error]', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\nAesthetiQ backend running on http://localhost:${PORT}`);
  console.log(`CORS enabled for: all origins\n`);
});
