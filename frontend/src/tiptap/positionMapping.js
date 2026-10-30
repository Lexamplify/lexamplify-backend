// Maps a raw clause substring (as returned by the risk-analysis LLM) to
// exact ProseMirror document positions, so risk Decorations can be placed
// on the live doc instead of on stale string offsets computed against the
// ORIGINAL raw text. Offsets computed against raw text go stale the moment
// the user edits the document (or the LLM's extraction shifted a char or
// two) — searching the live doc's own flattened text sidesteps that
// entirely, at the cost of needing this file to convert a found substring
// range back into real ProseMirror positions.
//
// Walks the FULL node tree via doc.descendants — not just the doc's direct
// children — because a pasted/typed clause starting "1. " or "- " gets
// auto-converted by Tiptap's list input rules into a real orderedList/
// bulletList/listItem structure (list markers become CSS counters, not
// text), and a blockquote nests its paragraphs the same way. A shallower
// walk that only looks at direct children treats the whole list/quote
// subtree as opaque, so any clause text inside one could never be found.
// Recursing into every descendant means indentation depth no longer
// matters — a clause three list levels deep is just as findable as a
// top-level paragraph.

const BLOCK_SEPARATOR = '\n';
// Reserves exactly one flattened-text character per non-text leaf/inline
// node (e.g. an inlineCitation badge, a hardBreak) so text positions AFTER
// it don't drift and so it can never accidentally join two words together
// or get matched as if it were real clause text.
const LEAF_PLACEHOLDER = '￼';

// A list marker Tiptap's input rules strip out of the text entirely (it
// becomes the list item's implicit CSS counter) — but the LLM's excerpt
// was extracted from the ORIGINAL raw text, which still had it literally.
// "1.", "1)", "-", "*", "•" followed by whitespace, at the very start of
// the needle only.
const LIST_PREFIX_RE = /^(?:\d+[.)]|[-*•])\s+/;

// Flattens the live document into one continuous string plus a parallel
// index mapping every character of that string back to its real
// ProseMirror position — built in a single doc.descendants pass so the two
// can never drift out of sync with each other.
function buildDocumentIndex(doc) {
  let text = '';
  const indexMap = []; // indexMap[i] = ProseMirror position of text[i]

  doc.descendants((node, pos) => {
    if (node.isText) {
      const nodeText = node.text || '';
      for (let i = 0; i < nodeText.length; i++) {
        indexMap.push(pos + i);
      }
      text += nodeText;
    } else if (node.isBlock) {
      // A new block boundary (paragraph, listItem, orderedList/bulletList
      // wrapper, blockquote, heading, ...) — insert exactly one separator
      // per boundary crossed, never a run of them, so two adjacent block
      // nodes wrapping the same underlying content (e.g. listItem wrapping
      // paragraph) don't each add their own newline.
      if (text.length > 0 && !text.endsWith(BLOCK_SEPARATOR)) {
        text += BLOCK_SEPARATOR;
        indexMap.push(pos);
      }
    } else {
      // Non-text inline leaf (hardBreak, an inlineCitation atom, ...).
      text += LEAF_PLACEHOLDER;
      indexMap.push(pos);
    }
  });

  return { text, indexMap };
}

// Converts a [startIdx, endIdx) range in the flattened string (as produced
// by buildDocumentIndex) into a real ProseMirror { from, to }, clamped to
// the document's own bounds. Returns null for an empty/invalid range.
function toPmRange(doc, indexMap, startIdx, endIdx) {
  if (endIdx <= startIdx || indexMap.length === 0) return null;

  const clampedStart = Math.max(0, startIdx);
  const clampedEndCharIdx = Math.min(endIdx, indexMap.length) - 1;
  if (clampedEndCharIdx < clampedStart) return null;

  const from = indexMap[clampedStart];
  const to = indexMap[clampedEndCharIdx] + 1;
  if (from === undefined || to === undefined || to <= from) return null;

  const docSize = doc.content.size;
  const safeFrom = Math.min(Math.max(from, 0), docSize);
  const safeTo = Math.min(Math.max(to, 0), docSize);
  return safeTo > safeFrom ? { from: safeFrom, to: safeTo } : null;
}

// Collapses runs of whitespace to a single space, recording (for each
// character kept) its offset in the ORIGINAL string — so a match found in
// the normalized text can be mapped back. Boundary note: when several
// original whitespace characters collapse into one normalized space, the
// mapping points at the FIRST of them; a fallback match can therefore be
// off by a couple of whitespace characters at its edges. That's an
// accepted, documented imprecision for a highlight — never a wrong-text
// match, since only whitespace collapses, no alphanumeric characters do.
function buildWhitespaceNormalizedIndex(text) {
  let normalized = '';
  const origOffsets = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        normalized += ' ';
        origOffsets.push(i);
        lastWasSpace = true;
      }
    } else {
      normalized += ch;
      origOffsets.push(i);
      lastWasSpace = false;
    }
  }
  return { normalized, origOffsets };
}

// Stage A — exact substring match against the raw flattened text.
function matchExact(text, needle) {
  const idx = text.indexOf(needle);
  return idx === -1 ? null : { startIdx: idx, endIdx: idx + needle.length };
}

// Stage B — whitespace-insensitive match (handles extraction artifacts
// like doubled spaces or a stray line-break inside what the LLM treated as
// one continuous clause).
function matchWhitespaceNormalized(text, needle) {
  if (!needle) return null;
  const docNorm = buildWhitespaceNormalizedIndex(text);
  const needleNorm = buildWhitespaceNormalizedIndex(needle).normalized;
  if (!needleNorm) return null;

  const normIdx = docNorm.normalized.indexOf(needleNorm);
  if (normIdx === -1) return null;

  const startIdx = docNorm.origOffsets[normIdx];
  const lastNormIdx = normIdx + needleNorm.length - 1;
  const endCharIdx = docNorm.origOffsets[lastNormIdx];
  if (startIdx === undefined || endCharIdx === undefined) return null;

  return { startIdx, endIdx: endCharIdx + 1 };
}

// Finds `searchText` inside the live document and returns its ProseMirror
// { from, to } range, or null if it genuinely can't be located (a
// paraphrased/altered LLM clause, for instance) — callers must treat null
// as "skip this decoration", never guess a nearby range.
export function findClauseRange(doc, searchText) {
  const needle = (searchText || '').trim();
  if (!needle) return null;

  const { text, indexMap } = buildDocumentIndex(doc);

  // Stage A: exact match.
  let match = matchExact(text, needle);
  // Stage B: whitespace-normalized match.
  if (!match) match = matchWhitespaceNormalized(text, needle);

  // Stage C: the excerpt still carries a leading list marker ("1.", "-", …)
  // that Tiptap consumed into list-item structure rather than literal text
  // — strip it and retry both stages against the shorter needle.
  if (!match) {
    const strippedNeedle = needle.replace(LIST_PREFIX_RE, '').trim();
    if (strippedNeedle && strippedNeedle !== needle) {
      match = matchExact(text, strippedNeedle) || matchWhitespaceNormalized(text, strippedNeedle);
    }
  }

  if (!match) return null;
  return toPmRange(doc, indexMap, match.startIdx, match.endIdx);
}
