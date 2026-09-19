import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { useOrgStore } from '../store/useOrgStore';
import NewMatterModal from '../components/organization/NewMatterModal';
import NewTeamModal from '../components/organization/NewTeamModal';

describe('Phase 1: Organization & Matter Gateway', () => {
  beforeEach(() => {
    // Reset store to known baseline before each test
    useOrgStore.setState({
      currentOrg: {
        id: 'org_lexamplify',
        name: 'LexAmplify Law Partners',
        plan: 'Enterprise Trial',
      },
      teams: [
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
      ],
      matters: [
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
      ],
      activeMatterId: 'm1',
      activeTeamId: 'team_dispute',
    });
  });

  // ── 1. useOrgStore Contract Tests ─────────────────────────────────────────
  describe('useOrgStore client state contract', () => {
    it('initializes with expected organization, teams, and matters', () => {
      const state = useOrgStore.getState();
      expect(state.currentOrg.name).toBe('LexAmplify Law Partners');
      expect(state.teams.length).toBeGreaterThanOrEqual(4);
      expect(state.matters.length).toBeGreaterThanOrEqual(5);
      expect(state.activeMatterId).toBe('m1');
      expect(state.activeTeamId).toBe('team_dispute');
    });

    it('setActiveMatter switches active matter and synchronizes team', () => {
      const { setActiveMatter } = useOrgStore.getState();
      setActiveMatter('m2');

      const updated = useOrgStore.getState();
      expect(updated.activeMatterId).toBe('m2');
      expect(updated.activeTeamId).toBe('team_corp');
      const m2 = updated.matters.find((m) => m.id === 'm2');
      expect(m2.lastUsed).toBe(true);
    });

    it('createTeam adds a new team and sets it active', () => {
      const { createTeam } = useOrgStore.getState();
      const newTeam = createTeam({
        name: 'Infrastructure & Project Finance',
        description: 'Concession agreements and infrastructure PPPs',
      });

      expect(newTeam).toBeDefined();
      expect(newTeam.name).toBe('Infrastructure & Project Finance');

      const updated = useOrgStore.getState();
      expect(updated.teams.some((t) => t.name === 'Infrastructure & Project Finance')).toBe(true);
      expect(updated.activeTeamId).toBe(newTeam.id);
    });

    it('createMatter adds a matter to the grid and sets it active', () => {
      const { createMatter } = useOrgStore.getState();
      const newMatter = createMatter({
        title: 'Bharat Biotech v. Serum Institute',
        teamId: 'team_ip',
        leadCounsel: 'Dr. Anand S',
        status: 'open',
      });

      expect(newMatter).toBeDefined();
      expect(newMatter.title).toBe('Bharat Biotech v. Serum Institute');

      const updated = useOrgStore.getState();
      expect(updated.activeMatterId).toBe(newMatter.id);
      expect(updated.matters[0].title).toBe('Bharat Biotech v. Serum Institute');
      expect(updated.matters[0].lastUsed).toBe(true);
      const ipTeam = updated.teams.find((t) => t.id === 'team_ip');
      expect(ipTeam.matterCount).toBe(2);
    });
  });



  // ── 4. Modal Accessibility & Portals ──────────────────────────────────────
  describe('Modal Accessibility & Portal dismissals', () => {
    it('dismisses NewMatterModal on Escape key', () => {
      let isOpen = true;
      const handleClose = () => { isOpen = false; };

      const { rerender } = render(
        <NewMatterModal isOpen={isOpen} onClose={handleClose} />
      );

      expect(screen.getByRole('heading', { name: /Create a new matter/i })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(isOpen).toBe(false);

      rerender(<NewMatterModal isOpen={isOpen} onClose={handleClose} />);
      expect(screen.queryByRole('heading', { name: /Create a new matter/i })).not.toBeInTheDocument();
    });

    it('dismisses NewTeamModal on Cancel button click', () => {
      let isOpen = true;
      const handleClose = () => { isOpen = false; };

      const { rerender } = render(
        <NewTeamModal isOpen={isOpen} onClose={handleClose} />
      );

      const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
      fireEvent.click(cancelBtn);
      expect(isOpen).toBe(false);

      rerender(<NewTeamModal isOpen={isOpen} onClose={handleClose} />);
      expect(screen.queryByRole('heading', { name: /Create a new team/i })).not.toBeInTheDocument();
    });
  });
});
