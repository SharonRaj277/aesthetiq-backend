'use strict';

/**
 * engine/treatmentMatcher.js
 *
 * Matches AI-generated treatment names to catalogue entries from the backend.
 *
 * Strategy: token-overlap scoring (Jaccard-style).
 *   1. Tokenise both strings (lowercase words, strip punctuation).
 *   2. Compute overlap / union.
 *   3. Return the highest-scoring catalogue entry above MIN_SCORE.
 *   4. If multiple suggestions map to the same catalogue entry, dedup by id.
 */

// ─── Stop-words to ignore during token comparison ────────────────────────────
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'with',
  'non', 'surgical', 'procedure',
]);

function tokenise(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function jaccardScore(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Minimum score to consider a match valid (0–1)
const MIN_SCORE = 0.15;

/**
 * findBestMatch(suggestionName, catalogue)
 *
 * @param {string} suggestionName — e.g. "Jawline Filler"
 * @param {Array}  catalogue      — treatment objects from /api/treatments
 * @returns {{ item, score, matchedName } | null}
 */
function findBestMatch(suggestionName, catalogue) {
  const queryTokens = tokenise(suggestionName);
  if (queryTokens.length === 0) return null;

  let best = null;
  let bestScore = -1;

  for (const item of catalogue) {
    const nameTokens = tokenise(item.name || '');
    const score = jaccardScore(queryTokens, nameTokens);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (best === null || bestScore < MIN_SCORE) return null;

  return { item: best, score: bestScore, matchedName: best.name };
}

/**
 * matchTreatments(suggestions, catalogue)
 *
 * @param {Array<{treatment: string, [rest]: any}>} suggestions
 * @param {Array} catalogue
 * @returns {Array<{original, matchedName, score, item}>}
 */
function matchTreatments(suggestions, catalogue) {
  if (!Array.isArray(suggestions)) throw new TypeError('suggestions must be an array');
  if (!Array.isArray(catalogue))   throw new TypeError('catalogue must be an array');

  const seenIds = new Set();
  const results = [];

  for (const suggestion of suggestions) {
    const name = suggestion.treatment || suggestion.name || '';
    const match = findBestMatch(name, catalogue);

    if (!match) {
      results.push({ original: name, matched: false });
      continue;
    }

    // Dedup: if this catalogue item already matched an earlier suggestion, skip
    const itemId = match.item.id ?? match.item.name;
    if (seenIds.has(itemId)) {
      results.push({ original: name, matched: false, note: 'duplicate catalogue entry' });
      continue;
    }

    seenIds.add(itemId);
    results.push({
      original: name,
      matched: true,
      score: parseFloat(match.score.toFixed(3)),
      matchedName: match.matchedName,
      item: match.item,
    });
  }

  return results;
}

module.exports = { matchTreatments, findBestMatch, tokenise };
