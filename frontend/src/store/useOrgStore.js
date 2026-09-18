import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const INITIAL_ORG = {
  id: 'org_lexamplify',
  name: 'LexAmplify Law Partners',
  plan: 'Enterprise Trial',
};

const INITIAL_TEAMS = [
  {
    id: 'team_dispute',
    name: 'Dispute Resolution',
    description: 'Commercial litigation, arbitration, and appellate advocacy.',
    matterCount: 2,
  },
  {
    id: 'team_corp',
    name: 'Corporate Advisory & M&A',
    description: 'Transactions, corporate structuring, and regulatory advisory.',
    matterCount: 1,
  },
  {
    id: 'team_ip',
    name: 'IP & Technology',
    description: 'Patents, trademarks, technology licensing, and DPDP compliance.',
    matterCount: 1,
  },
  {
    id: 'team_private',
    name: 'My Private Space',
    description: 'Restricted personal workspace for confidential advisory.',
    matterCount: 1,
  },
];

const INITIAL_MATTERS = [
  {
    id: 'm1',
    teamId: 'team_dispute',
    teamName: 'Dispute Resolution',
    title: 'A v. B',
    status: 'open',
    leadCounsel: 'Narendar V',
    isPrivate: false,
    lastUsed: true,
    openedAt: 'Sep 18, 2026',
  },
  {
    id: 'm2',
    teamId: 'team_corp',
    teamName: 'Corporate Advisory & M&A',
    title: 'Tata Sons v. Cyrus Investments',
    status: 'active',
    leadCounsel: 'Saurabh M',
    isPrivate: false,
    lastUsed: false,
    openedAt: 'Sep 12, 2026',
  },
  {
    id: 'm3',
    teamId: 'team_ip',
    teamName: 'IP & Technology',
    title: 'Acme Licensing & Trademark Dispute',
    status: 'open',
    leadCounsel: 'Yogesh K',
    isPrivate: false,
    lastUsed: false,
    openedAt: 'Aug 29, 2026',
  },
  {
    id: 'm4',
    teamId: 'team_private',
    teamName: 'My Private Space',
    title: 'Internal Advisory Memo (Private)',
    status: 'closed',
    leadCounsel: 'Narendar V',
    isPrivate: true,
    lastUsed: false,
    openedAt: 'Aug 15, 2026',
  },
  {
    id: 'm5',
    teamId: 'team_dispute',
    teamName: 'Dispute Resolution',
    title: 'Union of India v. Reliance Petrochemicals',
    status: 'on_hold',
    leadCounsel: 'Narendar V',
    isPrivate: false,
    lastUsed: false,
    openedAt: 'Jul 22, 2026',
  },
];

export const useOrgStore = create(
  persist(
    (set, get) => ({
      currentOrg: INITIAL_ORG,
      teams: INITIAL_TEAMS,
      matters: INITIAL_MATTERS,
      activeMatterId: 'm1',
      activeTeamId: 'team_dispute',

      setActiveMatter: (id) => {
        const state = get();
        const matter = state.matters.find((m) => m.id === id);
        if (!matter) return;

        set({
          activeMatterId: id,
          activeTeamId: matter.teamId || state.activeTeamId,
          matters: state.matters.map((m) => ({
            ...m,
            lastUsed: m.id === id,
          })),
        });
      },

      setActiveTeam: (id) => {
        set({ activeTeamId: id });
      },

      createTeam: ({ name, description = '' }) => {
        const trimmedName = (name || '').trim();
        if (!trimmedName) return;

        const newTeam = {
          id: `team_${Date.now()}`,
          name: trimmedName,
          description: (description || '').trim(),
          matterCount: 0,
        };

        set((state) => ({
          teams: [...state.teams, newTeam],
          activeTeamId: newTeam.id,
        }));

        return newTeam;
      },

      createMatter: ({ title, teamId, isPrivate = false, leadCounsel = 'Narendar V', status = 'open' }) => {
        const trimmedTitle = (title || '').trim();
        if (!trimmedTitle) return;

        const state = get();
        const assignedTeam = state.teams.find((t) => t.id === teamId) || state.teams[0];
        const teamIdentifier = assignedTeam ? assignedTeam.id : 'team_dispute';
        const teamDisplayName = assignedTeam ? assignedTeam.name : 'Dispute Resolution';
        const isRestricted = Boolean(isPrivate || teamIdentifier === 'team_private');

        const newMatter = {
          id: `m_${Date.now()}`,
          teamId: teamIdentifier,
          teamName: teamDisplayName,
          title: trimmedTitle,
          status: status || 'open',
          leadCounsel: leadCounsel || 'Narendar V',
          isPrivate: isRestricted,
          lastUsed: true,
          openedAt: 'Today',
        };

        set((prev) => {
          const updatedTeams = prev.teams.map((t) =>
            t.id === teamIdentifier ? { ...t, matterCount: (t.matterCount || 0) + 1 } : t
          );

          const updatedMatters = [
            newMatter,
            ...prev.matters.map((m) => ({ ...m, lastUsed: false })),
          ];

          return {
            matters: updatedMatters,
            teams: updatedTeams,
            activeMatterId: newMatter.id,
            activeTeamId: newMatter.teamId,
          };
        });

        return newMatter;
      },
    }),
    {
      name: 'lexamplify_org_store_v1',
    }
  )
);

export default useOrgStore;
