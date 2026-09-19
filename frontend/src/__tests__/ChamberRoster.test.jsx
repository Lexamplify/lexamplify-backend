import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { useChamberStore } from '../stores/useChamberStore';
import ChamberRoster from '../components/chamber/ChamberRoster';
import MatterDossierCard from '../components/chamber/MatterDossierCard';
import ChamberSwitcher from '../components/chamber/ChamberSwitcher';
import NewDossierModal from '../components/chamber/NewDossierModal';

describe('Chamber Roster (v1) - Legal Workspace Docket', () => {
  beforeEach(() => {
    // Reset session storage and store
    sessionStorage.clear();
    useChamberStore.setState({
      activeMatterId: 'mat_01',
      activeBench: 'Commercial Appellate Bench',
      filterArchetype: 'all',
      filterForum: 'all',
      searchQuery: '',
      hasUnsavedChanges: false,
      matters: [
        {
          id: 'mat_01',
          title: 'Tata Sons Pvt. Ltd. v. Cyrus Investments LLC',
          matterType: 'litigation',
          status: 'active',
          teamId: 'bench_comm_appellate',
          teamName: 'Commercial Appellate Bench',
          isPrivateChamber: false,
          isRestricted: false,
          counsel: {
            leadPartner: 'Dr. A. M. Singhvi, Sr. Adv.',
            advocateOnRecord: 'K. Parameshwar, AoR',
            leadAssociate: 'Narendar V',
          },
          forum: {
            name: 'Supreme Court of India',
            benchOrVenue: 'Court 3, Item 14',
            stage: 'Admission Hearing',
            nextDate: '24 Sep 2026',
            urgency: 'critical',
          },
          ecourtsSync: {
            cnrNumber: 'DLHC01-004821-2026',
            isListedToday: true,
            syncedAt: '2026-09-18T08:30:00Z',
          },
          integrity: {
            conflictStatus: 'clear',
            conflictDetail: 'No conflicting party found across 4 chamber vaults',
            wallEnforced: false,
          },
          telemetry: {
            vaultDocuments: 142,
            flaggedRisks: 3,
            simulationsRun: 12,
          },
          lastAccessedAt: '2026-09-18T10:15:00Z',
        },
        {
          id: 'mat_02',
          title: 'Metro Rail Corp v. EPC Consortium',
          matterType: 'arbitration',
          status: 'open',
          teamId: 'bench_arb_infra',
          teamName: 'Arbitration & Infrastructure',
          isPrivateChamber: false,
          isRestricted: true,
          counsel: {
            leadPartner: 'Saurabh M',
            advocateOnRecord: undefined,
            leadAssociate: 'Pooja K',
          },
          forum: {
            name: 'Arbitral Tribunal (MCIA)',
            benchOrVenue: 'Sole Arbitrator: Justice (Retd.) R. V. Raveendran',
            stage: 'Statement of Claim',
            nextDate: '02 Oct 2026',
            urgency: 'normal',
          },
          ecourtsSync: undefined,
          integrity: {
            conflictStatus: 'clear',
            conflictDetail: 'Ethical wall shielding against EPC affiliate',
            wallEnforced: true,
          },
          telemetry: {
            vaultDocuments: 89,
            flaggedRisks: 0,
            simulationsRun: 4,
          },
          lastAccessedAt: '2026-09-17T16:20:00Z',
        },
        {
          id: 'mat_03',
          title: 'Union of India v. Reliance Petrochemicals',
          matterType: 'litigation',
          status: 'active',
          teamId: 'bench_comm_appellate',
          teamName: 'Commercial Appellate Bench',
          isPrivateChamber: false,
          isRestricted: false,
          counsel: {
            leadPartner: 'Yogesh K',
            advocateOnRecord: 'P. Venkat, AoR',
            leadAssociate: 'Narendar V',
          },
          forum: {
            name: 'Delhi High Court',
            benchOrVenue: 'Court 12, Item 28',
            stage: 'Final Arguments',
            nextDate: '21 Sep 2026',
            urgency: 'critical',
          },
          ecourtsSync: {
            cnrNumber: 'DLHC01-001294-2025',
            isListedToday: true,
            syncedAt: '2026-09-18T09:12:00Z',
          },
          integrity: {
            conflictStatus: 'clash_flagged',
            conflictDetail: 'Adverse interest flagged in Reliance Retail advisory matter',
            wallEnforced: false,
          },
          telemetry: {
            vaultDocuments: 215,
            flaggedRisks: 8,
            simulationsRun: 18,
          },
          lastAccessedAt: '2026-09-18T11:45:00Z',
        },
        {
          id: 'mat_04',
          title: 'Acme Pharma Acquisition & IP Restructuring',
          matterType: 'advisory',
          status: 'open',
          teamId: 'bench_corp_ma',
          teamName: 'Corporate M&A Advisory',
          isPrivateChamber: false,
          isRestricted: true,
          counsel: {
            leadPartner: 'Narendar V',
            advocateOnRecord: undefined,
            leadAssociate: 'Team M&A',
          },
          forum: {
            name: 'Corporate Advisory',
            benchOrVenue: 'Closing Date: 15 Oct 2026',
            stage: 'Due Diligence & Playbook Audit',
            nextDate: '15 Oct 2026',
            urgency: 'caution',
          },
          ecourtsSync: undefined,
          integrity: {
            conflictStatus: 'clear',
            conflictDetail: 'No conflict detected across target entity',
            wallEnforced: true,
          },
          telemetry: {
            vaultDocuments: 64,
            flaggedRisks: 5,
            simulationsRun: 0,
          },
          lastAccessedAt: '2026-09-16T14:00:00Z',
        },
      ],
    });
  });

  // ── 1. useChamberStore Contract Tests ─────────────────────────────────────
  describe('useChamberStore data contract and actions', () => {
    it('initializes with 4 sample dossiers across litigation, arbitration, and advisory', () => {
      const state = useChamberStore.getState();
      expect(state.matters).toHaveLength(4);
      expect(state.activeMatterId).toBe('mat_01');
      expect(state.activeBench).toBe('Commercial Appellate Bench');

      const archetypes = state.matters.map((m) => m.matterType);
      expect(archetypes).toContain('litigation');
      expect(archetypes).toContain('arbitration');
      expect(archetypes).toContain('advisory');
    });

    it('setActiveMatter sets active matter and syncs to sessionStorage', () => {
      const { setActiveMatter } = useChamberStore.getState();
      const success = setActiveMatter('mat_02');

      expect(success).toBe(true);
      expect(useChamberStore.getState().activeMatterId).toBe('mat_02');
      expect(sessionStorage.getItem('cr_active_matter_id')).toBe('mat_02');
    });

    it('setActiveMatter respects hasUnsavedChanges dirty guard', () => {
      useChamberStore.setState({ hasUnsavedChanges: true });
      const { setActiveMatter } = useChamberStore.getState();

      const blocked = setActiveMatter('mat_02');
      expect(blocked).toBe(false);
      expect(useChamberStore.getState().activeMatterId).toBe('mat_01');

      const bypassed = setActiveMatter('mat_02', true);
      expect(bypassed).toBe(true);
      expect(useChamberStore.getState().activeMatterId).toBe('mat_02');
    });

    it('setActiveBench updates active bench and persists to sessionStorage', () => {
      const { setActiveBench } = useChamberStore.getState();
      setActiveBench('Arbitration & Infrastructure');

      expect(useChamberStore.getState().activeBench).toBe('Arbitration & Infrastructure');
      expect(sessionStorage.getItem('cr_active_bench')).toBe('Arbitration & Infrastructure');
    });

    it('addMatter prepends new dossier and sets it active', () => {
      const { addMatter } = useChamberStore.getState();
      const newDossier = {
        id: 'mat_in_2026_9999',
        title: 'Adani Ports v. Union of India',
        matterType: 'litigation',
        status: 'open',
        teamId: 'team_litigation',
        teamName: 'Commercial Appellate Bench',
        isPrivateChamber: false,
        isRestricted: false,
        counsel: {
          leadPartner: 'Dr. A. M. Singhvi, Sr. Adv.',
          leadAssociate: 'Narendar V',
        },
        forum: {
          name: 'Supreme Court of India',
          stage: 'SLP Admission',
          nextDate: '29 Sep 2026',
          urgency: 'critical',
        },
        integrity: {
          conflictStatus: 'clear',
          wallEnforced: false,
        },
        telemetry: {
          vaultDocuments: 1,
          flaggedRisks: 0,
          simulationsRun: 0,
        },
        lastAccessedAt: new Date().toISOString(),
      };

      addMatter(newDossier);

      const state = useChamberStore.getState();
      expect(state.matters).toHaveLength(5);
      expect(state.matters[0].id).toBe('mat_in_2026_9999');
      expect(state.activeMatterId).toBe('mat_in_2026_9999');
      expect(sessionStorage.getItem('cr_active_matter_id')).toBe('mat_in_2026_9999');
    });
  });

  // ── 2. ChamberRoster Workspace View Tests ─────────────────────────────────
  describe('ChamberRoster Workspace View', () => {
    it('renders Fraunces italic masthead and 4-segment archetype pills', () => {
      render(
        <MemoryRouter>
          <ChamberRoster />
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { level: 1, name: /Chamber Roster/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /New Case Dossier/i })).toBeInTheDocument();

      expect(screen.getByRole('button', { name: /All Matters \(4\)/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Litigation \(2\)/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Arbitration \(1\)/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Advisory & M&A \(1\)/i })).toBeInTheDocument();
    });

    it('filters dossiers by clicking archetype filter pills', async () => {
      render(
        <MemoryRouter>
          <ChamberRoster />
        </MemoryRouter>
      );

      // Initially All 4 matters visible
      expect(screen.getByText('Tata Sons Pvt. Ltd. v. Cyrus Investments LLC')).toBeInTheDocument();
      expect(screen.getByText('Metro Rail Corp v. EPC Consortium')).toBeInTheDocument();
      expect(screen.getByText('Acme Pharma Acquisition & IP Restructuring')).toBeInTheDocument();

      // Click Litigation
      const litBtn = screen.getByRole('button', { name: /Litigation \(2\)/i });
      fireEvent.click(litBtn);

      expect(screen.getByText('Tata Sons Pvt. Ltd. v. Cyrus Investments LLC')).toBeInTheDocument();
      expect(screen.getByText('Union of India v. Reliance Petrochemicals')).toBeInTheDocument();
      expect(screen.queryByText('Metro Rail Corp v. EPC Consortium')).not.toBeInTheDocument();
      expect(screen.queryByText('Acme Pharma Acquisition & IP Restructuring')).not.toBeInTheDocument();

      // Click Arbitration
      const arbBtn = screen.getByRole('button', { name: /Arbitration \(1\)/i });
      fireEvent.click(arbBtn);

      expect(screen.getByText('Metro Rail Corp v. EPC Consortium')).toBeInTheDocument();
      expect(screen.queryByText('Tata Sons Pvt. Ltd. v. Cyrus Investments LLC')).not.toBeInTheDocument();
    });

    it('debounces search input and filters dossiers', async () => {
      render(
        <MemoryRouter>
          <ChamberRoster />
        </MemoryRouter>
      );

      const searchInput = screen.getByPlaceholderText(/Search caption, CNR, or counsel/i);
      await userEvent.type(searchInput, 'Reliance');

      await waitFor(() => {
        expect(screen.getByText('Union of India v. Reliance Petrochemicals')).toBeInTheDocument();
        expect(screen.queryByText('Tata Sons Pvt. Ltd. v. Cyrus Investments LLC')).not.toBeInTheDocument();
      });
    });

    it('filters dossiers by forum dropdown', () => {
      render(
        <MemoryRouter>
          <ChamberRoster />
        </MemoryRouter>
      );

      const forumSelect = screen.getByLabelText(/Filter by forum/i);
      fireEvent.change(forumSelect, { target: { value: 'High Court' } });

      expect(screen.getByText('Union of India v. Reliance Petrochemicals')).toBeInTheDocument();
      expect(screen.queryByText('Tata Sons Pvt. Ltd. v. Cyrus Investments LLC')).not.toBeInTheDocument();
    });
  });

  // ── 3. MatterDossierCard Tests ────────────────────────────────────────────
  describe('MatterDossierCard Component', () => {
    it('renders 3-column polymorphic dossier with CNR sync pulse and badges', () => {
      const litMatter = useChamberStore.getState().matters[0];
      render(
        <MemoryRouter>
          <MatterDossierCard matter={litMatter} />
        </MemoryRouter>
      );

      // Col 1: Identity
      expect(screen.getByText('litigation')).toBeInTheDocument();
      expect(screen.getByText('DLHC01-004821-2026')).toBeInTheDocument();
      expect(screen.getByText('Tata Sons Pvt. Ltd. v. Cyrus Investments LLC')).toBeInTheDocument();
      expect(screen.getByText(/Supreme Court of India · Court 3, Item 14/i)).toBeInTheDocument();

      // Col 2: Posture
      expect(screen.getByText('Admission Hearing')).toBeInTheDocument();
      expect(screen.getByText('Listed: 24 Sep 2026')).toBeInTheDocument();
      expect(screen.getByText('Dr. A. M. Singhvi, Sr. Adv.')).toBeInTheDocument();
      expect(screen.getByText(/K\. Parameshwar, AoR/i)).toBeInTheDocument();

      // Col 3: Trust & Quick actions
      expect(screen.getByText('Shield Clear')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Vault' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Courtroom' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Analyzer' })).toBeInTheDocument();
    });

    it('renders conflict clash badge for conflicting matter', () => {
      const clashMatter = useChamberStore.getState().matters[2];
      render(
        <MemoryRouter>
          <MatterDossierCard matter={clashMatter} />
        </MemoryRouter>
      );

      expect(screen.getByText('⚠ Conflict Clash')).toBeInTheDocument();
    });

    it('renders ethical wall indicator for protected advisory matter', () => {
      const advMatter = useChamberStore.getState().matters[3];
      render(
        <MemoryRouter>
          <MatterDossierCard matter={advMatter} />
        </MemoryRouter>
      );

      expect(screen.getByText('🔒 Wall')).toBeInTheDocument();
      // Courtroom button should NOT render for advisory archetype
      expect(screen.queryByRole('button', { name: 'Courtroom' })).not.toBeInTheDocument();
    });
  });

  // ── 4. ChamberSwitcher Tests ──────────────────────────────────────────────
  describe('ChamberSwitcher Component', () => {
    it('renders active practice bench and switches bench on selection', () => {
      render(<ChamberSwitcher variant="topbar" />);

      const toggleBtn = screen.getByRole('button', { name: /Practice Bench Switcher/i });
      expect(toggleBtn).toHaveTextContent('Commercial Appellate Bench');

      fireEvent.click(toggleBtn);
      expect(screen.getByText('Practice Benches')).toBeInTheDocument();

      const arbOption = screen.getByRole('menuitem', { name: /Arbitration & Infrastructure/i });
      fireEvent.click(arbOption);

      expect(useChamberStore.getState().activeBench).toBe('Arbitration & Infrastructure');
      expect(toggleBtn).toHaveTextContent('Arbitration & Infrastructure');
    });

    it('renders compact mode in collapsed sidebar', () => {
      render(<ChamberSwitcher variant="sidebar" isCollapsed={true} />);

      const compactBtn = screen.getByRole('button', { name: /Switch Practice Bench/i });
      expect(compactBtn).toBeInTheDocument();
      expect(compactBtn).toHaveTextContent('⚖');
    });
  });

  // ── 5. NewDossierModal 3-Step Wizard Tests ─────────────────────────────────
  describe('NewDossierModal 3-Step Wizard', () => {
    it('dynamically switches input fields in Step 2 based on Step 1 archetype choice', async () => {
      render(<NewDossierModal isOpen={true} onClose={() => {}} />);

      // Step 1: Default is Litigation
      expect(screen.getByText('1. Classification')).toHaveClass('active');
      const nextBtn = screen.getByRole('button', { name: /Next: Identity →/i });
      fireEvent.click(nextBtn);

      // Step 2: Litigation inputs
      expect(screen.getByText('2. Identity & Sync')).toHaveClass('active');
      expect(screen.getByLabelText(/Case Caption/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/CNR Number \(eCourts Sync\)/i)).toBeInTheDocument();

      // Go back to Step 1 and change to Arbitration
      const backBtn = screen.getByRole('button', { name: /← Back/i });
      fireEvent.click(backBtn);

      const archetypeSelect = screen.getByLabelText(/Matter Archetype/i);
      fireEvent.change(archetypeSelect, { target: { value: 'arbitration' } });

      fireEvent.click(screen.getByRole('button', { name: /Next: Identity →/i }));

      // Step 2: Arbitration inputs
      expect(screen.getByLabelText(/Arbitration Matter Title/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Arbitral Institution \/ Rules/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Seat & Presiding Arbitrator/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/CNR Number/i)).not.toBeInTheDocument();
    });

    it('completes 3-step intake and registers new dossier', async () => {
      const handleClose = vi.fn();
      render(<NewDossierModal isOpen={true} onClose={handleClose} />);

      // Step 1
      fireEvent.click(screen.getByRole('button', { name: /Next: Identity →/i }));

      // Step 2
      const titleInput = screen.getByLabelText(/Case Caption/i);
      await userEvent.type(titleInput, 'State of Maharashtra v. Reliance Infra');

      const cnrInput = screen.getByLabelText(/CNR Number \(eCourts Sync\)/i);
      await userEvent.type(cnrInput, 'BOMHC01-009988-2026');

      fireEvent.click(screen.getByRole('button', { name: /Next: Governance →/i }));

      // Step 3
      expect(screen.getByText('3. Governance & Walls')).toHaveClass('active');
      const wallCheckbox = screen.getByLabelText(/Enforce Ethical Wall/i);
      fireEvent.click(wallCheckbox);

      const submitBtn = screen.getByRole('button', { name: /Register Dossier/i });
      fireEvent.click(submitBtn);

      expect(handleClose).toHaveBeenCalled();

      const latestMatter = useChamberStore.getState().matters[0];
      expect(latestMatter.title).toBe('State of Maharashtra v. Reliance Infra');
      expect(latestMatter.ecourtsSync?.cnrNumber).toBe('BOMHC01-009988-2026');
      expect(latestMatter.integrity.wallEnforced).toBe(true);
      expect(useChamberStore.getState().activeMatterId).toBe(latestMatter.id);
    });

    it('dismisses modal on Escape key', () => {
      let isOpen = true;
      const handleClose = () => { isOpen = false; };

      const { rerender } = render(
        <NewDossierModal isOpen={isOpen} onClose={handleClose} />
      );

      expect(screen.getByRole('heading', { name: /Open New Case Dossier/i })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(isOpen).toBe(false);

      rerender(<NewDossierModal isOpen={isOpen} onClose={handleClose} />);
      expect(screen.queryByRole('heading', { name: /Open New Case Dossier/i })).not.toBeInTheDocument();
    });
  });
});
