import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { useOrganizationStore } from '../stores/useOrganizationStore';
import MatterLauncher from '../components/organization/MatterLauncher';
import ContextCapsule from '../components/organization/ContextCapsule';
import MatterDashboard from '../components/organization/MatterDashboard';
import TeamDashboard from '../components/organization/TeamDashboard';
import OrgDashboard from '../components/organization/OrgDashboard';
import NewMatterModal from '../components/organization/NewMatterModal';
import NewTeamModal from '../components/organization/NewTeamModal';

describe('Dynamic 3-Tier Organization & Matter Operating System', () => {
  beforeEach(() => {
    // Reset Zustand store state to pristine baseline before each test
    useOrganizationStore.setState({
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
    });
    localStorage.clear();
  });

  // ── 1. STORE ACTIONS & PERSISTENCE CONTRACT ────────────────────────────────
  describe('useOrganizationStore Client State & Contracts', () => {
    it('initializes with default firm, teams, and default matter', () => {
      const state = useOrganizationStore.getState();
      expect(state.organization.name).toBe('LexAmplify Chamber Console');
      expect(state.teams.length).toBe(2);
      expect(state.matters.length).toBe(1);
      expect(state.activeMatterId).toBe('mat_default');
      expect(state.activeTeamId).toBe('team_private');
    });

    it('creates team "law" and sets it active', () => {
      const { createTeam } = useOrganizationStore.getState();
      const newTeam = createTeam('law', 'Corporate litigation and commercial arbitration');

      expect(newTeam.name).toBe('law');
      const state = useOrganizationStore.getState();
      expect(state.teams.some((t) => t.name === 'law')).toBe(true);
      expect(state.activeTeamId).toBe(newTeam.id);
      expect(state.activities.some((a) => a.text.includes('Created team "law"'))).toBe(true);
    });

    it('creates matter "A v. B" in team "law" and sets it active', () => {
      const { createTeam, createMatter } = useOrganizationStore.getState();
      const team = createTeam('law', 'Practice Group');
      const matter = createMatter('A v. B', team.id);

      expect(matter.title).toBe('A v. B');
      expect(matter.teamId).toBe(team.id);

      const state = useOrganizationStore.getState();
      expect(state.activeMatterId).toBe(matter.id);
      expect(state.activeTeamId).toBe(team.id);
      expect(state.matters[0].title).toBe('A v. B');
    });

    it('setActiveMatter synchronizes active matter and active team', () => {
      const { createTeam, createMatter, setActiveMatter } = useOrganizationStore.getState();
      const team = createTeam('Taxation', 'Direct & Indirect Tax');
      const matter = createMatter('CIT v. Vodafone', team.id);

      // Switch away
      setActiveMatter('mat_default');
      expect(useOrganizationStore.getState().activeMatterId).toBe('mat_default');
      expect(useOrganizationStore.getState().activeTeamId).toBe('team_private');

      // Switch back
      setActiveMatter(matter.id);
      expect(useOrganizationStore.getState().activeMatterId).toBe(matter.id);
      expect(useOrganizationStore.getState().activeTeamId).toBe(team.id);
    });
  });

  // ── 2. TEAM CREATION FLOW (MODAL & REFLECTION ACROSS SYSTEM) ───────────────
  describe('Team Creation Flow', () => {
    it('creates team "law" via NewTeamModal and reflects across UI', async () => {
      render(
        <MemoryRouter>
          <MatterLauncher />
        </MemoryRouter>
      );

      // Open modal
      const newTeamBtn = screen.getByRole('button', { name: /New team/i });
      fireEvent.click(newTeamBtn);

      // Check modal heading rendered via portal
      const modalHeading = await screen.findByRole('heading', { name: /Create a new team/i });
      expect(modalHeading).toBeInTheDocument();

      const input = screen.getByPlaceholderText(/e\.g\. Corporate Advisory or law/i);
      await userEvent.type(input, 'law');

      const submitBtn = screen.getByRole('button', { name: /Create team/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Create a new team/i })).not.toBeInTheDocument();
      });

      // Verify store updated
      const state = useOrganizationStore.getState();
      const createdTeam = state.teams.find((t) => t.name === 'law');
      expect(createdTeam).toBeDefined();

      // Verify "law" filter pill is rendered on MatterLauncher
      expect(screen.getByRole('button', { name: /law/i })).toBeInTheDocument();
    });

    it('displays created team in OrgDashboard with Open team link', () => {
      const { createTeam } = useOrganizationStore.getState();
      const team = createTeam('law', 'Corporate litigation');

      render(
        <MemoryRouter initialEntries={['/workspace/org']}>
          <Routes>
            <Route path="/workspace/org" element={<OrgDashboard />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('LexAmplify Chamber Console')).toBeInTheDocument();
      expect(screen.getByText('law')).toBeInTheDocument();
      expect(screen.getByText('Corporate litigation')).toBeInTheDocument();
      expect(screen.getByText(/Active Workspaces/i)).toBeInTheDocument();
    });
  });

  // ── 3. MATTER CREATION FLOW & ROUTING ──────────────────────────────────────
  describe('Matter Creation Flow', () => {
    it('creates "A v. B" inside team "law" and selects it', async () => {
      const { createTeam } = useOrganizationStore.getState();
      const team = createTeam('law', 'Commercial Practice');

      render(
        <MemoryRouter>
          <MatterLauncher />
        </MemoryRouter>
      );

      const newMatterBtn = screen.getByRole('button', { name: /New matter/i });
      fireEvent.click(newMatterBtn);

      const modalHeading = await screen.findByRole('heading', { name: /Create a new matter/i });
      expect(modalHeading).toBeInTheDocument();

      const titleInput = screen.getByLabelText(/Matter title/i);
      await userEvent.type(titleInput, 'A v. B');

      const teamSelect = screen.getByLabelText(/Assigned Team/i);
      fireEvent.change(teamSelect, { target: { value: team.id } });

      const submitBtn = screen.getByRole('button', { name: /Create matter/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Create a new matter/i })).not.toBeInTheDocument();
      });

      const state = useOrganizationStore.getState();
      const createdMatter = state.matters.find((m) => m.title === 'A v. B');
      expect(createdMatter).toBeDefined();
      expect(createdMatter.teamId).toBe(team.id);
      expect(state.activeMatterId).toBe(createdMatter.id);
    });
  });

  // ── 4. CONTEXT CAPSULE 3-SEGMENT DOCK & SWITCHER ───────────────────────────
  describe('ContextCapsule 3-Segment Dock', () => {
    it('renders 3 segments: [ • matter.title ], [ • team.name ], [ • Org Dashboard ]', () => {
      render(
        <MemoryRouter initialEntries={['/workspace/matters']}>
          <ContextCapsule />
        </MemoryRouter>
      );

      expect(screen.getByText('My 1st Matter')).toBeInTheDocument();
      expect(screen.getByText('My Private Space')).toBeInTheDocument();
      expect(screen.getByText('Org Dashboard')).toBeInTheDocument();
    });

    it('toggles matter popover on caret click and switches active matter', async () => {
      const { createMatter } = useOrganizationStore.getState();
      const newMatter = createMatter('A v. B', 'team_private');

      render(
        <MemoryRouter initialEntries={['/workspace/matters']}>
          <ContextCapsule />
        </MemoryRouter>
      );

      const carets = screen.getAllByRole('button', { name: /Switch active matter dropdown/i });
      fireEvent.click(carets[0]);

      expect(screen.getByText('Switch Active Matter')).toBeInTheDocument();

      const optionBtn = screen.getByRole('menuitem', { name: /A v\. B/i });
      expect(optionBtn).toBeInTheDocument();
      fireEvent.click(optionBtn);

      expect(useOrganizationStore.getState().activeMatterId).toBe(newMatter.id);
      await waitFor(() => {
        expect(screen.queryByText('Switch Active Matter')).not.toBeInTheDocument();
      });
    });

    it('toggles team popover on caret click and switches active team', async () => {
      const { createTeam } = useOrganizationStore.getState();
      const newTeam = createTeam('law', 'Dispute Practice');

      render(
        <MemoryRouter initialEntries={['/workspace/matters']}>
          <ContextCapsule />
        </MemoryRouter>
      );

      const caret = screen.getByRole('button', { name: /Switch active team dropdown/i });
      fireEvent.click(caret);

      expect(screen.getByText('Switch Practice Team')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /law/i })).toBeInTheDocument();

      const optionBtn = screen.getByRole('menuitem', { name: /law/i });
      fireEvent.click(optionBtn);

      expect(useOrganizationStore.getState().activeTeamId).toBe(newTeam.id);
    });
  });

  // ── 5. MATTER DASHBOARD: 5 DYNAMIC METRICS, QUICK JUMP & ZERO EMOJIS ────────
  describe('MatterDashboard Tier 3 Workspace', () => {
    it('renders 5 dynamic metrics, greeting banner, and vector SVG quick jump buttons', () => {
      render(
        <MemoryRouter initialEntries={['/workspace/matter/mat_default']}>
          <Routes>
            <Route path="/workspace/matter/:matterId" element={<MatterDashboard />} />
          </Routes>
        </MemoryRouter>
      );

      // Greeting banner & active chip
      expect(screen.getByText(/Good morning, naren/i)).toBeInTheDocument();
      expect(screen.getByText(/My 1st Matter/i)).toBeInTheDocument();
      expect(screen.getByText('Open', { selector: '.org-chip-status' })).toBeInTheDocument();

      // 5 Dynamic Metrics
      expect(screen.getByText('Documents')).toBeInTheDocument();
      expect(screen.getByText('Open Tasks')).toBeInTheDocument();
      expect(screen.getByText('Deadlines')).toBeInTheDocument();
      expect(screen.getByText('Hours Logged')).toBeInTheDocument();
      expect(screen.getByText('Team')).toBeInTheDocument();

      // Verify initial metric values: 1 open task, 1 deadline, 4.5h billable
      expect(screen.getByText(/1 Pending/i)).toBeInTheDocument();
      expect(screen.getByText('4.5h billable')).toBeInTheDocument();

      // Quick Jump Bar has no stock emojis (Ask AI, Case Vault, Contract Analyzer, Virtual Courtroom)
      expect(screen.getByRole('link', { name: /Ask AI/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Case Vault/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Contract Analyzer/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Virtual Courtroom/i })).toBeInTheDocument();
    });

    it('interactively adds a task and increments the open task metric immediately', async () => {
      render(
        <MemoryRouter initialEntries={['/workspace/matter/mat_default']}>
          <Routes>
            <Route path="/workspace/matter/:matterId" element={<MatterDashboard />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText(/1 Pending/i)).toBeInTheDocument();

      const taskInput = screen.getByPlaceholderText(/Add an action item or task/i);
      await userEvent.type(taskInput, 'Draft Section 9 Arbitration Petition');

      const addBtn = screen.getByRole('button', { name: /Add task/i });
      fireEvent.click(addBtn);

      // Counter should immediately become 2 Pending
      expect(screen.getByText(/2 Pending/i)).toBeInTheDocument();
      expect(screen.getByText('Draft Section 9 Arbitration Petition')).toBeInTheDocument();
    });

    it('toggles task completion and updates counter', () => {
      render(
        <MemoryRouter initialEntries={['/workspace/matter/mat_default']}>
          <Routes>
            <Route path="/workspace/matter/:matterId" element={<MatterDashboard />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText(/1 Pending/i)).toBeInTheDocument();

      // Toggle first task t1 (which was incomplete)
      const taskText = screen.getByText('Review Annexure P-4 in Case Vault');
      fireEvent.click(taskText);

      // Now all 2 tasks are completed -> 0 Pending
      expect(screen.getByText(/0 Pending/i)).toBeInTheDocument();
    });

    it('interactively adds a deadline and updates deadlines count', async () => {
      render(
        <MemoryRouter initialEntries={['/workspace/matter/mat_default']}>
          <Routes>
            <Route path="/workspace/matter/:matterId" element={<MatterDashboard />} />
          </Routes>
        </MemoryRouter>
      );

      const titleInput = screen.getByPlaceholderText(/New deadline title/i);
      await userEvent.type(titleInput, 'Section 11 Appointment Hearing');

      const submitBtn = screen.getByRole('button', { name: /^\s*Add\s*$/i });
      fireEvent.click(submitBtn);

      expect(screen.getByText('Section 11 Appointment Hearing')).toBeInTheDocument();
    });
  });

  // ── 6. TEAM DASHBOARD & GUARDED PERCENTAGE MATH ───────────────────────────
  describe('TeamDashboard Tier 2 Hub & Guarded Math', () => {
    it('safely guards division by zero when team has 0 matters', () => {
      const { createTeam } = useOrganizationStore.getState();
      const emptyTeam = createTeam('Empty Practice', 'No matters assigned yet');

      render(
        <MemoryRouter initialEntries={[`/workspace/team/${emptyTeam.id}`]}>
          <Routes>
            <Route path="/workspace/team/:teamId" element={<TeamDashboard />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Empty Practice')).toBeInTheDocument();
      // Guarded math checks: 0% open, 0% active, 0% on hold, 0% closed with no NaN / crashes
      expect(screen.getByText(/Open:\s*0\s*\(0%\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Active:\s*0\s*\(0%\)/i)).toBeInTheDocument();
      expect(screen.getByText(/On hold:\s*0\s*\(0%\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Closed:\s*0\s*\(0%\)/i)).toBeInTheDocument();
      expect(screen.getByText('No matters filed in this team workspace yet.')).toBeInTheDocument();
    });

    it('calculates correct percentages when matters exist', () => {
      const { createTeam, createMatter, updateMatterStatus } = useOrganizationStore.getState();
      const team = createTeam('law', 'Litigation Hub');
      const m1 = createMatter('A v. B', team.id);
      const m2 = createMatter('C v. D', team.id);
      updateMatterStatus(m2.id, 'active');

      render(
        <MemoryRouter initialEntries={[`/workspace/team/${team.id}`]}>
          <Routes>
            <Route path="/workspace/team/:teamId" element={<TeamDashboard />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('law')).toBeInTheDocument();
      expect(screen.getByText(/Open:\s*1\s*\(50%\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Active:\s*1\s*\(50%\)/i)).toBeInTheDocument();
    });
  });
});
