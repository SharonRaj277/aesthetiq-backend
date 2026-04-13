# AesthetiQ — Example Queries & Real-Time Listeners

## Firestore Schema Overview

```
users/              {uid}
doctors/            {uid}
emergencyRequests/  {requestId}
doctorResponses/    {requestId}_{doctorId}
appointments/       {id}
transactions/       {id}
analytics/          global | daily_{YYYY-MM-DD}
admins/             {uid}
config/             {key}
```

---

## Patient App

### Create an Emergency Request
```ts
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const requestRef = await addDoc(collection(db, 'emergencyRequests'), {
  patientId: auth.currentUser.uid,
  issueType: 'skin_rash',
  severity: 'high',
  languages: ['Hindi', 'English'],
  primaryLanguage: 'Hindi',
  location: { city: 'Mumbai', lat: 19.076, lng: 72.877 },
  status: 'searching',
  notifiedDoctors: [],
  retryCount: 0,
  createdAt: serverTimestamp(),
});

console.log('Request ID:', requestRef.id);
```

### Real-Time Listener — Track My Emergency Request
```ts
import { doc, onSnapshot } from 'firebase/firestore';

const unsub = onSnapshot(
  doc(db, 'emergencyRequests', requestId),
  (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();

    switch (data.status) {
      case 'searching':
        showUI('Finding doctor…');
        break;
      case 'assigned':
        showUI(`Dr. ${data.assignedDoctorId} is connecting!`);
        loadDoctorProfile(data.assignedDoctorId);
        break;
      case 'completed':
        showUI('Consultation complete.');
        unsub(); // stop listening
        break;
      case 'cancelled':
        showUI('No doctors available. Please try again.');
        unsub();
        break;
    }
  }
);
```

### Fetch Patient's Past Appointments
```ts
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';

const q = query(
  collection(db, 'appointments'),
  where('patientId', '==', auth.currentUser.uid),
  orderBy('createdAt', 'desc')
);

const snap = await getDocs(q);
const appointments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
```

### Fetch Patient's Transactions
```ts
const q = query(
  collection(db, 'transactions'),
  where('patientId', '==', auth.currentUser.uid),
  orderBy('createdAt', 'desc')
);
```

---

## Doctor App

### Doctor Goes Online
```ts
import { doc, updateDoc } from 'firebase/firestore';

await updateDoc(doc(db, 'doctors', auth.currentUser.uid), {
  isOnline: true,
  isBusy: false,
});
```

### Doctor Goes Offline
```ts
await updateDoc(doc(db, 'doctors', auth.currentUser.uid), {
  isOnline: false,
});
```

### Real-Time Listener — Watch for Emergency Requests
```ts
import { collection, query, where, onSnapshot } from 'firebase/firestore';

const unsub = onSnapshot(
  query(
    collection(db, 'doctorResponses'),
    where('doctorId', '==', auth.currentUser.uid),
    where('response', '==', 'pending')
  ),
  (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const { requestId } = change.doc.data();
        showEmergencyAlert(requestId);
      }
    });
  }
);
```

### Doctor Accepts a Request
```ts
import { doc, updateDoc } from 'firebase/firestore';

const responseId = `${requestId}_${auth.currentUser.uid}`;
await updateDoc(doc(db, 'doctorResponses', responseId), {
  response: 'accepted',
});
// → triggers onDoctorResponse Cloud Function automatically
```

### Doctor Declines a Request
```ts
await updateDoc(doc(db, 'doctorResponses', responseId), {
  response: 'declined',
});
```

### Watch Assigned Request (active consultation)
```ts
const unsub = onSnapshot(
  doc(db, 'emergencyRequests', requestId),
  (snap) => {
    const data = snap.data();
    if (data?.status === 'completed') {
      showUI('Consultation marked complete.');
      unsub();
    }
  }
);
```

### Fetch Doctor's Consultation History
```ts
const q = query(
  collection(db, 'appointments'),
  where('doctorId', '==', auth.currentUser.uid),
  where('status', '==', 'completed'),
  orderBy('createdAt', 'desc')
);
```

---

## Admin Panel

### Fetch All Active Doctors
```ts
const q = query(
  collection(db, 'doctors'),
  where('status', '==', 'active'),
  orderBy('rating', 'desc')
);
```

### Fetch All Pending Emergency Requests
```ts
const q = query(
  collection(db, 'emergencyRequests'),
  where('status', '==', 'searching'),
  orderBy('createdAt', 'desc')
);
```

### Real-Time Dashboard — All Active Emergencies
```ts
const unsub = onSnapshot(
  query(
    collection(db, 'emergencyRequests'),
    where('status', 'in', ['searching', 'assigned'])
  ),
  (snap) => {
    const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateDashboard(requests);
  }
);
```

### Call Admin Callable Functions
```ts
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();

// Retry matching for a stuck request
const retry = httpsCallable(functions, 'retryEmergencyMatching');
await retry({ requestId: 'abc123' });

// Suspend a doctor
const suspend = httpsCallable(functions, 'suspendDoctor');
await suspend({ doctorId: 'doc456', reason: 'Misconduct report' });

// Complete a consultation
const complete = httpsCallable(functions, 'completeConsultation');
await complete({ requestId: 'abc123', amount: 500 });

// Reassign if doctor disconnected
const reassign = httpsCallable(functions, 'reassignDoctor');
await reassign({ requestId: 'abc123' });

// Fetch analytics
const analytics = httpsCallable(functions, 'getAnalytics');
const { data } = await analytics({});
console.log(data.global);
```

---

## Useful Compound Queries

### Online Doctors in a City
```ts
const q = query(
  collection(db, 'doctors'),
  where('isOnline', '==', true),
  where('isBusy', '==', false),
  where('status', '==', 'active'),
  where('location.city', '==', 'Mumbai'),
  orderBy('rating', 'desc')
);
```

### Requests Assigned to a Specific Doctor
```ts
const q = query(
  collection(db, 'emergencyRequests'),
  where('assignedDoctorId', '==', doctorId),
  where('status', '==', 'assigned')
);
```

### All Responses for a Request
```ts
const q = query(
  collection(db, 'doctorResponses'),
  where('requestId', '==', requestId)
);
```

---

## Real-Time Presence (Doctor Online/Offline)

Use Firebase Realtime Database for accurate presence tracking (Firestore
does not have built-in connection awareness):

```ts
// In doctor app — on mount
import { getDatabase, ref, set, onDisconnect } from 'firebase/database';

const rtdb = getDatabase();
const presenceRef = ref(rtdb, `presence/${auth.currentUser.uid}`);

// Mark online
await set(presenceRef, { online: true, updatedAt: Date.now() });

// Auto-mark offline when connection drops
onDisconnect(presenceRef).set({ online: false, updatedAt: Date.now() });
```

Sync presence to Firestore via a Cloud Function trigger on the RTDB path:

```ts
// In functions/src/handlers — add this export:
export const onDoctorPresenceChange = functions.database
  .ref('presence/{uid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const after = change.after.val();
    if (!after) return;

    await admin.firestore()
      .collection('doctors')
      .doc(uid)
      .update({ isOnline: after.online ?? false });
  });
```
