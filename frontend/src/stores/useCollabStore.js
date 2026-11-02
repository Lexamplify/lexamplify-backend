import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/*
 * Tiny client-side registry of case-room activity: unread message counts
 * per case + a reference to the latest mention. The backend already owns
 * the authoritative state via /api/collab/cases/<id>/read + the
 * lpms_notifications bell; this store only exists so the top-bar
 * "unread mentions" chip can read a cheap client-side number without
 * polling, and so a case's unread badge survives a soft reload.
 *
 * Scoped per user via the same localStorage wrapper useWorkspaceStore
 * and useJobsStore use, so parallel accounts never leak each other's
 * mention counts.
 */

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

export const useCollabStore = create(
  persist(
    (set, get) => ({
      /** { [caseId]: number } — unread message count per case the user has access to. */
      unreadByCase: {},

      /** { caseId, messageId, at } — most recent mention, so the chip can
       * link straight to it when clicked. */
      lastMention: null,

      /** Called by the SSE listener (phase 6) whenever a message lands
       * in a room the user has access to but is not currently viewing. */
      bump: (caseId, count = 1) =>
        set((s) => {
          const prev = Number(s.unreadByCase[caseId] || 0);
          return { unreadByCase: { ...s.unreadByCase, [caseId]: prev + count } };
        }),

      /** Called by the SSE listener on a mention event. */
      noteMention: (caseId, messageId) =>
        set({ lastMention: { caseId: Number(caseId), messageId: Number(messageId), at: Date.now() } }),

      /** Called by CollabRoom whenever the user visibly reads a room —
       * mirrors the server-side mark-read call so the chip updates
       * instantly without waiting for the next poll. */
      clear: (caseId) =>
        set((s) => {
          const copy = { ...s.unreadByCase };
          delete copy[caseId];
          return { unreadByCase: copy };
        }),

      /** Total badge value — sum of all per-case unread counts. */
      totalUnread: () =>
        Object.values(get().unreadByCase).reduce((a, n) => a + Number(n || 0), 0),
    }),
    {
      name: 'lx-collab',
      version: 1,
      storage: createJSONStorage(() => userScopedStorage),
      partialize: (s) => ({ unreadByCase: s.unreadByCase, lastMention: s.lastMention }),
    },
  ),
);
