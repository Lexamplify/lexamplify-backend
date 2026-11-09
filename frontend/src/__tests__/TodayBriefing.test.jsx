// Time zone is pinned to IST at the very top so the date-only hearing maths (browser-local midnight) is deterministic on
// any machine or CI runner. Node applies a runtime TZ change on the next Date operation; every Date below is created
// inside a test body, after this line has run, and a sanity assertion in the midnight tests proves the offset is IST.
process.env.TZ = 'Asia/Kolkata';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import featuresJson from '../assistant/features.json';
import {
  detectTodayBriefing, normalize, summarizeCases, countDrafts,
  START_ALIAS_TRIGGERS, BRIEFING_FLOW, BRIEFING_LABEL,
} from '../assistant/todayBriefing.js';
import TodayBriefingCard from '../components/TodayBriefingCard.jsx';
import Today from '../pages/Today.jsx';
import Assistant from '../pages/Assistant.jsx';

// MicButton is replaced by a mock that can inject a transcript into the composer exactly the way the real mic does:
// write the textarea value + fire a native input event (so the controlled component updates) then call afterInsert.
// `dictate(text)` is how a test drives the DICTATION path (never an auto-send — the lawyer still submits).
let dictate = null;
vi.mock('../components/MicButton.jsx', () => ({
  LangPicker: () => null,
  default: ({ afterInsert }) => {
    dictate = (value) => {
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, value);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      afterInsert?.(ta);
    };
    return null;
  },
}));
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { name: 'Asha Rao' } }),
  AuthProvider: ({ children }) => children,
}));

function reply(body, status = 200) {
  return { ok: status < 400, status, headers: { get: () => null }, json: async () => body };
}
function setClock(iso) {
  vi.useFakeTimers({ toFake: ['Date'] });   // fake ONLY Date — setTimeout stays real so fetch timeouts and waitFor work
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  dictate = null;
  delete globalThis.fetch;
});

// ── trigger list ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('detectTodayBriefing (trigger list)', () => {
  it('matches the kept en/hi/ta triggers and Group B phrases', () => {
    for (const t of ['today', 'my day', 'what is on today', 'aaj', 'आज', 'indru', 'இன்று',
      'my day today', 'what is my day', "what's my day", 'how is my day', 'what do i have today', 'brief me on my day']) {
      expect(detectTodayBriefing(t).matched, t).toBe(true);
    }
  });

  it('matches with one leading verb removed, like obvious_match', () => {
    for (const t of ['open today', 'show my day', 'go to today', 'take me to my day']) {
      expect(detectTodayBriefing(t).matched, t).toBe(true);
    }
  });

  it('does NOT trigger on removed aliases or on longer sentences', () => {
    for (const t of ['start', 'home', 'overview', 'open home', "today's hearing in Sharma case",
      'open matters', 'draft a notice today', 'shuru', 'होम', 'thodakkam', '']) {
      expect(detectTodayBriefing(t).matched, t).toBe(false);
    }
  });

  it('normalises a curly apostrophe before matching', () => {
    expect(normalize('what’s my day')).toBe("what's my day");
    expect(detectTodayBriefing('what’s my day').matched).toBe(true);
  });

  it('treats the Hindi danda as trailing punctuation', () => {
    expect(detectTodayBriefing('आज।').matched).toBe(true);
    expect(detectTodayBriefing('today।').matched).toBe(true);
  });

  it('accepts dictation-style spacing and punctuation', () => {
    expect(detectTodayBriefing('What is my day?').matched).toBe(true);
    expect(detectTodayBriefing('  Today. ').matched).toBe(true);
  });

  it('keeps the Group A triggers in step with the start aliases in features.json', () => {
    const start = featuresJson.features.find((f) => f.id === 'start');
    const aliases = Object.values(start.aliases).flat();
    for (const phrase of START_ALIAS_TRIGGERS) {
      expect(aliases, `features.json start aliases must still contain "${phrase}"`).toContain(phrase);
    }
  });
});

