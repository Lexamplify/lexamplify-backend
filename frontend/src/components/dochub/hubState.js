// URL <-> filters. Everything the person chose lives in the address bar, so a search or a filtered view can be
// bookmarked, shared with a colleague, and survives a reload or the Back button.
export const VIEWS = ['library', 'tofile', 'scan', 'paper', 'bundles', 'review', 'problems', 'duplicates', 'trash'];
export const FILE_VIEWS = ['tofile', 'scan', 'paper', 'bundles'];
export const PER_PAGE = 30;

const MAP = {
  q: 'q', folder: 'folder', cls: 'type', status: 'status', kind: 'kind', matter: 'matter', from: 'from', to: 'to',
  addedFrom: 'af', addedTo: 'at', lpmsCase: 'lpms_case', review: 'review', problems: 'problems', hold: 'hold', batch: 'batch', sort: 'sort', page: 'page',
};

export function readFilters(sp) {
  const f = {};
  Object.entries(MAP).forEach(([k, param]) => { f[k] = sp.get(param) || ''; });
  f.page = Math.max(1, parseInt(f.page, 10) || 1);
  return f;
}

export function readView(sp) {
  const v = sp.get('view');
  if (VIEWS.includes(v)) return v;
  // links from a QR label, a scan or a bundle open their own tab even without ?view=
  if (sp.get('pf')) return 'paper';
  if (sp.get('scan')) return 'scan';
  if (sp.get('bundle')) return 'bundles';
  return 'library';
}

// patch: {filterKey: value | ''}. Any filter change goes back to page 1 unless the patch says otherwise.
export function applyPatch(sp, patch) {
  const next = new URLSearchParams(sp);
  Object.entries(patch).forEach(([k, v]) => {
    const param = MAP[k] || k;
    if (v === '' || v === null || v === undefined || v === false || (k === 'page' && Number(v) <= 1)) next.delete(param);
    else next.set(param, String(v));
  });
  if (!('page' in patch)) next.delete('page');
  return next;
}

export const FILTER_KEYS = ['folder', 'cls', 'status', 'kind', 'matter', 'from', 'to', 'addedFrom', 'addedTo', 'review', 'problems', 'hold', 'batch', 'lpmsCase'];

export function apiParams(f, view, perPage = PER_PAGE) {
  const p = {
    q: f.q, class: f.cls, status: f.status, kind: f.kind, matter_id: f.matter, date_from: f.from, date_to: f.to,
    added_from: f.addedFrom, added_to: f.addedTo, legal_hold: f.hold, batch_id: f.batch, lpms_case_id: f.lpmsCase, per_page: perPage,
  };
  const sort = f.sort && (f.sort !== 'relevance' || f.q) ? f.sort : (f.q ? 'relevance' : 'newest');
  p.sort = sort;
  if (f.folder) {
    p.folder_id = f.folder;
    if (f.folder !== 'none') p.subfolders = true;
  }
  if (view === 'review' || f.review) p.needs_review = true;
  if (view === 'problems' || f.problems) p.problems = true;
  return p;
}

// everything except the page number: when this changes, selection and facets are stale
export function filterSignature(f, view) {
  const { page, ...rest } = f; // eslint-disable-line no-unused-vars
  return JSON.stringify([view, rest]);
}

export function activeFilterCount(f, view) {
  let n = 0;
  ['folder', 'cls', 'status', 'kind', 'matter', 'hold', 'batch', 'lpmsCase'].forEach((k) => { if (f[k]) n += 1; });
  if (f.from || f.to) n += 1;
  if (f.addedFrom || f.addedTo) n += 1;
  if (view === 'library') { if (f.review) n += 1; if (f.problems) n += 1; }
  return n;
}
