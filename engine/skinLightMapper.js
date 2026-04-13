'use strict';

/**
 * engine/skinLightMapper.js
 *
 * Multi-light skin analysis → treatment recommendation engine.
 *
 * Each rule ingests the full multiLightFindings + crossLightInsights object
 * and emits zero or more treatment candidates.
 *
 * Priority system:
 *   base severity  3 = high  |  2 = medium  |  1 = low
 *   cross-light boost: +1 per additional light that confirms the finding
 *   final priority:  score ≥ 4 → high  |  score ≥ 2 → medium  |  else → low
 *
 * ─── Expected input shape ────────────────────────────────────────────────────
 * {
 *   multiLightFindings: {
 *     natural:    { texture, pores, unevenTone, redness, ... },
 *     blueLight:  { sebumPattern, acneScore, poreClogging, ... },
 *     greenLight: { erythemaPattern, vascularActivity, sensitivityIndex, ... },
 *     redLight:   { deepPigmentation, subdermalActivity, ... },
 *     uvLight:    { sunDamage, superficialPigmentation, ... },
 *     rakingFlash:{ scarDepth, textureRidges, poreDepth, ... },
 *     woodsLamp:  { fungalPresence, dehydration, ... },
 *   },
 *   crossLightInsights: {
 *     pigmentation: { visibleInNatural, visibleInBlue, visibleInRed, ... },
 *     sebum:        { confirmedAcross: ['blueLight', 'woodsLamp'] },
 *     redness:      { confirmedAcross: [...] },
 *     scars:        { confirmedAcross: [...] },
 *     texture:      { confirmedAcross: [...] },
 *     pores:        { confirmedAcross: [...] },
 *     dehydration:  { confirmedAcross: [...] },
 *   },
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely drill into a nested object without throwing. */
function dig(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Normalise a string value to lowercase-trimmed or null. */
function str(v) {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().toLowerCase() : null;
}

/** Normalise a number or null. */
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Count how many lights confirm a finding through crossLightInsights.
 * confirmedAcross is expected to be an array of light-source names.
 */
function crossLightCount(crossLightInsights, finding) {
  const arr = dig(crossLightInsights, finding, 'confirmedAcross');
  return Array.isArray(arr) ? arr.length : 0;
}

/**
 * Convert a raw severity score (with cross-light boost applied) to a priority label.
 */
function scoreToPriority(score) {
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

/**
 * Build the final priority, factoring in cross-light confirmation.
 * baseSeverity: 1|2|3
 * crossCount:   number of additional light sources confirming the issue
 */
function derivePriority(baseSeverity, crossCount) {
  // Each additional confirming light adds 0.5 to the score
  const score = baseSeverity + crossCount * 0.5;
  return scoreToPriority(score);
}

// ─── Rule definitions ─────────────────────────────────────────────────────────
//
// Each rule:
//   id          — dedup key
//   treatment   — display name
//   target      — anatomical / skin area
//   evaluate(multiLightFindings, crossLightInsights)
//     → false  |  { reason, baseSeverity, lightsInvolved }
//
// lightsInvolved: array of light-source names that contributed to this finding
//   (used to build measuredJustification and for audit).

const RULES = [

  // ── 1a. ACNE — Sebum / pore congestion (blue light primary) ─────────────────
  {
    id: 'acne_treatment',
    treatment: 'Acne Treatment (BHA / Salicylic Protocol)',
    target: 'Active Acne & Sebaceous Glands',
    evaluate(f, c) {
      const sebum = str(dig(f, 'blueLight', 'sebumPattern'));
      const acneScore = num(dig(f, 'blueLight', 'acneScore'));
      const clogging = str(dig(f, 'blueLight', 'poreClogging'));
      const crossCount = crossLightCount(c, 'sebum');

      if (sebum !== 'high' && (acneScore === null || acneScore < 40) && clogging !== 'significant') {
        return false;
      }

      const parts = [];
      if (sebum === 'high') parts.push(`blue-light sebum pattern: high`);
      if (acneScore !== null && acneScore >= 40) parts.push(`acne severity index: ${acneScore}/100`);
      if (clogging === 'significant') parts.push(`pore congestion: significant`);

      const crossStr = crossCount > 1
        ? ` Finding confirmed across ${crossCount} light sources, elevating clinical confidence.`
        : '';

      return {
        reason: `Blue-light analysis detected ${parts.join('; ')} (ideal: low sebum, acne index < 20, no significant congestion). Elevated sebaceous activity combined with pore congestion indicates a comedonal-to-inflammatory acne pattern. A BHA/salicylic acid protocol can regulate sebum output, clear blocked follicles, and reduce active lesion count.${crossStr}`,
        baseSeverity: sebum === 'high' ? 3 : 2,
        lightsInvolved: ['blueLight', ...( crossCount > 0 ? (dig(c, 'sebum', 'confirmedAcross') || []) : [])],
      };
    },
  },

  // ── 1b. OIL CONTROL — High sebum without active inflammatory acne ────────────
  {
    id: 'oil_control_therapy',
    treatment: 'Oil Control Therapy (Niacinamide / Sebum Regulation)',
    target: 'Sebaceous Glands',
    evaluate(f, c) {
      const sebum = str(dig(f, 'blueLight', 'sebumPattern'));
      const acneScore = num(dig(f, 'blueLight', 'acneScore'));
      const crossCount = crossLightCount(c, 'sebum');

      // Only fire if sebum is high/moderate — regardless of acne state
      if (sebum !== 'high' && sebum !== 'moderate') return false;

      const crossStr = crossCount > 1
        ? ` Confirmed in ${crossCount} light spectra, strengthening the recommendation.`
        : '';

      return {
        reason: `Blue-light sebum pattern graded as "${sebum}" (ideal: low-to-normal). Overactive sebaceous output creates a chronic environment that supports comedone formation, enlarged pores, and shine. Topical niacinamide combined with a sebum-regulating regimen can normalise gland activity and reduce pore prominence.${crossStr}`,
        baseSeverity: sebum === 'high' ? 2 : 1,
        lightsInvolved: ['blueLight'],
      };
    },
  },

  // ── 2. REDNESS / ERYTHEMA (green light primary) ───────────────────────────────
  {
    id: 'anti_redness_treatment',
    treatment: 'Anti-Redness Vascular Treatment (IPL / Azelaic Protocol)',
    target: 'Erythema & Superficial Vasculature',
    evaluate(f, c) {
      const erythema = str(dig(f, 'greenLight', 'erythemaPattern'));
      const vascular = str(dig(f, 'greenLight', 'vascularActivity'));
      const sensitivity = num(dig(f, 'greenLight', 'sensitivityIndex'));
      const crossCount = crossLightCount(c, 'redness');

      const hasErythema = erythema && erythema !== 'none' && erythema !== 'absent';
      const hasVascular = vascular && vascular !== 'normal' && vascular !== 'low';
      const hasSensitivity = sensitivity !== null && sensitivity > 40;

      if (!hasErythema && !hasVascular && !hasSensitivity) return false;

      const parts = [];
      if (hasErythema) parts.push(`erythema pattern: ${erythema}`);
      if (hasVascular) parts.push(`vascular activity: ${vascular}`);
      if (hasSensitivity) parts.push(`sensitivity index: ${sensitivity}/100`);

      const crossStr = crossCount > 1
        ? ` Cross-light confirmation in ${crossCount} spectra indicates persistent vascular involvement.`
        : '';

      const severity = (erythema === 'diffuse' || erythema === 'severe' || (sensitivity !== null && sensitivity > 65)) ? 3
                     : (hasErythema && hasVascular) ? 2
                     : 1;

      return {
        reason: `Green-light analysis detected ${parts.join('; ')} (ideal: no erythema, vascular activity normal, sensitivity index < 30). Green-spectrum imaging selectively highlights oxyhemoglobin, making erythema and superficial vessel dilation clearly visible. IPL or an azelaic acid protocol can selectively target haemoglobin and reduce chronic facial redness. Note: strong chemical peels should be avoided as they may exacerbate vascular reactivity.${crossStr}`,
        baseSeverity: severity,
        lightsInvolved: ['greenLight'],
      };
    },
  },

  // ── 3. SCARS / TEXTURE DEPTH (raking flash primary) ──────────────────────────
  {
    id: 'microneedling',
    treatment: 'Microneedling (Collagen Induction Therapy)',
    target: 'Atrophic Scars & Dermal Texture',
    evaluate(f, c) {
      const scarDepth = str(dig(f, 'rakingFlash', 'scarDepth'));
      const textureRidges = str(dig(f, 'rakingFlash', 'textureRidges'));
      const crossCount = crossLightCount(c, 'scars');

      const isModerate = scarDepth === 'moderate';
      const isDeep = scarDepth === 'deep' || scarDepth === 'severe';

      if (!isModerate && !isDeep && textureRidges !== 'prominent' && textureRidges !== 'significant') return false;

      const parts = [];
      if (scarDepth) parts.push(`scar depth: ${scarDepth}`);
      if (textureRidges && textureRidges !== 'minimal') parts.push(`texture ridges: ${textureRidges}`);

      const crossStr = crossCount > 1
        ? ` Scar architecture verified in ${crossCount} light spectra.`
        : '';

      return {
        reason: `Raking-flash (oblique) illumination detected ${parts.join('; ')} (ideal: no visible scar depth, smooth texture). Raking light creates shadows that amplify surface relief, accurately mapping dermal depressions and ridge depth. Microneedling induces controlled micro-trauma to stimulate collagen and elastin remodelling, progressively reducing scar depth and improving surface texture.${crossStr}`,
        baseSeverity: isDeep ? 3 : 2,
        lightsInvolved: ['rakingFlash'],
      };
    },
  },

  {
    id: 'laser_resurfacing',
    treatment: 'Fractional Laser Resurfacing (CO₂ / Erbium)',
    target: 'Deep Scars & Dermal Remodelling',
    evaluate(f, c) {
      const scarDepth = str(dig(f, 'rakingFlash', 'scarDepth'));
      const crossCount = crossLightCount(c, 'scars');

      // Laser is indicated for moderate-deep, microneedling for moderate alone;
      // both can fire — they are complementary, not duplicates.
      if (scarDepth !== 'deep' && scarDepth !== 'severe' && scarDepth !== 'moderate') return false;

      const crossStr = crossCount > 1
        ? ` Confirmed through ${crossCount} light modes.`
        : '';

      return {
        reason: `Raking-flash illumination graded scar depth as "${scarDepth}" (ideal: absent). At this depth, fractional laser resurfacing ablates damaged epidermal and superficial dermal columns, triggering robust collagen synthesis. This approach reaches tissue planes that topical or needling therapies cannot access, making it the gold-standard option for moderate-to-deep acne or traumatic scarring.${crossStr}`,
        baseSeverity: scarDepth === 'moderate' ? 2 : 3,
        lightsInvolved: ['rakingFlash'],
      };
    },
  },

  // ── 4a. SURFACE PIGMENTATION — natural + blue light ──────────────────────────
  {
    id: 'pigmentation_peels',
    treatment: 'Chemical Peel (AHA / Kojic Acid — Superficial Pigmentation)',
    target: 'Epidermal Pigmentation',
    evaluate(f, c) {
      const visNatural = dig(c, 'pigmentation', 'visibleInNatural');
      const visBlue    = dig(c, 'pigmentation', 'visibleInBlue');
      const visRed     = dig(c, 'pigmentation', 'visibleInRed');
      const uvDamage   = str(dig(f, 'uvLight', 'superficialPigmentation'));
      const crossCount = crossLightCount(c, 'pigmentation');

      // Surface pigmentation: visible in natural AND/OR blue, NOT exclusively in red
      const isSurface = (visNatural || visBlue) && !visRed;
      const hasUV = uvDamage && uvDamage !== 'none' && uvDamage !== 'absent';

      if (!isSurface && !hasUV) return false;

      const lights = [];
      if (visNatural) lights.push('natural light');
      if (visBlue)    lights.push('blue light');
      if (hasUV)      lights.push('UV light');

      const crossStr = crossCount > 1
        ? ` Multi-light confirmation (${crossCount} spectra) indicates consistent superficial melanin deposition.`
        : '';

      return {
        reason: `Pigmentation detected in ${lights.join(' and ')} (ideal: absent across all spectra). Visibility in natural and blue light places melanin within the epidermis and papillary dermis — the upper skin layers accessible to chemical exfoliants. AHA or kojic acid peels accelerate corneocyte turnover, dispersing superficial melanin clusters and reducing the appearance of post-inflammatory hyperpigmentation, sun spots, and uneven tone.${crossStr}`,
        baseSeverity: (visNatural && visBlue) ? 3 : 2,
        lightsInvolved: lights,
      };
    },
  },

  // ── 4b. DEEP PIGMENTATION — red light ─────────────────────────────────────────
  {
    id: 'pigmentation_laser',
    treatment: 'Q-Switch / Nd:YAG Laser (Deep Pigmentation)',
    target: 'Dermal Pigmentation',
    evaluate(f, c) {
      const visRed     = dig(c, 'pigmentation', 'visibleInRed');
      const deepPig    = str(dig(f, 'redLight', 'deepPigmentation'));
      const subdermal  = str(dig(f, 'redLight', 'subdermalActivity'));
      const crossCount = crossLightCount(c, 'pigmentation');

      const hasDeep = visRed || (deepPig && deepPig !== 'none' && deepPig !== 'absent');

      if (!hasDeep) return false;

      const parts = [];
      if (visRed) parts.push('red-light deep pigmentation signal');
      if (deepPig && deepPig !== 'none') parts.push(`deep pigmentation level: ${deepPig}`);
      if (subdermal && subdermal !== 'normal') parts.push(`subdermal activity: ${subdermal}`);

      const crossStr = crossCount > 1
        ? ` Cross-spectral analysis in ${crossCount} light modes confirms dermal depth involvement.`
        : '';

      return {
        reason: `Red-light spectrum detected ${parts.join('; ')} (ideal: no dermal pigmentation signal). Red light penetrates to the mid-to-deep dermis; pigmentation visible only in this channel indicates melanin deposits below the reach of chemical peels. Q-Switch or Nd:YAG laser delivers selective photothermolysis to dermal melanin granules without affecting surrounding tissue, making it the preferred modality for melasma, naevus of Ota, and dermal post-inflammatory hyperpigmentation.${crossStr}`,
        baseSeverity: 3,
        lightsInvolved: ['redLight'],
      };
    },
  },

  // ── 5. PORE CONGESTION / ENLARGED PORES (blue + raking) ──────────────────────
  {
    id: 'pore_refining',
    treatment: 'Pore Refining Treatment (Retinoid / Laser Toning)',
    target: 'Enlarged Pores & Follicular Openings',
    evaluate(f, c) {
      const poreDepth   = str(dig(f, 'rakingFlash', 'poreDepth'));
      const clogging    = str(dig(f, 'blueLight',   'poreClogging'));
      const crossCount  = crossLightCount(c, 'pores');

      const hasPoreDepth = poreDepth && poreDepth !== 'normal' && poreDepth !== 'minimal';
      const hasClogging  = clogging  && clogging  !== 'none'   && clogging  !== 'minimal';

      if (!hasPoreDepth && !hasClogging) return false;

      const parts = [];
      if (hasPoreDepth) parts.push(`pore depth: ${poreDepth} (raking flash)`);
      if (hasClogging)  parts.push(`pore congestion: ${clogging} (blue light)`);

      const crossStr = crossCount > 1
        ? ` Confirmed across ${crossCount} light channels, indicating structural and sebaceous pore involvement.`
        : '';

      return {
        reason: `Multi-light pore assessment detected ${parts.join('; ')} (ideal: shallow pore depth, no congestion). Raking flash reveals the physical diameter and depth of follicular openings, while blue light maps sebaceous congestion within them. A retinoid-based regimen normalises follicular keratinisation; laser toning reduces sebaceous gland size and tightens pore walls for longer-term refinement.${crossStr}`,
        baseSeverity: (hasPoreDepth && hasClogging) ? 3 : 2,
        lightsInvolved: ['rakingFlash', 'blueLight'],
      };
    },
  },

  // ── 6. DEHYDRATION (Wood's lamp primary) ─────────────────────────────────────
  {
    id: 'hydration_therapy',
    treatment: 'Skin Hydration Therapy (Hyaluronic Acid / Barrier Repair)',
    target: 'Stratum Corneum & Skin Barrier',
    evaluate(f, c) {
      const dehydration = str(dig(f, 'woodsLamp', 'dehydration'));
      const crossCount  = crossLightCount(c, 'dehydration');

      if (!dehydration || dehydration === 'none' || dehydration === 'absent') return false;

      const crossStr = crossCount > 1
        ? ` Dehydration signals confirmed in ${crossCount} light modes.`
        : '';

      return {
        reason: `Wood's lamp analysis detected dehydration graded as "${dehydration}" (ideal: absent). Under Wood's lamp illumination, a dehydrated stratum corneum produces a dull, white-violet fluorescence pattern distinct from well-hydrated skin. Compromised barrier function accelerates transepidermal water loss, worsening sensitivity, fine lines, and secondary irritation from other treatments. Hyaluronic acid serums combined with ceramide-rich barrier-repair creams restore water-binding capacity and reduce TEWL.${crossStr}`,
        baseSeverity: dehydration === 'severe' ? 3 : dehydration === 'moderate' ? 2 : 1,
        lightsInvolved: ['woodsLamp'],
      };
    },
  },

  // ── 7. SUN DAMAGE / PHOTOAGEING (UV light primary) ────────────────────────────
  {
    id: 'photoprotection_reversal',
    treatment: 'Photoageing Reversal (Vitamin C / Retinol / SPF Protocol)',
    target: 'UV-Induced Sun Damage',
    evaluate(f, c) {
      const sunDamage  = str(dig(f, 'uvLight', 'sunDamage'));
      const superfPig  = str(dig(f, 'uvLight', 'superficialPigmentation'));
      const crossCount = crossLightCount(c, 'pigmentation');

      const hasDamage = sunDamage && sunDamage !== 'none' && sunDamage !== 'minimal';
      const hasPig    = superfPig && superfPig !== 'none';

      if (!hasDamage && !hasPig) return false;

      const parts = [];
      if (hasDamage) parts.push(`UV sun damage: ${sunDamage}`);
      if (hasPig)    parts.push(`UV-fluorescent pigmentation: ${superfPig}`);

      const crossStr = crossCount > 1
        ? ` Pigmentation cross-confirmed in ${crossCount} light spectra.`
        : '';

      return {
        reason: `UV-light analysis detected ${parts.join('; ')} (ideal: no UV fluorescent pigmentation, sun damage absent). UV imaging reveals subclinical sun damage and porphyrin deposits not yet visible in natural light, providing an early-warning map of photoageing. A combined Vitamin C antioxidant serum, retinol (to normalise keratinisation and stimulate collagen), and daily broad-spectrum SPF 50+ forms the evidence-based first-line intervention to halt and partially reverse cumulative UV damage.${crossStr}`,
        baseSeverity: sunDamage === 'severe' ? 3 : sunDamage === 'moderate' ? 2 : 1,
        lightsInvolved: ['uvLight'],
      };
    },
  },

  // ── 8. TEXTURE / UNEVEN SURFACE (natural + raking) ───────────────────────────
  {
    id: 'skin_texture_treatment',
    treatment: 'Skin Texture Smoothing (Enzyme Peels / Microdermabrasion)',
    target: 'Epidermal Texture & Surface Regularity',
    evaluate(f, c) {
      const texture     = str(dig(f, 'natural', 'texture'));
      const ridges      = str(dig(f, 'rakingFlash', 'textureRidges'));
      const crossCount  = crossLightCount(c, 'texture');

      const hasTexture = texture && texture !== 'smooth' && texture !== 'normal';
      const hasRidges  = ridges  && ridges  !== 'minimal' && ridges !== 'absent';

      if (!hasTexture && !hasRidges) return false;

      const parts = [];
      if (hasTexture) parts.push(`natural-light texture: ${texture}`);
      if (hasRidges)  parts.push(`raking-flash ridges: ${ridges}`);

      const crossStr = crossCount > 1
        ? ` Texture confirmed across ${crossCount} light modes.`
        : '';

      return {
        reason: `Multi-light surface assessment detected ${parts.join('; ')} (ideal: smooth texture, no ridge elevation). Natural light maps gross surface irregularity while raking (oblique) flash reveals micro-relief elevation that is invisible under flat illumination. Enzyme peels dissolve the desmosomes holding dead corneocytes, producing gentle desquamation without irritation; microdermabrasion provides mechanical resurfacing for a more immediate smoothing effect.${crossStr}`,
        baseSeverity: (hasTexture && hasRidges) ? 2 : 1,
        lightsInvolved: ['natural', 'rakingFlash'],
      };
    },
  },

];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * mapSkinTreatments({ multiLightFindings, crossLightInsights })
 *
 * @param {object} input
 * @returns {{ treatment, target, priority, measuredJustification, lightsInvolved }[]}
 */
function mapSkinTreatments({ multiLightFindings, crossLightInsights } = {}) {
  if (!multiLightFindings || typeof multiLightFindings !== 'object') {
    throw new TypeError('multiLightFindings must be a non-null object');
  }

  const insights = crossLightInsights && typeof crossLightInsights === 'object'
    ? crossLightInsights
    : {};

  const seen = new Set();
  const results = [];

  for (const rule of RULES) {
    if (seen.has(rule.id)) continue;

    let match;
    try {
      match = rule.evaluate(multiLightFindings, insights);
    } catch (err) {
      console.warn(`[skinLightMapper] Rule "${rule.id}" threw:`, err.message);
      continue;
    }

    if (!match) continue;

    // Cross-light boost: count how many light sources fired
    const extraLights = (match.lightsInvolved || []).length - 1;
    const priority = derivePriority(match.baseSeverity, Math.max(0, extraLights));

    seen.add(rule.id);
    results.push({
      treatment: rule.treatment,
      target: rule.target,
      priority,
      lightsInvolved: match.lightsInvolved || [],
      measuredJustification: match.reason,
    });
  }

  // Sort: high → medium → low
  const ORDER = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);

  return results;
}

module.exports = { mapSkinTreatments };
