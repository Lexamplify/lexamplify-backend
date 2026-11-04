import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import Assistant from '../pages/Assistant.jsx';
import CreateMatterCard from '../components/CreateMatterCard.jsx';
import {
  detectCreateMatter, parseParties, normalizeAnswer, validateSlot, IDLE_TIMEOUT_MS,
} from '../assistant/createMatterFlow.js';

// The mic is not under test here; stub it so no speech hook/network is touched.
vi.mock('../components/MicButton.jsx', () => ({ default: () => null, LangPicker: () => null }));
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { name: 'Asha Rao' } }),
  AuthProvider: ({ children }) => children,
}));

const SENTENCE = 'create a matter for Sharma vs Rao';
const NAMES = ['Sharma', 'Rao'];

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

  it('splits parties by plain code', () => {
    expect(parseParties('Sharma vs Rao')).toEqual({ title: 'Sharma vs Rao', client: 'Sharma', opposite_party: 'Rao' });
    expect(parseParties('Estate planning')).toEqual({ title: 'Estate planning', client: '', opposite_party: '' });
  });

  it('normalises Indic and spoken numbers for the case number only', () => {
    expect(normalizeAnswer('case_no', 'forty five')).toBe('45');
    expect(normalizeAnswer('case_no', '१२३')).toBe('123');
    expect(normalizeAnswer('title', 'forty five')).toBe('forty five'); // not a number slot
  });

  it('validates length and enum, and required-ness', () => {
    expect(validateSlot('title', '')).toMatch(/needed/);
    expect(validateSlot('client', '')).toBe('');                       // optional
    expect(validateSlot('case_type', 'Nope')).toMatch(/Choose one/);
    expect(validateSlot('court', 'x'.repeat(161))).toMatch(/under 160/);
    expect(validateSlot('title', 'Sharma vs Rao')).toBe('');
  });
});

