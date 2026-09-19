import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useOrganizationStore = create(
  persist(
    (set, get) => ({
      organization: {
        id: 'org_lexamplify_main',
        name: 'LexAmplify Chamber Console',
        plan: 'Enterprise',
        totalAiRuns30d: 142,
      },
      activeOrgId: 'org_lexamplify_main',
      activeTeamId: 'team_private',
      activeMatterId: 'mat_default',
      teams: [
        {
          id: 'team_private',
          name: 'My Private Space',
          description: 'Personal confidential workspace for private drafts & advisory notes.',
          isPrivate: true,
          membersCount: 1,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'team_dispute',
          name: 'Dispute Resolution',
          description: 'High Court & Supreme Court appellate litigation practice group.',
          isPrivate: false,
          membersCount: 4,
          createdAt: new Date().toISOString(),
        },
      ],
      matters: [
        {
          id: 'mat_default',
          teamId: 'team_private',
          title: 'My 1st Matter',
          status: 'open',
          leadCounsel: 'Narendar V',
          openedAt: 'Sep 13, 2026',
          lastUsedAt: new Date().toISOString(),
          documentsCount: 3,
          tasksCount: 2,
          deadlinesCount: 1,
          hoursLogged: 4.5,
          deadlines: [
            { id: 'd1', title: 'Written Statement Limitation', date: '2026-09-28', urgency: 'urgent' },
          ],
          tasks: [
            { id: 't1', title: 'Review Annexure P-4 in Case Vault', completed: false },
            { id: 't2', title: 'Draft Vakalatnama for senior counsel', completed: true },
          ],
          documents: [
            { id: 'doc1', name: 'Plaint_Draft_v2.pdf', size: '2.4 MB', uploadedAt: 'Yesterday' },
          ],
          activity: [
            { id: 'a1', text: 'Created initial advisory brief', timestamp: 'Sep 13, 2026' },
          ],
        },
      ],
      activities: [
        { id: 'act_1', teamId: 'team_private', text: 'Opened matter "My 1st Matter"', timestamp: 'Sep 13, 2026' },
      ],
      setActiveMatter: (matterId) => {
        const matter = get().matters.find((m) => m.id === matterId);
        if (matter) {
          set({
            activeMatterId: matterId,
            activeTeamId: matter.teamId,
            matters: get().matters.map((m) =>
              m.id === matterId ? { ...m, lastUsedAt: new Date().toISOString() } : m
            ),
          });
        }
      },
      setActiveTeam: (teamId) => {
        set({ activeTeamId: teamId });
      },
      createTeam: (teamName, description = '') => {
        const uniqueSuffix = Math.random().toString(36).slice(2, 7);
        const newTeam = {
          id: `team_${Date.now()}_${uniqueSuffix}`,
          name: (teamName || '').trim(),
          description: (description || '').trim() || 'Collaborative practice workspace.',
          isPrivate: false,
          membersCount: 1,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          teams: [...state.teams, newTeam],
          activeTeamId: newTeam.id,
          activities: [
            { id: `act_${Date.now()}_${uniqueSuffix}`, teamId: newTeam.id, text: `Created team "${newTeam.name}"`, timestamp: 'Just now' },
            ...state.activities,
          ],
        }));
        return newTeam;
      },
      createMatter: (title, teamId) => {
        const uniqueSuffix = Math.random().toString(36).slice(2, 7);
        const targetTeam = get().teams.find((t) => t.id === teamId) || get().teams[0];
        const newMatter = {
          id: `mat_${Date.now()}_${uniqueSuffix}`,
          teamId: targetTeam.id,
          title: (title || '').trim(),
          status: 'open',
          leadCounsel: 'Narendar V',
          openedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          lastUsedAt: new Date().toISOString(),
          documentsCount: 0,
          tasksCount: 0,
          deadlinesCount: 0,
          hoursLogged: 0.0,
          deadlines: [],
          tasks: [],
          documents: [],
          activity: [
            { id: `act_${Date.now()}_${uniqueSuffix}`, text: `Opened matter "${(title || '').trim()}"`, timestamp: 'Just now' },
          ],
        };
        set((state) => ({
          matters: [newMatter, ...state.matters],
          activeMatterId: newMatter.id,
          activeTeamId: targetTeam.id,
          activities: [
            { id: `act_${Date.now()}_${uniqueSuffix}`, teamId: targetTeam.id, text: `Created matter "${newMatter.title}" in team "${targetTeam.name}"`, timestamp: 'Just now' },
            ...state.activities,
          ],
        }));
        return newMatter;
      },
      updateMatterStatus: (matterId, newStatus) => {
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === matterId ? { ...m, status: newStatus } : m
          ),
        }));
      },
      addTask: (matterId, taskTitle) => {
        const newTask = { id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, title: (taskTitle || '').trim(), completed: false };
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === matterId
              ? { ...m, tasks: [newTask, ...m.tasks], tasksCount: m.tasksCount + 1 }
              : m
          ),
        }));
      },
      toggleTask: (matterId, taskId) => {
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === matterId
              ? {
                  ...m,
                  tasks: m.tasks.map((t) =>
                    t.id === taskId ? { ...t, completed: !t.completed } : t
                  ),
                }
              : m
          ),
        }));
      },
      addDeadline: (matterId, deadlineData) => {
        const newDeadline = { id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ...deadlineData };
        set((state) => ({
          matters: state.matters.map((m) =>
            m.id === matterId
              ? { ...m, deadlines: [...m.deadlines, newDeadline], deadlinesCount: m.deadlinesCount + 1 }
              : m
          ),
        }));
      },
    }),
    {
      name: 'lexamplify-organization-store',
    }
  )
);

export default useOrganizationStore;
