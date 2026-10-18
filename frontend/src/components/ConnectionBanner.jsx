import { useEffect, useState } from 'react';

// Tells the advocate when the browser is offline, so a failed save or upload is understood rather than mysterious.
export default function ConnectionBanner() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  if (online) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: 'sticky', top: 0, zIndex: 50, padding: '10px 16px', background: '#c98a1a', color: '#1a1200', fontSize: 14, textAlign: 'center' }}>
      You are offline. What you type stays on this screen and is saved when the connection returns.
    </div>
  );
}
