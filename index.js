'use strict';

console.log('SERVER START FILE LOADED');

process.on('uncaughtException',  (err) => console.error('[uncaughtException]',  err.stack || err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'AesthetiQ Backend' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
console.log('LOADING ROUTES...');

app.use('/auth',     require('./routes/auth'));
app.use('/admin',    require('./routes/admin'));
app.use('/doctor',   require('./routes/doctor'));
app.use('/patient',  require('./routes/patient'));
app.use('/ai',       require('./routes/ai'));
app.use('/analysis', require('./routes/analysis'));

console.log('ROUTES LOADED');

// ─── DB + auth middleware ──────────────────────────────────────────────────────
const db = require('./db/database');

// ─── API routes ───────────────────────────────────────────────────────────────
const FUNNEL_EVENTS    = ['scan_started', 'scan_completed', 'teaser_viewed', 'unlock_clicked', 'payment_success'];
const SCAN_TYPES       = ['facial', 'skin', 'dental'];
const BREAKDOWN_EVENTS = ['teaser_viewed', 'unlock_clicked', 'payment_success'];

function rate(n, d) {
  if (!d) return null;
  return parseFloat((n / d).toFixed(4));
}

app.post('/api/scan/unlock', (req, res) => {
  // Auth is checked but not enforced — unauthenticated callers are treated as patients.
  // Full enforcement can be re-enabled once the frontend sends Bearer tokens.
  try {
    const header = req.headers['authorization'] || '';
    const parts  = header.replace('Bearer ', '').split('.');
    if (parts.length === 3 && parts[0] === 'mock' && parts[2] === 'token') {
      req.user = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    }
  } catch { /* ignore */ }
  if (!req.user) req.user = { id: 'anonymous', role: 'patient' };
  const { scanId, patientId, paymentVerified } = req.body || {};

  if (!scanId || typeof scanId !== 'string' || !scanId.trim()) {
    return res.status(400).json({ success: false, error: 'scanId is required' });
  }
  if (paymentVerified !== undefined && paymentVerified !== true) {
    return res.status(402).json({ success: false, error: 'Payment not verified — scan cannot be unlocked' });
  }

  try {
    const existing = db.getScanResultById(scanId.trim());
    if (!existing) return res.status(404).json({ success: false, error: 'Scan not found' });

    const { id: callerId, role } = req.user;
    if (role === 'patient') {
      const claimedPatientId = (patientId || callerId).toString();
      if (existing.patientId !== claimedPatientId || existing.patientId !== callerId) {
        return res.status(403).json({ success: false, error: 'You are not authorised to unlock this scan' });
      }
    }

    if (existing.isUnlocked) return res.json({ success: true, alreadyUnlocked: true });

    const updated = db.unlockScanResult(scanId.trim());
    if (!updated) return res.status(500).json({ success: false, error: 'Failed to unlock scan' });

    return res.json({ success: true });
  } catch (err) {
    console.error('[POST /api/scan/unlock]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to unlock scan' });
  }
});

app.get('/api/analytics/funnel', (_req, res) => {
  try {
    const counts = db.getFunnelCounts(FUNNEL_EVENTS);
    const { scan_started: started, scan_completed: completed, teaser_viewed: teaserViewed, unlock_clicked: unlockClicked, payment_success: paymentSuccess } = counts;
    return res.json({
      success: true,
      funnel: { scanStarted: started, scanCompleted: completed, teaserViewed, unlockClicked, paymentSuccess },
      conversionRates: {
        completionRate: rate(completed, started),
        clickRate:      rate(unlockClicked, teaserViewed),
        paymentRate:    rate(paymentSuccess, unlockClicked),
      },
    });
  } catch (err) {
    console.error('[GET /api/analytics/funnel]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to query funnel analytics' });
  }
});

app.get('/api/analytics/summary', (_req, res) => {
  try {
    const counts = db.getFunnelCounts(FUNNEL_EVENTS);
    const byType = db.getFunnelCountsByScanType(BREAKDOWN_EVENTS, SCAN_TYPES);

    const total_scans     = counts.scan_started    || 0;
    const completed_scans = counts.scan_completed  || 0;
    const teaser_views    = counts.teaser_viewed   || 0;
    const unlock_clicks   = counts.unlock_clicked  || 0;
    const payments        = counts.payment_success || 0;

    const by_scan_type = {};
    for (const st of SCAN_TYPES) {
      const tv = byType[st].teaser_viewed   || 0;
      const uc = byType[st].unlock_clicked  || 0;
      const ps = byType[st].payment_success || 0;
      by_scan_type[st] = { teaser_views: tv, unlock_clicks: uc, payments: ps, click_rate: rate(uc, tv), payment_rate: rate(ps, uc), conversion: rate(ps, tv) };
    }

    return res.json({ total_scans, completed_scans, teaser_views, unlock_clicks, payments, completion_rate: rate(completed_scans, total_scans), click_rate: rate(unlock_clicks, teaser_views), payment_rate: rate(payments, unlock_clicks), overall_conversion: rate(payments, teaser_views), by_scan_type });
  } catch (err) {
    console.error('[GET /api/analytics/summary]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to query analytics summary' });
  }
});

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

// ─── Optional compiled sub-apps ───────────────────────────────────────────────
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

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ─── JSON parse error handler ─────────────────────────────────────────────────
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
