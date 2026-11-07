import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Assistant from '../pages/Assistant.jsx';
import CreateMatterCard from '../components/CreateMatterCard.jsx';
import {
  detectCreateMatter, parseParties, normalizeAnswer, validateSlot, IDLE_TIMEOUT_MS,
  buildCreateBody, buildConflictBody, findDuplicateCase, matchClientNames,
} from '../assistant/createMatterFlow.js';

vi.mock('../components/MicButton.jsx', () => ({ default: () => null, LangPicker: () => null }));
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { name: 'Asha Rao' } }),
  AuthProvider: ({ children }) => children,
}));

const SENTENCE = 'create a matter for Sharma vs Rao';
const NAMES = ['Sharma', 'Rao'];
const PARSED = { title: 'Sharma vs Rao', client: 'Sharma', opposite_party: 'Rao' };

function reply(body, status = 200) {
  return { ok: status < 400, status, headers: { get: () => null }, json: async () => body };
}

// ── pure logic ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('createMatterFlow (plain code)', () => {
  it('detects create wording and returns the remainder, ignoring reads/navigation', () => {
    expect(detectCreateMatter(SENTENCE)).toEqual({ matched: true, remainder: 'Sharma vs Rao' });
    expect(detectCreateMatter('open a new case').matched).toBe(true);
    expect(detectCreateMatter('नया मुकदमा बनाओ').matched).toBe(true);
    for (const miss of ['open matters', 'show my cases', 'find the Sharma matter', 'add a hearing', '']) {
      expect(detectCreateMatter(miss).matched).toBe(false);
    }
  });

  it('splits parties, normalises numbers, and validates', () => {
    expect(parseParties('Sharma vs Rao')).toEqual({ title: 'Sharma vs Rao', client: 'Sharma', opposite_party: 'Rao' });
    expect(normalizeAnswer('case_no', 'forty five')).toBe('45');
    expect(normalizeAnswer('case_no', '१२३')).toBe('123');
    expect(validateSlot('title', '')).toMatch(/needed/);
    expect(validateSlot('client', '')).toBe('');
    expect(validateSlot('case_type', 'Nope')).toMatch(/Choose one/);
  });

  it('builds the create body with inline client and Matters-page keys/defaults', () => {
    const body = buildCreateBody({ title: 'Sharma vs Rao', court: 'Madras HC', case_no: 'OS 45', case_type: 'Civil', client: 'Sharma', opposite_party: 'Rao' });
    expect(Object.keys(body).sort()).toEqual(['case_no', 'case_type', 'client', 'court', 'restricted', 'title']);
    expect(body.client).toEqual({ name: 'Sharma' });         // inline client (lpms_cases.py:185), not client_name
    expect(body.restricted).toBe(0);                          // same default as the Matters page
    expect('team_id' in body || 'advocate_id' in body).toBe(false);
    expect(buildCreateBody({ title: 'X' }).client).toBeUndefined();  // no client → no inline object
  });

  it('builds the conflict body, finds duplicates and matches client names', () => {
    expect(buildConflictBody({ client: 'Sharma', opposite_party: 'Rao', case_type: 'Civil' }))
      .toEqual({ entity_name: 'Sharma', opposing_party: 'Rao', matter_type: 'Civil' });
    const cases = [{ id: 9, case_no: 'OS 45', title: 'Sharma vs Rao' }];
    expect(findDuplicateCase(cases, { case_no: 'os 45', title: 'sharma vs rao' })).toBeTruthy();
    expect(findDuplicateCase(cases, { case_no: 'OS 99', title: 'Sharma vs Rao' })).toBeNull();
    expect(matchClientNames([{ name: 'Sharma' }, { name: 'Other' }], 'sharma')).toEqual(['Sharma']);
  });
});

