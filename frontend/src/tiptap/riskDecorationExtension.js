// AI risk flagging via ProseMirror Decorations — deliberately NOT TipTap
// Marks. A Mark would live inside the document (serialize to HTML, survive
// undo/redo as real content, get duplicated by copy/paste); a risk flag is
// derived, ephemeral analysis output layered ON TOP of the document, so it
// belongs in the view layer as a Decoration instead.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findClauseRange } from './positionMapping.js';

export const riskDecorationPluginKey = new PluginKey('riskDecoration');

function riskClassFor(clause) {
  // A clause with a pending Track Changes suggestion already has its own
  // green/red ins/del styling live in the document — stacking the risk
  // decoration on top of that would double-highlight the same span.
  if (clause.isPendingSuggestion) return null;
  // Reuses the app's existing .risk-mark red-mark/amber-mark visual
  // language (same classes the old <mark>-based renderer used) rather than
  // introducing a near-duplicate set of highlight styles.
  if (clause.risk === 'RED') return 'risk-mark red-mark';
  if (clause.risk === 'AMBER') return 'risk-mark amber-mark';
  return null; // GREEN / resolved clauses are not flagged in the document
}

// scanStrategy isn't consulted inside this function today — the backend
// already returns a mode-specific clause set, so filtering by mode already
// happened upstream. It's still threaded through and stored in plugin
// state (see apply() below) as the cache key that forces a recompute on a
// mode switch even if a caller ever reuses the same `clauses` array
// reference across modes.
// eslint-disable-next-line no-unused-vars
function computeDecorations(doc, clauses, scanStrategy) {
  const decos = [];
  for (const clause of clauses || []) {
    const riskClass = riskClassFor(clause);
    if (!riskClass || !clause.text) continue;
    const range = findClauseRange(doc, clause.text);
    if (!range) continue; // can't locate it in the live doc — skip, never guess
    decos.push(
      Decoration.inline(range.from, range.to, {
        class: riskClass,
        'data-risk-id': String(clause.id),
        title: clause.issue || '',
      })
    );
  }
  return DecorationSet.create(doc, decos);
}

// Builds the actual ProseMirror Plugin. Exported standalone (independent
// of the TipTap Extension wrapper below) so it can be unit-tested against
// a plain prosemirror-state EditorState — no DOM/EditorView required.
export function createRiskDecorationPlugin(options) {
  return new Plugin({
    key: riskDecorationPluginKey,

    state: {
      init(_, { doc }) {
        return {
          decorations: computeDecorations(doc, options.clauses, options.scanStrategy),
          clauses: options.clauses,
          scanStrategy: options.scanStrategy,
        };
      },
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(riskDecorationPluginKey);
        if (meta) {
          // External state (React) told us clauses/scanStrategy changed —
          // recompute against the CURRENT doc. This transaction carries no
          // doc-changing steps, so the selection is left untouched by
          // ProseMirror (mapping through zero steps is a no-op) — the
          // decoration refresh is instant and never perturbs the cursor.
          return {
            decorations: computeDecorations(newState.doc, meta.clauses, meta.scanStrategy),
            clauses: meta.clauses,
            scanStrategy: meta.scanStrategy,
          };
        }
        if (tr.docChanged) {
          // The user typed/edited — re-locate every risk span against the
          // new doc using the SAME clause set (positions shift, the
          // underlying risk data doesn't).
          return {
            decorations: computeDecorations(newState.doc, prev.clauses, prev.scanStrategy),
            clauses: prev.clauses,
            scanStrategy: prev.scanStrategy,
          };
        }
        return prev;
      },
    },

    props: {
      decorations(state) {
        return this.getState(state)?.decorations;
      },
      handleClick(_view, _pos, event) {
        const targetEl = event.target.nodeType === 1 ? event.target : event.target.parentElement;
        const hit = targetEl && targetEl.closest('[data-risk-id]');
        if (hit) {
          options.onRiskClick(hit.getAttribute('data-risk-id'));
          return true;
        }
        return false;
      },
    },
  });
}

export const RiskDecoration = Extension.create({
  name: 'riskDecoration',

  addOptions() {
    return {
      clauses: [],
      scanStrategy: 'Defensive',
      onRiskClick: () => {},
    };
  },

  addProseMirrorPlugins() {
    return [createRiskDecorationPlugin(this.options)];
  },
});

// Pushes a fresh {clauses, scanStrategy} into the live plugin without
// touching document content — the mechanism behind "clear and re-render
// instantly, no document reload" and "cursor position stays stable".
export function updateRiskDecorations(editor, clauses, scanStrategy) {
  if (!editor || editor.isDestroyed) return;
  const tr = editor.state.tr.setMeta(riskDecorationPluginKey, { clauses, scanStrategy });
  editor.view.dispatch(tr);
}
