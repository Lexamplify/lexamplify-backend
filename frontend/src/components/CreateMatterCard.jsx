import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import MicButton from './MicButton.jsx';
import {
  IDLE_TIMEOUT_MS, SLOTS, normalizeAnswer, validateSlot,
  LABEL_ENDPOINT, CONFLICT_ENDPOINT, CREATE_ENDPOINT, CASES_LIST_ENDPOINT, CLIENTS_ENDPOINT,
  CONFLICT_TIMEOUT_MS, CREATE_TIMEOUT_MS, CHECK_TIMEOUT_MS, VERIFY_TEXT, matterDetailRoute,
  buildConflictBody, buildCreateBody, findDuplicateCase, classifyMattersListResult, matchClientNames,
} from '../assistant/createMatterFlow.js';

/*
 * The "create a matter" guided card (Phase 1b + 1c).
 *
 * All flow state lives in memory only — never localStorage/sessionStorage — and is cleared when the flow ends (cancel,
 * success, idle timeout, logout/unmount). Nothing a lawyer answers, and nothing the conflict check returns, is ever
 * sent to /api/assistant/command, a model, history, a log or the console. The only network calls the card makes are:
 * the fixed-label pings (confirm / cancelled), /api/conflict/check, the read-only clients and cases lists (for the
 * client-link note and the duplicate-safe retry), and the create call POST /api/practice/cases.
 *
 * A voice answer is inserted into the field only; it is accepted exactly like a typed one — by Enter (focus in the
 * field) or a button — never on arrival. "Proceed anyway" / "Proceed without check" and the final confirm are never
 * triggered by voice; the two Proceed actions are mouse/tap only (they ignore Enter and Space).
 */

const SUMMARY = SLOTS.length;

function initState(parsed) {
  const values = {
    title: parsed?.title || '',
    court: '', case_no: '', case_type: '',
    client: parsed?.client || '',
    opposite_party: parsed?.opposite_party || '',
  };
  return { step: 0, values, draft: values[SLOTS[0].key] || '', error: '' };
}

function reducer(state, action) {
  switch (action.type) {
    case 'draft':
      return { ...state, draft: action.value, error: '' };
    case 'answer': {
      const slot = SLOTS[state.step];
      const value = normalizeAnswer(slot.key, state.draft);
      const err = validateSlot(slot.key, value);
      if (err) return { ...state, error: err };
      const values = { ...state.values, [slot.key]: value };
      const step = state.step + 1;
      return { step, values, draft: step < SUMMARY ? (values[SLOTS[step].key] || '') : '', error: '' };
    }
    case 'choose': {
      const slot = SLOTS[state.step];
      const values = { ...state.values, [slot.key]: action.value };
      const step = state.step + 1;
      return { step, values, draft: step < SUMMARY ? (values[SLOTS[step].key] || '') : '', error: '' };
    }
    case 'skip': {
      const slot = SLOTS[state.step];
      if (slot.required) return state;
      const values = { ...state.values, [slot.key]: '' };
      const step = state.step + 1;
      return { step, values, draft: step < SUMMARY ? (values[SLOTS[step].key] || '') : '', error: '' };
    }
    case 'back': {
      if (state.step === 0) return state;
      const step = state.step - 1;
      return { ...state, step, draft: state.values[SLOTS[step].key] || '', error: '' };
    }
    case 'edit': {
      const step = SLOTS.findIndex((s) => s.key === action.key);
      if (step < 0) return state;
      return { ...state, step, draft: state.values[SLOTS[step].key] || '', error: '' };
    }
    default:
      return state;
  }
}

export default function CreateMatterCard({ phase, parsed, conversationId, onExit, onCreated }) {
  if (phase === 'pending') {
    return <div className="lx-cm-card" role="status" aria-live="polite"><p className="lx-cm-card__what">Setting up a new matter…</p></div>;
  }
  if (phase === 'disabled') {
    return (
      <div className="lx-cm-card" role="status">
        <p className="lx-cm-card__what">Creating a matter here is turned off right now.</p>
        <div className="lx-cm-row">
          <button type="button" className="lx-btn lx-btn--primary lx-btn--sm lx-cm-btn" onClick={() => onExit({ navigateTo: '/matters' })}>Open Matters</button>
        </div>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="lx-cm-card lx-cm-card--error" role="alert">
        <p className="lx-cm-card__what">I couldn’t start the new-matter form just now. Nothing was saved.</p>
        <div className="lx-cm-row"><button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => onExit({})}>Close</button></div>
      </div>
    );
  }
  return <ActiveFlow parsed={parsed} conversationId={conversationId} onExit={onExit} onCreated={onCreated} />;
}

