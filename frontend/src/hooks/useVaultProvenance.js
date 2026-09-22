import { useState, useCallback, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Owns the real Provenance Trail feed (app.py's /api/vault/provenance and
// /api/vault/provenance/verify) — replaces CaseWorkspace's old client-only
// `trail` state (INITIAL_PROVENANCE + generateQuickHash()), which never
// persisted and wasn't a real hash chain. Same fetch-in-a-hook convention
// as useVaultTree.js.
export function useVaultProvenance() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null); // {valid, broken_at_id, total_entries} | null
  const [verifying, setVerifying] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/vault/provenance`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to load the provenance trail.');
      setEntries(data.entries || []);
    } catch (e) {
      setError(e.message || 'Failed to load the provenance trail.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const verifyChain = useCallback(async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/vault/provenance/verify`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Verification failed.');
      setVerifyResult(data);
      return data;
    } catch (e) {
      const result = { valid: false, error: e.message || 'Verification failed.' };
      setVerifyResult(result);
      return result;
    } finally {
      setVerifying(false);
    }
  }, []);

  return { entries, loading, error, refresh, verifyChain, verifyResult, verifying };
}
