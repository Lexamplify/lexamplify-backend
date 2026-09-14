/**
 * frontend/src/__tests__/LexAmplify_Suite.test.jsx
 * Render + tab-switch smoke suite across all 10 LexAmplify modules:
 *   1. Advocate Dashboard        6. Case Vault
 *   2. Contract Analyzer         7. Virtual Courtroom / War Room
 *   3. Court Directory & Resources 8. Firm Library
 *   4. Conflict Engine           9. Legal Forms Library
 *   5. Legal Calendar           10. LexAmplify AI Legal Associate
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
import MatterHeader from '../components/warroom/MatterHeader';
import FirmLibrary from '../components/FirmLibrary';
import FormTemplateLibrary from '../components/FormTemplateLibrary';
import CommandPalette from '../components/CommandPalette';
import { AuthProvider } from '../context/AuthContext';

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
  // LexAmplify's global FAB) branch on "is the user authenticated" before
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
    expect(screen.getAllByText(/Limitation Expiries/i)[0]).toBeInTheDocument();
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
    expect(await screen.findByText(/High Courts of India/i)).toBeInTheDocument();
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
// 7. Virtual Courtroom / War Room — Dynamic Case Header & Summary Ledger
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

  it('dispatches the LexAmplify toggle event when "Open Command Assistant" is clicked', async () => {
    render(
      <MemoryRouter>
        <WarRoomView />
      </MemoryRouter>
    );

    const listener = vi.fn();
    window.addEventListener('toggle-rag-palette', listener);

    const openCommandBtn = await screen.findByRole('button', { name: /Open Command Assistant/i });
    await userEvent.click(openCommandBtn);

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('toggle-rag-palette', listener);
  });

  it('renders MatterHeader populated state with all required IDs and synthesized fields', () => {
    const onReanalyze = vi.fn();
    const onNewSimulation = vi.fn();
    const onSaveToVault = vi.fn();

    const summaryCols = [
      { label: 'Plaintiff', value: 'Vikram Singh', id: 'plaintiff' },
      { label: 'Defendant', value: 'Anita Sharma', id: 'defendant' },
      { label: 'Contract value', value: '₹5,50,000', id: 'contractValue' },
      { label: 'Advance paid', value: '₹2,00,000', id: 'advancePaid' },
      { label: 'Relief sought', value: '₹2,50,000 + interest', id: 'reliefSought' },
    ];

    const { container } = render(
      <MatterHeader
        filename="Virtual_Courtroom_Test_Case.pdf"
        pageCount="3 pages"
        refId="VIC-2026-CT-0001"
        title="Vikram Singh v. Anita Sharma"
        subtitle="Breach of contract — home renovation services · Civil Judge (Senior Division), Chennai"
        summaryColumns={summaryCols}
        isAnalyzing={false}
        onReanalyze={onReanalyze}
        onNewSimulation={onNewSimulation}
        onSaveToVault={onSaveToVault}
      />
    );

    // Verify all element IDs from reference implementation
    expect(container.querySelector('#hero')).toBeInTheDocument();
    expect(container.querySelector('#filename')).toHaveTextContent('Virtual_Courtroom_Test_Case.pdf');
    expect(container.querySelector('#pagecount')).toHaveTextContent('3 pages');
    expect(container.querySelector('.source-check')).toHaveTextContent('✓ analyzed');
    expect(container.querySelector('#reanalyzeBtn')).toHaveTextContent('⟳ analyze a different document');
    expect(container.querySelector('#heroBody')).toBeInTheDocument();
    expect(container.querySelector('#ref')).toHaveTextContent('VIC-2026-CT-0001');
    expect(container.querySelector('#title')).toHaveTextContent('Vikram Singh v. Anita Sharma');
    expect(container.querySelector('#subtitle')).toHaveTextContent(/Breach of contract/i);

    // Verify summary ledger strip & column IDs
    const summaryEl = container.querySelector('.summary');
    expect(summaryEl).toBeInTheDocument();
    expect(container.querySelector('#plaintiff')).toHaveTextContent('Vikram Singh');
    expect(container.querySelector('#defendant')).toHaveTextContent('Anita Sharma');
    expect(container.querySelector('#contractValue')).toHaveTextContent('₹5,50,000');
    expect(container.querySelector('#advancePaid')).toHaveTextContent('₹2,00,000');
    expect(container.querySelector('#reliefSought')).toHaveTextContent('₹2,50,000 + interest');
  });

  it('renders MatterHeader analyzing state with spinner and hides hero body', () => {
    const { container } = render(
      <MatterHeader
        filename="Ghosh_v_Bangur_Renovation_Suit.pdf"
        pageCount="52 pages"
        isAnalyzing={true}
        analyzingText="Analyzing document — extracting parties, dates, and issues…"
      />
    );

    const hero = container.querySelector('#hero');
    expect(hero).toHaveClass('busy');
    expect(container.querySelector('#analyzing')).toHaveClass('on');
    expect(container.querySelector('.analyzing-text')).toHaveTextContent(/extracting parties, dates, and issues/i);
    expect(container.querySelector('#heroBody')).toBeNull();
    expect(container.querySelector('.summary')).toBeNull();
  });

  it('renders MatterHeader failure error state visibly distinct from analyzing and populated', async () => {
    const onRetry = vi.fn();
    const onReanalyze = vi.fn();

    const { container } = render(
      <MatterHeader
        filename="corrupted_file.pdf"
        pageCount="40 of 52 pages"
        analysisError="Extraction failed on page 40 of 52: corrupted byte stream"
        onRetry={onRetry}
        onReanalyze={onReanalyze}
      />
    );

    expect(container.querySelector('.source-fail')).toHaveTextContent(/analysis failed/i);
    expect(screen.getByText(/Document Analysis Error/i)).toBeInTheDocument();
    expect(screen.getByText(/corrupted byte stream/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Retry analysis/i });
    await userEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('supports schema flexibility for non-contract matters without blank or NA fields', () => {
    const criminalSummary = [
      { label: 'State / Complainant', value: 'State of Maharashtra', id: 'plaintiff' },
      { label: 'Accused', value: 'Rajesh Kumar', id: 'defendant' },
      { label: 'Offences / Sections', value: 'IPC §§ 420, 406', id: 'offences' },
      { label: 'Bail Status', value: 'Anticipatory (§ 438)', id: 'bailStatus' },
      { label: 'Forum', value: 'Sessions Court, Mumbai', id: 'forum' },
    ];

    const { container } = render(
      <MatterHeader
        filename="State_v_Rajesh_Bail_Appeal.pdf"
        pageCount="18 pages"
        refId="CRA-2025-MUM-0412"
        title="State of Maharashtra v. Rajesh Kumar"
        subtitle="Criminal Appeal under Section 374 CrPC · Bombay High Court"
        summaryColumns={criminalSummary}
      />
    );

    expect(container.querySelector('#title')).toHaveTextContent('State of Maharashtra v. Rajesh Kumar');
    expect(container.querySelector('#subtitle')).toHaveTextContent(/Criminal Appeal/i);
    expect(container.querySelector('#plaintiff')).toHaveTextContent('State of Maharashtra');
    expect(container.querySelector('#defendant')).toHaveTextContent('Rajesh Kumar');
    expect(screen.getByText('IPC §§ 420, 406')).toBeInTheDocument();
    expect(screen.getByText('Anticipatory (§ 438)')).toBeInTheDocument();
    expect(screen.getByText('Sessions Court, Mumbai')).toBeInTheDocument();
    expect(screen.queryByText('N/A')).toBeNull();
  });

  it('renders populated simulation in WarRoomView with dynamic header and Stage 1 facts in lockstep', async () => {
    const mockSimulationData = {
      client_side: 'Appellant',
      extracted_issues: 'Material breach of renovation agreement; work not commenced despite a ₹2,00,000 advance; claim for refund, 12% interest, and ₹50,000 compensation for delay.',
      live_citations: [{ title: 'Vikram Singh vs Anita Sharma on 12 May 2024', snippet: 'Breach of contract damages principle' }],
      opening_argument: 'May it please the court, the appellant seeks restitution...',
      red_team: { opposing_counter_questions: [{ question: 'Was there a time-is-of-essence clause?', suggested_rebuttal: 'Yes, Clause 4 explicitly states 60 days.' }] }
    };

    render(
      <MemoryRouter initialEntries={[{ pathname: '/war-room', state: { simulationData: mockSimulationData } }]}>
        <WarRoomView />
      </MemoryRouter>
    );

    expect(await screen.findByText('Vikram Singh v. Anita Sharma')).toBeInTheDocument();
    expect(screen.getByText(/Breach of contract — home renovation services/i)).toBeInTheDocument();
    
    // Stage 1 facts card check
    const factsEl = document.getElementById('facts');
    expect(factsEl).toBeInTheDocument();
    expect(factsEl).toHaveTextContent(/Material breach of renovation agreement/i);
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
// 10. LexAmplify AI Legal Associate
// ─────────────────────────────────────────────────────────────────────────

describe('LexAmplify AI Legal Associate', () => {
  it('renders nothing intrusive while closed', () => {
    window.history.pushState({}, '', '/dashboard');
    render(
      <MemoryRouter>
        <AuthProvider>
          <CommandPalette />
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.queryByText(/AI Legal Associate/i)).not.toBeInTheDocument();
  });

  it('opens the AI Legal Associate drawer on the toggle-rag-palette event', async () => {
    window.history.pushState({}, '', '/dashboard');
    render(
      <MemoryRouter>
        <AuthProvider>
          <CommandPalette />
        </AuthProvider>
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

// ─────────────────────────────────────────────────────────────────────────
// 11. Sidebar Focus Mode Theme-Adaptive Tooltips
// ─────────────────────────────────────────────────────────────────────────

describe('Sidebar (Slate & Rust)', () => {
  it('renders all ten nav destinations with real hrefs, and the search-line command-palette trigger', async () => {
    window.history.pushState({}, '', '/dashboard');
    render(<AppRouter />);

    const sidebar = document.querySelector('.sb-sidebar');
    const sidebarQueries = within(sidebar);

    const expected = [
      ['Dashboard', '/dashboard'],
      ['Contract Analyzer', '/contract-analyzer'],
      ['Auto-Draft Studio', '/auto-draft'],
      ['Court Resources', '/court-resources'],
      ['Legal Calendar', '/calendar'],
      ['Virtual Courtroom', '/war-room'],
      ['Case Vault', '/vault'],
      ['Conflict Engine', '/conflict-engine'],
      ['Firm Library', '/firm-library'],
      ['Legal Forms', '/legal-forms'],
    ];
    expected.forEach(([name, path]) => {
      expect(sidebarQueries.getByRole('link', { name: new RegExp(name, 'i') })).toHaveAttribute('href', path);
    });

    // The AI-assisted asterisk marks exactly the three flagged features.
    expect(sidebarQueries.getByText('* AI-assisted')).toBeInTheDocument();

    // Search-line replaces the old standalone "LexAmplify (⌘K)" button —
    // same command-palette trigger, restyled as a typed prompt.
    const listener = vi.fn();
    window.addEventListener('toggle-rag-palette', listener);
    await userEvent.click(sidebarQueries.getByText(/search or ask/i));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('collapses into the capsule and persists that choice across a remount', async () => {
    window.history.pushState({}, '', '/dashboard');
    localStorage.removeItem('lexai_sidebar_collapsed');
    const { unmount } = render(<AppRouter />);

    const collapseBtn = screen.getByLabelText(/Collapse sidebar/i);
    await userEvent.click(collapseBtn);

    const wrap = document.querySelector('.sb-wrap');
    expect(wrap).toHaveClass('collapsed');
    expect(document.querySelectorAll('.sb-chip').length).toBeGreaterThan(0);
    expect(localStorage.getItem('lexai_sidebar_collapsed')).toBe('1');

    unmount();
    render(<AppRouter />);
    expect(document.querySelector('.sb-wrap')).toHaveClass('collapsed');
  });
});
