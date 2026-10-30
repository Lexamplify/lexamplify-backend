// Local user identity for presence + collaboration cursors.
// Client-side only (no backend) — persisted per browser.

const KEY = 'lx-collab-identity-v1';

const PALETTE = ['#2563C9', '#0E7C66', '#B45309', '#9333EA', '#DC2626', '#0891B2', '#CA8A04', '#DB2777'];
const NAMES = ['Aarav Advocate', 'Senior Partner', 'Priya Counsel', 'Rohan Associate', 'Meera Paralegal'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function getIdentity() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const id = {
    id: 'u_' + Math.random().toString(36).slice(2, 10),
    name: rand(NAMES),
    color: rand(PALETTE),
  };
  try { localStorage.setItem(KEY, JSON.stringify(id)); } catch { /* ignore */ }
  return id;
}

export function setIdentity(patch) {
  const next = { ...getIdentity(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

export { PALETTE };
