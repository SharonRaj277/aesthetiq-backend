import * as admin from 'firebase-admin';
import { EmergencyNotificationPayload } from '../types';

// ─────────────────────────────────────────
// DOCTOR NOTIFICATIONS
// ─────────────────────────────────────────

/**
 * Send a high-priority emergency alert to a doctor's device.
 */
export async function sendEmergencyAlertToDoctor(
  fcmToken: string,
  payload: EmergencyNotificationPayload
): Promise<void> {
  const message: admin.messaging.Message = {
    token: fcmToken,
    notification: {
      title: '🚨 Emergency Request — Accept Now',
      body: `Patient: ${payload.patientName} | ${payload.issueType} | Severity: ${payload.severity.toUpperCase()}`,
    },
    data: {
      type: 'EMERGENCY_REQUEST',
      requestId: payload.requestId,
      issueType: payload.issueType,
      severity: payload.severity,
      patientName: payload.patientName,
      timestamp: Date.now().toString(),
    },
    android: {
      priority: 'high',
      ttl: 10000,  // 10-second TTL — stale alerts are useless
      notification: {
        sound: 'emergency_alert',
        channelId: 'emergency_channel',
        priority: 'max',
        visibility: 'public',
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 10),
      },
      payload: {
        aps: {
          alert: {
            title: '🚨 Emergency Request',
            body: `${payload.issueType} — ${payload.severity.toUpperCase()} severity`,
          },
          sound: 'emergency_alert.wav',
          badge: 1,
          'content-available': 1,
          'interruption-level': 'critical',
        },
      },
    },
  };

  await admin.messaging().send(message);
}

// ─────────────────────────────────────────
// PATIENT NOTIFICATIONS
// ─────────────────────────────────────────

export type PatientNotificationType =
  | 'SEARCHING'
  | 'DOCTOR_ASSIGNED'
  | 'NO_DOCTORS_AVAILABLE'
  | 'RETRYING'
  | 'NO_DOCTORS_FOUND'
  | 'CONSULTATION_COMPLETE';

export async function sendPatientNotification(
  fcmToken: string,
  body: string,
  type: PatientNotificationType,
  extraData: Record<string, string> = {}
): Promise<void> {
  const message: admin.messaging.Message = {
    token: fcmToken,
    notification: {
      title: 'AesthetiQ',
      body,
    },
    data: {
      type,
      ...extraData,
      timestamp: Date.now().toString(),
    },
    android: {
      priority: 'high',
      notification: { channelId: 'updates_channel' },
    },
    apns: {
      payload: { aps: { sound: 'default' } },
    },
  };

  await admin.messaging().send(message);
}

// ─────────────────────────────────────────
// BULK SEND (for multiple doctors)
// ─────────────────────────────────────────

/**
 * Send emergency alerts to multiple doctors; logs failures without throwing.
 * Returns the number of successful sends.
 */
export async function sendBulkEmergencyAlerts(
  doctors: Array<{ uid: string; fcmToken?: string }>,
  payload: EmergencyNotificationPayload
): Promise<number> {
  let successCount = 0;

  await Promise.all(
    doctors.map(async (doctor) => {
      if (!doctor.fcmToken) return;
      try {
        await sendEmergencyAlertToDoctor(doctor.fcmToken, payload);
        successCount++;
      } catch (err) {
        console.error(`[FCM] Failed to notify doctor ${doctor.uid}:`, err);
      }
    })
  );

  return successCount;
}
