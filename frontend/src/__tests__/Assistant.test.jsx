import React, { StrictMode, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import Assistant from '../pages/Assistant.jsx';
import Today from '../pages/Today.jsx';
import { FEATURES } from '../assistant/featureRegistry.js';

// Today reads the signed-in person from the auth context; the assistant page itself does not.
vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { name: 'Asha Rao', firm_name: 'Rao & Associates' } }),
  AuthProvider: ({ children }) => children,
}));

/* The model and the backend are faked; nothing here reaches the network. */

let fetchMock;
let navSpy;

function reply(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status < 400,
    status,
    headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

/** A fetch fake: conversations list, delete, and one scripted answer for the command route. */
function mockApi({ command, conversations = [], onDelete } = {}) {
  fetchMock = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/assistant/conversations')) {
      if ((init.method || 'GET').toUpperCase() === 'DELETE') {
        onDelete?.(u);
        return reply({ deleted: true });
      }
      return reply({ conversations });
    }
    if (u.includes('/api/assistant/command')) {
      const next = typeof command === 'function' ? command(JSON.parse(init.body || '{}')) : command;
      return next ?? reply({ intent: 'clarify', question: 'Which one?', choices: [] });
    }
    return reply({});
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc" data-path={loc.pathname} data-state={JSON.stringify(loc.state ?? null)} />;
}

function renderAssistant({ state = null, strict = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[{ pathname: '/assistant', state }]}>
      <Routes>
        <Route path="/assistant" element={<><Assistant /><Probe /></>} />
        <Route path="/draft" element={<Probe />} />
        <Route path="/workspaces" element={<Probe />} />
        <Route path="/legal-forms" element={<Probe />} />
        <Route path="/calendar" element={<Probe />} />
      </Routes>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function renderToday() {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <Routes>
        <Route path="/start" element={<Today />} />
        <Route path="/assistant" element={<Probe />} />
        <Route path="/draft" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const loc = () => screen.getByTestId('loc');

beforeEach(() => {
  document.cookie = 'csrf_access_token=abc';
  navSpy = undefined;
  mockApi({});
  vi.stubEnv('VITE_ASSISTANT_PAGE', 'true');
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function send(text) {
  const box = screen.getByLabelText('Your command');
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /Send/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/api/assistant/command'), expect.anything(),
  ));
}

// ── the Today hand-off ──────────────────────────────────────────────────────────────────────────────────────────────
describe('Today hands the command to the assistant', () => {
  it('goes to /assistant with the command in router state, not in the URL', () => {
    renderToday();
    fireEvent.change(screen.getByPlaceholderText(/Ask Lexamplify/i), { target: { value: 'what is the limitation period' } });
    fireEvent.click(screen.getByRole('button', { name: /Begin/i }));
    expect(loc().dataset.path).toBe('/assistant');
    expect(JSON.parse(loc().dataset.state)).toEqual({ assistantCommand: 'what is the limitation period' });
    expect(loc().dataset.path).not.toContain('limitation');
  });

  it('still goes to /draft when VITE_ASSISTANT_PAGE is false', () => {
    vi.stubEnv('VITE_ASSISTANT_PAGE', 'false');
    renderToday();
    fireEvent.change(screen.getByPlaceholderText(/Ask Lexamplify/i), { target: { value: 'draft a notice' } });
    fireEvent.click(screen.getByRole('button', { name: /Begin/i }));
    expect(loc().dataset.path).toBe('/draft');
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: 'draft a notice' });
  });

  it('leaves the ask bar itself untouched', () => {
    renderToday();
    const input = screen.getByPlaceholderText('Ask Lexamplify, or begin a draft — “Draft a legal notice for recovery of dues”');
    expect(input).toBeTruthy();
    expect(screen.getByRole('button', { name: /Begin/i })).toBeTruthy();
  });
});

