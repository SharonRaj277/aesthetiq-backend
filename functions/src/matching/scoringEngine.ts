import { Doctor, EmergencyRequest, ScoredDoctor, ScoreBreakdown } from '../types';
import { distanceScore } from '../utils/geoUtils';

// ─────────────────────────────────────────
// WEIGHTS
// ─────────────────────────────────────────

interface Weights {
  distance: number;
  availability: number;
  language: number;
  rating: number;
  responseSpeed: number;
}

const DEFAULT_WEIGHTS: Weights = {
  distance: 0.30,
  availability: 0.25,
  language: 0.20,
  rating: 0.15,
  responseSpeed: 0.10,
};

/** Relaxed weights used after the first 8-second timeout. */
const RELAXED_WEIGHTS: Weights = {
  distance: 0.20,   // farther doctors allowed
  availability: 0.30,
  language: 0.15,   // reduced — language less critical when no doctors available
  rating: 0.20,
  responseSpeed: 0.15,
};

const SPECIALIZATION_BOOST = 0.15;

// ─────────────────────────────────────────
// INDIVIDUAL SCORERS
// ─────────────────────────────────────────

/**
 * Language matching score.
 *
 * Primary language match      → 1.2  (boost)
 * ≥2 common languages         → 1.0
 * 1 common language           → 0.7
 * Only English in common      → 0.4
 * No common language          → 0.0
 */
function languageScore(doctor: Doctor, request: EmergencyRequest): number {
  const common = doctor.languages.filter((lang) =>
    request.languages.map((l) => l.toLowerCase()).includes(lang.toLowerCase())
  );

  if (common.length === 0) return 0;

  const primaryMatch = common.some(
    (l) => l.toLowerCase() === request.primaryLanguage.toLowerCase()
  );
  if (primaryMatch) return 1.2;

  if (common.length >= 2) return 1.0;

  // Single common language
  if (common[0].toLowerCase() === 'english') return 0.4;
  return 0.7;
}

/**
 * Rating score — simple normalisation: rating / 5.
 * New doctors with no ratings get a neutral 0.5.
 */
function ratingScore(doctor: Doctor): number {
  if (!doctor.ratingCount || doctor.ratingCount === 0) return 0.5;
  return Math.min(doctor.rating / 5, 1);
}

/**
 * Response-speed score.
 * Faster avgResponseTime → higher score.
 * Normalised across the candidate pool so relative speed matters.
 */
function responseSpeedScore(doctor: Doctor, allDoctors: Doctor[]): number {
  const times = allDoctors.map((d) => d.avgResponseTime ?? 120);
  const min = Math.min(...times);
  const max = Math.max(...times);

  if (max === min) return 1.0; // everyone equally fast

  const doctorTime = doctor.avgResponseTime ?? 120;
  return 1 - (doctorTime - min) / (max - min);
}

/**
 * +SPECIALIZATION_BOOST if doctor's specialization matches the issue type.
 */
function specializationBoost(doctor: Doctor, request: EmergencyRequest): number {
  if (!doctor.specialization || !request.issueType) return 0;
  const spec = doctor.specialization.toLowerCase();
  const issue = request.issueType.toLowerCase();
  return spec.includes(issue) || issue.includes(spec) ? SPECIALIZATION_BOOST : 0;
}

// ─────────────────────────────────────────
// MAIN SCORING FUNCTION
// ─────────────────────────────────────────

/**
 * Score and rank a pool of available doctors against an emergency request.
 *
 * @param doctors   Pre-filtered list (online, not busy, active).
 * @param request   The emergency request to match against.
 * @param relaxed   Use relaxed weights for retry rounds.
 * @returns         Doctors sorted by finalScore descending.
 */
export function scoreDoctors(
  doctors: Doctor[],
  request: EmergencyRequest,
  relaxed = false
): ScoredDoctor[] {
  const weights = relaxed ? RELAXED_WEIGHTS : DEFAULT_WEIGHTS;

  const scored: ScoredDoctor[] = doctors.map((doctor) => {
    const d = distanceScore(doctor.location, request.location);
    const a = 1.0; // Availability — pre-filtered, always 1
    const l = languageScore(doctor, request);
    const r = ratingScore(doctor);
    const s = responseSpeedScore(doctor, doctors);
    const boost = specializationBoost(doctor, request);

    const finalScore =
      d * weights.distance +
      a * weights.availability +
      l * weights.language +
      r * weights.rating +
      s * weights.responseSpeed +
      boost;

    const breakdown: ScoreBreakdown = {
      distanceScore: d,
      availabilityScore: a,
      languageScore: l,
      ratingScore: r,
      responseSpeedScore: s,
      specializationBoost: boost,
      finalScore,
    };

    return { doctor, score: finalScore, breakdown };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * How many top doctors to notify per round.
 * High severity → notify more doctors simultaneously.
 */
export function topN(severity: EmergencyRequest['severity']): number {
  return severity === 'high' ? 5 : 3;
}
