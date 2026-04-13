import express from 'express';
import dentalRouter from './routes/treatmentRoutes';

// ─────────────────────────────────────────────────────────────────────────────
// Dental Express App
// ─────────────────────────────────────────────────────────────────────────────
// Exported as a standalone Express app so it can be:
//   A) Mounted inside a larger app:  mainApp.use('/dental', dentalApp)
//   B) Wrapped in a Firebase HTTPS function (see index.ts export below)
//   C) Run as a standalone server for local dev
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', module: 'dental' }));

// Dental routes
app.use('/', dentalRouter);

export default app;
