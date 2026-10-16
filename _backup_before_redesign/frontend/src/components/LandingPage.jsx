import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout, { Icon, CONTACT_EMAIL } from './marketing/MarketingLayout';
import { DraftShot, AnalyzerShot, ConflictShot } from './marketing/Shots';

const WORKFLOWS = [
  {
    icon: 'file',
    title: 'Draft from your case file',
    text: 'Pick the matter and answer a few questions. LexAmplify drafts notices, petitions and agreements from your file, and asks for what is missing instead of making it up.',
    to: '/solutions#drafting',
    cta: 'How drafting works',
  },
  {
    icon: 'scan',
    title: 'Review contracts in minutes',
    text: 'Upload an agreement and see risky clauses, missing protections and a suggested rewrite for each, checked against Indian law and your own playbook.',
    to: '/solutions#contracts',
    cta: 'How contract review works',
  },
  {
    icon: 'scale',
    title: 'Check conflicts before you accept',
    text: 'Run new parties against every matter your firm holds, and see overlaps before the engagement letter goes out.',
    to: '/solutions#firms',
    cta: 'How conflict checks work',
  },
];

const STEPS = [
  { n: '01', t: 'Choose the matter', p: 'Start from a case, or upload the file you already have. Nothing is drafted from thin air.' },
  { n: '02', t: 'Answer a few questions', p: 'LexAmplify asks for the parties, dates, amounts and relief it needs, and fills in what it can from your documents.' },
  { n: '03', t: 'Review, edit and export', p: 'Read the draft beside its sources, change anything, and export a clean document when it is ready.' },
];

const PRINCIPLES = [
  { t: 'Grounded in your documents', p: 'Drafts and answers come from the matter and files you point to. When something is missing, it asks you rather than guessing.' },
  { t: 'You stay in control', p: 'Every clause, citation and date is editable. LexAmplify proposes; the advocate decides and signs.' },
  { t: 'Built around Indian practice', p: 'Limitation periods, court formats, the Indian Contract Act and the way chambers actually keep their files.' },
];

export default function LandingPage() {
  return (
    <MarketingLayout
      title="LexAmplify · Drafting, contract review and case work for Indian advocates"
      description="LexAmplify drafts from your case file, reviews contracts against Indian law and keeps every matter organised. Built for Indian advocates and legal teams."
    >
      {/* ─── Hero ─── */}
      <section className="hero">
        <div className="wrap hero__grid">
          <div>
            <p className="eyebrow">For Indian advocates and legal teams</p>
            <h1>Legal work that starts from <em>your file</em>, not a blank page.</h1>
            <p className="lede">
              LexAmplify drafts notices and agreements from your case documents, reviews contracts against Indian law,
              and keeps every matter, deadline and document in one calm workspace.
            </p>
            <div className="btn-row">
              <Link to="/login?mode=register" className="btn btn--primary">
                Create your account <Icon name="arrow" size={18} />
              </Link>
              <a href="#how-it-works" className="btn btn--ghost">See how it works</a>
            </div>
            <p className="hero__note">
              <span><Icon name="check" size={16} />Sign in with email, Google or your mobile number</span>
              <span><Icon name="check" size={16} />Made for Indian courts and contracts</span>
            </p>
          </div>

          <div className="hero__shot">
            <DraftShot />
            <div className="float-card" aria-hidden="true">
              <span className="ico"><Icon name="spark" size={18} /></span>
              <div><b>Asks before it drafts</b><span>Matter, parties, amount, relief</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Core workflows ─── */}
      <section className="section section--tint" id="workflows">
        <div className="wrap">
          <div className="section-head reveal">
            <p className="eyebrow">What you can do</p>
            <h2>Three jobs, done end to end.</h2>
            <p className="lede">Most days in chambers come down to drafting, reviewing and clearing. LexAmplify does each one properly before it tries to do anything else.</p>
          </div>
          <div className="grid grid--3">
            {WORKFLOWS.map((w, i) => (
              <article className="card reveal" key={w.title} style={{ transitionDelay: `${i * 70}ms` }}>
                <span className="card__icon"><Icon name={w.icon} size={22} /></span>
                <h3>{w.title}</h3>
                <p>{w.text}</p>
                <Link to={w.to} className="link-arrow">{w.cta} <Icon name="arrow" size={16} /></Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section className="section" id="how-it-works">
        <div className="wrap">
          <div className="section-head reveal">
            <p className="eyebrow">How it works</p>
            <h2>From file to finished document in three steps.</h2>
          </div>
          <div className="flow">
            {STEPS.map((s, i) => (
              <div className="flow__step reveal" key={s.n} style={{ transitionDelay: `${i * 80}ms` }}>
                <span className="flow__n">{s.n}</span>
                <h3>{s.t}</h3>
                <p>{s.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Feature detail ─── */}
      <section className="section section--tint">
        <div className="wrap">
          <div className="split reveal">
            <div>
              <p className="eyebrow">Contract review</p>
              <h2>Know what is risky <em>before</em> you sign.</h2>
              <p className="lede">Every clause is read, flagged and explained in plain language, with a suggested rewrite you can accept, edit or discard.</p>
              <ul className="ticks">
                <li><Icon name="check" size={18} />Risk and missing-clause detection against Indian law</li>
                <li><Icon name="check" size={18} />Apply your firm’s own playbook as the standard</li>
                <li><Icon name="check" size={18} />Ask questions of the contract and see the clause behind each answer</li>
              </ul>
              <div style={{ marginTop: 28 }}><Link to="/solutions#contracts" className="link-arrow">Contract review in detail <Icon name="arrow" size={16} /></Link></div>
            </div>
            <AnalyzerShot />
          </div>

          <div className="split split--flip reveal">
            <div>
              <p className="eyebrow">Conflict checks</p>
              <h2>Clear every new engagement with confidence.</h2>
              <p className="lede">Check parties against the whole firm’s matters in seconds and keep a record of the clearance.</p>
              <ul className="ticks">
                <li><Icon name="check" size={18} />Cross-matter overlap on parties, related parties and counsel</li>
                <li><Icon name="check" size={18} />Compare documents against each other for contradictions</li>
                <li><Icon name="check" size={18} />Save the clearance memo with the matter</li>
              </ul>
            </div>
            <ConflictShot />
          </div>
        </div>
      </section>

      {/* ─── Principles ─── */}
      <section className="section section--slate" id="principles">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Our approach</p>
            <h2>Careful by design, because the work is.</h2>
            <p className="lede">A draft that looks right but is wrong is worse than no draft. These are the rules the product is built around.</p>
          </div>
          <div className="grid grid--3" style={{ gap: 32 }}>
            {PRINCIPLES.map((p) => (
              <div className="principle" key={p.t}>
                <h3>{p.t}</h3>
                <p>{p.p}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 36 }}>
            <Link to="/security" className="link-arrow" style={{ color: '#F0B9A4' }}>How we protect your account and documents <Icon name="arrow" size={16} /></Link>
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="section section--slate" style={{ paddingTop: 0 }}>
        <div className="wrap cta" style={{ borderTop: '1px solid rgba(255,255,255,.12)' }}>
          <h2>Try it on a real matter this week.</h2>
          <p>Create an account in a minute with your email or mobile number. Want a walkthrough instead? Write to us and we will set one up.</p>
          <div className="btn-row">
            <Link to="/login?mode=register" className="btn btn--light">Create your account <Icon name="arrow" size={18} /></Link>
            <a href={`mailto:${CONTACT_EMAIL}?subject=LexAmplify%20walkthrough`} className="btn btn--outline-light">Request a walkthrough</a>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
