import { useCallback, useEffect, useRef, useState } from 'react';
import { extFor, friendlyMicError, getLang, isSupported, LANG_EVENT_NAME, pickMime } from '../utils/dictation.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export const MAX_SECONDS = 240;        // one dictation; longer speech is better in two parts and keeps the upload small
const MIN_SECONDS = 0.7;               // shorter than this is a click, not speech
const QUIET_PEAK = 0.012;              // loudest moment below this = the mic heard nothing
const UPLOAD_TIMEOUT_MS = 60000;

// Only one microphone may be live at a time, across the whole app.
let activeCancel = null;
function claim(cancel) {
  if (activeCancel && activeCancel !== cancel) activeCancel();
  activeCancel = cancel;
}
function release(cancel) { if (activeCancel === cancel) activeCancel = null; }

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const SERVER_MESSAGES = {
  STT_BUSY: 'The speech service is busy. Please try again in a few seconds.',
  STT_NOT_CONFIGURED: 'Voice typing is not set up on this server yet.',
  AUDIO_TOO_LARGE: 'That recording is too long. Please dictate in shorter parts.',
  AUDIO_TOO_SHORT: 'That was too short to understand. Please speak a little longer.',
  UNSUPPORTED_AUDIO: 'This browser recorded a format we cannot read. Please try Chrome or Edge.',
};

