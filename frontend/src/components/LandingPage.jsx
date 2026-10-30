import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout, { Icon, CONTACT_EMAIL } from './marketing/MarketingLayout';
import { DraftApp, ReviewApp, ConflictApp, CalendarApp } from './marketing/Product';

const TOUR = [
  {
    k: 'draft',
    kicker: 'Drafting',
    title: 'It asks before it writes.',
    text: 'Choose the matter. LexAmplify reads the file, shows what it found, and asks for only what is missing. Every filled-in fact shows where it came from, and gaps stay visibly blank instead of being invented.',
    bullets: ['Starts from a case, an uploaded file, or details you type in', 'Each name, date and amount is traceable to its source', 'Edit in a full editor and export when ready'],
    link: '/solutions#drafting',
    View: DraftApp,
  },
  {
    k: 'review',
    kicker: 'Contract review',
    title: 'Every clause, read and explained.',
    text: 'Upload an agreement and see what is risky, what is missing and a rewrite you can accept, edit or dismiss, with the reasoning in plain language beside each clause.',
    bullets: ['Risk and missing-clause detection against Indian law', 'Review against your own playbook as the standard', 'Ask the contract questions and see the clause behind the answer'],
    link: '/solutions#contracts',
    View: ReviewApp,
  },
  {
    k: 'conflicts',
    kicker: 'Conflict checks',
    title: 'Clear a matter before you accept it.',
    text: 'Run the parties on a new matter against everything your firm holds. See overlaps with opposing and related parties, and save the clearance with the file.',
    bullets: ['Checks parties, related parties and counsel', 'Compares documents against each other for contradictions', 'Keeps a clearance memo on the matter'],
    link: '/solutions#firms',
    View: ConflictApp,
  },
];

const RULES = [
  { n: '01', t: 'Grounded in your documents', p: 'Drafts and answers come from the matter and files you point to. When something is missing, it asks you.' },
  { n: '02', t: 'The advocate stays in charge', p: 'Every clause, citation and date can be edited. LexAmplify proposes; you decide, sign and file.' },
  { n: '03', t: 'Made for Indian practice', p: 'Limitation periods, court formats, the Indian Contract Act, and the way chambers actually keep their files.' },
];

const WORK = ['Legal notices', 'Replies to notices', 'Bail applications', 'Affidavits', 'Non-disclosure agreements', 'Service and lease agreements', 'Petitions and applications'];

const FAQ = [
  ['Does LexAmplify replace the advocate?', 'No. It prepares drafts and reviews for an advocate to read, change and sign. Nothing leaves your hands without you.'],
  ['Will it invent names, dates or amounts?', 'It drafts from your matter file and what you enter. Anything it cannot find, it asks you for. If you skip a question, the gap stays visible in the draft so it cannot slip through.'],
  ['How do we sign in?', 'With email and password or with Google. Mobile one-time codes are being switched on, and authenticator-app two-step sign-in is available too.'],
  ['Can a whole firm use it?', 'Yes. There are organisation, team and matter workspaces, so people see what they should and conflicts are checked across the firm.'],
  ['Where is our data kept, and who can see it?', 'Write to us and we will answer in writing before you roll anything out. The Security page lists what protects accounts today.'],
];

