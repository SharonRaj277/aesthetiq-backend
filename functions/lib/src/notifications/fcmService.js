"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmergencyAlertToDoctor = sendEmergencyAlertToDoctor;
exports.sendPatientNotification = sendPatientNotification;
exports.sendBulkEmergencyAlerts = sendBulkEmergencyAlerts;
const admin = __importStar(require("firebase-admin"));
// ─────────────────────────────────────────
// DOCTOR NOTIFICATIONS
// ─────────────────────────────────────────
/**
 * Send a high-priority emergency alert to a doctor's device.
 */
async function sendEmergencyAlertToDoctor(fcmToken, payload) {
    const message = {
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
            ttl: 10000, // 10-second TTL — stale alerts are useless
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
async function sendPatientNotification(fcmToken, body, type, extraData = {}) {
    const message = {
        token: fcmToken,
        notification: {
            title: 'AesthetiQ',
            body,
        },
        data: Object.assign(Object.assign({ type }, extraData), { timestamp: Date.now().toString() }),
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
async function sendBulkEmergencyAlerts(doctors, payload) {
    let successCount = 0;
    await Promise.all(doctors.map(async (doctor) => {
        if (!doctor.fcmToken)
            return;
        try {
            await sendEmergencyAlertToDoctor(doctor.fcmToken, payload);
            successCount++;
        }
        catch (err) {
            console.error(`[FCM] Failed to notify doctor ${doctor.uid}:`, err);
        }
    }));
    return successCount;
}
//# sourceMappingURL=fcmService.js.map