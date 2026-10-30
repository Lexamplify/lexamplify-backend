import { initials } from '../../collab/identity.js';

// Live avatars of everyone currently in the document (from Yjs awareness).
export default function PresenceBar({ peers = [] }) {
  const seen = new Set();
  const unique = peers.filter((p) => p && !seen.has(p.id) && seen.add(p.id));
  const shown = unique.slice(0, 5);
  const extra = unique.length - shown.length;

  return (
    <div className="pbar" title={`${unique.length} ${unique.length === 1 ? 'person' : 'people'} here`}>
      <div className="pbar-stack">
        {shown.map((p, i) => (
          <span key={p.id || i} className="pbar-av" style={{ background: p.color, zIndex: shown.length - i }} title={p.name}>{initials(p.name)}</span>
        ))}
        {extra > 0 && <span className="pbar-av pbar-av--more">+{extra}</span>}
      </div>
      <span className="pbar-live"><span className="pbar-pulse" />{unique.length === 1 ? 'Only you' : `${unique.length} editing`}</span>
    </div>
  );
}