export async function transcribeBlob(blob, { lang, kind, signal } = {}) {
  const form = new FormData();
  form.append('audio', blob, `dictation.${extFor(blob.type)}`);
  form.append('lang', lang || 'auto');
  form.append('kind', kind || 'legal');
  let res;
  try {
    res = await fetch(`${API_BASE}/api/stt/transcribe`, {
      method: 'POST', credentials: 'include', body: form, signal,
      headers: { 'X-CSRF-TOKEN': csrf() },
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new Error('We could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
  if (!res.ok) throw new Error(SERVER_MESSAGES[data.code] || data.message || 'Voice typing failed. Please try again.');
  return data;
}

/**
 * Record from the microphone and turn it into text.
 *   state: 'idle' | 'starting' | 'recording' | 'transcribing'
 *   start() / stop() / cancel()      stop() sends the recording; cancel() throws it away
 *   level (0..1) and seconds         for the meter and the timer
 * onResult(text, meta) is called once per successful dictation with non-empty text.
 */
export default function useDictation({ onResult, kind = 'legal', lang, maxSeconds } = {}) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState('');

  const stateRef = useRef('idle');
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(0);
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const peakRef = useRef(0);
  const abortRef = useRef(null);
  const discardRef = useRef(false);
  const onResultRef = useRef(onResult);
  const cancelRef = useRef(null);
  const yieldRef = useRef(null);
  const langRef = useRef(lang);
  const kindRef = useRef(kind);
  const maxRef = useRef(maxSeconds);
  useEffect(() => {
    onResultRef.current = onResult;
    langRef.current = lang;
    kindRef.current = kind;
    maxRef.current = maxSeconds;
  });

  const set = useCallback((s) => { stateRef.current = s; setState(s); }, []);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    clearInterval(timerRef.current);
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const stopStream = useCallback(() => {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    stopMeter();
    stopStream();
    recorderRef.current = null;
    chunksRef.current = [];
  }, [stopMeter, stopStream]);

  const send = useCallback(async (blob) => {
    set('transcribing');
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
    try {
      const data = await transcribeBlob(blob, { lang: langRef.current || getLang(), kind: kindRef.current, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (data.empty || !data.text) {
        setError('We could not make out any speech. Please try again, a little closer to the microphone.');
      } else {
        onResultRef.current?.(data.text, data);
      }
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (stateRef.current === 'transcribing' && !discardRef.current) setError('That took too long. Please try again.');
      } else {
        setError(e.message || 'Voice typing failed. Please try again.');
      }
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
      set('idle');
    }
  }, [set]);

  const cancel = useCallback(() => {
    discardRef.current = true;
    abortRef.current?.abort();
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* ignore */ } }
    cleanup();
    release(yieldRef.current);
    setSeconds(0);
    set('idle');
  }, [cleanup, set]);

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (stateRef.current !== 'recording' || !rec) return;
    clearInterval(timerRef.current);
    try { rec.stop(); } catch { cancel(); }
  }, [cancel]);

  // Another microphone wants to start: finish this recording and send it (the words are not lost), or drop a start-up.
  const yieldMic = useCallback(() => {
    if (stateRef.current === 'recording') stop();
    else if (stateRef.current === 'starting') cancel();
  }, [stop, cancel]);
  useEffect(() => { cancelRef.current = cancel; yieldRef.current = yieldMic; });

  const start = useCallback(async () => {
    if (stateRef.current !== 'idle') return;
    setError('');
    setNotice('');
    if (!isSupported()) {
      setError(window.isSecureContext === false
        ? 'Voice typing needs a secure (https) connection.'
        : 'Voice typing is not supported in this browser. Please use Chrome, Edge or Safari.');
      return;
    }
    claim(yieldRef.current);
    discardRef.current = false;
    set('starting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      release(yieldRef.current);
      setError(friendlyMicError(e));
      set('idle');
      return;
    }
    // The user may have cancelled or started another dictation while the permission prompt was open.
    if (discardRef.current || stateRef.current !== 'starting') { stream.getTracks().forEach((t) => t.stop()); return; }
    streamRef.current = stream;

    const mime = pickMime();
    let rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    } catch {
      stopStream();
      release(yieldRef.current);
      setError('This browser cannot record audio. Please use Chrome, Edge or Safari.');
      set('idle');
      return;
    }
    recorderRef.current = rec;
    chunksRef.current = [];
    peakRef.current = 0;
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunksRef.current.push(ev.data); };
    rec.onerror = () => { setError('The recording stopped unexpectedly. Please try again.'); cancel(); };
    rec.onstop = () => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      const chunks = chunksRef.current;
      const type = rec.mimeType || mime || 'audio/webm';
      const quiet = peakRef.current < QUIET_PEAK && peakRef.current !== -1;
      stopMeter();
      stopStream();
      recorderRef.current = null;
      chunksRef.current = [];
      setSeconds(0);
      release(yieldRef.current);
      if (discardRef.current) { set('idle'); return; }
      if (elapsed < MIN_SECONDS || !chunks.length) {
        setError('That was too short. Click the microphone, speak, then click it again to finish.');
        set('idle');
        return;
      }
      if (quiet) {
        setError('We could not hear anything. Check that the right microphone is selected and not muted.');
        set('idle');
        return;
      }
      send(new Blob(chunks, { type }));
    };

    // Level meter. If the browser will not give us an analyser, the recording still works: peak -1 skips the quiet check.
    peakRef.current = -1;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      peakRef.current = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i += 1) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        if (rms > peakRef.current) peakRef.current = rms;
        setLevel(Math.min(1, rms * 5));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* no meter */ }

    startedAtRef.current = Date.now();
    setSeconds(0);
    rec.start(250);
    set('recording');
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(s);
      const capSeconds = Number.isFinite(maxRef.current) && maxRef.current > 0 ? maxRef.current : MAX_SECONDS;
      if (s >= capSeconds) { setNotice(`Reached the ${capSeconds} second limit.`); stop(); }
    }, 250);
  }, [cancel, send, set, stop, stopMeter, stopStream]);

  // Leaving the page or unmounting must switch the microphone off.
  useEffect(() => () => {
    discardRef.current = true;
    abortRef.current?.abort();
    try { if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop(); } catch { /* ignore */ }
    cleanup();
    release(yieldRef.current);
  }, [cleanup]);

  // Esc throws the recording away.
  useEffect(() => {
    if (state !== 'recording' && state !== 'transcribing') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, cancel]);

  // An error message clears itself.
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(''), 7000);
    return () => clearTimeout(t);
  }, [error]);

  return { state, error, notice, level, seconds, start, stop, cancel, supported: isSupported(), LANG_EVENT_NAME };
}
