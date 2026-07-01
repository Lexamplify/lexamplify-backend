import React from 'react';
import { Link } from 'react-router-dom';
import LexLogoMark from './LexLogoMark';

/**
 * LandingNavbar — premium, minimalist glassmorphism top bar for the public
 * landing page. Fixed to the top of the viewport.
 */
const navStyles = `
  .lex-landing-nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    background: rgba(10, 10, 12, 0.8);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
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

  /* Left — brand */
  .lex-landing-nav__brand {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    flex-shrink: 0;
  }
  .lex-landing-nav__wordmark {
    font-size: 19px;
    font-weight: 700;
    color: #FFFFFF;
    letter-spacing: -0.3px;
  }

  /* Center — navigation menu */
  .lex-landing-nav__menu {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .lex-landing-nav__link {
    color: rgba(255, 255, 255, 0.72);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    padding: 8px 14px;
    border-radius: 8px;
    transition: color 0.2s cubic-bezier(0.4, 0, 0.2, 1), padding 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s ease;
  }
  .lex-landing-nav__link:hover {
    color: #8B5CF6;
    padding-left: 16px;
    padding-right: 16px;
    background: rgba(139, 92, 246, 0.06);
  }

  /* Right — actions */
  .lex-landing-nav__actions {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-shrink: 0;
  }
  .lex-landing-nav__login {
    color: rgba(255, 255, 255, 0.85);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    transition: color 0.2s ease;
  }
  .lex-landing-nav__login:hover {
    color: #FFFFFF;
  }
  .lex-landing-nav__cta {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #FFFFFF;
    color: #0A0A0C;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    padding: 9px 18px;
    border-radius: 999px;
    border: 1px solid transparent;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .lex-landing-nav__cta:hover {
    background: transparent;
    color: #FFFFFF;
    border-color: rgba(255, 255, 255, 0.35);
  }
  .lex-landing-nav__cta-arrow {
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .lex-landing-nav__cta:hover .lex-landing-nav__cta-arrow {
    transform: translateX(3px);
  }

  /* Collapse the center menu on narrow viewports */
  @media (max-width: 860px) {
    .lex-landing-nav__menu { display: none; }
  }
  @media (max-width: 480px) {
    .lex-landing-nav__login { display: none; }
  }
`;

const NAV_LINKS = [
  { label: 'Solutions', href: '#features' },
  { label: 'Security', href: '#security' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Blog', href: '#blog' },
  { label: 'About', href: '#about' },
];

export default function LandingNavbar() {
  return (
    <header className="lex-landing-nav">
      <style>{navStyles}</style>
      <div className="lex-landing-nav__inner">

        {/* Left — geometric logo + wordmark */}
        <Link to="/" className="lex-landing-nav__brand">
          <LexLogoMark size={30} />
          <span className="lex-landing-nav__wordmark">LexAmplify</span>
        </Link>

        {/* Center — primary navigation */}
        <nav className="lex-landing-nav__menu" aria-label="Primary">
          {NAV_LINKS.map(({ label, href }) => (
            <a key={label} href={href} className="lex-landing-nav__link">
              {label}
            </a>
          ))}
        </nav>

        {/* Right — auth actions */}
        <div className="lex-landing-nav__actions">
          <Link to="/login" className="lex-landing-nav__login">Log in</Link>
          <Link to="/login" className="lex-landing-nav__cta">
            Get Demo
            <span className="lex-landing-nav__cta-arrow">→</span>
          </Link>
        </div>

      </div>
    </header>
  );
}
