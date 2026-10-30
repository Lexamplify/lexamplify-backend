import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import LexLogoMark from '../LexLogoMark';
import './marketing.css';
import './home.css';

export const CONTACT_EMAIL = 'enterprise@lexamplify.in';

/* Small inline icon set - 24px grid, 1.7 stroke, round joins (matches the app). */
const P = {
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  scan: <><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" /><path d="M8 12h8M8 9h8M8 15h5" /></>,
  scale: <><path d="M12 3v18M7 21h10" /><path d="M5 7h14" /><path d="M5 7 2.5 13a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z" /></>,
  shield: <><path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6M18 14.8c1.8.7 3 2.2 3 4.7" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  spark: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
};

export function Icon({ name, size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {P[name]}
    </svg>
  );
}

const NAV = [
  { label: 'How it works', to: '/#how-it-works' },
  { label: 'Security', to: '/security' },
];

const SOLUTIONS = [
  { icon: 'file', t: 'Drafting', d: 'Notices, petitions and agreements from your file', to: '/solutions#drafting' },
  { icon: 'scan', t: 'Contract review', d: 'Clause-by-clause risk and rewrites', to: '/solutions#contracts' },
  { icon: 'scale', t: 'Firms and teams', d: 'Conflict checks and shared workspaces', to: '/solutions#firms' },
  { icon: 'calendar', t: 'Daily practice', d: 'Matters, documents, hearings and dates', to: '/solutions#chambers' },
];

function Nav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [mega, setMega] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const megaRef = useRef(null);
  const closeTimer = useRef(null);

  useEffect(() => { setOpen(false); setMega(false); }, [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (!open && !mega) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setMega(false); } };
    const onDown = (e) => { if (megaRef.current && !megaRef.current.contains(e.target)) setMega(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open, mega]);

  const hoverOpen = () => { clearTimeout(closeTimer.current); setMega(true); };
  const hoverClose = () => { closeTimer.current = setTimeout(() => setMega(false), 140); };

  return (
    <header className={`nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="wrap nav__inner">
        <Link to="/" className="brand" aria-label="LexAmplify home">
          <LexLogoMark size={32} />
          <span className="brand__word">LexAmplify</span>
        </Link>

        <nav className="nav__links" aria-label="Primary">
          <div className="mega" ref={megaRef} onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
            <button type="button" className="nav__link nav__link--btn" aria-expanded={mega} aria-haspopup="true"
              aria-current={pathname === '/solutions' ? 'page' : undefined} onClick={() => setMega((v) => !v)}>
              Solutions
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            <div className={`mega__panel${mega ? ' is-open' : ''}`}>
              <div className="mega__grid">
                {SOLUTIONS.map((x) => (
                  <Link key={x.t} to={x.to} className="mega__item" tabIndex={mega ? 0 : -1} onClick={() => setMega(false)}>
                    <span className="mega__ico"><Icon name={x.icon} size={20} /></span>
                    <span><b>{x.t}</b><small>{x.d}</small></span>
                  </Link>
                ))}
              </div>
              <Link to="/solutions" className="mega__all" tabIndex={mega ? 0 : -1} onClick={() => setMega(false)}>
                See all solutions <Icon name="arrow" size={15} />
              </Link>
            </div>
          </div>
          {NAV.map((n) => (
            <Link key={n.label} to={n.to} className="nav__link"
              aria-current={pathname === n.to ? 'page' : undefined}>{n.label}</Link>
          ))}
        </nav>

        <div className="nav__actions">
          <Link to="/login" className="nav__signin">Sign in</Link>
          <Link to="/login?mode=register" className="btn btn--primary">Create account</Link>
          <button type="button" className="nav__toggle" aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open} aria-controls="mk-mobile-menu" onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </div>

      <div id="mk-mobile-menu" className={`nav__panel${open ? ' is-open' : ''}`}>
        <Link to="/solutions" tabIndex={open ? 0 : -1}>Solutions</Link>
        {NAV.map((n) => <Link key={n.label} to={n.to} tabIndex={open ? 0 : -1}>{n.label}</Link>)}
        <Link to="/login" tabIndex={open ? 0 : -1}>Sign in</Link>
        <Link to="/login?mode=register" className="btn btn--primary" tabIndex={open ? 0 : -1}>Create account</Link>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <h2 className="sr-only">Site map</h2>
        <div className="footer__grid">
          <div>
            <Link to="/" className="brand" aria-label="LexAmplify home">
              <LexLogoMark size={30} />
              <span className="brand__word">LexAmplify</span>
            </Link>
            <p style={{ marginTop: 16, maxWidth: '34ch' }}>
              Drafting, contract review and case work for Indian advocates and the teams around them.
            </p>
          </div>
          <div>
            <h3>Solutions</h3>
            <ul>
              <li><Link to="/solutions#drafting">Drafting</Link></li>
              <li><Link to="/solutions#contracts">Contract review</Link></li>
              <li><Link to="/solutions#firms">Firms and teams</Link></li>
              <li><Link to="/solutions#chambers">Daily practice</Link></li>
            </ul>
          </div>
          <div>
            <h3>Company</h3>
            <ul>
              <li><Link to="/#how-it-works">How it works</Link></li>
              <li><Link to="/security">Security</Link></li>
              <li><a href={`mailto:${CONTACT_EMAIL}`}>Contact</a></li>
            </ul>
          </div>
          <div>
            <h3>Account</h3>
            <ul>
              <li><Link to="/login">Sign in</Link></li>
              <li><Link to="/login?mode=register">Create account</Link></li>
              <li><a href={`mailto:${CONTACT_EMAIL}?subject=LexAmplify%20walkthrough`}>Request a walkthrough</a></li>
            </ul>
          </div>
        </div>
        <div className="footer__mark" aria-hidden="true">LexAmplify</div>
        <div className="footer__legal">
          <span>© {new Date().getFullYear()} LexAmplify India Software Solutions. All rights reserved.</span>
          <span>LexAmplify assists legal professionals; it does not provide legal advice.</span>
        </div>
      </div>
    </footer>
  );
}

/** Fades sections in as they scroll into view. Content is fully visible
 *  without JS and for people who prefer reduced motion. */
function useReveal(rootRef) {
  const { pathname } = useLocation();
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return undefined;
    root.classList.add('js');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    root.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    return () => { io.disconnect(); root.classList.remove('js'); };
  }, [rootRef, pathname]);
}

export default function MarketingLayout({ title, description, children }) {
  const rootRef = useRef(null);
  const { hash, pathname } = useLocation();
  useReveal(rootRef);

  useEffect(() => {
    document.title = title;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    if (description) meta.content = description;
  }, [title, description]);

  // Scroll to #anchors (the router does not do this on its own) and to top on page change.
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    }
    window.scrollTo(0, 0);
  }, [hash, pathname]);

  return (
    <div className="mk" ref={rootRef}>
      <a className="skip-link" href="#main">Skip to content</a>
      <Nav />
      <main id="main">{children}</main>
      <Footer />
    </div>
  );
}
