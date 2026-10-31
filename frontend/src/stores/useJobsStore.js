import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/*
 * Tiny client-side registry of long-running backend jobs (contract
 * analyses today, document generations tomorrow). The backend task is
 * already a Celery job that runs regardless of what the frontend does —
 * this store just remembers "a job is in flight" so the topbar can
 * surface it from any page and the user can click back to resume the
 * view.
 *
 * Scoped per user via the same localStorage wrapper the workspace
 * store uses so parallel accounts don't leak jobs to each other.
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

let _pollTimer = null;

export const useJobsStore = create(
  persist(
    (set, get) => ({
      // { jobId: { kind: 'contract', title, startedAt, progress, status, stage } }
      jobs: {},

      /** Register a new in-flight job. kind: 'contract' | 'draft'. */
      register: (jobId, kind, extra = {}) => {
        if (!jobId) return;
        const now = Date.now();
        set((s) => ({
          jobs: { ...s.jobs, [jobId]: { kind, startedAt: now, progress: 0, status: 'processing', ...extra } },
        }));
        get().startPolling();
      },

      /** Called by the detail page or the poller when a job finishes. */
      finish: (jobId) => {
        set((s) => {
          const copy = { ...s.jobs };
          delete copy[jobId];
          return { jobs: copy };
        });
        if (Object.keys(get().jobs).length === 0) get().stopPolling();
      },

      /** Mark a job's status (used by poller + anywhere that already has state). */
      patch: (jobId, patch) => {
        set((s) => {
          if (!s.jobs[jobId]) return s;
          return { jobs: { ...s.jobs, [jobId]: { ...s.jobs[jobId], ...patch } } };
        });
        if (patch.status && ['done', 'completed', 'failed', 'error', 'cancelled'].includes(patch.status)) {
          get().finish(jobId);
        }
      },

      /** Poll every tracked job's /analysis-status endpoint. */
      pollOnce: async () => {
        const jobs = get().jobs;
        const ids = Object.keys(jobs);
        if (!ids.length) { get().stopPolling(); return; }
        for (const jobId of ids) {
          const kind = jobs[jobId]?.kind;
          if (kind !== 'contract') continue;
          try {
            const res = await fetch(`${API_BASE}/api/contract/analysis-status/${jobId}`, { cache: 'no-store' });
            if (!res.ok) continue;
            const data = await res.json();
            get().patch(jobId, {
              progress: Number(data.progress) || 0,
              status: data.status || 'processing',
              stage: data.stage || data.status_text || '',
            });
          } catch { /* keep polling */ }
        }
      },

      startPolling: () => {
        if (_pollTimer) return;
        _pollTimer = setInterval(() => get().pollOnce(), 4000);
        get().pollOnce();  // immediate first tick
      },
      stopPolling: () => {
        if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
      },

      /** Called once on app boot to rehydrate the poller for jobs that
       * were in flight when the page reloaded or the user signed back in. */
      rehydrate: () => {
        if (Object.keys(get().jobs).length > 0) get().startPolling();
      },

      clear: () => { get().stopPolling(); set({ jobs: {} }); },
    }),
    {
      name: 'jobs-store',
      storage: createJSONStorage(() => userScopedStorage),
      version: 1,
    },
  ),
);