describe('the handed-over command', () => {
  it('runs exactly once, even in StrictMode, and the router state is cleared', async () => {
    mockApi({ command: reply({ intent: 'navigate', feature: 'calendar', action: 'open', understood: 'Open the calendar.', conversationId: 7 }) });
    renderAssistant({ state: { assistantCommand: 'show my hearings tomorrow' }, strict: true });
    await screen.findByText('Open the calendar.');
    const commandCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/assistant/command'));
    expect(commandCalls).toHaveLength(1);
    expect(JSON.parse(loc().dataset.state)).toBeNull();            // a refresh cannot run it again
  });

  it('shows an empty assistant and does not crash when there is no state', async () => {
    renderAssistant({ state: null });
    expect(await screen.findByText(/Try “show my hearings tomorrow”/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/command'))).toHaveLength(0);
  });
});

// ── proposals, Confirm and navigation safety ────────────────────────────────────────────────────────────────────────
describe('proposals', () => {
  it('a read-only proposal offers Open and never Confirm', async () => {
    mockApi({ command: reply({ intent: 'navigate', feature: 'legal_forms', action: 'open', requires_confirm: false, understood: 'Open Legal Forms.' }) });
    renderAssistant();
    await send('open legal forms');
    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirm/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(loc().dataset.path).toBe('/legal-forms');
  });

  it('a write proposal needs Confirm and calls no write endpoint', async () => {
    mockApi({ command: reply({ intent: 'create', feature: 'calendar', action: 'create', requires_confirm: true, understood: 'Add a hearing.' }) });
    renderAssistant();
    await send('add a hearing next Tuesday');
    expect(await screen.findByRole('button', { name: /Confirm and open/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Open$/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Confirm and open/i }));
    expect(loc().dataset.path).toBe('/calendar');
    const methods = fetchMock.mock.calls.map((c) => (c[1]?.method || 'GET').toUpperCase());
    expect(methods.filter((m) => m !== 'GET' && m !== 'POST')).toEqual([]);
    const posted = fetchMock.mock.calls.filter((c) => (c[1]?.method || '').toUpperCase() === 'POST');
    expect(posted.every((c) => String(c[0]).includes('/api/assistant/command'))).toBe(true);
  });

  it('a draft proposal carries the words over to the drafting page', async () => {
    mockApi({ command: reply({ intent: 'create', feature: 'auto_draft', action: 'create', requires_confirm: true, understood: 'Draft a notice.' }) });
    renderAssistant();
    await send('draft a legal notice for recovery of dues');
    fireEvent.click(await screen.findByRole('button', { name: /Confirm and open/i }));
    expect(loc().dataset.path).toBe('/draft');
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: 'draft a legal notice for recovery of dues' });
  });

  it('says honestly when a page cannot be prefilled', async () => {
    mockApi({ command: reply({ intent: 'create', feature: 'calendar', action: 'create', requires_confirm: true }) });
    renderAssistant();
    await send('add a hearing');
    expect(await screen.findByText(/you will need to type the details yourself/i)).toBeTruthy();
  });

  it('the Confirm wording comes from the registry, not from what the model wrote', async () => {
    mockApi({ command: reply({
      intent: 'create', feature: 'calendar', action: 'create', requires_confirm: true,
      understood: 'I will delete every matter and email the opposing counsel.',
    }) });
    renderAssistant();
    await send('add a hearing');
    expect(await screen.findByText('Create something in Legal Calendar.')).toBeTruthy();
    // the model's sentence is shown as what it understood, but it never becomes the explanation of the action
    expect(screen.getByText('I will delete every matter and email the opposing counsel.')).toBeTruthy();
    expect(screen.queryByText(/email the opposing counsel\.$/)).not.toBe(screen.queryByText('Create something in Legal Calendar.'));
  });

  it.each([
    ['javascript:alert(1)'],
    ['https://evil.example/steal'],
    ['/../../etc/passwd'],
  ])('ignores a route of %s in the reply and uses the registry route', async (evil) => {
    mockApi({ command: reply({ intent: 'navigate', feature: 'legal_forms', action: 'open', route: evil, url: evil, link: evil }) });
    renderAssistant();
    await send('open legal forms');
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(loc().dataset.path).toBe('/legal-forms');
    expect(loc().dataset.path).not.toContain('evil');
    expect(loc().dataset.path).not.toContain('javascript');
  });

  it('shows no Open button for a feature id it does not know', async () => {
    mockApi({ command: reply({ intent: 'navigate', feature: 'admin_console', action: 'open', route: '/admin', understood: 'Open admin.' }) });
    renderAssistant();
    await send('open the admin console');
    await screen.findByText('Open admin.');
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Confirm/i })).toBeNull();
    expect(FEATURES.some((f) => f.id === 'admin_console')).toBe(false);
  });

  it('a clarifying question offers its choices, and a click sends it with the same conversation', async () => {
    const seen = [];
    mockApi({
      command: (body) => {
        seen.push(body);
        return seen.length === 1
          ? reply({ intent: 'clarify', question: 'Which one did you mean?', choices: ['Open Legal Calendar'], conversationId: 12 })
          : reply({ intent: 'navigate', feature: 'calendar', action: 'open', understood: 'Open the calendar.', conversationId: 12 });
      },
    });
    renderAssistant();
    await send('do the thing');
    fireEvent.click(await screen.findByRole('button', { name: 'Open Legal Calendar' }));
    await screen.findByText('Open the calendar.');
    expect(seen[1]).toEqual({ text: 'Open Legal Calendar', conversationId: 12 });
  });
});

