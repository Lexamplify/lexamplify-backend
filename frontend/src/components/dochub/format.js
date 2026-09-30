// Small pure helpers shared by the Document Hub screens.

export function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function fmtNum(n) {
  return (n ?? 0).toLocaleString('en-IN');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2025-03-14" -> "14 Mar 2025" (dates are calendar dates, never shifted by time zone)
export function fmtDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// Server timestamps are UTC "YYYY-MM-DD HH:MM:SS".
export function parseServerTime(s) {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtAgo(s) {
  const d = parseServerTime(s);
  if (!d) return '';
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  if (sec < 86400 * 7) return `${Math.round(sec / 86400)} d ago`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
}

export function plural(n, one, many) {
  return `${fmtNum(n)} ${n === 1 ? one : (many || one + 's')}`;
}

// Search snippets mark hits with \x02 ... \x03 (never HTML). Returns [{text, hit}] so React can render <mark>.
export function splitHighlights(snippet) {
  if (!snippet) return [];
  const out = [];
  let hit = false;
  let buf = '';
  for (const ch of snippet) {
    if (ch === '\x02' || ch === '\x03') {
      if (buf) out.push({ text: buf, hit });
      buf = '';
      hit = ch === '\x02';
    } else {
      buf += ch;
    }
  }
  if (buf) out.push({ text: buf, hit });
  return out;
}

// Highlight plain text against a list of words (used for the extracted-text view).
export function highlightWords(text, words) {
  const ws = (words || []).filter((w) => w && w.length > 1).slice(0, 12);
  if (!text || !ws.length) return [{ text: text || '', hit: false }];
  const esc = ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${esc.join('|')})`, 'gi');
  return text.split(re).map((part, i) => ({ text: part, hit: i % 2 === 1 })).filter((p) => p.text);
}

export const STATUS = {
  queued: { label: 'Waiting', tone: 'busy', hint: 'Waiting for its turn to be read.' },
  processing: { label: 'Reading', tone: 'busy', hint: 'Being read and indexed right now.' },
  ready: { label: 'Ready', tone: 'ok', hint: 'Read, indexed and searchable.' },
  ready_partial: { label: 'Partly read', tone: 'warn', hint: 'Some pages could not be read.' },
  needs_ocr: { label: 'Needs OCR', tone: 'warn', hint: 'Scanned pages that need the OCR engine.' },
  empty: { label: 'No text', tone: 'warn', hint: 'No readable text was found.' },
  unsupported: { label: "Can't read", tone: 'warn', hint: "This kind of file can't be read here." },
  failed: { label: 'Failed', tone: 'bad', hint: 'The file could not be read.' },
};

export const PROBLEM_STATUSES = ['failed', 'needs_ocr', 'ready_partial', 'empty', 'unsupported'];

export const KIND_LABEL = {
  pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', image: 'Image', text: 'Text', html: 'Web page',
  eml: 'E-mail', rtf: 'Rich text', legacy: 'Old Office', media: 'Audio / video', archive: 'Archive', other: 'Other',
};

export function fileBadge(doc) {
  const e = (doc.ext || '').toLowerCase();
  if (e === 'pdf') return 'PDF';
  if (['docx', 'doc', 'rtf'].includes(e)) return 'DOC';
  if (['xlsx', 'xls', 'csv'].includes(e)) return 'XLS';
  if (['pptx', 'ppt'].includes(e)) return 'PPT';
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'].includes(e)) return 'IMG';
  if (['eml', 'msg'].includes(e)) return 'MAIL';
  if (['txt', 'md', 'html', 'htm'].includes(e)) return 'TXT';
  return (e || 'FILE').slice(0, 4).toUpperCase();
}

// Sort options offered in the toolbar. `needsQuery` ones are hidden when there is nothing being searched.
export const SORTS = [
  { id: 'relevance', label: 'Best match', needsQuery: true },
  { id: 'newest', label: 'Recently added' },
  { id: 'doc_date', label: 'Document date (newest)' },
  { id: 'hearing', label: 'Next hearing (soonest)' },
  { id: 'name', label: 'Title A–Z' },
  { id: 'size', label: 'Largest file' },
  { id: 'pages', label: 'Most pages' },
  { id: 'oldest', label: 'Oldest added' },
];
