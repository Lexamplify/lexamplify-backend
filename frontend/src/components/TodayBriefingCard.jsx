import { useEffect, useRef, useState } from 'react';
import {
  loadCases, loadDraftCount, BRIEFING_TIMEOUT_MS,
} from '../assistant/todayBriefing.js';

/*
 * The Today briefing card (Phase 2). Read-only.
 *
 * Two independent sections, each with its own fetch, timeout and AbortController:
 *   - "cases"  → Hearings today, Hearings this week, Open matters (one GET /api/practice/cases)
 *   - "drafts" → Drafts in progress (one GET /api/drafts/sessions)
 * If one section fails it shows "Couldn't load" — never 0 — while the other still shows its number. A real zero shows the
 * empty text ("No hearings today"). Nothing here is ever sent to a model: the numbers are read in the browser and only
 * rendered. Leaving the page (unmount) aborts both requests.
 *
 * onSettled() is called once, when BOTH sections have reached a terminal state, so the parent can release its
 * "a briefing is loading" guard (a second trigger is ignored until then).
 */

const LABELS = {
  // Same wording pages/Today.jsx uses (H1: do not call them "unfinished").
  hearingsToday: 'Hearings today',
  hearingsThisWeek: 'Hearings this week',
  openMatters: 'Open matters',
  drafts: 'Drafts in progress',
};

export default function TodayBriefingCard({ onNavigate, onSettled }) {
  const [cases, setCases] = useState({ state: 'loading', data: null });     // { openMatters, hearingsToday, hearingsThisWeek }
  const [drafts, setDrafts] = useState({ state: 'loading', count: null });

  const settledRef = useRef({ cases: false, drafts: false, done: false });
  const onSettledRef = useRef(onSettled);
  useEffect(() => { onSettledRef.current = onSettled; });

  const markSettled = (key) => {
    settledRef.current[key] = true;
    if (!settledRef.current.done && settledRef.current.cases && settledRef.current.drafts) {
      settledRef.current.done = true;
      onSettledRef.current?.();
    }
  };

  useEffect(() => {
    let alive = true;
    const casesCtrl = new AbortController();
    const draftsCtrl = new AbortController();
    const casesTimer = setTimeout(() => casesCtrl.abort(), BRIEFING_TIMEOUT_MS);
    const draftsTimer = setTimeout(() => draftsCtrl.abort(), BRIEFING_TIMEOUT_MS);

    (async () => {
      try {
        const summary = await loadCases(casesCtrl.signal);
        clearTimeout(casesTimer);
        if (!alive) return;
        setCases({ state: 'ok', data: summary });
      } catch {
        clearTimeout(casesTimer);
        if (!alive) return;
        setCases({ state: 'error', data: null });
      } finally {
        if (alive) markSettled('cases');
      }
    })();

    (async () => {
      try {
        const count = await loadDraftCount(draftsCtrl.signal);
        clearTimeout(draftsTimer);
        if (!alive) return;
        setDrafts({ state: 'ok', count });
      } catch {
        clearTimeout(draftsTimer);
        if (!alive) return;
        setDrafts({ state: 'error', count: null });
      } finally {
        if (alive) markSettled('drafts');
      }
    })();

    return () => {
      alive = false;
      clearTimeout(casesTimer);
      clearTimeout(draftsTimer);
      casesCtrl.abort();
      draftsCtrl.abort();
    };
  }, []);

  const loading = cases.state === 'loading' || drafts.state === 'loading';
  const announce = loading ? 'Putting your day together…' : 'Here is your day.';

  return (
    <div className="lx-tb" role="group" aria-label="Your day">
      <p className="lx-tb__head">Your day</p>
      <span className="lx-tb__sr" role="status" aria-live="polite">{announce}</span>

      <div className="lx-tb__grid">
        <Tile
          label={LABELS.hearingsToday}
          section={cases}
          value={cases.data?.hearingsToday}
          empty="No hearings today"
          onOpen={() => onNavigate('/matters')}
        />
        <Tile
          label={LABELS.hearingsThisWeek}
          section={cases}
          value={cases.data?.hearingsThisWeek}
          empty="Nothing this week"
          onOpen={() => onNavigate('/matters')}
        />
        <Tile
          label={LABELS.openMatters}
          section={cases}
          value={cases.data?.openMatters}
          empty="No open matters"
          onOpen={() => onNavigate('/matters')}
        />
        <Tile
          label={LABELS.drafts}
          section={drafts}
          value={drafts.count}
          empty="No drafts in progress"
          onOpen={() => onNavigate('/draft')}
        />
      </div>

      <div className="lx-tb__foot">
        <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => onNavigate('/start')}>
          Open Start page
        </button>
      </div>
    </div>
  );
}

// One number. "loading" → a dash; "error" → "Couldn't load" (never 0); a real 0 → the empty text; otherwise the number.
function Tile({ label, section, value, empty, onOpen }) {
  const isError = section.state === 'error';
  const isLoading = section.state === 'loading';
  const num = isLoading ? '—' : isError ? '—' : value;
  const note = isLoading ? 'Loading…' : isError ? "Couldn't load" : (value === 0 ? empty : null);

  return (
    <button type="button" className={`lx-tb__tile ${isError ? 'lx-tb__tile--error' : ''}`} onClick={onOpen}
      aria-label={`${label}: ${isError ? "couldn't load" : isLoading ? 'loading' : value}`}>
      <span className="lx-tb__num">{num}</span>
      <span className="lx-tb__label">{label}</span>
      {note && <span className="lx-tb__note">{note}</span>}
    </button>
  );
}
