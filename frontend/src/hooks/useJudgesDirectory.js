import { useState, useEffect, useCallback } from 'react';

// VITE_API_BASE_URL, not VITE_API_URL — matches the one name this codebase
// already uses everywhere (services/api.js, AuthContext.jsx, LoginPage.jsx,
// 20+ other call sites), all falling back to '' so requests stay relative
// and go through the Vite dev proxy same-origin (required for the
// SameSite=Strict auth cookie — see frontend/.env.local).
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export function useJudgesDirectory(districtKey) {
  const [judges, setJudges] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped by refetch() below to retry a failed fetch — districtKey alone
  // doesn't change on retry, so it can't be the only effect dependency.
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!districtKey) {
      setJudges([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetch(`${BASE_URL}/api/directory/judges?district=${encodeURIComponent(districtKey)}`, {
      signal: controller.signal
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status} (${res.statusText})`);
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          // An SPA fallback or a 502 gateway page comes back as HTML with a
          // 200/204 — res.ok is true, so the check above wouldn't catch it,
          // and res.json() would otherwise crash on "Unexpected token '<'".
          throw new Error(`Expected JSON response but received ${contentType || 'non-JSON payload'}`);
        }
        return res.json();
      })
      .then((data) => {
        setJudges(Array.isArray(data) ? data : []);
        setIsLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error(`Failed to load directory for ${districtKey}:`, err);
          setError(err.message || 'Failed to fetch judicial officers');
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [districtKey, retryCount]);

  const refetch = useCallback(() => setRetryCount((n) => n + 1), []);

  return { judges, isLoading, error, refetch };
}
