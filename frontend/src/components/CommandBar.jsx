import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';

const COMMANDS = [
  { sec: 'Go to', label: 'Today', Icon: Ic.Today, to: '/' },
  { sec: 'Go to', label: 'Matters', Icon: Ic.Matters, to: '/matters' },
  { sec: 'Go to', label: 'Draft', Icon: Ic.Draft, to: '/draft' },
  { sec: 'Go to', label: 'Research', Icon: Ic.Research, to: '/research' },
  { sec: 'Go to', label: 'Contracts', Icon: Ic.Contracts, to: '/contracts' },
  { sec: 'Go to', label: 'Calendar', Icon: Ic.Calendar, to: '/calendar' },
  { sec: 'Go to', label: 'Library', Icon: Ic.Library, to: '/library' },
  { sec: 'Go to', label: 'Settings', Icon: Ic.Settings, to: '/settings' },
  { sec: 'Actions', label: 'New matter', Icon: Ic.Plus, to: '/matters?new=1' },
  { sec: 'Actions', label: 'Draft a document', Icon: Ic.Draft, to: '/draft' },
  { sec: 'Actions', label: 'Research the law', Icon: Ic.Research, to: '/research' },
  { sec: 'Actions', label: 'Review a contract', Icon: Ic.Contracts, to: '/contracts' },
];

export default function CommandBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('lx:cmdk', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('lx:cmdk', onOpen); };
  }, []);

  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const results = useMemo(() => COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())), [q]);

  const run = (c) => { setOpen(false); navigate(c.to); };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && results[active]) run(results[active]);
  };

  if (!open) return null;

  let lastSec = null;
  return (
    <div className="cmd-ov" onClick={() => setOpen(false)}>
      <div className="cmd" onClick={(e) => e.stopPropagation()}>
        <div className="cmd__in">
          <Ic.Search size={18} />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKeyDown} placeholder="Search or jump to…" />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>esc</span>
        </div>
        <div className="cmd__list">
          {results.length === 0 && <div className="cmd__sec">No matches</div>}
          {results.map((c, i) => {
            const head = c.sec !== lastSec ? c.sec : null; lastSec = c.sec;
            return (
              <div key={c.label + i}>
                {head && <div className="cmd__sec">{head}</div>}
                <div className={`cmd__it ${i === active ? 'is-on' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => run(c)}>
                  <c.Icon size={17} /><span>{c.label}</span>
                  <span className="k">↵</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
