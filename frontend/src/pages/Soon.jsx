import * as Ic from '../icons.jsx';

// Luxury placeholder for screens being migrated from the legacy app and rebuilt
// from scratch in the new design. Shown until the real luxury page lands.
export default function Soon({ title = 'This screen', blurb }) {
  return (
    <div className="lx-page lx-rise">
      <div className="ph">
        <span className="ph__eyebrow">Being rebuilt</span>
        <h1 className="ph__title">{title}</h1>
        <p className="ph__sub">{blurb || 'We’re rebuilding this from the ground up in the new design — refined, faster, and wired to your live data.'}</p>
      </div>
      <div className="lx-card lx-card--pad" style={{ textAlign: 'center', padding: '56px 24px' }}>
        <div style={{ display: 'grid', placeItems: 'center', marginBottom: 14, color: 'var(--accent)' }}><Ic.Sparkle size={26} /></div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 19, color: 'var(--ink)', marginBottom: 6 }}>Coming next</div>
        <div className="lx-muted" style={{ maxWidth: 420, margin: '0 auto', fontSize: 13.5, lineHeight: 1.6 }}>
          This page is on the build list. The feature exists in the product — it’s being re-crafted here in the luxury design and will light up shortly.
        </div>
      </div>
    </div>
  );
}