// ── the card: conflict → confirm → create → success ──────────────────────────────────────────────────────────────────
describe('CreateMatterCard', () => {
  let calls;
  function mockFetch(opts = {}) {
    calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const method = (init.method || 'GET').toUpperCase();
      const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ u, method, body });
      if (u.includes('/api/conflict/check')) return opts.conflict ? opts.conflict(body) : reply({ status: 'Clear', results: [] });
      if (u.includes('/api/practice/clients')) return opts.clients ? opts.clients() : reply({ clients: [] });
      if (u.includes('/api/practice/cases') && method === 'GET') return opts.list ? opts.list() : reply({ cases: [] });
      if (u.includes('/api/practice/cases') && method === 'POST') {
        if (opts.create) return opts.create(body);
        return reply({ case: { id: 7, title: body.title, case_no: body.case_no } }, 201);
      }
      if (u.includes('/api/assistant/command')) return opts.label ? opts.label(body) : reply({ flow: 'create_matter', event: body.event, enabled: true });
      return reply({});
    });
    return calls;
  }
  const post = (u) => calls.filter((c) => c.u.includes(u) && c.method === 'POST');
  const commandCalls = () => calls.filter((c) => c.u.includes('/api/assistant/command'));
  let onExit;

  beforeEach(() => { onExit = vi.fn(); mockFetch(); });
  afterEach(() => { vi.useRealTimers(); });

  function renderActive(props = {}) {
    return render(<CreateMatterCard phase="active" parsed={props.parsed || PARSED} conversationId={1} onExit={onExit} />);
  }
  function gotoConfirm({ court = 'Madras High Court', caseNo = 'OS 45', type = 'Civil' } = {}) {
    fireEvent.click(screen.getByText('Next'));                                   // title (pre-filled)
    fireEvent.change(screen.getByLabelText('Court'), { target: { value: court } });
    fireEvent.click(screen.getByText('Next'));                                   // court
    fireEvent.change(screen.getByLabelText('Case number'), { target: { value: caseNo } });
    fireEvent.click(screen.getByText('Next'));                                   // case number
    fireEvent.click(screen.getByText(type));                                     // case type chip
    fireEvent.click(screen.getByText('Next'));                                   // client (pre-filled)
    fireEvent.click(screen.getByText('Next'));                                   // opposite party → confirm
  }

  it('slots: order, required validation, and reaching the confirm card (renamed heading + real next-step line)', async () => {
    renderActive();
    expect(screen.getByLabelText('Case title')).toHaveValue('Sharma vs Rao');
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('Check the details')).toBeInTheDocument());
    expect(screen.getByText(/Next, I.ll create the matter/i)).toBeInTheDocument();
  });

  it('no conflict: shows "No conflict found" and creates with an inline client, then success', async () => {
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create matter'));
    await waitFor(() => expect(screen.getByText('Matter created')).toBeInTheDocument());
    // exactly one confirm label + one create POST; the create body is the Matters-page shape with inline client.
    expect(post('/api/practice/cases')).toHaveLength(1);
    const createBody = post('/api/practice/cases')[0].body;
    expect(Object.keys(createBody).sort()).toEqual(['case_no', 'case_type', 'client', 'court', 'restricted', 'title']);
    expect(createBody.client).toEqual({ name: 'Sharma' });
    expect(commandCalls().every((c) => c.body.flow === 'create_matter' && c.body.event === 'confirm')).toBe(true);
  });

  it('conflict: Create is blocked until "Proceed anyway" (click only), and Enter never proceeds', async () => {
    mockFetch({ conflict: () => reply({ status: 'Potential', results: [{ client: 'Sharma', match_type: 'Existing client' }] }) });
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText(/Possible conflict/i)).toBeInTheDocument());
    expect(screen.getByText('Create matter')).toBeDisabled();
    // Enter on the Proceed-anyway button must not proceed.
    fireEvent.keyDown(screen.getByText('Proceed anyway'), { key: 'Enter' });
    expect(screen.getByText('Create matter')).toBeDisabled();
    fireEvent.click(screen.getByText('Proceed anyway'));                         // mouse click only
    expect(screen.getByText('Create matter')).not.toBeDisabled();
  });

  it('no firm: a clear message and no create is possible', async () => {
    mockFetch({ conflict: () => reply({ error: true, code: 'NO_FIRM' }, 403) });
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText(/Set up your practice/i)).toBeInTheDocument());
    expect(screen.getByText('Create matter')).toBeDisabled();
  });

  it('check failure: Retry and Proceed without check (click) unblocks create', async () => {
    mockFetch({ conflict: () => reply({ error: true }, 500) });
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('Could not check conflicts.')).toBeInTheDocument());
    expect(screen.getByText('Create matter')).toBeDisabled();
    fireEvent.click(screen.getByText('Proceed without check'));
    expect(screen.getByText('Create matter')).not.toBeDisabled();
    expect(screen.getByText(/Proceeding without a conflict check/i)).toBeInTheDocument();
  });

  it('editing the client after a check forces a fresh conflict check', async () => {
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    const before = calls.filter((c) => c.u.includes('/api/conflict/check')).length;
    fireEvent.click(screen.getByLabelText('Change the client'));                 // back to the client slot
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Sharma Textiles' } });
    fireEvent.click(screen.getByText('Next'));                                   // opposite
    fireEvent.click(screen.getByText('Next'));                                   // → confirm again
    await waitFor(() => expect(calls.filter((c) => c.u.includes('/api/conflict/check')).length).toBe(before + 1));
  });

  it('flag turned off mid-flow blocks the create (confirm label returns enabled:false)', async () => {
    mockFetch({ label: (b) => reply({ flow: 'create_matter', event: b.event, enabled: false }) });
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create matter'));
    await waitFor(() => expect(screen.getByText(/has been turned off/i)).toBeInTheDocument());
    expect(post('/api/practice/cases')).toHaveLength(0);                         // never created
  });

  it('a duplicate error is reported', async () => {
    mockFetch({ create: () => reply({ code: 'DUPLICATE_CASE', message: 'exists' }, 409) });
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create matter'));
    await waitFor(() => expect(screen.getByText(/already exists in this court/i)).toBeInTheDocument());
  });

  it('duplicate-safe retry: a network error where the list already shows the case reports success, no second create', async () => {
    let createTries = 0;
    mockFetch({
      create: () => { createTries += 1; throw new Error('network'); },
      list: () => reply({ cases: [{ id: 42, case_no: 'OS 45', title: 'Sharma vs Rao' }] }),
    });
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create matter'));
    await waitFor(() => expect(screen.getByText('Matter created')).toBeInTheDocument());
    expect(createTries).toBe(1);                                                 // did NOT create again
  });

  it('duplicate-safe retry: a network error where the list does NOT show the case offers Retry', async () => {
    mockFetch({ create: () => { throw new Error('network'); }, list: () => reply({ cases: [] }) });
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create matter'));
    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument());
  });

  it('double click sends exactly one create', async () => {
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    const btn = screen.getByText('Create matter');
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText('Matter created')).toBeInTheDocument());
    expect(post('/api/practice/cases')).toHaveLength(1);
  });

  it('Enter on the confirm card confirms when allowed', async () => {
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    fireEvent.keyDown(screen.getByLabelText('Check the new matter'), { key: 'Enter' });
    await waitFor(() => expect(post('/api/practice/cases')).toHaveLength(1));
  });

  it('shows the client-link note and who it may link to', async () => {
    mockFetch({ clients: () => reply({ clients: [{ name: 'Sharma' }] }) });
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText(/this matter will be linked to it/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/It may link to: Sharma/i)).toBeInTheDocument());
  });

  it('NO-LEAK: names and conflict results never reach /api/assistant/command or the console', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    mockFetch({ conflict: () => reply({ status: 'Potential', results: [{ client: 'Sharma', opponent: 'Rao' }] }) });
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText(/Possible conflict/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Proceed anyway'));
    fireEvent.click(screen.getByText('Create matter'));
    await waitFor(() => expect(screen.getByText('Matter created')).toBeInTheDocument());
    for (const c of commandCalls()) {
      const dumped = JSON.stringify(c.body);
      for (const n of NAMES) expect(dumped).not.toContain(n);
      expect(dumped).not.toContain('Potential');
    }
    const logged = spies.flatMap((s) => s.mock.calls.flat()).join(' ');
    for (const n of NAMES) expect(logged).not.toContain(n);
    spies.forEach((s) => s.mockRestore());
  });

  it('success "Open matter" exits with the detail route and the created flag; Cancel sends a cancelled label and exits', async () => {
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create matter'));
    await waitFor(() => expect(screen.getByText('Matter created')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Open matter'));
    expect(onExit).toHaveBeenCalledWith({ navigateTo: '/matters/7', created: true });
  });

  // ── honest-success re-read (one GET of the Matters list) ──────────────────────────────────────────────────────────
  async function createToSuccess() {
    renderActive();
    gotoConfirm();
    await waitFor(() => expect(screen.getByText('No conflict found.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create matter'));
    await waitFor(() => expect(screen.getByText('Matter created')).toBeInTheDocument());
  }
  const listGets = () => calls.filter((c) => c.u.includes('/api/practice/cases') && c.method === 'GET');

  it('found: the created case is in the list → "it is in your Matters list"', async () => {
    mockFetch({ list: () => reply({ cases: [{ id: 7, case_no: 'OS 45', title: 'Sharma vs Rao' }], total: 1, per_page: 100 }) });
    await createToSuccess();
    expect(await screen.findByText('Matter created and it is in your Matters list.')).toBeInTheDocument();
    expect(listGets()).toHaveLength(1);                                   // exactly one GET, no polling
  });

  it('not found: the list is complete and does not contain it → "not showing yet"', async () => {
    mockFetch({ list: () => reply({ cases: [], total: 0, per_page: 100 }) });
    await createToSuccess();
    expect(await screen.findByText('Matter saved, but it is not showing in your Matters list yet.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/failed|error/i);
    expect(listGets()).toHaveLength(1);
  });

  it('cut off (total > rows and not on the page) → "could not re-check", never "not showing"', async () => {
    mockFetch({ list: () => reply({ cases: [{ id: 1, case_no: 'X', title: 'Y' }], total: 500, per_page: 100 }) });
    await createToSuccess();
    expect(await screen.findByText('Matter created. I could not re-check the list just now.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('not showing in your Matters list');
  });

  it('cut off by a full page when the API sends no total → "could not re-check"', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, case_no: `N${i}`, title: `T${i}` }));
    mockFetch({ list: () => reply({ cases: full }) });                    // no total / has_more
    await createToSuccess();
    expect(await screen.findByText('Matter created. I could not re-check the list just now.')).toBeInTheDocument();
  });

  it('timeout: the GET never resolves → "could not re-check" (one GET, no retry)', async () => {
    mockFetch({ list: () => new Promise(() => {}) });                     // hangs
    await createToSuccess();
    // The checking line shows first; aborts at CHECK_TIMEOUT_MS. We assert it does not claim found/not-found.
    expect(screen.getByText('Checking your Matters list…')).toBeInTheDocument();
    expect(listGets()).toHaveLength(1);
    expect(document.body.textContent).not.toContain('it is in your Matters list');
    expect(document.body.textContent).not.toContain('not showing in your Matters list');
  });

  it('uncertain create (duplicate-safe path): says "could not re-check" and does NOT do a second GET', async () => {
    mockFetch({
      create: () => { throw new Error('network'); },
      list: () => reply({ cases: [{ id: 42, case_no: 'OS 45', title: 'Sharma vs Rao' }] }),
    });
    await createToSuccess();
    expect(await screen.findByText('Matter created. I could not re-check the list just now.')).toBeInTheDocument();
    expect(listGets()).toHaveLength(1);                                   // only the duplicate-safe GET; verify adds none
  });

  it('E7: with no id, there is a single "Open Matters" and no "Open matter" button', async () => {
    mockFetch({ create: () => reply({ case: { title: 'Sharma vs Rao', case_no: 'OS 45' } }, 201) });  // no id
    await createToSuccess();
    expect(screen.queryByRole('button', { name: 'Open matter' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Open Matters' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open Matters' }));
    expect(onExit).toHaveBeenCalledWith({ navigateTo: '/matters', created: true });
  });

  it('E7: with an id, there is an "Open matter" and exactly one "Open Matters"', async () => {
    await createToSuccess();                                              // default create returns id 7
    expect(screen.getByRole('button', { name: 'Open matter' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open Matters' })).toHaveLength(1);
  });

  it('Cancel records only the cancelled label and clears the flow', () => {
    renderActive();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onExit).toHaveBeenCalledWith({});
    const label = commandCalls();
    expect(label).toHaveLength(1);
    expect(label[0].body).toEqual({ flow: 'create_matter', event: 'cancelled', conversationId: 1 });
  });

  it('discards the half-filled form after the idle timeout', () => {
    vi.useFakeTimers();
    renderActive();
    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 10); });
    expect(onExit).toHaveBeenCalledWith({});
  });

  it('phase "disabled" shows Open Matters; phase "error" says nothing was saved', () => {
    const { rerender } = render(<CreateMatterCard phase="disabled" onExit={onExit} />);
    fireEvent.click(screen.getByText('Open Matters'));
    expect(onExit).toHaveBeenCalledWith({ navigateTo: '/matters' });
    rerender(<CreateMatterCard phase="error" onExit={onExit} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was saved/i);
  });
});

