// Visual "diff" marker for freshly AI-generated text (Auto-Draft Synthesis
// Studio output and in-editor AI Bubble Menu rewrites) — deliberately
// separate from AiInsertion/AiDeletion in trackChangesMarks.js, which model
// an explicit accept/reject PAIR (old text struck through + new text
// inserted alongside it). This mark has no "old text" counterpart: the AI
// output IS the only text: the user's action is a single acknowledgement
// (Accept), not a choice between two versions.
import { Mark, Extension } from '@tiptap/core';

export const AiGenerated = Mark.create({
  name: 'aiGenerated',
  parseHTML() {
    return [{ tag: 'span.ai-generated-text' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'ai-generated-text' }, 0];
  },
});

// Mirrors findMarkRanges in trackChangesMarks.js — collapses consecutive
// text nodes carrying the mark into merged [start, end) ranges. A paragraph
// break between two marked nodes always breaks a range (block boundaries
// occupy a doc position of their own), so a multi-paragraph AI draft is
// accepted one paragraph at a time — matching how a person reviews tracked
// changes span-by-span rather than expecting one click to resolve an
// entire multi-paragraph document.
function findAiGeneratedRanges(doc, markType) {
  const ranges = [];
  let current = null;
  doc.descendants((node, pos) => {
    const hasMark = node.isText && node.marks.some((m) => m.type === markType);
    if (hasMark) {
      if (current && current.end === pos) current.end = pos + node.nodeSize;
      else { current = { start: pos, end: pos + node.nodeSize }; ranges.push(current); }
    } else {
      current = null;
    }
  });
  return ranges;
}

export const AiGeneratedCommands = Extension.create({
  name: 'aiGeneratedCommands',
  addCommands() {
    return {
      // Removes the aiGenerated mark from whichever contiguous marked span
      // contains the current selection's anchor — "accept" just means the
      // AI text becomes ordinary, unmarked content going forward.
      acceptAiGenerated:
        () =>
        ({ state, tr, dispatch }) => {
          const { aiGenerated } = state.schema.marks;
          if (!aiGenerated) return false;
          const pos = state.selection.from;
          const range = findAiGeneratedRanges(state.doc, aiGenerated).find(
            (r) => pos >= r.start && pos <= r.end
          );
          if (!range) return false;
          if (dispatch) {
            tr.removeMark(range.start, range.end, aiGenerated);
            dispatch(tr);
          }
          return true;
        },
    };
  },
});
