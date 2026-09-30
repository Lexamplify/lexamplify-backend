// Network layer for the Document Hub. Every call goes through the app's patched global fetch
// (cookies + CSRF + silent token refresh), so nothing here touches tokens.

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const BASE = `${API_BASE}/api/dms`;

export class ApiError extends Error {
  constructor(message, status = 0, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false) return;
    p.set(k, v === true ? '1' : String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function raw(url, { method = 'GET', json, body, signal } = {}) {
  const init = { method, signal, headers: {} };
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (body) {
    init.body = body;
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  if (!res.ok) {
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    const fallback = res.status === 401 ? 'Your session has expired. Please sign in again.'
      : res.status === 429 ? 'Too many requests just now. Please wait a moment.'
      : res.status >= 500 ? 'The server had a problem. Please try again.'
      : `Something went wrong (${res.status}).`;
    throw new ApiError(data.message || fallback, res.status, data);
  }
  return res;
}

const call = async (path, opts) => (await raw(`${BASE}${path}`, opts)).json();

function filenameFrom(res, fallback) {
  const cd = res.headers.get('Content-Disposition') || '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1] : fallback;
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function download(path, fallbackName, opts) {
  const res = await raw(`${BASE}${path}`, opts);
  const blob = await res.blob();
  saveBlob(blob, filenameFrom(res, fallbackName));
}

export const dh = {
  config: () => call('/config'),
  stats: () => call('/stats'),
  matters: () => call('/matters').then((d) => d.matters || []),
  list: (params, signal) => call(`/docs${qs(params)}`, { signal }),
  ids: (params, signal) => call(`/ids${qs(params)}`, { signal }),
  get: (id, signal) => call(`/docs/${id}`, { signal }).then((d) => d.doc),
  hits: (id, q, signal) => call(`/docs/${id}/hits${qs({ q })}`, { signal }),
  text: (id, from = 1, count = 8, signal) => call(`/docs/${id}/text${qs({ from, count })}`, { signal }),
  patch: (id, body) => call(`/docs/${id}`, { method: 'PATCH', json: body }),
  reprocess: (id) => call(`/docs/${id}/reprocess`, { method: 'POST' }),
  trash: (id) => call(`/docs/${id}`, { method: 'DELETE' }),
  restore: (id) => call(`/docs/${id}/restore`, { method: 'POST' }),
  purge: (id) => call(`/docs/${id}/purge`, { method: 'DELETE' }),
  promote: (id) => call(`/docs/${id}/promote`, { method: 'POST' }),
  trashList: (page = 1) => call(`/trash${qs({ page })}`),
  emptyTrash: () => call('/trash/empty', { method: 'POST' }),
  bulk: (ids, action, extra = {}) => call('/bulk', { method: 'POST', json: { ids, action, ...extra } }),
  queue: (kind, page = 1, per_page = 60) => call(`/queue${qs({ kind, page, per_page })}`),
  duplicates: () => call('/duplicates'),
  batch: (id) => call(`/batches/${encodeURIComponent(id)}`),
  adopt: (limit = 60) => call('/adopt', { method: 'POST', json: { limit } }),

  upload(file, { folderId, matterId, batchId, relPath, force } = {}, signal) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (folderId) fd.append('folder_id', folderId);
    if (matterId) fd.append('matter_id', matterId);
    if (batchId) fd.append('batch_id', batchId);
    if (relPath) fd.append('rel_path', relPath);
    if (force) fd.append('force', '1');
    return raw(`${BASE}/upload`, { method: 'POST', body: fd, signal }).then((r) => r.json());
  },
  newVersion(id, file, note) {
    const fd = new FormData();
    fd.append('file', file, file.name);
    if (note) fd.append('note', note);
    return raw(`${BASE}/docs/${id}/versions`, { method: 'POST', body: fd }).then((r) => r.json());
  },

  pageBlob: async (id, page, width, terms, signal) => {
    const res = await raw(`${BASE}/docs/${id}/page/${page}${qs({ w: width, terms: (terms || []).join(' ') })}`, { signal });
    return res.blob();
  },
  download: (id, name) => download(`/docs/${id}/download`, name || 'document'),
  fileBlob: async (id) => (await raw(`${BASE}/docs/${id}/file`)).blob(),
  exportCsv: (params) => download(`/export.csv${qs(params)}`, 'document-inventory.csv'),
  zip: (ids) => download('/download-zip', 'documents.zip', { method: 'POST', json: { ids } }),

  // folders live in the existing Case Vault API - one folder tree for the whole product
  folders: async () => {
    const res = await raw(`${API_BASE}/api/vault/folders`);
    const d = await res.json();
    return { tree: d.folders || [], flat: d.flat || [] };
  },
  createFolder: async (name, parentId = null) => {
    const res = await raw(`${API_BASE}/api/vault/folders`, { method: 'POST', json: { name, parent_id: parentId } });
    return res.json();
  },
  initBlueprint: async () => (await raw(`${API_BASE}/api/vault/folders/init-blueprint`, { method: 'POST' })).json(),
};
