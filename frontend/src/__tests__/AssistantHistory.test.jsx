import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Assistant from '../pages/Assistant.jsx';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read the stylesheet as text (the CSS import is processed away under vitest). vitest runs from the frontend folder.
const css = readFileSync(resolve(process.cwd(), 'src/styles/assistant.css'), 'utf8');

/*
 * Phase 1d - the "Earlier" list: re-ask, friendly labels, Remove. Mocks only: no network, no model, no microphone.
 * The list endpoint returns {id, title, updatedAt}; a conversation's title is its first command, cut to 120 characters.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = () => new Date().toISOString();

let calls;
let transcribeHangs;

function reply(body, { status = 200 } = {}) {
  return { ok: status < 400, status, headers: { get: () => null }, json: async () => body };
}

function mockApi({ conversations = [], command, onDelete, other } = {}) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};     // the mic upload is FormData
    calls.push({ u, method, body });
    if (u.includes('/api/assistant/conversations')) {
      if (method === 'DELETE') { onDelete?.(u); return reply({ deleted: true }); }
      return reply({ conversations });
    }
    if (u.includes('/api/stt/transcribe')) {
      if (transcribeHangs) return new Promise(() => {});
      return reply({ text: 'spoken words', empty: false, duration: 3 });
    }
    if (u.includes('/api/assistant/command')) {
      if (command) return command(body);
      if (body.flow === 'create_matter') return reply({ flow: 'create_matter', event: body.event, enabled: true, conversationId: 1, history: [] });
      return reply({ intent: 'clarify', question: 'Which one?', choices: [] });
    }
    if (other) { const r = other(u, method, body); if (r) return r; }
    return reply({});
  });
}

// A fake microphone, as in the voice tests.
let recorders;
class FakeRecorder {
  static isTypeSupported() { return true; }
  constructor(stream, opts) { this.mimeType = (opts && opts.mimeType) || 'audio/webm'; this.state = 'inactive'; recorders.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(3000)], { type: this.mimeType }) });
    setTimeout(() => this.onstop?.(), 0);
  }
}
class FakeAudioContext {
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() { return { fftSize: 1024, getByteTimeDomainData: (buf) => { for (let i = 0; i < buf.length; i += 1) buf[i] = 128 + (i % 2 ? 50 : -50); } }; }
  close() { return Promise.resolve(); }
}

beforeEach(() => {
  document.cookie = 'csrf_access_token=abc';
  localStorage.clear(); sessionStorage.clear();
  transcribeHangs = false;
  recorders = [];
  window.MediaRecorder = FakeRecorder; globalThis.MediaRecorder = FakeRecorder;
  window.AudioContext = FakeAudioContext;
  navigator.mediaDevices = { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) };
  mockApi({});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderAssistant() {
  return render(
    <MemoryRouter initialEntries={['/assistant']}>
      <Routes>
        <Route path="/assistant" element={<Assistant />} />
        <Route path="*" element={<div />} />
      </Routes>
    </MemoryRouter>,
  );
}

const box = () => screen.getByLabelText('Your command');
const commandCalls = () => calls.filter((c) => c.u.includes('/api/assistant/command'));
const rowButton = (name) => screen.getByRole('button', { name: new RegExp(`^Ask again: ${name}`) });
const row = (c) => ({ id: c.id, title: c.title, updatedAt: NOW() });
const PLACED = 'Earlier question placed in the box.';

async function listed(conversations, extra = {}) {
  mockApi({ conversations, ...extra });
  renderAssistant();
  await waitFor(() => expect(calls.some((c) => c.u.includes('/api/assistant/conversations'))).toBe(true));
}

// ── re-ask ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('clicking an earlier row puts it in the box', () => {
  it('fills the composer, moves focus there, announces it, and makes no network call', async () => {
    await listed([{ id: 1, title: 'open calendar' }].map(row));
    const before = calls.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again: open calendar' }));
    expect(box().value).toBe('open calendar');
    expect(document.activeElement).toBe(box());
    expect(document.body.textContent).toContain(PLACED);
    expect(calls.length).toBe(before);                      // no fetch at all
    expect(commandCalls()).toHaveLength(0);                 // and nothing was sent
    expect(screen.queryByText('Thinking...')).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('puts exactly "Create a matter" in the box for a create_matter_started row, never the raw label', async () => {
    await listed([row({ id: 1, title: 'create_matter_started' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again: Create a matter' }));
    expect(box().value).toBe('Create a matter');
    expect(box().value).not.toMatch(/create_matter/);
    expect(document.body.textContent).not.toContain('create_matter_started');
  });

  it('does not show the shortened-copy note for an ordinary short question', async () => {
    await listed([row({ id: 1, title: 'open calendar' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again: open calendar' }));
    expect(screen.queryByText(/shortened copy/i)).toBeNull();
  });

  it('shows the shortened-copy note only when the stored title was cut off (120 characters)', async () => {
    const cut = 'a'.repeat(120);
    await listed([row({ id: 1, title: cut }), row({ id: 2, title: 'b'.repeat(119) })]);
    fireEvent.click(await screen.findByRole('button', { name: `Ask again: ${'b'.repeat(119)}` }));
    expect(screen.queryByText(/shortened copy/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Ask again: ${cut}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));           // the box already held the first one
    expect(box().value).toBe(cut);                         // exactly what is stored, not extended or edited
    expect(screen.getByText('This is a shortened copy of your earlier question. Please check it before sending.')).toBeTruthy();
  });

  it('the note goes away once the lawyer sends', async () => {
    await listed([row({ id: 1, title: 'a'.repeat(120) })]);
    fireEvent.click(await screen.findByRole('button', { name: `Ask again: ${'a'.repeat(120)}` }));
    expect(screen.getByText(/shortened copy/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await waitFor(() => expect(commandCalls()).toHaveLength(1));
    expect(screen.queryByText(/shortened copy/i)).toBeNull();
  });

  it('the lawyer still has to press Send: the box text then goes out as an ordinary command', async () => {
    await listed([row({ id: 1, title: 'open calendar' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again: open calendar' }));
    expect(commandCalls()).toHaveLength(0);
    fireEvent.change(box(), { target: { value: 'open calendar please' } });   // the lawyer edits it first
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await waitFor(() => expect(commandCalls()).toHaveLength(1));
    expect(commandCalls()[0].body.text).toBe('open calendar please');
  });
});

describe('text already in the box is never overwritten silently', () => {
  it('Replace puts the earlier question in the box', async () => {
    await listed([row({ id: 1, title: 'open calendar' })]);
    fireEvent.change(box(), { target: { value: 'my own words' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again: open calendar' }));
    expect(box().value).toBe('my own words');               // nothing happened yet
    const group = screen.getByRole('group', { name: 'Use this earlier question?' });
    expect(group).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(box().value).toBe('open calendar');
    expect(screen.queryByRole('group', { name: 'Use this earlier question?' })).toBeNull();
    expect(document.activeElement).toBe(box());
    expect(commandCalls()).toHaveLength(0);
  });

  it('Keep mine leaves the typed text alone and goes back to the box', async () => {
    await listed([row({ id: 1, title: 'open calendar' })]);
    fireEvent.change(box(), { target: { value: 'my own words' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again: open calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    expect(box().value).toBe('my own words');
    expect(screen.queryByRole('group', { name: 'Use this earlier question?' })).toBeNull();
    expect(document.activeElement).toBe(box());
    expect(commandCalls()).toHaveLength(0);
  });

  it('shows the friendly text, not a raw label, in the Replace choice', async () => {
    await listed([row({ id: 1, title: 'create_matter_started' })]);
    fireEvent.change(box(), { target: { value: 'typed' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again: Create a matter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(box().value).toBe('Create a matter');
  });
});

// ── friendly labels ────────────────────────────────────────────────────────────────────────────────────────────────────
describe('friendly labels on the Earlier list', () => {
  it('maps new and old create-matter rows to "Create a matter", hides confirmed/cancelled, leaves the rest as stored', async () => {
    await listed([
      row({ id: 1, title: 'create_matter_started' }),         // new label
      row({ id: 2, title: 'Create a matter' }),               // old row, text already friendly
      row({ id: 3, title: 'create_matter_confirmed' }),
      row({ id: 4, title: 'create_matter_cancelled' }),
      row({ id: 5, title: 'create_matter_something_new' }),   // unknown label: as stored
      row({ id: 6, title: 'my create_matter_confirmed note' }), // a lawyer's own words that merely contain the word
      row({ id: 7, title: 'show cancelled hearings' }),
    ]);
    await screen.findByText('show cancelled hearings');
    const aside = document.querySelector('.lx-assistant-aside');
    const titles = [...aside.querySelectorAll('.lx-assistant-convo__title')].map((n) => n.textContent);
    expect(titles).toEqual([
      'Create a matter', 'Create a matter',
      'create_matter_something_new', 'my create_matter_confirmed note', 'show cancelled hearings',
    ]);
    expect(aside.textContent).not.toContain('create_matter_started');
    expect(titles).not.toContain('create_matter_confirmed');
    expect(titles).not.toContain('create_matter_cancelled');
    // each shown once as the friendly text: no doubled "Create a matter Create a matter" in a single row
    expect(titles.filter((t) => t === 'Create a matter')).toHaveLength(2);
  });

  it('says "No history yet." when every row is a hidden label', async () => {
    await listed([row({ id: 1, title: 'create_matter_confirmed' }), row({ id: 2, title: 'create_matter_cancelled' })]);
    expect(await screen.findByText('No history yet.')).toBeTruthy();
  });

  it('shows history text as plain text, never as HTML', async () => {
    await listed([row({ id: 1, title: '<b>x</b>' })]);
    const btn = await screen.findByRole('button', { name: 'Ask again: <b>x</b>' });
    expect(btn.textContent).toContain('<b>x</b>');
    expect(document.querySelector('.lx-assistant-aside b')).toBeNull();
    fireEvent.click(btn);
    expect(box().value).toBe('<b>x</b>');
  });
});

// ── nothing happens while the page is busy ─────────────────────────────────────────────────────────────────────────────
describe('a click does nothing while the page is busy', () => {
  it('while the create-matter card is open', async () => {
    await listed([row({ id: 1, title: 'open calendar' })]);
    fireEvent.change(box(), { target: { value: 'create a matter' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    await screen.findByText(/case title/i);
    expect(box().disabled).toBe(true);
    const before = calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Ask again: open calendar' }));
    expect(box().value).toBe('');
    expect(document.body.textContent).not.toContain(PLACED);
    expect(screen.queryByRole('group', { name: 'Use this earlier question?' })).toBeNull();
    expect(calls.length).toBe(before);
    expect(screen.getByRole('button', { name: 'Ask again: open calendar' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('while an answer is loading', async () => {
    await listed([row({ id: 1, title: 'open calendar' })], { command: () => new Promise(() => {}) });
    fireEvent.change(box(), { target: { value: 'what is bail' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await screen.findByText('Thinking...');
    fireEvent.click(screen.getByRole('button', { name: 'Ask again: open calendar' }));
    expect(box().value).toBe('');
    expect(document.body.textContent).not.toContain(PLACED);
    expect(commandCalls()).toHaveLength(1);                 // only the one the lawyer sent
  });

  it('while the mic is recording', async () => {
    await listed([row({ id: 1, title: 'open calendar' })]);
    fireEvent.click(screen.getByRole('button', { name: /start dictation/i }));
    await screen.findByRole('button', { name: /stop dictation/i });
    fireEvent.click(screen.getByRole('button', { name: 'Ask again: open calendar' }));
    expect(box().value).toBe('');
    expect(document.body.textContent).not.toContain(PLACED);
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));   // tidy up
  });

  it('while the recording is being transcribed', async () => {
    transcribeHangs = true;
    await listed([row({ id: 1, title: 'open calendar' })]);
    fireEvent.click(screen.getByRole('button', { name: /start dictation/i }));
    await screen.findByRole('button', { name: /stop dictation/i });
    await act(() => sleep(850));
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    await waitFor(() => expect(calls.some((c) => c.u.includes('/api/stt/transcribe'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Ask again: open calendar' }));
    expect(box().value).toBe('');
    expect(document.body.textContent).not.toContain(PLACED);
  });
});

// ── Remove ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('Remove', () => {
  it('still deletes after asking, and does not trigger the re-ask', async () => {
    const deleted = [];
    await listed([row({ id: 3, title: 'open calendar' })], { onDelete: (u) => deleted.push(u) });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete conversation open calendar' }));
    expect(box().value).toBe('');
    expect(document.body.textContent).not.toContain(PLACED);
    expect(deleted).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deleting open calendar' }));
    await waitFor(() => expect(deleted).toHaveLength(1));
    expect(deleted[0]).toContain('/api/assistant/conversations/3');
    expect(box().value).toBe('');
    expect(document.body.textContent).not.toContain(PLACED);
    await waitFor(() => expect(screen.queryByText('open calendar')).toBeNull());
  });

  it('is a separate button, not inside the row button', async () => {
    await listed([row({ id: 3, title: 'open calendar' })]);
    const main = await screen.findByRole('button', { name: 'Ask again: open calendar' });
    const remove = screen.getByRole('button', { name: 'Delete conversation open calendar' });
    expect(main.contains(remove)).toBe(false);
    expect(main.tagName).toBe('BUTTON');
    expect(main.getAttribute('type')).toBe('button');
  });

  it('uses the friendly text in the Remove button name for a label row', async () => {
    await listed([row({ id: 3, title: 'create_matter_started' })]);
    expect(await screen.findByRole('button', { name: 'Delete conversation Create a matter' })).toBeTruthy();
  });
});

// ── keyboard, focus and layout ─────────────────────────────────────────────────────────────────────────────────────────
describe('keyboard and layout', () => {
  it('Enter on a row works', async () => {
    await listed([row({ id: 1, title: 'open calendar' })]);
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: 'Ask again: open calendar' });
    btn.focus();
    await user.keyboard('{Enter}');
    expect(box().value).toBe('open calendar');
    expect(document.activeElement).toBe(box());
    expect(commandCalls()).toHaveLength(0);
  });

  it('Space on a row works', async () => {
    await listed([row({ id: 1, title: 'open calendar' })]);
    const user = userEvent.setup();
    const btn = await screen.findByRole('button', { name: 'Ask again: open calendar' });
    btn.focus();
    await user.keyboard(' ');
    expect(box().value).toBe('open calendar');
    expect(commandCalls()).toHaveLength(0);
  });

  it('the stylesheet gives the row button a visible focus style and 44px tap targets', () => {
    expect(css).toMatch(/\.lx-assistant-convo__main:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
    expect(css).toMatch(/\.lx-assistant-convo__main\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.lx-assistant-convo \.lx-assistant-chip\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.lx-assistant-reask \.lx-btn\s*\{[^}]*min-height:\s*44px/);
  });

  it('the new rules use existing tokens only (no hard-coded colours)', () => {
    const start = css.indexOf('Phase 1d');
    const end = css.indexOf('.lx-assistant-convo__title');
    const added = css.slice(start, end);
    expect(added.length).toBeGreaterThan(100);
    expect(added).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(/);
  });

  it('scrolls the box into view on a small screen', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('max-width'), media: q, addEventListener() {}, removeEventListener() {} }));
    const scroll = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scroll;
    await listed([row({ id: 1, title: 'open calendar' })]);
    scroll.mockClear();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask again: open calendar' }));
    expect(scroll).toHaveBeenCalled();
    delete window.matchMedia;
  });
});

// ═══ Phase 1d polish ═══════════════════════════════════════════════════════════════════════════════════════════════════

// WCAG relative luminance and contrast, to check the real token values the row uses.
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const token = (sheet, name) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(sheet)[1];

describe('the Earlier row look', () => {
  const theme = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');

  it('is not styled as disabled when nothing is blocking it', async () => {
    await listed([row({ id: 1, title: 'open calendar' })]);
    const btn = await screen.findByRole('button', { name: 'Ask again: open calendar' });
    expect(btn.hasAttribute('aria-disabled')).toBe(false);
  });

  it('the time text uses --ink-soft, which is at least 4.5:1 on the row and on the hover background', () => {
    expect(css).toMatch(/\.lx-assistant-convo__main \.lx-assistant-convo__when\s*\{[^}]*color:\s*var\(--ink-soft\)/);
    const inkSoft = token(theme, '--ink-soft');
    expect(ratio(inkSoft, token(theme, '--paper'))).toBeGreaterThanOrEqual(4.5);          // 7.4:1
    expect(ratio(inkSoft, token(theme, '--accent-soft'))).toBeGreaterThanOrEqual(4.5);    // 6.2:1 (hover)
    // the old colour would have failed, which is why it was replaced
    expect(ratio(token(theme, '--muted'), token(theme, '--paper'))).toBeLessThan(4.5);
  });

  it('hover and pointer apply only to a usable row; the disabled grey has no hover', () => {
    expect(css).toMatch(/\.lx-assistant-convo__main:hover:not\(\[aria-disabled="true"\]\)\s*\{[^}]*background:\s*var\(--accent-soft\)/);
    expect(css).toMatch(/\.lx-assistant-convo__main\s*\{[^}]*cursor:\s*pointer/);
    expect(css).toMatch(/\.lx-assistant-convo__main\[aria-disabled="true"\]\s*\{[^}]*opacity:\s*0\.55[^}]*cursor:\s*default/);
    expect(css).not.toMatch(/\.lx-assistant-convo__main\[aria-disabled="true"\]:hover\s*\{[^}]*background:\s*var\(--accent-soft\)/);
  });

  it('turns the row transition off under prefers-reduced-motion', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*?\}\s*\n\}/.exec(css.replace(/\r\n/g, '\n'));
    expect(block).not.toBeNull();
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^@]*\.lx-assistant-convo__main\s*\{\s*transition:\s*none;\s*\}/);
  });

  it('the row wraps instead of overflowing, so Remove stays reachable at 360px', () => {
    expect(css).toMatch(/\.lx-assistant-convo\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.lx-assistant-convo__main\s*\{[^}]*flex:\s*1 1 140px[^}]*min-width:\s*0/);
  });
});

// ── the create-matter card, driven through the real page ───────────────────────────────────────────────────────────────
describe('create-matter card: scroll, cancel text, repeated cancels', () => {
  const SENTENCE = 'create a matter for Sharma vs Rao';
  const CANCEL = 'Closed the new-matter form. Nothing was created.';
  const CLOSED = 'Closed the new-matter form.';
  let scroll;

  const matterOther = (u, method) => {
    if (u.includes('/api/conflict/check')) return reply({ status: 'Clear', results: [] });
    if (u.includes('/api/practice/clients')) return reply({ clients: [] });
    if (u.includes('/api/practice/cases') && method === 'GET') return reply({ cases: [] });
    if (u.includes('/api/practice/cases') && method === 'POST') return reply({ case: { id: 7, title: 'Sharma vs Rao', case_no: 'OS 45' } }, { status: 201 });
    return null;
  };
  const stream = () => within(screen.getByLabelText('Conversation'));
  const bubbles = () => stream().queryAllByText('Create a matter');
  const startFlow = async () => {
    fireEvent.change(box(), { target: { value: SENTENCE } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    return screen.findByLabelText('Case title');
  };
  const cancelFlow = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Case title')).toBeNull());
  };
  const toSuccess = async () => {
    // Walk the slots by what is on screen (title and parties are pre-filled), until the confirm card appears.
    for (let i = 0; i < 10 && !screen.queryByText('Check the details'); i += 1) {
      const court = screen.queryByLabelText('Court');
      if (court) fireEvent.change(court, { target: { value: 'Madras High Court' } });
      const caseNo = screen.queryByLabelText('Case number');
      if (caseNo) fireEvent.change(caseNo, { target: { value: 'OS 45' } });
      const civil = screen.queryByText('Civil');
      if (civil) fireEvent.click(civil);                                      // a type chip moves on by itself
      const nextBtn = screen.queryByText('Next');
      if (nextBtn) fireEvent.click(nextBtn);
    }
    await screen.findByText('No conflict found.');
    fireEvent.click(screen.getByText('Create matter'));
    await screen.findByText('Matter created');
  };

  beforeEach(() => {
    scroll = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scroll;
    mockApi({ other: matterOther });
  });
  afterEach(() => { delete window.matchMedia; });

  const nearestCalls = () => scroll.mock.calls.filter((c) => c[0] && c[0].block === 'nearest');

  // 2. scroll
  it('scrolls the card wrapper into view (nearest, smooth) and leaves focus on the card input', async () => {
    renderAssistant();
    const input = await startFlow();
    await waitFor(() => expect(nearestCalls()).toHaveLength(1));
    expect(nearestCalls()[0][0]).toEqual({ block: 'nearest', behavior: 'smooth' });
    const wrapper = scroll.mock.contexts[scroll.mock.calls.indexOf(nearestCalls()[0])];
    expect(wrapper.contains(input)).toBe(true);                               // it is the card's own wrapper
    expect(document.activeElement).toBe(input);                               // focus neither stolen nor lost
    fireEvent.change(input, { target: { value: 'Sharma v Rao' } });          // later renders do not scroll again
    expect(nearestCalls()).toHaveLength(1);
  });

  it('scrolls instantly under prefers-reduced-motion', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    renderAssistant();
    await startFlow();
    await waitFor(() => expect(nearestCalls()).toHaveLength(1));
    expect(nearestCalls()[0][0]).toEqual({ block: 'nearest', behavior: 'auto' });
  });

  // 3. cancel text
  it('Cancel leaves one message: "Closed the new-matter form. Nothing was created."', async () => {
    renderAssistant();
    await startFlow();
    await cancelFlow();
    expect(stream().getAllByText(CANCEL)).toHaveLength(1);
    expect(stream().queryByText(CLOSED)).toBeNull();                          // the old wording is gone
  });

  it('Done after a matter WAS created keeps the plain wording, never "Nothing was created"', async () => {
    renderAssistant();
    await startFlow();
    await toSuccess();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await stream().findByText(CLOSED)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Nothing was created');
  });

  it('a session expiry closes the card with the plain wording too', async () => {
    renderAssistant();
    await startFlow();
    act(() => { window.dispatchEvent(new Event('lexamplify:session-expired')); });
    expect(await stream().findByText(CLOSED)).toBeTruthy();
    expect(document.body.textContent).not.toContain('Nothing was created');
  });

  // 4. repeated cancels
  it('removes the previous [started bubble, cancel reply] pair when the flow starts again', async () => {
    renderAssistant();
    await startFlow();
    await cancelFlow();
    expect(bubbles()).toHaveLength(1);
    await startFlow();
    expect(bubbles()).toHaveLength(1);                                        // not two
    expect(stream().queryByText(CANCEL)).toBeNull();                          // the old cancel reply is gone
    await cancelFlow();
    await startFlow();
    await cancelFlow();
    expect(bubbles()).toHaveLength(1);                                        // still one pair after several rounds
    expect(stream().getAllByText(CANCEL)).toHaveLength(1);
  });

  it('does not remove the pair when something sits after it', async () => {
    renderAssistant();
    await startFlow();
    await cancelFlow();
    fireEvent.change(box(), { target: { value: 'what is bail' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await screen.findByText('Which one?');
    await startFlow();
    expect(bubbles()).toHaveLength(2);                                        // the first pair stays
    expect(stream().getAllByText(CANCEL)).toHaveLength(1);
    expect(stream().getByText('what is bail')).toBeTruthy();
  });

  it('does not remove a normal user/assistant pair that only uses similar words', async () => {
    renderAssistant();
    fireEvent.change(box(), { target: { value: CANCEL } });                   // a lawyer typing the very same words
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await screen.findByText('Which one?');
    await startFlow();
    expect(stream().getAllByText(CANCEL)).toHaveLength(1);                    // the lawyer's own bubble is still there
    expect(stream().getByText('Which one?')).toBeTruthy();
    expect(bubbles()).toHaveLength(1);
  });

  it('does not remove a pair that ended in "Done" after a created matter (it was not a cancel)', async () => {
    renderAssistant();
    await startFlow();
    await toSuccess();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await stream().findByText(CLOSED);
    await startFlow();
    expect(bubbles()).toHaveLength(2);
    expect(stream().getByText(CLOSED)).toBeTruthy();
  });

  it('removing a pair makes no extra network call and never touches the server history', async () => {
    renderAssistant();
    await startFlow();
    await cancelFlow();
    const before = calls.length;
    await startFlow();
    const added = calls.slice(before).filter((c) => c.method !== 'GET');                // (the list refresh is a GET, as always)
    expect(added).toHaveLength(1);
    expect(added[0].body).toMatchObject({ flow: 'create_matter' });                       // only the usual start label
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(calls.some((c) => c.u.includes('/api/assistant/conversations') && c.method !== 'GET')).toBe(false);
  });
});
