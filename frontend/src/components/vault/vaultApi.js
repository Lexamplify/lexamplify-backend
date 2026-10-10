// Network layer for the Case Vault workspace (overview numbers, timeline, in-app viewer/editor, per-document AI).
// Goes through the app's patched global fetch (cookies, CSRF, silent token refresh), like the rest of the vault.
import { ApiError, saveBlob } from '../dochub/api.js';

export { ApiError, saveBlob };

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function raw(path, { method = 'GET', json, signal } = {}) {
  const init = { method, signal, credentials: 'include', headers: {} };
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
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

const json = async (path, opts) => (await raw(path, opts)).json();

function fileNameFrom(res, fallback) {
  const m = /filename="?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') || '');
  return m ? m[1] : fallback;
}

export const vaultApi = {
  overview: (signal) => json('/api/vault/overview', { signal }),
  timeline: (deep = false, signal) => json(`/api/vault/timeline${deep ? '?deep=1' : ''}`, { signal }),
  content: (id, signal) => json(`/api/vault/documents/${id}/content`, { signal }),
  viewBlob: async (id, signal) => (await raw(`/api/vault/documents/${id}/view`, { signal })).blob(),
  saveEdit: (id, body) => json(`/api/vault/documents/${id}/save-edit`, { method: 'POST', json: body }),
  assistant: (id, body, signal) => json(`/api/vault/documents/${id}/assistant`, { method: 'POST', json: body, signal }),
  exportDocx: async (id, body, fallbackName = 'document.docx') => {
    const res = await raw(`/api/vault/documents/${id}/export-docx`, { method: 'POST', json: body });
    saveBlob(await res.blob(), fileNameFrom(res, fallbackName));
  },
  downloadOriginal: async (id, fallbackName = 'document') => {
    const res = await raw(`/api/vault/documents/${id}/download`);
    saveBlob(await res.blob(), fileNameFrom(res, fallbackName));
  },
};
