/*
 * The assistant's knowledge of the product, on the frontend side.
 * Same single source of truth as the backend: features.json, read there by utils/feature_registry.py.
 *
 * This file only reads the registry and matches words against it. It calls nothing and changes nothing.
 * The Confirm rule for anything marked "writes" is enforced on the server (utils/feature_registry.validate_proposal);
 * isWrite() here is for the UI, so a Confirm card can be shown before the request is even sent.
 */
import registry from './features.json';

export const REGISTRY_VERSION = registry.version;
export const FEATURES = registry.features;
export const ACTION_VOCABULARY = registry.actionVocabulary;
export const MAX_CANDIDATES = 4;

export function getFeature(id) {
  return FEATURES.find((f) => f.id === id) || null;
}

export function getAction(featureId, actionId) {
  const f = getFeature(featureId);
  return f ? f.actions.find((a) => a.id === actionId) || null : null;
}

/** True when this action changes or sends data. An unknown feature or action counts as a write: never assume it is safe. */
export function isWrite(featureId, actionId) {
  const a = getAction(featureId, actionId);
  return a ? Boolean(a.writes) : true;
}

// Keep non-Latin letters (Devanagari, Tamil); drop punctuation only. Mirrors _norm() in utils/feature_registry.py.
function norm(text) {
  return String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function aliasList(feature) {
  return Object.values(feature.aliases || {}).flat();
}

/** How well one feature matches the sentence. Mirrors score_feature() in utils/feature_registry.py. */
export function scoreFeature(text, feature) {
  const haystack = ` ${norm(text)} `;
  let score = 0;
  for (const alias of [...aliasList(feature), feature.name]) {
    const needle = norm(alias);
    if (!needle) continue;
    if (haystack.includes(` ${needle} `)) score += 3 * needle.split(' ').length;
    else if (needle.length >= 5 && haystack.includes(needle)) score += 1;
  }
  return score;
}

/** The few features a sentence could be about, best first. */
export function findCandidates(text, limit = MAX_CANDIDATES) {
  return FEATURES
    .map((f, i) => ({ f, i, s: scoreFeature(text, f) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .slice(0, limit)
    .map((x) => x.f);
}

/** Empty-state suggestions, generated from the registry rather than hard-coded. */
export function suggestionChips(limit = 6) {
  return FEATURES.filter((f) => f.actions.some((a) => a.id === 'open')).slice(0, limit).map((f) => `Open ${f.name}`);
}

export default FEATURES;
