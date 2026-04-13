"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const treatmentRoutes_1 = __importDefault(require("./routes/treatmentRoutes"));
// ─────────────────────────────────────────────────────────────────────────────
// Dental Express App
// ─────────────────────────────────────────────────────────────────────────────
// Exported as a standalone Express app so it can be:
//   A) Mounted inside a larger app:  mainApp.use('/dental', dentalApp)
//   B) Wrapped in a Firebase HTTPS function (see index.ts export below)
//   C) Run as a standalone server for local dev
// ─────────────────────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', module: 'dental' }));
// Dental routes
app.use('/', treatmentRoutes_1.default);
exports.default = app;
//# sourceMappingURL=app.js.map