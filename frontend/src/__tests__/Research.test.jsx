import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Research from '../pages/Research.jsx';

const SOURCES = [
  { case_id: 'a.pdf', title: 'Supreme Court Judgment (2022) - a', year: '2022', snippet: 'Limitation runs from notice.', ref: 'S1' },
  { case_id: 'b.pdf', title: 'Supreme Court Judgment (2019) - b', year: '2019', snippet: 'Second authority.', ref: 'S2' },
];

function reply(status, body) {
  return vi.fn(async () => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body }));
}

async function ask(fetchMock) {
  globalThis.fetch = fetchMock;
  render(<Research />);
  fireEvent.change(screen.getByPlaceholderText(/Ask a question of law/i), { target: { value: 'Limitation under Section 149' } });
  fireEvent.click(screen.getByRole('button', { name: /^Research$/ }));
}

beforeEach(() => { document.cookie = 'csrf_access_token=abc'; });
afterEach(() => { vi.restoreAllMocks(); });

describe('Research page: specific failures and honest partial results', () => {
  it('shows the specific message, the reference, and a Retry that asks again', async () => {
    const f = reply(503, { error: true, code: 'SEARCH_NOT_CONFIGURED', message: 'The search index is not set up on this server. Please contact your administrator.', retryable: true, request_id: 'req123' });
    await ask(f);
    expect(await screen.findByText(/search index is not set up/i)).toBeTruthy();
    expect(screen.getByText(/Reference: req123/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });

  it('has no Retry when a retry cannot help', async () => {
    await ask(reply(503, { error: true, code: 'ANSWER_MODEL_UNAVAILABLE', message: 'The answer model is not available right now. Please contact your administrator.', retryable: false }));
    expect(await screen.findByText(/answer model is not available/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('marks an answer without sources as unverified', async () => {
    await ask(reply(200, { status: 'unverified', code: 'SEARCH_TIMEOUT', grounded: false, answer: 'Unverified: no sources could be checked.\n\nGeneral answer.', sources: [], note: 'The search took too long. No sources could be checked, so this answer is not verified law.' }));
    expect(await screen.findByText(/Unverified — no sources checked/)).toBeTruthy();
    expect(screen.getByText(/not verified law/i)).toBeTruthy();
    expect(screen.queryByText('Synthesis')).toBeNull();
  });

  it('shows the sources with a plain note when only the answer model failed', async () => {
    await ask(reply(200, { status: 'partial', code: 'ANSWER_BUSY', grounded: false, answer: 'The answer service is busy right now. The sources that were found are listed below.', sources: SOURCES, note: 'x' }));
    expect(await screen.findByText(/Sources only — no summary/)).toBeTruthy();
    expect(screen.getByText('Supreme Court Judgment (2022) - a')).toBeTruthy();
    expect(screen.getByText('Supreme Court Judgment (2019) - b')).toBeTruthy();
  });

  it('says plainly when no sources were found', async () => {
    await ask(reply(200, { status: 'no_sources', code: 'NO_SOURCES', grounded: false, answer: "I couldn't find any relevant precedents in the Firm Library regarding this query.", sources: [], note: 'Nothing could be checked.' }));
    expect(await screen.findByText(/No sources found/)).toBeTruthy();
  });

  it('a normal answer still renders as before', async () => {
    await ask(reply(200, { status: 'success', grounded: true, answer: 'Limitation is three years [S1].', sources: SOURCES, note: 'Verify each authority against the original judgment before you file or advise.' }));
    expect(await screen.findByText('Synthesis')).toBeTruthy();
    expect(screen.getByText(/Grounded in 2 authorities/)).toBeTruthy();
    expect(screen.getByText(/Verify each authority/)).toBeTruthy();
  });
});

describe('Research page: formatting, claims, dates and notes', () => {
  const OK = { status: 'success', grounded: true, note: 'Verify each authority against the original judgment before you file or advise.' };

  it('shows bold, lists and source tags as formatting, not raw characters, and never runs HTML', async () => {
    document.body.removeAttribute('data-pwned');
    await ask(reply(200, { ...OK, answer: 'The **limitation period** is three years [S1].\n\n- first point\n- second point\n\n<img src=x onerror="document.body.setAttribute(\'data-pwned\',\'1\')">', sources: SOURCES, unverifiedClaims: [] }));
    expect(await screen.findByText('limitation period')).toBeTruthy();
    expect(screen.getByText('limitation period').tagName).toBe('STRONG');
    expect(document.body.textContent).not.toContain('**');
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Go to source S1' })).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.getAttribute('data-pwned')).toBeNull();
  });

  it('shows a visible "Check these items" note with each flagged claim', async () => {
    await ask(reply(200, { ...OK, answer: 'The fine is Rs 50 million (Rs 50 lakhs).', sources: SOURCES, unverifiedClaims: [
      { text: 'Rs 50 million (Rs 50 lakhs)', kind: 'amount', reason: 'The two amounts do not match.' },
      { text: 'Mehta v. State', kind: 'case', reason: 'This case name was not found in the retrieved sources.' },
    ] }));
    const note = await screen.findByRole('note', { name: 'Check these items' });
    expect(note.textContent).toContain('Rs 50 million (Rs 50 lakhs)');
    expect(note.textContent).toContain('The two amounts do not match.');
    expect(note.textContent).toContain('Mehta v. State');
  });

  it('shows no "Check these items" note when nothing was flagged', async () => {
    await ask(reply(200, { ...OK, answer: 'Plain answer.', sources: SOURCES, unverifiedClaims: [] }));
    await screen.findByText('Plain answer.');
    expect(screen.queryByRole('note', { name: 'Check these items' })).toBeNull();
  });

  it('shows a source date only when one exists, otherwise "date not on record"', async () => {
    await ask(reply(200, { ...OK, answer: 'Answer.', unverifiedClaims: [], sources: [
      { ...SOURCES[0], date: '2022-03-04' }, { ...SOURCES[1], date: null },
    ] }));
    expect(await screen.findByText(/Date: 2022-03-04/)).toBeTruthy();
    expect(screen.getAllByText(/date not on record/).length).toBe(1);
  });

  it('always shows the standing amendment note under an answer', async () => {
    await ask(reply(200, { ...OK, answer: 'Answer.', sources: SOURCES, unverifiedClaims: [] }));
    expect(await screen.findByText('Sources may pre-date recent amendments. Check that the law has not been replaced.')).toBeTruthy();
  });

  it('shows a plain message and Retry when rate limited', async () => {
    await ask(reply(429, { error: true, code: 'RATE_LIMITED', message: 'You are doing that too quickly. Please wait a minute and try again.' }));
    expect(await screen.findByText(/asking too quickly/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
