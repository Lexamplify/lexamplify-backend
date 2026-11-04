import { useCallback, useEffect, useReducer, useRef } from 'react';
import MicButton from './MicButton.jsx';
import { IDLE_TIMEOUT_MS, SLOTS, normalizeAnswer, validateSlot } from '../assistant/createMatterFlow.js';

/*
 * The "create a matter" guided card (Phase 1a).
 *
 * Everything here lives in memory only — never localStorage or sessionStorage. The card asks the fields one at a time,
 * then shows a SUMMARY. In this commit it makes NO network call of its own: no conflict check, no create. The summary
 * is the end of the flow, with the line "Creating the matter is the next step." and a Cancel button.
 *
 * A voice answer is inserted into the field only; it is accepted exactly like a typed one — by Enter (focus in the
 * field) or the Next button — never on arrival. Empty/doubtful transcripts never reach the field (useDictation.js:121).
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
    case 'choose': {                                   // a chip click: choose + advance (an explicit button press)
      const slot = SLOTS[state.step];
      const values = { ...state.values, [slot.key]: action.value };
      const step = state.step + 1;
      return { step, values, draft: step < SUMMARY ? (values[SLOTS[step].key] || '') : '', error: '' };
    }
    case 'skip': {
      const slot = SLOTS[state.step];
      if (slot.required) return state;                 // only optional fields can be skipped
      const values = { ...state.values, [slot.key]: '' };
      const step = state.step + 1;
      return { step, values, draft: step < SUMMARY ? (values[SLOTS[step].key] || '') : '', error: '' };
    }
    case 'back': {
      if (state.step === 0) return state;
      const step = state.step - 1;
      return { ...state, step, draft: state.values[SLOTS[step].key] || '', error: '' };
    }
    case 'edit': {                                     // from the summary, jump back to one slot
      const step = SLOTS.findIndex((s) => s.key === action.key);
      if (step < 0) return state;
      return { ...state, step, draft: state.values[SLOTS[step].key] || '', error: '' };
    }
    default:
      return state;
  }
}

export default function CreateMatterCard({ phase, parsed, onCancel, onOpenMatters }) {
  // The pending / disabled / error phases are tiny, fixed cards.
  if (phase === 'pending') {
    return (
      <div className="lx-cm-card" role="status" aria-live="polite">
        <p className="lx-cm-card__what">Setting up a new matter…</p>
      </div>
    );
  }
  if (phase === 'disabled') {
    return (
      <div className="lx-cm-card" role="status">
        <p className="lx-cm-card__what">Creating a matter here is turned off right now.</p>
        <div className="lx-cm-row">
          <button type="button" className="lx-btn lx-btn--primary lx-btn--sm lx-cm-btn" onClick={onOpenMatters}>
            Open Matters
          </button>
        </div>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="lx-cm-card lx-cm-card--error" role="alert">
        <p className="lx-cm-card__what">I couldn’t start the new-matter form just now. Nothing was saved.</p>
        <div className="lx-cm-row">
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={onCancel}>Close</button>
        </div>
      </div>
    );
  }
  return <ActiveFlow parsed={parsed} onCancel={onCancel} />;
}

function ActiveFlow({ parsed, onCancel }) {
  const [state, dispatch] = useReducer(reducer, parsed, initState);
  const inputRef = useRef(null);
  const headingRef = useRef(null);
  const onSlot = state.step < SUMMARY;
  const slot = onSlot ? SLOTS[state.step] : null;

  // Idle timeout (plan §8): a half-filled form is discarded after 90s with no interaction.
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onCancelRef.current = onCancel; });
  useEffect(() => {
    const timer = setTimeout(() => onCancelRef.current?.(), IDLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.step, state.draft]);

  // Move focus to the current question's field (or the summary heading) so a keyboard / screen-reader user lands there.
  useEffect(() => {
    if (onSlot) inputRef.current?.focus();
    else headingRef.current?.focus();
  }, [state.step, onSlot]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'answer' }); }
  }, []);

  if (!onSlot) {
    const rows = SLOTS.filter((s) => (state.values[s.key] || '').trim());
    return (
      <div className="lx-cm-card" role="group" aria-label="New matter summary">
        <h3 className="lx-cm-card__what" tabIndex={-1} ref={headingRef}>Here’s the new matter</h3>
        <dl className="lx-cm-summary">
          {rows.map((s) => (
            <div className="lx-cm-summary__row" key={s.key}>
              <dt>{s.label}</dt>
              <dd>
                <span>{state.values[s.key]}</span>
                <button type="button" className="lx-assistant-chip lx-cm-edit" onClick={() => dispatch({ type: 'edit', key: s.key })}
                  aria-label={`Change the ${s.label.toLowerCase()}`}>Edit</button>
              </dd>
            </div>
          ))}
        </dl>
        <p className="lx-cm-card__note">Creating the matter is the next step.</p>
        <div className="lx-cm-row">
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  const progress = `Step ${state.step + 1} of ${SLOTS.length}`;
  return (
    <div className="lx-cm-card" role="group" aria-label="Create a matter">
      <p className="lx-cm-step" aria-hidden="true">{progress}</p>
      <label className="lx-cm-card__what" htmlFor="lx-cm-input" aria-live="polite">{slot.prompt}</label>

      {slot.choices ? (
        <div className="lx-cm-row lx-cm-chips" role="group" aria-label={slot.label}>
          {slot.choices.map((c) => (
            <button type="button" key={c} className="lx-assistant-chip lx-cm-chip"
              onClick={() => dispatch({ type: 'choose', value: c })}>{c}</button>
          ))}
        </div>
      ) : (
        <div className="lx-cm-answer">
          <input
            id="lx-cm-input"
            ref={inputRef}
            className="lx-cm-input"
            type="text"
            value={state.draft}
            onChange={(e) => dispatch({ type: 'draft', value: e.target.value })}
            onKeyDown={onKeyDown}
            aria-label={slot.label}
            aria-describedby={state.error ? 'lx-cm-error' : undefined}
            autoComplete="off"
          />
          <MicButton
            getTarget={() => inputRef.current}
            spokenCommands={false}
            maxSeconds={60}
            afterInsert={(el) => dispatch({ type: 'draft', value: el.value })}
          />
        </div>
      )}

      {state.error && <p id="lx-cm-error" className="lx-cm-err" role="alert">{state.error}</p>}

      <div className="lx-cm-row">
        {!slot.choices && (
          <button type="button" className="lx-btn lx-btn--primary lx-btn--sm lx-cm-btn" onClick={() => dispatch({ type: 'answer' })}>
            Next
          </button>
        )}
        {!slot.required && (
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => dispatch({ type: 'skip' })}>
            Skip
          </button>
        )}
        {state.step > 0 && (
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={() => dispatch({ type: 'back' })}>
            Back
          </button>
        )}
        <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm lx-cm-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
