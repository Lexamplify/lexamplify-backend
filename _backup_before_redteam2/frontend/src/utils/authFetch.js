// ── Global cookie/CSRF fetch patch ───────────────────────────────────────────
// JWTs live in HttpOnly cookies now — no component reads a token out of
// localStorage to build an Authorization header anymore. This patches the
// global `fetch` once so every existing call site (75+ across the app)
// gets `credentials:'include'` (send the auth cookie) and, for mutating
// methods, the CSRF double-submit header — without editing each call site.
// Also retries once through a silent /api/auth/refresh on a 401, so an
// expired 1-hour access cookie doesn't interrupt a long session.

const API_ORIGIN = (() => {
  try {
    const base = import.meta.env.VITE_API_BASE_URL;
    // If a specific base URL is set (e.g. production), parse its origin.
    // Otherwise, we are using relative paths via Vite proxy, meaning the
    // "backend" origin is simply our own frontend origin.
    if (base) return new URL(base, window.location.origin).origin;
    return window.location.origin;
  } catch {
    return null;
  }
})();

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_PATHS_EXCLUDED_FROM_REFRESH = ['/api/auth/login', '/api/auth/refresh', '/api/auth/register'];

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function isBackendRequest(url) {
  if (!API_ORIGIN) return false;
  try {
    return new URL(url, window.location.href).origin === API_ORIGIN;
  } catch {
    return false;
  }
}

function pathOf(url) {
  try {
    return new URL(url, window.location.href).pathname;
  } catch {
    return '';
  }
}

const nativeFetch = window.fetch.bind(window);
let refreshInFlight = null;

function buildAuthedInit(init, method) {
  const headers = new Headers(init.headers || {});
  if (MUTATING_METHODS.has(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers.set('X-CSRF-TOKEN', csrf);
  }
  return { ...init, credentials: 'include', headers };
}

async function silentRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = nativeFetch(`${API_ORIGIN}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: (() => {
        const h = new Headers();
        const csrf = getCsrfToken();
        if (csrf) h.set('X-CSRF-TOKEN', csrf);
        return h;
      })(),
    }).finally(() => { refreshInFlight = null; });
  }
  const res = await refreshInFlight;
  return res.ok;
}

window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;

  if (!isBackendRequest(url)) return nativeFetch(input, init);

  const method = (init.method || 'GET').toUpperCase();
  const path = pathOf(url);
  const authedInit = buildAuthedInit(init, method);

  const response = await nativeFetch(input, authedInit);

  const isAuthRoute = AUTH_PATHS_EXCLUDED_FROM_REFRESH.some((p) => path.startsWith(p));
  if (response.status !== 401 || isAuthRoute) return response;

  // Expired access cookie — try one silent refresh, then replay the
  // original request exactly once. If refresh itself fails (no valid
  // session), fall through and return the original 401 untouched.
  const refreshed = await silentRefresh();
  if (!refreshed) return response;

  return nativeFetch(input, buildAuthedInit(init, method));
};

export {};
