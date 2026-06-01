import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

const landingStyles = `
  .landing-container {
    background-color: var(--bg-app);
    color: var(--text-primary);
    min-height: 100vh;
    font-family: var(--font-sans);
    overflow-x: hidden;
    position: relative;
  }
  .landing-header {
    background-color: var(--bg-sidebar);
    border-bottom: 1px solid var(--border-subtle);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .hero-wrapper {
    position: relative;
    padding: 140px 24px 100px;
    overflow: hidden;
  }
  @keyframes gradient-pulse {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .hero-animated-bg {
    position: absolute;
    width: 600px;
    height: 600px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    filter: blur(60px);
    z-index: 0;
    pointer-events: none;
    animation: branding-pulse 12s infinite alternate ease-in-out;
  }
  [data-theme="light"] .hero-animated-bg {
    background: radial-gradient(circle, rgba(59, 130, 246, 0.08) 0%, transparent 70%);
  }
  .hero-section {
    text-align: center;
    max-width: 900px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }
  .hero-h1 {
    font-family: var(--font-serif);
    font-size: 3rem; /* text-5xl */
    line-height: 1.1;
    margin-bottom: 24px;
    letter-spacing: -0.5px;
    font-weight: 700;
  }
  @media (min-width: 768px) {
    .hero-h1 {
      font-size: 4.5rem; /* text-7xl */
    }
  }
  .hero-p {
    font-size: 19px;
    color: var(--text-muted);
    line-height: 1.6;
    margin-bottom: 40px;
    max-width: 680px;
    margin-left: auto;
    margin-right: auto;
  }
  .btn-primary {
    background-color: var(--accent-primary);
    color: #FFFFFF;
    font-weight: 500;
    border: none;
    border-radius: 8px;
    padding: 12px 28px;
    font-size: 16px;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.2s;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .btn-primary:hover {
    background-color: var(--accent-hover);
    transform: translateY(-1px);
  }
  .btn-secondary {
    background-color: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
    font-weight: 500;
    border-radius: 8px;
    padding: 12px 28px;
    font-size: 16px;
    cursor: pointer;
    transition: background-color 0.2s, border-color 0.2s;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .btn-secondary:hover {
    background-color: var(--accent-muted);
    border-color: var(--accent-primary);
  }


  /* Pipeline styling */
  .pipeline-section {
    padding: 100px 24px;
    max-width: 1000px;
    margin: 0 auto;
    border-bottom: 1px solid var(--border-subtle);
  }
  .section-title {
    font-family: var(--font-serif);
    font-size: 36px;
    text-align: center;
    margin-bottom: 12px;
  }
  .section-subtitle {
    font-size: 15px;
    color: var(--text-muted);
    text-align: center;
    margin-bottom: 60px;
  }
  .pipeline-flow {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 40px;
    position: relative;
  }
  .pipeline-flow::after {
    content: '';
    position: absolute;
    top: 40px;
    left: 15%;
    right: 15%;
    height: 1px;
    background: var(--border-subtle);
    z-index: 1;
  }
  .pipeline-step {
    text-align: center;
    position: relative;
    z-index: 2;
  }
  .pipeline-badge {
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background-color: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    font-size: 24px;
    color: var(--accent-primary);
    transition: border-color 0.3s, background-color 0.3s, transform 0.3s;
  }
  .pipeline-step:hover .pipeline-badge {
    border-color: var(--accent-primary);
    background-color: var(--accent-muted);
    transform: translateY(-4px);
  }
  .pipeline-h3 {
    font-size: 18px;
    margin-bottom: 8px;
  }
  .pipeline-p {
    font-size: 13.5px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* Alternating Feature Blocks */
  .feature-block {
    display: flex;
    flex-direction: column;
    gap: 48px;
    padding: 100px 24px;
    max-width: 1100px;
    margin: 0 auto;
    align-items: center;
    border-bottom: 1px solid var(--border-subtle);
  }
  @media (min-width: 768px) {
    .feature-block {
      flex-direction: row;
    }
    .feature-block.reversed {
      flex-direction: row-reverse;
    }
  }
  .feature-text-panel {
    flex: 1;
  }
  .feature-ui-panel {
    flex: 1.1;
    width: 100%;
    max-width: 520px;
  }
  .feature-block-tag {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--accent-primary);
    font-weight: 600;
    margin-bottom: 12px;
  }
  .feature-block-h2 {
    font-family: var(--font-serif);
    font-size: 32px;
    line-height: 1.2;
    margin-bottom: 20px;
  }
  .feature-block-p {
    font-size: 15px;
    color: var(--text-muted);
    line-height: 1.6;
    margin-bottom: 28px;
  }
  .feature-checklist {
    list-style: none;
    margin-bottom: 30px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .feature-check-item {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
  }
  .feature-check-icon {
    color: var(--accent-success);
    font-weight: bold;
  }

  /* Glassmorphism card mockup styling */
  .glass-mockup {
    background: rgba(26, 28, 38, 0.45);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    padding: 20px;
  }
  [data-theme="light"] .glass-mockup {
    background: rgba(255, 255, 255, 0.5);
    box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.08);
  }

  /* Security details banner styling */
  .security-compliance-section {
    padding: 100px 24px;
    text-align: center;
    background-color: var(--bg-sidebar);
    border-bottom: 1px solid var(--border-subtle);
  }
  .security-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 32px;
    max-width: 1000px;
    margin: 40px auto 0;
  }
  .security-item {
    padding: 20px;
  }
  .security-h3 {
    font-size: 18px;
    margin-bottom: 10px;
  }
  .security-p {
    font-size: 13.5px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  @media (max-width: 768px) {
    .pipeline-flow {
      grid-template-columns: 1fr;
      gap: 50px;
    }
    .pipeline-flow::after {
      display: none;
    }
    .security-grid {
      grid-template-columns: 1fr;
    }
  }
`;

