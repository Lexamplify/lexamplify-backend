// Track Changes via two custom Marks (real document content, unlike the
// risk decorations above) — an accepted insertion becomes permanent text,
// a rejected one must vanish entirely, so these need to be actual marked
// content the user can select/copy, not a view-layer overlay.
import { Mark, Extension } from '@tiptap/core';

const SUGGESTION_ATTR = {
  suggestionId: {
    default: null,
    parseHTML: (el) => el.getAttribute('data-suggestion-id'),
    renderHTML: (attrs) => (attrs.suggestionId ? { 'data-suggestion-id': attrs.suggestionId } : {}),
  },
};

// priority: 100 — StarterKit bundles a Strike mark whose own parseHTML
// generically claims <del> (and <s>/<strike>) for plain strikethrough
// formatting, with ProseMirror's default rule priority (50). Without an
// explicit higher priority here, a real <del class="ai-deletion"> element
// matches BOTH rules (ProseMirror rule matching is a DOM .matches() check,
// not CSS-specificity-ordered) and Strike's rule was winning, silently
// turning every ai-deletion back into plain strike on HTML round-trip.
// Caught by an actual parse round-trip test, not assumed.
export const AiInsertion = Mark.create({
  name: 'aiInsertion',
  addAttributes() {
    return SUGGESTION_ATTR;
  },
  parseHTML() {
    return [{ tag: 'ins.ai-insertion', priority: 100 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['ins', { ...HTMLAttributes, class: 'ai-insertion' }, 0];
  },
});

export const AiDeletion = Mark.create({
  name: 'aiDeletion',
  addAttributes() {
    return SUGGESTION_ATTR;
  },
  parseHTML() {
    return [{ tag: 'del.ai-deletion', priority: 100 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['del', { ...HTMLAttributes, class: 'ai-deletion' }, 0];
  },
});

// Collapses consecutive text nodes carrying `markType` (matching
// suggestionId when one is given) into merged [start, end) ranges — a
// suggestion's marked span is usually one run, but nothing prevents it
// from crossing an inline boundary (e.g. a citation atom in the middle).
function findMarkRanges(doc, markType, suggestionId) {
  if (!markType) return [];
  const ranges = [];
  let current = null;
  doc.descendants((node, pos) => {
    const mark = node.marks.find(
      (m) => m.type === markType && (suggestionId == null || m.attrs.suggestionId === suggestionId)
    );
    if (mark) {
      if (current && current.end === pos) {
        current.end = pos + node.nodeSize;
      } else {
        current = { start: pos, end: pos + node.nodeSize };
        ranges.push(current);
      }
    } else {
      current = null;
    }
  });
  return ranges;
}

// Editor commands: insertSuggestion() creates a pending edit (both old and
// new text visible, like Word's tracked changes); acceptSuggestion() /
// rejectSuggestion() resolve one by its suggestionId.
export const TrackChangesCommands = Extension.create({
  name: 'trackChangesCommands',

  addCommands() {
    return {
      // Marks [from, to) as a pending deletion and inserts `newText`
      // immediately after it as a pending insertion, both tagged with the
      // same suggestionId so accept/reject can resolve them as one unit.
      insertSuggestion:
        (from, to, newText, suggestionId) =>
        ({ tr, state, dispatch }) => {
          const { aiInsertion, aiDeletion } = state.schema.marks;
          if (!aiInsertion || !aiDeletion) return false;
          if (dispatch) {
            tr.addMark(from, to, aiDeletion.create({ suggestionId }));
            const insertionMark = aiInsertion.create({ suggestionId });
            tr.insert(to, state.schema.text(newText, [insertionMark]));
            dispatch(tr);
          }
          return true;
        },

      acceptSuggestion:
        (suggestionId) =>
        ({ tr, state, dispatch }) => {
          const { aiInsertion, aiDeletion } = state.schema.marks;
          const delRanges = findMarkRanges(state.doc, aiDeletion, suggestionId);
          const insRanges = findMarkRanges(state.doc, aiInsertion, suggestionId);
          if (delRanges.length === 0 && insRanges.length === 0) return false;
          if (dispatch) {
            // Remove the struck-through original text entirely...
            delRanges.forEach((r) => tr.delete(tr.mapping.map(r.start), tr.mapping.map(r.end)));
            // ...and make the suggested text permanent, ordinary content.
            insRanges.forEach((r) => tr.removeMark(tr.mapping.map(r.start), tr.mapping.map(r.end), aiInsertion));
            dispatch(tr);
          }
          return true;
        },

      rejectSuggestion:
        (suggestionId) =>
        ({ tr, state, dispatch }) => {
          const { aiInsertion, aiDeletion } = state.schema.marks;
          const delRanges = findMarkRanges(state.doc, aiDeletion, suggestionId);
          const insRanges = findMarkRanges(state.doc, aiInsertion, suggestionId);
          if (delRanges.length === 0 && insRanges.length === 0) return false;
          if (dispatch) {
            // Discard the suggested new text entirely...
            insRanges.forEach((r) => tr.delete(tr.mapping.map(r.start), tr.mapping.map(r.end)));
            // ...and restore the original text to plain, unmarked content.
            delRanges.forEach((r) => tr.removeMark(tr.mapping.map(r.start), tr.mapping.map(r.end), aiDeletion));
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
