import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar, FAQSection, FinalCTA, Footer, AmbientMotion } from './Landing.jsx';

/*
 * /faq — standalone FAQ page.
 * Hero with a stacked "question mark" dots motif + the full FAQ accordion + CTA.
 */
export default function FaqPage() {
  useEffect(() => {
    document.title = 'FAQ — Lexamplify';
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);
  return (
    <div className="lx-landing">
      <Navbar />
      <main>
        <section className="lx-pagehero lx-pagehero--faq">
          <AmbientMotion count={3} seed="faq" />
          <div className="lx-pagehero__inner">
            <span className="ph__eyebrow">Frequently asked</span>
            <h1 className="lx-pagehero__h">
              What advocates <em>ask first</em>.
            </h1>
            <p className="lx-pagehero__sub">
              The honest answers — on authorship, hallucinations, security, Indian data
              residency, and how a whole firm uses it. Something else? We read every email.
            </p>
            <div className="lx-pagehero__cta">
              <a href="mailto:hello@lexamplify.in" className="lx-btn lx-btn--primary">Write to us</a>
              <Link to="/features" className="lx-btn lx-btn--ghost">See what it does →</Link>
            </div>
            {/* Motion motif: a question-mark stroke that draws on load */}
            <svg className="lx-pagehero__motif lx-pagehero__motif--qmark" viewBox="0 0 120 160" aria-hidden="true">
              <path d="M 30 55 Q 30 25, 60 25 Q 90 25, 90 55 Q 90 75, 70 85 Q 60 90, 60 110"
                    fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" />
              <circle cx="60" cy="135" r="5" fill="var(--accent)" />
            </svg>
          </div>
        </section>

        <FAQSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
