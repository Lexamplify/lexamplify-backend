// Blue-palette mandate regression test.
// The live app (pages/* + shell/* + the governed shared styles) must contain no
// off-palette colour literals — everything derives from the slate-pro tokens in
// styles/theme.css (--accent #2563C9 family, --ok/--warn/--risk, navy shadows).
// Runs offline against the source tree: no network, no AI, zero spend.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(process.cwd(), 'src');

// Marketing/auth surfaces have their own art direction; the mandate covers the internal app.
const EXCLUDE_PAGES = new Set([
  'Landing.jsx', 'Login.jsx', 'Signup.jsx', 'FeaturesPage.jsx', 'HowPage.jsx',
  'FaqPage.jsx', 'HeroFilm.jsx', 'HeroPreview.jsx', 'FeatureShowcase.jsx', 'Soon.jsx',
]);

// Shared styles the mandate governs (themes.css/index.css hold legacy theme defs and are exempt).
const GOVERNED_STYLES = [
  'theme.css', 'shell.css', 'pages.css', 'luxury-system.css',
  'studio.css', 'workspace-switcher.css', 'workspaces-page.css',
];

// Warm-luxury golds/greens, brick/stale status hexes, and raw Tailwind colours.
const FORBIDDEN_HEX = [
  'b08d57', 'c99a4a', 'cdb07d', 'c0392b', 'd68910', '2d7a3e', '177d5d', '0b7a60',
  'b53535', 'ef4444', 'f97316', 'eab308', '84cc16', '16a34a', '10b981', '3b82f6',
  '2a5a8a', '6a3fa0', 'fff3cd', '8a5a00', 'c38a00', 'f59e0b', '1a2e22', '16271d',
];
// rgba()/rgb() triples of the same families (whitespace-insensitive).
const FORBIDDEN_RGB = [
  '178,74,46', '220,60,60', '176,141,87', '26,46,34', '10,14,11', '233,228,214',
  '62,114,86', '12,20,16', '239,68,68', '245,158,11', '16,185,129', '59,130,246',
  '70,130,180', '140,82,190', '23,125,93', '192,57,43',
];

function listFiles(dir, filter) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(filter).map((f) => path.join(dir, f));
}

const targets = [
  ...listFiles(path.join(SRC, 'pages'), (f) => f.endsWith('.jsx') && !EXCLUDE_PAGES.has(f)),
  ...listFiles(path.join(SRC, 'shell'), (f) => f.endsWith('.jsx')),
  ...GOVERNED_STYLES.map((f) => path.join(SRC, 'styles', f)).filter((p) => fs.existsSync(p)),
];

describe('blue palette mandate — no off-palette colour literals in the live app', () => {
  it('found files to check', () => {
    expect(targets.length).toBeGreaterThan(20);
  });
  for (const file of targets) {
    it(path.relative(SRC, file).replace(/\\/g, '/'), () => {
      const raw = fs.readFileSync(file, 'utf8').toLowerCase();
      const squashed = raw.replace(/\s+/g, '');
      const hits = [
        ...FORBIDDEN_HEX.filter((h) => raw.includes('#' + h)),
        ...FORBIDDEN_RGB.filter((t) => squashed.includes('(' + t)),
      ];
      expect(hits, `off-palette colours in ${path.basename(file)}: ${hits.join(', ')}`).toEqual([]);
    });
  }
});
