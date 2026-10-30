import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import FeatureShowcase from './FeatureShowcase.jsx';
import HeroFilm from './HeroFilm.jsx';

/*
 * Public landing page shown to unauthenticated visitors at `/`.
 * Reuses the editorial copy and section structure of the old marketing
 * suite but is rewritten against our luxury-system.css tokens — ink / paper /
 * accent (gold) / rule / --font-serif / lx-* classes. No tailwind, no old
 * marketing/*.jsx components.
 */

const CONTACT_EMAIL = 'hello@lexamplify.in';

const MODULES = [
  { num: '01', title: 'Draft', body: 'Court-ready notices, replies, affidavits, bail applications and plaints — grounded in Indian law, correct in form.' },
  { num: '02', title: 'Contract review', body: 'Spot risk clauses, missing protections and non-standard language in minutes. Every finding is traceable to a line in the file.' },
  { num: '03', title: 'Virtual courtroom', body: 'Rehearse the hearing. The bench presses back on your facts. Opposing counsel is drafted automatically.' },
  { num: '04', title: 'Case vault', body: 'Every file your chambers has ever touched — searchable inside the pages, filed by type, shareable one person at a time.' },
  { num: '05', title: 'Conflict engine', body: 'Clear the parties before you take the matter. Scan the papers for contradictions before you sign.' },
  { num: '06', title: 'Practice management', body: 'Clients, matters, hearings, team roles, audit trail. One screen, your whole firm.' },
];

const STEPS = [
  { num: '01', title: 'Open a matter', body: 'Add the client, the court, the case number. The system takes it from there.' },
  { num: '02', title: 'Hand over the facts', body: 'Paste the brief, upload the FIR, attach the contract. We read every page.' },
  { num: '03', title: 'Draft, review, rehearse', body: 'The tool prepares. The advocate signs. Nothing leaves your hands without you.' },
];

const FAQ = [
  ['Does LexAmplify replace the advocate?', 'No. It prepares drafts and reviews for an advocate to read, change and sign. Nothing leaves your hands without you.'],
  ['Will it invent names, dates or amounts?', 'It drafts from your matter file and what you enter. Anything it cannot find, it asks you for. Skipped answers stay visibly bracketed in the draft so nothing can slip through.'],
  ['How do we sign in?', 'With email and password, or with Google. Mobile one-time codes are being switched on; authenticator-app two-step sign-in is available today.'],
  ['Can a whole firm use it?', 'Yes. Organisation, team and matter workspaces, so people see only what they should and conflicts are checked across the firm.'],
  ['Is my data secure?', 'HttpOnly cookies, CSRF protection, authenticator-app 2FA, careful password reset with single-use links, and audit logs on every change.'],
  ['Where is our data kept?', 'In India. Ask us for the detailed data-handling note before you roll anything out — we send it in writing.'],
];

function useInView(threshold = 0.2) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setInView(true); return undefined; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setInView(true); io.disconnect(); }
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView];
}

export function Navbar() {
  return (
    <header className="lx-landing-nav">
      <div className="lx-landing-nav__inner">
        <Link to="/" className="lx-landing-brand">
          <span className="lx-landing-brand__mark">L</span>
          <span className="lx-landing-brand__word">Lexamplify</span>
        </Link>
        <nav className="lx-landing-nav__links" aria-label="Primary">
          <Link to="/features">What it does</Link>
          <Link to="/how">How it works</Link>
          <Link to="/faq">FAQ</Link>
        </nav>
        <div className="lx-landing-nav__cta">
          <Link to="/login" className="lx-btn lx-btn--ghost lx-btn--sm">Sign in</Link>
          <Link to="/signup" className="lx-btn lx-btn--gold lx-btn--sm">Start free</Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="lx-hero lx-hero--split">
      <AmbientMotion count={3} seed="hero" />
      <div className="lx-hero__grid">
        <div className="lx-hero__col">
          <span className="ph__eyebrow">For Indian advocates &amp; legal teams</span>
          <h1 className="lx-hero__title lx-hero__title--l">
            The brief,<br />prepared.<br />
            The signature, <em>yours</em>.
          </h1>
          <p className="lx-hero__sub lx-hero__sub--l">
            Lexamplify drafts from your case file, reviews contracts against Indian law,
            and keeps every matter in order. Built for chambers that take their work
            seriously — and the people they represent.
          </p>
          <div className="lx-hero__cta lx-hero__cta--l">
            <Link to="/signup" className="lx-btn lx-btn--gold">
              <Ic.Sparkle size={15} /> Start free
            </Link>
            <Link to="/login" className="lx-btn lx-btn--ghost">
              I already have an account
            </Link>
          </div>
          <div className="lx-hero__trust lx-hero__trust--l">
            <span>Hosted in India</span>
            <span className="dot" />
            <span>Advocate-signed, not AI-signed</span>
            <span className="dot" />
            <span>Audit trail on every change</span>
          </div>
        </div>
        <div className="lx-hero__col lx-hero__col--right">
          <HeroFilm />
        </div>
      </div>
    </section>
  );
}

