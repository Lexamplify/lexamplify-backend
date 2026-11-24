import { create } from 'zustand';

const API = import.meta.env.VITE_API_BASE_URL || '';

const useOnboardingStore = create((set, get) => ({
  loaded: false,
  role: null,
  firmName: '',
  onboarding: { wizard_completed: false, wizard_step: 0, tour_completed: false, tours_seen: [] },

  showWizard: false,
  tourRunning: false,
  tourSection: null,
  helpOpen: false,

  load: async () => {
    try {
      const [meRes, stRes] = await Promise.all([
        fetch(`${API}/api/practice/me`, { credentials: 'include' }),
        fetch(`${API}/api/practice/settings`, { credentials: 'include' }),
      ]);
      if (!meRes.ok || !stRes.ok) return;
      const me = await meRes.json();
      const st = await stRes.json();
      const role = me.member?.role || null;
      const ob = st.onboarding || { wizard_completed: false, wizard_step: 0, tour_completed: false, tours_seen: [] };
      const isNew = !ob.wizard_completed;
      set({
        loaded: true,
        role,
        firmName: st.firm_name || me.firm?.name || '',
        onboarding: ob,
        showWizard: isNew,
        tourRunning: false,
        tourSection: null,
      });
    } catch { /* silent — onboarding is non-blocking */ }
  },

  updateOnboarding: async (patch) => {
    const prev = get().onboarding;
    const next = { ...prev, ...patch };
    set({ onboarding: next });
    try {
      await fetch(`${API}/api/practice/settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding: patch }),
      });
    } catch { set({ onboarding: prev }); }
  },

  updateFirmName: async (name) => {
    set({ firmName: name });
    try {
      await fetch(`${API}/api/practice/settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firm_name: name }),
      });
    } catch { /* silent */ }
  },

  completeWizard: async () => {
    set({ showWizard: false });
    await get().updateOnboarding({ wizard_completed: true, wizard_step: 99 });
  },

  restartWizard: () => {
    set({ showWizard: true, helpOpen: false, tourRunning: false, tourSection: null });
    get().updateOnboarding({ wizard_completed: false, wizard_step: 0 });
  },

  startTour: (section = 'full') => set({ tourRunning: true, tourSection: section, helpOpen: false }),
  stopTour: () => set({ tourRunning: false, tourSection: null }),
  markTourSeen: async (section) => {
    const prev = get().onboarding.tours_seen || [];
    if (!prev.includes(section)) {
      await get().updateOnboarding({ tours_seen: [...prev, section], tour_completed: section === 'full' || undefined });
    }
  },

  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  closeHelp: () => set({ helpOpen: false }),
}));

export default useOnboardingStore;
