import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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

// Home Gateway v4 — trimmed to pure UI-only selection state. teams/matters/
// activities and every mutation (createTeam, createMatter, addTask,
// toggleTask, addDeadline...) moved to frontend/src/hooks/useOrganization.js,
// which owns the real backend (app.py's /api/matters*, /api/teams* routes)
// instead of localStorage — the same split useVaultTree.js/useChamberStore.js
// already established for Case Vault. This store now only remembers which
// org/team/matter the user last looked at, for UX continuity across
// navigation/reloads; it has no server equivalent and needs none.
//
// version bumped 2 -> 3 with no migrate step: the old persisted
// teams/matters/activities arrays were seed/demo data (hardcoded
// mat_default/team_private placeholders), not real user work product, so
// they're simply superseded once the hook-backed data becomes
// authoritative rather than migrated forward.
export const useOrganizationStore = create(
  persist(
    (set) => ({
      organization: {
        id: 'org_lexamplify_main',
        name: 'LexAmplify',
        plan: 'Enterprise',
        totalAiRuns30d: 142,
      },
      activeOrgId: 'org_lexamplify_main',
      activeTeamId: null,
      activeMatterId: null,
      setActiveMatter: (matterId) => set({ activeMatterId: matterId }),
      setActiveTeam: (teamId) => set({ activeTeamId: teamId }),
      clearStore: () => set({ activeMatterId: null, activeTeamId: null }),
    }),
    {
      name: 'lexamplify-organization-store',
      storage: createJSONStorage(() => userScopedStorage),
      version: 3,
      // No real migration — see the version-bump comment above. This just
      // discards the old teams/matters/activities shape instead of
      // warning about it on every load.
      migrate: () => ({ organization: { id: 'org_lexamplify_main', name: 'LexAmplify', plan: 'Enterprise', totalAiRuns30d: 142 }, activeOrgId: 'org_lexamplify_main', activeTeamId: null, activeMatterId: null }),
    }
  )
);

export default useOrganizationStore;
