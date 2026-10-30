import { create } from 'zustand';

// v2 key forces the finalized Slate Pro default for everyone (ignores older saved prefs).
const KEY = 'lx-ui-settings-v2';
const DEFAULTS = { theme: 'slate-pro', layout: 'rail', type: 'serif', radius: 'soft', density: 'comfortable', accent: 'theme', text: 'md', motion: 'full' };

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function applySettings(s) {
  const r = document.documentElement;
  r.dataset.theme = s.theme;
  r.dataset.layout = s.layout;
  r.dataset.type = s.type;
  r.dataset.radius = s.radius;
  r.dataset.density = s.density;
  r.dataset.accent = s.accent || 'theme';
  r.dataset.text = s.text || 'md';
  r.dataset.motion = s.motion || 'full';
}

export const useSettings = create((set, get) => ({
  ...load(),
  update: (patch) => {
    const next = { ...get(), ...patch };
    applySettings(next);
    try { localStorage.setItem(KEY, JSON.stringify({ theme: next.theme, layout: next.layout, type: next.type, radius: next.radius, density: next.density, accent: next.accent, text: next.text, motion: next.motion })); } catch {}
    set(patch);
  },
  reset: () => get().update({ ...DEFAULTS }),
}));

// apply immediately on module load so there's no flash
applySettings(load());
