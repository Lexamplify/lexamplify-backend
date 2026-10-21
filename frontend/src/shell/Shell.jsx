import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import ThemeStudio from '../components/ThemeStudio.jsx';
import { useSettings } from '../store/useSettings.js';

const GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Today', Icon: Ic.Today, end: true },
      { to: '/matters', label: 'Matters', Icon: Ic.Matters },
      { to: '/draft', label: 'Draft', Icon: Ic.Draft, badge: true },
      { to: '/research', label: 'Research', Icon: Ic.Research },
    ],
  },
  {
    label: 'Review',
    items: [
      { to: '/contracts', label: 'Contracts', Icon: Ic.Contracts },
      { to: '/calendar', label: 'Calendar', Icon: Ic.Calendar },
    ],
  },
  {
    label: 'Firm',
    items: [
      { to: '/library', label: 'Library', Icon: Ic.Library },
      { to: '/settings', label: 'Settings', Icon: Ic.Settings },
    ],
  },
];

const FLAT = GROUPS.flatMap((g) => g.items);

export default function Shell() {
  const [open, setOpen] = useState(false);
  const layout = useSettings((st) => st.layout);
  const mini = layout === 'focus';

  return (
    <div className="app">
      <aside className={`rail ${mini ? 'rail--mini' : ''} ${open ? 'is-open' : ''}`}>
        <div className="rail__brand">
          <div className="rail__mono">L</div>
          <div className="rail__word"><b>Lexamplify</b><span>Advocate Chambers</span></div>
        </div>

        <nav className="rail__nav">
          {GROUPS.map((g) => (
            <div className="rail__group" key={g.label}>
              <div className="rail__group-label">{g.label}</div>
              {g.items.map(({ to, label, Icon, end, badge }) => (
                <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)} className={({ isActive }) => `rail__link ${isActive ? 'is-active' : ''}`}>
                  <Icon /><span>{label}</span>{badge && <span className="rail__badge" />}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="rail__foot">
          <div className="rail__user">
            <div className="rail__avatar">A</div>
            <div className="rail__user-meta"><b>Aarav Advocate</b><span>Senior Partner</span></div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__left">
            <button className="icon-btn rail-toggle" onClick={() => setOpen((v) => !v)} aria-label="Menu"><Ic.Menu size={18} /></button>
            <div className="rail__mono topbar__mono" style={{ width: 32, height: 32, fontSize: 16 }}>L</div>
            <div className="topbar__crumb"><b>Advocate Chambers</b><span className="topbar__sep">·</span><span>Delhi</span></div>
          </div>

          <nav className="topnav">
            {FLAT.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'is-active' : '')}>{label}</NavLink>
            ))}
          </nav>

          <div className="topbar__right">
            <button className="cmdk"><Ic.Search size={16} /><span>Search or ask anything</span><kbd>⌘K</kbd></button>
            <button className="icon-btn" aria-label="Notifications"><Ic.Bell size={18} /></button>
          </div>
        </header>

        <div className="main__scroll"><Outlet /></div>
      </div>

      <ThemeStudio />
    </div>
  );
}
