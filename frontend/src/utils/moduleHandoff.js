/**
 * frontend/src/utils/moduleHandoff.js
 *
 * One small contract for "send this document to another LexAmplify module".
 *
 * The dashboard is a junction: an advocate looking at a document in the
 * Case Vault / Document Hub / Practice list should be able to push that exact
 * document into the Contract Analyzer, Auto-Draft Studio or Conflict Engine
 * without re-finding and re-uploading it there. None of those three screens
 * accepted an inbound document before this — they each only read their own
 * file picker — so rather than inventing three different mechanisms, every
 * handoff travels the same way:
 *
 *     navigate(target, { state: { lexHandoff: payload } })
 *
 * and the receiving screen calls useModuleHandoff(fn).
 *
 * Why router state rather than a query string: the payload carries the
 * document's extracted TEXT, which is far too large for a URL and has no
 * business sitting in browser history, logs or the address bar.
 *
 * The hook deliberately consumes the handoff exactly once and then scrubs it
 * out of history (replace, state: null). Without that scrub, pressing reload
 * — or navigating away and coming back — would silently re-inject a document
 * the advocate had already dismissed or replaced, which reads as the app
 * undoing their work.
 */
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export const HANDOFF_KEY = 'lexHandoff';

/** Where each tool lives, so callers never hand-type a route. */
export const HANDOFF_TARGETS = {
  analyzer: '/contract-analyzer',
  draft: '/auto-draft',
  conflict: '/conflict-engine',
};

/**
 * Build a handoff payload.
 *
 * `text` is the extracted plain text of the document — every one of the three
 * receiving tools can work from text alone, which keeps this independent of
 * where the document physically lives (Case Vault blob, Document Hub store,
 * or a practice attachment).
 */
export function buildHandoff({ id, name, text, source, sourceLabel, docType }) {
  return {
    id: id != null ? String(id) : '',
    name: name || 'Untitled document',
    text: typeof text === 'string' ? text : '',
    source: source || 'vault',
    sourceLabel: sourceLabel || 'Case Vault',
    docType: docType || '',
    // Nonce makes two consecutive handoffs of the SAME document distinguishable.
    // Without it, sending doc #7 to the analyzer, going back, and sending doc #7
    // again would look identical to the receiver's "already handled this" guard
    // and the second send would be silently ignored.
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

/**
 * Receive a handoff, once.
 *
 * `onReceive(payload)` runs on mount (or whenever a fresh handoff arrives at
 * an already-mounted screen) and never twice for the same nonce.
 */
export function useModuleHandoff(onReceive) {
  const location = useLocation();
  const navigate = useNavigate();
  const consumedNonce = useRef(null);
  // Hold the latest callback in a ref so a caller passing an inline arrow
  // function (the normal case) doesn't re-run this effect on every render and
  // re-apply the handoff.
  const handler = useRef(onReceive);
  handler.current = onReceive;

  useEffect(() => {
    const payload = location.state && location.state[HANDOFF_KEY];
    if (!payload || !payload.nonce) return;
    if (consumedNonce.current === payload.nonce) return;
    consumedNonce.current = payload.nonce;

    try {
      handler.current?.(payload);
    } finally {
      // Scrub it from history so a reload doesn't replay it. Keep any other
      // router state the screen may rely on (AutoDraftWorkspace reads
      // state.disputeId, for instance) — only the handoff key is removed.
      const rest = { ...(location.state || {}) };
      delete rest[HANDOFF_KEY];
      navigate(location.pathname + location.search, {
        replace: true,
        state: Object.keys(rest).length ? rest : null,
      });
    }
  }, [location.state, location.pathname, location.search, navigate]);
}
