import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MicButton from '../components/MicButton.jsx';
import Dictatable from '../components/Dictatable.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

let fetchMock;
beforeEach(() => {
  tracksStopped = 0; recorders = []; loud = true;
  window.MediaRecorder = FakeRecorder; globalThis.MediaRecorder = FakeRecorder;
  window.AudioContext = FakeAudioContext;
  mockMic();
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: 'the petitioner prays for bail', empty: false, duration: 3 }) }));
  globalThis.fetch = fetchMock;
});
afterEach(() => { vi.restoreAllMocks(); });

function Form({ initial = '' }) {
  const [v, setV] = useState(initial);
  return (
    <div>
      <Dictatable><textarea aria-label="facts" className="inp" value={v} onChange={(e) => setV(e.target.value)} /></Dictatable>
      <output data-testid="state">{v}</output>
    </div>
  );
}

const start = async () => { fireEvent.click(screen.getByRole('button', { name: /start dictation/i })); await waitFor(() => screen.getByRole('button', { name: /stop dictation/i })); };

describe('MicButton + Dictatable', () => {
  it('records, uploads and types the words into the field (and the React state)', async () => {
    render(<Form />);
    await start();
    await act(() => sleep(850));
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('The petitioner prays for bail'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/stt/transcribe');
    expect(init.method).toBe('POST');
    expect(init.body.get('lang')).toBe('auto');
    expect(init.body.get('kind')).toBe('legal');
    expect(init.body.get('audio').name).toBe('dictation.webm');
    expect(tracksStopped).toBeGreaterThan(0);               // the microphone is released
  });

  it('inserts at the caret and keeps what was already typed', async () => {
    render(<Form initial="Facts: . End." />);
    const ta = screen.getByLabelText('facts');
    ta.focus(); ta.setSelectionRange(7, 7);
    await start();
    await act(() => sleep(850));
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    await waitFor(() => expect(screen.getByTestId('state').textContent).toContain('the petitioner prays for bail'));
    expect(screen.getByTestId('state').textContent.startsWith('Facts: ')).toBe(true);
    expect(screen.getByTestId('state').textContent.endsWith('End.')).toBe(true);
  });

  it('shows a plain message when the microphone is blocked and never uploads', async () => {
    mockMic({ deny: true });
    render(<Form />);
    fireEvent.click(screen.getByRole('button', { name: /start dictation/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/blocked/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /start dictation/i })).toBeTruthy();   // back to idle
  });

  it('a click that is too short is not uploaded', async () => {
    render(<Form />);
    await start();
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/too short/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silence is not uploaded', async () => {
    loud = false;
    render(<Form />);
    await start();
    await act(() => sleep(850));
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not hear/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Esc throws the recording away', async () => {
    render(<Form />);
    await start();
    await act(() => sleep(850));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => screen.getByRole('button', { name: /start dictation/i }));
    await act(() => sleep(30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('state').textContent).toBe('');
    expect(tracksStopped).toBeGreaterThan(0);
  });

  it('leaving the page while recording switches the microphone off', async () => {
    const { unmount } = render(<Form />);
    await start();
    unmount();
    expect(tracksStopped).toBeGreaterThan(0);
    await act(() => sleep(30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server message when the speech service is busy', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ code: 'STT_BUSY', message: 'raw provider text' }) });
    render(<Form />);
    await start(); await act(() => sleep(850));
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/busy/i);
    expect(alert.textContent).not.toMatch(/raw provider/);
    expect(screen.getByTestId('state').textContent).toBe('');
  });

  it('an empty transcript says so and changes nothing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ text: '', empty: true }) });
    render(<Form initial="keep me" />);
    await start(); await act(() => sleep(850));
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not make out/i);
    expect(screen.getByTestId('state').textContent).toBe('keep me');
  });

  it('a network failure is explained', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('failed'));
    render(<Form />);
    await start(); await act(() => sleep(850));
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/reach the server/i);
  });

  it('sends the language the user picked', async () => {
    render(<Form />);
    fireEvent.change(screen.getByLabelText(/voice typing language/i), { target: { value: 'ta' } });
    await start(); await act(() => sleep(850));
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].body.get('lang')).toBe('ta');
  });

  it('starting a second microphone finishes the first one (its words are kept)', async () => {
    function Two() {
      const [a, setA] = useState(''); const [b, setB] = useState('');
      return (<div>
        <Dictatable><textarea aria-label="a" value={a} onChange={(e) => setA(e.target.value)} /></Dictatable>
        <Dictatable><textarea aria-label="b" value={b} onChange={(e) => setB(e.target.value)} /></Dictatable>
        <output data-testid="a">{a}</output>
      </div>);
    }
    render(<Two />);
    const [first, second] = screen.getAllByRole('button', { name: /start dictation/i });
    fireEvent.click(first);
    await waitFor(() => screen.getByRole('button', { name: /stop dictation/i }));
    await act(() => sleep(850));
    fireEvent.click(second);
    await waitFor(() => expect(screen.getByTestId('a').textContent).toContain('petitioner'));
  });

  it('onText mode hands the text to the caller (used by the document editor)', async () => {
    const got = [];
    render(<MicButton onText={(t) => got.push(t)} variant="pill" label="Dictate into document" />);
    fireEvent.click(screen.getByRole('button', { name: /start dictation/i }));
    await waitFor(() => screen.getByRole('button', { name: /stop dictation/i }));
    await act(() => sleep(850));
    fireEvent.click(screen.getByRole('button', { name: /stop dictation/i }));
    await waitFor(() => expect(got).toEqual(['the petitioner prays for bail']));
  });

  it('is disabled with an explanation when the browser cannot record', () => {
    delete window.MediaRecorder; delete globalThis.MediaRecorder;
    render(<Form />);
    const b = screen.getByRole('button', { name: /not available/i });
    expect(b.disabled).toBe(true);
  });

  it('does not start on a disabled field', async () => {
    function Locked() { return <Dictatable><textarea aria-label="x" disabled value="" onChange={() => {}} /></Dictatable>; }
    render(<Locked />);
    fireEvent.click(screen.getByRole('button', { name: /start dictation/i }));
    await act(() => sleep(30));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});
