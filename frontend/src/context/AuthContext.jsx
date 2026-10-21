import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { waitUntilAwake, startHeartbeat } from '../utils/warmServer';
import { isPreviewMode, PREVIEW_USER } from '../utils/devPreview';

export const AuthContext = createContext(null);

const PREVIEW = isPreviewMode();

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Global session state, rehydrated from the HttpOnly cookie on every page
 * load via GET /api/auth/me — never from localStorage (there is no token
 * to read; the cookie is invisible to JS by design).
 *
 * isInitializing starts true and only flips false once that first /me
 * call resolves (success or failure). Components that gate on auth state
 * (route guards, the LexAmplify FAB, etc.) MUST check isInitializing first —
 * checking `!user` alone during the initial async check would read as
 * "logged out" for a fraction of a second on every reload and could
 * trigger a premature redirect/hide before the cookie is ever verified.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(PREVIEW ? PREVIEW_USER : null);
  const [isInitializing, setIsInitializing] = useState(!PREVIEW);

  // A sleeping server (Render) / database (Neon) answers /me slowly, with a 5xx, or not at all. That is NOT
  // "logged out": treating it that way threw people back to the login page although their session was fine.
  // Only a real 401/403/404 (after the silent refresh in authFetch already tried) means signed out. Anything
  // else keeps the splash up, wakes the server and retries.
  const refreshSession = useCallback(async () => {
    const MAX_TRIES = 8;
    try {
      for (let i = 1; i <= MAX_TRIES; i += 1) {
        try {
          const res = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: 'include', signal: AbortSignal.timeout(30000) });
          if (res.ok) {
            const data = await res.json();
            setUser(data.user || null);
            return;
          }
          if ([401, 403, 404, 422].includes(res.status)) { setUser(null); return; }
        } catch { /* network error or timeout - the server is waking */ }
        if (i === MAX_TRIES) break;
        await waitUntilAwake({ force: true, deadlineMs: 60000 });
      }
      // Could not reach the server at all: stay on whatever we had (do not force a logout).
    } finally {
      setIsInitializing(false);
    }
  }, []);

  useEffect(() => { if (user) startHeartbeat(); }, [user]);

  // authFetch raises this when a refresh fails: the session is over, so drop the user and the route guard sends them to sign in.
  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('lexamplify:session-expired', onExpired);
    return () => window.removeEventListener('lexamplify:session-expired', onExpired);
  }, []);

  useEffect(() => {
    if (PREVIEW) return; // dev preview: skip the backend /me call entirely
    refreshSession();
  }, [refreshSession]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      // Best-effort — clear local state regardless of network outcome.
    }
    setUser(null);
  }, []);

  const value = {
    user,
    isAuthenticated: !!user,
    isInitializing,
    // Legacy alias — some components were written expecting `authLoading`.
    authLoading: isInitializing,
    setUser,
    refreshSession,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