// ── the numbers: parity with the real Start page (pages/Today.jsx) ─────────────────────────────────────────────────────
describe('parity with the live /start (pages/Today.jsx)', () => {
  const CASES = [
    { id: 1, closed: false, next_hearing: '2026-11-09' },   // today (0d)
    { id: 2, closed: false, next_hearing: '2026-11-13' },   // 4d → this week
    { id: 3, closed: false, next_hearing: '2026-11-16' },   // 7d → this week (boundary)
    { id: 4, closed: false, next_hearing: '2026-11-17' },   // 8d → NOT this week
    { id: 5, closed: false, next_hearing: '2026-11-01' },   // past → excluded from hearings
    { id: 6, closed: false },                               // open matter, no hearing
    { id: 7, closed: true, next_hearing: '2026-11-09' },    // closed → excluded everywhere
  ];
  const SESSIONS = [{ id: 1, status: 'draft' }, { id: 2, status: 'done' }, { id: 3, status: 'in_progress' }];

  function mockData() {
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const method = (init.method || 'GET').toUpperCase();
      if (u.includes('/api/practice/cases') && method === 'GET') return reply({ cases: CASES });
      if (u.includes('/api/drafts/sessions') && method === 'GET') return reply({ sessions: SESSIONS });
      return reply({});
    });
  }

  function numFor(root, label, numClass, tileClass) {
    const el = Array.from(root.querySelectorAll(numClass === '.lx-tb__num' ? '.lx-tb__label' : '.lx-stat__label'))
      .find((n) => n.textContent.trim() === label);
    return el.closest(tileClass).querySelector(numClass).textContent.trim();
  }

  it('shows the same four numbers the rendered Today page shows', async () => {
    setClock('2026-11-09T10:00:00+05:30');
    mockData();

    // 1) the real, unchanged Start page
    const today = render(<MemoryRouter><Today /></MemoryRouter>);
    await waitFor(() => expect(today.container.querySelector('.lx-stat__num')).toBeTruthy());
    await waitFor(() => expect(numFor(today.container, 'Hearings today', '.lx-stat__num', '.lx-stat')).not.toBe('—'));
    const fromToday = {
      hearingsToday: numFor(today.container, 'Hearings today', '.lx-stat__num', '.lx-stat'),
      thisWeek: numFor(today.container, 'Hearings this week', '.lx-stat__num', '.lx-stat'),
      drafts: numFor(today.container, 'Drafts in progress', '.lx-stat__num', '.lx-stat'),
      open: numFor(today.container, 'Open matters', '.lx-stat__num', '.lx-stat'),
    };
    today.unmount();

    // 2) the briefing card, same mocked fetch
    const brief = render(<TodayBriefingCard onNavigate={() => {}} onSettled={() => {}} />);
    await waitFor(() => expect(numFor(brief.container, 'Hearings today', '.lx-tb__num', '.lx-tb__tile')).not.toBe('—'));
    const fromBrief = {
      hearingsToday: numFor(brief.container, 'Hearings today', '.lx-tb__num', '.lx-tb__tile'),
      thisWeek: numFor(brief.container, 'Hearings this week', '.lx-tb__num', '.lx-tb__tile'),
      drafts: numFor(brief.container, 'Drafts in progress', '.lx-tb__num', '.lx-tb__tile'),
      open: numFor(brief.container, 'Open matters', '.lx-tb__num', '.lx-tb__tile'),
    };

    expect(fromBrief).toEqual(fromToday);
    expect(fromBrief).toEqual({ hearingsToday: '1', thisWeek: '3', drafts: '3', open: '6' });
  });
});

// ── midnight + week boundary (fake clock, IST) ─────────────────────────────────────────────────────────────────────────
describe('midnight and week boundaries', () => {
  const CASES = [
    { id: 1, closed: false, next_hearing: '2026-11-09' },   // today
    { id: 2, closed: false, next_hearing: '2026-11-10' },   // tomorrow (not today)
    { id: 3, closed: false, next_hearing: '2026-11-16' },   // +7 → in this week
    { id: 4, closed: false, next_hearing: '2026-11-17' },   // +8 → not in this week
  ];

  it('time zone is pinned to IST', () => {
    setClock('2026-11-09T12:00:00+05:30');
    expect(new Date('2026-11-09T00:00:00').getTimezoneOffset()).toBe(-330);   // IST = UTC+5:30
  });

  it('counts the same at 23:59 and at 00:01 IST; +7 in, +8 out', () => {
    for (const instant of ['2026-11-09T23:59:00+05:30', '2026-11-09T00:01:00+05:30']) {
      setClock(instant);
      const s = summarizeCases(CASES);
      expect(s.hearingsToday, instant).toBe(1);                 // only 2026-11-09
      expect(s.hearingsThisWeek, instant).toBe(3);              // 09 (0d), 16 (7d) in; 17 (8d) out; 10 (1d) in
      vi.useRealTimers();
    }
  });

  it('countDrafts counts all sessions, matching Today.jsx', () => {
    expect(countDrafts({ sessions: [{ status: 'draft' }, { status: 'done' }] })).toBe(2);
    expect(countDrafts({ items: [{}, {}, {}] })).toBe(3);
    expect(countDrafts([{}, {}])).toBe(2);
    expect(countDrafts({})).toBe(0);
  });
});

