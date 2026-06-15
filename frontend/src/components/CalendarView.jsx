import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

// ── Event type → visual accent ───────────────────────────────────────────────
function getEventAccent(type) {
  const t = (type || '').toLowerCase();
  if (t === 'drop_dead' || t.includes('deadline') || t.includes('limitation') || t === 'tickler')
    return { border: '#DC2626', bg: 'rgba(220,38,38,0.10)', text: '#FCA5A5' };
  if (t === 'appearance' || t.includes('hearing'))
    return { border: '#2563EB', bg: 'rgba(37,99,235,0.10)', text: '#93C5FD' };
  return { border: '#475569', bg: 'rgba(71,85,105,0.10)', text: '#94A3B8' };
}

const calendarStyles = `
  @keyframes cal-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes cal-scale {
    from { opacity: 0; transform: scale(0.96) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes cal-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes cal-tooltip-in {
    from { opacity: 0; transform: translateY(-100%) translateY(-4px); }
    to   { opacity: 1; transform: translateY(-100%) translateY(0); }
  }
  @keyframes cal-tooltip-in-below {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .animate-fade  { animation: cal-fade  0.25s ease-out forwards; }
  .animate-scale { animation: cal-scale 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

  .calendar-grid-cell {
    position: relative;
    aspect-ratio: 1.2;
    background-color: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 6px;
    padding: 8px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  .calendar-grid-cell:hover {
    transform: translateY(-2px);
    border-color: var(--accent-primary, #3B82F6);
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
    background-color: rgba(59, 130, 246, 0.02);
  }
  .calendar-grid-cell.today-cell {
    border-color: rgba(59, 130, 246, 0.45);
    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.2);
  }
  .calendar-grid-cell.padding-cell {
    background-color: transparent;
    border-color: transparent;
    cursor: default;
    pointer-events: none;
  }

  .cal-input {
    width: 100%;
    padding: 8px 12px;
    font-size: 13px;
    border-radius: 6px;
    border: 1px solid var(--border-dark-subtle, #2C3241);
    background-color: rgba(255,255,255,0.01);
    color: white;
    outline: none;
    box-sizing: border-box;
    font-family: var(--font-sans);
    transition: border-color 0.15s;
  }
  .cal-input:focus { border-color: rgba(59,130,246,0.5); }
  .cal-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-dark-muted, #8F9CAE);
    display: block;
    margin-bottom: 6px;
  }
`;

// ── Hover Brief Tooltip (rendered via ReactDOM.createPortal) ─────────────────
function HoverBriefTooltip({ tooltip, synopsisCache, synopsisLoading, onGenerate, onMouseEnter, onMouseLeave }) {
  if (!tooltip) return null;
  const { event, x, y, showBelow } = tooltip;
  const TOOLTIP_W = 286;

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
        background: '#1E293B',
        border: `1px solid ${acc.border}55`,
        borderLeft: `3px solid ${acc.border}`,
        borderRadius: '10px',
        padding: '14px',
        zIndex: 99999,
        boxShadow: '0 20px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04)',
        pointerEvents: 'auto',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        animation: showBelow ? 'cal-tooltip-in-below 0.18s ease-out' : 'cal-tooltip-in 0.18s ease-out',
      }}
    >
      {/* Title */}
      <div style={{ fontSize: '13.5px', fontWeight: '700', color: '#F8FAFC', marginBottom: '8px', lineHeight: 1.35 }}>
        {event.title}
      </div>

      {/* Type badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', marginBottom: '10px',
        padding: '2px 8px', borderRadius: '4px', background: acc.bg,
        color: acc.text, fontSize: '10px', fontWeight: '700',
        textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        {(event.event_type || 'event').replace(/_/g, ' ')}
      </div>

      {/* Location + Opposing counsel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: event.related_case_id ? '12px' : '0' }}>
        <div style={{ display: 'flex', gap: '7px', fontSize: '12px', color: event.location ? '#CBD5E1' : '#475569', fontStyle: event.location ? 'normal' : 'italic' }}>
          <span style={{ flexShrink: 0 }}>📍</span>
          <span>{event.location || 'No location set'}</span>
        </div>
        <div style={{ display: 'flex', gap: '7px', fontSize: '12px', color: event.opposing_counsel ? '#CBD5E1' : '#475569', fontStyle: event.opposing_counsel ? 'normal' : 'italic' }}>
          <span style={{ flexShrink: 0 }}>⚖️</span>
          <span>{event.opposing_counsel || 'No opposing counsel'}</span>
        </div>
      </div>

      {/* Matter Synopsis — only when related_case_id is set */}
      {event.related_case_id && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '10px' }}>
          <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: '#475569', marginBottom: '7px' }}>
            Matter Synopsis · Case {event.related_case_id}
          </div>
          {synopsis ? (
            <div style={{ fontSize: '12px', color: '#94A3B8', lineHeight: 1.65 }}>{synopsis}</div>
          ) : isFetching ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: '#64748B' }}>
              <div style={{ width: '12px', height: '12px', border: '2px solid rgba(59,130,246,0.25)', borderTopColor: '#3B82F6', borderRadius: '50%', animation: 'cal-spin 0.75s linear infinite', flexShrink: 0 }} />
              Generating synopsis…
            </div>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onGenerate(event.related_case_id); }}
              style={{
                background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)',
                color: '#93C5FD', borderRadius: '6px', padding: '5px 12px',
                fontSize: '11.5px', fontWeight: '600', cursor: 'pointer',
                fontFamily: 'inherit', transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.1)'}
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

