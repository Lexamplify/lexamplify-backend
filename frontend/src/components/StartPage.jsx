import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getFlag, listSessions, setFlag } from '../services/draftApi';

function greeting(user) {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date())) % 24;
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const raw = String((user && user.name) || '').trim().split(/\s+/)[0] || '';
  const name = raw && !raw.includes('@') ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
  return name ? `${part}, ${name}` : part;
}

function today() {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date());
}

const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

const STYLES = `
.sp { --sp-ease: cubic-bezier(.2,.7,.2,1); max-width: 1080px; margin: 0 auto; padding: clamp(32px, 6vw, 72px) clamp(16px, 4vw, 40px) 72px; color: var(--ink); }
.sp * { box-sizing: border-box; }
.sp-eyebrow { display: flex; align-items: center; gap: 12px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); flex-wrap: wrap; }
.sp-eyebrow::before { content: ''; width: 28px; height: 1px; background: var(--accent); }
.sp-hello { font-family: 'Fraunces', Georgia, serif; font-weight: 400; font-size: clamp(34px, 5.2vw, 56px); line-height: 1.04; letter-spacing: -.022em; margin: 18px 0 0; }
.sp-hello em { font-style: italic; color: var(--accent); }
.sp-lede { margin: 16px 0 0; max-width: 520px; font-size: 16px; line-height: 1.65; color: var(--ink-soft); }

.sp-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 20px; margin-top: clamp(32px, 5vw, 52px); }
.sp-stack { display: grid; grid-template-rows: 1fr 1fr; gap: 20px; }

.sp-card { position: relative; display: flex; flex-direction: column; text-decoration: none; color: inherit; background: var(--paper); border: 1px solid var(--rule); border-radius: 18px; overflow: hidden; isolation: isolate;
  transition: transform .35s var(--sp-ease), border-color .25s, box-shadow .35s var(--sp-ease); animation: sp-rise .7s var(--sp-ease) both; }
.sp-card:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--accent) 55%, var(--rule)); box-shadow: 0 18px 40px -22px rgba(24,27,29,.35); }
.sp-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.sp-card:nth-child(1) { animation-delay: .05s; }
.sp-stack .sp-card:nth-child(1) { animation-delay: .15s; }
.sp-stack .sp-card:nth-child(2) { animation-delay: .25s; }

.sp-feature { padding: clamp(24px, 3vw, 36px); min-height: 440px; background: linear-gradient(160deg, var(--paper) 0%, var(--paper-2) 100%); }
.sp-tag { align-self: flex-start; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent-ink); background: var(--accent-soft); padding: 5px 10px; border-radius: 99px; }
.sp-title { font-family: 'Fraunces', Georgia, serif; font-weight: 500; letter-spacing: -.015em; margin: 16px 0 8px; font-size: clamp(26px, 3vw, 34px); line-height: 1.1; }
.sp-desc { margin: 0; max-width: 380px; font-size: 14.5px; line-height: 1.65; color: var(--ink-soft); }
.sp-go { margin-top: auto; padding-top: 22px; display: inline-flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; color: var(--accent); }
.sp-go span.sp-circle { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); transition: background .25s, color .25s, transform .35s var(--sp-ease); }
.sp-card:hover .sp-circle { background: var(--accent); color: var(--on-accent); transform: translateX(4px); }

/* the sheet illustration */
.sp-sheets { position: absolute; right: -26px; bottom: -78px; width: 290px; height: 330px; z-index: -1; pointer-events: none; }
.sp-sheet { position: absolute; inset: 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; box-shadow: 0 24px 50px -28px rgba(24,27,29,.45); padding: 26px 24px; transition: transform .6s var(--sp-ease); }
.sp-sheet.b2 { transform: rotate(7deg) translate(18px, 6px); opacity: .55; }
.sp-sheet.b1 { transform: rotate(3.5deg) translate(8px, 3px); opacity: .8; }
.sp-sheet.b0 { transform: rotate(-1.5deg); }
.sp-feature:hover .b0 { transform: rotate(-2.5deg) translate(-4px, -6px); }
.sp-feature:hover .b1 { transform: rotate(4.5deg) translate(12px, 2px); }
.sp-h { text-align: center; font-family: 'Fraunces', Georgia, serif; font-size: 11px; letter-spacing: .22em; color: var(--ink); margin-bottom: 14px; }
.sp-ln { height: 5px; border-radius: 3px; background: var(--rule); margin: 9px 0; }
.sp-chip { display: inline-block; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9.5px; padding: 3px 7px; border-radius: 4px; color: var(--accent); background: var(--accent-soft); border: 1px dashed color-mix(in srgb, var(--accent) 60%, transparent); margin: 6px 0; }

.sp-mini { padding: 26px; justify-content: flex-start; min-height: 210px; }
.sp-ico { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); margin-bottom: 18px; transition: background .25s, color .25s; }
.sp-mini:hover .sp-ico { background: var(--accent); color: var(--on-accent); }
.sp-mini .sp-title { font-size: 23px; margin: 0 0 6px; }
.sp-mini .sp-go { padding-top: 16px; }

.sp-resume a, .sp-all a { color: var(--ink); }
.sp-time { margin-top: 10px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.sp-resume { margin-top: 28px; padding: 18px 20px; border: 1px solid var(--rule); border-radius: 14px; background: var(--paper); }
.sp-resume h2 { margin: 0 0 10px; font-size: 12px; font-weight: 500; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.sp-resume a { display: flex; justify-content: space-between; gap: 12px; align-items: center; min-height: 44px; color: var(--ink); text-decoration: none; border-top: 1px solid var(--rule); font-size: 15px; }
.sp-resume a:first-of-type { border-top: 0; }
.sp-resume a small { color: var(--muted); white-space: nowrap; }
.sp-guide { margin-top: clamp(28px, 4vw, 44px); border: 1px solid var(--rule); border-radius: 14px; padding: 18px 20px; background: var(--paper-2); position: relative; }
.sp-guide h2 { margin: 0; font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 400; font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.sp-steps { list-style: none; margin: 14px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; counter-reset: s; }
.sp-steps li { counter-increment: s; font-size: 14px; line-height: 1.6; color: var(--ink-soft); }
.sp-steps li::before { content: counter(s, decimal-leading-zero); display: block; font-family: 'Fraunces', Georgia, serif; font-size: 26px; color: var(--accent); margin-bottom: 4px; line-height: 1; }
.sp-steps b { display: block; color: var(--ink); font-weight: 600; margin-bottom: 2px; }
.sp-guide button { position: absolute; top: 6px; right: 10px; min-height: 44px; min-width: 44px; background: none; border: 0; color: var(--ink-soft); font: inherit; font-size: 13.5px; cursor: pointer; text-decoration: underline; }
.sp-saved { margin-top: 18px; padding: 12px 16px; border: 1px solid var(--accent); border-radius: 10px; background: var(--accent-soft); font-size: 14px; }
.sp-all { margin-top: 28px; font-size: 14px; color: var(--ink-soft); }
.sp-all summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; width: fit-content; }
.sp-all div { display: flex; flex-wrap: wrap; gap: 4px 22px; padding: 6px 0 0; }
.sp-all a { color: var(--ink-soft); text-decoration: none; border-bottom: 1px solid var(--rule); min-height: 32px; display: inline-flex; align-items: center; }
.sp-all a:hover { color: var(--accent); border-color: var(--accent); }
.sp a:focus-visible, .sp button:focus-visible, .sp summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

.sp-foot { margin-top: 28px; display: flex; flex-wrap: wrap; gap: 6px 22px; font-size: 13.5px; color: var(--muted); animation: sp-rise .7s var(--sp-ease) .45s both; }
.sp-foot kbd { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; border: 1px solid var(--rule); border-radius: 5px; padding: 1px 6px; background: var(--paper); color: var(--ink-soft); }

@keyframes sp-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .sp-card, .sp-foot { animation: none; } .sp-card, .sp-sheet, .sp-circle { transition: none; } }
@media (max-width: 880px) {
  .sp-kb { display: none; }
  .sp-grid { grid-template-columns: 1fr; }
  .sp-stack { grid-template-rows: none; }
  .sp-feature { min-height: 0; padding-bottom: 150px; }
  .sp-sheets { width: 220px; height: 250px; right: -30px; bottom: -70px; }
  .sp-steps { grid-template-columns: 1fr; gap: 18px; }
  .sp-guide { padding-top: 48px; }
}
`;

