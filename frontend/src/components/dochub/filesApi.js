// Network layer for the paper-to-digital tabs (To file, Scan & file, Paper files, Bundles).
// Same rules as api.js: every call goes through the app's patched fetch, so cookies, CSRF and silent refresh just work.
import { ApiError, BASE, call, download, qs, raw, saveBlob } from './api.js';

const J = (method, json) => ({ method, json });
const F = '/files';

async function blobOf(path, opts) {
  const res = await raw(`${BASE}${path}`, opts);
  return res.blob();
}

export const fx = {
  summary: () => call(`${F}/summary`),
  cases: (q, extra = {}) => call(`${F}/cases${qs({ q, ...extra })}`).then((d) => d.cases || []),
  caseSummary: (ref) => call(`${F}/case-summary${qs({ case_ref: ref })}`),

  // ── auto-filing queue ────────────────────────────────────────────────────────────────
  filing: (state, page = 1, per_page = 25, signal) => call(`${F}/filing${qs({ state, page, per_page })}`, { signal }),
  fileConfirm: (docId, caseRef) => call(`${F}/filing/${docId}/confirm`, J('POST', caseRef ? { case_ref: caseRef } : {})),
  fileDismiss: (docId) => call(`${F}/filing/${docId}/dismiss`, J('POST', {})),
  fileReopen: (docId) => call(`${F}/filing/${docId}/reopen`, J('POST', {})),
  fileUndo: (docId) => call(`${F}/filing/${docId}/undo`, J('POST', {})),
  fileAllConfident: () => call(`${F}/filing/confirm-all`, J('POST', { mode: 'confident' })),
  fileAll: (ids) => call(`${F}/filing/confirm-all`, J('POST', { doc_ids: ids })),
  filingSettings: () => call(`${F}/filing/settings`),
  setAutoFile: (on) => call(`${F}/filing/settings`, J('PUT', { auto_file: !!on })),
  rescan: () => call(`${F}/filing/rescan`, J('POST', {})),

  // ── paper register ───────────────────────────────────────────────────────────────────
  paperSummary: () => call(`${F}/paper/summary`),
  paperList: (params, signal) => call(`${F}/paper${qs(params)}`, { signal }),
  paperGet: (id) => call(`${F}/paper/${id}`),
  paperLookup: (code) => call(`${F}/paper/lookup${qs({ code })}`),
  paperCreate: (body) => call(`${F}/paper`, J('POST', body)),
  paperEdit: (id, body) => call(`${F}/paper/${id}`, J('PATCH', body)),
  paperAct: (id, action, body = {}) => call(`${F}/paper/${id}/${action}`, J('POST', body)),
  paperLink: (id, docIds) => call(`${F}/paper/${id}/docs`, J('POST', { doc_ids: docIds })),
  paperUnlink: (id, docId) => call(`${F}/paper/${id}/docs/${docId}`, { method: 'DELETE' }),
  paperCsv: (params) => download(`${F}/paper/export.csv${qs(params)}`, 'paper-files.csv'),
  labels: async (ids, layout, cut) => {
    const blob = await blobOf(`${F}/paper/labels.pdf`, J('POST', { ids, layout, cut_marks: !!cut, base: window.location.origin }));
    return blob;
  },
  labelOne: (id) => blobOf(`${F}/paper/${id}/label.pdf${qs({ layout: 'roll' })}`),
  locations: () => call(`${F}/locations`),
  locationAdd: (body) => call(`${F}/locations`, J('POST', body)),
  locationEdit: (id, body) => call(`${F}/locations/${id}`, J('PATCH', body)),
  locationDelete: (id) => call(`${F}/locations/${id}`, { method: 'DELETE' }),

  // ── bundles ──────────────────────────────────────────────────────────────────────────
  bundles: (caseRef) => call(`${F}/bundles${qs({ case_ref: caseRef })}`),
  bundleCreate: (body) => call(`${F}/bundles`, J('POST', body)),
  bundle: (id, signal) => call(`${F}/bundles/${id}`, { signal }),
  bundleEdit: (id, body) => call(`${F}/bundles/${id}`, J('PATCH', body)),
  bundleDelete: (id) => call(`${F}/bundles/${id}`, { method: 'DELETE' }),
  bundleDuplicate: (id) => call(`${F}/bundles/${id}/duplicate`, J('POST', {})),
  bundleAdd: (id, body) => call(`${F}/bundles/${id}/items`, J('POST', body)),
  bundleItem: (id, itemId, body) => call(`${F}/bundles/${id}/items/${itemId}`, J('PATCH', body)),
  bundleRemoveItem: (id, itemId) => call(`${F}/bundles/${id}/items/${itemId}`, { method: 'DELETE' }),
  bundleOrder: (id, itemIds) => call(`${F}/bundles/${id}/order`, J('PUT', { item_ids: itemIds })),
  bundleAutoOrder: (id, by) => call(`${F}/bundles/${id}/auto-order`, J('POST', { by })),
  bundleBuild: (id) => call(`${F}/bundles/${id}/build`, J('POST', {})),
  bundleDownload: (id, fallback) => download(`${F}/bundles/${id}/download`, fallback || 'bundle.pdf'),
  bundlePdf: (id) => blobOf(`${F}/bundles/${id}/download${qs({ inline: 1 })}`),
  bundleSave: (id, body) => call(`${F}/bundles/${id}/save`, J('POST', body)),

  // ── scan studio ──────────────────────────────────────────────────────────────────────
  scans: () => call(`${F}/scan`),
  scanCreate: (body) => call(`${F}/scan`, J('POST', body || {})),
  scan: (sid, signal) => call(`${F}/scan/${sid}`, { signal }),
  scanDelete: (sid) => call(`${F}/scan/${sid}`, { method: 'DELETE' }),
  scanUpload: (sid, file, signal) => {
    const fd = new FormData();
    fd.append('file', file, file.name || 'page.jpg');
    return raw(`${BASE}${F}/scan/${sid}/pages`, { method: 'POST', body: fd, signal }).then((r) => r.json());
  },
  scanPageImg: (sid, pid, kind, v) => blobOf(`${F}/scan/${sid}/pages/${pid}/${kind}${qs({ v })}`),
  scanPageText: (sid, pid) => call(`${F}/scan/${sid}/pages/${pid}/text`),
  scanRotate: (sid, pid, deg) => call(`${F}/scan/${sid}/pages/${pid}/rotate`, J('POST', { deg })),
  scanRetry: (sid, pid) => call(`${F}/scan/${sid}/pages/${pid}/retry`, J('POST', {})),
  scanDeletePage: (sid, pid) => call(`${F}/scan/${sid}/pages/${pid}`, { method: 'DELETE' }),
  scanLayout: (sid, layout, defaults) => call(`${F}/scan/${sid}/layout`, J('PUT', { layout, defaults })),
  scanSuggest: (sid, pageIds) => call(`${F}/scan/${sid}/suggest`, J('POST', pageIds ? { page_ids: pageIds } : {})),
  scanFinalize: (sid, body) => call(`${F}/scan/${sid}/finalize`, J('POST', body)),
  separatorPdf: (count) => blobOf(`${F}/scan/separator.pdf${qs({ count })}`),
};

export { ApiError, saveBlob };

// Open a PDF blob in a new tab; fall back to a download when the browser blocks the pop-up.
export function openPdf(blob, name) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) saveBlob(blob, name || 'document.pdf');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