function Manifesto() {
  const [ref, inView] = useInView(0.25);
  return (
    <section ref={ref} className="lx-manifesto">
      <AmbientMotion count={2} seed="man" />
      <div className="lx-manifesto__inner">
        <span className="ph__eyebrow">§ 01.5 · The principle</span>
        <h2 className={`lx-manifesto__h ${inView ? 'is-in' : ''}`}>
          The advocate <em>signs</em>. The tool does <em className="muted">not</em>.
        </h2>
        <p className="lx-manifesto__sub">
          Lexamplify prepares the brief. Finds the citations. Flags the risk. Keeps the file in order.
          Everything beyond that is yours — your judgment, your voice, your signature on the page.
        </p>
      </div>
    </section>
  );
}

export function Modules() {
  return (
    <section id="modules" className="lx-section">
      <div className="lx-section__inner">
        <div className="lx-section__head">
          <span className="ph__eyebrow">§ 02 · What it does</span>
          <h2 className="lx-section__h">Six tools, one practice.</h2>
        </div>
        <div className="lx-modules">
          {MODULES.map((m) => (
            <article className="lx-module" key={m.num}>
              <div className="lx-module__num">{m.num}</div>
              <div className="lx-module__title">{m.title}</div>
              <p className="lx-module__body">{m.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── §03 How it works — scrubbed timeline ─────────────────
   Scroll progress through the section drives the gold line that
   connects step 1 → 2 → 3, and each step node fills+scales when
   its scroll point is reached. */
export function HowItWorks() {
  const sectionRef = useRef(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // progress goes 0 → 1 as the section crosses the viewport
      const p = Math.max(0, Math.min(1, 1 - (rect.top - vh * 0.1) / (rect.height + vh * 0.6)));
      setProgress(p);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const stepProgress = (i) => Math.max(0, Math.min(1, (progress - i * 0.25) / 0.3));

  return (
    <section ref={sectionRef} id="how" className="lx-section lx-section--alt lx-how">
      <AmbientMotion count={3} seed="how" />
      <div className="lx-section__inner">
        <div className="lx-section__head">
          <span className="ph__eyebrow">§ 03 · How it works</span>
          <h2 className="lx-section__h">Three steps. Your first draft in <em>minutes</em>.</h2>
        </div>

        {/* Scrubbed timeline — line draws as you scroll */}
        <div className="lx-how__timeline" aria-hidden="true">
          <div className="lx-how__spine" />
          <div className="lx-how__fill" style={{ width: `${Math.min(progress * 110, 100)}%` }} />
          {STEPS.map((_, i) => (
            <div key={i} className={`lx-how__node ${stepProgress(i) > 0.5 ? 'is-on' : ''}`} style={{ left: `${16 + i * 34}%` }}>
              <span>{i + 1}</span>
            </div>
          ))}
        </div>

        <div className="lx-steps lx-steps--motion">
          {STEPS.map((s, i) => {
            const sp = stepProgress(i);
            return (
              <div className="lx-step lx-step--motion" key={s.num}
                   style={{ opacity: 0.3 + sp * 0.7, transform: `translateY(${(1 - sp) * 20}px) scale(${0.98 + sp * 0.02})` }}>
                <div className="lx-step__num">{s.num}</div>
                <div className="lx-step__title">{s.title}</div>
                <p className="lx-step__body">{s.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── §04 Built for Indian practice — stroke-draw underlines ─ */
export function BuiltForIndia() {
  const [ref, inView] = useInView(0.25);
  const forums = [
    { t: 'Supreme Court', s: 'SLP · Writ · Review', icon: 'SC' },
    { t: 'High Courts', s: 'Civil · Criminal · Writ', icon: 'HC' },
    { t: 'District Courts', s: 'Suits · Bail · Appeals', icon: 'DC' },
    { t: 'Tribunals', s: 'NCLT · NCDRC · DRT · ITAT', icon: 'TR' },
  ];
  return (
    <section ref={ref} className="lx-india">
      <AmbientMotion count={4} seed="india" />
      <div className="lx-india__inner">
        <span className="ph__eyebrow">§ 04 · Built for Indian practice</span>
        <h2 className="lx-india__h">
          IPC, BNS, CrPC, BNSS, Contract Act, Evidence Act, Arbitration Act —
          <em> cited correctly</em>, in the forms your registry actually accepts.
        </h2>
        <div className="lx-india__grid">
          {forums.map((f, i) => (
            <div className={`lx-forum ${inView ? 'is-in' : ''}`} key={f.t} style={{ transitionDelay: `${i * 140}ms` }}>
              <div className="lx-forum__icon">{f.icon}</div>
              <strong>{f.t}</strong>
              <span>{f.s}</span>
              <svg className="lx-forum__stroke" viewBox="0 0 100 6" preserveAspectRatio="none">
                <path d="M 2 3 Q 50 1, 98 3" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" style={{ animationDelay: `${400 + i * 140}ms` }} />
              </svg>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingTeaser() {
  const [ref, inView] = useInView(0.2);
  return (
    <section ref={ref} className="lx-section lx-pricing-sec">
      <AmbientMotion count={3} seed="pricing" />
      <div className="lx-section__inner">
        <div className="lx-section__head">
          <span className="ph__eyebrow">§ 05 · Pricing</span>
          <h2 className="lx-section__h">Start free. Scale when you&apos;re ready.</h2>
        </div>
        <div className={`lx-pricing lx-pricing--motion ${inView ? 'is-in' : ''}`}>
          <div className="lx-plan">
            <div className="lx-plan__name">Solo</div>
            <div className="lx-plan__price">Free<span>/ advocate</span></div>
            <ul>
              <li>Up to 10 active matters</li>
              <li>All drafting + review tools</li>
              <li>50 AI drafts / month</li>
            </ul>
            <Link to="/signup" className="lx-btn lx-btn--ghost">Create account</Link>
          </div>
          <div className="lx-plan lx-plan--featured">
            <div className="lx-plan__badge">Most firms pick this</div>
            <div className="lx-plan__name">Chambers</div>
            <div className="lx-plan__price">₹2,499<span>/ advocate / month</span></div>
            <ul>
              <li>Unlimited matters &amp; clients</li>
              <li>Team workspaces, roles, audit log</li>
              <li>Unlimited AI drafts, cite-verify, priority support</li>
            </ul>
            <Link to="/signup" className="lx-btn lx-btn--gold">Start 14-day trial</Link>
          </div>
          <div className="lx-plan">
            <div className="lx-plan__name">Firm</div>
            <div className="lx-plan__price">Let's talk</div>
            <ul>
              <li>SSO, on-prem option, custom retention</li>
              <li>Private vector index for your library</li>
              <li>Named support engineer</li>
            </ul>
            <a href={`mailto:${CONTACT_EMAIL}?subject=LexAmplify%20Firm`} className="lx-btn lx-btn--ghost">Contact sales</a>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FAQSection() {
  const [open, setOpen] = useState(0);
  const [ref, inView] = useInView(0.15);
  return (
    <section ref={ref} id="faq" className="lx-section lx-section--alt lx-faq-sec">
      <AmbientMotion count={2} seed="faq" />
      <div className="lx-section__inner lx-faq">
        <div className="lx-faq__left">
          <span className="ph__eyebrow">§ 06 · Questions</span>
          <h2 className={`lx-section__h ${inView ? 'is-in' : ''}`}>What advocates <em>ask first</em>.</h2>
          <p className="lx-faq__contact">
            Something else?{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>Write to us</a>
            {' '}— we read every email ourselves.
          </p>
          {/* Little animated stamp — editorial accent */}
          <div className="lx-faq__stamp" aria-hidden="true">
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="4 4" />
              <circle cx="60" cy="60" r="44" fill="none" stroke="var(--accent)" strokeWidth="0.5" />
              <text x="60" y="56" textAnchor="middle" fontFamily="var(--font-serif)" fontSize="12" fill="var(--accent-ink)" fontWeight="600">LEXAMPLIFY</text>
              <text x="60" y="72" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7" letterSpacing="2" fill="var(--accent-ink)">· VERIFIED ·</text>
            </svg>
          </div>
        </div>
        <div className="lx-faq__list">
          {FAQ.map(([q, a], i) => (
            <div className={`lx-faq__item ${open === i ? 'is-open' : ''}`} key={q}>
              <button type="button" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                <span className="lx-faq__num">{String(i + 1).padStart(2, '0')}</span>
                <span className="lx-faq__q">{q}</span>
                <span className="lx-faq__chev">{open === i ? '−' : '+'}</span>
              </button>
              <div className="lx-faq__a"><p>{a}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCTA() {
  const [ref, inView] = useInView(0.25);
  return (
    <section ref={ref} className="lx-finalcta">
      {/* Drifting ember particles */}
      <div className="lx-finalcta__particles" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => (
          <span key={i} style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${i * 420}ms`,
            animationDuration: `${8 + (i % 7)}s`,
          }} />
        ))}
      </div>
      <div className="lx-finalcta__inner">
        <span className="ph__eyebrow">§ 07 · Begin</span>
        <h2 className="lx-finalcta__h">Open the workspace.</h2>
        {/* Signature stroke that draws under the headline when in view */}
        <svg className={`lx-finalcta__sig ${inView ? 'is-in' : ''}`} viewBox="0 0 800 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M 20 40 Q 180 10, 320 36 T 620 32 Q 720 20, 780 36" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
          <circle cx="780" cy="36" r="4" fill="var(--accent)" />
        </svg>
        <p className="lx-finalcta__sub">
          A free account, a real matter, your first draft on screen in under five minutes.
        </p>
        <div className="lx-finalcta__cta">
          <Link to="/signup" className="lx-btn lx-btn--gold">
            Create your account <Ic.Arrow size={14} />
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}?subject=LexAmplify%20walkthrough`} className="lx-finalcta__link">
            Request a walkthrough →
          </a>
        </div>
        <p className="lx-finalcta__foot">Made in India · For Indian advocates</p>
      </div>
    </section>
  );
}

/* Ambient background — slow-drifting ink orbs behind a section.
   Pure CSS keyframes, no mouse tracking, no JS updates. */
export function AmbientMotion({ count = 3, seed = 'a' }) {
  return (
    <div className="ambient" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className={`ambient__orb ambient__orb--${seed}-${i}`} />
      ))}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="lx-landing-foot">
      <div className="lx-landing-foot__inner">
        <div className="lx-landing-brand">
          <span className="lx-landing-brand__mark">L</span>
          <span className="lx-landing-brand__word">Lexamplify</span>
        </div>
        <nav className="lx-landing-foot__links">
          <Link to="/features">What it does</Link>
          <Link to="/how">How it works</Link>
          <Link to="/faq">FAQ</Link>
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        </nav>
        <div className="lx-landing-foot__meta">© {new Date().getFullYear()} Lexamplify · Hosted in India</div>
      </div>
    </footer>
  );
}

export default function Landing() {
  useEffect(() => {
    document.title = 'Lexamplify — Drafting, contract review and case work for Indian advocates';
  }, []);
  return (
    <div className="lx-landing">
      <Navbar />
      <main>
        <Hero />
        <Manifesto />
        <FeatureShowcase />
        <HowItWorks />
        <BuiltForIndia />
        <PricingTeaser />
        <FAQSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
