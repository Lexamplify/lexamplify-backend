import { useEffect } from 'react';
import { useCollabStore } from '../stores/useCollabStore.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/*
 * Collaboration SSE wiring — plan phase 6.
 *
 * Opens /api/collab/stream/notifications on mount (once per app shell),
 * reads server-sent `notification` events, and dispatches them into:
 *   - useCollabStore.bump(case_id)      → increments unread chip
 *   - useCollabStore.noteMention(…)     → records latest mention target
 *   - window.dispatchEvent('lx:notifications-count', …) → the existing
 *     bell badge in components/practice/Notifications.jsx already
 *     listens for this (bump by +1 on every event).
 *
 * Reconnect: EventSource retries automatically with exponential backoff
 * when the connection drops, so this hook doesn't need a retry loop.
 * If the user signs out, the Shell unmounts and the useEffect cleanup
 * closes the stream.
 */
export function useCollabStream(enabled) {
  const bump = useCollabStore((s) => s.bump);
  const noteMention = useCollabStore((s) => s.noteMention);

  useEffect(() => {
    if (!enabled) return undefined;
    // Idle browsers (background tab) sometimes freeze EventSource traffic;
    // the client re-wakes and the server picks up where last_seen left off.
    const url = `${API_BASE}/api/collab/stream/notifications`;
    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data || '{}'); } catch { return; }
      if (data.type === 'notification') {
        if (data.case_id) bump(Number(data.case_id), 1);
        if (data.kind && data.kind.startsWith('mention')) {
          // Pull the message id out of the deep-link #collab-<id>, if any.
          const m = String(data.link || '').match(/#collab-(\d+)/);
          if (m) noteMention(data.case_id, Number(m[1]));
        }
        // Reuse the existing bell-badge event so the current pane in
        // components/practice/Notifications.jsx updates for free.
        try { window.dispatchEvent(new CustomEvent('lx:notifications-count', { detail: { delta: 1 } })); }
        catch { /* older browsers without CustomEvent fallback — ignore */ }
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here. If the server
      // is down for a while, bell polling in Notifications.jsx picks up
      // whatever we missed on the next poll.
    };

    return () => { try { es.close(); } catch { /* ignore */ } };
  }, [enabled, bump, noteMention]);
}
