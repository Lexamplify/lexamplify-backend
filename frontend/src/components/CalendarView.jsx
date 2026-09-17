import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { loginWithGoogle, logoutFromGoogle, fetchGoogleEvents, pushToGoogleCalendar, ensureGisLoaded } from '../utils/googleCalendar';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// ── Event type → visual accent mapping (Slate & Rust Two-Color Contract) ─────
function getEventAccent(type) {
  const t = (type || '').toLowerCase();
  if (t === 'deadline' || t === 'drop_dead' || t.includes('limitation') || t === 'tickler') {
    return { type: 'deadline', border: 'var(--accent)', bg: 'var(--accent-soft)', text: 'var(--accent)', label: 'Deadline' };
  }
  if (t === 'hearing' || t === 'appearance' || t.includes('hearing') || t.includes('court')) {
    return { type: 'hearing', border: 'var(--major)', bg: 'var(--major-soft)', text: 'var(--major)', label: 'Hearing' };
  }
  return { type: 'task', border: 'var(--muted-2)', bg: 'var(--paper-2)', text: 'var(--ink-soft)', label: 'Task' };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function daysBetween(a, b) {
  const ms = new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.round(ms / 86400000);
}

function fmtWhen(diff) {
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1) return `In ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

// ── Generic Sync Icon ────────────────────────────────────────────────────────
const SYNC_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 2.1l4 4-4 4" /><path d="M3 12.6v-2a4 4 0 0 1 4-4h14" />
    <path d="M7 21.9l-4-4 4-4" /><path d="M21 11.4v2a4 4 0 0 1-4 4H3" />
  </svg>
);

// ── Hover Brief Tooltip (rendered via ReactDOM.createPortal) ─────────────────
function HoverBriefTooltip({ tooltip, synopsisCache, synopsisLoading, onGenerate, onMouseEnter, onMouseLeave }) {
  if (!tooltip) return null;
  const { event, x, y, showBelow } = tooltip;
  const TOOLTIP_W = 290;

  let tx = Math.min(Math.max(x - TOOLTIP_W / 2, 8), window.innerWidth - TOOLTIP_W - 8);
  const acc = getEventAccent(event.event_type);
  const synopsis = event.related_case_id ? synopsisCache[event.related_case_id] : null;
  const isFetching = event.related_case_id && synopsisLoading === event.related_case_id;

  return ReactDOM.createPortal(
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        left: tx,
        top: y,
        transform: showBelow ? 'translateY(6px)' : 'translateY(calc(-100% - 6px))',
        width: TOOLTIP_W,
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderLeft: `3px solid ${acc.border}`,
        borderRadius: '10px',
        padding: '14px',
        zIndex: 99999,
        boxShadow: 'var(--shadow)',
        pointerEvents: 'auto',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px', lineHeight: 1.35 }}>
        {event.title}
      </div>

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '5px', marginBottom: '8px',
        padding: '2px 7px', borderRadius: '4px', background: acc.bg,
        color: acc.text, fontSize: '10px', fontWeight: 700,
        fontFamily: 'IBM Plex Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: acc.border }} />
        {(event.event_type || 'event').replace(/_/g, ' ')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: event.related_case_id ? '10px' : '0' }}>
        {event.location && (
          <div style={{ fontSize: '11.5px', color: 'var(--ink-soft)' }}>
            📍 {event.location}
          </div>
        )}
        {event.opposing_counsel && (
          <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>
            ⚖️ {event.opposing_counsel}
          </div>
        )}
      </div>

      {event.related_case_id && (
        <div style={{ borderTop: '1px solid var(--rule)', paddingTop: '10px', marginTop: '6px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--muted)', marginBottom: '6px', fontFamily: 'IBM Plex Mono, monospace' }}>
            Matter Synopsis · Case #{event.related_case_id}
          </div>
          {synopsis ? (
            <div style={{ fontSize: '12px', color: 'var(--ink-soft)', lineHeight: 1.55 }}>{synopsis}</div>
          ) : isFetching ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: 'var(--muted)' }}>
              <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid var(--rule)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.75s linear infinite' }} />
              Generating synopsis…
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onGenerate(event.related_case_id); }}
              style={{
                background: 'var(--accent-soft)', border: '1px solid var(--accent)',
                color: 'var(--accent)', borderRadius: '6px', padding: '4px 10px',
                fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              ✦ Generate Synopsis
            </button>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

// ── Main Legal Calendar Component ─────────────────────────────────────────────
export default function CalendarView() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [today] = useState(() => new Date());
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('hearing');
  const [newCaseId, setNewCaseId] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newOpposingCounsel, setNewOpposingCounsel] = useState('');
  const [modalSaving, setModalSaving] = useState(false);
  const [syncToGoogle, setSyncToGoogle] = useState(false);

  // Google Calendar GIS sync state
  const [googleToken, setGoogleToken] = useState(null);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleError, setGoogleError] = useState(null);

  // Tooltip & Synopsis Cache
  const [tooltip, setTooltip] = useState(null);
  const [synopsisCache, setSynopsisCache] = useState({});
  const [synopsisLoading, setSynopsisLoading] = useState(null);
  const hideTimerRef = useRef(null);

  const showTooltip = useCallback((rect, event) => {
    clearTimeout(hideTimerRef.current);
    const showBelow = rect.top < 200;
    setTooltip({
      event,
      x: rect.left + rect.width / 2,
      y: showBelow ? rect.bottom : rect.top,
      showBelow,
    });
  }, []);

  const startHide = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setTooltip(null), 130);
  }, []);

  const cancelHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
  }, []);

  const handleGenerateSynopsis = async (caseId) => {
    setSynopsisLoading(caseId);
    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Provide a concise 2-sentence legal matter synopsis for case ID: ${caseId}. Focus on likely nature of proceedings and current status.`,
        }),
      });
      const data = await res.json();
      setSynopsisCache(prev => ({ ...prev, [caseId]: data.response || 'Synopsis unavailable.' }));
    } catch {
      setSynopsisCache(prev => ({ ...prev, [caseId]: 'Failed to generate synopsis.' }));
    }
    setSynopsisLoading(null);
  };

  const loadEvents = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/calendar/events`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents(data.events || []);
    } catch (err) {
      setError(err.message || 'Failed to load calendar events.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    ensureGisLoaded().catch(() => {});
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  // Google Calendar Handlers
  const handleGoogleConnect = async () => {
    setGoogleConnecting(true);
    setGoogleError(null);
    try {
      const token = await loginWithGoogle();
      setGoogleToken(token);
    } catch (err) {
      setGoogleError(err.message || 'Google sign-in failed.');
    } finally {
      setGoogleConnecting(false);
    }
  };

  const handleGoogleDisconnect = () => {
    logoutFromGoogle(googleToken);
    setGoogleToken(null);
    setGoogleEvents([]);
    setSyncToGoogle(false);
  };

  useEffect(() => {
    if (!googleToken) return;
    let cancelled = false;
    const y = viewDate.getFullYear(), m = viewDate.getMonth();
    const timeMin = new Date(y, m, 1).toISOString();
    const timeMax = new Date(y, m + 1, 0, 23, 59, 59).toISOString();

    fetchGoogleEvents(googleToken, timeMin, timeMax)
      .then(evts => { if (!cancelled) setGoogleEvents(evts); })
      .catch(err => { if (!cancelled) { setGoogleEvents([]); setGoogleError(err.message || 'Failed to fetch Google events.'); } });

    return () => { cancelled = true; };
  }, [googleToken, viewDate]);

  const allEvents = useMemo(() => [...events, ...googleEvents], [events, googleEvents]);

  // Date Math Helpers
  const dateToKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const eventsByKey = useMemo(() => {
    const map = {};
    for (const ev of allEvents) {
      if (!ev.event_date) continue;
      const k = ev.event_date.split('T')[0];
      if (!map[k]) map[k] = [];
      map[k].push(ev);
    }
    return map;
  }, [allEvents]);

  // Upcoming Events Feed (Shared with Dashboard)
  const upcomingItems = useMemo(() => {
    const items = [];
    const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    for (const ev of allEvents) {
      if (!ev.event_date) continue;
      const parts = ev.event_date.split('T')[0].split('-').map(Number);
      if (parts.length < 3) continue;
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      const diff = daysBetween(todayZero, d);
      if (diff >= 0) {
        items.push({ date: d, diff, ev });
      }
    }
    items.sort((a, b) => a.diff - b.diff);
    return items.slice(0, 10);
  }, [allEvents, today]);

  // Navigation handlers
  const handlePrevMonth = () => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };
  const handleNextMonth = () => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };
  const handleTodayJump = () => {
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const handleDayClick = (y, m, d) => {
    setSelectedDate(new Date(y, m, d));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setNewTitle('');
    setNewType('hearing');
    setNewCaseId('');
    setNewLocation('');
    setNewOpposingCounsel('');
    setSyncToGoogle(false);
  };

  const handleAddEventSubmit = async (e) => {
    e.preventDefault();
    if (!newTitle.trim() || !selectedDate) return;
    setModalSaving(true);
    try {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      const eventDate = `${y}-${m}-${d}`;

      let googleEventId = null;
      if (syncToGoogle && googleToken) {
        try {
          googleEventId = await pushToGoogleCalendar(googleToken, {
            title: newTitle.trim(),
            event_date: eventDate,
            location: newLocation.trim(),
          });
        } catch {
          setGoogleError('Saved locally, but Google Calendar sync failed.');
        }
      }

      await fetch(`${API_BASE}/api/calendar/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [{
            event_date: eventDate,
            event_type: newType,
            title: newTitle.trim(),
            related_case_id: newCaseId.trim() || null,
            location: newLocation.trim(),
            opposing_counsel: newOpposingCounsel.trim(),
            google_event_id: googleEventId,
          }],
        }),
      });

      await loadEvents();
      closeModal();
    } catch {
      alert('Error saving event. Please check connection.');
    } finally {
      setModalSaving(false);
    }
  };

  // Selected Day Events for Modal Agenda
  const selectedDayKey = selectedDate ? dateToKey(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate()) : '';
  const selectedDayEvents = selectedDayKey ? (eventsByKey[selectedDayKey] || []) : [];

  const HIGH_PRIO = new Set(['deadline', 'drop_dead', 'limitation', 'appearance', 'hearing']);
  const hasConflict =
    newTitle.trim() !== '' &&
    HIGH_PRIO.has(newType) &&
    selectedDayEvents.some(e => HIGH_PRIO.has(e.event_type));

  // Calendar Grid Calculation
  const y = viewDate.getFullYear();
  const m = viewDate.getMonth();
  const monthTitle = `${MONTH_NAMES[m].toUpperCase()} ${y}`;

  const firstWeekday = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysInPrevMonth = new Date(y, m, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstWeekday + 1;
    const isPad = dayNum < 1 || dayNum > daysInMonth;
    let cellY = y, cellM = m, cellD = dayNum;

    if (dayNum < 1) {
      cellD = daysInPrevMonth + dayNum;
      cellM = m - 1;
      if (cellM < 0) { cellM = 11; cellY = y - 1; }
    } else if (dayNum > daysInMonth) {
      cellD = dayNum - daysInMonth;
      cellM = m + 1;
      if (cellM > 11) { cellM = 0; cellY = y + 1; }
    }

    const k = dateToKey(cellY, cellM, cellD);
    const isToday = !isPad && cellY === today.getFullYear() && cellM === today.getMonth() && cellD === today.getDate();
    const cellEvents = (!isPad && eventsByKey[k]) ? eventsByKey[k] : [];

    cells.push({
      key: k,
      dayNum: cellD,
      isPad,
      isToday,
      cellY,
      cellM,
      cellD,
      events: cellEvents,
    });
  }

  return (
    <div className="cal-view-container">
      <style>{`
        /* ============================================================
           LEGAL CALENDAR (Tickler Engine) — v1 Slate & Rust Tokens
           ============================================================ */
        .cal-view-container {
          color: var(--ink);
          font-family: 'IBM Plex Sans', sans-serif;
          min-height: 100%;
        }
        .serif { font-family: 'Fraunces', serif; font-style: italic; letter-spacing: -0.01em; }
        .mono { font-family: 'IBM Plex Mono', monospace; }

        .topbar-cal {
          display: flex;
          align-items: flex-start;
          gap: 20px;
          padding: 28px 36px 0;
          flex-wrap: wrap;
        }
        .eyebrow-cal {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .page-title-cal {
          font-size: 28px;
          margin-top: 6px;
          margin-bottom: 0;
          color: var(--ink);
        }
        .page-sub-cal {
          font-size: 13px;
          color: var(--ink-soft);
          margin-top: 7px;
          max-width: 540px;
          line-height: 1.5;
        }
        .topbar-actions-cal {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-top: 2px;
          flex-wrap: wrap;
        }
        .btn-cal {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-radius: 9px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          white-space: nowrap;
          transition: all 0.15s;
        }
        .btn-cal:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .btn-cal-primary {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--on-accent);
        }
        .btn-cal-primary:hover {
          filter: brightness(1.08);
          color: var(--on-accent);
        }
        .btn-cal-sm {
          padding: 7px 12px;
          font-size: 12px;
        }

        .month-nav {
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 10px;
          padding: 4px;
        }
        .month-nav button {
          width: 30px;
          height: 30px;
          border-radius: 7px;
          border: 0;
          background: transparent;
          color: var(--ink-soft);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }
        .month-nav button:hover {
          background: var(--paper-2);
          color: var(--accent);
        }
        .month-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12.5px;
          font-weight: 600;
          padding: 0 10px;
          min-width: 140px;
          text-align: center;
        }

        .content-cal {
          padding: 26px 36px 70px;
        }
        .cal-layout {
          display: grid;
          grid-template-columns: 1fr 300px;
          gap: 18px;
          align-items: start;
        }

        /* ── Calendar Grid ── */
        .cal-card {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 14px;
          overflow: hidden;
        }
        .cal-weekdays {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          border-bottom: 1px solid var(--rule);
        }
        .cal-weekdays div {
          padding: 12px 4px;
          text-align: center;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          letter-spacing: .07em;
          color: var(--muted);
        }
        .cal-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
        }
        .cal-cell {
          min-height: 96px;
          border-right: 1px solid var(--rule);
          border-bottom: 1px solid var(--rule);
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          cursor: pointer;
          text-align: left;
          background: transparent;
          color: var(--ink);
          transition: background 0.15s;
        }
        .cal-cell:nth-child(7n) { border-right: 0; }
        .cal-cell:hover:not(.pad) { background: var(--paper-2); }
        .cal-cell.pad {
          color: var(--muted-2);
          cursor: default;
          opacity: 0.35;
        }
        .cal-date {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12.5px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .cal-cell.today .cal-date {
          color: var(--accent);
          font-weight: 600;
        }
        .today-pill {
          font-size: 8.5px;
          letter-spacing: .05em;
          font-weight: 600;
          background: var(--accent);
          color: var(--on-accent);
          border-radius: 4px;
          padding: 1px 5px;
        }
        .cal-events {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .cal-event-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          padding: 2px 5px;
          border-radius: 5px;
          background: var(--paper-2);
          color: var(--ink-soft);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cal-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--muted-2);
        }
        .cal-dot.deadline { background: var(--accent); }
        .cal-dot.hearing { background: var(--major); }
        .cal-more {
          font-size: 9.5px;
          color: var(--muted);
          padding-left: 2px;
        }

        /* ── Upcoming Rail & Legend ── */
        .rail-card {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 14px;
          overflow: hidden;
        }
        .rail-head {
          padding: 15px 16px;
          border-bottom: 1px solid var(--rule);
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: .04em;
          text-transform: uppercase;
          color: var(--ink-soft);
          font-family: 'IBM Plex Mono', monospace;
        }
        .rail-body {
          padding: 8px 12px;
          max-height: 420px;
          overflow-y: auto;
        }
        .rail-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 11px 6px;
        }
        .rail-item + .rail-item { border-top: 1px dashed var(--rule); }
        .rail-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          margin-top: 3px;
          flex-shrink: 0;
          background: var(--muted-2);
        }
        .rail-dot.deadline { background: var(--accent); }
        .rail-dot.hearing { background: var(--major); }
        .rail-title {
          font-size: 12.5px;
          font-weight: 500;
          line-height: 1.4;
          color: var(--ink);
        }
        .rail-meta {
          font-size: 10.5px;
          color: var(--muted);
          margin-top: 3px;
        }
        .rail-when {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9.5px;
          color: var(--ink-soft);
          margin-top: 4px;
          display: inline-block;
          padding: 2px 7px;
          border-radius: 999px;
          background: var(--paper-2);
        }
        .rail-when.urgent {
          background: var(--accent-soft);
          color: var(--accent);
        }

        .legend-card {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 14px;
          padding: 14px 16px;
          margin-top: 16px;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .legend-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--ink-soft);
        }
        .legend-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
        }
        .legend-dot.deadline { background: var(--accent); }
        .legend-dot.hearing { background: var(--major); }
        .legend-dot.task { background: var(--muted-2); }

        /* ── Day Modal ── */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: var(--overlay);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 30px;
          z-index: 2000;
        }
        .modal-cal {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 16px;
          box-shadow: var(--shadow);
          width: 100%;
          max-width: 860px;
          max-height: 88vh;
          overflow: hidden;
          display: grid;
          grid-template-columns: 300px 1fr;
          position: relative;
        }
        .modal-agenda {
          border-right: 1px solid var(--rule);
          padding: 22px;
          display: flex;
          flex-direction: column;
          background: var(--paper-2);
          overflow-y: auto;
        }
        .modal-agenda-eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .modal-agenda-day {
          font-size: 22px;
          margin-top: 6px;
          color: var(--ink);
        }
        .modal-agenda-date {
          font-size: 12.5px;
          color: var(--ink-soft);
          margin-top: 2px;
        }
        .modal-agenda-count {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          color: var(--muted);
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid var(--rule);
        }
        .modal-agenda-list {
          margin-top: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow-y: auto;
          flex-grow: 1;
        }
        .modal-agenda-empty {
          text-align: center;
          margin-top: 30px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: var(--muted);
        }
        .modal-main-cal {
          padding: 22px 24px;
          overflow-y: auto;
        }
        .modal-main-eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: var(--accent);
        }
        .modal-main-title {
          font-size: 19px;
          margin-top: 4px;
          margin-bottom: 18px;
          color: var(--ink);
        }
        .field-grid-cal {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .field-cal {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 14px;
        }
        .field-cal label {
          font-size: 11.5px;
          text-transform: uppercase;
          letter-spacing: .04em;
          font-weight: 500;
          color: var(--muted);
        }
        .req { color: var(--accent); }
        .field-cal input, .field-cal select {
          background: var(--paper-2);
          border: 1px solid var(--rule);
          border-radius: 8px;
          padding: 9px 11px;
          font-size: 13px;
          color: var(--ink);
          width: 100%;
          outline: none;
        }
        .field-cal input:focus, .field-cal select:focus {
          border-color: var(--accent);
        }
        .field-cal input::placeholder { color: var(--muted); }
        .modal-legend {
          display: flex;
          gap: 16px;
          padding: 12px 0;
          margin: 6px 0 18px;
          border-top: 1px solid var(--rule);
          border-bottom: 1px solid var(--rule);
        }
        .modal-footer-row {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .close-btn-cal {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid var(--rule);
          background: var(--paper-2);
          color: var(--ink-soft);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s;
        }
        .close-btn-cal:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

        .conflict-alert {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          padding: 10px 14px;
          border-radius: 8px;
          margin-bottom: 14px;
          background: var(--major-soft);
          border: 1px solid var(--major);
          color: var(--major);
          font-size: 12px;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        @media (max-width: 980px) {
          .cal-layout { grid-template-columns: 1fr; }
        }
        @media (max-width: 880px) {
          .cal-cell { min-height: 74px; }
          .modal-cal { grid-template-columns: 1fr; }
          .modal-agenda { border-right: 0; border-bottom: 1px solid var(--rule); }
        }
        @media (max-width: 560px) {
          .content-cal, .topbar-cal { padding-left: 18px; padding-right: 18px; }
          .field-grid-cal { grid-template-columns: 1fr; }
          .cal-event-pill span.evt-label { display: none; }
        }
      `}</style>

      {/* Portal Tooltip */}
      <HoverBriefTooltip
        tooltip={tooltip}
        synopsisCache={synopsisCache}
        synopsisLoading={synopsisLoading}
        onGenerate={handleGenerateSynopsis}
        onMouseEnter={cancelHide}
        onMouseLeave={startHide}
      />

      {/* ── TOPBAR MASTHEAD ── */}
      <header className="topbar-cal">
        <div style={{ flexGrow: 1 }}>
          <div className="eyebrow-cal">Litigation &amp; Disputes · Tickler Engine</div>
          <h1 className="page-title-cal serif">Legal Calendar Dashboard</h1>
          <div className="page-sub-cal">
            Tracks every deadline, hearing and scheduled task across your caseload — nothing here expires silently.
          </div>
        </div>
        <div className="topbar-actions-cal">
          {googleToken ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--paper-2)', border: '1px solid var(--rule)', padding: '6px 12px', borderRadius: '8px' }}>
              {SYNC_ICON}
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>Google Calendar Synced</span>
              <button
                onClick={handleGoogleDisconnect}
                title="Disconnect Google Calendar"
                style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '12px', padding: '0 0 0 4px' }}
              >✕</button>
            </div>
          ) : (
            <button
              onClick={handleGoogleConnect}
              disabled={googleConnecting}
              className="btn-cal"
            >
              {SYNC_ICON}
              {googleConnecting ? 'Connecting…' : 'Sync Google Calendar'}
            </button>
          )}

          <div className="month-nav">
            <button onClick={handlePrevMonth} aria-label="Previous month">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="month-label mono">{monthTitle}</span>
            <button onClick={handleNextMonth} aria-label="Next month">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>

          <button onClick={handleTodayJump} className="btn-cal btn-cal-sm">
            Today
          </button>
        </div>
      </header>

      <div className="content-cal">
        {googleError && (
          <div style={{ color: 'var(--major)', background: 'var(--major-soft)', border: '1px solid var(--major)', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>⚠️ {googleError}</span>
            <button onClick={() => setGoogleError(null)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {loading && (
          <div style={{ padding: '36px', textAlign: 'center', color: 'var(--muted)' }}>
            <span style={{ display: 'inline-block', width: '20px', height: '20px', border: '2px solid var(--rule)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '8px' }} />
            <div>Loading legal calendar…</div>
          </div>
        )}

        {error && !loading && (
          <div style={{ color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent)', padding: '14px', borderRadius: '10px', fontSize: '13px', marginBottom: '20px' }}>
            ⚠️ Failed to load calendar: {error}
          </div>
        )}

        {!loading && (
          <div className="cal-layout">

            {/* ── LEFT: Month Grid Card ── */}
            <div className="cal-card">
              <div className="cal-weekdays">
                <div>SUN</div><div>MON</div><div>TUE</div><div>WED</div><div>THU</div><div>FRI</div><div>SAT</div>
              </div>
              <div className="cal-grid">
                {cells.map((c, i) => {
                  return (
                    <div
                      key={i}
                      className={`cal-cell ${c.isPad ? 'pad' : ''} ${c.isToday ? 'today' : ''}`}
                      onClick={() => !c.isPad && handleDayClick(c.cellY, c.cellM, c.cellD)}
                    >
                      <div className="cal-date">
                        {c.dayNum}
                        {c.isToday && <span className="today-pill">TODAY</span>}
                      </div>
                      <div className="cal-events">
                        {c.events.slice(0, 2).map((ev, evIdx) => {
                          const acc = getEventAccent(ev.event_type);
                          return (
                            <div
                              key={ev.id || evIdx}
                              className="cal-event-pill"
                              onMouseEnter={(e) => {
                                e.stopPropagation();
                                showTooltip(e.currentTarget.getBoundingClientRect(), ev);
                              }}
                              onMouseLeave={(e) => {
                                e.stopPropagation();
                                startHide();
                              }}
                            >
                              <span className={`cal-dot ${acc.type}`} />
                              <span className="evt-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {ev.title}
                              </span>
                            </div>
                          );
                        })}
                        {c.events.length > 2 && (
                          <div className="cal-more">+{c.events.length - 2} more</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── RIGHT: Upcoming Rail & Legend ── */}
            <div>
              <div className="rail-card">
                <div className="rail-head">Upcoming</div>
                <div className="rail-body">
                  {upcomingItems.length === 0 ? (
                    <div style={{ padding: '22px 8px', textAlign: 'center', color: 'var(--muted)', fontSize: '12.5px' }}>
                      Nothing scheduled ahead.
                    </div>
                  ) : (
                    upcomingItems.map((it, idx) => {
                      const acc = getEventAccent(it.ev.event_type);
                      return (
                        <div key={it.ev.id || idx} className="rail-item">
                          <div className={`rail-dot ${acc.type}`} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="rail-title">{it.ev.title}</div>
                            <div className="rail-meta">
                              {it.ev.location || it.ev.opposing_counsel ? (
                                <>
                                  {it.ev.location}
                                  {it.ev.location && it.ev.opposing_counsel ? ' · ' : ''}
                                  {it.ev.opposing_counsel}
                                </>
                              ) : (
                                (it.ev.event_type || 'Event').replace(/_/g, ' ')
                              )}
                            </div>
                            <span className={`rail-when ${it.diff <= 1 ? 'urgent' : ''}`}>
                              {fmtWhen(it.diff)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="legend-card">
                <div className="legend-row">
                  <span className="legend-dot deadline" />
                  Deadline — statutory, urgent
                </div>
                <div className="legend-row">
                  <span className="legend-dot hearing" />
                  Hearing — needs preparation
                </div>
                <div className="legend-row">
                  <span className="legend-dot task" />
                  Task / internal
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* ── DAY AGENDA + QUICK ADD SPLIT MODAL ── */}
      {isModalOpen && selectedDate && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-cal" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn-cal" onClick={closeModal} aria-label="Close">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>

            {/* Left Column: Day Agenda */}
            <div className="modal-agenda">
              <div className="modal-agenda-eyebrow">Day agenda</div>
              <div className="modal-agenda-day serif">
                {WEEKDAY_NAMES[selectedDate.getDay()]}
              </div>
              <div className="modal-agenda-date mono">
                {selectedDate.getDate()} {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getFullYear()}
              </div>
              <div className="modal-agenda-count">
                {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'EVENT' : 'EVENTS'}
              </div>

              <div className="modal-agenda-list">
                {selectedDayEvents.length === 0 ? (
                  <div className="modal-agenda-empty">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4.5" width="18" height="16" rx="2" />
                      <path d="M3 9.5h18" />
                    </svg>
                    <div style={{ fontSize: '12.5px' }}>No hearings or events scheduled for this day.</div>
                  </div>
                ) : (
                  selectedDayEvents.map((ev, idx) => {
                    const acc = getEventAccent(ev.event_type);
                    return (
                      <div key={ev.id || idx} style={{ display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
                        <div className={`rail-dot ${acc.type}`} style={{ marginTop: '4px' }} />
                        <div>
                          <div className="rail-title">{ev.title}</div>
                          <div className="rail-meta">
                            {ev.location || ev.opposing_counsel ? `${ev.location || ''} ${ev.opposing_counsel ? '· ' + ev.opposing_counsel : ''}` : (ev.event_type || 'Event')}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Quick Add Form */}
            <div className="modal-main-cal">
              <div className="modal-main-eyebrow">Quick add</div>
              <div className="modal-main-title serif">Schedule event</div>

              {hasConflict && (
                <div className="conflict-alert">
                  <span style={{ fontSize: '14px', flexShrink: 0 }}>⚠️</span>
                  <div>
                    <strong>Scheduling conflict alert:</strong> High-priority events are already scheduled for this date. Verify before confirming.
                  </div>
                </div>
              )}

              <form onSubmit={handleAddEventSubmit}>
                <div className="field-cal">
                  <label>Target date</label>
                  <input
                    type="text"
                    readOnly
                    value={`${selectedDate.getDate()} ${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`}
                  />
                </div>

                <div className="field-cal">
                  <label>Event title <span className="req">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Bail application deadline"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className="field-grid-cal">
                  <div className="field-cal">
                    <label>Event type</label>
                    <select value={newType} onChange={(e) => setNewType(e.target.value)}>
                      <option value="hearing">Hearing</option>
                      <option value="deadline">Deadline</option>
                      <option value="task">Task / Internal</option>
                    </select>
                  </div>
                  <div className="field-cal">
                    <label>Related case ID</label>
                    <input
                      type="text"
                      placeholder="e.g. 101"
                      value={newCaseId}
                      onChange={(e) => setNewCaseId(e.target.value)}
                    />
                  </div>
                </div>

                <div className="field-cal">
                  <label>Location / court</label>
                  <input
                    type="text"
                    placeholder="e.g. Delhi High Court, Court Room 7"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                  />
                </div>

                <div className="field-cal">
                  <label>Opposing counsel</label>
                  <input
                    type="text"
                    placeholder="e.g. Adv. Rajesh Kumar, Singh &amp; Co."
                    value={newOpposingCounsel}
                    onChange={(e) => setNewOpposingCounsel(e.target.value)}
                  />
                </div>

                {googleToken && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--ink)', cursor: 'pointer', marginBottom: '14px' }}>
                    <input
                      type="checkbox"
                      checked={syncToGoogle}
                      onChange={(e) => setSyncToGoogle(e.target.checked)}
                    />
                    Sync to Google Calendar
                  </label>
                )}

                <div className="modal-legend">
                  <div className="legend-row"><span className="legend-dot deadline" />Deadline</div>
                  <div className="legend-row"><span className="legend-dot hearing" />Hearing</div>
                  <div className="legend-row"><span className="legend-dot task" />Task</div>
                </div>

                <div className="modal-footer-row">
                  <button type="button" className="btn-cal btn-cal-sm" onClick={closeModal}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modalSaving || !newTitle.trim()}
                    className="btn-cal btn-cal-primary btn-cal-sm"
                  >
                    {modalSaving ? 'Saving…' : 'Add event'}
                  </button>
                </div>
              </form>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