// Block Enter/Space from activating a risky button: those actions are mouse/tap only.
function clickOnly(e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') e.preventDefault(); }

function ActiveFlow({ parsed, conversationId, onExit, onCreated }) {
  const [state, dispatch] = useReducer(reducer, parsed, initState);
  const onSlots = state.step < SUMMARY;

  const [conflict, setConflict] = useState({ state: 'idle', results: [], status: '', proceeded: false, skipped: false });
  const [clientNote, setClientNote] = useState({ state: 'idle', names: [] });
  const [create, setCreate] = useState({ state: 'idle', error: '', retryable: false });
  const [success, setSuccess] = useState(null);
  const [verify, setVerify] = useState('checking');       // honest-success: 'checking' → found | not_found | could_not_check

  const inputRef = useRef(null);
  const headingRef = useRef(null);
  const confirmHeadingRef = useRef(null);
  const successHeadingRef = useRef(null);
  const checkedSigRef = useRef(null);
  const conflictAbortRef = useRef(null);
  const createInFlightRef = useRef(false);
  const slot = onSlots ? SLOTS[state.step] : null;
  const sig = (v) => JSON.stringify([(v.title || '').trim(), (v.client || '').trim(), (v.opposite_party || '').trim()]);

  // Idle timeout (plan §8): discard a half-finished form after 90s with no interaction. A create already in flight is
  // never interrupted (createInFlightRef).
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; });
  useEffect(() => {
    const timer = setTimeout(() => { if (!createInFlightRef.current && !success) onExitRef.current?.({}); }, IDLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.step, state.draft, conflict.state, create.state, success]);

  // Cancel the conflict check if the lawyer leaves the page. The create call is deliberately NOT aborted on unmount.
  useEffect(() => () => conflictAbortRef.current?.abort(), []);

  // Focus: the current field during slots; the heading when the confirm or success card appears.
  useEffect(() => {
    if (success) successHeadingRef.current?.focus();
    else if (onSlots) inputRef.current?.focus();
    else confirmHeadingRef.current?.focus();
  }, [state.step, onSlots, success]);

  // Tell the parent, once, the moment the matter is created — so the composer is released (the turn is finished) even
  // though the success card is still on screen. Independent of which exit button the lawyer later presses.
  const onCreatedRef = useRef(onCreated);
  useEffect(() => { onCreatedRef.current = onCreated; });
  const createdFiredRef = useRef(false);
  useEffect(() => {
    if (success && !createdFiredRef.current) { createdFiredRef.current = true; onCreatedRef.current?.(); }
  }, [success]);

  // Honest-success re-read: exactly ONE GET of the same list the Matters page reads, ~10s timeout, no polling and never a
  // second GET. An uncertain create (the duplicate-safe path) skips the GET and says "could not check". Never says "failed".
  const verifyStartedRef = useRef(false);
  useEffect(() => {
    if (!success || verifyStartedRef.current) return undefined;
    verifyStartedRef.current = true;
    if (success.uncertain) { setVerify('could_not_check'); return undefined; }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
    (async () => {
      try {
        const res = await fetch(CASES_LIST_ENDPOINT, { method: 'GET', signal: ctrl.signal });
        clearTimeout(timer);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setVerify(res.ok ? classifyMattersListResult(data, state.values) : 'could_not_check');
      } catch {
        clearTimeout(timer);
        if (!cancelled) setVerify('could_not_check');
      }
    })();
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
  }, [success]);     // eslint-disable-line react-hooks/exhaustive-deps

  const runChecks = useCallback(async (vals) => {
    const name = (vals.client || '').trim();
    if (!name) { setConflict({ state: 'none', results: [], status: '', proceeded: false, skipped: false }); setClientNote({ state: 'none', names: [] }); return; }
    // Conflict check (15s, cancelled on unmount).
    setConflict({ state: 'checking', results: [], status: '', proceeded: false, skipped: false });
    const ctrl = new AbortController();
    conflictAbortRef.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), CONFLICT_TIMEOUT_MS);
    let conflictResults = [];
    try {
      const res = await fetch(CONFLICT_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildConflictBody(vals)), signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 && data.code === 'NO_FIRM') setConflict({ state: 'nofirm', results: [], status: '', proceeded: false, skipped: false });
        else setConflict({ state: 'failed', results: [], status: '', proceeded: false, skipped: false });
      } else {
        conflictResults = Array.isArray(data.results) ? data.results : [];
        const hit = data.status === 'High Conflict' || data.status === 'Potential';
        setConflict({ state: hit ? 'conflicts' : 'none', results: conflictResults, status: data.status || '', proceeded: false, skipped: false });
      }
    } catch {
      clearTimeout(timer);
      setConflict({ state: 'failed', results: [], status: '', proceeded: false, skipped: false });
    }
    // Client-link note: prefer names the conflict result already identified; otherwise read the clients list and match.
    const fromConflict = conflictResults.map((r) => r.client).filter(Boolean)
      .filter((c) => String(c).trim().toLowerCase() === name.toLowerCase());
    if (fromConflict.length) { setClientNote({ state: 'matches', names: Array.from(new Set(fromConflict)) }); return; }
    try {
      const res = await fetch(CLIENTS_ENDPOINT, { method: 'GET' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setClientNote({ state: 'unavailable', names: [] }); return; }
      const names = matchClientNames(data.clients || [], name);
      setClientNote({ state: names.length ? 'matches' : 'none', names });
    } catch { setClientNote({ state: 'unavailable', names: [] }); }
  }, []);

  // Run (or re-run) the checks whenever the confirm card is shown with a changed title/client/opposite party.
  useEffect(() => {
    if (onSlots || success) return;
    if (checkedSigRef.current === sig(state.values)) return;
    checkedSigRef.current = sig(state.values);
    setCreate({ state: 'idle', error: '', retryable: false });
    runChecks(state.values);
  }, [onSlots, success, state.values, runChecks]);

  const conflictResolved = conflict.state === 'none'
    || (conflict.state === 'conflicts' && conflict.proceeded)
    || (conflict.state === 'failed' && conflict.skipped);
  const canCreate = conflictResolved && create.state !== 'creating' && conflict.state !== 'nofirm';

  const label = useCallback((event) => {
    // Fire-and-forget fixed label (started/confirm/cancelled live in assistant_command_routes.py). Never names.
    try {
      fetch(LABEL_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow: 'create_matter', event, conversationId: conversationId ?? undefined }),
      }).catch(() => {});
    } catch { /* never block the flow on a label */ }
  }, [conversationId]);

  const cancel = useCallback(() => { label('cancelled'); onExit({}); }, [label, onExit]);

  const afterCreateFailure = useCallback(async (retryMsg) => {
    // Duplicate-safe retry: a network/timeout/5xx may have created the case anyway. Check the list before offering Retry.
    try {
      const res = await fetch(CASES_LIST_ENDPOINT, { method: 'GET' });
      const data = await res.json().catch(() => ({}));
      const dup = res.ok ? findDuplicateCase(data.cases || [], state.values) : null;
      // The create itself was uncertain (network/timeout/5xx), so honest-success must say "could not check", not "found".
      if (dup) { setSuccess({ id: dup.id ?? null, title: dup.title || state.values.title, caseNo: dup.case_no || state.values.case_no, existed: true, uncertain: true }); setCreate({ state: 'done', error: '', retryable: false }); return; }
    } catch { /* fall through to Retry */ }
    setCreate({ state: 'error', error: retryMsg, retryable: true });
  }, [state.values]);

  const attemptCreate = useCallback(async () => {
    setCreate({ state: 'creating', error: '', retryable: false });
    const ctrl = new AbortController();                                // timeout only — never aborted on unmount
    const timer = setTimeout(() => ctrl.abort(), CREATE_TIMEOUT_MS);
    let res; let data;
    try {
      res = await fetch(CREATE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildCreateBody(state.values)), signal: ctrl.signal });
      clearTimeout(timer);
      data = await res.json().catch(() => ({}));
    } catch {
      clearTimeout(timer);
      createInFlightRef.current = false;
      await afterCreateFailure('I could not reach the server. The matter may not have been created — you can try again.');
      return;
    }
    createInFlightRef.current = false;
    if (res.ok) {
      const c = data.case || {};
      setSuccess({ id: c.id ?? data.id ?? null, title: c.title || state.values.title, caseNo: c.case_no || state.values.case_no });
      setCreate({ state: 'done', error: '', retryable: false });
      return;
    }
    if (res.status >= 500) { await afterCreateFailure('The server had a problem creating the matter. You can try again.'); return; }
    setCreate({ state: 'error', error: friendlyCreateError(res.status, data.code || '', data), retryable: false });
  }, [state.values, afterCreateFailure]);

  const doCreate = useCallback(async () => {
    if (createInFlightRef.current || !canCreate) return;
    createInFlightRef.current = true;
    setCreate({ state: 'creating', error: '', retryable: false });
    // (a) confirm-label check: blocks a create if the flag was turned off mid-flow, or if the check fails.
    let enabled = false;
    try {
      const res = await fetch(LABEL_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flow: 'create_matter', event: 'confirm', conversationId: conversationId ?? undefined }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('flag');
      enabled = data.enabled === true;
    } catch {
      createInFlightRef.current = false;
      setCreate({ state: 'error', error: 'I could not reach the assistant to confirm. You can try again.', retryable: true });
      return;
    }
    if (!enabled) {
      createInFlightRef.current = false;
      setCreate({ state: 'error', error: 'Creating a matter here has been turned off. Nothing was created.', retryable: false });
      return;
    }
    await attemptCreate();
  }, [canCreate, conversationId, attemptCreate]);

  const onCardKeyDown = useCallback((e) => {
    // Enter confirms only when focus is on the card and create is allowed; never from a button (buttons handle their own).
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && canCreate) { e.preventDefault(); doCreate(); }
  }, [canCreate, doCreate]);

  // ── success ──────────────────────────────────────────────────────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="lx-cm-card" role="group" aria-label="Matter created">
        <h3 className="lx-cm-card__what" tabIndex={-1} ref={successHeadingRef}>Matter created</h3>
        <p className="lx-cm-card__note">{success.title}{success.caseNo ? ` · ${success.caseNo}` : ''}{success.existed ? ' (it already existed)' : ''}</p>
        <p className="lx-cm-card__note lx-cm-verify" role="status" aria-live="polite">{VERIFY_TEXT[verify] || VERIFY_TEXT.checking}</p>
        <div className="lx-cm-row">
          {/* E7: with an id, a primary "Open matter"; without one, no "Open matter" and a single "Open Matters". */}
          {success.id != null && (
            <button type="button" className="lx-btn lx-btn--primary lx-btn--sm lx-cm-btn"
              onClick={() => onExit({ navigateTo: matterDetailRoute(success.id), created: true })}>Open matter</button>
          )}
          <button type="button" className={`lx-btn lx-btn--sm lx-cm-btn ${success.id != null ? 'lx-btn--ghost' : 'lx-btn--primary'}`}
            onClick={() => onExit({ navigateTo: '/matters', created: true })}>Open Matters</button>
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => onExit({ navigateTo: '/draft', created: true })}>Start a draft</button>
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => onExit({ created: true })}>Done</button>
        </div>
      </div>
    );
  }

  // ── slots ────────────────────────────────────────────────────────────────────────────────────────────────────────
  if (onSlots) {
    const onKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'answer' }); } };
    return (
      <div className="lx-cm-card" role="group" aria-label="Create a matter">
        <p className="lx-cm-step" aria-hidden="true">{`Step ${state.step + 1} of ${SLOTS.length}`}</p>
        <label className="lx-cm-card__what" htmlFor="lx-cm-input" aria-live="polite" ref={headingRef}>{slot.prompt}</label>
        {slot.choices ? (
          <div className="lx-cm-row lx-cm-chips" role="group" aria-label={slot.label}>
            {slot.choices.map((c) => (
              <button type="button" key={c} className="lx-assistant-chip lx-cm-chip" onClick={() => dispatch({ type: 'choose', value: c })}>{c}</button>
            ))}
          </div>
        ) : (
          <div className="lx-cm-answer">
            <input id="lx-cm-input" ref={inputRef} className="lx-cm-input" type="text" value={state.draft}
              onChange={(e) => dispatch({ type: 'draft', value: e.target.value })} onKeyDown={onKeyDown}
              aria-label={slot.label} aria-describedby={state.error ? 'lx-cm-error' : undefined} autoComplete="off" />
            <MicButton getTarget={() => inputRef.current} spokenCommands={false} maxSeconds={60} afterInsert={(el) => dispatch({ type: 'draft', value: el.value })} />
          </div>
        )}
        {state.error && <p id="lx-cm-error" className="lx-cm-err" role="alert">{state.error}</p>}
        <div className="lx-cm-row">
          {!slot.choices && <button type="button" className="lx-btn lx-btn--primary lx-btn--sm lx-cm-btn" onClick={() => dispatch({ type: 'answer' })}>Next</button>}
          {!slot.required && <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => dispatch({ type: 'skip' })}>Skip</button>}
          {state.step > 0 && <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => dispatch({ type: 'back' })}>Back</button>}
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  // ── confirm ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const rows = SLOTS.filter((s) => (state.values[s.key] || '').trim());
  return (
    <div className="lx-cm-card" role="group" aria-label="Check the new matter" onKeyDown={onCardKeyDown}>
      <h3 className="lx-cm-card__what" tabIndex={-1} ref={confirmHeadingRef}>Check the details</h3>
      <dl className="lx-cm-summary">
        {rows.map((s) => (
          <div className="lx-cm-summary__row" key={s.key}>
            <dt>{s.label}</dt>
            <dd>
              <span>{state.values[s.key]}</span>
              <button type="button" className="lx-assistant-chip lx-cm-edit" onClick={() => dispatch({ type: 'edit', key: s.key })} aria-label={`Change the ${s.label.toLowerCase()}`}>Edit</button>
            </dd>
          </div>
        ))}
      </dl>

      {(state.values.client || '').trim() && (
        <div className="lx-cm-note" role="note">
          <p className="lx-cm-card__note">
            If an active client with this name already exists in your firm, this matter will be linked to it
            (matching ignores capital letters, and uses the name only). If not, a new client record will be created.
          </p>
          {clientNote.state === 'matches' && <p className="lx-cm-card__note">It may link to: {clientNote.names.join(', ')}.</p>}
          {clientNote.state === 'unavailable' && <p className="lx-cm-card__note">I could not check for existing clients.</p>}
        </div>
      )}

      <div className="lx-cm-conflict" aria-live="polite">
        {conflict.state === 'checking' && <p className="lx-cm-card__note">Checking for conflicts…</p>}
        {conflict.state === 'none' && (state.values.client || '').trim() && <p className="lx-cm-ok">No conflict found.</p>}
        {conflict.state === 'nofirm' && <p className="lx-cm-err" role="alert">Set up your practice (your firm, clients and cases) first — I can’t check for conflicts or create a matter yet.</p>}
        {conflict.state === 'conflicts' && (
          <div className="lx-cm-conflict__hit" role="alert">
            <p className="lx-cm-card__what">Possible conflict{conflict.status ? ` — ${conflict.status}` : ''}</p>
            <ul className="lx-cm-conflict__list">
              {conflict.results.map((r, i) => (
                <li key={i}>{[r.client, r.opponent, r.matched_doc, r.match_type].filter(Boolean).join(' · ') || 'Match in your records'}</li>
              ))}
            </ul>
            {!conflict.proceeded && (
              <div className="lx-cm-row">
                <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => setConflict((c) => ({ ...c, proceeded: true }))} onKeyDown={clickOnly}>Proceed anyway</button>
                <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => dispatch({ type: 'edit', key: 'client' })}>Edit details</button>
              </div>
            )}
          </div>
        )}
        {conflict.state === 'failed' && (
          <div role="alert">
            <p className="lx-cm-err">Could not check conflicts.</p>
            <div className="lx-cm-row">
              <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => { checkedSigRef.current = null; runChecks(state.values); }}>Retry</button>
              <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => setConflict((c) => ({ ...c, skipped: true }))} onKeyDown={clickOnly}>Proceed without check</button>
            </div>
          </div>
        )}
        {conflict.skipped && <p className="lx-cm-card__note">Proceeding without a conflict check.</p>}
      </div>

      {create.state === 'error' && (
        <div className="lx-cm-err" role="alert">
          <p>{create.error}</p>
          {create.retryable && <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={doCreate}>Retry</button>}
        </div>
      )}

      <p className="lx-cm-card__note">Next, I’ll create the matter with your login. Nothing is saved until you press Create matter.</p>
      <div className="lx-cm-row">
        <button type="button" className="lx-btn lx-btn--primary lx-btn--sm lx-cm-btn" onClick={doCreate} disabled={!canCreate}>
          {create.state === 'creating' ? 'Creating…' : 'Create matter'}
        </button>
        <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => dispatch({ type: 'edit', key: 'title' })}>Edit</button>
        <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}

function friendlyCreateError(status, code, data) {
  if (code === 'DUPLICATE_CASE' || status === 409) return 'A case with this number already exists in this court. Open it from Matters, or change the case number.';
  if (code === 'NO_FIRM') return 'Set up your practice first, then create the matter.';
  if (code === 'FORBIDDEN' || status === 403) return 'You can create this for yourself; a Senior can reassign it.';
  if (status === 401) return 'Your session expired. Please sign in again, then press Create matter once more.';
  if (status === 400) return (data && data.message) || 'Some details are missing or invalid (a case number is required). Please fix them with Edit and try again.';
  return (data && data.message) || 'Could not create the matter. Please try again.';
}