function Tour() {
  const [i, setI] = useState(0);
  const cur = TOUR[i];
  const tabsRef = useRef(null);
  const go = (n) => {
    setI(n);
    requestAnimationFrame(() => tabsRef.current?.querySelectorAll('[role=tab]')[n]?.focus());
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go((i + 1) % TOUR.length); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go((i + TOUR.length - 1) % TOUR.length); }
    if (e.key === 'Home') { e.preventDefault(); go(0); }
    if (e.key === 'End') { e.preventDefault(); go(TOUR.length - 1); }
  };
  return (
    <div className="tour">
      <div className="tour__tabs" role="tablist" aria-label="Product tour" onKeyDown={onKey} ref={tabsRef}>
        {TOUR.map((t, n) => (
          <button key={t.k} type="button" role="tab" id={`tab-${t.k}`} aria-selected={n === i} aria-controls={`panel-${t.k}`}
            tabIndex={n === i ? 0 : -1} onClick={() => setI(n)}>
            <span>{String(n + 1).padStart(2, '0')}</span>{t.kicker}
          </button>
        ))}
      </div>
      <div className="tour__grid" role="tabpanel" id={`panel-${cur.k}`} aria-labelledby={`tab-${cur.k}`} key={cur.k}>
        <div className="tour__copy">
          <h3>{cur.title}</h3>
          <p>{cur.text}</p>
          <ul className="ticks">
            {cur.bullets.map((b) => <li key={b}><Icon name="check" size={18} />{b}</li>)}
          </ul>
          <Link to={cur.link} className="link-arrow" style={{ marginTop: 26 }}>See how it works <Icon name="arrow" size={16} /></Link>
        </div>
        <div className="tour__view"><cur.View /></div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <MarketingLayout
      title="LexAmplify · Drafting, contract review and case work for Indian advocates"
      description="LexAmplify drafts from your case file, reviews contracts against Indian law and keeps every matter organised. Built for Indian advocates and legal teams."
    >
      {/* ─── Hero ─── */}
      <section className="home-hero">
        <div className="wrap home-hero__top">
          <p className="pill"><i />For Indian advocates and legal teams</p>
          <h1>Legal work that starts from <em>your file</em>.</h1>
          <p className="lede">
            Draft notices and agreements from your case documents, review contracts against Indian law, and keep every
            matter, deadline and document in one calm workspace.
          </p>
          <div className="btn-row">
            <Link to="/login?mode=register" className="btn btn--primary btn--lg">Create your account <Icon name="arrow" size={18} /></Link>
            <a href={`mailto:${CONTACT_EMAIL}?subject=LexAmplify%20walkthrough`} className="btn btn--ghost btn--lg">Request a walkthrough</a>
          </div>
          <p className="home-hero__note">Sign in with email or Google</p>
        </div>

        <div className="wrap wrap--wide home-hero__stage">
          <div className="stage__glow" aria-hidden="true" />
          <div className="stage__window"><DraftApp /></div>
        </div>
      </section>

      {/* ─── Work strip ─── */}
      <section className="strip" aria-label="Documents LexAmplify helps draft">
        <div className="wrap strip__inner">
          <p>The paperwork of everyday practice</p>
          <ul>
            {WORK.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      </section>

      {/* ─── Tour ─── */}
      <section className="section" id="how-it-works">
        <div className="wrap wrap--wide">
          <div className="section-head reveal">
            <p className="eyebrow">One workspace, three jobs</p>
            <h2>Most days in chambers come down to <em>drafting, reviewing and clearing</em>.</h2>
            <p className="lede">LexAmplify does each of them properly before it tries to do anything else.</p>
          </div>
          <div className="reveal"><Tour /></div>
        </div>
      </section>

      {/* ─── Rules ─── */}
      <section className="section section--tint">
        <div className="wrap">
          <div className="section-head reveal">
            <p className="eyebrow">How it behaves</p>
            <h2>Careful by design, because the work is.</h2>
          </div>
          <div className="rules">
            {RULES.map((r, n) => (
              <div className="rule reveal" key={r.n} style={{ transitionDelay: `${n * 80}ms` }}>
                <span className="rule__n">{r.n}</span>
                <h3>{r.t}</h3>
                <p>{r.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Daily practice ─── */}
      <section className="section">
        <div className="wrap">
          <div className="split reveal">
            <div>
              <p className="eyebrow">Daily practice</p>
              <h2>Know what is due before the registry does.</h2>
              <p className="lede">Hearings, replies and limitation dates in one view, next to the documents each one needs. Send any file straight into drafting, review or a conflict check.</p>
              <ul className="ticks">
                <li><Icon name="check" size={18} />Calendar for hearings, replies and limitation dates</li>
                <li><Icon name="check" size={18} />Cause lists and court resources in one place</li>
                <li><Icon name="check" size={18} />Case Vault and Document Hub with review queues</li>
              </ul>
              <div style={{ marginTop: 28 }}><Link to="/solutions#chambers" className="link-arrow">Daily practice in detail <Icon name="arrow" size={16} /></Link></div>
            </div>
            <div className="split__view"><CalendarApp /></div>
          </div>
        </div>
      </section>

      {/* ─── Security ─── */}
      <section className="section section--slate" id="security">
        <div className="wrap">
          <div className="sec">
            <div>
              <p className="eyebrow">Security</p>
              <h2>Client confidences deserve <em>careful</em> engineering.</h2>
              <p className="lede">Here is what protects your account today, stated plainly. For anything beyond it, ask us and we will answer in writing.</p>
              <div style={{ marginTop: 28 }}><Link to="/security" className="link-arrow" style={{ color: '#F0B9A4' }}>Read the security overview <Icon name="arrow" size={16} /></Link></div>
            </div>
            <ul className="sec__list">
              <li><Icon name="lock" size={20} /><div><b>Secure sessions</b><span>HttpOnly cookies and protection against cross-site forgery.</span></div></li>
              <li><Icon name="phone" size={20} /><div><b>Mobile verification</b><span>Where enabled: one-time codes that expire in five minutes and lock after repeated wrong guesses.</span></div></li>
              <li><Icon name="shield" size={20} /><div><b>Two-step sign-in</b><span>Authenticator app with recovery codes.</span></div></li>
              <li><Icon name="mail" size={20} /><div><b>Careful recovery</b><span>Reset links that expire, work once and never reveal who has an account.</span></div></li>
            </ul>
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="section">
        <div className="wrap">
          <div className="faq">
            <div>
              <p className="eyebrow">Questions</p>
              <h2>What advocates ask first.</h2>
              <p className="lede">Something else? <a href={`mailto:${CONTACT_EMAIL}`} className="link-arrow" style={{ display: 'inline' }}>Write to us</a>.</p>
            </div>
            <div className="faq__list">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}<Icon name="plus" size={18} /></summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="final">
        <div className="wrap final__inner">
          <h2>Try it on a real matter this week.</h2>
          <p>Create an account in a minute. Prefer a walkthrough? Write to us and we will set one up.</p>
          <div className="btn-row">
            <Link to="/login?mode=register" className="btn btn--primary btn--lg">Create your account <Icon name="arrow" size={18} /></Link>
            <a href={`mailto:${CONTACT_EMAIL}?subject=LexAmplify%20walkthrough`} className="btn btn--ghost btn--lg">Request a walkthrough</a>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
