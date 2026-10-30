import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar, HowItWorks, FinalCTA, Footer, AmbientMotion } from './Landing.jsx';

/*
 * /how — "How it works" standalone page.
 * Hero with a slow draw-arrow motif + the scrubbed-timeline section + CTA.
 */
export default function HowPage() {
  useEffect(() => {
    document.title = 'How Lexamplify works — your first draft in minutes';
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  return (
    <div className="lx-landing">
      <Navbar />
      <main>
        <section className="lx-pagehero lx-pagehero--how">
          <AmbientMotion count={3} seed="how" />
          <div className="lx-pagehero__inner">
            <span className="ph__eyebrow">How it works</span>
            <h1 className="lx-pagehero__h">
              Open a matter. Hand over the facts. <em>Draft, review, rehearse.</em>
            </h1>
            <p className="lx-pagehero__sub">
              A disciplined three-step flow. The system prepares; the advocate signs.
              Your first court-ready draft on screen in under five minutes.
            </p>
            <div className="lx-pagehero__cta">
              <Link to="/signup" className="lx-btn lx-btn--primary">Open your first matter</Link>
              <Link to="/features" className="lx-btn lx-btn--ghost">See what it does →</Link>
            </div>
            {/* Motion motif: three ascending step markers connected by a drawing line */}
            <svg className="lx-pagehero__motif lx-pagehero__motif--arrow" viewBox="0 0 240 240" aria-hidden="true">
              <path d="M 40 190 L 90 190 L 90 130 L 150 130 L 150 70 L 210 70"
                    fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              {/* step dots */}
              <circle cx="40"  cy="190" r="12" fill="var(--paper)" stroke="var(--accent)" strokeWidth="2.4" />
              <circle cx="90"  cy="130" r="12" fill="var(--paper)" stroke="var(--accent)" strokeWidth="2.4" />
              <circle cx="150" cy="70"  r="12" fill="var(--accent)" />
              <text x="40"  y="194" textAnchor="middle" fontFamily="var(--font-serif)" fontSize="12" fill="var(--accent-ink)" fontWeight="600">1</text>
              <text x="90"  y="134" textAnchor="middle" fontFamily="var(--font-serif)" fontSize="12" fill="var(--accent-ink)" fontWeight="600">2</text>
              <text x="150" y="74"  textAnchor="middle" fontFamily="var(--font-serif)" fontSize="12" fill="#fff" fontWeight="600">3</text>
              {/* final arrow */}
              <polyline points="195,62 215,70 195,78" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </section>

        <HowItWorks />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