const SAVED_KEY = 'lex_first_run_done';

function ago(iso) {
  if (!iso) return '';
  const t = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

export default function StartPage() {
  const { user } = useAuth();
  const location = useLocation();
  const [drafts, setDrafts] = useState([]);
  const [guideDone, setGuideDone] = useState(true);   // hidden until we know, so it never flashes at a returning user

  useEffect(() => {
    let live = true;
    let local = false;
    try { local = localStorage.getItem(SAVED_KEY) === '1'; } catch { /* storage may be blocked */ }
    getFlag('first_run_guide_done').then((v) => { if (live) setGuideDone(Boolean(v) || local); }).catch(() => { if (live) setGuideDone(local); });
    listSessions().then((rows) => { if (live) setDrafts(rows.filter((r) => r.status === 'draft').slice(0, 3)); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const dismissGuide = () => {
    setGuideDone(true);
    try { localStorage.setItem(SAVED_KEY, '1'); } catch { /* storage may be blocked */ }
    setFlag('first_run_guide_done', '1').catch(() => {});
  };

  return (
    <section className="sp" aria-labelledby="sp-hello">
      <style>{STYLES}</style>

      <div className="sp-eyebrow">{greeting(user)} · {today()}</div>
      <h1 className="sp-hello" id="sp-hello">What would you like <em>to get done?</em></h1>
      <p className="sp-lede">Choose one. Each takes you step by step to a finished document or report, using only the facts you give us.</p>

      {location.state && location.state.savedDraft && <div className="sp-saved" role="status">Saved. You can pick this draft up again below.</div>}

      <div className="sp-grid">
        <Link to="/draft" className="sp-card sp-feature">
          <span className="sp-tag">Most used</span>
          <h2 className="sp-title">Draft a document</h2>
          <p className="sp-desc">Legal notice, bail application, affidavit, agreement. Pick one of your cases or upload a file, answer a few questions, and download a properly formatted Word file. Anything we do not know stays as a highlighted blank.</p>
          <span className="sp-time">About 5 minutes</span>
          <span className="sp-go"><span>Start drafting</span><span className="sp-circle"><Arrow /></span></span>
          <div className="sp-sheets" aria-hidden="true">
            <div className="sp-sheet b2" /><div className="sp-sheet b1" />
            <div className="sp-sheet b0">
              <div className="sp-h">LEGAL NOTICE</div>
              <div className="sp-ln" style={{ width: '88%' }} /><div className="sp-ln" style={{ width: '72%' }} />
              <div className="sp-chip">[Amount claimed]</div>
              <div className="sp-ln" style={{ width: '94%' }} /><div className="sp-ln" style={{ width: '81%' }} /><div className="sp-ln" style={{ width: '60%' }} />
              <div className="sp-chip">[Days to comply]</div>
              <div className="sp-ln" style={{ width: '90%' }} />
            </div>
          </div>
        </Link>

        <div className="sp-stack">
          <Link to="/contract-analyzer" className="sp-card sp-mini">
            <span className="sp-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4" /><circle cx="11.5" cy="14" r="3" /><path d="m13.8 16.3 2.2 2.2" /></svg></span>
            <h2 className="sp-title">Analyze a contract</h2>
            <p className="sp-desc">Upload a PDF or Word contract and see its risky clauses, with the exact text quoted.</p>
            <span className="sp-time">About 3 minutes</span>
            <span className="sp-go"><span>Upload a contract</span><span className="sp-circle"><Arrow /></span></span>
          </Link>
          <Link to="/check-conflicts" className="sp-card sp-mini">
            <span className="sp-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v5c0 4.6 3.2 8.3 8 10 4.8-1.7 8-5.4 8-10V6Z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg></span>
            <h2 className="sp-title">Check conflicts</h2>
            <p className="sp-desc">Before taking a new client, check their name against your own matters.</p>
            <span className="sp-time">About 1 minute</span>
            <span className="sp-go"><span>Check a name</span><span className="sp-circle"><Arrow /></span></span>
          </Link>
        </div>
      </div>

      {drafts.length > 0 && (
        <section className="sp-resume" aria-label="Continue where you left off">
          <h2>Continue where you left off</h2>
          {drafts.map((d) => <Link key={d.id} to={`/draft/${d.id}`}><span>{d.title || 'Untitled draft'}</span><small>{ago(d.updated_at)}</small></Link>)}
        </section>
      )}

      {!guideDone && (
        <section className="sp-guide" aria-label="How it works">
          <h2>How it works</h2>
          <ol className="sp-steps">
            <li><b>Pick a task</b>Draft, analyze or check conflicts.</li>
            <li><b>Add your case or file</b>Or type the details. Unknown facts stay blank, never guessed.</li>
            <li><b>Review and download</b>Check the draft, then download Word or PDF.</li>
          </ol>
          <button type="button" onClick={dismissGuide}>Got it, hide this</button>
        </section>
      )}

      <details className="sp-all">
        <summary>All tools</summary>
        <div>
          <Link to="/workspace/matters">Matters</Link>
          <Link to="/practice">Practice (cases and hearings)</Link>
          <Link to="/document-hub">Document Hub</Link>
          <Link to="/vault">Case Vault</Link>
          <Link to="/calendar">Calendar</Link>
          <Link to="/firm-library">Firm Library</Link>
          <Link to="/court-resources">Court Resources</Link>
          <Link to="/auto-draft">Drafting studio (free writing)</Link>
          <Link to="/conflict-engine">Compare documents for discrepancies</Link>
          <Link to="/dashboard">Dashboard</Link>
        </div>
      </details>

      <div className="sp-foot">
        <span className="sp-kb">Search anything with <kbd>Ctrl</kbd> <kbd>K</kbd></span>
      </div>
    </section>
  );
}
