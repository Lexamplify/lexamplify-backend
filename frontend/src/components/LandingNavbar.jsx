import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import LexLogoMark from './LexLogoMark';

const navStyles = `
  .lex-landing-nav {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 1000;
    background: rgba(10, 10, 12, 0.82);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    transition: background 0.4s ease, border-color 0.4s ease;
  }
  [data-theme="light"] .lex-landing-nav {
    background: rgba(248, 250, 252, 0.88);
    border-bottom-color: rgba(0, 0, 0, 0.07);
  }
  .lex-landing-nav__inner {
    max-width: 1200px;
    margin: 0 auto;
    height: 64px;
    padding: 0 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }

  /* ── Brand ── */
  .lex-landing-nav__brand {
    display: flex; align-items: center; gap: 10px;
    text-decoration: none; flex-shrink: 0;
  }
  .lex-landing-nav__wordmark {
    font-size: 19px; font-weight: 700;
    color: #FFFFFF; letter-spacing: -0.3px;
    transition: color 0.4s ease;
  }
  [data-theme="light"] .lex-landing-nav__wordmark { color: #0F172A; }

  /* ── Center nav ── */
  .lex-landing-nav__menu {
    display: flex; align-items: center; gap: 2px;
  }
  .lex-landing-nav__link {
    color: rgba(255, 255, 255, 0.68);
    font-size: 14px; font-weight: 500;
    text-decoration: none;
    padding: 8px 13px; border-radius: 8px;
    transition: color 0.2s, padding 0.2s, background 0.2s;
  }
  .lex-landing-nav__link:hover {
    color: #8B5CF6;
    padding-left: 15px; padding-right: 15px;
    background: rgba(139, 92, 246, 0.07);
  }
  [data-theme="light"] .lex-landing-nav__link { color: rgba(15, 23, 42, 0.62); }
  [data-theme="light"] .lex-landing-nav__link:hover { color: #7C3AED; background: rgba(124, 58, 237, 0.05); }

  /* ── Actions ── */
  .lex-landing-nav__actions {
    display: flex; align-items: center; gap: 10px; flex-shrink: 0;
  }
  .lex-landing-nav__login {
    color: rgba(255, 255, 255, 0.82);
    font-size: 14px; font-weight: 500;
    text-decoration: none;
    transition: color 0.2s ease;
  }
  .lex-landing-nav__login:hover { color: #FFFFFF; }
  [data-theme="light"] .lex-landing-nav__login { color: rgba(15, 23, 42, 0.76); }
  [data-theme="light"] .lex-landing-nav__login:hover { color: #0F172A; }

  .lex-landing-nav__cta {
    display: inline-flex; align-items: center; gap: 5px;
    background: #FFFFFF; color: #0A0A0C;
    font-size: 14px; font-weight: 600;
    text-decoration: none;
    padding: 9px 18px; border-radius: 999px;
    border: 1px solid transparent;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .lex-landing-nav__cta:hover {
    background: transparent; color: #FFFFFF;
    border-color: rgba(255, 255, 255, 0.32);
  }
  [data-theme="light"] .lex-landing-nav__cta { background: #0F172A; color: #FFFFFF; }
  [data-theme="light"] .lex-landing-nav__cta:hover { background: #1E293B; color: #FFFFFF; border-color: transparent; }

  .lex-landing-nav__cta-arrow { transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1); }
  .lex-landing-nav__cta:hover .lex-landing-nav__cta-arrow { transform: translateX(3px); }

  /* ── Theme toggle ── */
  .lex-landing-nav__theme-btn {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.6);
    transition: all 0.2s ease;
    flex-shrink: 0;
  }
  .lex-landing-nav__theme-btn:hover {
    color: #FFFFFF;
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.18);
  }
  [data-theme="light"] .lex-landing-nav__theme-btn {
    border-color: rgba(0, 0, 0, 0.09);
    color: rgba(15, 23, 42, 0.55);
  }
  [data-theme="light"] .lex-landing-nav__theme-btn:hover {
    background: rgba(0, 0, 0, 0.04);
    color: #0F172A;
    border-color: rgba(0, 0, 0, 0.14);
  }

  @media (max-width: 860px) { .lex-landing-nav__menu { display: none; } }
  @media (max-width: 540px) { .lex-landing-nav__login { display: none; } }
`;

const NAV_LINKS = [
  { label: 'Solutions', href: '#features' },
  { label: 'Security',  href: '#security'  },
  { label: 'Pricing',   href: '#pricing'   },
  { label: 'Blog',      href: '#blog'      },
  { label: 'About',     href: '#about'     },
];

export default function LandingNavbar() {
  const { theme, toggleTheme } = useTheme();
  return (
    <header className="lex-landing-nav">
      <style>{navStyles}</style>
      <div className="lex-landing-nav__inner">

        <Link to="/" className="lex-landing-nav__brand">
          <LexLogoMark size={30} />
          <span className="lex-landing-nav__wordmark">LexAmplify</span>
        </Link>

        <nav className="lex-landing-nav__menu" aria-label="Primary">
          {NAV_LINKS.map(({ label, href }) => (
            <a key={label} href={href} className="lex-landing-nav__link">{label}</a>
          ))}
        </nav>

        <div className="lex-landing-nav__actions">
          <button
            className="lex-landing-nav__theme-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ) : (
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
          <Link to="/login" className="lex-landing-nav__login">Log in</Link>
          <Link to="/login" className="lex-landing-nav__cta">
            Get Demo <span className="lex-landing-nav__cta-arrow">→</span>
          </Link>
        </div>

      </div>
    </header>
  );
}
