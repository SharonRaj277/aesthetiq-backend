'use strict';

/**
 * engine/treatmentMapper.js
 *
 * Rule-based facial measurement → treatment recommendation engine.
 *
 * Each rule defines:
 *   id          — dedup key (one entry per id in output)
 *   treatment   — display name
 *   target      — anatomical area targeted
 *   evaluate    — fn(measurements) → false | { reason, severity }
 *
 * severity drives priority:
 *   3 = major  → high
 *   2 = moderate → medium
 *   1 = minor  → low
 */

// ─── Numeric guard ────────────────────────────────────────────────────────────
// Returns the value if it's a finite number, otherwise null.
function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function severityToPriority(s) {
  if (s >= 3) return 'high';
  if (s >= 2) return 'medium';
  return 'low';
}

// ─── Rule definitions ─────────────────────────────────────────────────────────

const RULES = [

  // ── 1. JAWLINE ─────────────────────────────────────────────────────────────
  {
    id: 'jawline_filler',
    treatment: 'Jawline Filler',
    target: 'Jawline',
    evaluate({ gonialAngle, jawlineDefinition }) {
      const angle = num(gonialAngle);
      const soft = typeof jawlineDefinition === 'string' &&
                   jawlineDefinition.toLowerCase() === 'soft';

      if (angle !== null && angle > 145) {
        return {
          reason: `Gonial angle measured at ${angle}° (ideal 115–125°), which is notably above the aesthetic range and contributes to a significantly softened jaw contour. Jawline filler can improve angular definition and restore a more structured profile.`,
          severity: 3,
        };
      }
      if (angle !== null && angle > 135) {
        return {
          reason: `Gonial angle measured at ${angle}° (ideal 115–125°), indicating a moderately wide jaw angle and reduced definition along the mandibular border. Jawline filler may enhance contour and improve lower-face projection.`,
          severity: soft ? 3 : 2,
        };
      }
      if (soft) {
        return {
          reason: `Jawline definition assessed as soft (ideal: defined to sharp). A softer jawline can reduce perceived facial structure and lower-face frame. Targeted filler placement can improve angularity and overall definition.`,
          severity: 2,
        };
      }
      return false;
    },
  },

  // ── 2. CHIN ────────────────────────────────────────────────────────────────
  {
    id: 'chin_filler',
    treatment: 'Chin Filler',
    target: 'Chin',
    evaluate({ chinProjection }) {
      if (typeof chinProjection !== 'string') return false;
      const val = chinProjection.toLowerCase();

      if (val === 'recessed') {
        return {
          reason: `Chin projection graded as recessed/5 (ideal: normal or slightly anterior to the E-plane). The chin sits notably behind the E-plane, which can reduce profile harmony and lower-face balance. Chin filler can improve forward projection and may enhance overall facial proportion.`,
          severity: 3,
        };
      }
      if (val === 'slightly_recessed') {
        return {
          reason: `Chin projection graded as slightly_recessed/5 (ideal: normal or slightly anterior to the E-plane). The chin falls marginally behind the E-plane reference line, creating a subtle profile imbalance. A conservative volume of filler may improve chin projection and enhance lower-face symmetry.`,
          severity: 2,
        };
      }
      return false;
    },
  },

  // ── 3. LIPS ────────────────────────────────────────────────────────────────
  {
    id: 'lip_filler',
    treatment: 'Lip Filler',
    target: 'Lips',
    evaluate({ lipRatio }) {
      const ratio = num(lipRatio);
      if (ratio === null) return false;

      if (ratio < 0.9) {
        return {
          reason: `Upper-to-lower lip ratio measured at ${ratio.toFixed(2)} (ideal 1:1.6). This indicates a marked imbalance between upper and lower lip volumes. Lip filler can restore proportion, add definition to the vermillion border, and improve overall lip harmony.`,
          severity: 3,
        };
      }
      if (ratio < 1.2) {
        return {
          reason: `Upper-to-lower lip ratio measured at ${ratio.toFixed(2)} (ideal 1:1.6). The upper lip is proportionally smaller than the lower, falling below the aesthetic ideal. Subtle lip filler may enhance upper lip volume and improve the balance between both lips.`,
          severity: 2,
        };
      }
      return false;
    },
  },

  // ── 4. NOSE ────────────────────────────────────────────────────────────────
  {
    id: 'nose_contouring',
    treatment: 'Nose Contouring / Rhinoplasty',
    target: 'Nose',
    evaluate({ noseWidthRatio, nasolabialAngle }) {
      const broad = typeof noseWidthRatio === 'string' &&
                    noseWidthRatio.toLowerCase() === 'broad';
      const angle = num(nasolabialAngle);

      // Nasolabial angle: ideal is 90–120°. Outside that range = concern.
      const angleDeviation = angle !== null && (angle < 85 || angle > 130);

      if (broad && angleDeviation) {
        return {
          reason: `Nose width ratio assessed as broad (ideal: equal to intercanthal distance) and nasolabial angle measured at ${angle}° (ideal 90–120°). Both findings together suggest that non-surgical contouring or rhinoplasty consultation may be beneficial to improve nasal proportion and tip position.`,
          severity: 3,
        };
      }
      if (broad) {
        return {
          reason: `Nose width ratio graded as broad/3 (ideal: equal to intercanthal distance). A wider-than-ideal alar base reduces the proportional balance between the nose and midface. Non-surgical nose contouring or rhinoplasty may improve overall facial proportion.`,
          severity: 2,
        };
      }
      if (angleDeviation) {
        return {
          reason: `Nasolabial angle measured at ${angle}° (ideal 90–120°). This deviation from the ideal range affects the apparent tip rotation and upper lip relationship. Tip refinement procedures may be considered to restore a more balanced nasal-labial junction.`,
          severity: 2,
        };
      }
      return false;
    },
  },

  // ── 5. FACIAL THIRDS ───────────────────────────────────────────────────────
  {
    id: 'facial_balancing',
    treatment: 'Facial Balancing Treatments',
    target: 'Facial Thirds',
    evaluate({ facialThirdsBalance }) {
      const score = num(facialThirdsBalance);
      if (score === null) return false;

      if (score < 60) {
        return {
          reason: `Facial thirds balance scored at ${score}/100 (ideal ≥ 85/100). A score in this range reflects a notable disproportion across the upper, mid, and lower facial thirds. Targeted balancing treatments may help redistribute volume and improve overall vertical facial harmony.`,
          severity: 3,
        };
      }
      if (score < 75) {
        return {
          reason: `Facial thirds balance scored at ${score}/100 (ideal ≥ 85/100). A moderate imbalance is present between one or more facial zones. Facial balancing treatments can help address the under-projected or over-projected zone and improve proportional harmony.`,
          severity: 2,
        };
      }
      return false;
    },
  },

  // ── 6. SYMMETRY ────────────────────────────────────────────────────────────
  {
    id: 'symmetry_correction',
    treatment: 'Facial Symmetry Correction',
    target: 'Facial Symmetry',
    evaluate({ symmetryScore }) {
      const score = num(symmetryScore);
      if (score === null) return false;

      if (score < 60) {
        return {
          reason: `Bilateral symmetry scored at ${score}/100 (ideal ≥ 85/100). This level of asymmetry is clinically visible and may affect the perceived balance of features across both sides of the face. Strategic filler placement or corrective treatment can help reduce the asymmetry and improve overall facial harmony.`,
          severity: 3,
        };
      }
      if (score < 75) {
        return {
          reason: `Bilateral symmetry scored at ${score}/100 (ideal ≥ 85/100). A degree of left-right asymmetry is present that may subtly affect facial balance. Targeted treatment to the less projected side can improve symmetry and enhance the overall appearance.`,
          severity: 2,
        };
      }
      return false;
    },
  },

  // ── 7. GOLDEN RATIO / OVERALL HARMONY ─────────────────────────────────────
  {
    id: 'harmonisation',
    treatment: 'Facial Harmonisation',
    target: 'Overall Proportion',
    evaluate({ goldenRatioScore }) {
      const score = num(goldenRatioScore);
      if (score === null) return false;

      if (score < 55) {
        return {
          reason: `Golden ratio adherence scored at ${score}/100 (ideal ≥ 85/100). Multiple facial proportions deviate notably from the 1:1.618 aesthetic reference, affecting the overall perception of balance. A comprehensive facial harmonisation plan may be beneficial to address the key areas of disproportion.`,
          severity: 3,
        };
      }
      if (score < 70) {
        return {
          reason: `Golden ratio adherence scored at ${score}/100 (ideal ≥ 85/100). Overall facial proportions fall below the ideal reference range across several zones. A targeted multi-area harmonisation approach can improve the interplay between features and enhance facial balance.`,
          severity: 2,
        };
      }
      if (score < 80) {
        return {
          reason: `Golden ratio adherence scored at ${score}/100 (ideal ≥ 85/100). Proportions are close to the ideal range with minor deviations in one or two areas. Subtle refinements may be considered to bring the overall appearance closer to aesthetic harmony.`,
          severity: 1,
        };
      }
      return false;
    },
  },

  // ── 8. JAW-TO-CHEEK RATIO ─────────────────────────────────────────────────
  {
    id: 'cheek_augmentation',
    treatment: 'Cheek Augmentation / Malar Filler',
    target: 'Cheekbones',
    evaluate({ jawToCheekRatio }) {
      const ratio = num(jawToCheekRatio);
      if (ratio === null) return false;

      // Ideal jawToCheek ratio: jaw should be ~70–80% of cheek width
      // >0.90 → jaw too wide vs cheeks (flat midface)
      // <0.65 → jaw too narrow (hollow midface)
      if (ratio > 0.92) {
        return {
          reason: `Jaw-to-cheek ratio measured at ${ratio.toFixed(2)} (ideal 0.70–0.88). The jaw width approaches the cheek width, which reduces the natural V-taper and suggests a flat or under-projected midface. Malar filler can restore cheekbone prominence, improve midface lift, and re-establish the ideal facial taper.`,
          severity: 3,
        };
      }
      if (ratio > 0.88) {
        return {
          reason: `Jaw-to-cheek ratio measured at ${ratio.toFixed(2)} (ideal 0.70–0.88). The cheekbone prominence is mildly reduced relative to the jaw width. Targeted malar filler may enhance midface definition and improve the overall balance between cheek and jaw.`,
          severity: 2,
        };
      }
      if (ratio < 0.62) {
        return {
          reason: `Jaw-to-cheek ratio measured at ${ratio.toFixed(2)} (ideal 0.70–0.88). The jaw is notably narrower than the cheekbones, which may create a hollow or gaunt appearance in the lower face. Cheek volume assessment alongside jaw contouring may be considered to restore proportion.`,
          severity: 1,
        };
      }
      return false;
    },
  },

];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * mapTreatments(measurements)
 *
 * Runs all rules against the provided measurements and returns
 * a deduplicated, priority-sorted recommendation list.
 *
 * @param {object} measurements — see INPUT contract in spec
 * @returns {{ treatment, target, reason, priority }[]}
 */
function mapTreatments(measurements) {
  if (!measurements || typeof measurements !== 'object') {
    throw new TypeError('measurements must be a non-null object');
  }

  const seen = new Set();
  const results = [];

  for (const rule of RULES) {
    if (seen.has(rule.id)) continue;   // dedup by rule id (shouldn't happen, but guard)

    let match;
    try {
      match = rule.evaluate(measurements);
    } catch (err) {
      // A single rule error never breaks the whole response
      console.warn(`[treatmentMapper] Rule "${rule.id}" threw:`, err.message);
      continue;
    }

    if (!match) continue;

    seen.add(rule.id);
    results.push({
      treatment: rule.treatment,
      target: rule.target,
      reason: match.reason,
      priority: severityToPriority(match.severity),
    });
  }

  // Sort: high → medium → low
  const ORDER = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);

  return results;
}

module.exports = { mapTreatments };
