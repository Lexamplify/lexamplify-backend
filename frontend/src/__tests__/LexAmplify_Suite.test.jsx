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
import { render, screen, within, waitFor } from '@testing-library/react';
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
import StageRail from '../components/warroom/StageRail';
import PleadingDocument, { validateOpeningDraft } from '../components/warroom/PleadingDocument';
import SimulationRoom from '../components/warroom/SimulationRoom';
import FirmLibrary from '../components/FirmLibrary';
import FormTemplateLibrary from '../components/FormTemplateLibrary';
import CommandPalette from '../components/CommandPalette';
import { AuthProvider } from '../context/AuthContext';

// ── Shared fetch mock ───────────────────────────────────────────────────
// Any call not explicitly matched below falls back to an empty, successful
// JSON response — every module here treats "no data yet" as a valid,
// renderable state, so this keeps every test deterministic and offline.
const mockConflictAnalysisResponse = {
  status: 'success',
  conflicts: [
    {
      id: '1',
      title: 'Inconsistent Payment Terms',
      severity: 'critical',
      docA: {
        file: 'Vendor Service Agreement.pdf',
        name: 'Vendor Service Agreement.pdf',
        quote: 'The Client shall process all cleared payments within 30 days of receiving a valid invoice from the Vendor.',
        page: 'Page 4',
        section: 'Section 6.2 (Invoicing and Payment)',
        context: 'Section 6.2 (Invoicing and Payment). Vendor shall submit invoices monthly in arrears.'
      },
      docB: {
        file: 'Software Development Agreement.pdf',
        name: 'Software Development Agreement.pdf',
        quote: '…the Client reserves the right to reduce the final invoice or withhold payments entirely at their sole discretion.',
        page: 'Page 7',
        section: 'Section 9.1 (Fees)',
        context: 'Section 9.1 (Fees). Client shall pay the fixed sum set out in Schedule B.'
      },
      legalExplanation: 'Payment obligations must be certain and not arbitrary under Indian contract law.',
      harmonization: 'Unify to a single payment clause: invoices payable within 30 days of receipt.',
      citedCases: []
    },
    {
      id: '2',
      title: 'Conflicting Dispute Resolution & Jurisdiction',
      severity: 'critical',
      docA: {
        file: 'Vendor Service Agreement.pdf',
        name: 'Vendor Service Agreement.pdf',
        quote: '…the Vendor waives all rights to approach any court or tribunal.',
        page: 'Page 11',
        section: 'Section 14',
        context: 'Section 14 (Dispute Resolution).'
      },
      docB: {
        file: 'NDA_Test_Document.pdf',
        name: 'NDA Test Document.pdf',
        quote: 'Any disputes… resolved exclusively in the state and federal courts located in Delaware, USA.',
        page: 'Page 3',
        section: 'Section 8',
        context: 'Section 8 (Governing Law).'
      },
      legalExplanation: 'A party cannot be compelled to waive its statutory right to approach a court.',
      harmonization: 'Adopt one enforceable clause across all agreements: arbitration in Mumbai.',
      citedCases: []
    },
    {
      id: '3',
      title: 'Jurisdiction Inconsistency Between Agreements',
      severity: 'major',
      docA: {
        file: 'Software Development Agreement.pdf',
        name: 'Software Development Agreement.pdf',
        quote: '(No explicit jurisdiction clause; default Indian law presumed.)',
        page: 'Page 9',
        section: 'Section 15',
        context: 'Section 15 (Miscellaneous).'
      },
      docB: {
        file: 'NDA_Test_Document.pdf',
        name: 'NDA Test Document.pdf',
        quote: 'Any disputes… resolved exclusively in Delaware.',
        page: 'Page 3',
        section: 'Section 8',
        context: 'Section 8.'
      },
      legalExplanation: 'When related contracts contain divergent jurisdiction provisions, foreign forum selection may be unenforceable.',
      harmonization: 'Insert a consistent governing-law and jurisdiction clause.',
      citedCases: []
    }
  ],
  summary: 'Cross-document conflict analysis identified 3 critical and major discrepancies across the matter agreements.'
};

