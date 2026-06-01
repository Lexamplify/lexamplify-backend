import React, { useState, useEffect } from 'react';

const calendarStyles = `
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.96) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .animate-fade {
    animation: fadeIn 0.25s ease-out forwards;
  }
  .animate-scale {
    animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
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
  .calendar-grid-cell.active-selected {
    border-color: var(--accent-primary, #3B82F6);
    background-color: rgba(59, 130, 246, 0.05);
    box-shadow: inset 0 0 0 1px var(--accent-primary, #3B82F6);
  }
  .calendar-grid-cell.padding-cell {
    background-color: transparent;
    border-color: transparent;
    cursor: default;
    pointer-events: none;
  }
`;

export default function CalendarView() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date(2026, 5, 1)); // Default: June 2026
  const [gridKey, setGridKey] = useState(0); // Trigger transition key

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('task');
  const [newCaseId, setNewCaseId] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

  // Fetch logic
  const loadEvents = async () => {
    try {
      const response = await fetch('http://127.0.0.1:5000/api/calendar/events');
      if (!response.ok) {
        throw new Error(`HTTP error: status ${response.status}`);
      }
      const data = await response.json();
      setEvents(data.events || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to fetch calendar events.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  // Date math
  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    return { firstDayIndex, totalDays };
  };

  const { firstDayIndex, totalDays } = getDaysInMonth(currentMonth);
  const paddingCells = Array.from({ length: firstDayIndex });
  const dayCells = Array.from({ length: totalDays }, (_, i) => i + 1);

  const getEventsForDay = (day) => {
    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const formattedDate = `${year}-${month}-${dayStr}`;
    return events.filter(e => e.event_date === formattedDate);
  };

  const handlePrevMonth = () => {
    setGridKey(prev => prev + 1);
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setGridKey(prev => prev + 1);
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleDayClick = (day) => {
    const targetDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    setSelectedDate(targetDate);
    setIsModalOpen(true);
  };

  const handleAddEventSubmit = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    setModalSaving(true);
    try {
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;

      const payload = {
        events: [
          {
            event_date: formattedDate,
            event_type: newType,
            title: newTitle.trim(),
            related_case_id: newCaseId.trim()
          }
        ]
      };

      const response = await fetch('http://127.0.0.1:5000/api/calendar/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        await loadEvents();
        setIsModalOpen(false);
        setNewTitle('');
        setNewType('task');
        setNewCaseId('');
      } else {
        alert('Failed to save proposed calendar event.');
      }
    } catch (err) {
      console.error(err);
      alert('Error connecting to database to save event.');
    } finally {
      setModalSaving(false);
    }
  };

  const monthName = currentMonth.toLocaleString('default', { month: 'long' });
  const yearName = currentMonth.getFullYear();

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div style={{ padding: '24px', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      <style>{calendarStyles}</style>

      {/* Header controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '6px' }}>Legal Calendar Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Tickler Engine tracking deadlines, appearances, and scheduled legal events.
          </p>
        </div>

        {/* Month Selector Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--bg-dark-panel, #171c26)', border: '1px solid var(--border-dark-subtle, #2C3241)', padding: '6px 14px', borderRadius: '8px' }}>
          <button 
            onClick={handlePrevMonth}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
            title="Previous Month"
          >
            ◀
          </button>
          <span style={{ fontSize: '15px', fontWeight: '600', minWidth: '130px', textAlign: 'center', userSelect: 'none' }}>
            {monthName} {yearName}
          </span>
          <button 
            onClick={handleNextMonth}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}
            title="Next Month"
          >
            ▶
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', border: '3px solid var(--border-subtle)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading events...</span>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--accent-danger)', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '16px', borderRadius: '8px', fontSize: '14px', marginBottom: '24px' }}>
          ⚠️ <strong>Failed to load calendar:</strong> {error}
        </div>
      )}

      {!loading && !error && (
        <div key={gridKey} className="animate-fade" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {/* Weekday headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', marginBottom: '4px' }}>
            {weekDays.map(day => (
              <div key={day} style={{ textAlign: 'center', fontSize: '12px', fontWeight: '700', color: 'var(--text-dark-muted, #8F9CAE)', textTransform: 'uppercase', letterSpacing: '0.8px', padding: '8px 0' }}>
                {day}
              </div>
            ))}
          </div>

          {/* Month grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
            {paddingCells.map((_, idx) => (
              <div key={`pad-${idx}`} className="calendar-grid-cell padding-cell" />
            ))}

            {dayCells.map(day => {
              const dayEvents = getEventsForDay(day);
              return (
                <div 
                  key={`day-${day}`} 
                  className="calendar-grid-cell"
                  onClick={() => handleDayClick(day)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-dark-primary, #FFFFFF)' }}>
                      {day}
                    </span>
                  </div>

                  {/* Minimal Event Indicator accents */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', marginTop: '6px' }}>
                    {dayEvents.slice(0, 3).map((event) => {
                      let tagColor = '#8F9CAE';
                      if (event.event_type === 'drop_dead') tagColor = '#EF4444';
                      else if (event.event_type === 'tickler') tagColor = '#F59E0B';
                      else if (event.event_type === 'appearance') tagColor = '#3B82F6';
                      else if (event.event_type === 'task') tagColor = '#10B981';

                      return (
                        <div 
                          key={event.id}
                          style={{
                            fontSize: '9px',
                            fontWeight: '600',
                            color: 'white',
                            backgroundColor: 'rgba(255,255,255,0.04)',
                            borderLeft: `2px solid ${tagColor}`,
                            padding: '1px 4px',
                            borderRadius: '2px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={event.title}
                        >
                          {event.title}
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

      {/* Sleek Centered Modal Overlay */}
      {isModalOpen && selectedDate && (
        <div 
          onClick={() => setIsModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(5, 5, 8, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            animation: 'fadeIn 0.2s ease-out forwards'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="animate-scale"
            style={{
              width: '450px',
              backgroundColor: 'var(--bg-dark-panel, #171c26)',
              border: '1px solid var(--border-dark-subtle, #2C3241)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-dark-subtle, #2C3241)', paddingBottom: '12px', marginBottom: '20px' }}>
              <span style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>
                📅 Schedule Event
              </span>
              <button 
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted, #8F9CAE)', cursor: 'pointer', fontSize: '16px' }}
              >
                ✕
              </button>
            </div>

            {/* Selected Date Indicator */}
            <div style={{ marginBottom: '16px', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '6px', border: '1px solid var(--border-dark-subtle, #2C3241)' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-dark-muted, #8F9CAE)', display: 'block', marginBottom: '2px' }}>
                Selected Target Date
              </span>
              <strong style={{ fontSize: '14px', color: 'var(--accent-primary, #3B82F6)' }}>
                {selectedDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </strong>
            </div>

            {/* Event Form */}
            <form onSubmit={handleAddEventSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-dark-muted, #8F9CAE)', display: 'block', marginBottom: '6px' }}>
                  Event Title
                </label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. Flight to Delhi or Bail application deadline"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-dark-subtle, #2C3241)',
                    backgroundColor: 'rgba(255, 255, 255, 0.01)',
                    color: 'white',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-dark-muted, #8F9CAE)', display: 'block', marginBottom: '6px' }}>
                    Event Type
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-dark-subtle, #2C3241)',
                      backgroundColor: '#171c26',
                      color: 'white',
                      outline: 'none'
                    }}
                  >
                    <option value="task">Task</option>
                    <option value="tickler">Tickler Alert</option>
                    <option value="appearance">Court Appearance</option>
                    <option value="drop_dead">Drop Dead Deadline</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-dark-muted, #8F9CAE)', display: 'block', marginBottom: '6px' }}>
                    Related Case ID
                  </label>
                  <input 
                    type="text"
                    placeholder="e.g. 101"
                    value={newCaseId}
                    onChange={(e) => setNewCaseId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '13px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-dark-subtle, #2C3241)',
                      backgroundColor: 'rgba(255, 255, 255, 0.01)',
                      color: 'white',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-dark-subtle, #2C3241)',
                    background: 'transparent',
                    color: 'white',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving || !newTitle.trim()}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'var(--accent-primary, #3B82F6)',
                    color: 'white',
                    cursor: modalSaving ? 'not-allowed' : 'pointer',
                    opacity: modalSaving ? 0.7 : 1
                  }}
                >
                  {modalSaving ? 'Saving...' : 'Add Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
