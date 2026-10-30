import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TONE_RANK = { risk: 3, warn: 2, ok: 1, muted: 0 };

// Map a legal event_type onto the luxury tone vocabulary (risk / warn / ok / muted).
function toneForType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'deadline' || t === 'drop_dead' || t.includes('limitation') || t === 'tickler') return 'risk';
  if (t === 'hearing' || t === 'appearance' || t.includes('hearing') || t.includes('court')) return 'warn';
  return 'muted';
}

// Parse a 'YYYY-MM-DD' or full-ISO string into a local Date (date-only, no TZ drift).
function parseDateOnly(iso) {
  if (!iso) return null;
  const parts = String(iso).slice(0, 10).split('-').map(Number);
  if (parts.length < 3 || Number.isNaN(parts[0])) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

// Pull an HH:MM out of an ISO string if a real (non-midnight) time is present.
function timeFrom(iso) {
  const str = String(iso || '');
  const ti = str.indexOf('T');
  if (ti === -1) return '';
  const hm = str.slice(ti + 1, ti + 6);
  return hm && hm !== '00:00' ? hm : '';
}

const _synopsisCache = new Map();

function AgendaItem({ it }) {
  const [open, setOpen] = useState(false);
  const [syn, setSyn] = useState(it.related_case_id ? _synopsisCache.get(it.related_case_id) || null : null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const hoverTimer = useRef(null);

  async function fetchSyn() {
    if (!it.related_case_id || syn || loading) return;
    setLoading(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/calendar/case-synopsis/${it.related_case_id}`, { credentials: 'include' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.found) throw new Error(d.error || 'No synopsis available.');
      _synopsisCache.set(it.related_case_id, d.synopsis);
      setSyn(d.synopsis);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }

  function onEnter() { if (!it.related_case_id) return; clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => { setOpen(true); fetchSyn(); }, 300); }
  function onLeave() { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setOpen(false), 150); }

  return (
    <div className="lx-item" style={{ position: 'relative' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div style={{ width: 52, textAlign: 'center', flexShrink: 0, fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 15, color: it.tone === 'risk' ? 'var(--risk)' : 'var(--ink)' }}>{it.time}</div>
      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--rule)', margin: '2px 4px' }} />
      <div className="lx-item__body">
        <div className="lx-item__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {it.title}
          {it.related_case_id && <Ic.Sparkle size={11} style={{ opacity: 0.55 }} />}
        </div>
        <div className="lx-item__meta">{it.meta}</div>
      </div>
      <span className={`lx-badge lx-badge--${it.tone}`}>{it.tone === 'risk' ? 'Deadline' : it.tone === 'warn' ? 'Hearing' : 'Listed'}</span>
      {open && it.related_case_id && (
        <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 20, marginTop: 6, width: 320, padding: 14, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,.12)' }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, marginBottom: 8 }}>Case brief</div>
          {loading ? <div className="lx-muted" style={{ fontSize: 12.5 }}>Generating synopsis…</div>
            : err ? <div className="lx-muted" style={{ fontSize: 12.5 }}>{err}</div>
            : syn ? <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{syn}</div>
            : <div className="lx-muted" style={{ fontSize: 12.5 }}>No synopsis.</div>}
        </div>
      )}
    </div>
  );
}

function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export default function Calendar() {
  const [view, setView] = useState('agenda');
  const [events, setEvents] = useState([]); // normalized unified list
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evRes, caseRes] = await Promise.all([
        fetch(`${API_BASE}/api/calendar/events`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/practice/cases?per_page=100&sort=next_hearing`, { credentials: 'include' }),
      ]);
      if (evRes.status === 401 || caseRes.status === 401) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const evData = evRes.ok ? await evRes.json().catch(() => ({})) : {};
      const caseData = caseRes.ok ? await caseRes.json().catch(() => ({})) : {};

      const rawEvents = Array.isArray(evData.events) ? evData.events
        : Array.isArray(evData) ? evData : [];
      const rawCases = Array.isArray(caseData.cases) ? caseData.cases
        : Array.isArray(caseData) ? caseData : [];

      // Normalize calendar events.
      const fromEvents = rawEvents
        .map((ev) => {
          const d = parseDateOnly(ev.event_date);
          if (!d) return null;
          const meta = [ev.location, ev.opposing_counsel].filter(Boolean).join(' · ')
            || String(ev.event_type || 'Event').replace(/_/g, ' ');
          return {
            date: d,
            time: timeFrom(ev.event_date),
            title: ev.title || 'Untitled event',
            meta,
            tone: toneForType(ev.event_type),
            type: ev.event_type || 'event',
            source: 'event',
            related_case_id: ev.related_case_id || null,
          };
        })
        .filter(Boolean);

      // A case with a next_hearing is a calendar entry (like Today.jsx treats it).
      const fromHearings = rawCases
        .filter((c) => c && !c.closed && c.next_hearing)
        .map((c) => {
          const d = parseDateOnly(c.next_hearing);
          if (!d) return null;
          const meta = [c.court, c.case_no].filter(Boolean).join(' · ') || 'Hearing';
          return {
            date: d,
            time: '',
            title: c.title || 'Matter',
            meta,
            tone: 'warn',
            type: 'hearing',
            source: 'hearing',
            related_case_id: c.id || null,
          };
        })
        .filter(Boolean);

      setEvents([...fromEvents, ...fromHearings]);
    } catch (err) {
      setError(err.message || 'Failed to load calendar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Agenda: upcoming events grouped by day ──────────────────────────────────
  const agenda = useMemo(() => {
    const today = startOfToday();
    const groups = new Map();
    for (const ev of events) {
      if (ev.date < today) continue;
      const key = `${ev.date.getFullYear()}-${ev.date.getMonth()}-${ev.date.getDate()}`;
      if (!groups.has(key)) groups.set(key, { date: ev.date, items: [] });
      groups.get(key).items.push(ev);
    }
    const sorted = [...groups.values()].sort((a, b) => a.date - b.date);
    const dayDiff = (d) => Math.round((d - today) / 86400000);
    return sorted.map((g) => {
      const diff = dayDiff(g.date);
      const label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : DOW_FULL[g.date.getDay()];
      const dateStr = `${DOW_SHORT[g.date.getDay()]} ${g.date.getDate()} ${MON_SHORT[g.date.getMonth()]}`;
      const items = g.items
        .slice()
        .sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))
        .map((it) => ({
          time: it.time || '—',
          title: it.title,
          meta: it.meta,
          tone: it.tone,
          related_case_id: it.related_case_id,
        }));
      return { key: `${g.date.getTime()}`, day: label, date: dateStr, items };
    });
  }, [events]);

  // ── Month grid for the current cursor month ─────────────────────────────────
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  const today = startOfToday();
  const todayNum = (today.getFullYear() === y && today.getMonth() === m) ? today.getDate() : null;

  // dayNum -> strongest tone for that day in the viewed month
  const monthEvents = useMemo(() => {
    const map = {};
    for (const ev of events) {
      if (ev.date.getFullYear() !== y || ev.date.getMonth() !== m) continue;
      const d = ev.date.getDate();
      if (!map[d] || TONE_RANK[ev.tone] > TONE_RANK[map[d]]) map[d] = ev.tone;
    }
    return map;
  }, [events, y, m]);

  // dayNum -> list of event items for that day in the viewed month
  const monthItems = useMemo(() => {
    const map = {};
    for (const ev of events) {
      if (ev.date.getFullYear() !== y || ev.date.getMonth() !== m) continue;
      const d = ev.date.getDate();
      if (!map[d]) map[d] = [];
      map[d].push(ev);
    }
    for (const d of Object.keys(map)) {
      map[d].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    }
    return map;
  }, [events, y, m]);

  const [hoverDay, setHoverDay] = useState(null);

  const toneColor = (tone) =>
    tone === 'risk' ? 'var(--risk)' : tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--muted-2)';

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">This week</span>
          <h1 className="ph__title">Calendar</h1>
          <p className="ph__sub">Hearings, filings and limitation — synced live from your matters.</p>
        </div>
        <div className="lx-row" style={{ gap: 10 }}>
          <div className="seg" style={{ width: 200 }}>
            {['agenda', 'month'].map((v) => <button key={v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)} style={{ textTransform: 'capitalize' }}>{v}</button>)}
          </div>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setShowNew(true)}><Ic.Plus size={14} /> Add</button>
        </div>
      </div>

      {loading ? (
        <div className="lx-card lx-card--pad">
          <div className="lx-empty"><p>Loading your calendar…</p></div>
        </div>
      ) : error ? (
        <div className="lx-card lx-card--pad">
          <div className="lx-empty"><p>{error}</p></div>
        </div>
      ) : view === 'agenda' ? (
        <div className="lx-stack" style={{ gap: 18 }}>
          {agenda.length === 0 ? (
            <div className="lx-card lx-card--pad">
              <div className="lx-empty"><p>Nothing scheduled ahead.</p></div>
            </div>
          ) : (
            agenda.map((d) => (
              <div className="lx-card lx-card--pad" key={d.key}>
                <div className="lx-between" style={{ marginBottom: 12 }}>
                  <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 18 }}>{d.day}</h3>
                  <span className="lx-muted" style={{ letterSpacing: '.04em' }}>{d.date}</span>
                </div>
                <div className="lx-list">
                  {d.items.map((it, i) => (
                    <AgendaItem key={i} it={it} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="lx-card lx-card--pad">
          <div className="lx-between" style={{ marginBottom: 16 }}>
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 20 }}>{MON_FULL[m]} {y}</h3>
            <div className="lx-row" style={{ gap: 6 }}><button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => setCursor(new Date(y, m - 1, 1))} aria-label="Previous month"><Ic.Chevron size={16} style={{ transform: 'rotate(180deg)' }} /></button><button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => setCursor(new Date(y, m + 1, 1))} aria-label="Next month"><Ic.Chevron size={16} /></button></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', padding: '4px 0', fontWeight: 600 }}>{d}</div>)}
            {cells.map((n, i) => {
              const isToday = n && n === todayNum;
              const items = n ? (monthItems[n] || []) : [];
              const hasItems = items.length > 0;
              return (
                <div key={i}
                  onMouseEnter={() => hasItems && setHoverDay(n)}
                  onMouseLeave={() => setHoverDay((cur) => (cur === n ? null : cur))}
                  style={{ aspectRatio: '1', borderRadius: 10, border: n ? '1px solid var(--rule)' : '0', padding: 7, position: 'relative', background: isToday ? 'var(--accent-soft)' : 'transparent', cursor: hasItems ? 'pointer' : 'default' }}>
                  {n && <span style={{ fontSize: 13, color: isToday ? 'var(--accent-ink)' : 'var(--ink)', fontWeight: isToday ? 700 : 400, fontFamily: 'var(--font-serif)' }}>{n}</span>}
                  {n && monthEvents[n] && <span style={{ position: 'absolute', bottom: 8, left: 8, width: 6, height: 6, borderRadius: '50%', background: toneColor(monthEvents[n]) }} />}
                  {n && items.length > 1 && <span style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>{items.length}</span>}
                  {hoverDay === n && hasItems && (
                    <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', zIndex: 30, marginBottom: 8, width: 300, maxHeight: 360, overflowY: 'auto', padding: 12, background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 12, boxShadow: '0 -8px 36px rgba(0,0,0,.15)', textAlign: 'left' }}>
                      <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, marginBottom: 8 }}>
                        {DOW_FULL[new Date(y, m, n).getDay()]} · {n} {MON_SHORT[m]} · {items.length} item{items.length === 1 ? '' : 's'}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {items.map((ev, k) => (
                          <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: toneColor(ev.tone), marginTop: 6, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {ev.time && ev.time + ' · '}{ev.meta}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showNew && <NewEventModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function NewEventModal({ onClose, onCreated }) {
  const [form, setForm] = useState(() => {
    const n = new Date();
    const iso = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
    return { title: '', event_date: iso, event_type: 'hearing', location: '' };
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.title.trim()) { setErr('An event title is required.'); return; }
    if (!form.event_date) { setErr('A date is required.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${API_BASE}/api/calendar/save`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({
          events: [{
            event_date: form.event_date,
            event_type: form.event_type,
            title: form.title.trim(),
            related_case_id: null,
            location: form.location.trim(),
            opposing_counsel: '',
          }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'Could not save the event.');
      onCreated();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const TYPES = [
    { v: 'hearing', label: 'Hearing' },
    { v: 'deadline', label: 'Deadline' },
    { v: 'meeting', label: 'Meeting' },
    { v: 'other', label: 'Other' },
  ];

  return (
    <Modal title="New event" onClose={onClose}
      footer={<><button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="lx-btn lx-btn--primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add event'}</button></>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div><label className="lbl">Title</label><input className="inp" value={form.title} onChange={set('title')} placeholder="e.g. Bail application hearing" autoFocus /></div>
      <div className="lx-row" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}><label className="lbl">Date</label><input className="inp" type="date" value={form.event_date} onChange={set('event_date')} /></div>
        <div style={{ flex: 1 }}><label className="lbl">Type</label>
          <select className="inp" value={form.event_type} onChange={set('event_type')}>
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </div>
      </div>
      <div><label className="lbl">Location <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label><input className="inp" value={form.location} onChange={set('location')} placeholder="e.g. Delhi High Court, Court Room 7" /></div>
      <div className="lx-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {TYPES.map((t) => (
          <span key={t.v} className="chip" onClick={() => setForm((f) => ({ ...f, event_type: t.v }))}
            style={form.event_type === t.v ? { background: 'var(--ink)', color: 'var(--paper)', cursor: 'pointer' } : { cursor: 'pointer' }}>{t.label}</span>
        ))}
      </div>
    </Modal>
  );
}
