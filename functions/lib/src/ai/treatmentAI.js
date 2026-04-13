"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAISuggestions = generateAISuggestions;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
// ─────────────────────────────────────────
// CLIENT
// Set ANTHROPIC_API_KEY in Firebase Functions config:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
// or via .env.local for emulator.
// ─────────────────────────────────────────
const getClient = () => new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
// ─────────────────────────────────────────
// TREATMENT CATALOGUE
// All recognised treatment names the AI can suggest.
// ─────────────────────────────────────────
const TREATMENT_CATALOGUE = [
    'Hydrafacial',
    'Chemical Peel',
    'LED Therapy',
    'Laser Toning',
    'Microneedling',
    'PRP Therapy',
    'Botox',
    'Dermal Fillers',
    'RF Therapy (Radiofrequency)',
    'Extraction Treatment',
    'Vitamin C Infusion',
    'Acne Treatment Facial',
    'Pigmentation Laser',
    'Anti-Aging Facial',
    'Calming / Sensitivity Facial',
    'Brightening Facial',
    'Oxygen Facial',
    'Dermaplaning',
    'Fractional Laser Resurfacing',
    'Hydrating Facial',
    'IPL Photofacial',
    'Collagen Induction Therapy',
    'Salicylic Acid Peel',
    'AHA / BHA Peel',
    'Pore Minimising Treatment',
];
// ─────────────────────────────────────────
// STRUCTURED OUTPUT SCHEMA (tool_use)
// ─────────────────────────────────────────
const SUGGESTION_TOOL = {
    name: 'return_treatment_suggestions',
    description: 'Return structured, prioritised aesthetic treatment recommendations ' +
        'based on a patient skin scan analysis.',
    input_schema: {
        type: 'object',
        properties: {
            suggestions: {
                type: 'array',
                description: 'Ranked treatment recommendations, most relevant first.',
                items: {
                    type: 'object',
                    properties: {
                        name: {
                            type: 'string',
                            description: 'Treatment name — must be from the approved catalogue.',
                        },
                        matchPercentage: {
                            type: 'number',
                            description: 'Relevance score 0–100. ' +
                                'Reflects how strongly this treatment addresses the patient\'s specific concerns.',
                        },
                        category: {
                            type: 'string',
                            enum: ['acne', 'pigmentation', 'anti-aging', 'hydration', 'sensitivity', 'general'],
                        },
                        estimatedSessions: {
                            type: 'number',
                            description: 'Recommended number of treatment sessions (integer).',
                        },
                        estimatedPricePerSession: {
                            type: 'number',
                            description: 'Realistic USD price per session for a mid-tier aesthetic clinic.',
                        },
                        rationale: {
                            type: 'string',
                            description: 'Concise clinical rationale (1–2 sentences) referencing the ' +
                                'specific scan values that triggered this recommendation.',
                        },
                    },
                    required: [
                        'name',
                        'matchPercentage',
                        'category',
                        'estimatedSessions',
                        'estimatedPricePerSession',
                        'rationale',
                    ],
                },
                minItems: 3,
                maxItems: 6,
            },
        },
        required: ['suggestions'],
    },
};
// ─────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────
/**
 * generateAISuggestions
 * ──────────────────────
 * Calls Claude to produce ranked aesthetic treatment recommendations
 * from structured skin-scan results.
 *
 * Uses tool_use (structured output) so the response is always JSON —
 * no regex parsing, no hallucinated free-text.
 */
async function generateAISuggestions(results, patientAge, patientGender) {
    const scanLines = Object.entries(results)
        .filter(([, val]) => val !== undefined && val !== null)
        .map(([key, val]) => `  • ${humanise(key)}: ${val}/10 — ${severity(key, val)}`)
        .join('\n');
    const demographicContext = [
        patientAge ? `Patient age: ${patientAge}` : '',
        patientGender ? `Patient gender: ${patientGender}` : '',
    ]
        .filter(Boolean)
        .join('\n');
    const prompt = `You are an expert aesthetic dermatology AI assistant working with a medical team.

SKIN SCAN RESULTS:
${scanLines}
${demographicContext ? `\nDEMOGRAPHICS:\n${demographicContext}` : ''}

APPROVED TREATMENT CATALOGUE:
${TREATMENT_CATALOGUE.map((t) => `  • ${t}`).join('\n')}

INSTRUCTIONS:
- Recommend 3–6 treatments from the approved catalogue that best address this patient's concerns.
- Sort by matchPercentage descending (most impactful first).
- matchPercentage must reflect the magnitude of the scan finding (e.g., acne score 9/10 should give acne treatments a high percentage).
- Only suggest treatments for conditions that are actually present (score ≥ 2).
- Provide realistic USD pricing for a mid-tier aesthetic clinic.
- Reference specific scan values in each rationale.`;
    const response = await getClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        tools: [SUGGESTION_TOOL],
        tool_choice: { type: 'tool', name: 'return_treatment_suggestions' },
        messages: [{ role: 'user', content: prompt }],
    });
    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
        throw new Error('Claude did not return a tool_use block — cannot parse suggestions.');
    }
    const input = toolBlock.input;
    // Clamp matchPercentage to [0, 100] and round to 1 decimal
    return input.suggestions
        .map((s) => (Object.assign(Object.assign({}, s), { matchPercentage: parseFloat(Math.min(100, Math.max(0, s.matchPercentage)).toFixed(1)), estimatedSessions: Math.max(1, Math.round(s.estimatedSessions)), estimatedPricePerSession: parseFloat(s.estimatedPricePerSession.toFixed(2)) })))
        .sort((a, b) => b.matchPercentage - a.matchPercentage);
}
// ─────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────
/** camelCase → "Human Readable" */
function humanise(key) {
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (s) => s.toUpperCase())
        .trim();
}
/** Map a score to a human severity label for the prompt context. */
function severity(key, val) {
    // Hydration is inverted — low score = problem
    if (key === 'hydration') {
        if (val <= 2)
            return 'severely dry';
        if (val <= 4)
            return 'dry';
        if (val <= 6)
            return 'moderate';
        return 'well-hydrated';
    }
    if (val <= 2)
        return 'minimal';
    if (val <= 4)
        return 'mild';
    if (val <= 6)
        return 'moderate';
    if (val <= 8)
        return 'significant';
    return 'severe';
}
//# sourceMappingURL=treatmentAI.js.map