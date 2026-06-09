import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const renderParagraphs = (text) => {
  if (!text) return null;
  return text.split('\n').map((line, i, arr) => (
    <React.Fragment key={i}>
      {line}
      {i < arr.length - 1 && <br />}
    </React.Fragment>
  ));
};

const WAR_ROOM_STYLES = `
  .wr-page {
    height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 24px 28px;
    box-sizing: border-box;
    font-family: var(--font-sans);
    opacity: 0;
    transform: translateY(12px);
    transition: opacity 0.55s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.55s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .wr-page.mounted {
    opacity: 1;
    transform: translateY(0);
  }

  /* ── Header ──────────────────────────────────────────── */
  .wr-header {
    flex-shrink: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    padding: 20px 24px;
    margin-bottom: 20px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  }
  .wr-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .wr-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: -0.3px;
  }
  .wr-badge {
    background: linear-gradient(135deg, var(--accent-primary) 0%, #2563EB 100%);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 5px 14px;
    border-radius: 20px;
  }
  .wr-issues-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 8px;
  }
  .wr-issues-body {
    background: var(--bg-app);
    border: 1px solid var(--border-subtle);
    border-radius: 7px;
    padding: 13px 16px;
    font-size: 13.5px;
    line-height: 1.65;
    color: var(--text-primary);
  }

  /* ── Split Grid ─────────────────────────────────────── */
  .wr-grid {
    flex: 1;
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 20px;
    overflow: hidden;
    min-height: 0;
  }
  @media (max-width: 860px) {
    .wr-grid { grid-template-columns: 1fr; }
  }

  /* ── Scrollable columns ─────────────────────────────── */
  .wr-col {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-right: 4px;
  }
  .wr-col::-webkit-scrollbar { width: 5px; }
  .wr-col::-webkit-scrollbar-track { background: transparent; }
  .wr-col::-webkit-scrollbar-thumb {
    background: var(--border-subtle);
    border-radius: 3px;
    transition: background 0.2s;
  }
  .wr-col::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

  /* ── Panel card (shared) ────────────────────────────── */
  .wr-panel {
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 9px;
    padding: 22px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
    flex-shrink: 0;
  }
  .wr-panel-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
    margin: 0 0 14px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-subtle);
  }

  /* ── Opening Argument ───────────────────────────────── */
  .wr-panel.strategy { border-left: 3px solid var(--accent-primary); }
  .wr-argument-text {
    font-family: var(--font-serif);
    font-size: 15px;
    line-height: 1.85;
    color: var(--text-primary);
  }

  /* ── Citations section ──────────────────────────────── */
  .wr-citations-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .wr-citation-card {
    display: block;
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    padding: 14px 16px;
    text-decoration: none;
    flex-shrink: 0;
    transition: border-color 0.2s ease,
                box-shadow 0.2s ease,
                background-color 0.2s ease;
  }
  .wr-citation-card:hover {
    border-color: var(--accent-primary);
    background-color: rgba(59, 130, 246, 0.04);
    box-shadow: 0 4px 16px rgba(59, 130, 246, 0.12);
  }
  .wr-citation-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--accent-primary);
    margin-bottom: 5px;
    line-height: 1.4;
  }
  .wr-citation-snippet {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.55;
    margin-bottom: 8px;
  }
  .wr-citation-link {
    font-size: 11px;
    color: var(--text-muted);
    text-decoration: underline;
    letter-spacing: 0.2px;
  }

  /* ── Red Team column header ─────────────────────────── */
  .wr-threat-header {
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: 10px;
  }
  .wr-threat-header-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 3px;
  }
  .wr-threat-header-sub {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* ── Threat cards ───────────────────────────────────── */
  .wr-threat-card {
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent-danger);
    border-radius: 9px;
    padding: 18px 20px;
    flex-shrink: 0;
    transition: background-color 0.2s ease, box-shadow 0.2s ease;
  }
  .wr-threat-card:hover {
    background-color: rgba(239, 68, 68, 0.02);
    box-shadow: 0 3px 14px rgba(239, 68, 68, 0.08);
  }
  .wr-threat-tag {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--accent-danger);
    margin-bottom: 8px;
  }
  .wr-threat-question {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.55;
    margin-bottom: 12px;
  }
  .wr-rebuttal-box {
    background: rgba(16, 185, 129, 0.035);
    border-left: 2px solid var(--accent-success);
    border-radius: 0 6px 6px 0;
    padding: 11px 14px;
  }
  .wr-rebuttal-label {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--accent-success);
    margin-bottom: 5px;
  }
  .wr-rebuttal-text {
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.55;
  }

  /* ── Empty state ────────────────────────────────────── */
  .wr-empty-col {
    font-size: 13px;
    color: var(--text-muted);
    font-style: italic;
    padding: 8px 0;
  }

  /* ── Fallback (no simulation data) ─────────────────── */
  .wr-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }
  .wr-fallback-card {
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 44px 48px;
    text-align: center;
    max-width: 520px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  }
  .wr-fallback-icon {
    font-size: 44px;
    margin-bottom: 18px;
    opacity: 0.8;
  }
  .wr-fallback-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 12px;
  }
  .wr-fallback-body {
    font-size: 13.5px;
    color: var(--text-muted);
    line-height: 1.65;
    margin: 0 0 24px;
  }
`;

