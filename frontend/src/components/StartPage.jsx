import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
.sp-eyebrow { display: flex; align-items: center; gap: 12px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
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
.sp-tag { align-self: flex-start; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); background: var(--accent-soft); padding: 5px 10px; border-radius: 99px; }
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

.sp-how { margin-top: clamp(36px, 5vw, 56px); border-top: 1px solid var(--rule); padding-top: 28px; display: grid; grid-template-columns: 180px 1fr; gap: 24px; animation: sp-rise .7s var(--sp-ease) .35s both; }
.sp-how h2 { margin: 0; font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 400; font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); line-height: 1.8; }
.sp-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; counter-reset: s; }
.sp-steps li { counter-increment: s; font-size: 14px; line-height: 1.6; color: var(--ink-soft); }
.sp-steps li::before { content: counter(s, decimal-leading-zero); display: block; font-family: 'Fraunces', Georgia, serif; font-size: 26px; color: var(--accent); margin-bottom: 4px; line-height: 1; }
.sp-steps b { display: block; color: var(--ink); font-weight: 600; margin-bottom: 2px; }

.sp-foot { margin-top: 36px; display: flex; flex-wrap: wrap; gap: 6px 22px; font-size: 13.5px; color: var(--muted); animation: sp-rise .7s var(--sp-ease) .45s both; }
.sp-foot a { color: var(--ink-soft); text-decoration: none; border-bottom: 1px solid var(--rule); padding-bottom: 1px; transition: color .2s, border-color .2s; }
.sp-foot a:hover { color: var(--accent); border-color: var(--accent); }
.sp-foot kbd { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; border: 1px solid var(--rule); border-radius: 5px; padding: 1px 6px; background: var(--paper); color: var(--ink-soft); }

@keyframes sp-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .sp-card, .sp-how, .sp-foot { animation: none; } .sp-card, .sp-sheet, .sp-circle { transition: none; } }
@media (max-width: 880px) {
  .sp-kb { display: none; }
  .sp-grid { grid-template-columns: 1fr; }
  .sp-stack { grid-template-rows: none; }
  .sp-feature { min-height: 0; padding-bottom: 150px; }
  .sp-sheets { width: 220px; height: 250px; right: -30px; bottom: -70px; }
  .sp-how { grid-template-columns: 1fr; gap: 16px; }
  .sp-steps { grid-template-columns: 1fr; gap: 18px; }
}
`;

export default function StartPage() {
  const { user } = useAuth();
  return (
    <main className="sp" aria-labelledby="sp-hello">
      <style>{STYLES}</style>

      <div className="sp-eyebrow">{today()}</div>
      <h1 className="sp-hello" id="sp-hello">{greeting(user)}.<br /><em>What shall we work on?</em></h1>
      <p className="sp-lede">Choose a task. Each one walks you through to a finished document or report, using only the facts you provide.</p>

      <div className="sp-grid">
        <Link to="/auto-draft" state={{ startGuided: true }} className="sp-card sp-feature">
          <span className="sp-tag">Start here</span>
          <h2 className="sp-title">Draft a document</h2>
          <p className="sp-desc">Legal notice, bail application, affidavit, agreement. Tell us the case or upload a file, answer a few questions, and get a properly formatted draft. Nothing is made up; missing details stay as blanks for you to fill.</p>
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
            <p className="sp-desc">Upload a PDF or Word contract and review its clauses, risks and key dates against the text.</p>
            <span className="sp-go"><span>Upload a contract</span><span className="sp-circle"><Arrow /></span></span>
          </Link>
          <Link to="/conflict-engine" className="sp-card sp-mini">
            <span className="sp-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v5c0 4.6 3.2 8.3 8 10 4.8-1.7 8-5.4 8-10V6Z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg></span>
            <h2 className="sp-title">Check conflicts</h2>
            <p className="sp-desc">Before taking a new client, check their name against your existing matters.</p>
            <span className="sp-go"><span>Check a name</span><span className="sp-circle"><Arrow /></span></span>
          </Link>
        </div>
      </div>

      <section className="sp-how" aria-label="How drafting works">
        <h2>How drafting<br />works</h2>
        <ol className="sp-steps">
          <li><b>Pick the source</b>A case from Practice, an uploaded file, or details you type.</li>
          <li><b>Answer a few questions</b>Known facts are filled in. Anything unknown is flagged, never guessed.</li>
          <li><b>Review and export</b>Edit in the studio, then download a formatted Word document.</li>
        </ol>
      </section>

      <div className="sp-foot">
        <Link to="/workspace/matters">Open your matters</Link>
        <Link to="/dashboard">Go to the dashboard</Link>
        <span className="sp-kb">Search anything with <kbd>Ctrl</kbd> <kbd>K</kbd></span>
      </div>
    </main>
  );
}
