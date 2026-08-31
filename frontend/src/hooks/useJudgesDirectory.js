import { useState, useEffect, useCallback } from 'react';

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

    fetch(`/api/directory/judges?district=${encodeURIComponent(districtKey)}`, {
      signal: controller.signal
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
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
