import { useState } from 'react';
import { useSettings } from '../store/useSettings.js';
import * as Ic from '../icons.jsx';

const THEMES = [
  { id: 'warm-luxury', name: 'Warm Luxury', mood: 'Royal · warm', sw: ['#F4F0E6', '#16271D', '#B08D57'] },
  { id: 'noir-luxe', name: 'Noir Luxe', mood: 'Royal · dark', sw: ['#0E0E10', '#1B1B1E', '#C9A96B'] },
  { id: 'porcelain', name: 'Porcelain', mood: 'Minimalist', sw: ['#F7F7F5', '#FFFFFF', '#2B2B30'] },
  { id: 'sage-ink', name: 'Sage & Ink', mood: 'Calm pro', sw: ['#F3F1EA', '#1C332E', '#C06B4A'] },
  { id: 'midnight-indigo', name: 'Midnight Indigo', mood: 'AI · smooth', sw: ['#0D0F1A', '#191D2E', '#7C8CFF'] },
  { id: 'royal-oxblood', name: 'Royal Oxblood', mood: 'Royal', sw: ['#F3EBE0', '#4A1D22', '#B0893F'] },
  { id: 'slate-pro', name: 'Slate Pro', mood: 'Corporate', sw: ['#F4F6F8', '#101827', '#2563C9'] },
];
const LAYOUTS = [
  { id: 'rail', name: 'Side rail', desc: 'Classic', cls: 'lay--rail' },
  { id: 'top', name: 'Top bar', desc: 'Full width', cls: 'lay--top' },
  { id: 'focus', name: 'Focus', desc: 'Centered', cls: 'lay--focus' },
];
const TYPES = [
  { id: 'serif', name: 'Classic', note: 'Playfair' },
  { id: 'sans', name: 'Modern', note: 'Grotesk' },
  { id: 'editorial', name: 'Editorial', note: 'Spectral' },
];
const ACCENTS = [
  { id: 'theme', c: 'var(--accent)', label: 'Theme' },
  { id: 'gold', c: '#B08D57' }, { id: 'blue', c: '#2563C9' }, { id: 'emerald', c: '#2E8B6F' },
  { id: 'violet', c: '#7C6CF0' }, { id: 'oxblood', c: '#9B3B3B' }, { id: 'teal', c: '#1E8A8A' },
];
const THEME_IDS = ['warm-luxury', 'noir-luxe', 'porcelain', 'sage-ink', 'midnight-indigo', 'royal-oxblood', 'slate-pro'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export default function ThemeStudio() {
  const [open, setOpen] = useState(false);
  const s = useSettings();

  return (
    <>
      <button className="studio-fab" onClick={() => setOpen(true)}><Ic.Palette size={17} /> Theme Studio</button>

      {open && (
        <>
          <div className="studio-overlay" onClick={() => setOpen(false)} />
          <aside className="studio">
            <div className="studio__head">
              <div>
                <h3>Theme Studio</h3>
                <p>Preview live · choices are saved for review</p>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><Ic.X size={17} /></button>
            </div>

            <div className="studio__body">
              <div className="studio-sec">
                <div className="studio-sec__label"><Ic.Palette size={13} /> Theme</div>
                <div className="sw-grid">
                  {THEMES.map((t) => (
                    <button key={t.id} className={`sw ${s.theme === t.id ? 'is-on' : ''}`} onClick={() => s.update({ theme: t.id })}>
                      <div className="sw__dots">{t.sw.map((c, i) => <i key={i} style={{ background: c }} />)}</div>
                      <div className="sw__name">{t.name}</div>
                      <div className="sw__mood">{t.mood}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="studio-sec">
                <div className="studio-sec__label"><Ic.Palette size={13} /> Accent</div>
                <div className="acc-row">
                  {ACCENTS.map((a) => (
                    <button key={a.id} className={`acc ${s.accent === a.id ? 'is-on' : ''}`} title={a.label || a.id} onClick={() => s.update({ accent: a.id })}>
                      <span className="acc__dot" style={{ background: a.c }} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="studio-sec">
                <div className="studio-sec__label"><Ic.Sliders size={13} /> Layout</div>
                <div className="opt-row">
                  {LAYOUTS.map((l) => (
                    <button key={l.id} className={`opt ${s.layout === l.id ? 'is-on' : ''}`} onClick={() => s.update({ layout: l.id })}>
                      <div className={`lay ${l.cls}`}><i /><i /></div>
                      <div className="opt__name">{l.name}</div>
                      <div className="opt__desc">{l.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="studio-sec">
                <div className="studio-sec__label"><Ic.Doc size={13} /> Typography</div>
                <div className="opt-row">
                  {TYPES.map((t) => (
                    <button key={t.id} className={`opt ${s.type === t.id ? 'is-on' : ''}`} onClick={() => s.update({ type: t.id })}>
                      <div className="opt__glyph" style={{ fontFamily: t.id === 'sans' ? "'Space Grotesk',sans-serif" : t.id === 'editorial' ? "'Spectral',serif" : "'Playfair Display',serif" }}>Aa</div>
                      <div className="opt__name">{t.name}</div>
                      <div className="opt__desc">{t.note}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="studio-sec">
                <div className="studio-sec__label"><Ic.Doc size={13} /> Text size</div>
                <div className="seg">
                  {[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']].map(([id, name]) => (
                    <button key={id} className={s.text === id ? 'is-on' : ''} onClick={() => s.update({ text: id })}>{name}</button>
                  ))}
                </div>
              </div>

              <div className="studio-sec">
                <div className="studio-sec__label"><Ic.Sliders size={13} /> Shape</div>
                <div className="seg">
                  {['soft', 'sharp'].map((r) => (
                    <button key={r} className={s.radius === r ? 'is-on' : ''} onClick={() => s.update({ radius: r })}>{r === 'soft' ? 'Soft corners' : 'Sharp corners'}</button>
                  ))}
                </div>
              </div>

              <div className="studio-sec">
                <div className="studio-sec__label"><Ic.Sliders size={13} /> Density</div>
                <div className="seg">
                  {['comfortable', 'compact'].map((d) => (
                    <button key={d} className={s.density === d ? 'is-on' : ''} onClick={() => s.update({ density: d })}>{d === 'comfortable' ? 'Comfortable' : 'Compact'}</button>
                  ))}
                </div>
              </div>

              <div className="studio-sec" style={{ marginBottom: 4 }}>
                <div className="studio-sec__label"><Ic.Sparkle size={13} /> Motion</div>
                <div className="seg">
                  {[['full', 'Full'], ['reduced', 'Reduced']].map(([id, name]) => (
                    <button key={id} className={s.motion === id ? 'is-on' : ''} onClick={() => s.update({ motion: id })}>{name}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="studio__foot">
              <button className="lx-btn lx-btn--ghost lx-btn--sm" style={{ flex: 1 }}
                onClick={() => s.update({ theme: pick(THEME_IDS), accent: pick(ACCENTS).id, layout: pick(LAYOUTS).id, type: pick(TYPES).id })}>
                <Ic.Sparkle size={14} /> Surprise me
              </button>
              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => s.reset()}>Reset</button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