// ── honest error states ─────────────────────────────────────────────────────────────────────────────────────────────
describe('error states', () => {
  it.each([
    ['RATE_LIMITED', 429, /wait a minute/i],
    ['ASSISTANT_UNAVAILABLE', 502, /could not be reached/i],
    ['NO_WORKSPACE', 403, /choose a client workspace/i],
    ['WORKSPACE_FORBIDDEN', 403, /do not have access/i],
    ['INVALID_WORKSPACE', 400, /not valid/i],
    ['TEXT_TOO_LONG', 400, /shorten it/i],
  ])('%s shows its own message and the Auto-Draft escape hatch', async (code, status, text) => {
    mockApi({ command: reply({ error: true, code }, { status }) });
    renderAssistant();
    await send('find something');
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open Auto-Draft with this text/i })).toBeTruthy();
  });

  it('a network failure says so and offers the escape hatch', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/conversations')) return reply({ conversations: [] });
      throw new TypeError('Failed to fetch');
    });
    fetchMock = globalThis.fetch;
    renderAssistant();
    const box = screen.getByLabelText('Your command');
    fireEvent.change(box, { target: { value: 'find something' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    expect(await screen.findByText(/could not reach the server/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open Auto-Draft with this text/i })).toBeTruthy();
  });

  it('a busy assistant counts down before another try is offered', async () => {
    mockApi({ command: reply({ error: true, code: 'ASSISTANT_BUSY' }, { status: 503, headers: { 'Retry-After': '1' } }) });
    renderAssistant();
    await send('find something');
    expect(await screen.findByText(/Trying again is possible in 1s/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeDisabled();
    // the countdown runs on a real one-second tick, then the retry opens up again
    await waitFor(() => expect(screen.getByRole('button', { name: /Try again/i })).not.toBeDisabled(), { timeout: 4000 });
    expect(screen.getByText(/You can try again now/)).toBeTruthy();
  });

  it('the escape hatch opens Auto-Draft with the words typed', async () => {
    mockApi({ command: reply({ error: true, code: 'ASSISTANT_UNAVAILABLE' }, { status: 502 }) });
    renderAssistant();
    await send('draft a notice for dues');
    fireEvent.click(await screen.findByRole('button', { name: /Open Auto-Draft with this text/i }));
    expect(loc().dataset.path).toBe('/draft');
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: 'draft a notice for dues' });
  });

  it('a workspace problem offers the workspace page', async () => {
    mockApi({ command: reply({ error: true, code: 'NO_WORKSPACE' }, { status: 403 }) });
    renderAssistant();
    await send('find something');
    fireEvent.click(await screen.findByRole('button', { name: /Choose a workspace/i }));
    expect(loc().dataset.path).toBe('/workspaces');
  });
});

