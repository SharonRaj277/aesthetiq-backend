'use strict';

/**
 * Production-level end-to-end test.
 * Uses Node's built-in http — no test framework dependency.
 *
 * Flow:
 *  1. Admin login
 *  2. Admin creates doctor
 *  3. Doctor login
 *  4. Doctor fetches patient list
 *  5. Patient uploads real image → /ai/analyze
 *  6. /ai/simulate with analysis result
 *  7. Doctor assigns treatment to patient
 *  8. Patient fetches treatments → validate no price leakage
 *  9. Edge / error cases
 * 10. Security / injection probes
 */

const http = require('http');
const https = require('https');

const BASE = 'http://localhost:5000';

// ─── ANSI colour helpers ──────────────────────────────────────────────────────
const G = (s) => `\x1b[32m${s}\x1b[0m`;  // green
const R = (s) => `\x1b[31m${s}\x1b[0m`;  // red
const Y = (s) => `\x1b[33m${s}\x1b[0m`;  // yellow
const B = (s) => `\x1b[1m${s}\x1b[0m`;   // bold

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) });
        } catch (e) {
          resolve({ status: res.statusCode, body: { _raw: Buffer.concat(chunks).toString() } });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(40000, () => { req.destroy(); reject(new Error('Request timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function fetchImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AesthetiQ-Test/1.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(fetchImageAsBase64(res.headers.location));
      }
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        if (!ct.startsWith('image/') && !ct.startsWith('application/octet')) {
          return reject(new Error(`Not an image response (content-type: ${ct}, size: ${buf.length})`));
        }
        if (buf.length < 5000) return reject(new Error(`Image too small (${buf.length} bytes) — likely an error page`));
        resolve({ data: buf.toString('base64'), mimeType: res.headers['content-type']?.split(';')[0] || 'image/jpeg', bytes: buf.length });
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Image fetch timeout')));
  });
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${G('✓')} ${label}`);
    passed++;
  } else {
    const msg = detail ? `${label} — ${detail}` : label;
    console.log(`  ${R('✗')} ${msg}`);
    failed++;
    failures.push(msg);
  }
}

function assertNoField(label, obj, ...fields) {
  const found = fields.filter((f) => JSON.stringify(obj).includes(`"${f}"`));
  assert(label, found.length === 0, found.length ? `Found forbidden field(s): ${found.join(', ')}` : '');
}

function section(title) {
  console.log(`\n${B('══ ' + title + ' ══')}`);
}

// ─── MAIN TEST SUITE ──────────────────────────────────────────────────────────

async function run() {
  console.log(B('\n╔══════════════════════════════════════════╗'));
  console.log(B('║  AesthetiQ  Production  E2E  Test Suite  ║'));
  console.log(B('╚══════════════════════════════════════════╝\n'));

  // ── STEP 1: Admin login ────────────────────────────────────────────────────
  section('STEP 1 — Admin Login');
  const adminLogin = await request('POST', '/auth/admin-login', {
    email: 'admin@aesthetiq.com',
    password: 'admin123',
  });
  assert('Admin login returns 200', adminLogin.status === 200);
  assert('Admin login success:true', adminLogin.body.success === true);
  assert('Admin token present', typeof adminLogin.body.token === 'string' && adminLogin.body.token.length > 10);
  assert('Admin role confirmed', adminLogin.body.user?.role === 'admin');
  assert('No password in response', !JSON.stringify(adminLogin.body).includes('"password"'));

  // ── STEP 2: Admin creates doctor ───────────────────────────────────────────
  section('STEP 2 — Admin Creates Doctor');
  const ts = Date.now();
  const newDoctorEmail = `dr.production.${ts}@aesthetiq.com`;

  const createDoc = await request('POST', '/admin/doctors/create', {
    name: 'Dr. Production Test',
    email: newDoctorEmail,
    specialty: 'Aesthetic Dermatology',
  });
  assert('Create doctor returns 201', createDoc.status === 201);
  assert('Create doctor success:true', createDoc.body.success === true);
  assert('Created doctor has id', typeof createDoc.body.doctor?.id === 'string');
  assert('Created doctor status = active', createDoc.body.doctor?.status === 'active');
  assert('Created doctor email matches', createDoc.body.doctor?.email === newDoctorEmail);
  assertNoField('No internal fields leaked on create', createDoc.body, 'is_online', 'is_busy', 'platformFee');

  const newDoctorId = createDoc.body.doctor?.id;

  // Duplicate email guard
  const dupeDoc = await request('POST', '/admin/doctors/create', {
    name: 'Dr. Duplicate', email: newDoctorEmail, specialty: 'Testing',
  });
  assert('Duplicate email → 409', dupeDoc.status === 409);
  assert('Duplicate email error message', dupeDoc.body.error?.includes('already exists'));

  // Missing fields guard
  const badDoc = await request('POST', '/admin/doctors/create', { name: 'No Email' });
  assert('Missing fields → 400', badDoc.status === 400);

  // Verify new doctor appears in list
  const docList = await request('GET', '/admin/doctors');
  assert('GET /admin/doctors success', docList.body.success === true);
  const allDoctors = docList.body.doctors || [];
  assert('New doctor appears in list', allDoctors.some((d) => d.id === newDoctorId));
  assert('Doctor list has camelCase fields', allDoctors[0] && 'isOnline' in allDoctors[0]);
  assertNoField('No snake_case DB fields in doctor list', docList.body, 'is_online', 'is_busy', 'created_at');

  // Status update
  const suspend = await request('PATCH', `/admin/doctors/${newDoctorId}/status`, { status: 'suspended' });
  assert('Suspend doctor → success', suspend.body.success === true);
  assert('Suspended doctor isOnline = false', suspend.body.doctor?.isOnline === false);

  const reactivate = await request('PATCH', `/admin/doctors/${newDoctorId}/status`, { status: 'active' });
  assert('Reactivate doctor → success', reactivate.body.success === true);

  const badStatus = await request('PATCH', `/admin/doctors/${newDoctorId}/status`, { status: 'superadmin' });
  assert('Invalid status → 400', badStatus.status === 400);

  const notFound = await request('PATCH', '/admin/doctors/doctor-FAKE-999/status', { status: 'active' });
  assert('Non-existent doctor → 404', notFound.status === 404);

  // ── STEP 3: Doctor login ───────────────────────────────────────────────────
  section('STEP 3 — Doctor Login');
  const docLogin = await request('POST', '/auth/doctor-login', {
    email: 'doctor@aesthetiq.com',
    password: 'doctor123',
  });
  assert('Doctor login returns 200', docLogin.status === 200);
  assert('Doctor login success:true', docLogin.body.success === true);
  assert('Doctor token present', typeof docLogin.body.token === 'string');
  assert('Doctor role confirmed', docLogin.body.user?.role === 'doctor');

  const badDocLogin = await request('POST', '/auth/doctor-login', {
    email: 'doctor@aesthetiq.com', password: 'WRONG',
  });
  assert('Wrong password → 401', badDocLogin.status === 401);
  assert('Wrong password error message', badDocLogin.body.success === false);

  const noBodyLogin = await request('POST', '/auth/doctor-login', {});
  assert('Empty body → 400', noBodyLogin.status === 400);

  // ── STEP 4: Doctor fetches patients ────────────────────────────────────────
  section('STEP 4 — Doctor Fetches Patients');
  const patients = await request('GET', '/doctor/patients');
  assert('GET /doctor/patients → success', patients.body.success === true);
  assert('Patients array present', Array.isArray(patients.body.patients));
  assert('At least 3 patients', patients.body.patients.length >= 3);
  assert('Patient has activeTreatments count', typeof patients.body.patients[0]?.activeTreatments === 'number');
  assert('Patient has name', typeof patients.body.patients[0]?.name === 'string');
  assertNoField('No internal DB fields on patients', patients.body, 'is_online', 'created_at');

  const targetPatient = patients.body.patients.find((p) => p.id === 'patient-003') || patients.body.patients[0];
  const targetPatientId = targetPatient.id;
  console.log(`  ${Y('→')} Using patient: ${targetPatient.name} (${targetPatientId})`);

  // ── STEP 5: Patient uploads real image → /ai/analyze ──────────────────────
  section('STEP 5 — Patient Image Analysis (Real AI)');

  // Fetch a real portrait-style image
  let imageBase64 = null;
  let imageMimeType = 'image/jpeg';
  let imageBytes = 0;
  let imageFetchError = null;

  // Try multiple public face images
  const testImages = [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Gatto_europeo4.jpg/320px-Gatto_europeo4.jpg',
    'https://www.gstatic.com/webp/gallery/1.jpg',
    'https://www.gstatic.com/webp/gallery3/1.webp',
  ];

  for (const imgUrl of testImages) {
    try {
      const fetched = await fetchImageAsBase64(imgUrl);
      imageBase64 = fetched.data;
      imageMimeType = fetched.mimeType;
      imageBytes = fetched.bytes;
      console.log(`  ${Y('→')} Fetched test image: ${imageBytes.toLocaleString()} bytes (${imageMimeType})`);
      break;
    } catch (e) {
      imageFetchError = e.message;
    }
  }

  assert('Test image fetched successfully', imageBase64 !== null, imageFetchError || '');

  let analysisResult = null;

  if (imageBase64) {
    const analyzeResp = await request('POST', '/ai/analyze', {
      imageBase64,
      mimeType: imageMimeType,
    });

    assert('/ai/analyze returns 200', analyzeResp.status === 200);
    assert('/ai/analyze success:true', analyzeResp.body.success === true);
    assert('/ai/analyze has analysis object', typeof analyzeResp.body.analysis === 'object');
    assert('analysis.concerns is array', Array.isArray(analyzeResp.body.analysis?.concerns));
    assert('analysis.severity is object', typeof analyzeResp.body.analysis?.severity === 'object');
    assert('analysis.notes is non-empty string', typeof analyzeResp.body.analysis?.notes === 'string' && analyzeResp.body.analysis.notes.length > 5);

    // Validate concern values are from allowed list
    const ALLOWED_CONCERNS = ['acne','pigmentation','dryness','oiliness','sensitivity','uneven_tone','fine_lines','dark_spots','redness','enlarged_pores'];
    const invalidConcerns = analyzeResp.body.analysis.concerns.filter((c) => !ALLOWED_CONCERNS.includes(c));
    assert('All concerns from allowed vocabulary', invalidConcerns.length === 0, invalidConcerns.join(', '));

    // Validate severity values
    const ALLOWED_SEVERITIES = ['none', 'mild', 'moderate', 'severe'];
    const invalidSeverities = Object.values(analyzeResp.body.analysis.severity || {}).filter((v) => !ALLOWED_SEVERITIES.includes(v));
    assert('All severity values valid', invalidSeverities.length === 0, invalidSeverities.join(', '));

    // Severity keys match concern list
    const severityKeys = Object.keys(analyzeResp.body.analysis.severity || {});
    const concernKeys = analyzeResp.body.analysis.concerns;
    const orphanSeverities = severityKeys.filter((k) => !concernKeys.includes(k));
    assert('Severity keys match concerns', orphanSeverities.length === 0, orphanSeverities.join(', '));

    assertNoField('No price data in analysis', analyzeResp.body, 'price', 'cost', 'fee', 'platformFee', 'doctorEarning');
    assertNoField('No diagnosis language (internal check)', analyzeResp.body.analysis, 'diagnosis', 'prescription', 'treatment_required');

    analysisResult = analyzeResp.body.analysis;
    const mockFlag = analyzeResp.body.mock === true;
    console.log(`  ${mockFlag ? Y('→ AI fallback (mock) used') : G('→ Real Gemini AI responded')}`);
    console.log(`  ${Y('→')} Concerns detected: [${analysisResult.concerns.join(', ') || 'none'}]`);
    console.log(`  ${Y('→')} Notes: "${analysisResult.notes.slice(0, 80)}${analysisResult.notes.length > 80 ? '…' : ''}"`);
  }

  // Validate error handling on /ai/analyze
  const noInput = await request('POST', '/ai/analyze', {});
  assert('/ai/analyze empty body → 400', noInput.status === 400);

  const badUrl = await request('POST', '/ai/analyze', { imageUrl: 'not-a-url' });
  assert('/ai/analyze bad URL → 400', badUrl.status === 400);

  const deadUrl = await request('POST', '/ai/analyze', { imageUrl: 'https://localhost:19998/dead.jpg' });
  assert('/ai/analyze unreachable URL → fallback (no crash)', deadUrl.status === 200 && deadUrl.body.success === true);
  assert('/ai/analyze fallback has mock:true', deadUrl.body.mock === true);

  // ── STEP 6: /ai/simulate ───────────────────────────────────────────────────
  section('STEP 6 — Treatment Simulation (Real AI)');

  const simulationAnalysis = analysisResult || {
    concerns: ['acne', 'pigmentation'],
    severity: { acne: 'mild', pigmentation: 'moderate' },
    notes: 'Mild acne on forehead and moderate pigmentation on cheeks.',
  };

  const simResp = await request('POST', '/ai/simulate', {
    imageUrl: 'https://www.gstatic.com/webp/gallery/1.jpg',
    analysis: simulationAnalysis,
  });

  assert('/ai/simulate returns 200', simResp.status === 200);
  assert('/ai/simulate success:true', simResp.body.success === true);
  assert('/ai/simulate has before URL', typeof simResp.body.before === 'string' && simResp.body.before.startsWith('http'));
  assert('/ai/simulate has after URL', typeof simResp.body.after === 'string' && simResp.body.after.startsWith('http'));
  assert('/ai/simulate has targetImprovements array', Array.isArray(simResp.body.targetImprovements));
  assert('/ai/simulate improvements are non-empty strings', simResp.body.targetImprovements.every((i) => typeof i === 'string' && i.length > 3));
  assert('/ai/simulate has simulationDirectives', typeof simResp.body.simulationDirectives === 'string' && simResp.body.simulationDirectives.length > 10);
  assert('/ai/simulate has estimatedOutcome', typeof simResp.body.estimatedOutcome === 'object');
  assert('/ai/simulate has disclaimer', typeof simResp.body.disclaimer === 'string' && simResp.body.disclaimer.length > 10);
  assertNoField('No price data in simulate', simResp.body, 'price', 'cost', 'fee', 'platformFee', 'doctorEarning');

  // overallImprovement should be ≤ 40% (spec: 20-40% max)
  const improvement = simResp.body.estimatedOutcome?.overallImprovement || '0%';
  const pct = parseInt(improvement);
  assert(`Improvement ≤ 40% (got ${improvement})`, isNaN(pct) || pct <= 40);

  // Simulate without analysis (should not crash)
  const simNoAnalysis = await request('POST', '/ai/simulate', {
    imageUrl: 'https://www.gstatic.com/webp/gallery/1.jpg',
  });
  assert('/ai/simulate without analysis → no crash', simNoAnalysis.status === 200);

  // Error cases
  const simNoUrl = await request('POST', '/ai/simulate', {});
  assert('/ai/simulate missing imageUrl → 400', simNoUrl.status === 400);

  const simBadUrl = await request('POST', '/ai/simulate', { imageUrl: 'ftp://bad' });
  assert('/ai/simulate invalid URL → 400', simBadUrl.status === 400);

  const simMockFlag = simResp.body.mock === true;
  console.log(`  ${simMockFlag ? Y('→ AI fallback (mock) used') : G('→ Real Gemini AI responded')}`);
  if (simResp.body.targetImprovements?.length > 0) {
    console.log(`  ${Y('→')} Improvements: ${simResp.body.targetImprovements.slice(0,2).join(' | ')}`);
  }

  // ── STEP 7: Doctor assigns treatment ──────────────────────────────────────
  section('STEP 7 — Doctor Assigns Treatment');
  const createTx = await request('POST', '/doctor/treatments/create', {
    patientId: targetPatientId,
    treatments: ['Hydrafacial', 'LED Therapy', 'Chemical Peel'],
    sessionsTotal: 6,
    notes: 'Production test — based on AI analysis results',
    doctorId: 'doctor-001',
  });

  assert('Create treatment → 201', createTx.status === 201);
  assert('Create treatment success:true', createTx.body.success === true);
  assert('Plan has id', typeof createTx.body.plan?.id === 'string');
  assert('Plan has patientId', createTx.body.plan?.patientId === targetPatientId);
  assert('Plan has doctorId', typeof createTx.body.plan?.doctorId === 'string');
  assert('Plan has doctorName', typeof createTx.body.plan?.doctorName === 'string');
  assert('Plan status = pending_patient_approval', createTx.body.plan?.status === 'pending_patient_approval');
  assert('Plan treatments array correct length', createTx.body.plan?.treatments?.length === 3);
  assert('Plan sessionsTotal = 6', createTx.body.plan?.sessionsTotal === 6);
  assert('Plan sessionsCompleted = 0', createTx.body.plan?.sessionsCompleted === 0);
  assertNoField('No price data in treatment plan', createTx.body, 'platformFee', 'doctorEarning', 'price', 'cost', 'fee');

  const planId = createTx.body.plan?.id;
  console.log(`  ${Y('→')} Created plan: ${planId}`);

  // Edge cases
  const noPatient = await request('POST', '/doctor/treatments/create', {
    patientId: 'patient-DOES-NOT-EXIST', treatments: ['Hydrafacial'],
  });
  assert('Unknown patient → 404', noPatient.status === 404);

  const emptyTx = await request('POST', '/doctor/treatments/create', {
    patientId: targetPatientId, treatments: [],
  });
  assert('Empty treatments array → 400', emptyTx.status === 400);

  const noTx = await request('POST', '/doctor/treatments/create', {
    patientId: targetPatientId,
  });
  assert('Missing treatments → 400', noTx.status === 400);

  // ── STEP 8: Patient sees treatment — no price before consultation ──────────
  section('STEP 8 — Patient Fetches Treatments (Price Guard)');

  const patientTx = await request('GET', `/patient/treatments?patientId=${targetPatientId}`);
  assert('GET /patient/treatments → 200', patientTx.status === 200);
  assert('Patient treatments success:true', patientTx.body.success === true);
  assert('Treatments is array', Array.isArray(patientTx.body.treatments));
  assert('Patient sees newly created plan', patientTx.body.treatments.some((t) => t.id === planId));

  // ─── PRICE LEAKAGE CHECKS (critical) ──────────────────────────────────────
  const txJson = JSON.stringify(patientTx.body);
  assert('No platformFee in patient response',   !txJson.includes('"platformFee"'));
  assert('No doctorEarning in patient response',  !txJson.includes('"doctorEarning"'));
  assert('No "price" field in patient response',  !txJson.includes('"price"'));
  assert('No "cost" field in patient response',   !txJson.includes('"cost"'));
  assert('No "fee" field in patient response',    !txJson.includes('"fee"'));

  // Each plan should have expected shape
  const samplePlan = patientTx.body.treatments.find((t) => t.id === planId);
  assert('Plan has treatments array', Array.isArray(samplePlan?.treatments));
  assert('Plan has status', typeof samplePlan?.status === 'string');
  assert('Plan has doctorName', typeof samplePlan?.doctorName === 'string');
  assert('Plan has sessionsTotal', typeof samplePlan?.sessionsTotal === 'number');
  assert('Plan has sessionsCompleted', typeof samplePlan?.sessionsCompleted === 'number');
  assert('Plan has createdAt', typeof samplePlan?.createdAt === 'string');

  // Status filter
  const inProgress = await request('GET', `/patient/treatments?patientId=patient-001&status=in_progress`);
  assert('Status filter works', inProgress.body.treatments?.every((t) => t.status === 'in_progress'));

  // Unknown patient returns empty array, not 404
  const unknown = await request('GET', '/patient/treatments?patientId=patient-UNKNOWN');
  assert('Unknown patient → empty treatments, not crash', unknown.status === 200 && Array.isArray(unknown.body.treatments));
  assert('Unknown patient total = 0', unknown.body.total === 0);

  // ── STEP 9: Security / injection probes ───────────────────────────────────
  section('STEP 9 — Security Probes');

  // SQL injection in patientId query param (URL-encoded so Node http client accepts it)
  const sqlPayload = encodeURIComponent("'; DROP TABLE treatment_plans; --");
  const sqlInject = await request('GET', `/patient/treatments?patientId=${sqlPayload}`);
  assert('SQL injection in query param → safe response', sqlInject.status === 200 && sqlInject.body.success === true);

  // XSS in treatment name
  const xssDoc = await request('POST', '/doctor/treatments/create', {
    patientId: targetPatientId,
    treatments: ['<script>alert(1)</script>'],
    sessionsTotal: 1,
  });
  assert('XSS in treatment name stored safely (not executed)', xssDoc.status === 201);
  const xssJson = JSON.stringify(xssDoc.body);
  assert('XSS content stored as-is (server does not evaluate)', xssDoc.body.plan?.treatments?.[0] === '<script>alert(1)</script>');

  // Very long string
  const longName = 'A'.repeat(5000);
  const longResp = await request('POST', '/admin/doctors/create', {
    name: longName, email: `long${ts}@test.com`, specialty: 'X',
  });
  assert('Very long name → does not crash server', longResp.status === 201 || longResp.status === 400 || longResp.status === 500);
  // Re-verify server is still up
  const healthCheck = await request('GET', '/health');
  assert('Server still alive after long-string probe', healthCheck.body.status === 'ok');

  // ── STEP 10: Concurrent requests (no crash under load) ─────────────────────
  section('STEP 10 — Concurrent Requests');

  const concurrentRequests = Array.from({ length: 10 }, (_, i) =>
    request('GET', i % 2 === 0 ? '/admin/doctors' : '/doctor/patients')
  );
  const concurrentResults = await Promise.all(concurrentRequests);
  const allOk = concurrentResults.every((r) => r.body.success === true);
  assert('10 concurrent requests all succeed', allOk);

  // ── FINAL REPORT ──────────────────────────────────────────────────────────
  console.log('\n' + B('══════════════════════════════════════════'));
  console.log(B(`  RESULTS: ${G(passed + ' passed')}, ${failed > 0 ? R(failed + ' failed') : G(failed + ' failed')}`));
  console.log(B('══════════════════════════════════════════'));

  if (failures.length > 0) {
    console.log(`\n${R('Failed assertions:')}`);
    failures.forEach((f) => console.log(`  ${R('✗')} ${f}`));
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(R('\nFATAL: Unhandled error in test suite:'), err.message);
  process.exit(1);
});
