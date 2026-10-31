import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/*
 * Workspace store — holds the user's workspace list and which one is active.
 * Phase 3 of the workspaces refactor.
 *
 * Server stays stateless about "current workspace": every API call carries
 * X-Workspace-Id in a header injected by utils/authFetch.js from this store.
 * Persisted per user so switching accounts doesn't leak the previous
 * selection.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const userScopedStorage = {
  getItem: (name) => {
    const userId = localStorage.getItem('active_lex_user') || 'guest';
    return localStorage.getItem(`${userId}_${name}`);
  },
  setItem: (name, value) => {
    const userId = localStorage.getItem('active_lex_user') || 'guest';
    localStorage.setItem(`${userId}_${name}`, value);
  },
  removeItem: (name) => {
    const userId = localStorage.getItem('active_lex_user') || 'guest';
    localStorage.removeItem(`${userId}_${name}`);
  },
};

async function _json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.message || `HTTP ${res.status}`);
    err.code = body?.code;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const useWorkspaceStore = create(
  persist(
    (set, get) => ({
      workspaces: [],
      currentWorkspaceId: null,
      loading: false,
      error: null,
      // Known at app boot — the feature flag can hide the switcher entirely.
      enabled: null,

      /** Set the currently active workspace. Null to clear. */
      setCurrent: (id) => {
        set({ currentWorkspaceId: id });
        try {
          window.dispatchEvent(new CustomEvent('lx:workspace-changed', { detail: { id } }));
        } catch { /* ignore */ }
      },

      /** Fetch the list from the server. Call on sign-in and after mutations. */
      refresh: async ({ includeArchived = false } = {}) => {
        set({ loading: true, error: null });
        try {
          const qs = includeArchived ? '?archived=1' : '';
          const res = await fetch(`${API_BASE}/api/workspaces${qs}`);
          // Feature-flagged off → 404. Not an error, just hide the UI.
          if (res.status === 404) {
            set({ workspaces: [], enabled: false, loading: false });
            return [];
          }
          const data = await _json(res);
          const list = data?.workspaces || [];
          // If the current selection has disappeared from the list, pick
          // the first available one so the app is never "on a workspace
          // that doesn't exist".
          const cur = get().currentWorkspaceId;
          const hasCurrent = list.some((w) => w.id === cur);
          const nextCurrent = hasCurrent ? cur : (list[0]?.id ?? null);
          set({ workspaces: list, currentWorkspaceId: nextCurrent, enabled: true, loading: false });
          if (nextCurrent !== cur) {
            try { window.dispatchEvent(new CustomEvent('lx:workspace-changed', { detail: { id: nextCurrent } })); } catch { /* ignore */ }
          }
          return list;
        } catch (e) {
          set({ loading: false, error: e.message || String(e) });
          throw e;
        }
      },

      /** Create a new workspace. Returns the row. */
      create: async (payload) => {
        set({ loading: true, error: null });
        try {
          const res = await fetch(`${API_BASE}/api/workspaces`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
          });
          const data = await _json(res);
          const ws = data.workspace;
          const list = [ws, ...get().workspaces.filter((w) => w.id !== ws.id)];
          set({ workspaces: list, currentWorkspaceId: ws.id, loading: false });
          try { window.dispatchEvent(new CustomEvent('lx:workspace-changed', { detail: { id: ws.id } })); } catch { /* ignore */ }
          return ws;
        } catch (e) {
          set({ loading: false, error: e.message || String(e) });
          throw e;
        }
      },

      /** Update workspace metadata. */
      patch: async (id, payload) => {
        const res = await fetch(`${API_BASE}/api/workspaces/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
        });
        const data = await _json(res);
        set({
          workspaces: get().workspaces.map((w) => (w.id === id ? data.workspace : w)),
        });
        return data.workspace;
      },

      /** Archive a workspace. Removes from active list and picks a new current. */
      archive: async (id) => {
        const res = await fetch(`${API_BASE}/api/workspaces/${id}/archive`, { method: 'POST' });
        await _json(res);
        const remaining = get().workspaces.filter((w) => w.id !== id);
        const current = get().currentWorkspaceId;
        const nextCurrent = current === id ? (remaining[0]?.id ?? null) : current;
        set({ workspaces: remaining, currentWorkspaceId: nextCurrent });
        if (nextCurrent !== current) {
          try { window.dispatchEvent(new CustomEvent('lx:workspace-changed', { detail: { id: nextCurrent } })); } catch { /* ignore */ }
        }
      },

      /** Unarchive (brings a workspace back into the active list). */
      unarchive: async (id) => {
        const res = await fetch(`${API_BASE}/api/workspaces/${id}/unarchive`, { method: 'POST' });
        await _json(res);
        await get().refresh();
      },

      /** Clear everything (sign-out). */
      clear: () => set({ workspaces: [], currentWorkspaceId: null, loading: false, error: null, enabled: null }),
    }),
    {
      name: 'workspace-store',
      storage: createJSONStorage(() => userScopedStorage),
      partialize: (state) => ({
        currentWorkspaceId: state.currentWorkspaceId,
        // Persist a tiny shadow of the list so the switcher can render
        // instantly on reload without a round-trip; refreshed from server
        // right after.
        workspaces: (state.workspaces || []).map((w) => ({
          id: w.id, name: w.name, firm_id: w.firm_id, status: w.status,
        })),
      }),
      version: 1,
    },
  ),
);

/**
 * Helper for authFetch — synchronously read the current workspace id from
 * persisted localStorage, so the header can be injected without pulling in
 * React. Returns null when no workspace is selected.
 */
export function readCurrentWorkspaceId() {
  try {
    const userId = localStorage.getItem('active_lex_user') || 'guest';
    const raw = localStorage.getItem(`${userId}_workspace-store`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const id = parsed?.state?.currentWorkspaceId;
    return typeof id === 'number' ? id : null;
  } catch {
    return null;
  }
}
