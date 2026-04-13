"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAISuggestions = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const treatments_1 = require("../config/treatments");
const treatments_2 = require("../../skin/config/treatments");
// ─────────────────────────────────────────
// CLIENT
// Reads ANTHROPIC_API_KEY from process.env.
// In Firebase: set via `firebase functions:secrets:set ANTHROPIC_API_KEY`
// In tests: set in .env.local or before calling.
// ─────────────────────────────────────────
const getClient = () => new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
// ─────────────────────────────────────────
// TREATMENT CATALOGUES — per category
// ─────────────────────────────────────────
const CATALOGUE = {
    skin: treatments_2.SKIN_TREATMENTS.map(t => t.name),
    facial: treatments_1.FACIAL_TREATMENTS.map(t => t.name),
    dental: [
        'Professional Teeth Whitening',
        'Dental Cleaning',
        'Fluoride Treatment',
        'Gum Treatment (Scaling & Root Planing)',
        'Enamel Remineralisation',
        'Cavity Treatment',
        'Bite Guard Therapy',
        'Desensitisation Treatment',
        'Composite Bonding',
        'Oral Hygiene Coaching',
    ],
};
// ─────────────────────────────────────────
// STRUCTURED OUTPUT TOOL
// ─────────────────────────────────────────
function buildTool(category) {
    return {
        name: 'return_scan_suggestions',
        description: 'Return structured, ranked treatment recommendations ' +
            'based on a patient scan analysis. No pricing information.',
        input_schema: {
            type: 'object',
            properties: {
                suggestions: {
                    type: 'array',
                    description: 'Ranked suggestions, most relevant first. Min 2, max 5.',
                    items: {
                        type: 'object',
                        properties: {
                            treatment: {
                                type: 'string',
                                description: `Treatment name — must come from the ${category} catalogue.`,
                            },
                            matchPercentage: {
                                type: 'number',
                                description: 'Relevance score 0–100. Reflects how directly this treatment ' +
                                    'addresses the patient findings and severity.',
                            },
                            rationale: {
                                type: 'string',
                                description: 'Concise clinical rationale (1–2 sentences) referencing ' +
                                    'specific findings that triggered this recommendation.',
                            },
                            recommendedSessions: {
                                type: 'number',
                                description: 'Recommended number of treatment sessions (integer ≥ 1). ' +
                                    'Based on severity and standard clinical guidelines.',
                            },
                            frequency: {
                                type: 'string',
                                description: 'Session frequency, e.g. "weekly", "every 2 weeks", "monthly". ' +
                                    'Omit if single session is sufficient.',
                            },
                        },
                        required: ['treatment', 'matchPercentage', 'rationale', 'recommendedSessions'],
                    },
                    minItems: 2,
                    maxItems: 5,
                },
            },
            required: ['suggestions'],
        },
    };
}
// ─────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────
/**
 * generateAISuggestions
 * ──────────────────────
 * Calls Claude to produce ranked treatment recommendations from scan findings.
 * Uses tool_use for structured JSON output — no free-text parsing.
 */
async function generateAISuggestions(category, findings) {
    const catalogue = CATALOGUE[category];
    const issueList = findings.issues.length > 0
        ? findings.issues.map((i) => `  • ${i}`).join('\n')
        : '  • (no specific issues noted)';
    const prompt = `You are an expert aesthetic healthcare AI assistant working alongside a medical team.

SCAN DETAILS:
  Category: ${category.toUpperCase()}
  Severity: ${findings.severity.toUpperCase()}
  Identified Issues:
${issueList}

APPROVED ${category.toUpperCase()} TREATMENT CATALOGUE:
${catalogue.map((t) => `  • ${t}`).join('\n')}

INSTRUCTIONS:
- Recommend 2–5 treatments from the catalogue that best address the identified issues.
- Rank by matchPercentage descending (most impactful first).
- For HIGH severity: recommend more sessions and more frequent intervals.
- For LOW severity: fewer sessions, longer intervals.
- Only recommend treatments for issues that are actually present.
- Do NOT include any cost, price, or fee information.`;
    const response = await getClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        tools: [buildTool(category)],
        tool_choice: { type: 'tool', name: 'return_scan_suggestions' },
        messages: [{ role: 'user', content: prompt }],
    });
    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
        throw new Error('Claude did not return a tool_use block.');
    }
    const input = toolBlock.input;
    return input.suggestions
        .map((s) => (Object.assign(Object.assign({}, s), { matchPercentage: parseFloat(Math.min(100, Math.max(0, s.matchPercentage)).toFixed(1)), recommendedSessions: Math.max(1, Math.round(s.recommendedSessions)) })))
        .sort((a, b) => b.matchPercentage - a.matchPercentage);
}
exports.generateAISuggestions = generateAISuggestions;
//# sourceMappingURL=scanAnalysis.js.map