import { Link, useNavigate } from 'react-router-dom';

const ACTIONS = [
  {
    key: 'draft',
    title: 'Draft a document',
    desc: 'Legal notice, bail application, affidavit, agreement. We ask which case and which file first, then draft only from the facts you give.',
    cta: 'Start drafting',
    go: (nav) => nav('/auto-draft', { state: { startGuided: true } }),
  },
  {
    key: 'analyze',
    title: 'Analyze a contract',
    desc: 'Upload a PDF or Word contract. Get the clauses, risks and key dates, with every point tied to the text.',
    cta: 'Upload a contract',
    go: (nav) => nav('/contract-analyzer'),
  },
  {
    key: 'conflicts',
    title: 'Check conflicts',
    desc: 'Before you take a new client, check the names against your existing matters.',
    cta: 'Check a name',
    go: (nav) => nav('/conflict-engine'),
  },
];

export default function StartPage() {
  const navigate = useNavigate();
  return (
    <div className="start-page">
      <style>{`
        .start-page { max-width: 980px; margin: 0 auto; padding: 48px 24px 64px; color: var(--ink); }
        .start-page h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 34px; letter-spacing: -0.01em; margin: 0 0 8px; }
        .start-page .start-sub { color: var(--ink-soft); font-size: 15px; line-height: 1.6; margin: 0 0 32px; max-width: 560px; }
        .start-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
        .start-card { display: flex; flex-direction: column; text-align: left; gap: 10px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 12px; padding: 22px; cursor: pointer; color: inherit; font: inherit; transition: border-color .15s, transform .15s; }
        .start-card:hover { border-color: var(--accent); transform: translateY(-1px); }
        .start-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .start-num { font-size: 12px; color: var(--muted); letter-spacing: .08em; }
        .start-card h2 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 21px; margin: 0; }
        .start-card p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--ink-soft); flex: 1; }
        .start-cta { align-self: flex-start; margin-top: 6px; background: var(--accent); color: var(--on-accent, #fff); border-radius: 8px; padding: 9px 14px; font-size: 13.5px; font-weight: 600; }
        .start-more { margin-top: 28px; font-size: 13.5px; color: var(--ink-soft); }
        .start-more a { color: var(--accent); }
        @media (max-width: 800px) { .start-grid { grid-template-columns: 1fr; } .start-page { padding: 32px 16px; } }
      `}</style>
      <h1>What do you need to do today?</h1>
      <p className="start-sub">Pick one. Each takes you through to a finished document or report, and nothing is written from made-up details.</p>
      <div className="start-grid">
        {ACTIONS.map((a, i) => (
          <button key={a.key} type="button" className="start-card" onClick={() => a.go(navigate)}>
            <span className="start-num">{String(i + 1).padStart(2, '0')}</span>
            <h2>{a.title}</h2>
            <p>{a.desc}</p>
            <span className="start-cta">{a.cta}</span>
          </button>
        ))}
      </div>
      <p className="start-more">
        Looking for something else? <Link to="/workspace/matters">Open your matters</Link> or <Link to="/dashboard">go to the dashboard</Link>.
      </p>
    </div>
  );
}
