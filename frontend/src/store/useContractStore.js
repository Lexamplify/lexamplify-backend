import { create } from 'zustand';

export const useContractStore = create((set, get) => ({
  rawText: '',
  setRawText: (text) => set({ rawText: text }),

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

  autoDraftPrompt: '',
  setAutoDraftPrompt: (prompt) => set({ autoDraftPrompt: prompt }),

  autoDraftVersion: 0,
  setAutoDraftVersion: (v) =>
    set((state) => ({
      autoDraftVersion: typeof v === 'function' ? v(state.autoDraftVersion) : v,
    })),

  clearContract: () =>
    set({
      rawText: '',
      contractFile: null,
      clauses: [],
      summary: '',
      ruleBookText: '',
      autoDraftText: '',
      autoDraftPrompt: '',
      autoDraftVersion: 0,
    }),
}));