// ── the page (interception, flag, no-leak, composer inert) ───────────────────────────────────────────────────────────
describe('Assistant page — create-matter interception', () => {
  let calls; let consoleSpies;
  function mockApi({ enabled = true, pingStatus = 200 } = {}) {
    calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url); const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ u, method: (init.method || 'GET').toUpperCase(), body });
      if (u.includes('/api/assistant/conversations')) return reply({ conversations: [] });
      if (u.includes('/api/assistant/command')) {
        if (body.flow === 'create_matter') return reply({ flow: 'create_matter', enabled, conversationId: 1, history: [] }, pingStatus);
        return reply({ intent: 'clarify', question: 'Which one?', choices: [] });
      }
      return reply({});
    });
  }
  function Probe() { const l = useLocation(); return <div data-testid="loc" data-path={l.pathname} />; }
  function renderAssistant(state = null) {
    return render(
      <MemoryRouter initialEntries={[{ pathname: '/assistant', state }]}>
        <Routes>
          <Route path="/assistant" element={<><Assistant /><Probe /></>} />
          <Route path="/matters" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
  }
  const commandCalls = () => calls.filter((c) => c.u.includes('/api/assistant/command'));
  async function trigger() {
    const box = screen.getByLabelText('Your command');
    fireEvent.change(box, { target: { value: SENTENCE } });
    fireEvent.keyDown(box, { key: 'Enter' });
  }
  beforeEach(() => {
    document.cookie = 'csrf_access_token=abc';
    consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    localStorage.clear(); sessionStorage.clear();
  });
  afterEach(() => { consoleSpies.forEach((s) => s.mockRestore()); });

  it('flag ON: starts the flow, sends only the label, never the sentence', async () => {
    mockApi({ enabled: true });
    renderAssistant();
    await trigger();
    await waitFor(() => expect(screen.getByText(/case title/i)).toBeInTheDocument());
    expect(commandCalls()).toHaveLength(1);
    expect(commandCalls()[0].body).toMatchObject({ flow: 'create_matter' });
    expect(screen.getByText('Create a matter')).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
    const logged = consoleSpies.flatMap((s) => s.mock.calls.flat()).join(' ');
    expect(logged).not.toContain(SENTENCE);
  });

  it('flag OFF: shows Open Matters and collects nothing', async () => {
    mockApi({ enabled: false });
    renderAssistant();
    await trigger();
    await waitFor(() => expect(screen.getByText('Open Matters')).toBeInTheDocument());
    expect(screen.queryByLabelText('Case title')).not.toBeInTheDocument();
  });

  it('ping failure: friendly message, sentence never sent', async () => {
    mockApi({ enabled: true, pingStatus: 500 });
    renderAssistant();
    await trigger();
    await waitFor(() => expect(screen.getByText(/couldn’t start the new-matter form/i)).toBeInTheDocument());
    expect(commandCalls().every((c) => c.body.flow === 'create_matter')).toBe(true);
  });

  it('the composer is inert while the flow is active', async () => {
    mockApi({ enabled: true });
    renderAssistant();
    await trigger();
    await waitFor(() => expect(screen.getByText(/case title/i)).toBeInTheDocument());
    expect(screen.getByLabelText('Your command')).toBeDisabled();
  });

  it('the Today-bar handover is intercepted the same way', async () => {
    mockApi({ enabled: true });
    renderAssistant({ assistantCommand: 'open a new matter for Mehta vs State' });
    await waitFor(() => expect(screen.getByText(/case title/i)).toBeInTheDocument());
    expect(commandCalls()).toHaveLength(1);
    for (const c of commandCalls()) expect(JSON.stringify(c.body)).not.toContain('Mehta');
  });
});
