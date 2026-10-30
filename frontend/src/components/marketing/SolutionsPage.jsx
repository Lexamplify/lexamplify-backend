import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout, { Icon, CONTACT_EMAIL } from './MarketingLayout';
import { DraftApp, ReviewApp, ConflictApp, CalendarApp } from './Product';

const SECTIONS = [
  {
    id: 'drafting',
    eyebrow: 'Litigation & drafting',
    title: <>Drafts that ask before they <em>write</em>.</>,
    lede: 'A legal notice with invented names is worse than none. LexAmplify begins with the matter, asks for what the document needs, and only then drafts.',
    points: [
      'Start from a case or an uploaded file, or enter the details yourself',
      'Questions for parties, dates, amounts and relief before anything is generated',
      'Notices, petitions, applications, agreements and letters from a growing template library',
      'Edit in a full document editor, then export the finished draft',
    ],
    shot: <DraftApp />,
    who: 'Litigators, chambers and in-house counsel',
  },
  {
    id: 'contracts',
    eyebrow: 'Contracts & review',
    title: <>Read every clause. <em>Miss</em> nothing.</>,
    lede: 'Upload an agreement and get a clause-by-clause review: what is risky, what is missing, and a rewrite you can accept or change.',
    points: [
      'Risk flags with a plain-language explanation for each clause',
      'Missing standard clauses suggested for insertion',
      'Review against your own playbook, or against Indian statutory standards',
      'Ask questions of the contract and see the clause behind every answer',
    ],
    shot: <ReviewApp />,
    who: 'Corporate and commercial teams, solo advocates reviewing client contracts',
  },
  {
    id: 'firms',
    eyebrow: 'Firms & teams',
    title: <>One firm, <em>one</em> source of truth.</>,
    lede: 'Check conflicts across every matter, compare documents for contradictions, and keep the clearance on record with the file.',
    points: [
      'Conflict check on parties, related parties and counsel across all matters',
      'Cross-document comparison to surface contradictions between agreements',
      'Organisation, team and matter workspaces so people see what they should',
      'Saved clearance memos attached to the matter',
    ],
    shot: <ConflictApp />,
    who: 'Law firms and multi-advocate chambers',
  },
  {
    id: 'chambers',
    eyebrow: 'Daily practice',
    title: <>Every matter, document and date in <em>one</em> place.</>,
    lede: 'A workspace for the unglamorous part of the job: finding the right file, knowing what is due, and not missing a limitation date.',
    points: [
      'Case Vault and Document Hub for thousands of documents, with review queues',
      'Calendar for hearings, replies and limitation dates',
      'Cause lists and court resources in one place',
      'Send any document straight into drafting, review or a conflict check',
    ],
    shot: <CalendarApp />,
    who: 'Solo advocates and small chambers',
  },
];

export default function SolutionsPage() {
  return (
    <MarketingLayout
      title="Solutions · LexAmplify"
      description="How LexAmplify supports litigation drafting, contract review, conflict checks and day-to-day practice for Indian advocates and firms."
    >
      <section className="page-hero">
        <div className="wrap" style={{ position: 'relative' }}>
          <p className="eyebrow">Solutions</p>
          <h1>Built around how <em>chambers</em> really work.</h1>
          <p className="lede">Pick the part of your practice you want to improve first. Each workflow stands on its own and works with the rest.</p>
          <nav className="anchor-nav" aria-label="Solutions on this page">
            {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`}>{s.eyebrow}</a>)}
          </nav>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 'clamp(24px, 4vw, 48px)' }}>
        <div className="wrap">
          {SECTIONS.map((s, i) => (
            <div className="sol" id={s.id} key={s.id}>
              <div className={`split reveal${i % 2 ? ' split--flip' : ''}`}>
                <div>
                  <p className="eyebrow">{s.eyebrow}</p>
                  <h2>{s.title}</h2>
                  <p className="lede">{s.lede}</p>
                  <ul className="ticks">
                    {s.points.map((p) => <li key={p}><Icon name="check" size={18} />{p}</li>)}
                  </ul>
                  <p style={{ marginTop: 24, fontSize: 14.5, color: 'var(--muted)' }}><strong style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>Best for:</strong> {s.who}</p>
                </div>
                <div className="split__view">{s.shot}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section section--slate">
        <div className="wrap cta" style={{ padding: 0 }}>
          <h2>Not sure where to begin?</h2>
          <p>Start with drafting or contract review. They are the quickest way to see the difference on your own work.</p>
          <div className="btn-row">
            <Link to="/login?mode=register" className="btn btn--light">Create your account <Icon name="arrow" size={18} /></Link>
            <a href={`mailto:${CONTACT_EMAIL}?subject=LexAmplify%20walkthrough`} className="btn btn--outline-light">Talk to us</a>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