// ── the card (slot machine) ──────────────────────────────────────────────────────────────────────────────────────────
describe('CreateMatterCard', () => {
  afterEach(() => { vi.useRealTimers(); });

  function renderCard(props = {}) {
    return render(<CreateMatterCard phase="active" parsed={{ title: 'Sharma vs Rao', client: 'Sharma', opposite_party: 'Rao' }}
      onCancel={props.onCancel || (() => {})} onOpenMatters={props.onOpenMatters || (() => {})} />);
  }

  it('asks the fields in order and pre-fills the title', () => {
    renderCard();
    expect(screen.getByText(/case title/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Case title')).toHaveValue('Sharma vs Rao');
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText(/Which court/i)).toBeInTheDocument();
  });

  it('a required field cannot advance empty and shows a message', () => {
    renderCard();
    fireEvent.change(screen.getByLabelText('Case title'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByRole('alert')).toHaveTextContent(/case title is needed/i);
    expect(screen.getByLabelText('Case title')).toBeInTheDocument();  // still on the same step (not advanced to Court)
    expect(screen.queryByLabelText('Court')).not.toBeInTheDocument();
  });

  it('a required field has no Skip; an optional field can be skipped', () => {
    renderCard();
    expect(screen.queryByText('Skip')).not.toBeInTheDocument();       // title is required
    fireEvent.click(screen.getByText('Next'));                        // court
    fireEvent.change(screen.getByLabelText('Court'), { target: { value: 'Madras High Court' } });
    fireEvent.click(screen.getByText('Next'));                        // case number
    fireEvent.change(screen.getByLabelText('Case number'), { target: { value: 'OS 45 of 2024' } });
    fireEvent.click(screen.getByText('Next'));                        // case type (optional, chips)
    expect(screen.getByText('Skip')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Civil'));                       // chip = choose + advance
    expect(screen.getByText(/acting for/i)).toBeInTheDocument();      // client
  });

  it('a typed/voice value is accepted only on Next (not when the field merely changes), and Back keeps values', () => {
    renderCard();
    fireEvent.click(screen.getByText('Next'));                        // court
    // Simulate a mic/typed insert: the field changes but the step must NOT advance on its own.
    fireEvent.change(screen.getByLabelText('Court'), { target: { value: 'Madras High Court' } });
    expect(screen.getByText(/Which court/i)).toBeInTheDocument();     // still on court
    fireEvent.click(screen.getByText('Next'));                        // now accepted → case number
    fireEvent.click(screen.getByText('Back'));                        // back to court
    expect(screen.getByLabelText('Court')).toHaveValue('Madras High Court');
  });

  it('reaches the summary with the next-step line and no create/conflict call', async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (u) => { calls.push(String(u)); return { ok: true, status: 200, json: async () => ({}) }; });
    renderCard();
    fireEvent.click(screen.getByText('Next'));                        // court
    fireEvent.change(screen.getByLabelText('Court'), { target: { value: 'Madras High Court' } });
    fireEvent.click(screen.getByText('Next'));                        // case number
    fireEvent.change(screen.getByLabelText('Case number'), { target: { value: '45' } });
    fireEvent.click(screen.getByText('Next'));                        // case type
    fireEvent.click(screen.getByText('Civil'));                       // client
    fireEvent.click(screen.getByText('Next'));                        // opposite party
    fireEvent.click(screen.getByText('Next'));                        // → summary
    expect(screen.getByText(/Creating the matter is the next step/i)).toBeInTheDocument();
    expect(screen.getByText('Here’s the new matter')).toBeInTheDocument();
    expect(calls.some((u) => u.includes('/api/practice/cases') || u.includes('/api/conflict/check'))).toBe(false);
  });

  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    renderCard({ onCancel });
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('discards the half-filled form after the idle timeout', () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    renderCard({ onCancel });
    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 10); });
    expect(onCancel).toHaveBeenCalled();
  });

  it('phase "disabled" shows Open Matters and collects nothing', () => {
    const onOpenMatters = vi.fn();
    render(<CreateMatterCard phase="disabled" onCancel={() => {}} onOpenMatters={onOpenMatters} />);
    expect(screen.queryByLabelText('Case title')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Open Matters'));
    expect(onOpenMatters).toHaveBeenCalled();
  });

  it('phase "error" says nothing was saved and collects nothing', () => {
    render(<CreateMatterCard phase="error" onCancel={() => {}} onOpenMatters={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing was saved/i);
    expect(screen.queryByLabelText('Case title')).not.toBeInTheDocument();
  });
});

