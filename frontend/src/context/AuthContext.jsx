import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext();

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Global session state, rehydrated from the HttpOnly cookie on every page
 * load via GET /api/auth/me — never from localStorage (there is no token
 * to read; the cookie is invisible to JS by design).
 *
 * isInitializing starts true and only flips false once that first /me
 * call resolves (success or failure). Components that gate on auth state
 * (route guards, the InzIQ FAB, etc.) MUST check isInitializing first —
 * checking `!user` alone during the initial async check would read as
 * "logged out" for a fraction of a second on every reload and could
 * trigger a premature redirect/hide before the cookie is ever verified.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  useEffect(() => {
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