// ── the card: independent sections, empty states, abort ────────────────────────────────────────────────────────────────
describe('TodayBriefingCard sections', () => {
  function mock({ cases, drafts }) {
    globalThis.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes('/api/practice/cases')) return cases();
      if (u.includes('/api/drafts/sessions')) return drafts();
      return reply({});
    });
  }

  it('shows "Couldn\'t load" for a failed section while the other still shows its number (never 0)', async () => {
    setClock('2026-11-09T10:00:00+05:30');
    mock({ cases: () => reply({}, 500), drafts: () => reply({ sessions: [{}, {}] }) });
    render(<TodayBriefingCard onNavigate={() => {}} onSettled={() => {}} />);

    await waitFor(() => expect(screen.getAllByText("Couldn't load").length).toBe(3)); // the 3 case-derived tiles
    const drafts = screen.getByText('Drafts in progress').closest('.lx-tb__tile');
    expect(drafts.querySelector('.lx-tb__num').textContent).toBe('2');
    expect(drafts.textContent).not.toContain("Couldn't load");
  });

  it('the reverse: drafts fails, hearings/matters still show', async () => {
    setClock('2026-11-09T10:00:00+05:30');
    mock({ cases: () => reply({ cases: [{ id: 1, closed: false, next_hearing: '2026-11-09' }] }), drafts: () => reply({}, 500) });
    render(<TodayBriefingCard onNavigate={() => {}} onSettled={() => {}} />);

    await waitFor(() => expect(screen.getByText('Drafts in progress').closest('.lx-tb__tile').textContent).toContain("Couldn't load"));
    expect(screen.getByText('Hearings today').closest('.lx-tb__tile').querySelector('.lx-tb__num').textContent).toBe('1');
  });

  it('shows empty text (not "Couldn\'t load", not a failure) when everything is really zero', async () => {
    setClock('2026-11-09T10:00:00+05:30');
    mock({ cases: () => reply({ cases: [] }), drafts: () => reply({ sessions: [] }) });
    render(<TodayBriefingCard onNavigate={() => {}} onSettled={() => {}} />);

    await waitFor(() => expect(screen.getByText('No hearings today')).toBeInTheDocument());
    expect(screen.getByText('No open matters')).toBeInTheDocument();
    expect(screen.getByText('No drafts in progress')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load")).toBeNull();
  });

  it('aborts in-flight requests when it unmounts (leaving the page)', async () => {
    setClock('2026-11-09T10:00:00+05:30');
    let casesSignal = null;
    globalThis.fetch = vi.fn((url, init = {}) => {
      if (String(url).includes('/api/practice/cases')) casesSignal = init.signal;
      return new Promise(() => {});   // never resolves
    });
    const { unmount } = render(<TodayBriefingCard onNavigate={() => {}} onSettled={() => {}} />);
    await waitFor(() => expect(casesSignal).toBeTruthy());
    expect(casesSignal.aborted).toBe(false);
    unmount();
    expect(casesSignal.aborted).toBe(true);
  });
});