const STAGE_LABELS = [
  'Extracting legal issues...',
  'Searching Indian Kanoon for precedents...',
  'Drafting opening argument...',
  'Running Red Team analysis...',
];

export default function WarRoomView() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

  const location = useLocation();
  const navigate = useNavigate();
  const [isMounted, setIsMounted] = useState(false);
  const [simulationData, setSimulationData] = useState(location.state?.simulationData || null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState(null);
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const t = requestAnimationFrame(() => setIsMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // Run the simulation when a pendingSimulation payload is passed via route state
  useEffect(() => {
    const pending = location.state?.pendingSimulation;
    if (!pending || simulationData) return;

    const { documentContext, clientSide } = pending;
    setSimLoading(true);
    setSimError(null);

    // Advance stage label every ~6 seconds to give feedback while the 4 stages run
    let stage = 0;
    const stageTimer = setInterval(() => {
      stage = Math.min(stage + 1, STAGE_LABELS.length - 1);
      setStageIndex(stage);
    }, 6000);

    const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
    fetch(`${API_BASE}/api/ai/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ document_content: documentContext, client_side: clientSide || 'Appellant' }),
    })
      .then(res => res.json())
      .then(data => {
        clearInterval(stageTimer);
        if (data.error) {
          setSimError(data.error);
        } else {
          setSimulationData(data.simulationData);
        }
      })
      .catch(err => {
        clearInterval(stageTimer);
        setSimError(err.message || 'Simulation failed. Please try again.');
      })
      .finally(() => setSimLoading(false));

    return () => clearInterval(stageTimer);
  }, []);

  // ── Loading state ────────────────────────────────────────────
  if (simLoading) {
    return (
      <>
        <style>{WAR_ROOM_STYLES}</style>
        <div className="wr-fallback">
          <div className="wr-fallback-card" style={{ minWidth: '420px' }}>
            <div className="wr-fallback-icon" style={{ animation: 'pulse-shimmer 1.5s infinite ease-in-out' }}>⚖️</div>
            <h2 className="wr-fallback-title">Preparing War Room</h2>
            <p className="wr-fallback-body" style={{ marginBottom: '24px' }}>
              {STAGE_LABELS[stageIndex]}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {STAGE_LABELS.map((label, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                    background: i < stageIndex ? 'var(--accent-success)' : i === stageIndex ? 'var(--accent-primary)' : 'var(--border-subtle)',
                    transition: 'background 0.4s',
                  }} />
                  <span style={{ color: i <= stageIndex ? 'var(--text-primary)' : 'var(--text-muted)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Error state ──────────────────────────────────────────────
  if (simError) {
    return (
      <>
        <style>{WAR_ROOM_STYLES}</style>
        <div className="wr-fallback">
          <div className="wr-fallback-card">
            <div className="wr-fallback-icon">🚨</div>
            <h2 className="wr-fallback-title">Simulation Failed</h2>
            <p className="wr-fallback-body">{simError}</p>
            <button className="btn-accent" onClick={() => navigate('/dashboard')} style={{ padding: '10px 26px' }}>
              Return to Dashboard
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── No data and no pending simulation ───────────────────────
  if (!simulationData) {
    const steps = [
      { num: '01', title: 'Upload a case document', desc: 'Go to Case Vault and upload a brief, FIR, contract, or legal notice.' },
      { num: '02', title: 'Open the Universal Agent', desc: 'Press Ctrl+K or click "Universal Agent" in the sidebar.' },
      { num: '03', title: 'Trigger the simulation', desc: 'Type: "Pull the [document name] and start virtual courtroom simulation."' },
      { num: '04', title: 'War Room activates', desc: 'The AI runs a 4-stage pipeline and populates this dashboard automatically.' },
    ];
    return (
      <>
        <style>{WAR_ROOM_STYLES}</style>
        <style>{`
          .wr-setup-card {
            background: var(--bg-panel);
            border: 1px solid var(--border-subtle);
            border-radius: 14px;
            padding: 40px 44px;
            max-width: 620px;
            width: 100%;
            box-shadow: 0 16px 48px rgba(0,0,0,0.35);
          }
          .wr-step-item {
            display: flex;
            gap: 16px;
            align-items: flex-start;
            padding: 14px 0;
            border-bottom: 1px solid var(--border-subtle);
          }
          .wr-step-item:last-child { border-bottom: none; }
          .wr-step-num {
            font-size: 11px;
            font-weight: 800;
            color: var(--accent-primary);
            background: rgba(59,130,246,0.1);
            border-radius: 6px;
            padding: 4px 7px;
            flex-shrink: 0;
            font-family: var(--font-sans);
            letter-spacing: 0.5px;
          }
          .wr-cmd-chip {
            display: inline-block;
            background: rgba(59,130,246,0.08);
            border: 1px solid rgba(59,130,246,0.2);
            border-radius: 5px;
            padding: 3px 9px;
            font-size: 12px;
            font-family: monospace;
            color: var(--accent-primary);
            margin-top: 6px;
          }
        `}</style>
        <div className="wr-fallback">
          <div className="wr-setup-card">
            {/* Icon + Title */}
            <div style={{ textAlign: 'center', marginBottom: '28px' }}>
              <div style={{ fontSize: '42px', marginBottom: '14px', filter: 'drop-shadow(0 4px 12px rgba(59,130,246,0.3))' }}>⚖️</div>
              <h2 style={{ fontSize: '21px', fontWeight: '700', color: 'white', margin: '0 0 8px' }}>Virtual Courtroom — Ready</h2>
              <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                No simulation is active yet. Follow the steps below to generate a full litigation strategy.
              </p>
            </div>

            {/* Steps */}
            <div style={{ marginBottom: '24px' }}>
              {steps.map(s => (
                <div key={s.num} className="wr-step-item">
                  <span className="wr-step-num">{s.num}</span>
                  <div>
                    <div style={{ fontSize: '13.5px', fontWeight: '600', color: 'white', marginBottom: '3px' }}>{s.title}</div>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{s.desc}</div>
                    {s.num === '03' && (
                      <div className="wr-cmd-chip">
                        "Pull the [document] and start virtual courtroom simulation"
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn-accent"
                onClick={() => window.dispatchEvent(new Event('toggle-rag-palette'))}
                style={{ padding: '10px 22px', display: 'flex', alignItems: 'center', gap: '7px' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Open Universal Agent
              </button>
              <button
                style={{ padding: '10px 22px', background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '7px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px', fontWeight: '500', transition: 'all 0.15s' }}
                onClick={() => navigate('/vault')}
                onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(59,130,246,0.35)'; e.currentTarget.style.color='white'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border-subtle)'; e.currentTarget.style.color='var(--text-muted)'; }}
              >
                Go to Case Vault
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const opposingQuestions = simulationData.red_team?.opposing_counter_questions ?? [];
  const liveCitations = simulationData.live_citations ?? [];

  return (
    <>
      <style>{WAR_ROOM_STYLES}</style>

      <div className={`wr-page${isMounted ? ' mounted' : ''}`}>

        {/* ── Header ───────────────────────────────────── */}
        <div className="wr-header">
          <div className="wr-header-top">
            <h1 className="wr-title">Litigation War Room</h1>
            <span className="wr-badge">
              {simulationData.client_side || 'Advocate'} Strategy
            </span>
          </div>
          <div className="wr-issues-label">Extracted Case Issues</div>
          <div className="wr-issues-body">
            {renderParagraphs(simulationData.extracted_issues) || 'No core issues extracted.'}
          </div>
        </div>

        {/* ── Split Grid ──────────────────────────────── */}
        <div className="wr-grid">

          {/* Left — Your Strategy */}
          <div className="wr-col">

            {/* Opening Argument */}
            <div className="wr-panel strategy">
              <p className="wr-panel-title">Grounded Opening Argument</p>
              <div className="wr-argument-text">
                {renderParagraphs(simulationData.opening_argument) || 'Argument generation in progress…'}
              </div>
            </div>

            {/* Live Citations */}
            {liveCitations.length > 0 && (
              <>
                <div className="wr-citations-label">Supreme Court Precedents & Citations</div>
                {liveCitations.map((citation, i) => (
                  <a
                    key={i}
                    href={citation.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="wr-citation-card"
                  >
                    <div className="wr-citation-title">
                      {citation.title || 'Case Citation'}
                    </div>
                    {citation.snippet && (
                      <div className="wr-citation-snippet">{citation.snippet}</div>
                    )}
                    <span className="wr-citation-link">Open on Indian Kanoon ↗</span>
                  </a>
                ))}
              </>
            )}
          </div>

          {/* Right — Red Team */}
          <div className="wr-col">

            <div className="wr-threat-header">
              <h2 className="wr-threat-header-title">Opposing Counsel — Red Team</h2>
              <p className="wr-threat-header-sub">
                Anticipated cross-examination attacks and recommended safe-harbour rebuttals.
              </p>
            </div>

            {opposingQuestions.length > 0 ? (
              opposingQuestions.map((threat, i) => (
                <div key={i} className="wr-threat-card">
                  <div className="wr-threat-tag">Threat #{i + 1}</div>
                  <div className="wr-threat-question">
                    {renderParagraphs(threat.question)}
                  </div>
                  {threat.suggested_rebuttal && (
                    <div className="wr-rebuttal-box">
                      <div className="wr-rebuttal-label">Recommended Rebuttal</div>
                      <div className="wr-rebuttal-text">
                        {renderParagraphs(threat.suggested_rebuttal)}
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="wr-empty-col">No opposing threats detected for this strategy.</p>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
