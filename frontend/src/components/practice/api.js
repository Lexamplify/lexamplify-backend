// Network layer for Practice. Every call goes through the app's patched global fetch (cookies, CSRF, silent refresh).
import { ApiError, saveBlob } from '../dochub/api.js';

export { ApiError };

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const BASE = `${API_BASE}/api/practice`;

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false) return;
    if (Array.isArray(v)) { if (v.length) p.set(k, v.join(',')); return; }
    p.set(k, v === true ? '1' : String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function raw(path, { method = 'GET', json, signal } = {}) {
  const init = { method, signal, headers: {} };
  if (json !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, init);
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

const call = async (path, opts) => (await raw(path, opts)).json();

function filenameFrom(res, fallback) {
  const cd = res.headers.get('Content-Disposition') || '';
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1] : fallback;
}

async function download(path, fallback) {
  const res = await raw(path);
  const blob = await res.blob();
  saveBlob(blob, filenameFrom(res, fallback));
}

export const pr = {
  get: (path, params, signal) => call(`${path}${qs(params)}`, { signal }),
  post: (path, json) => call(path, { method: 'POST', json: json ?? {} }),
  patch: (path, json) => call(path, { method: 'PATCH', json }),
  put: (path, json) => call(path, { method: 'PUT', json }),
  del: (path) => call(path, { method: 'DELETE' }),
  download,
  url: (path, params) => `${BASE}${path}${qs(params)}`,
  qs,
};

// WhatsApp: the browser only lets a tab open straight from a click, so open a blank one first and point it at the
// wa.me link once the server has logged the message and built it.
export async function openWhatsApp(caseId, body) {
  const win = window.open('', '_blank');
  try {
    const r = await pr.post(`/cases/${caseId}/whatsapp`, body);
    if (win) { win.opener = null; win.location.href = r.url; }
    return { ...r, popupBlocked: !win };
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

export function doneWith(e) { return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'; }