const DEFAULT_ROUTE_HANDLERS = [
  ['/api/conflict/analyze', mockConflictAnalysisResponse],
  ['/api/conflict-engine/analyze', mockConflictAnalysisResponse],
];

function mockFetch(customHandlers = []) {
  const allHandlers = [...customHandlers, ...DEFAULT_ROUTE_HANDLERS];
  global.fetch = vi.fn((url) => {
    const urlStr = String(url);
    for (const [pattern, response] of allHandlers) {
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

  it('switches to the Cross-Document Workspace tab on click', async () => {
    render(
      <MemoryRouter>
        <ConflictEngine />
      </MemoryRouter>
    );

    await screen.findByText(/Malpractice Shield/i);
    const crossDocTab = screen.getByRole('button', { name: /Cross-Document/i });
    await userEvent.click(crossDocTab);

    expect(crossDocTab.className).toContain('active');
    const triageTab = screen.getByRole('button', { name: /Triage Search/i });
    expect(triageTab.className).not.toContain('active');
  });

  it('renders Master/Detail workspace with persistent document strip, index rows, and VS clash comparison after running analysis', async () => {
    render(
      <MemoryRouter>
        <ConflictEngine />
      </MemoryRouter>
    );

    const crossDocTab = screen.getByRole('button', { name: /Cross-Document/i });
    await userEvent.click(crossDocTab);

    // Document strip is present with loaded chips
    expect(screen.getAllByText(/Vendor Service Agreement/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Software Development Agreement/i).length).toBeGreaterThanOrEqual(1);
    
    // Run conflict analysis button is present and clickable
    const runBtn = screen.getByRole('button', { name: /Run conflict analysis/i });
    expect(runBtn).toBeInTheDocument();
    await userEvent.click(runBtn);

    // Index pane and detail pane both show the active title returned from backend
    expect((await screen.findAllByText(/Inconsistent Payment Terms/i)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Conflicting Dispute Resolution/i)).toBeInTheDocument();

    // Reading pane shows the signature circular VS clash
    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText(/legal explanation/i)).toBeInTheDocument();
    expect(screen.getByText(/recommended harmonization/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy harmonized clause/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export as Schedule of Discrepancies/i })).toBeInTheDocument();
  });

  it('independently toggles reviewed and saved states and filters correctly', async () => {
    render(
      <MemoryRouter>
        <ConflictEngine />
      </MemoryRouter>
    );

    const crossDocTab = screen.getByRole('button', { name: /Cross-Document/i });
    await userEvent.click(crossDocTab);

    // Run conflict analysis
    const runBtn = screen.getByRole('button', { name: /Run conflict analysis/i });
    await userEvent.click(runBtn);

    // Filter counters initially (3 active conflicts returned by backend)
    expect(await screen.findByRole('button', { name: /All 3/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unreviewed 3/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Saved 0/i })).toBeInTheDocument();

    // Mark active item as reviewed via reading pane
    const reviewBtn = screen.getByRole('button', { name: /Mark reviewed/i });
    await userEvent.click(reviewBtn);

    // Reviewed button toggles label to "Reviewed"
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unreviewed 2/i })).toBeInTheDocument();

    // Save active item via reading pane
    const saveBtn = screen.getByTitle('Save');
    await userEvent.click(saveBtn);
    expect(screen.getByRole('button', { name: /Saved 1/i })).toBeInTheDocument();

    // Switch to Saved filter
    const savedFilter = screen.getByRole('button', { name: /Saved 1/i });
    await userEvent.click(savedFilter);
    expect(screen.getAllByText(/Inconsistent Payment Terms/i).length).toBeGreaterThanOrEqual(1);
  });

  it('triggers stale-state banner on document change and recomputes on analysis re-run', async () => {
    render(
      <MemoryRouter>
        <ConflictEngine />
      </MemoryRouter>
    );

    const crossDocTab = screen.getByRole('button', { name: /Cross-Document/i });
    await userEvent.click(crossDocTab);

    // Initial state has documents and no stale banner
    expect(screen.queryByText(/Documents changed since this analysis ran/i)).not.toBeInTheDocument();

    // Run initial analysis
    const runBtn = screen.getByRole('button', { name: /Run conflict analysis/i });
    await userEvent.click(runBtn);
    await screen.findAllByText(/Inconsistent Payment Terms/i);

    // Remove first document to simulate document set change post-analysis
    const removeBtns = screen.getAllByTitle(/Remove document/i);
    await userEvent.click(removeBtns[0]);

    // Stale banner should appear
    expect(await screen.findByText(/Documents changed since this analysis ran/i)).toBeInTheDocument();
    const rerunBtn = screen.getByRole('button', { name: /Re-run analysis/i });
    expect(rerunBtn).toBeInTheDocument();

    // Click Re-run analysis
    await userEvent.click(rerunBtn);

    // After re-running, stale banner disappears
    await waitFor(() => {
      expect(screen.queryByText(/Documents changed since this analysis ran/i)).not.toBeInTheDocument();
    });
  });

  it('filters visible conflicts using the index search input', async () => {
    render(
      <MemoryRouter>
        <ConflictEngine />
      </MemoryRouter>
    );

    const crossDocTab = screen.getByRole('button', { name: /Cross-Document/i });
    await userEvent.click(crossDocTab);

    // Run conflict analysis
    const runBtn = screen.getByRole('button', { name: /Run conflict analysis/i });
    await userEvent.click(runBtn);
    await screen.findAllByText(/Inconsistent Payment Terms/i);

    const searchInput = screen.getByPlaceholderText(/Search conflicts/i);
    await userEvent.type(searchInput, 'Payment');

    // Matches payment conflict
    expect(screen.getAllByText(/Inconsistent Payment Terms/i).length).toBeGreaterThanOrEqual(1);
    // Non-matching conflict should be hidden from index
    expect(screen.queryByText(/Jurisdiction Inconsistency/i)).not.toBeInTheDocument();
  });

  it('deterministically serves cached results on repeated run clicks without new network requests', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(
      <MemoryRouter>
        <ConflictEngine />
      </MemoryRouter>
    );

    const crossDocTab = screen.getByRole('button', { name: /Cross-Document/i });
    await userEvent.click(crossDocTab);

    // Initial run: uncached, triggers backend fetch
    const runBtn = screen.getByRole('button', { name: /Run conflict analysis/i });
    const callsBefore = fetchSpy.mock.calls.length;
    await userEvent.click(runBtn);
    await screen.findAllByText(/Inconsistent Payment Terms/i);

    // Fresh label displayed for run #1
    expect(screen.getByText(/freshly analyzed just now \(run #1\)/i)).toBeInTheDocument();
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(callsBefore);

    // Repeat run on unchanged document set: instant cache hit, zero new fetch requests
    await userEvent.click(runBtn);

    // Cached label displayed for run #1
    expect(screen.getByText(/cached result from run #1 — unchanged since then/i)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('triggers a fresh backend call only when Force fresh re-analysis is clicked', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(
      <MemoryRouter>
        <ConflictEngine />
      </MemoryRouter>
    );

    const crossDocTab = screen.getByRole('button', { name: /Cross-Document/i });
    await userEvent.click(crossDocTab);

    const runBtn = screen.getByRole('button', { name: /Run conflict analysis/i });
    await userEvent.click(runBtn);
    await screen.findAllByText(/Inconsistent Payment Terms/i);

    const initialFetchCount = fetchSpy.mock.calls.length;

    // Click explicit Force fresh re-analysis button
    const forceRerunBtn = screen.getByRole('button', { name: /Force fresh re-analysis/i });
    expect(forceRerunBtn).toBeInTheDocument();
    await userEvent.click(forceRerunBtn);

    // New backend fetch is made and run number increments
    await waitFor(() => {
      expect(screen.getByText(/freshly analyzed just now \(run #2\)/i)).toBeInTheDocument();
    });
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(initialFetchCount);
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

  it('embeds Slate & Rust token system with full dark theme wiring and constant hero masthead', () => {
    const { container } = render(
      <MemoryRouter>
        <WarRoomView />
      </MemoryRouter>
    );

    const styleEl = container.querySelector('style');
    expect(styleEl).toBeInTheDocument();
    const cssText = styleEl.textContent;

    // Verify Light palette tokens
    expect(cssText).toContain('--bg:#DFE1E0');
    expect(cssText).toContain('--paper:#EAEBE8');
    expect(cssText).toContain('--paper-2:#E3E4E1');
    expect(cssText).toContain('--ink:#181B1D');
    expect(cssText).toContain('--ink-soft:#494E51');
    expect(cssText).toContain('--muted:#868C8E');
    expect(cssText).toContain('--rule:#D2D5D4');
    expect(cssText).toContain('--accent:#B24A2E');
    expect(cssText).toContain('--accent-soft:#EFDCD1');

    // Verify Dark palette tokens
    expect(cssText).toContain('--bg:#191C1D');
    expect(cssText).toContain('--paper:#212527');
    expect(cssText).toContain('--paper-2:#2A2F31');
    expect(cssText).toContain('--ink:#D6D9D9');
    expect(cssText).toContain('--ink-soft:#AAAEAE');
    expect(cssText).toContain('--muted:#727776');
    expect(cssText).toContain('--rule:#333939');
    expect(cssText).toContain('--accent:#CC6B48');
    expect(cssText).toContain('--accent-soft:#3B281F');

    // Verify Constant hero masthead tokens (do not flip)
    expect(cssText).toContain('--hero-bg:#14171A');
    expect(cssText).toContain('--hero-text:#F1F2F0');
    expect(cssText).toContain('--hero-muted:rgba(241,242,240,.62)');
    expect(cssText).toContain('--hero-rule:rgba(241,242,240,.14)');
    expect(cssText).toContain('--on-accent:#FBF7EE');
  });

  it('renders horizontal stepper inside sticky header with all 4 stages and connectors', async () => {
    const stages = [
      { id: 'vc-stage-facts', label: 'Facts & issues', status: '1 issue identified' },
      { id: 'vc-stage-precedents', label: 'Precedents', status: '3 citations found' },
      { id: 'vc-stage-draft', label: 'Opening draft', status: 'Ready to review' },
      { id: 'vc-stage-simulation', label: 'Simulation room', status: '0 of 7 prepared' },
    ];
    const onSelect = vi.fn();

    const { container } = render(
      <StageRail stages={stages} activeId="vc-stage-draft" onSelect={onSelect} />
    );

    const rail = container.querySelector('.h-rail');
    expect(rail).toBeInTheDocument();

    const stageEls = container.querySelectorAll('.h-stage');
    expect(stageEls).toHaveLength(4);

    // Stage 0 & 1 should be 'done', Stage 2 should be 'active'
    expect(stageEls[0]).toHaveClass('done');
    expect(stageEls[1]).toHaveClass('done');
    expect(stageEls[2]).toHaveClass('active');
    expect(stageEls[3]).not.toHaveClass('active');

    // Connectors check (3 connectors between 4 stages)
    const connectors = container.querySelectorAll('.h-connector');
    expect(connectors).toHaveLength(3);

    // Click triggers onSelect
    await userEvent.click(stageEls[3]);
    expect(onSelect).toHaveBeenCalledWith('vc-stage-simulation');
  });

  it('validates opening drafts with defensive repetition rule (8+ consecutive blanks -> warning card)', () => {
    const malformedRepetitionText = `
      IN THE HIGH COURT OF [Court Name]
      Civil Appeal No. [Case Number] of 2026
      BETWEEN:
      [Party 1] [Party 2] [Party 3] [Party 4] [Party 5] [Party 6] [Party 7] [Party 8] [Party 9] [Party 10]
      Introduction:
      The dispute arises out of contract.
    `;

    const result = validateOpeningDraft(malformedRepetitionText);
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('empty fields and no readable argument text');
    expect(result.emptyCount).toBeGreaterThanOrEqual(8);
  });

  it('validates opening drafts with defensive structure rule (missing headings -> warning card)', () => {
    const malformedStructureText = `
      This is an unstructured text snippet without formal pleading sections.
      The tenant defaulted on monthly rent payments.
      We demand payment of all outstanding dues immediately.
    `;

    const result = validateOpeningDraft(malformedStructureText);
    expect(result.isValid).toBe(false);
    expect(result.reason).toContain('produced no readable argument sections');
  });

  it('renders PleadingDocument safeguard warning card when draft is malformed and supports regeneration', async () => {
    const onRegenerate = vi.fn();
    const malformedDraft = '[Field 1] [Field 2] [Field 3] [Field 4] [Field 5] [Field 6] [Field 7] [Field 8] [Field 9]';

    const { container } = render(
      <PleadingDocument
        rawArgumentText={malformedDraft}
        matterTitle="Vikram Singh v. Anita Sharma"
        apiBase=""
        onRegenerate={onRegenerate}
      />
    );

    const warningCard = container.querySelector('#warningCard');
    expect(warningCard).toBeInTheDocument();
    expect(warningCard).toHaveClass('on');
    expect(screen.getByText(/This section didn't generate correctly/i)).toBeInTheDocument();

    const regenBtn = screen.getByRole('button', { name: /Regenerate this section/i });
    await userEvent.click(regenBtn);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('renders well-formed PleadingDocument in editor without warning card', () => {
    const wellFormedDraft = `
      **IN THE HIGH COURT OF DELHI**
      Civil Appeal No. [Appeal No] of 2026
      
      ### 1. Introduction
      The Appellant seeks restitution for material breach of renovation agreement.
      
      ### 2. Facts
      On [Contract Date], the parties entered into a binding contract.
      
      ### 3. Issues
      Whether the Respondent is in material breach under Section 73 of the Indian Contract Act.
      
      ### 4. Arguments
      The ratio in *Fateh Chand v. Balkishan Das* applies directly.
      
      ### 5. Prayer
      Direct refund of advance of Rs. [Advance Amount] with interest.
      
      ### 6. Conclusion
      The appeal ought to be allowed.
    `;

    const { container } = render(
      <PleadingDocument
        rawArgumentText={wellFormedDraft}
        matterTitle="Vikram Singh v. Anita Sharma"
        apiBase=""
      />
    );

    expect(container.querySelector('#warningCard')).toBeNull();
    const goodDoc = container.querySelector('#goodDoc');
    expect(goodDoc).toBeInTheDocument();
    expect(goodDoc).toHaveClass('paper-doc');
  });

  it('renders SimulationRoom with queue-scroll wrapping opponent challenges', async () => {
    const questions = [
      { question: 'Is the claim barred by statutory limitation?', suggested_rebuttal: 'No, filed within 3 years.' },
      { question: 'What specific damages evidence was produced?', suggested_rebuttal: 'Receipts and bank statements produced.' },
    ];
    const onUseInChat = vi.fn();

    const { container } = render(
      <SimulationRoom
        questions={questions}
        addressedChallenges={new Set()}
        onUseInChat={onUseInChat}
        chatMessages={[{ role: 'bot', text: 'Opposing counsel standing by.' }]}
        chatInput=""
        setChatInput={vi.fn()}
        chatLoading={false}
        strategyTone="aggressive"
        setStrategyTone={vi.fn()}
        onChatSubmit={vi.fn()}
        onQuickReply={vi.fn()}
        chatEndRef={{ current: null }}
        chatInputRef={{ current: null }}
      />
    );

    const queueScroll = container.querySelector('.queue-scroll');
    expect(queueScroll).toBeInTheDocument();
    expect(screen.getByText('Is the claim barred by statutory limitation?')).toBeInTheDocument();
    expect(screen.getByText('What specific damages evidence was produced?')).toBeInTheDocument();
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
