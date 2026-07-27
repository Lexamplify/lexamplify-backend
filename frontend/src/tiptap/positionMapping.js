// Maps a raw clause substring (as returned by the risk-analysis LLM) to
// exact ProseMirror document positions, so risk Decorations can be placed
// on the live doc instead of on stale string offsets computed against the
// ORIGINAL raw text. Offsets computed against raw text go stale the moment
// the user edits the document (or the LLM's extraction shifted a char or
// two) — searching the live doc's own flattened text sidesteps that
// entirely, at the cost of needing this file to convert a found substring
// range back into real ProseMirror positions (which "flat text index N"
// is NOT the same number as, once you cross a paragraph boundary or an
// atom node — hence the block/leaf placeholder accounting below).

const BLOCK_SEPARATOR = '\n';
// Reserves exactly one flattened-text character per atom/leaf inline node
// (e.g. an inlineCitation badge) so text positions AFTER it don't drift.
const LEAF_PLACEHOLDER = '￼';

// Walks only the doc's direct block children (this schema is intentionally
// flat — paragraphs at the top level, no nested blockquotes/lists in the
// scanner body) and their inline content, building:
//   - `text`: the doc flattened to a single string, blocks joined by "\n"
//   - `runs`: contiguous [flatStart, flatEnd) -> ProseMirror position spans
// in one pass, so `text` and `runs` can never drift out of sync with each
// other the way two independently-written traversals could.
export function buildFlattenedIndex(doc) {
  let text = '';
  const runs = [];

  doc.forEach((blockNode, blockOffset) => {
    if (text.length > 0) text += BLOCK_SEPARATOR;
    let inlinePos = blockOffset + 1; // +1 past the block node's own open token
    blockNode.forEach((inlineNode) => {
      if (inlineNode.isText) {
        runs.push({ flatStart: text.length, flatEnd: text.length + inlineNode.text.length, pmStart: inlinePos });
        text += inlineNode.text;
      } else {
        runs.push({ flatStart: text.length, flatEnd: text.length + LEAF_PLACEHOLDER.length, pmStart: inlinePos });
        text += LEAF_PLACEHOLDER;
      }
      inlinePos += inlineNode.nodeSize;
    });
  });

  return { text, runs };
}

// Converts a [flatStart, flatEnd) range in the flattened string back into
// real ProseMirror { from, to } positions using the run table above.
export function flatRangeToPmRange(runs, flatStart, flatEnd) {
  if (flatEnd <= flatStart || runs.length === 0) return null;

  let from = null;
  let to = null;

  for (const run of runs) {
    if (from === null && flatStart >= run.flatStart && flatStart < run.flatEnd) {
      from = run.pmStart + (flatStart - run.flatStart);
    }
    if (flatEnd > run.flatStart && flatEnd <= run.flatEnd) {
      to = run.pmStart + (flatEnd - run.flatStart);
    }
  }

  // flatStart/flatEnd landed exactly on a block separator (not inside any
  // run) — clamp to the nearest valid boundary instead of failing outright.
  if (from === null) {
    const next = runs.find((r) => r.flatStart >= flatStart);
    if (next) from = next.pmStart;
  }
  if (to === null) {
    const prev = [...runs].reverse().find((r) => r.flatEnd <= flatEnd);
    if (prev) to = prev.pmStart + (prev.flatEnd - prev.flatStart);
  }

  return from !== null && to !== null && to > from ? { from, to } : null;
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

// Finds `searchText` inside the live document and returns its ProseMirror
// { from, to } range, or null if it genuinely can't be located (a
// paraphrased/altered LLM clause, for instance) — callers must treat null
// as "skip this decoration", never guess a nearby range.
export function findClauseRange(doc, searchText) {
  const needle = (searchText || '').trim();
  if (!needle) return null;

  const { text, runs } = buildFlattenedIndex(doc);

  const exactIdx = text.indexOf(needle);
  if (exactIdx !== -1) {
    return flatRangeToPmRange(runs, exactIdx, exactIdx + needle.length);
  }

  // Fallback: whitespace-insensitive search (handles extraction artifacts
  // like doubled spaces or a stray line-break inside what the LLM treated
  // as one continuous clause).
  const docNorm = buildWhitespaceNormalizedIndex(text);
  const needleNorm = buildWhitespaceNormalizedIndex(needle).normalized;
  const normIdx = docNorm.normalized.indexOf(needleNorm);
  if (normIdx === -1 || needleNorm.length === 0) return null;

  const flatStart = docNorm.origOffsets[normIdx];
  const lastNormIdx = normIdx + needleNorm.length - 1;
  const flatEndCharIdx = docNorm.origOffsets[lastNormIdx];
  if (flatStart === undefined || flatEndCharIdx === undefined) return null;

  return flatRangeToPmRange(runs, flatStart, flatEndCharIdx + 1);
}
