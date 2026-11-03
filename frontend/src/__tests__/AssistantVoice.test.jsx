import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

import Assistant from '../pages/Assistant.jsx';
import AssistantAnswer from '../components/AssistantAnswer.jsx';
import MicButton from '../components/MicButton.jsx';

/*
 * Task 4 Phase A — voice in the assistant composer.
 * The microphone, MediaRecorder, AudioContext and the network are all faked; nothing here touches a real mic
 * or the network. Fake timers are used only for the recording-length cap.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STT_TEXT = 'the petitioner prays for bail';

let tracksStopped;
let recorders;
let loud;

class FakeRecorder {
  static isTypeSupported() { return true; }
  constructor(stream, opts) { this.stream = stream; this.mimeType = (opts && opts.mimeType) || 'audio/webm'; this.state = 'inactive'; recorders.push(this); }
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
  createAnalyser() { return { fftSize: 1024, getByteTimeDomainData: (buf) => { for (let i = 0; i < buf.length; i += 1) buf[i] = 128 + (loud ? (i % 2 ? 50 : -50) : 0); } }; }
  close() { return Promise.resolve(); }
}

function mockMic({ deny } = {}) {
  navigator.mediaDevices = {
    getUserMedia: vi.fn(async () => {
      if (deny) { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; }
      return { getTracks: () => [{ stop: () => { tracksStopped += 1; } }] };
    }),
  };
}

// A fetch fake routing the three endpoints the assistant + mic touch. `command` can be overridden per test.
let commandImpl;
function installFetch() {
  const fetchMock = vi.fn(async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/api/assistant/conversations')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ conversations: [] }) };
    if (u.includes('/api/stt/transcribe')) return { ok: true, status: 200, json: async () => ({ text: STT_TEXT, empty: false, duration: 3 }) };
    if (u.includes('/api/assistant/command')) return commandImpl(JSON.parse(init.body || '{}'), init);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function reply(body, { status = 200, headers = {} } = {}) {
  return { ok: status < 400, status, headers: { get: (k) => headers[k] ?? headers[k?.toLowerCase?.()] ?? null }, json: async () => body };
}

let fetchMock;
beforeEach(() => {
  tracksStopped = 0; recorders = []; loud = true;
  window.MediaRecorder = FakeRecorder; globalThis.MediaRecorder = FakeRecorder;
  window.AudioContext = FakeAudioContext;
  mockMic();
  localStorage.clear();
  commandImpl = () => reply({ intent: 'clarify', question: 'Which one?', choices: [] });
  fetchMock = installFetch();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc" data-path={loc.pathname} />;
}

function renderAssistant() {
  return render(
    <MemoryRouter initialEntries={['/assistant']}>
      <Routes>
        <Route path="/assistant" element={<><Assistant /><Probe /></>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const micStart = () => screen.getByRole('button', { name: /start dictation/i });
const micStop = () => screen.queryByRole('button', { name: /stop dictation/i });
const sendBtn = () => screen.getByRole('button', { name: /^Send$/i }) || screen.getByRole('button', { name: /Send/i });

// Record then finish, so the transcript is delivered into the composer box.
async function recordAndFinish() {
  fireEvent.click(micStart());
  await waitFor(() => expect(micStop()).not.toBeNull());
  await act(() => sleep(850));                                  // longer than MIN_SECONDS so the clip is kept
  fireEvent.click(micStop());
}

const commandCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/assistant/command'));
const transcribeCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/stt/transcribe'));

// ── the transcript only fills the box ─────────────────────────────────────────
describe('the transcript fills the box and is never sent', () => {
  it('appends to what is typed, keeps it, never auto-sends, and the language picker is present', async () => {
    renderAssistant();
    expect(screen.getByLabelText(/voice typing language/i)).toBeTruthy();

    const box = screen.getByLabelText('Your command');
    fireEvent.change(box, { target: { value: 'my question ' } });

    await recordAndFinish();
    await waitFor(() => expect(box.value).toContain(STT_TEXT));
    expect(box.value).toContain('my question');                 // typed text is kept
    expect(transcribeCalls()).toHaveLength(1);
    expect(commandCalls()).toHaveLength(0);                      // nothing was sent to the brain
  });

  it('announces "Transcript added to the box."', async () => {
    renderAssistant();
    await recordAndFinish();
    expect(await screen.findByText('Transcript added to the box.')).toBeTruthy();
  });
});

// ── typing/sending is blocked while the mic is live ────────────────────────────
describe('typing and sending are blocked while the mic is live', () => {
  it('disables Send, blocks Enter and the form submit while recording, then allows them after', async () => {
    renderAssistant();
    const box = screen.getByLabelText('Your command');

    fireEvent.click(micStart());
    await waitFor(() => expect(micStop()).not.toBeNull());

    expect(screen.getByRole('button', { name: /Send/i }).disabled).toBe(true);
    fireEvent.keyDown(box, { key: 'Enter' });                   // Enter must not send while recording
    fireEvent.submit(box.closest('form'));                      // nor the raw form submit
    expect(commandCalls()).toHaveLength(0);

    await act(() => sleep(850));
    fireEvent.click(micStop());
    await waitFor(() => expect(box.value).toContain('petitioner prays for bail'));   // capitalised from an empty box
    await waitFor(() => expect(screen.getByRole('button', { name: /Send/i }).disabled).toBe(false));

    fireEvent.keyDown(box, { key: 'Enter' });                   // allowed again
    await waitFor(() => expect(commandCalls()).toHaveLength(1));
  });

  it('keeps the mic disabled while an answer is loading', async () => {
    let hold;
    commandImpl = () => new Promise((resolve) => { hold = resolve; });
    renderAssistant();
    const box = screen.getByLabelText('Your command');
    fireEvent.change(box, { target: { value: 'what is bail' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    await waitFor(() => expect(micStart().disabled).toBe(true));
    hold?.(reply({ intent: 'clarify', question: 'x', choices: [] }));
  });
});

// ── the Ctrl+/ shortcut ────────────────────────────────────────────────────────
describe('the Ctrl+/ shortcut', () => {
  it('has the title and aria-keyshortcuts', () => {
    renderAssistant();
    const mic = micStart();
    expect(mic.getAttribute('title')).toBe('Speak (Ctrl+/)');
    expect(mic.getAttribute('aria-keyshortcuts')).toMatch('/');
  });

  it('starts only when the composer is focused; Cmd+/ works too', async () => {
    renderAssistant();
    const box = screen.getByLabelText('Your command');

    fireEvent.keyDown(window, { key: '/', ctrlKey: true });     // composer not focused
    await act(() => sleep(10));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

    box.focus();
    const prevented = fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(prevented).toBe(false);                              // preventDefault was called
    await waitFor(() => expect(micStop()).not.toBeNull());
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: '/', ctrlKey: true });     // toggles off
    await waitFor(() => expect(micStop()).toBeNull());

    cleanup();
    renderAssistant();
    screen.getByLabelText('Your command').focus();
    fireEvent.keyDown(window, { key: '/', metaKey: true });     // Cmd+/ on Mac
    await waitFor(() => expect(micStop()).not.toBeNull());
  });

  it('is ignored during IME composition and on key repeat', async () => {
    renderAssistant();
    screen.getByLabelText('Your command').focus();
    fireEvent.keyDown(window, { key: '/', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(window, { key: '/', ctrlKey: true, repeat: true });
    await act(() => sleep(10));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});

// ── Esc ────────────────────────────────────────────────────────────────────────
describe('Esc', () => {
  it('cancels the recording, uploads nothing and does not navigate', async () => {
    renderAssistant();
    fireEvent.click(micStart());
    await waitFor(() => expect(micStop()).not.toBeNull());
    await act(() => sleep(850));

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(micStop()).toBeNull());          // back to idle
    await act(() => sleep(30));
    expect(transcribeCalls()).toHaveLength(0);
    expect(tracksStopped).toBeGreaterThan(0);                   // mic released
    expect(screen.getByTestId('loc').dataset.path).toBe('/assistant');
  });

  it('does nothing when idle (still on the assistant page)', async () => {
    renderAssistant();
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(() => sleep(10));
    expect(screen.getByTestId('loc').dataset.path).toBe('/assistant');
    expect(micStart()).toBeTruthy();
  });
});

// ── the recording-length cap ───────────────────────────────────────────────────
describe('the recording-length cap', () => {
  function CapHarness({ max }) {
    const [v, setV] = useState('');
    return (
      <form>
        <textarea aria-label="facts" value={v} onChange={(e) => setV(e.target.value)} />
        <MicButton scope="form" maxSeconds={max} />
      </form>
    );
  }

  it('auto-stops AND transcribes at maxSeconds=60, shows a role=status note, and clears it on the next start', async () => {
    vi.useFakeTimers();
    render(<CapHarness max={60} />);
    fireEvent.click(screen.getByRole('button', { name: /start dictation/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });

    const note = screen.getByText('Reached the 60 second limit.');
    expect(note).toBeTruthy();
    expect(note.getAttribute('role')).toBe('status');
    expect(transcribeCalls()).toHaveLength(1);                  // the clip was sent, not thrown away

    fireEvent.click(screen.getByRole('button', { name: /start dictation/i }));   // next recording
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(screen.queryByText('Reached the 60 second limit.')).toBeNull();
  });

  it('leaves the default (240) unchanged: a mic with no maxSeconds is still recording after 61s', async () => {
    vi.useFakeTimers();
    render(<CapHarness max={undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /start dictation/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    await act(async () => { await vi.advanceTimersByTimeAsync(61000); });

    expect(screen.getByRole('button', { name: /stop dictation/i })).toBeTruthy();
    expect(screen.queryByText(/Reached the .* second limit\./)).toBeNull();
  });
});

// ── the confidentiality notice ─────────────────────────────────────────────────
describe('the confidentiality notice', () => {
  it('keeps the original sentence and adds the voice sentence', () => {
    renderAssistant();
    expect(screen.getByText('Your question is sent to an AI service. Please do not type client names, phone numbers or other personal details.')).toBeTruthy();
    expect(screen.getByText('If you use the microphone, your voice is also sent to a speech service to be typed out. LexAmplify does not save the recording.')).toBeTruthy();
  });
});

// ── the Hindi/Tamil "no verified answer" note ──────────────────────────────────
describe('the Hindi/Tamil note', () => {
  const NOTE = 'The assistant cannot verify an answer in this language yet. You can edit the question or ask it in English.';

  it.each([
    ['none + Devanagari question', 'none', true, true],
    ['none + Tamil question', 'none', true, true],
    ['none + English question', 'none', false, false],
    ['general + Devanagari question', 'general', true, false],
  ])('%s shows the note = %s', (_label, answerKind, questionHasIndic, expected) => {
    render(
      <AssistantAnswer
        reply={{ answer: 'some answer text', answerKind, badge: '', sources: [] }}
        onOpenSuggestion={() => {}}
        questionHasIndic={questionHasIndic}
      />,
    );
    if (expected) expect(screen.getByText(NOTE)).toBeTruthy();
    else expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('keys off the SENT question, not the language picker', async () => {
    commandImpl = () => reply({ intent: 'answer', understood: 'q', answer: 'No verified answer.', answerKind: 'none', badge: '', sources: [], choices: [] });
    renderAssistant();
    // Pick Hindi in the picker but ask in English: the note must NOT appear.
    fireEvent.change(screen.getByLabelText(/voice typing language/i), { target: { value: 'hi' } });
    const box = screen.getByLabelText('Your command');
    fireEvent.change(box, { target: { value: 'what is bail' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await screen.findByText('No verified answer.');
    expect(screen.queryByText(NOTE)).toBeNull();

    // Now a Devanagari question with the same kind: the note appears.
    fireEvent.change(box, { target: { value: 'जमानत क्या है' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));
    await waitFor(() => expect(screen.getAllByText('No verified answer.').length).toBeGreaterThan(0));
    expect(screen.getByText(NOTE)).toBeTruthy();
  });
});

// ── leaving the page while recording ───────────────────────────────────────────
describe('leaving the page while recording', () => {
  it('releases the microphone stream on unmount', async () => {
    const { unmount } = renderAssistant();
    fireEvent.click(micStart());
    await waitFor(() => expect(micStop()).not.toBeNull());
    unmount();
    expect(tracksStopped).toBeGreaterThan(0);
    await act(() => sleep(30));
    expect(transcribeCalls()).toHaveLength(0);
  });
});