// ── the page (interception, flag, no-leak) ───────────────────────────────────────────────────────────────────────────
describe('Assistant page — create-matter interception', () => {
  let calls;
  let consoleSpies;

  function mockApi({ enabled = true, pingStatus = 200 } = {}) {
    calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url);
      const body = init.body ? JSON.parse(init.body) : {};
      calls.push({ u, method: (init.method || 'GET').toUpperCase(), body });
      if (u.includes('/api/assistant/conversations')) return reply({ conversations: [] });
      if (u.includes('/api/assistant/command')) {
        if (body.flow === 'create_matter') {
          return reply({ flow: 'create_matter', enabled, conversationId: 1, history: [] }, pingStatus);
        }
        return reply({ intent: 'clarify', question: 'Which one?', choices: [] });
      }
      return reply({});
    });
  }
  function reply(body, status = 200) {
    return { ok: status < 400, status, headers: { get: () => null }, json: async () => body };
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

  beforeEach(() => {
    document.cookie = 'csrf_access_token=abc';
    consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => { consoleSpies.forEach((s) => s.mockRestore()); vi.useRealTimers(); });

  async function triggerFromComposer() {
    const box = screen.getByLabelText('Your command');
    fireEvent.change(box, { target: { value: SENTENCE } });
    fireEvent.keyDown(box, { key: 'Enter' });
  }

  it('flag ON: starts the guided flow and sends only the label, never the sentence', async () => {
    mockApi({ enabled: true });
    renderAssistant();
    await triggerFromComposer();
    await waitFor(() => expect(screen.getByText(/case title/i)).toBeInTheDocument());
    // The one and only command call is the label ping; no sentence anywhere in any body or the console.
    const pings = commandCalls();
    expect(pings).toHaveLength(1);
    expect(pings[0].body).toMatchObject({ flow: 'create_matter' });
    for (const c of commandCalls()) {
      const dumped = JSON.stringify(c.body);
      for (const n of NAMES) expect(dumped).not.toContain(n);
    }
    const logged = consoleSpies.flatMap((s) => s.mock.calls.flat()).join(' ');
    expect(logged).not.toContain(SENTENCE);
    // The visible user turn is the label, not the sentence.
    expect(screen.getByText('Create a matter')).toBeInTheDocument();
    expect(screen.queryByText(SENTENCE)).not.toBeInTheDocument();
  });

  it('flag OFF: shows Open Matters, collects nothing, sentence never sent', async () => {
    mockApi({ enabled: false });
    renderAssistant();
    await triggerFromComposer();
    await waitFor(() => expect(screen.getByText('Open Matters')).toBeInTheDocument());
    expect(screen.queryByLabelText('Case title')).not.toBeInTheDocument();
    expect(commandCalls().every((c) => c.body.flow === 'create_matter')).toBe(true);
  });

  it('makes zero command calls once the flow is running', async () => {
    mockApi({ enabled: true });
    renderAssistant();
    await triggerFromComposer();
    await waitFor(() => expect(screen.getByText(/case title/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Case title'), { target: { value: 'Sharma vs Rao' } });
    fireEvent.click(screen.getByText('Next'));
    fireEvent.change(screen.getByLabelText('Court'), { target: { value: 'Madras High Court' } });
    fireEvent.click(screen.getByText('Next'));
    expect(commandCalls()).toHaveLength(1);                           // still just the ping
  });

  it('ping failure: nothing collected, friendly message, sentence never sent', async () => {
    mockApi({ enabled: true, pingStatus: 500 });
    renderAssistant();
    await triggerFromComposer();
    await waitFor(() => expect(screen.getByText(/couldn’t start the new-matter form/i)).toBeInTheDocument());
    expect(screen.queryByLabelText('Case title')).not.toBeInTheDocument();
    expect(commandCalls().every((c) => c.body.flow === 'create_matter')).toBe(true);
  });

  it('the composer is inert while the flow is active (Enter does nothing)', async () => {
    mockApi({ enabled: true });
    renderAssistant();
    await triggerFromComposer();
    await waitFor(() => expect(screen.getByText(/case title/i)).toBeInTheDocument());
    const box = screen.getByLabelText('Your command');
    expect(box).toBeDisabled();
    fireEvent.change(box, { target: { value: 'open calendar' } });   // ignored: disabled
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(commandCalls()).toHaveLength(1);                           // no new command sent
  });

  it('the Today-bar handover is intercepted the same way', async () => {
    mockApi({ enabled: true });
    renderAssistant({ assistantCommand: 'open a new matter for Mehta vs State' });
    await waitFor(() => expect(screen.getByText(/case title/i)).toBeInTheDocument());
    expect(commandCalls()).toHaveLength(1);
    expect(commandCalls()[0].body).toMatchObject({ flow: 'create_matter' });
    for (const c of commandCalls()) expect(JSON.stringify(c.body)).not.toContain('Mehta');
  });

  it('logout clears an in-flight flow', async () => {
    mockApi({ enabled: true });
    renderAssistant();
    await triggerFromComposer();
    await waitFor(() => expect(screen.getByText(/case title/i)).toBeInTheDocument());
    act(() => { window.dispatchEvent(new CustomEvent('lexamplify:session-expired')); });
    await waitFor(() => expect(screen.queryByLabelText('Case title')).not.toBeInTheDocument());
  });
});
