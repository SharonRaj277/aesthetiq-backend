import * as admin from 'firebase-admin';

// ─────────────────────────────────────────
// SHARED
// ─────────────────────────────────────────

export interface Location {
  city: string;
  lat: number;
  lng: number;
}

// ─────────────────────────────────────────
// USER (Patient)
// ─────────────────────────────────────────

export interface User {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  location: Location;
  languages: string[];
  primaryLanguage: string;
  fcmToken?: string;
  createdAt: admin.firestore.Timestamp;
}

// ─────────────────────────────────────────
// DOCTOR
// ─────────────────────────────────────────

export interface Doctor {
  uid: string;
  name: string;
  specialization: string;
  experience: number;
  rating: number;            // 0–5
  ratingCount: number;
  isOnline: boolean;
  isBusy: boolean;
  languages: string[];
  location: Location;
  avgResponseTime: number;   // seconds
  totalConsultations: number;
  acceptanceRate: number;    // 0–1
  status: 'active' | 'suspended';
  fcmToken?: string;
  createdAt: admin.firestore.Timestamp;
}

// ─────────────────────────────────────────
// EMERGENCY REQUEST
// ─────────────────────────────────────────

export type RequestStatus =
  | 'searching'
  | 'assigned'
  | 'completed'
  | 'cancelled'
  | 'no_doctors';

export interface EmergencyRequest {
  requestId: string;
  patientId: string;
  issueType: string;
  severity: 'low' | 'medium' | 'high';
  languages: string[];
  primaryLanguage: string;
  location: Location;
  status: RequestStatus;
  assignedDoctorId?: string;
  notifiedDoctors: string[];
  retryCount: number;
  cancelReason?: string;
  createdAt: admin.firestore.Timestamp;
  acceptedAt?: admin.firestore.Timestamp;
  completedAt?: admin.firestore.Timestamp;
}

// ─────────────────────────────────────────
// DOCTOR RESPONSE
// ─────────────────────────────────────────

export type DoctorResponseType = 'pending' | 'accepted' | 'declined' | 'timeout' | 'cancelled';

export interface DoctorResponse {
  requestId: string;
  doctorId: string;
  response: DoctorResponseType;
  responseTime?: number;       // seconds from request creation to response
  createdAt: admin.firestore.Timestamp;
}

// ─────────────────────────────────────────
// APPOINTMENT
// ─────────────────────────────────────────

export type AppointmentStatus = 'scheduled' | 'ongoing' | 'completed' | 'cancelled';

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string;
  emergencyRequestId?: string;
  status: AppointmentStatus;
  notes?: string;
  createdAt: admin.firestore.Timestamp;
}

// ─────────────────────────────────────────
// TRANSACTION
// ─────────────────────────────────────────

export type TransactionStatus = 'pending' | 'completed' | 'refunded' | 'failed';

export interface Transaction {
  id: string;
  patientId: string;
  doctorId: string;
  appointmentId?: string;
  amount: number;
  platformFee: number;
  doctorPayout: number;
  currency: string;
  status: TransactionStatus;
  createdAt: admin.firestore.Timestamp;
}

// ─────────────────────────────────────────
// SCORING (internal)
// ─────────────────────────────────────────

export interface ScoreBreakdown {
  distanceScore: number;
  availabilityScore: number;
  languageScore: number;
  ratingScore: number;
  responseSpeedScore: number;
  specializationBoost: number;
  finalScore: number;
}

export interface ScoredDoctor {
  doctor: Doctor;
  score: number;
  breakdown: ScoreBreakdown;
}

// ─────────────────────────────────────────
// NOTIFICATION PAYLOAD
// ─────────────────────────────────────────

export interface EmergencyNotificationPayload {
  patientName: string;
  issueType: string;
  severity: string;
  requestId: string;
}