// ── Main Component ────────────────────────────────────────────────────────────
export default function CalendarView() {
  const [events, setEvents]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 5, 1));
  const [gridKey, setGridKey]         = useState(0);

  // Modal state
  const [isModalOpen, setIsModalOpen]         = useState(false);
  const [selectedDate, setSelectedDate]       = useState(null);
  const [newTitle, setNewTitle]               = useState('');
  const [newType, setNewType]                 = useState('task');
  const [newCaseId, setNewCaseId]             = useState('');
  const [newLocation, setNewLocation]         = useState('');
  const [newOpposingCounsel, setNewOpposingCounsel] = useState('');
  const [modalSaving, setModalSaving]         = useState(false);

  // Tooltip state
  const [tooltip, setTooltip]               = useState(null);
  const [synopsisCache, setSynopsisCache]   = useState({});
  const [synopsisLoading, setSynopsisLoading] = useState(null);
  const hideTimerRef = useRef(null);

  // ── Tooltip logic ──────────────────────────────────────────────────────────
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
    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          message: `Provide a concise 2-sentence legal matter synopsis for case ID: ${caseId}. Focus on likely nature of proceedings and current status.`,
        }),
      });
      const data = await res.json();
      setSynopsisCache(prev => ({ ...prev, [caseId]: data.response || 'Synopsis unavailable.' }));
    } catch {
      setSynopsisCache(prev => ({ ...prev, [caseId]: 'Failed to generate — check connection.' }));
    }
    setSynopsisLoading(null);
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const loadEvents = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/calendar/events`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents(data.events || []);
    } catch (err) {
      setError(err.message || 'Failed to load events.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  // ── Date helpers ───────────────────────────────────────────────────────────
  const getDaysInMonth = (date) => {
    const year = date.getFullYear(), month = date.getMonth();
    return {
      firstDayIndex: new Date(year, month, 1).getDay(),
      totalDays: new Date(year, month + 1, 0).getDate(),
    };
  };

  const { firstDayIndex, totalDays } = getDaysInMonth(currentMonth);
  const paddingCells = Array.from({ length: firstDayIndex });
  const dayCells = Array.from({ length: totalDays }, (_, i) => i + 1);

  const getEventsForDay = (day) => {
    const y = currentMonth.getFullYear();
    const m = String(currentMonth.getMonth() + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return events.filter(e => e.event_date === `${y}-${m}-${d}`);
  };

  const handlePrevMonth = () => {
    setGridKey(p => p + 1);
    setCurrentMonth(p => new Date(p.getFullYear(), p.getMonth() - 1, 1));
  };
  const handleNextMonth = () => {
    setGridKey(p => p + 1);
    setCurrentMonth(p => new Date(p.getFullYear(), p.getMonth() + 1, 1));
  };

  const handleDayClick = (day) => {
    setSelectedDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setNewTitle(''); setNewType('task'); setNewCaseId('');
    setNewLocation(''); setNewOpposingCounsel('');
  };

  const handleAddEventSubmit = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setModalSaving(true);
    try {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const d = String(selectedDate.getDate()).padStart(2, '0');
      await fetch(`${API_BASE}/api/calendar/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [{
            event_date: `${y}-${m}-${d}`,
            event_type: newType,
            title: newTitle.trim(),
            related_case_id: newCaseId.trim(),
            location: newLocation.trim(),
            opposing_counsel: newOpposingCounsel.trim(),
          }],
        }),
      });
      await loadEvents();
      closeModal();
    } catch {
      alert('Error saving event. Check connection.');
    } finally {
      setModalSaving(false);
    }
  };

  const now = new Date();
  const todayY = now.getFullYear(), todayM = now.getMonth(), todayD = now.getDate();
  const monthName = currentMonth.toLocaleString('default', { month: 'long' });
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div style={{ padding: '24px', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      <style>{calendarStyles}</style>

      {/* Portal Tooltip */}
      <HoverBriefTooltip
        tooltip={tooltip}
        synopsisCache={synopsisCache}
        synopsisLoading={synopsisLoading}
        onGenerate={handleGenerateSynopsis}
        onMouseEnter={cancelHide}
        onMouseLeave={startHide}
      />

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '6px' }}>Legal Calendar Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Tickler Engine tracking deadlines, appearances, and scheduled legal events.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--bg-dark-panel, #171c26)', border: '1px solid var(--border-dark-subtle, #2C3241)', padding: '6px 14px', borderRadius: '8px' }}>
          <button onClick={handlePrevMonth} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center' }}>◀</button>
          <span style={{ fontSize: '15px', fontWeight: '600', minWidth: '130px', textAlign: 'center', userSelect: 'none' }}>
            {monthName} {currentMonth.getFullYear()}
          </span>
          <button onClick={handleNextMonth} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center' }}>▶</button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', border: '3px solid rgba(255,255,255,0.06)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'cal-spin 1s linear infinite' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading events…</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ color: '#EF4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', padding: '16px', borderRadius: '8px', fontSize: '14px', marginBottom: '24px' }}>
          ⚠️ <strong>Failed to load calendar:</strong> {error}
        </div>
      )}

      {/* ── Calendar Grid ── */}
      {!loading && !error && (
        <div key={gridKey} className="animate-fade">
          {/* Weekday headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', marginBottom: '4px' }}>
            {weekDays.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: '12px', fontWeight: '700', color: 'var(--text-dark-muted, #8F9CAE)', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '8px 0' }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
            {paddingCells.map((_, i) => <div key={`pad-${i}`} className="calendar-grid-cell padding-cell" />)}

            {dayCells.map(day => {
              const dayEvents = getEventsForDay(day);
              const isToday = currentMonth.getFullYear() === todayY
                && currentMonth.getMonth() === todayM
                && day === todayD;

              return (
                <div
                  key={`day-${day}`}
                  className={`calendar-grid-cell${isToday ? ' today-cell' : ''}`}
                  onClick={() => handleDayClick(day)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '14px', fontWeight: '700', color: isToday ? '#3B82F6' : 'var(--text-dark-primary, #FFFFFF)' }}>
                      {day}
                    </span>
                    {isToday && (
                      <span style={{ fontSize: '7.5px', fontWeight: '800', color: '#3B82F6', background: 'rgba(59,130,246,0.12)', padding: '1px 4px', borderRadius: '3px', letterSpacing: '0.4px' }}>
                        TODAY
                      </span>
                    )}
                  </div>

                  {/* Event pills */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', marginTop: '6px' }}>
                    {dayEvents.slice(0, 3).map(ev => {
                      const acc = getEventAccent(ev.event_type);
                      return (
                        <div
                          key={ev.id}
                          style={{
                            fontSize: '9px', fontWeight: '600', color: acc.text,
                            backgroundColor: acc.bg,
                            borderLeft: `2.5px solid ${acc.border}`,
                            padding: '2px 5px', borderRadius: '2px',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            cursor: 'default',
                          }}
                          onMouseEnter={e => {
                            e.stopPropagation();
                            showTooltip(e.currentTarget.getBoundingClientRect(), ev);
                          }}
                          onMouseLeave={e => { e.stopPropagation(); startHide(); }}
                        >
                          {ev.title}
                        </div>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <div style={{ fontSize: '9px', color: 'var(--accent-primary)', textAlign: 'right', fontWeight: '600' }}>
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Schedule Event Modal ── */}
      {isModalOpen && selectedDate && (
        <div
          onClick={closeModal}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(5,5,8,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, animation: 'cal-fade 0.2s ease-out' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="animate-scale"
            style={{ width: '480px', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--bg-dark-panel, #171c26)', border: '1px solid var(--border-dark-subtle, #2C3241)', borderRadius: '12px', padding: '24px', boxShadow: '0 24px 48px -8px rgba(0,0,0,0.6)' }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-dark-subtle, #2C3241)', paddingBottom: '14px', marginBottom: '20px' }}>
              <span style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>📅 Schedule Event</span>
              <button onClick={closeModal} style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>✕</button>
            </div>

            {/* Date chip */}
            <div style={{ marginBottom: '18px', padding: '10px 14px', background: 'rgba(59,130,246,0.06)', borderRadius: '7px', border: '1px solid rgba(59,130,246,0.18)' }}>
              <span style={{ fontSize: '10.5px', textTransform: 'uppercase', color: 'var(--text-dark-muted)', display: 'block', marginBottom: '2px', letterSpacing: '0.5px' }}>Target Date</span>
              <strong style={{ fontSize: '14px', color: '#3B82F6' }}>
                {selectedDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </strong>
            </div>

            <form onSubmit={handleAddEventSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Title */}
              <div>
                <label className="cal-label">Event Title *</label>
                <input type="text" required className="cal-input" placeholder="e.g. Bail application deadline" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
              </div>

              {/* Type + Case ID */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="cal-label">Event Type</label>
                  <select value={newType} onChange={e => setNewType(e.target.value)} className="cal-input" style={{ backgroundColor: '#171c26' }}>
                    <option value="task">Task / Internal</option>
                    <option value="tickler">Tickler Alert</option>
                    <option value="appearance">Court Appearance</option>
                    <option value="drop_dead">Drop Dead Deadline</option>
                  </select>
                </div>
                <div>
                  <label className="cal-label">Related Case ID</label>
                  <input type="text" className="cal-input" placeholder="e.g. 101" value={newCaseId} onChange={e => setNewCaseId(e.target.value)} />
                </div>
              </div>

              {/* Location */}
              <div>
                <label className="cal-label">Location / Court</label>
                <input type="text" className="cal-input" placeholder="e.g. Delhi High Court, Court Room 7" value={newLocation} onChange={e => setNewLocation(e.target.value)} />
              </div>

              {/* Opposing Counsel */}
              <div>
                <label className="cal-label">Opposing Counsel</label>
                <input type="text" className="cal-input" placeholder="e.g. Adv. Rajesh Kumar, Singh & Co." value={newOpposingCounsel} onChange={e => setNewOpposingCounsel(e.target.value)} />
              </div>

              {/* Type legend */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                {[['drop_dead', 'Deadline'], ['appearance', 'Hearing'], ['task', 'Task']].map(([t, lbl]) => {
                  const a = getEventAccent(t);
                  return (
                    <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', color: a.text }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: a.border }} />
                      {lbl}
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
                <button type="button" onClick={closeModal} style={{ padding: '8px 16px', fontSize: '12px', borderRadius: '6px', border: '1px solid var(--border-dark-subtle, #2C3241)', background: 'transparent', color: 'white', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving || !newTitle.trim()}
                  style={{ padding: '8px 18px', fontSize: '12px', fontWeight: '600', borderRadius: '6px', border: 'none', background: '#3B82F6', color: 'white', cursor: modalSaving ? 'not-allowed' : 'pointer', opacity: modalSaving ? 0.65 : 1 }}
                >
                  {modalSaving ? 'Saving…' : 'Add Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
