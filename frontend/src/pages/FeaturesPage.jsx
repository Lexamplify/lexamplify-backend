import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import FeatureShowcase from './FeatureShowcase.jsx';
import { Navbar, Modules, BuiltForIndia, FinalCTA, Footer, AmbientMotion } from './Landing.jsx';

/*
 * /features — "What it does" standalone page.
 * Hero + modules + full feature showcase + built-for-India + final CTA.
 * Blue slate-pro palette, same motion vocabulary as the landing.
 */
export default function FeaturesPage() {
  useEffect(() => {
    document.title = 'What Lexamplify does — Features for Indian advocates';
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  return (
    <div className="lx-landing">
      <Navbar />
      <main>
        {/* Lightweight hero specific to this page */}
        <section className="lx-pagehero lx-pagehero--features">
          <AmbientMotion count={3} seed="hero" />
          <div className="lx-pagehero__inner">
            <span className="ph__eyebrow">What it does</span>
            <h1 className="lx-pagehero__h">
              Fourteen tools, <em>one practice</em>.
            </h1>
            <p className="lx-pagehero__sub">
              Every surface of an Indian legal chambers — drafting, review, courtroom
              rehearsal, calendar, vault, library, forms, conflict clearance — in one
              calm workspace. Each tool stands on its own; together they are the firm.
            </p>
            <div className="lx-pagehero__cta">
              <Link to="/signup" className="lx-btn lx-btn--primary">Start free</Link>
              <Link to="/how" className="lx-btn lx-btn--ghost">See how it works →</Link>
            </div>
            {/* Motion motif: concentric rotating rings, like a radar scan over the practice */}
            <div className="lx-pagehero__motif lx-pagehero__motif--rings" aria-hidden="true">
              <span className="ring ring--a" />
              <span className="ring ring--b" />
              <span className="ring ring--c" />
              <span className="ring-dot" />
            </div>
          </div>
        </section>

        <Modules />
        <FeatureShowcase />
        <BuiltForIndia />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
