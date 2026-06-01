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

export default function WarRoomView() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setIsMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const simulationData = location.state?.simulationData;

  if (!simulationData) {
    return (
      <>
        <style>{WAR_ROOM_STYLES}</style>
        <div className="wr-fallback">
          <div className="wr-fallback-card">
            <div className="wr-fallback-icon">⚖️</div>
            <h2 className="wr-fallback-title">No Active Simulation</h2>
            <p className="wr-fallback-body">
              The War Room requires an active courtroom simulation. Open the Universal
              Agent and instruct it to run a courtroom simulation on a saved Case Vault
              document to populate this dashboard.
            </p>
            <button
              className="btn-accent"
              onClick={() => navigate('/dashboard')}
              style={{ padding: '10px 26px' }}
            >
              Return to Dashboard
            </button>
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
