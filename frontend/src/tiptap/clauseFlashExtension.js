import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Purely a decoration — never touches document content. Clicking a risk
// card needs a "look here" flash distinct from the RiskDecoration
// extension's own persistent red/amber tint (which is already there and
// isn't going anywhere), so this layers a second, temporary decoration on
// top rather than mutating the doc the way inserting/removing a literal
// <mark> element would — that would have to interleave correctly with the
// aiInsertion/aiDeletion track-changes marks from trackChangesMarks.js and
// with getLogicalText's plain-text sync, for a purely cosmetic flash. A
// decoration sidesteps all of that.
const clauseFlashPluginKey = new PluginKey('clauseFlash');

export const ClauseFlash = Extension.create({
  name: 'clauseFlash',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: clauseFlashPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(clauseFlashPluginKey);
            if (meta?.clear) return DecorationSet.empty;
            if (meta?.range) {
              const cls = meta.fading ? 'clause-flash-highlight fading' : 'clause-flash-highlight';
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.range.from, meta.range.to, { class: cls }),
              ]);
            }
            // No relevant meta on this transaction — remap existing
            // decorations across whatever the transaction changed, same as
            // any other decoration set, so a flash mid-fade survives an
            // unrelated edit instead of pointing at stale positions.
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

// Two-stage removal so the fade is a real CSS transition (a class add then
// remove has no "before" state to transition from) — add the highlight,
// wait briefly, switch to the "fading" class (background -> transparent
// with a transition), then clear the decoration entirely once that
// transition has had time to finish.
export function flashClauseRange(editor, from, to) {
  if (!editor || editor.isDestroyed) return;
  const dispatch = (meta) => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(clauseFlashPluginKey, meta));
  };
  dispatch({ range: { from, to }, fading: false });
  setTimeout(() => dispatch({ range: { from, to }, fading: true }), 400);
  setTimeout(() => dispatch({ clear: true }), 400 + 1600);
}