// ── the Assistant flow: flag OFF, ping failure, guard, no caching, no client data, dictation ──────────────────────────
describe('Assistant → today briefing flow', () => {
  function renderAssistant() {
    return render(<MemoryRouter><Assistant /></MemoryRouter>);
  }
  function type(value) {
    const ta = screen.getByLabelText('Your command');
    fireEvent.change(ta, { target: { value } });
    return ta;
  }
  function submit() {
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
  }

  it('flag OFF: re-dispatches the original words once (no loop) and shows no briefing card', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ u, body });
      if (u.includes('/api/assistant/conversations')) return reply({ conversations: [] });
      if (u.includes('/api/assistant/command') && body.flow === BRIEFING_FLOW) return reply({ flow: BRIEFING_FLOW, enabled: false, conversationId: null, history: [] });
      if (u.includes('/api/assistant/command')) return reply({ intent: 'navigate', feature: 'start', action: 'open', understood: 'Open Start.' });
      return reply({});
    });
    renderAssistant();
    type('what is my day');
    submit();

    await waitFor(() => expect(calls.some((c) => c.u.includes('/command') && c.body.text === 'what is my day')).toBe(true));
    const pings = calls.filter((c) => c.u.includes('/command') && c.body.flow === BRIEFING_FLOW);
    const normals = calls.filter((c) => c.u.includes('/command') && c.body.text === 'what is my day');
    expect(pings.length).toBe(1);                 // the one ping
    expect(normals.length).toBe(1);               // re-dispatched exactly once — no loop
    expect(screen.queryByText('Your day')).toBeNull();
    // the ping carried only the fixed label, never the words / any client data
    expect(pings[0].body).toEqual({ flow: BRIEFING_FLOW, event: 'opened' });
  });

  it('ping failure (server error) falls back to the normal command path, no error screen', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ u, body });
      if (u.includes('/api/assistant/conversations')) return reply({ conversations: [] });
      if (u.includes('/api/assistant/command') && body.flow === BRIEFING_FLOW) return reply({ error: true }, 502);
      if (u.includes('/api/assistant/command')) return reply({ intent: 'navigate', feature: 'start', action: 'open', understood: 'Open Start.' });
      return reply({});
    });
    renderAssistant();
    type('my day');
    submit();

    await waitFor(() => expect(calls.some((c) => c.u.includes('/command') && c.body.text === 'my day')).toBe(true));
    await waitFor(() => expect(screen.getAllByText('Open Start.').length).toBeGreaterThan(0));  // normal reply rendered
    expect(screen.queryByText('Your day')).toBeNull();             // no briefing card
    expect(screen.queryByText(/could not|couldn’t|unavailable/i)).toBeNull();  // and no error screen
  });

  it('flag ON: a second trigger while the first is loading is ignored (one ping, one card)', async () => {
    let casesResolve;
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ u, body });
      if (u.includes('/api/assistant/conversations')) return reply({ conversations: [] });
      if (u.includes('/api/assistant/command') && body.flow === BRIEFING_FLOW) return reply({ flow: BRIEFING_FLOW, enabled: true, conversationId: 10, history: [] });
      if (u.includes('/api/practice/cases')) return new Promise((res) => { casesResolve = () => res(reply({ cases: [] })); }); // hangs → card stays loading
      if (u.includes('/api/drafts/sessions')) return reply({ sessions: [] });
      return reply({});
    });
    renderAssistant();
    type('today');
    submit();
    await waitFor(() => expect(screen.getByText('Your day')).toBeInTheDocument());

    // card is mounted and still loading (cases hang) → fire a second trigger
    type('my day');
    submit();
    await act(async () => {});

    const pings = calls.filter((c) => c.u.includes('/command') && c.body.flow === BRIEFING_FLOW);
    expect(pings.length).toBe(1);                              // the second trigger was ignored
    expect(screen.getAllByText('Your day').length).toBe(1);   // no second card
    casesResolve?.();
  });

  it('every trigger fetches fresh data — two triggers make two sets of calls', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ u, body });
      if (u.includes('/api/assistant/conversations')) return reply({ conversations: [] });
      if (u.includes('/api/assistant/command') && body.flow === BRIEFING_FLOW) return reply({ flow: BRIEFING_FLOW, enabled: true, conversationId: 10, history: [] });
      if (u.includes('/api/practice/cases')) return reply({ cases: [] });
      if (u.includes('/api/drafts/sessions')) return reply({ sessions: [] });
      return reply({});
    });
    renderAssistant();

    type('today');
    submit();
    await waitFor(() => expect(screen.getAllByText('Your day').length).toBe(1));
    await waitFor(() => expect(calls.filter((c) => c.u.includes('/api/practice/cases')).length).toBe(1));

    type('my day');
    submit();
    await waitFor(() => expect(screen.getAllByText('Your day').length).toBe(2));
    await waitFor(() => expect(calls.filter((c) => c.u.includes('/api/practice/cases')).length).toBe(2));
    expect(calls.filter((c) => c.u.includes('/api/drafts/sessions')).length).toBe(2);
  });

  it('dictated text goes through the same send() path and triggers the briefing', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ u, body });
      if (u.includes('/api/assistant/conversations')) return reply({ conversations: [] });
      if (u.includes('/api/assistant/command') && body.flow === BRIEFING_FLOW) return reply({ flow: BRIEFING_FLOW, enabled: true, conversationId: 10, history: [] });
      if (u.includes('/api/practice/cases')) return reply({ cases: [] });
      if (u.includes('/api/drafts/sessions')) return reply({ sessions: [] });
      return reply({});
    });
    renderAssistant();
    act(() => dictate('what is my day'));     // the mic inserts into the composer; it never auto-sends
    submit();                                 // the lawyer submits — same path as typing

    await waitFor(() => expect(screen.getByText('Your day')).toBeInTheDocument());
    const pings = calls.filter((c) => c.u.includes('/command') && c.body.flow === BRIEFING_FLOW);
    expect(pings.length).toBe(1);
    expect(BRIEFING_LABEL).toBe('today_briefing_opened');
  });
});
