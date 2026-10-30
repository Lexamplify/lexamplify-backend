import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { blocksToHtml, blocksToText, request, DraftApiError } from '../services/draftApi';
import StartPage from '../components/StartPage';
import ErrorBoundary from '../components/ErrorBoundary';
import ConflictCheck from '../components/ConflictCheck';
import { AuthContext } from '../context/AuthContext';

const reply = (status, body, headers = {}) => Promise.resolve({
  ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k] || null },
  json: async () => { if (body === undefined) throw new Error('no json'); return body; }, blob: async () => new Blob(['x']),
});

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('draftApi: every failure becomes a plain sentence', () => {
  const cases = [
    [401, undefined, /session has expired/i],
    [413, undefined, /too large/i],
    [429, undefined, /too many requests/i],
    [500, { error: true, code: 'X', message: 'Traceback (most recent call last): File "app.py"' }, /something went wrong on our side/i],
    [503, undefined, /something went wrong on our side/i],
    [400, { error: true, message: 'Choose a document type first.' }, /choose a document type first/i],
  ];
  it.each(cases)('status %s', async (status, body, expected) => {
    vi.stubGlobal('fetch', vi.fn(() => reply(status, body)));
    await expect(request('/api/drafts/render', { method: 'POST', body: {} })).rejects.toThrow(expected);
    try { await request('/api/x'); } catch (e) {
      expect(e).toBeInstanceOf(DraftApiError);
      expect(e.message).not.toMatch(/undefined|\{|Traceback|status \d{3}/);
    }
  });

  it('says the server is unreachable instead of showing a raw error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(request('/api/x')).rejects.toThrow(/could not reach the server/i);
  });

  it('marks an expired session so the screen can keep the typing', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(401, {})));
    await request('/api/x').catch((e) => { expect(e.sessionExpired).toBe(true); });
  });
});

describe('draftApi: documents go to the editor escaped', () => {
  const evil = '<img src=x onerror="window.__xss=1"><script>alert(1)</script>';
  it('escapes every kind of block and still highlights blanks', () => {
    const html = blocksToHtml([
      { type: 'title', text: evil }, { type: 'para', text: `Name ${evil} [Bracketed Field: Amount]` },
      { type: 'numbered', number: 1, text: evil }, { type: 'address', lines: [evil, 'Chennai'] },
      { type: 'signature', lines: [evil] }, { type: 'table', rows: [[evil, 'b']] },
    ]);
    expect(html).not.toMatch(/<img|<script|onerror=\"/);
    expect(html).toContain('&lt;img');
    expect(html).toContain('<mark>[Bracketed Field: Amount]</mark>');
  });
  it('keeps numbering and letters in the plain text', () => {
    expect(blocksToText([{ type: 'numbered', number: 2, text: 'That x.' }, { type: 'lettered', letter: '(b)', text: 'Costs' }])).toBe('2. That x.\n(b) Costs');
  });
});

describe('StartPage', () => {
  it('shows the three tasks with the time each takes, and a way to all tools', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('flags') ? reply(200, { value: '1' }) : reply(200, { sessions: [] }))));
    render(
      <MemoryRouter>
        <AuthContext.Provider value={{ user: { name: 'priya raman' } }}><StartPage /></AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: /What would you like to get done/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Draft a document/i })).toHaveAttribute('href', '/draft');
    expect(screen.getByRole('link', { name: /Analyze a contract/i })).toHaveAttribute('href', '/contract-analyzer');
    expect(screen.getByRole('link', { name: /Check conflicts/i })).toHaveAttribute('href', '/check-conflicts');
    expect(screen.getByText(/About 5 minutes/i)).toBeInTheDocument();
    expect(screen.getByText('All tools')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('How it works')).not.toBeInTheDocument());   // guide hidden once dismissed on the server
  });

  it('shows the first-run guide when the server says it was never dismissed', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('flags') ? reply(200, { value: null }) : reply(200, { sessions: [] }))));
    render(<MemoryRouter><AuthContext.Provider value={{ user: null }}><StartPage /></AuthContext.Provider></MemoryRouter>);
    expect(await screen.findByText('How it works')).toBeInTheDocument();
  });
});

describe('ConflictCheck', () => {
  it('never says clear when there is nothing to check against', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(200, {
      status: 'no_records', headline: 'There are no clients or cases in Practice yet, so there is nothing to check against. This is not a clearance. Add your clients and cases first.',
      findings: [], searched: { clients: 0, cases: 0, parties: 0 }, checked: { client: 'X', opposing: [] }, limits: ['Only names recorded in Practice are searched.'],
    })));
    render(<MemoryRouter><ConflictCheck /></MemoryRouter>);
    const input = screen.getByLabelText('Who wants to hire you?');
    input.focus();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.type(input, 'Rajesh Sharma');
    await userEvent.click(screen.getByRole('button', { name: 'Check names' }));
    expect(await screen.findByText('Nothing to check against')).toBeInTheDocument();
    expect(screen.queryByText(/No match found/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your clients' })).toBeInTheDocument();
  });

  it('shows a plain message when there is no practice set up yet', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(403, { error: true, code: 'NO_FIRM', message: 'Set up your practice first.' })));
    render(<MemoryRouter><ConflictCheck /></MemoryRouter>);
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.type(screen.getByLabelText('Who wants to hire you?'), 'Anyone');
    await userEvent.click(screen.getByRole('button', { name: 'Check names' }));
    expect(await screen.findByText(/set up your practice/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NO_FIRM|undefined/);
  });
});

describe('ErrorBoundary', () => {
  it('shows a calm message with a way forward instead of a white screen, and recovers on route change', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => { throw new Error('boom'); };
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong on this page/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Start' })).toHaveAttribute('href', '/start');
    rerender(<ErrorBoundary resetKey="/b"><div>All fine now</div></ErrorBoundary>);
    expect(screen.getByText('All fine now')).toBeInTheDocument();
  });
});
