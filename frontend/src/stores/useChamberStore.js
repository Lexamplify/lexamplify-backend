import { create } from 'zustand';

// ── DEFAULT SAMPLE DOSSIERS (Mockup Parity & Legal Fidelity) ─────────────
const DEFAULT_DOSSIERS = [
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
];

const getStoredItem = (key, fallback) => {
  if (typeof window === 'undefined' || !window.sessionStorage) return fallback;
  try {
    return window.sessionStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const setStoredItem = (key, value) => {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Ignore storage quota or security errors
  }
};

export const useChamberStore = create((set, get) => ({
  activeMatterId: getStoredItem('cr_active_matter_id', 'mat_01'),
  activeBench: getStoredItem('cr_active_bench', 'Commercial Appellate Bench'),
  filterArchetype: 'all',
  filterForum: 'all',
  searchQuery: '',
  hasUnsavedChanges: false,
  matters: DEFAULT_DOSSIERS,

  setActiveMatter: (id, bypassGuard = false) => {
    const state = get();
    if (state.hasUnsavedChanges && !bypassGuard) {
      return false;
    }
    setStoredItem('cr_active_matter_id', id);
    set({
      activeMatterId: id,
      matters: state.matters.map((m) =>
        m.id === id ? { ...m, lastAccessedAt: new Date().toISOString() } : m
      ),
    });
    return true;
  },

  setActiveBench: (benchName) => {
    setStoredItem('cr_active_bench', benchName);
    set({ activeBench: benchName });
  },

  setFilterArchetype: (type) => {
    set({ filterArchetype: type });
  },

  setForumFilter: (forum) => {
    set({ filterForum: forum });
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
  },

  setUnsavedChanges: (dirty) => {
    set({ hasUnsavedChanges: Boolean(dirty) });
  },

  addMatter: (newMatter) => {
    set((state) => {
      const updatedMatters = [newMatter, ...state.matters];
      setStoredItem('cr_active_matter_id', newMatter.id);
      return {
        matters: updatedMatters,
        activeMatterId: newMatter.id,
      };
    });
  },
}));

export default useChamberStore;