// ── the composer, history and storage ───────────────────────────────────────────────────────────────────────────────
describe('composer and history', () => {
  it('counts characters and refuses to send more than the limit', async () => {
    renderAssistant();
    const box = screen.getByLabelText('Your command');
    fireEvent.change(box, { target: { value: 'x'.repeat(1001) } });
    expect(screen.getByText(/1001\/1000/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send/i })).toBeDisabled();
    fireEvent.change(box, { target: { value: 'x'.repeat(10) } });
    expect(screen.getByText('10/1000')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send/i })).not.toBeDisabled();
  });

  it('Enter sends and Shift+Enter does not', async () => {
    mockApi({ command: reply({ intent: 'navigate', feature: 'calendar', action: 'open', understood: 'Open the calendar.' }) });
    renderAssistant();
    const box = screen.getByLabelText('Your command');
    fireEvent.change(box, { target: { value: 'open calendar' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/command'))).toHaveLength(0);
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText('Open the calendar.');
  });

  it('shows "no history" when there is none, and lists conversations when there are', async () => {
    renderAssistant();
    expect(await screen.findByText('No history yet.')).toBeTruthy();

    mockApi({ conversations: [{ id: 3, title: 'open calendar', updatedAt: new Date().toISOString() }] });
    renderAssistant();
    expect(await screen.findByText('open calendar')).toBeTruthy();
  });

  it('deleting a conversation asks first', async () => {
    const deleted = [];
    mockApi({
      conversations: [{ id: 3, title: 'open calendar', updatedAt: new Date().toISOString() }],
      onDelete: (u) => deleted.push(u),
    });
    renderAssistant();
    fireEvent.click(await screen.findByRole('button', { name: /Delete conversation open calendar/i }));
    expect(deleted).toHaveLength(0);                               // asked, not done
    expect(screen.getByRole('button', { name: /Keep this conversation/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Confirm deleting open calendar/i }));
    await waitFor(() => expect(deleted).toHaveLength(1));
    expect(deleted[0]).toContain('/api/assistant/conversations/3');
  });

  it('writes nothing to localStorage or sessionStorage', async () => {
    mockApi({ command: reply({ intent: 'navigate', feature: 'calendar', action: 'open', understood: 'Open the calendar.' }) });
    renderAssistant();
    await send('open calendar');
    await screen.findByText('Open the calendar.');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('shows the lawyer command and the reply, with a live region for screen readers', async () => {
    mockApi({ command: reply({ intent: 'navigate', feature: 'calendar', action: 'open', understood: 'Open the calendar.' }) });
    renderAssistant();
    await send('open calendar');
    expect(await screen.findByText('Open the calendar.')).toBeTruthy();
    expect(screen.getByText('open calendar')).toBeTruthy();
    expect(screen.getByLabelText('Conversation').getAttribute('aria-live')).toBe('polite');
  });

  it('Devanagari and Tamil commands are shown as typed', async () => {
    mockApi({ command: reply({ intent: 'navigate', feature: 'calendar', action: 'open', understood: 'Open the calendar.' }) });
    renderAssistant();
    await send('कल की सुनवाई दिखाओ');
    expect(await screen.findByText('कल की सुनवाई दिखाओ')).toBeTruthy();
  });
});

describe('source safety', () => {
  it('neither new file uses dangerouslySetInnerHTML', async () => {
    const page = await import('../pages/Assistant.jsx?raw');
    const css = await import('../styles/assistant.css?raw');
    expect(page.default).not.toMatch(/dangerouslySetInnerHTML/);
    expect(css.default).not.toMatch(/dangerouslySetInnerHTML/);
  });
});


// ── Auto-Draft Confirm always sends the sentence the lawyer TYPED, never a chip's label ────────────────────────────────
// A chip click sends its label as an ordinary command (same conversation) but is not something the lawyer typed. The
// typed sentence is updated by every typed or dictated submit, and by nothing else.
describe('the typed sentence survives chip clicks', () => {
  const TYPED = 'kal ki sunwai ka notice draft karna hai';
  const ASK = (choices, conversationId = 12) => reply({ intent: 'clarify', question: 'Which one did you mean?', choices, conversationId });
  const DRAFT = (conversationId = 12) => reply({
    intent: 'create', feature: 'auto_draft', action: 'create', requires_confirm: true, understood: 'Draft a notice.', conversationId,
  });
  const FAIL = () => reply({ error: true, code: 'ASSISTANT_UNAVAILABLE' }, { status: 502 });

  /** Type into the box and press Send. Each test then waits for the specific reply it expects. */
  function typeAndSend(text) {
    fireEvent.change(screen.getByLabelText('Your command'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
  }

  const lastConfirm = () => {
    const all = screen.getAllByRole('button', { name: /Confirm and open/i });
    return all[all.length - 1];
  };

  it('Confirm after one chip click sends the typed sentence, not the chip label', async () => {
    const seen = [];
    mockApi({ command: (body) => { seen.push(body); return seen.length === 1 ? ASK(['Open Auto-Draft Studio', 'Open Legal Calendar']) : DRAFT(); } });
    renderAssistant();
    await send(TYPED);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Auto-Draft Studio' }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm and open/i }));

    expect(seen[1]).toEqual({ text: 'Open Auto-Draft Studio', conversationId: 12 });   // a chip still sends its label, same conversation
    expect(loc().dataset.path).toBe('/draft');
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: TYPED });
  });

  it('still the typed sentence after two chip clicks in a row', async () => {
    const seen = [];
    mockApi({
      command: (body) => {
        seen.push(body);
        if (seen.length === 1) return ASK(['Open Auto-Draft Studio', 'Open Legal Calendar']);
        if (seen.length === 2) return ASK(['Open Legal Forms', 'Open Matters']);
        return DRAFT();
      },
    });
    renderAssistant();
    await send(TYPED);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Auto-Draft Studio' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Legal Forms' }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm and open/i }));

    expect(seen[1]).toEqual({ text: 'Open Auto-Draft Studio', conversationId: 12 });
    expect(seen[2]).toEqual({ text: 'Open Legal Forms', conversationId: 12 });
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: TYPED });
  });

  it('a NEW typed sentence after a chip replaces the old one', async () => {
    const seen = [];
    mockApi({ command: (body) => { seen.push(body); return seen.length === 1 ? ASK(['Open Matters']) : DRAFT(); } });
    renderAssistant();
    await send(TYPED);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Matters' }));
    await screen.findByRole('button', { name: /Confirm and open/i });          // the chip's reply is on screen

    typeAndSend('draft a legal notice for recovery of dues');
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Confirm and open/i })).toHaveLength(2));
    fireEvent.click(lastConfirm());
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: 'draft a legal notice for recovery of dues' });
    expect(seen[2]).toEqual({ text: 'draft a legal notice for recovery of dues', conversationId: 12 });
  });

  it('a chip clicked AFTER a newer typed sentence belongs to that newer sentence', async () => {
    const seen = [];
    mockApi({
      command: (body) => {
        seen.push(body);
        if (seen.length === 1) return ASK(['Open Matters']);
        if (seen.length === 2) return ASK(['Open Legal Forms']);
        if (seen.length === 3) return ASK(['Open Calendar']);
        return DRAFT();
      },
    });
    renderAssistant();
    await send(TYPED);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Matters' }));
    await screen.findByRole('button', { name: 'Open Legal Forms' });

    typeAndSend('draft an affidavit for name change');
    fireEvent.click(await screen.findByRole('button', { name: 'Open Calendar' }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm and open/i }));
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: 'draft an affidavit for name change' });
  });

  it('each card keeps the sentence it belongs to: an earlier card still confirms with its own typed sentence', async () => {
    const seen = [];
    mockApi({ command: (body) => { seen.push(body); return seen.length === 1 ? ASK(['Open Matters']) : DRAFT(); } });
    renderAssistant();
    await send(TYPED);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Matters' }));
    const firstConfirm = await screen.findByRole('button', { name: /Confirm and open/i });
    typeAndSend('a completely different sentence about a sale deed');
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Confirm and open/i })).toHaveLength(2));
    fireEvent.click(firstConfirm);                                   // the card from before the new sentence
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: TYPED });
  });

  it('the Auto-Draft escape hatch on an error after a chip also sends the typed sentence', async () => {
    const seen = [];
    mockApi({ command: (body) => { seen.push(body); return seen.length === 1 ? ASK(['Open Matters']) : FAIL(); } });
    renderAssistant();
    await send(TYPED);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Matters' }));
    fireEvent.click(await screen.findByRole('button', { name: /Open Auto-Draft with this text/i }));
    expect(loc().dataset.path).toBe('/draft');
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: TYPED });
  });

  it('retrying a failed chip click re-sends the chip label and keeps the typed sentence', async () => {
    const seen = [];
    mockApi({
      command: (body) => {
        seen.push(body);
        if (seen.length === 1) return ASK(['Open Matters']);
        if (seen.length === 2) return FAIL();
        return DRAFT();
      },
    });
    renderAssistant();
    await send(TYPED);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Matters' }));
    fireEvent.click(await screen.findByRole('button', { name: /Try again/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm and open/i }));

    expect(seen[2]).toEqual({ text: 'Open Matters', conversationId: 12 });      // the retry is still a chip: label, same conversation
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: TYPED });
  });

  it('the sentence handed over from the Today bar counts as typed', async () => {
    const seen = [];
    mockApi({ command: (body) => { seen.push(body); return seen.length === 1 ? ASK(['Open Auto-Draft Studio']) : DRAFT(); } });
    renderAssistant({ state: { assistantCommand: TYPED } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Auto-Draft Studio' }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm and open/i }));
    expect(seen[0]).toEqual({ text: TYPED });
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: TYPED });
  });

  it('chips still send their label with the same conversation id, as a normal command', async () => {
    const seen = [];
    mockApi({ command: (body) => { seen.push(body); return seen.length === 1 ? ASK(['Open Legal Calendar'], 31) : reply({ intent: 'navigate', feature: 'calendar', action: 'open', understood: 'Open the calendar.', conversationId: 31 }); } });
    renderAssistant();
    await send('do the thing');
    fireEvent.click(await screen.findByRole('button', { name: 'Open Legal Calendar' }));
    await screen.findByText('Open the calendar.');
    expect(seen[1]).toEqual({ text: 'Open Legal Calendar', conversationId: 31 });
  });
});


