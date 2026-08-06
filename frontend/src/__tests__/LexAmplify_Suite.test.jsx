/**
 * frontend/src/__tests__/LexAmplify_Suite.test.jsx
 * Render + tab-switch smoke suite across all 10 LexAmplify modules:
 *   1. Advocate Dashboard        6. Case Vault
 *   2. Contract Analyzer         7. Virtual Courtroom / War Room
 *   3. Court Directory & Resources 8. Firm Library
 *   4. Conflict Engine           9. Legal Forms Library
 *   5. Legal Calendar           10. InzIQ AI Legal Associate
 *
 * Every module fetches on mount through services/api.js (a thin fetch
 * wrapper), so a single global `fetch` mock with a safe empty-JSON
 * fallback covers all of them without needing per-component API mocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import AppRouter from '../AppRouter';
import ContractAnalyzer from '../components/ContractAnalyzer';
import CourtResources from '../components/CourtResources';
import ConflictEngine from '../components/ConflictEngine';
import CalendarView from '../components/CalendarView';
import CaseVault from '../components/CaseVault';
import WarRoomView from '../components/WarRoomView';
import FirmLibrary from '../components/FirmLibrary';
import FormTemplateLibrary from '../components/FormTemplateLibrary';
import CommandPalette from '../components/CommandPalette';

// ── Shared fetch mock ───────────────────────────────────────────────────
// Any call not explicitly matched below falls back to an empty, successful
// JSON response — every module here treats "no data yet" as a valid,
// renderable state, so this keeps every test deterministic and offline.
function mockFetch(routeHandlers = []) {
  global.fetch = vi.fn((url) => {
    const urlStr = String(url);
    for (const [pattern, response] of routeHandlers) {
      const matches = typeof pattern === 'string' ? urlStr.includes(pattern) : pattern.test(urlStr);
      if (matches) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => response,
          text: async () => JSON.stringify(response),
        });
      }
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => [],
      text: async () => '[]',
    });
  });
}

beforeEach(() => {
  mockFetch();
  // A fake session token — several modules (Dashboard shell, War Room,
  // InzIQ's global FAB) branch on "is the user authenticated" before
  // rendering their normal (non-login-gated) UI.
  window.localStorage.setItem('token', 'test-token');
});

// ─────────────────────────────────────────────────────────────────────────
// 1. Advocate Dashboard
// ─────────────────────────────────────────────────────────────────────────

describe('Advocate Dashboard', () => {
  it('renders the Advocate Terminal with triage metrics and Quick Actions', async () => {
    window.history.pushState({}, '', '/dashboard');
    render(<AppRouter />);

    expect(await screen.findByText(/Advocate Terminal/i)).toBeInTheDocument();
    expect(screen.getByText(/Limitation Expiries/i)).toBeInTheDocument();
    expect(screen.getByText(/Tracked Cases/i)).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });

  it('navigates to Contract Analyzer when a Quick Action tile is clicked', async () => {
    window.history.pushState({}, '', '/dashboard');
    render(<AppRouter />);

    const links = await screen.findAllByRole('link', { name: /Contract Analyzer/i });
    await userEvent.click(links[0]);

    expect(await screen.findByText(/Contract Risk Analyzer/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Contract Analyzer
// ─────────────────────────────────────────────────────────────────────────

describe('Contract Analyzer', () => {
  it('renders the Contract Risk Analyzer workspace', async () => {
    render(
      <MemoryRouter>
        <ContractAnalyzer />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Contract Risk Analyzer/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Court Directory & Resources
// ─────────────────────────────────────────────────────────────────────────

describe('Court Directory & Resources', () => {
  it('renders with the Supreme Court tab active by default', async () => {
    render(
      <MemoryRouter>
        <CourtResources />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Court Directory & Resources/i)).toBeInTheDocument();
    const supremeTab = screen.getByRole('button', { name: /Supreme Court/i });
    expect(supremeTab.className).toContain('active');
  });

  it('switches to the High Courts tab on click', async () => {
    render(
      <MemoryRouter>
        <CourtResources />
      </MemoryRouter>
    );

    await screen.findByText(/Court Directory & Resources/i);
    const highCourtTab = screen.getByRole('button', { name: /High Courts/i });
    await userEvent.click(highCourtTab);

    expect(highCourtTab.className).toContain('active');
    expect(await screen.findByText(/Select State High Court/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Conflict Engine
// ─────────────────────────────────────────────────────────────────────────

describe('Conflict Engine (Malpractice Shield)', () => {
  it('renders with Triage Search active by default', async () => {
    render(
      <MemoryRouter>
        <ConflictEngine />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Malpractice Shield/i)).toBeInTheDocument();
    const triageTab = screen.getByRole('button', { name: /Triage Search/i });
    expect(triageTab.className).toContain('active');
  });

  it('switches to the Cross-Document Uploader tab on click', async () => {
    render(
      <MemoryRouter>
        <ConflictEngine />
      </MemoryRouter>
    );

    await screen.findByText(/Malpractice Shield/i);
    const crossDocTab = screen.getByRole('button', { name: /Cross-Document Uploader/i });
    await userEvent.click(crossDocTab);

    expect(crossDocTab.className).toContain('active');
    const triageTab = screen.getByRole('button', { name: /Triage Search/i });
    expect(triageTab.className).not.toContain('active');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. Legal Calendar
// ─────────────────────────────────────────────────────────────────────────

describe('Legal Calendar', () => {
  it('renders the Legal Calendar Dashboard (Tickler Engine)', async () => {
    render(
      <MemoryRouter>
        <CalendarView />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Legal Calendar Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Tickler Engine/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. Case Vault
// ─────────────────────────────────────────────────────────────────────────

describe('Case Vault', () => {
  it('renders the Case Vault Directory for a given case id', async () => {
    render(
      <MemoryRouter initialEntries={['/case/test-case-1']}>
        <Routes>
          <Route path="/case/:caseId" element={<CaseVault />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText(/Case Vault Directory/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. Virtual Courtroom / War Room
// ─────────────────────────────────────────────────────────────────────────

describe('Virtual Courtroom / War Room', () => {
  it('renders the standby intake screen before any simulation has run', async () => {
    render(
      <MemoryRouter>
        <WarRoomView />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Virtual Courtroom — Ready/i)).toBeInTheDocument();
    expect(screen.getByText(/Drop your case document here/i)).toBeInTheDocument();
  });

  it('dispatches the InzIQ toggle event when "Open InzIQ" is clicked', async () => {
    render(
      <MemoryRouter>
        <WarRoomView />
      </MemoryRouter>
    );

    const listener = vi.fn();
    window.addEventListener('toggle-rag-palette', listener);

    const openInziqBtn = await screen.findByRole('button', { name: /Open InzIQ/i });
    await userEvent.click(openInziqBtn);

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('toggle-rag-palette', listener);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. Firm Library
// ─────────────────────────────────────────────────────────────────────────

describe('Firm Library', () => {
  const sampleEntry = {
    id: 1,
    title: 'Standard Mutual NDA',
    category: 'Template',
    author: 'Internal Vault',
    updated: '2026-01-01',
    tags: [],
  };

  it('renders the Firm Library with a fetched entry', async () => {
    mockFetch([['/api/firm-library', [sampleEntry]]]);

    render(
      <MemoryRouter>
        <FirmLibrary />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Firm Library/i)).toBeInTheDocument();
    expect(await screen.findByText('Standard Mutual NDA')).toBeInTheDocument();
  });

  it('opens an entry workspace and switches to the Clause DNA tab', async () => {
    mockFetch([['/api/firm-library', [sampleEntry]]]);

    render(
      <MemoryRouter>
        <FirmLibrary />
      </MemoryRouter>
    );

    const entryRow = await screen.findByText('Standard Mutual NDA');
    await userEvent.click(entryRow);

    const dnaTab = await screen.findByRole('button', { name: /Clause DNA/i });
    await userEvent.click(dnaTab);

    expect(await screen.findByText(/Clause DNA Extractor/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. Legal Forms Library
// ─────────────────────────────────────────────────────────────────────────

describe('Legal Forms Library', () => {
  it('renders the template grid with all categories', async () => {
    render(
      <MemoryRouter>
        <FormTemplateLibrary />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Legal Forms Library/i)).toBeInTheDocument();
    expect(screen.getByText(/Mutual Non-Disclosure Agreement/i)).toBeInTheDocument();
  });

  it('filters the grid when the Court Petitions category tab is clicked', async () => {
    render(
      <MemoryRouter>
        <FormTemplateLibrary />
      </MemoryRouter>
    );

    await screen.findByText(/Legal Forms Library/i);
    const petitionsTab = screen.getByRole('button', { name: /Court Petitions/i });
    await userEvent.click(petitionsTab);

    expect(petitionsTab.className).toContain('active');
    // A Contracts & NDAs-only template must no longer be visible once the
    // grid is filtered down to the Court Petitions category.
    expect(screen.queryByText(/Mutual Non-Disclosure Agreement/i)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 10. InzIQ AI Legal Associate
// ─────────────────────────────────────────────────────────────────────────

describe('InzIQ AI Legal Associate', () => {
  it('renders nothing intrusive while closed', () => {
    window.history.pushState({}, '', '/dashboard');
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    );

    expect(screen.queryByText(/AI Legal Associate/i)).not.toBeInTheDocument();
  });

  it('opens the AI Legal Associate drawer on the toggle-rag-palette event', async () => {
    window.history.pushState({}, '', '/dashboard');
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>
    );

    window.dispatchEvent(new CustomEvent('toggle-rag-palette', { detail: { mode: 'drawer' } }));

    // "AI Legal Associate" legitimately appears more than once once open
    // (sidebar branding + hero heading + disclaimer footer) — the <h2>
    // hero heading is the one unique, unambiguous anchor for "did the
    // drawer actually open".
    expect(await screen.findByRole('heading', { name: /AI Legal Associate/i })).toBeInTheDocument();
  });
});
