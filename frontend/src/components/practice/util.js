// Date and text helpers for Practice. Hearing dates are calendar dates in India time, never shifted by the browser's zone.
const IST_MIN = 330;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export { MONTHS, MONTHS_LONG, DOW };

export const istToday = () => new Date(Date.now() + IST_MIN * 60000).toISOString().slice(0, 10);

const parts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
};
const utc = (iso) => { const p = parts(iso); return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN; };

export const addDays = (iso, n) => new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
export const daysFromToday = (iso) => (iso ? daysBetween(istToday(), iso) : null);
export const dowOf = (iso) => new Date(utc(iso)).getUTCDay();
export const isoOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function fmtDay(iso) {
  const p = parts(iso);
  return p ? `${DOW[dowOf(iso)]}, ${p.d} ${MONTHS[p.m - 1]}` : '';
}
export function fmtDayLong(iso) {
  const p = parts(iso);
  return p ? `${DOW_LONG[dowOf(iso)]}, ${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}` : '';
}
export function fmtShort(iso) {
  const p = parts(iso);
  if (!p) return '';
  const cur = istToday().slice(0, 4);
  return `${p.d} ${MONTHS[p.m - 1]}${String(p.y) === cur ? '' : ` ${p.y}`}`;
}
export function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return '';
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

// -> { text, tone } for a due / hearing date. tone: bad (overdue), warn (soon), '' (later)
export function relDay(iso, { past = 'overdue' } = {}) {
  const n = daysFromToday(iso);
  if (n === null || Number.isNaN(n)) return { text: '', tone: '' };
  if (n === 0) return { text: 'Today', tone: 'warn' };
  if (n === 1) return { text: 'Tomorrow', tone: 'warn' };
  if (n === -1) return { text: past === 'overdue' ? 'Yesterday' : 'Yesterday', tone: past === 'overdue' ? 'bad' : '' };
  if (n < 0) return { text: `${-n} days ago`, tone: past === 'overdue' ? 'bad' : '' };
  if (n <= 3) return { text: `In ${n} days`, tone: 'warn' };
  if (n < 14) return { text: `In ${n} days`, tone: '' };
  if (n < 60) return { text: `In ${Math.round(n / 7)} weeks`, tone: '' };
  return { text: `In ${Math.round(n / 30)} months`, tone: '' };
}

export const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
export const human = (s) => cap(String(s || '').replace(/_/g, ' '));

export const CLOSED = ['Disposed', 'Withdrawn', 'Settled'];
export const STATUS_TONE = { Active: 'good', 'Awaiting Orders': 'warn', Stayed: 'warn', Disposed: 'dim', Withdrawn: 'dim', Settled: 'dim' };

// Dates the next-hearing shortcut buttons offer, skipping Sundays.
export function nextDateOptions(from) {
  const base = from || istToday();
  const skip = (iso) => (dowOf(iso) === 0 ? addDays(iso, 1) : iso);
  return [
    { label: '+1 week', date: skip(addDays(base, 7)) },
    { label: '+2 weeks', date: skip(addDays(base, 14)) },
    { label: '+1 month', date: skip(addDays(base, 30)) },
    { label: '+2 months', date: skip(addDays(base, 60)) },
  ];
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
export const emptyToNull = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === '' ? null : v]));

// "2026-10-02 10:07:00" (stored in UTC) -> "2 Oct, 3:37 pm" in the viewer's own time zone.
export const fmtStamp = (at) => {
  if (!at) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${String(at).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(at);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
};
