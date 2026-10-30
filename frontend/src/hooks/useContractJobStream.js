import { useEffect, useRef, useState, useCallback } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''; // relative — same-origin via Vite proxy in dev
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 8000;

/**
 * Streams a Celery job's live progress via SSE (EventSource) — never
 * short-polling. Reconnects with capped exponential backoff on network
 * drops; the server re-emits the task's full current state on every frame
 * (not a delta), so a reconnect resumes correctly with no Last-Event-ID
 * bookkeeping required.
 */
export default function useContractJobStream(jobId) {
  const [state, setState] = useState('IDLE'); // IDLE | PENDING | PROGRESS | SUCCESS | FAILURE
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const esRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const attemptRef = useRef(0);
  const terminalRef = useRef(false);

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) {
      cleanup();
      setState('IDLE');
      return;
    }

    terminalRef.current = false;
    attemptRef.current = 0;
    setState('PENDING');
    setStatus('Queued...');
    setProgress(0);
    setResult(null);
    setError(null);

    const connect = () => {
      const es = new EventSource(`${API_BASE_URL}/api/contract/stream/${jobId}`, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => { attemptRef.current = 0; };

      es.onmessage = (evt) => {
        let payload;
        try {
          payload = JSON.parse(evt.data);
        } catch {
          return; // malformed frame — wait for the next one rather than crash the stream
        }

        setState(payload.state || 'PROGRESS');
        setStatus(payload.status || '');
        if (typeof payload.progress === 'number') setProgress(payload.progress);

        if (payload.state === 'SUCCESS') {
          setResult(payload.result ?? null);
          terminalRef.current = true;
          cleanup();
        } else if (payload.state === 'FAILURE') {
          setError(payload.error || 'Analysis failed.');
          terminalRef.current = true;
          cleanup();
        }
      };

      es.onerror = () => {
        es.close();
        if (terminalRef.current) return; // job already finished — nothing to reconnect for
        const attempt = ++attemptRef.current;
        const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
        setStatus((prev) => prev || 'Reconnecting...');
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
    };

    connect();
    return cleanup;
  }, [jobId, cleanup]);

  return { state, status, progress, result, error };
}
