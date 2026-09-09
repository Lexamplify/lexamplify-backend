// Native Google Calendar integration — Google Identity Services (GIS) token
// flow, driven directly rather than through @react-oauth/google's hooks.
// @react-oauth/google's modern API (useGoogleLogin) is a React hook and
// can't live in a plain utils module; window.google.accounts.oauth2 is the
// same public GIS surface that hook calls internally, so this stays "modern
// GIS, not the deprecated gapi-script" while remaining a plain awaitable
// function callable from anywhere (including the save handler in
// CalendarView.jsx).

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

let gisLoadPromise = null;

// Exported so callers (CalendarView) can kick this off on mount, well before
// any click — requestAccessToken() must run synchronously off the click's
// user-gesture, and awaiting a script that's still loading crosses an async
// boundary that can make Chrome's popup blocker refuse the popup ("Failed to
// open popup window") even though the click was genuine. Preloading means
// the fast path below (already loaded) resolves on a microtask, not a
// script-load event, so it doesn't break the gesture chain.
export function ensureGisLoaded() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services script.')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script.'));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

// Requests the calendar.events scope via the GIS token client and resolves
// with the access token. Rejects if the user closes the consent popup or
// Google returns an error.
export async function loginWithGoogle() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  // Fail loudly with an unambiguous message here rather than letting GIS
  // reject deep inside its own popup with a generic "Missing required
  // parameter: client_id" — that error is indistinguishable from a stale
  // build/CDN cache still serving an old bundle from before this env var
  // was set, which is what actually caused it in practice.
  if (!clientId) {
    throw new Error('Google Calendar is not configured: VITE_GOOGLE_CLIENT_ID is empty in this build. Set it and rebuild/redeploy — if it was just added, also check the deployed site isn\'t serving a stale cached index.html from before the rebuild.');
  }

  await ensureGisLoaded();

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: CALENDAR_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
        } else {
          resolve(response.access_token);
        }
      },
      error_callback: (err) => {
        reject(new Error(err?.message || 'Google sign-in was cancelled.'));
      },
    });
    client.requestAccessToken();
  });
}

// Revokes the current access token so a stale grant can't be reused.
export function logoutFromGoogle(token) {
  if (!token || !window.google?.accounts?.oauth2) return;
  window.google.accounts.oauth2.revoke(token, () => {});
}

// Converts a raw Google Calendar API event into CalendarView's internal
// event shape, flagged with source:'google' so the grid can render it
// distinctly from LexAmplify tickler/hearing events.
export function mapGoogleEvent(gEvent) {
  const eventDate = gEvent.start?.date || (gEvent.start?.dateTime ? gEvent.start.dateTime.slice(0, 10) : '');
  return {
    id: `g-${gEvent.id}`,
    google_event_id: gEvent.id,
    event_date: eventDate,
    event_type: 'google',
    title: gEvent.summary || '(untitled)',
    related_case_id: '',
    location: gEvent.location || '',
    opposing_counsel: '',
    source: 'google',
  };
}

// Fetches events strictly bounded by [timeMin, timeMax] (ISO 8601) to avoid
// over-fetching — callers pass the current month view's start/end.
export async function fetchGoogleEvents(token, timeMin, timeMax) {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
  });
  const res = await fetch(`${EVENTS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google Calendar fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  return (data.items || []).map(mapGoogleEvent);
}

// Creates a single all-day event and returns the new Google event ID.
// Google's all-day end.date is exclusive, so a one-day event needs
// end.date == event_date + 1 day.
export async function pushToGoogleCalendar(token, eventData) {
  const [y, m, d] = eventData.event_date.split('-').map(Number);
  const endDate = new Date(y, m - 1, d + 1);
  const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  const body = {
    summary: eventData.title,
    location: eventData.location || undefined,
    start: { date: eventData.event_date },
    end: { date: endStr },
  };

  const res = await fetch(EVENTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google Calendar push failed: HTTP ${res.status}`);
  const data = await res.json();
  return data.id;
}