function ScrollReveal({ children }) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, []);

  return (
    <div ref={ref} className={`scroll-animate ${isVisible ? 'animated' : ''}`}>
      {children}
    </div>
  );
}

export default function LandingPage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="landing-container">
      <style>{landingStyles}</style>

      {/* Header */}
      <header className="landing-header">
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '0.5px' }}>LexAmplify</span>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', background: 'var(--accent-muted)', color: 'var(--accent-primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: '600' }}>
              India
            </span>
          </div>

          {/* Navigation Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Theme Toggle Button */}
            <button
              onClick={toggleTheme}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-primary)',
              }}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {theme === 'dark' ? (
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            {/* Enter Console Button */}
            <Link to="/login" className="btn-primary" style={{ padding: '8px 18px', fontSize: '14px' }}>
              Enter Console
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="hero-wrapper">
        <div className="hero-animated-bg" />
        <section className="hero-section">
          <ScrollReveal>
            <h1 className="hero-h1">
              The Sovereign Intelligence Layer for Indian Law.
            </h1>
            <p className="hero-p">
              Synthesize contracts, run cross-document conflict audits, and query your case database with context-grounded AI precision.
            </p>
            <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/login" className="btn-primary">
                Get Started
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <a href="#features" className="btn-secondary">
                Explore Features
              </a>
            </div>
          </ScrollReveal>
        </section>
      </div>


      {/* Alternating Feature Sections */}
      <div id="features">
        
        {/* BLOCK 1: Contract Analysis (Text Left, UI Right) */}
        <section className="feature-block">
          <div className="feature-text-panel">
            <ScrollReveal>
              <div className="feature-block-tag">Module 01</div>
              <h2 className="feature-block-h2">Contract Risk Analyzer</h2>
              <p className="feature-block-p">
                Instantly scan agreements for liability flags, draft customized clause updates, and identify missing provisions standard to Indian Law.
              </p>
              <ul className="feature-checklist">
                <li className="feature-check-item">
                  <span className="feature-check-icon">✓</span>
                  <span>Automated threat indexing for high-risk liability markers</span>
                </li>
                <li className="feature-check-item">
                  <span className="feature-check-icon">✓</span>
                  <span>AI rewrite recommendations matching Indian Contract Act parameters</span>
                </li>
                <li className="feature-check-item">
                  <span className="feature-check-icon">✓</span>
                  <span>One-click exports to client-ready DOCX and PDF briefs</span>
                </li>
              </ul>
              <Link to="/login" className="btn-primary">Launch Risk Scan</Link>
            </ScrollReveal>
          </div>

          <div className="feature-ui-panel">
            <ScrollReveal>
              <div className="glass-mockup">
                {/* Mockup Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '600' }}>Master_Service_Agreement.docx</span>
                  <span style={{ fontSize: '10px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-danger)', padding: '2px 6px', borderRadius: '4px' }}>
                    Scan Strategy: Defensive
                  </span>
                </div>
                {/* Mockup Content */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
                  <div style={{ background: 'var(--bg-app)', padding: '10px', borderRadius: '6px', borderLeft: '3px solid var(--accent-warning)' }}>
                    <strong>Clause 2.4: Suspension right</strong>
                    <div style={{ color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
                      "...Client reserves the absolute right to suspend all payments in its sole discretion..."
                    </div>
                  </div>
                  <div style={{ padding: '8px 12px', background: 'rgba(245, 158, 11, 0.08)', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)', fontSize: '11px', color: 'var(--accent-warning)' }}>
                    ⚠️ Liability mismatch. Unilateral suspension right violates standard service protections.
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* BLOCK 2: Conflict Engine (UI Left, Text Right - reversed) */}
        <section className="feature-block reversed">
          <div className="feature-text-panel">
            <ScrollReveal>
              <div className="feature-block-tag">Module 02</div>
              <h2 className="feature-block-h2">Conflict Check Engine</h2>
              <p className="feature-block-p">
                Execute cross-file comparison audits and database index runs. Locate direct representation overlaps or subtle potential conflict tags.
              </p>
              <ul className="feature-checklist">
                <li className="feature-check-item">
                  <span className="feature-check-icon">✓</span>
                  <span>Cross-document client comparison database checks</span>
                </li>
                <li className="feature-check-item">
                  <span className="feature-check-icon">✓</span>
                  <span>Direct match indicators matching client and opponent portfolios</span>
                </li>
                <li className="feature-check-item">
                  <span className="feature-check-icon">✓</span>
                  <span>Automated extraction of text-based references</span>
                </li>
              </ul>
              <Link to="/login" className="btn-primary">Audit Client Roster</Link>
            </ScrollReveal>
          </div>

          <div className="feature-ui-panel">
            <ScrollReveal>
              <div className="glass-mockup">
                {/* Mockup Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '600' }}>Conflict Check Directory</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Query: "Tech Corp India"</span>
                </div>
                {/* Mockup Table */}
                <div style={{ fontSize: '11.5px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: 'var(--bg-app)', borderRadius: '6px' }}>
                    <span>Opponent dossier match</span>
                    <span style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-danger)', padding: '2px 6px', borderRadius: '4px', fontSize: '9.5px', fontWeight: '600' }}>
                      🔴 HIGH CONFLICT
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', background: 'var(--bg-app)', borderRadius: '6px' }}>
                    <span>Text record mention: Rajesh Sharma</span>
                    <span style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--accent-warning)', padding: '2px 6px', borderRadius: '4px', fontSize: '9.5px', fontWeight: '600' }}>
                      🟡 POTENTIAL
                    </span>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* BLOCK 3: Universal RAG Chat (Text Left, UI Right) */}
        <section className="feature-block">
          <div className="feature-text-panel">
            <ScrollReveal>
              <div className="feature-block-tag">Module 03</div>
              <h2 className="feature-block-h2">Universal RAG Chat</h2>
              <p className="feature-block-p">
                Query context-grounded data from files. Give natural directions to route screens, retrieve case documents, or search court listings.
              </p>
              <ul className="feature-checklist">
                <li className="feature-check-item">
                  <span className="feature-check-icon">✓</span>
                  <span>Centralized API routing with secure JWT injection</span>
                </li>
                <li className="feature-check-item">
                  <span className="feature-check-icon">✓</span>
                  <span>100% dynamic scope mapping matching active directories</span>
                </li>
                <li className="feature-check-item">
                  <span className="feature-check-icon">✓</span>
                  <span>Agentic Navigation translating user intent to app routes</span>
                </li>
              </ul>
              <Link to="/login" className="btn-primary">Query RAG Console</Link>
            </ScrollReveal>
          </div>

          <div className="feature-ui-panel">
            <ScrollReveal>
              <div className="glass-mockup">
                {/* Mockup Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--accent-primary)' }}>RAG CONSOLE</span>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>Location: /case/101</span>
                </div>
                {/* Mockup Prompt */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11.5px' }}>
                  <div style={{ color: 'var(--text-muted)' }}>Query: "go to contract analyzer"</div>
                  <div style={{ background: 'rgba(16, 185, 129, 0.08)', color: 'var(--accent-success)', padding: '8px 12px', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                    ✓ Agentic Routing: Redirecting client viewpoint to <code>/contract-analyzer</code>...
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

      </div>

      {/* Security & Compliance Section */}
      <section className="security-compliance-section">
        <ScrollReveal>
          <h2 className="section-title">Authoritative Security Architecture</h2>
          <p className="section-subtitle" style={{ marginBottom: 0 }}>Built to comply with data sovereignty regulations under Indian Law.</p>
        </ScrollReveal>

        <div className="security-grid">
          <div className="security-item">
            <ScrollReveal>
              <div style={{ fontSize: '24px', marginBottom: '12px' }}>🔒</div>
              <h3 className="security-h3">Military-Grade Encryption</h3>
              <p className="security-p">All client briefs, plaints, and contracts are encrypted in transit and at rest using AES-256 standards.</p>
            </ScrollReveal>
          </div>

          <div className="security-item">
            <ScrollReveal>
              <div style={{ fontSize: '24px', marginBottom: '12px' }}>🇮🇳</div>
              <h3 className="security-h3">Data Sovereignty - Indian Law</h3>
              <p className="security-p">Vector indexes and raw documents reside strictly on sovereign cloud nodes within the territorial borders of India.</p>
            </ScrollReveal>
          </div>

          <div className="security-item">
            <ScrollReveal>
              <div style={{ fontSize: '24px', marginBottom: '12px' }}> W</div>
              <h3 className="security-h3">Zero Retention</h3>
              <p className="security-p">Document processing vectors do not train base foundational LLMs. All data remains exclusively yours.</p>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border-subtle)', padding: '40px 24px', backgroundColor: 'var(--bg-sidebar)' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
          <div>© 2026 LexAmplify India Software Solutions. All rights reserved.</div>
          <div style={{ display: 'flex', gap: '20px' }}>
            <Link to="/login" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Advocate Console</Link>
            <span style={{ color: 'var(--border-subtle)' }}>|</span>
            <span style={{ cursor: 'help' }}>India Kanoon Citations Compliant</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
