/**
 * frontend/src/services/draftApi.js
 * Calls for the guided drafting wizard (/api/drafts/*). Every call has a timeout and every failure becomes a
 * plain-English Error message: the screen never shows raw JSON, a status code or "undefined".
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export class DraftApiError extends Error {
  constructor(message, { status = 0, code = '', sessionExpired = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.sessionExpired = sessionExpired;
  }
}

const FALLBACKS = {
  401: 'Your session has expired. Sign in again; your answers are saved.',
  403: 'Your session has expired. Sign in again; your answers are saved.',
  404: 'That item could not be found.',
  413: 'That is too large. Please use a smaller file or less text.',
  429: 'Too many requests in a short time. Please wait a minute and try again.',
};

async function plainMessage(res) {
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  const m = body && (body.message || (typeof body.error === 'string' ? body.error : ''));
  if (typeof m === 'string' && m.trim() && m.length < 400 && !/traceback|exception|sqlalchemy/i.test(m)) return { message: m, code: (body && body.code) || '' };
  if (FALLBACKS[res.status]) return { message: FALLBACKS[res.status], code: '' };
  if (res.status >= 500) return { message: 'Something went wrong on our side. Please try again in a moment. Your answers are kept on this screen.', code: '' };
  return { message: 'That did not work. Please check the details and try again.', code: '' };
}

export async function request(path, { method = 'GET', body, timeoutMs = 30000, signal, raw = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const { message, code } = await plainMessage(res);
      throw new DraftApiError(message, { status: res.status, code, sessionExpired: res.status === 401 || res.status === 403 });
    }
    return raw ? res : await res.json();
  } catch (e) {
    if (e instanceof DraftApiError) throw e;
    if (e && e.name === 'AbortError') {
      if (signal && signal.aborted) throw e;
      throw new DraftApiError('The server is taking too long to answer. It may be waking up. Please try again in a few seconds.');
    }
    throw new DraftApiError('We could not reach the server. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}

export const listTypes = () => request('/api/drafts/types').then((d) => d.types || []);
export const getType = (id) => request(`/api/drafts/types/${encodeURIComponent(id)}`);
export const renderDraft = (type, facts, signal) => request('/api/drafts/render', { method: 'POST', body: { type, facts }, signal });
export const extractFacts = (type, text, sourceName) => request('/api/drafts/extract', { method: 'POST', body: { type, text, source_name: sourceName }, timeoutMs: 60000 });
export const listSessions = () => request('/api/drafts/sessions').then((d) => d.sessions || []);
export const createSession = (payload) => request('/api/drafts/sessions', { method: 'POST', body: payload });
export const getSession = (id) => request(`/api/drafts/sessions/${id}`);
export const saveSession = (id, payload) => request(`/api/drafts/sessions/${id}`, { method: 'PUT', body: payload });
export const getVersion = (sid, vid) => request(`/api/drafts/sessions/${sid}/versions/${vid}`);
export const deleteSession = (id) => request(`/api/drafts/sessions/${id}`, { method: 'DELETE' });
export const getFlag = (key) => request(`/api/drafts/flags/${key}`).then((d) => d.value);
export const setFlag = (key, value) => request(`/api/drafts/flags/${key}`, { method: 'PUT', body: { value } });

/** Ask the server for a Word or PDF file and hand it to the browser as a download. */
export async function downloadDocument(document, format) {
  const res = await request('/api/drafts/export', { method: 'POST', body: { document, format }, raw: true, timeoutMs: 60000 });
  const blob = await res.blob();
  const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || `document.${format}`;
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = name;
  window.document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { name, unresolved: Number(res.headers.get('X-Unresolved-Count') || 0), note: res.headers.get('X-Export-Notes') || '' };
}

/** Read a PDF/Word/text file into plain text through the hardened extractor. */
export async function readFileText(file) {
  const fd = new FormData();
  fd.append('file', file);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(`${API_BASE}/api/contract/extract-text`, { method: 'POST', body: fd, signal: ctrl.signal });
    if (!res.ok) {
      const { message } = await plainMessage(res);
      throw new DraftApiError(message, { status: res.status });
    }
    const data = await res.json();
    return String(data.text || data.raw_text || '');
  } catch (e) {
    if (e instanceof DraftApiError) throw e;
    if (e && e.name === 'AbortError') throw new DraftApiError('Reading the file took too long. Try a smaller file, or type the details in.');
    throw new DraftApiError('We could not reach the server. Check your internet connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const withMarks = (s) => escapeHtml(s).replace(/\[Bracketed Field:[^\]]*\]/g, (m) => `<mark>${m}</mark>`);

/** Structured blocks -> HTML for the editor (everything is escaped; blanks are highlighted). */
export function blocksToHtml(blocks) {
  return (blocks || []).map((b) => {
    switch (b.type) {
      case 'title': return `<h2 style="text-align:center"><u>${withMarks(b.text)}</u></h2>`;
      case 'heading': return `<h3>${withMarks(b.text)}</h3>`;
      case 'right': return `<p style="text-align:right">${withMarks(b.text)}</p>`;
      case 'center': return `<p style="text-align:center">${b.bold ? '<strong>' : ''}${withMarks(b.text)}${b.bold ? '</strong>' : ''}</p>`;
      case 'address': return `<p>${(b.lines || []).map(withMarks).join('<br>')}</p>`;
      case 'signature': return `<p style="text-align:right">${(b.lines || []).map(withMarks).join('<br>')}</p>`;
      case 'numbered': return `<p style="text-align:justify">${b.number}. ${withMarks(b.text)}</p>`;
      case 'lettered': return `<p style="text-align:justify">${escapeHtml(b.letter)} ${withMarks(b.text)}</p>`;
      case 'table': return `<table>${(b.rows || []).map((r) => `<tr>${r.map((c) => `<td>${withMarks(c)}</td>`).join('')}</tr>`).join('')}</table>`;
      case 'pagebreak': return '<hr>';
      case 'spacer': return '<p></p>';
      default: return `<p${b.align === 'justify' ? ' style="text-align:justify"' : ''}>${b.bold ? '<strong>' : ''}${withMarks(b.text)}${b.bold ? '</strong>' : ''}</p>`;
    }
  }).join('\n');
}

export function blocksToText(blocks) {
  return (blocks || []).map((b) => {
    if (b.type === 'address' || b.type === 'signature') return (b.lines || []).join('\n');
    if (b.type === 'table') return (b.rows || []).map((r) => r.join(' | ')).join('\n');
    if (b.type === 'numbered') return `${b.number}. ${b.text}`;
    if (b.type === 'lettered') return `${b.letter} ${b.text}`;
    return b.text || '';
  }).join('\n');
}
