import { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Auto-Draft Studio v1 — real per-user Letterhead persistence
// (routes/letterhead_routes.py), replacing AutoDraftWorkspace.jsx's old
// localStorage-only `userLetterheads` array. Same fetch-in-a-hook shape as
// useOrganization.js/useVaultTree.js — this hook owns the network calls,
// the component just renders `letterheads`. Auth/CSRF cookies are attached
// globally by utils/authFetch.js, so plain fetch() here is enough.
async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Request failed (${res.status}).`);
  }
  return data;
}

export function useLetterheads() {
  const [letterheads, setLetterheads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await request('/api/letterheads');
      setLetterheads(data.letterheads || []);
    } catch (e) {
      setError(e.message || 'Failed to load letterheads.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createLetterhead = useCallback(async ({ name, tagline = '', address = '', contact = '' }) => {
    const data = await request('/api/letterheads', {
      method: 'POST',
      body: JSON.stringify({ name, tagline, address, contact }),
    });
    await refresh();
    return data.letterhead;
  }, [refresh]);

  const deleteLetterhead = useCallback(async (id) => {
    await request(`/api/letterheads/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  return { letterheads, loading, error, refresh, createLetterhead, deleteLetterhead };
}

export default useLetterheads;
