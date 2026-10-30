// Keeps the backend (Render) and its database (Neon) awake from the browser's side.
// Both sleep when idle. The first request after a sleep is slow, and showing the person an error
// for that is wrong - they did nothing wrong. So: wake the server as soon as a page that needs it
// opens, and let anything that must talk to it wait for "awake" instead of failing.
const BASE = import.meta.env.VITE_API_BASE_URL || '';
let inflight = null;
let awake = false;

export const isServerAwake = () => awake;

export async function pingOnce(timeoutMs = 12000) {
  try {
    const res = await fetch(`${BASE}/api/ping`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, db: false };
    const j = await res.json().catch(() => ({}));
    return { ok: true, db: j.db !== false };
  } catch {
    return { ok: false, db: false };
  }
}

// Resolves true once the server AND database answer, or false if `deadlineMs` passes first.
// Calls share one loop, so opening the login page and pressing Sign In never pile up pings.
export function waitUntilAwake({ deadlineMs = 150000, force = false } = {}) {
  if (awake && !force) return Promise.resolve(true);
  if (inflight && !force) return inflight;
  inflight = (async () => {
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < deadlineMs) {
      const r = await pingOnce();
      // The database can take a few more seconds than the web server; after ~45s accept "web is up".
      if (r.ok && (r.db || Date.now() - t0 > 45000)) { awake = true; return true; }
      n += 1;
      await new Promise((res) => setTimeout(res, Math.min(1000 + n * 700, 4000)));
    }
    return false;
  })().finally(() => { inflight = null; });
  return inflight;
}

// Once awake, a light heartbeat keeps both warm while the tab is open and visible.
let beat = null;
export function startHeartbeat(everyMs = 180000) {
  if (beat) return;
  beat = setInterval(() => { if (document.visibilityState === 'visible') pingOnce(8000); }, everyMs);
}