// ── a plain "open <page>" opens directly; a model-backed proposal still shows its card ───────────────────────────────────
describe('direct open of a rule-matched page', () => {
  // What the server sends for a command a rule settled WITH an explicit verb or a multi-word name ("open legal forms."):
  // no model, nothing to confirm, and autoOpen: true. The page opens by itself only on that flag (it used to infer it).
  const OPEN_FORMS = (extra = {}) => reply({
    intent: 'navigate', feature: 'legal_forms', action: 'open', inputs: {}, requires_confirm: false, route: '/legal-forms',
    question: null, choices: [], conversationId: null, modelUsed: false, autoOpen: true, history: [], understood: 'Open Legal Forms.', ...extra,
  });

  /** Renders the page and records every navigation (path and PUSH / REPLACE / POP), counting each location once. */
  function renderLogged({ state = null, strict = false } = {}) {
    const log = [];
    const seen = new Set();
    function NavProbe() {
      const l = useLocation();
      const type = useNavigationType();
      useEffect(() => {
        if (!seen.has(l.key)) { seen.add(l.key); log.push({ path: l.pathname, type }); }
      }, [l.key, l.pathname, type]);
      return <div data-testid="loc" data-path={l.pathname} data-state={JSON.stringify(l.state ?? null)} />;
    }
    const tree = (
      <MemoryRouter initialEntries={[{ pathname: '/assistant', state }]}>
        <Routes>
          <Route path="/assistant" element={<><Assistant /><NavProbe /></>} />
          <Route path="/legal-forms" element={<NavProbe />} />
          <Route path="/calendar" element={<NavProbe />} />
          <Route path="/draft" element={<NavProbe />} />
        </Routes>
      </MemoryRouter>
    );
    render(strict ? <StrictMode>{tree}</StrictMode> : tree);
    return log;
  }

  const commandCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/assistant/command'));
  const tick = (ms = 120) => new Promise((resolve) => { setTimeout(resolve, ms); });

  it('opens exactly once under StrictMode, and uses REPLACE when the command was handed over from Today', async () => {
    mockApi({ command: OPEN_FORMS() });
    const log = renderLogged({ state: { assistantCommand: 'open legal forms.' }, strict: true });
    await waitFor(() => expect(loc().dataset.path).toBe('/legal-forms'));
    await tick();
    expect(commandCalls()).toHaveLength(1);
    expect(log.filter((e) => e.path === '/legal-forms')).toEqual([{ path: '/legal-forms', type: 'REPLACE' }]);
  });

  it('uses a normal PUSH when the command was typed on the page, so Back returns to the conversation', async () => {
    mockApi({ command: OPEN_FORMS() });
    const log = renderLogged();
    await send('open legal forms.');
    await waitFor(() => expect(loc().dataset.path).toBe('/legal-forms'));
    expect(log.filter((e) => e.path === '/legal-forms')).toEqual([{ path: '/legal-forms', type: 'PUSH' }]);
  });

  it('shows a short "Opening ..." line before it goes, built from the registry', async () => {
    const added = [];
    const observer = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => added.push(n.textContent || ''))));
    observer.observe(document.body, { childList: true, subtree: true });
    mockApi({ command: OPEN_FORMS({ understood: 'Something the server wrote that must not be what is shown.' }) });
    renderLogged();
    await send('open legal forms.');
    await waitFor(() => expect(loc().dataset.path).toBe('/legal-forms'));
    observer.disconnect();
    expect(added.some((t) => t.includes('Opening Legal Forms…'))).toBe(true);
    expect(added.some((t) => t.includes('must not be what is shown'))).toBe(false);
  });

  it('works with no conversation id and no history (no workspace selected)', async () => {
    mockApi({ command: OPEN_FORMS({ conversationId: null, history: [] }) });
    renderLogged();
    await send('open legal forms.');
    await waitFor(() => expect(loc().dataset.path).toBe('/legal-forms'));
    expect(JSON.parse(commandCalls()[0][1].body)).toEqual({ text: 'open legal forms.' });      // no conversationId sent
  });

  it('never opens anything but the registry route, whatever the reply says', async () => {
    mockApi({ command: OPEN_FORMS({ route: 'https://evil.example/steal', url: 'javascript:alert(1)', link: '/../../etc/passwd' }) });
    renderLogged();
    await send('open legal forms.');
    await waitFor(() => expect(loc().dataset.path).toBe('/legal-forms'));
  });

  it('a model-backed open proposal still shows its card and the Open button, and does not open by itself', async () => {
    mockApi({ command: OPEN_FORMS({ modelUsed: true, autoOpen: undefined, understood: 'Open Legal Forms.' }) });
    renderLogged();
    await send('please find me the forms');
    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy();
    await tick(200);
    expect(loc().dataset.path).toBe('/assistant');
    expect(screen.queryByText('Opening Legal Forms…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(loc().dataset.path).toBe('/legal-forms');
  });

  it.each([
    ['a reply with no autoOpen field', { autoOpen: undefined }],
    ['a reply whose autoOpen is false', { autoOpen: false }],
    ['a reply whose autoOpen is the string "true"', { autoOpen: 'true' }],
    ['a reply whose autoOpen is the number 1', { autoOpen: 1 }],
    ['a reply that needs Confirm', { requires_confirm: true, action: 'create', feature: 'calendar' }],
    ['a reply that is not an open', { action: 'search' }],
    ['a reply that is a question', { intent: 'clarify', question: 'Which one?', choices: ['Open Legal Calendar'] }],
  ])('does not open by itself for %s', async (_label, extra) => {
    mockApi({ command: OPEN_FORMS(extra) });
    renderLogged();
    await send('some command');
    await screen.findAllByText(/I understood|Which one\?/);
    await tick(200);
    expect(loc().dataset.path).toBe('/assistant');
  });

  it('does not open a feature id it does not know', async () => {
    mockApi({ command: OPEN_FORMS({ feature: 'admin_console', route: '/admin' }) });
    renderLogged();
    await send('open the admin console');
    await tick(200);
    expect(loc().dataset.path).toBe('/assistant');
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  it('a write proposal still needs Confirm and still calls no write endpoint', async () => {
    mockApi({ command: reply({ intent: 'create', feature: 'calendar', action: 'create', requires_confirm: true, modelUsed: true, inputs: {}, conversationId: null, history: [] }) });
    renderLogged();
    await send('add a hearing');
    expect(await screen.findByRole('button', { name: /Confirm and open/i })).toBeTruthy();
    await tick(200);
    expect(loc().dataset.path).toBe('/assistant');
    expect(fetchMock.mock.calls.filter((c) => !['GET', 'POST'].includes((c[1]?.method || 'GET').toUpperCase()))).toHaveLength(0);
  });
});

describe('no workspace: a null conversation id and an empty list are normal, not errors', () => {
  it('a chip clicked after a reply with a null conversation id sends no conversationId', async () => {
    const seen = [];
    mockApi({
      command: (body) => {
        seen.push(body);
        return seen.length === 1
          ? reply({ intent: 'clarify', question: 'Which one?', choices: ['Open Legal Calendar'], conversationId: null, history: [] })
          : reply({ intent: 'navigate', feature: 'calendar', action: 'open', inputs: {}, requires_confirm: false, modelUsed: true, understood: 'Open the calendar.', conversationId: null });
      },
    });
    renderAssistant();
    await send('do the thing');
    fireEvent.click(await screen.findByRole('button', { name: 'Open Legal Calendar' }));
    await screen.findByText('Open the calendar.');
    expect(seen[1]).toEqual({ text: 'Open Legal Calendar' });
    expect('conversationId' in seen[1]).toBe(false);
  });

  it('an empty conversation list shows "No history yet." and no error banner', async () => {
    mockApi({ conversations: [] });
    renderAssistant();
    expect(await screen.findByText('No history yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});


// ── a bare word is understood but never makes the page jump; Auto-Draft seeding on a direct open ─────────────────────────
describe('autoOpen: only an explicit verb or a multi-word name opens by itself', () => {
  // A bare word ("tomorrow", "notice", "matters"): the server understands it with a rule but sends NO autoOpen.
  const BARE = (feature, extra = {}) => reply({
    intent: 'navigate', feature, action: 'open', inputs: {}, requires_confirm: false, route: '/x', question: null, choices: [],
    conversationId: null, modelUsed: false, history: [], understood: 'Open it.', ...extra,
  });
  const AUTO = (feature, extra = {}) => BARE(feature, { autoOpen: true, ...extra });

  function renderLogged({ state = null } = {}) {
    const log = [];
    const seen = new Set();
    function NavProbe() {
      const l = useLocation();
      const type = useNavigationType();
      useEffect(() => {
        if (!seen.has(l.key)) { seen.add(l.key); log.push({ path: l.pathname, type }); }
      }, [l.key, l.pathname, type]);
      return <div data-testid="loc" data-path={l.pathname} data-state={JSON.stringify(l.state ?? null)} />;
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/assistant', state }]}>
        <Routes>
          <Route path="/assistant" element={<><Assistant /><NavProbe /></>} />
          <Route path="/legal-forms" element={<NavProbe />} />
          <Route path="/calendar" element={<NavProbe />} />
          <Route path="/matters" element={<NavProbe />} />
          <Route path="/draft" element={<NavProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    return log;
  }
  const tick = (ms = 200) => new Promise((resolve) => { setTimeout(resolve, ms); });

  it.each([
    ['tomorrow', 'calendar'], ['notice', 'auto_draft'], ['today', 'start'], ['calendar', 'calendar'], ['matters', 'matters'],
    ['dashboard', 'dashboard'], ['practice', 'practice'], ['settings', 'settings'], ['research', 'research'], ['clients', 'clients'],
  ])('the bare word "%s" shows the normal card with an Open button and does not navigate', async (word, feature) => {
    mockApi({ command: BARE(feature) });
    renderLogged();
    await send(word);
    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy();
    await tick();
    expect(loc().dataset.path).toBe('/assistant');
    expect(screen.queryByText(/^Opening /)).toBeNull();
  });

  it('the Open button on a bare word still works, and goes to the registry route', async () => {
    mockApi({ command: BARE('calendar') });
    renderLogged();
    await send('calendar');
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(loc().dataset.path).toBe('/calendar');
  });

  it('"open matters" (an explicit verb with a one-word name) opens directly', async () => {
    mockApi({ command: AUTO('matters') });
    renderLogged();
    await send('open matters');
    await waitFor(() => expect(loc().dataset.path).toBe('/matters'));
  });

  it('a reply with no autoOpen field never navigates, whatever else it says', async () => {
    mockApi({ command: BARE('legal_forms', { modelUsed: false, understood: 'Open Legal Forms.' }) });
    renderLogged();
    await send('legal forms');
    expect(await screen.findByRole('button', { name: 'Open' })).toBeTruthy();
    await tick();
    expect(loc().dataset.path).toBe('/assistant');
  });
});

describe('a direct open of Auto-Draft', () => {
  const TYPED = 'draft a legal notice for recovery of dues';
  const ASK = reply({ intent: 'clarify', question: 'Which one did you mean?', choices: ['Open Auto-Draft Studio', 'Open Legal Calendar'], conversationId: 12 });
  const AUTO = (feature) => reply({
    intent: 'navigate', feature, action: 'open', inputs: {}, requires_confirm: false, modelUsed: false, autoOpen: true,
    history: [], conversationId: 12, understood: 'Open it.',
  });

  function renderAt() {
    function Probe2() {
      const l = useLocation();
      return <div data-testid="loc" data-path={l.pathname} data-state={JSON.stringify(l.state ?? null)} />;
    }
    return render(
      <MemoryRouter initialEntries={['/assistant']}>
        <Routes>
          <Route path="/assistant" element={<><Assistant /><Probe2 /></>} />
          <Route path="/draft" element={<Probe2 />} />
          <Route path="/calendar" element={<Probe2 />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('a chip click on "Open Auto-Draft Studio" opens /draft seeded with the typed sentence, not the label', async () => {
    const seen = [];
    mockApi({ command: (body) => { seen.push(body); return seen.length === 1 ? ASK : AUTO('auto_draft'); } });
    renderAt();
    await send(TYPED);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Auto-Draft Studio' }));
    await waitFor(() => expect(loc().dataset.path).toBe('/draft'));
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: TYPED });
    expect(seen[1]).toEqual({ text: 'Open Auto-Draft Studio', conversationId: 12 });      // the chip still sends its label
  });

  it('a newer typed sentence before the chip is the one that is seeded', async () => {
    const seen = [];
    mockApi({ command: (body) => { seen.push(body); return seen.length === 2 ? ASK : seen.length === 1 ? ASK : AUTO('auto_draft'); } });
    renderAt();
    await send(TYPED);
    await screen.findAllByRole('button', { name: 'Open Auto-Draft Studio' });
    fireEvent.change(screen.getByLabelText('Your command'), { target: { value: 'draft an affidavit for name change' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Open Auto-Draft Studio' })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open Auto-Draft Studio' })[1]);
    await waitFor(() => expect(loc().dataset.path).toBe('/draft'));
    expect(JSON.parse(loc().dataset.state)).toEqual({ prompt: 'draft an affidavit for name change' });
  });

  it('a command typed directly ("open auto-draft") opens /draft with NO prompt', async () => {
    mockApi({ command: AUTO('auto_draft') });
    renderAt();
    await send('open auto-draft');
    await waitFor(() => expect(loc().dataset.path).toBe('/draft'));
    expect(JSON.parse(loc().dataset.state)).toBeNull();
  });

  it('a chip click that opens some OTHER page seeds nothing', async () => {
    const seen = [];
    mockApi({ command: (body) => { seen.push(body); return seen.length === 1 ? ASK : AUTO('calendar'); } });
    renderAt();
    await send(TYPED);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Legal Calendar' }));
    await waitFor(() => expect(loc().dataset.path).toBe('/calendar'));
    expect(JSON.parse(loc().dataset.state)).toBeNull();
  });
});
