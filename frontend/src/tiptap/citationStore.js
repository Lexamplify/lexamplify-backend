// Zustand store for inline citation metadata (case name, summary, url),
// keyed by citationId. CitationBadge reads from here via a selector scoped
// to its OWN citationId — so updating one citation's data (or a badge's
// local hover state, which never touches this store) never re-renders any
// other badge, and critically never touches TipTap/ProseMirror state, so
// the editor itself never re-renders because of it.
import { create } from 'zustand';

export const useCitationStore = create((set, get) => ({
  citations: {},

  registerCitation: (citationId, data) =>
    set((state) => ({
      citations: { ...state.citations, [citationId]: data },
    })),

  registerCitations: (entries) =>
    set((state) => ({
      citations: { ...state.citations, ...entries },
    })),

  getCitation: (citationId) => get().citations[citationId],
}));
