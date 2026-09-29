// Names for saved drafts. The lawyer can always edit the suggestion; this only
// makes sure every save starts from a meaningful, unique-ish name instead of
// "Untitled" or the first 45 characters of the AI prompt.

const MAX_NAME = 90;

export function todayStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function tidy(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[*_`#>\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function surname(name) {
  const t = tidy(name);
  return t.length > 28 ? `${t.slice(0, 27).trim()}…` : t;
}

/**
 * dispute: catalog entry or null; facts: typed form values;
 * docText: current plain text; prompt: the free-form instruction.
 */
export function buildDraftName({ dispute, facts = {}, docText = '', prompt = '', date } = {}) {
  const stamp = todayStamp(date);
  let base = '';
  if (dispute) {
    base = tidy(dispute.title);
    const a = surname(facts.p1_name);
    const b = surname(facts.p2_name);
    if (a && b) base += ` - ${a} v ${b}`;
    else if (a) base += ` - ${a}`;
    const ref = tidy(facts.case_no || facts.fir_no || '');
    if (ref && ref.length <= 24) base += ` - ${ref}`;
  } else {
    const firstLine = String(docText || '')
      .split('\n')
      .map((l) => tidy(l))
      .find((l) => l.length >= 6);
    base = firstLine || tidy(prompt).slice(0, 60) || 'Legal draft';
    if (base.length > 60) base = `${base.slice(0, 59).trim()}…`;
  }
  let name = `${base} - ${stamp}`.replace(/\s+/g, ' ').trim();
  if (name.length > MAX_NAME) name = `${base.slice(0, MAX_NAME - stamp.length - 4).trim()}… - ${stamp}`;
  return name;
}

export function toFileName(name, ext = '') {
  const stem = String(name || 'Legal draft')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/[^\w\s.\-()&,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '_')
    .slice(0, 100) || 'Legal_draft';
  return ext ? `${stem}.${ext.replace(/^\./, '')}` : stem;
}
