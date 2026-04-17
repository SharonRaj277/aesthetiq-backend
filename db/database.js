'use strict';

/**
 * db/database.js — SQLite persistence layer (better-sqlite3)
 *
 * File location: BACKEND/data/aesthetiq.db
 * All queries are synchronous (better-sqlite3 API) so no async/await needed
 * in callers — keeps route handlers simple.
 */

const fs   = require('fs');
const path = require('path');
const { Database } = require('node-sqlite3-wasm');

const dataDir = path.join(__dirname, '../data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('📁 Created data directory');
}

const dbPath = path.join(dataDir, 'aesthetiq.db');
console.log('📦 DB PATH:', dbPath);

const db = new Database(dbPath);

// WAL mode + foreign keys — use pragma() if available (better-sqlite3),
// otherwise fall back to raw SQL (node-sqlite3-wasm)
if (typeof db.pragma === 'function') {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} else {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
}

console.log('DB initialized');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS doctors (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    specialty       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    is_online       INTEGER NOT NULL DEFAULT 0,
    is_busy         INTEGER NOT NULL DEFAULT 0,
    rating          REAL NOT NULL DEFAULT 0,
    total_consultations INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS patients (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    age             INTEGER,
    gender          TEXT,
    phone           TEXT,
    last_visit      TEXT,
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS treatment_plans (
    id                  TEXT PRIMARY KEY,
    patient_id          TEXT NOT NULL REFERENCES patients(id),
    patient_name        TEXT NOT NULL,
    doctor_id           TEXT NOT NULL REFERENCES doctors(id),
    doctor_name         TEXT NOT NULL,
    treatments          TEXT NOT NULL,   -- JSON array stored as string
    notes               TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'pending_patient_approval',
    sessions_total      INTEGER NOT NULL DEFAULT 1,
    sessions_completed  INTEGER NOT NULL DEFAULT 0,
    next_session        TEXT,            -- ISO string or NULL
    created_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_events (
    id         TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    user_id    TEXT,
    scan_id    TEXT,
    scan_type  TEXT,
    timestamp  TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scan_results (
    id                   TEXT PRIMARY KEY,
    patient_id           TEXT NOT NULL REFERENCES patients(id),
    scan_type            TEXT NOT NULL DEFAULT 'skin',
    ai_analysis          TEXT NOT NULL,   -- JSON: full analysis object from /ai/analyze
    photo_urls           TEXT NOT NULL DEFAULT '[]',  -- JSON array of image URLs
    pain_level           REAL,            -- 0–10 numeric scale or NULL
    swelling             TEXT,            -- "yes" | "no" | free text | NULL
    selected_areas       TEXT,            -- JSON array of strings
    questionnaire        TEXT,            -- JSON object of answers
    clinical_risk_score  INTEGER NOT NULL DEFAULT 0,  -- 0–100 computed score
    is_unlocked          INTEGER NOT NULL DEFAULT 0,  -- 0=locked, 1=unlocked
    saved_by_doctor_id   TEXT,            -- NULL if patient self-submitted
    notes                TEXT NOT NULL DEFAULT '',
    created_at           TEXT NOT NULL
  );
`);

// ─── Seed: only insert if tables are empty ────────────────────────────────────

function seedIfEmpty() {
  const doctorCount = db.prepare('SELECT COUNT(*) as n FROM doctors').get().n;
  if (doctorCount === 0) {
    const insertDoctor = db.prepare(`
      INSERT INTO doctors (id, name, email, specialty, status, is_online, is_busy, rating, total_consultations, created_at)
      VALUES (@id, @name, @email, @specialty, @status, @is_online, @is_busy, @rating, @total_consultations, @created_at)
    `);
    const doctors = [
      { id: 'doctor-001', name: 'Dr. Sarah Lee',    email: 'sarah.lee@aesthetiq.com',    specialty: 'Dermatology',        status: 'active',    is_online: 1, is_busy: 0, rating: 4.8, total_consultations: 134, created_at: '2024-01-15T08:00:00.000Z' },
      { id: 'doctor-002', name: 'Dr. James Okafor', email: 'james.okafor@aesthetiq.com', specialty: 'Aesthetic Medicine', status: 'active',    is_online: 0, is_busy: 0, rating: 4.6, total_consultations: 89,  created_at: '2024-02-10T09:30:00.000Z' },
      { id: 'doctor-003', name: 'Dr. Priya Nair',   email: 'priya.nair@aesthetiq.com',   specialty: 'Dental Surgery',     status: 'suspended', is_online: 0, is_busy: 0, rating: 4.2, total_consultations: 57,  created_at: '2024-03-05T11:00:00.000Z' },
    ];
    const seedDoctors = db.transaction((rows) => rows.forEach(r => insertDoctor.run(r)));
    seedDoctors(doctors);
    console.log('  ✓ Seeded 3 doctors');
  }

  const patientCount = db.prepare('SELECT COUNT(*) as n FROM patients').get().n;
  if (patientCount === 0) {
    const insertPatient = db.prepare(`
      INSERT INTO patients (id, name, email, age, gender, phone, last_visit, created_at)
      VALUES (@id, @name, @email, @age, @gender, @phone, @last_visit, @created_at)
    `);
    const patients = [
      { id: 'patient-001', name: 'Aisha Rahman', email: 'aisha.rahman@example.com', age: 28, gender: 'female', phone: '+60-11-1234-5678', last_visit: '2025-03-15T10:00:00.000Z', created_at: new Date().toISOString() },
      { id: 'patient-002', name: 'Marcus Tan',   email: 'marcus.tan@example.com',   age: 35, gender: 'male',   phone: '+60-12-8765-4321', last_visit: '2025-04-01T14:30:00.000Z', created_at: new Date().toISOString() },
      { id: 'patient-003', name: 'Nur Hidayah',  email: 'nur.hidayah@example.com',  age: 24, gender: 'female', phone: '+60-17-5555-0000', last_visit: '2025-04-08T09:00:00.000Z', created_at: new Date().toISOString() },
    ];
    const seedPatients = db.transaction((rows) => rows.forEach(r => insertPatient.run(r)));
    seedPatients(patients);
    console.log('  ✓ Seeded 3 patients');
  }

  const planCount = db.prepare('SELECT COUNT(*) as n FROM treatment_plans').get().n;
  if (planCount === 0) {
    const insertPlan = db.prepare(`
      INSERT INTO treatment_plans (id, patient_id, patient_name, doctor_id, doctor_name, treatments, notes, status, sessions_total, sessions_completed, next_session, created_at)
      VALUES (@id, @patient_id, @patient_name, @doctor_id, @doctor_name, @treatments, @notes, @status, @sessions_total, @sessions_completed, @next_session, @created_at)
    `);
    const plans = [
      { id: 'plan-001', patient_id: 'patient-001', patient_name: 'Aisha Rahman', doctor_id: 'doctor-001', doctor_name: 'Dr. Sarah Lee', treatments: JSON.stringify(['Hydrafacial', 'LED Therapy']),  notes: 'Initial skin rejuvenation course', status: 'in_progress', sessions_total: 6, sessions_completed: 2, next_session: '2025-04-15T10:00:00.000Z', created_at: '2025-03-15T10:00:00.000Z' },
      { id: 'plan-002', patient_id: 'patient-002', patient_name: 'Marcus Tan',   doctor_id: 'doctor-001', doctor_name: 'Dr. Sarah Lee', treatments: JSON.stringify(['Chemical Peel']),              notes: '',                                status: 'pending_patient_approval', sessions_total: 3, sessions_completed: 0, next_session: null, created_at: '2025-04-01T14:30:00.000Z' },
      { id: 'plan-003', patient_id: 'patient-001', patient_name: 'Aisha Rahman', doctor_id: 'doctor-001', doctor_name: 'Dr. Sarah Lee', treatments: JSON.stringify(['Microneedling']),             notes: '',                                status: 'completed',   sessions_total: 4, sessions_completed: 4, next_session: null, created_at: '2024-11-01T09:00:00.000Z' },
    ];
    const seedPlans = db.transaction((rows) => rows.forEach(r => insertPlan.run(r)));
    seedPlans(plans);
    console.log('  ✓ Seeded 3 treatment plans');
  }
}

seedIfEmpty();

// ─── Helpers: map DB row → API shape ─────────────────────────────────────────

function doctorFromRow(row) {
  if (!row) return null;
  return {
    id:                  row.id,
    name:                row.name,
    email:               row.email,
    specialty:           row.specialty,
    status:              row.status,
    isOnline:            row.is_online === 1,
    isBusy:              row.is_busy === 1,
    rating:              row.rating,
    totalConsultations:  row.total_consultations,
    createdAt:           row.created_at,
  };
}

function patientFromRow(row, activeTreatments = 0) {
  if (!row) return null;
  return {
    id:               row.id,
    name:             row.name,
    email:            row.email,
    age:              row.age,
    gender:           row.gender,
    phone:            row.phone,
    lastVisit:        row.last_visit,
    activeTreatments,
  };
}

function planFromRow(row) {
  if (!row) return null;
  return {
    id:                row.id,
    patientId:         row.patient_id,
    patientName:       row.patient_name,
    doctorId:          row.doctor_id,
    doctorName:        row.doctor_name,
    treatments:        JSON.parse(row.treatments),
    notes:             row.notes,
    status:            row.status,
    sessionsTotal:     row.sessions_total,
    sessionsCompleted: row.sessions_completed,
    nextSession:       row.next_session || null,
    createdAt:         row.created_at,
  };
}

function scanFromRow(row) {
  if (!row) return null;

  // Parse JSON columns safely
  function tryParse(str, fallback) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  return {
    id:                 row.id,
    patientId:          row.patient_id,
    scanType:           row.scan_type,
    aiAnalysis:         tryParse(row.ai_analysis, {}),
    photoUrls:          tryParse(row.photo_urls, []),
    patientContext: {
      painLevel:           row.pain_level ?? null,
      swelling:            row.swelling   ?? null,
      selectedAreas:       tryParse(row.selected_areas, []),
      questionnaireAnswers: tryParse(row.questionnaire, {}),
    },
    clinicalRiskScore:  row.clinical_risk_score,
    isUnlocked:         row.is_unlocked === 1,
    savedByDoctorId:    row.saved_by_doctor_id ?? null,
    notes:              row.notes,
    createdAt:          row.created_at,
  };
}

// ─── Prepared statements ──────────────────────────────────────────────────────

const stmts = {
  // Doctors
  getAllDoctors:    db.prepare('SELECT * FROM doctors ORDER BY created_at'),
  getDoctorById:   db.prepare('SELECT * FROM doctors WHERE id = ?'),
  getDoctorByEmail:db.prepare('SELECT * FROM doctors WHERE email = ?'),
  insertDoctor:    db.prepare(`
    INSERT INTO doctors (id, name, email, specialty, status, is_online, is_busy, rating, total_consultations, created_at)
    VALUES (@id, @name, @email, @specialty, @status, @is_online, @is_busy, @rating, @total_consultations, @created_at)
  `),
  updateDoctorStatus: db.prepare(`
    UPDATE doctors SET status = @status, is_online = @is_online WHERE id = @id
  `),

  // Patients
  getAllPatients:   db.prepare('SELECT * FROM patients ORDER BY name'),
  getPatientById:  db.prepare('SELECT * FROM patients WHERE id = ?'),

  // Treatment plans
  getAllPlans:            db.prepare('SELECT * FROM treatment_plans ORDER BY created_at DESC'),
  getPlansByPatient:     db.prepare('SELECT * FROM treatment_plans WHERE patient_id = ? ORDER BY created_at DESC'),
  getPlansByStatus:      db.prepare('SELECT * FROM treatment_plans WHERE status = ? ORDER BY created_at DESC'),
  getPlansByPatientAndStatus: db.prepare('SELECT * FROM treatment_plans WHERE patient_id = ? AND status = ? ORDER BY created_at DESC'),
  countActivePlansByPatient:  db.prepare(`
    SELECT COUNT(*) as n FROM treatment_plans
    WHERE patient_id = ? AND status NOT IN ('completed', 'cancelled')
  `),
  insertPlan: db.prepare(`
    INSERT INTO treatment_plans (id, patient_id, patient_name, doctor_id, doctor_name, treatments, notes, status, sessions_total, sessions_completed, next_session, created_at)
    VALUES (@id, @patient_id, @patient_name, @doctor_id, @doctor_name, @treatments, @notes, @status, @sessions_total, @sessions_completed, @next_session, @created_at)
  `),

  // Scan results
  insertScanResult: db.prepare(`
    INSERT INTO scan_results
      (id, patient_id, scan_type, ai_analysis, photo_urls, pain_level, swelling,
       selected_areas, questionnaire, clinical_risk_score, is_unlocked, saved_by_doctor_id, notes, created_at)
    VALUES
      (@id, @patient_id, @scan_type, @ai_analysis, @photo_urls, @pain_level, @swelling,
       @selected_areas, @questionnaire, @clinical_risk_score, @is_unlocked, @saved_by_doctor_id, @notes, @created_at)
  `),
  getScanResultById:        db.prepare('SELECT * FROM scan_results WHERE id = ?'),
  getScanResultsByPatient:  db.prepare('SELECT * FROM scan_results WHERE patient_id = ? ORDER BY created_at DESC'),
  getAllScanResults:         db.prepare('SELECT * FROM scan_results ORDER BY created_at DESC'),
  unlockScanResult:         db.prepare('UPDATE scan_results SET is_unlocked = 1 WHERE id = ?'),

  // Analytics
  insertAnalyticsEvent: db.prepare(`
    INSERT INTO analytics_events (id, event_name, user_id, scan_id, scan_type, timestamp, created_at)
    VALUES (@id, @event_name, @user_id, @scan_id, @scan_type, @timestamp, @created_at)
  `),
  countEvent: db.prepare('SELECT COUNT(*) as n FROM analytics_events WHERE event_name = ?'),
  countEventsByScanType: db.prepare(`
    SELECT scan_type, event_name, COUNT(*) as n
    FROM analytics_events
    WHERE event_name IN (SELECT value FROM json_each(?)) AND scan_type IS NOT NULL
    GROUP BY scan_type, event_name
  `),
};

// ─── Public API ───────────────────────────────────────────────────────────────

module.exports = {
  // ── Doctors ──────────────────────────────────────────────────────────────
  getDoctors() {
    return stmts.getAllDoctors.all().map(doctorFromRow);
  },

  getDoctorById(id) {
    return doctorFromRow(stmts.getDoctorById.get(id));
  },

  getDoctorByEmail(email) {
    return doctorFromRow(stmts.getDoctorByEmail.get(email));
  },

  createDoctor({ name, email, specialty }) {
    const doctor = {
      id:       `doctor-${Date.now()}`,
      name,
      email,
      specialty,
      status:   'active',
      is_online: 0,
      is_busy:   0,
      rating:    0,
      total_consultations: 0,
      created_at: new Date().toISOString(),
    };
    stmts.insertDoctor.run(doctor);
    return doctorFromRow(stmts.getDoctorById.get(doctor.id));
  },

  updateDoctorStatus(id, status) {
    // For suspended/inactive: force offline. For active: keep existing value.
    if (status === 'suspended' || status === 'inactive') {
      stmts.updateDoctorStatus.run({ id, status, is_online: 0 });
    } else {
      db.prepare('UPDATE doctors SET status = ? WHERE id = ?').run(status, id);
    }
    return doctorFromRow(stmts.getDoctorById.get(id));
  },

  // ── Patients ──────────────────────────────────────────────────────────────
  getPatients() {
    return stmts.getAllPatients.all().map((row) => {
      const active = stmts.countActivePlansByPatient.get(row.id).n;
      return patientFromRow(row, active);
    });
  },

  getPatientById(id) {
    const row = stmts.getPatientById.get(id);
    if (!row) return null;
    const active = stmts.countActivePlansByPatient.get(id).n;
    return patientFromRow(row, active);
  },

  // ── Treatment plans ───────────────────────────────────────────────────────
  getTreatmentPlans({ patientId, status } = {}) {
    let rows;
    if (patientId && status) {
      rows = stmts.getPlansByPatientAndStatus.all(patientId, status);
    } else if (patientId) {
      rows = stmts.getPlansByPatient.all(patientId);
    } else if (status) {
      rows = stmts.getPlansByStatus.all(status);
    } else {
      rows = stmts.getAllPlans.all();
    }
    return rows.map(planFromRow);
  },

  createTreatmentPlan({ patientId, patientName, doctorId, doctorName, treatments, notes, sessionsTotal }) {
    const plan = {
      id:                 `plan-${Date.now()}`,
      patient_id:         patientId,
      patient_name:       patientName,
      doctor_id:          doctorId,
      doctor_name:        doctorName,
      treatments:         JSON.stringify(treatments),
      notes:              notes || '',
      status:             'pending_patient_approval',
      sessions_total:     sessionsTotal || treatments.length,
      sessions_completed: 0,
      next_session:       null,
      created_at:         new Date().toISOString(),
    };
    stmts.insertPlan.run(plan);
    return planFromRow(stmts.getAllPlans.all().find(r => r.id === plan.id));
  },

  // ── Scan results ──────────────────────────────────────────────────────────

  /**
   * createScanResult({
   *   patientId, scanType, aiAnalysis, photoUrls,
   *   painLevel, swelling, selectedAreas, questionnaireAnswers,
   *   clinicalRiskScore, savedByDoctorId, notes
   * })
   */
  createScanResult({
    patientId,
    scanType            = 'skin',
    aiAnalysis          = {},
    photoUrls           = [],
    painLevel           = null,
    swelling            = null,
    selectedAreas       = [],
    questionnaireAnswers = {},
    clinicalRiskScore   = 0,
    savedByDoctorId     = null,
    notes               = '',
  }) {
    const row = {
      id:                  `scan-${Date.now()}`,
      patient_id:          patientId,
      scan_type:           scanType,
      ai_analysis:         JSON.stringify(aiAnalysis),
      photo_urls:          JSON.stringify(photoUrls),
      pain_level:          painLevel !== null ? parseFloat(painLevel) || null : null,
      swelling:            swelling  !== null ? String(swelling)       : null,
      selected_areas:      JSON.stringify(selectedAreas),
      questionnaire:       JSON.stringify(questionnaireAnswers),
      clinical_risk_score: Math.round(Math.min(100, Math.max(0, clinicalRiskScore))),
      is_unlocked:         0,
      saved_by_doctor_id:  savedByDoctorId || null,
      notes:               notes || '',
      created_at:          new Date().toISOString(),
    };
    stmts.insertScanResult.run(row);
    return scanFromRow(stmts.getScanResultById.get(row.id));
  },

  getScanResultsByPatient(patientId) {
    return stmts.getScanResultsByPatient.all(patientId).map(scanFromRow);
  },

  getScanResultById(id) {
    return scanFromRow(stmts.getScanResultById.get(id));
  },

  getAllScanResults() {
    return stmts.getAllScanResults.all().map(scanFromRow);
  },

  unlockScanResult(id) {
    const info = stmts.unlockScanResult.run(id);
    if (info.changes === 0) return null;           // scan not found
    return scanFromRow(stmts.getScanResultById.get(id));
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  getFunnelCounts(eventNames) {
    // Returns { eventName: count } for each name in the array — single query per event.
    const result = {};
    for (const name of eventNames) {
      result[name] = stmts.countEvent.get(name).n;
    }
    return result;
  },

  /**
   * getFunnelCountsByScanType(eventNames, scanTypes)
   * Returns { scanType: { eventName: count } } for the requested events + types.
   * Uses a single GROUP BY query for efficiency.
   */
  getFunnelCountsByScanType(eventNames, scanTypes) {
    const rows = stmts.countEventsByScanType.all(JSON.stringify(eventNames));

    // Initialise every type with zeroes
    const result = {};
    for (const st of scanTypes) {
      result[st] = {};
      for (const en of eventNames) result[st][en] = 0;
    }

    for (const row of rows) {
      const st = row.scan_type;
      if (result[st]) result[st][row.event_name] = row.n;
    }
    return result;
  },

  createAnalyticsEvent({ eventName, userId, scanId, scanType, timestamp }) {
    const now = new Date().toISOString();
    const row = {
      id:         `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      event_name: eventName,
      user_id:    userId   || null,
      scan_id:    scanId   || null,
      scan_type:  scanType || null,
      timestamp:  timestamp || now,
      created_at: now,
    };
    stmts.insertAnalyticsEvent.run(row);
    return { id: row.id, eventName, userId: row.user_id, scanId: row.scan_id, scanType: row.scan_type, timestamp: row.timestamp };
  },
};
