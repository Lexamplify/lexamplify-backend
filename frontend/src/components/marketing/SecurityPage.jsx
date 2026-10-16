import React from 'react';
import { Link } from 'react-router-dom';
import MarketingLayout, { Icon, CONTACT_EMAIL } from './MarketingLayout';

/* Only describe protections that exist in the product. Anything about hosting
   region, retention or certifications is deliberately NOT claimed here until
   it can be stated precisely - see the "ask us" panel at the bottom. */
const ITEMS = [
  {
    icon: 'lock',
    t: 'Sessions you can trust',
    p: 'Sign-in sessions live in secure, HttpOnly cookies that scripts on a page cannot read, and every change request is protected against cross-site forgery.',
  },
  {
    icon: 'phone',
    t: 'Mobile number verification',
    p: 'Where enabled, new accounts confirm their mobile number with a one-time code, and you can sign in with a code instead of a password. Codes expire in five minutes, work once, and lock after repeated wrong guesses.',
  },
  {
    icon: 'shield',
    t: 'Two-step sign-in',
    p: 'Turn on an authenticator app for an extra step at sign-in. Recovery codes are provided in case you lose your device.',
  },
  {
    icon: 'mail',
    t: 'Careful password recovery',
    p: 'Reset links expire after an hour, work only once, and always point to LexAmplify. We never reveal whether an email or number has an account.',
  },
  {
    icon: 'users',
    t: 'Limits on abuse',
    p: 'Sign-in, sign-up and code requests are rate limited to slow down guessing and automated attacks.',
  },
  {
    icon: 'folder',
    t: 'Your work stays yours',
    p: 'Documents are used to deliver the features you ask for.',
  },
];

export default function SecurityPage() {
  return (
    <MarketingLayout
      title="Security · LexAmplify"
      description="How LexAmplify protects accounts and client documents: secure sessions, mobile OTP verification, two-step sign-in and careful password recovery."
    >
      <section className="page-hero">
        <div className="wrap" style={{ position: 'relative' }}>
          <p className="eyebrow">Security</p>
          <h1>Client confidences deserve <em>careful</em> engineering.</h1>
          <p className="lede">Here is what protects your account today, described plainly. We would rather tell you exactly what exists than make large promises.</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 'clamp(24px, 4vw, 48px)' }}>
        <div className="wrap">
          <h2 className="sr-only">How accounts are protected</h2>
          <div className="grid grid--3">
            {ITEMS.map((it, i) => (
              <article className="card reveal" key={it.t} style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                <span className="card__icon"><Icon name={it.icon} size={22} /></span>
                <h3>{it.t}</h3>
                <p>{it.p}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--tint">
        <div className="wrap">
          <div className="split reveal">
            <div>
              <p className="eyebrow">Questions from your team?</p>
              <h2>Ask us for the details your IT or partners need.</h2>
              <p className="lede">If you need specifics on hosting, data retention or how documents are processed before you roll LexAmplify out, write to us and we will answer in writing.</p>
              <div className="btn-row" style={{ marginTop: 28 }}>
                <a href={`mailto:${CONTACT_EMAIL}?subject=Security%20questions`} className="btn btn--primary">Email us <Icon name="arrow" size={18} /></a>
                <Link to="/login?mode=register" className="btn btn--ghost">Create account</Link>
              </div>
            </div>
            <div className="card" style={{ background: 'var(--card)' }}>
              <h3 style={{ marginBottom: 14 }}>You can help protect your account</h3>
              <ul className="ticks" style={{ marginTop: 0 }}>
                <li><Icon name="check" size={18} />Use a long, unique password that you use nowhere else</li>
                <li><Icon name="check" size={18} />Switch on two-step sign-in with an authenticator app</li>
                <li><Icon name="check" size={18} />Never share a one-time code. LexAmplify will never ask for it</li>
                <li><Icon name="check" size={18} />Sign out on shared computers</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
