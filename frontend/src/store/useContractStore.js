import { create } from 'zustand';

export const useContractStore = create((set, get) => ({
  rawText: '',
  setRawText: (text) => set({ rawText: text }),

  // Rich HTML mirror of rawText, kept only so the editor can rehydrate its
  // formatting (bold, lists, headings) across an unmount/remount without
  // relying on getLogicalText's plain-text extraction to reconstruct it.
  rawHtml: '',
  setRawHtml: (html) => set({ rawHtml: html }),

  contractFile: null,
  setContractFile: (file) => set({ contractFile: file }),

  clauses: [],
  setClauses: (clauses) => set({ clauses }),

  summary: '',
  setSummary: (summary) => set({ summary }),

  ruleBookText: '',
  setRuleBookText: (text) => set({ ruleBookText: text }),

  autoDraftText: '',
  setAutoDraftText: (text) => set({ autoDraftText: text }),

  // Same purpose as rawHtml above, for the Auto-Draft Studio editor —
  // without it, editing the synthesized document (or even just the
  // debounced onUpdate sync that runs while the AI-generated markdown is
  // first parsed) overwrites autoDraftText with getLogicalText's plain-text
  // extraction, which has no ###/** markdown syntax left in it. Navigating
  // away and back then remounts ContractTiptapEditor from that already-
  // stripped text, and rawTextToHtml() has nothing left to reconstruct
  // headings/bold from — confirmed live as the exact "formatting collapses
  // on navigation" bug reported for Auto-Draft Studio.
  autoDraftHtml: '',
  setAutoDraftHtml: (html) => set({ autoDraftHtml: html }),

  autoDraftPrompt: '',
  setAutoDraftPrompt: (prompt) => set({ autoDraftPrompt: prompt }),

  autoDraftVersion: 0,
  setAutoDraftVersion: (v) =>
    set((state) => ({
      autoDraftVersion: typeof v === 'function' ? v(state.autoDraftVersion) : v,
    })),

  isDraftsModalOpen: false,
  setIsDraftsModalOpen: (open) => set({ isDraftsModalOpen: open }),
  openDraftsModal: () => set({ isDraftsModalOpen: true }),
  closeDraftsModal: () => set({ isDraftsModalOpen: false }),

  clearContract: () =>
    set({
      rawText: '',
      rawHtml: '',
      contractFile: null,
      clauses: [],
      summary: '',
      ruleBookText: '',
      autoDraftText: '',
      autoDraftHtml: '',
      autoDraftPrompt: '',
      autoDraftVersion: 0,
      isDraftsModalOpen: false,
    }),
}));
