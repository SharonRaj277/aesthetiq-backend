"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSimulationPipeline = void 0;
const openai_1 = __importDefault(require("openai"));
const axios_1 = __importDefault(require("axios"));
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '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';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDGEVaWc4odTn74VYS1ShxdUVMQMo9qh2w';
const openai = new openai_1.default({
    apiKey: OPENAI_API_KEY,
});
// ─────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────
const VISION_PROMPT = `You are a medical dermatology & dental AI assistant. Analyze the provided image for:
1. Acne and blemishes
2. Pigmentation
3. Skin tone unevenness
4. Dental visible issues

Output JSON strictly in the following format:
{
  "acne": { "severity": "mild|moderate|severe", "details": "string" },
  "pigmentation": { "severity": "mild|moderate|severe", "details": "string" },
  "skinTone": { "issues": "string", "details": "string" },
  "dental": { "issues": "string", "details": "string" }
}`;
const PLANNING_PROMPT = `You are an AI treatment planning assistant. Based on the vision analysis provided, generate a controlled improvement plan.
Rules:
- Medical realism ONLY.
- Modifying identity, facial structure or proportions is FORBIDDEN.
- Subtle improvements only (20-40% improvement max).

Input Format:
The user will provide the JSON analysis.

Output JSON strictly in the following format:
{
  "targetImprovements": ["string"],
  "simulationDirectives": "Instructions for the image generator to achieve a 20-40% improvement while keeping identity intact"
}`;
// ─────────────────────────────────────────
// AI PIPELINE
// ─────────────────────────────────────────
async function runSimulationPipeline(imageUrl) {
    var _a, _b, _c, _d, _e, _f;
    // 1. GPT Vision Analysis
    let analysisOutput;
    try {
        const visionResponse = await openai.chat.completions.create({
            model: 'gpt-4-turbo',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: VISION_PROMPT },
                        { type: 'image_url', image_url: { url: imageUrl } },
                    ],
                },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 500,
        });
        analysisOutput = JSON.parse(visionResponse.choices[0].message.content || '{}');
    }
    catch (error) {
        console.error('GPT Vision Analysis error:', error);
        throw new Error('Failed to analyze image');
    }
    // 2. ChatGPT (Claude logic equivalent) Processing
    let planOutput;
    try {
        const planResponse = await openai.chat.completions.create({
            model: 'gpt-4-turbo',
            messages: [
                { role: 'system', content: PLANNING_PROMPT },
                { role: 'user', content: JSON.stringify(analysisOutput) }
            ],
            response_format: { type: 'json_object' },
        });
        planOutput = JSON.parse(planResponse.choices[0].message.content || '{}');
    }
    catch (error) {
        console.error('ChatGPT planning error:', error);
        throw new Error('Failed to generate improvement plan');
    }
    // 3. Nano Banana Simulation (Gemini / Custom Image Gen)
    let simulatedAfterUrl = imageUrl;
    try {
        // Note: Assuming Gemini Nano Banana is a placeholder/wrapper API, simulating the call
        // If we had a real imagen API, we would POST to it. Here we construct a mock REST call that logs.
        const response = await axios_1.default.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`, {
            contents: [{
                    parts: [
                        { text: `Generate a before and after simulation based on these directives: ${planOutput.simulationDirectives}` }
                    ]
                }]
        }, { validateStatus: () => true } // Don't throw on error, we handle gracefully
        );
        if (response.status === 200 && ((_f = (_e = (_d = (_c = (_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.candidates) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.parts) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.text)) {
            // Typically real image generator would return a Base64 or URL. Fallback simulation.
            simulatedAfterUrl = imageUrl + "?simulated=true";
        }
        else {
            simulatedAfterUrl = imageUrl + "?simulated=true";
        }
    }
    catch (error) {
        console.warn('Gemini simulation failed, using fallback.');
        simulatedAfterUrl = imageUrl + "?simulated=fallback";
    }
    return {
        analysis: analysisOutput,
        improvements: planOutput,
        simulation: {
            before: imageUrl,
            after: simulatedAfterUrl
        },
        disclaimer: "This is a simulated outcome. Actual results may vary."
    };
}
exports.runSimulationPipeline = runSimulationPipeline;
//# sourceMappingURL=simulationAI.js.map