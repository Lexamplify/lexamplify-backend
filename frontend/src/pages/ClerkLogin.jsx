import { useEffect, useState } from 'react';
import { SignedIn, SignedOut, SignIn, useAuth } from '@clerk/clerk-react';

/**
 * Clerk sign-in → app session.
 *
 * Clerk owns the login UI (email, Google, etc). Once the user is signed in to
 * Clerk, we take the Clerk session token and POST it to the backend
 * (/api/auth/clerk/session), which verifies it and issues THIS app's own
 * HttpOnly cookie — the session every other page already uses. Then we land on
 * the dashboard. The rest of the app is unchanged.
 */
export default function ClerkLogin() {
  const { isSignedIn, getToken } = useAuth();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setErr('');
      try {
        const token = await getToken();
        const r = await fetch('/api/auth/clerk/session', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.message || `Sign-in failed (HTTP ${r.status}).`);
        }
        if (!cancelled) window.location.replace('/#/dashboard');
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Sign-in failed.');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getToken]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <SignedOut>
        <SignIn routing="virtual" />
      </SignedOut>
      <SignedIn>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          {busy && <p>Signing you in…</p>}
          {!busy && err && (
            <>
              <p style={{ color: '#b42318', marginBottom: 12 }}>{err}</p>
              <a href="/#/login">Back to login</a>
            </>
          )}
          {!busy && !err && <p>Signed in. Redirecting…</p>}
        </div>
      </SignedIn>
    </div>
  );
}
