// Dynamic case header & ledger-style summary strip: replaces the static,
// single-case header with a data-driven one matching virtual-courtroom-dynamic-header.html.
// Renders the permanent source row, synthesized case caption (Fraunces italic),
// matter reference (IBM Plex Mono), real page count trust signal, dynamic summary columns,
// and async extraction lifecycle states (analyzing spinner / error banner / populated).

export default function MatterHeader({
  filename = 'Virtual_Courtroom_Test_Case.pdf',
  pageCount = '3 pages',
  refId = 'VIC-2026-CT-0001',
  title = 'Vikram Singh v. Anita Sharma',
  subtitle = 'Breach of contract — home renovation services · Civil Judge (Senior Division), Chennai',
  summaryColumns = [],
  isAnalyzing = false,
  analyzingText = 'Analyzing document — extracting parties, dates, and issues…',
  analysisError = null,
  onReanalyze,
  onRetry,
  progressStages = [],
  onNewSimulation,
  onSaveToVault,
  savingSession = false,
  savedSession = false,
}) {
  const formattedPageCount = typeof pageCount === 'number'
    ? `${pageCount} page${pageCount !== 1 ? 's' : ''}`
    : pageCount || '1 page';

  return (
    <>
      <header className={`hero${isAnalyzing ? ' busy' : ''}`} id="hero">
        <div className="source-row">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
            <path d="M13 3v5h5" />
          </svg>
          <span id="filename">{filename || 'Document'}</span>
          <span>·</span>
          <span id="pagecount">{formattedPageCount}</span>
          {analysisError ? (
            <span className="source-fail">⚠ analysis failed</span>
          ) : isAnalyzing ? (
            <span className="source-pending">⏳ analyzing…</span>
          ) : (
            <span className="source-check">✓ analyzed</span>
          )}
          {onReanalyze && (
            <button
              className="reanalyze-btn"
              id="reanalyzeBtn"
              type="button"
              onClick={onReanalyze}
            >
              ⟳ analyze a different document
            </button>
          )}
        </div>

        <div className={`analyzing${isAnalyzing ? ' on' : ''}`} id="analyzing">
          <div className="spinner" />
          <div className="analyzing-text">{analyzingText}</div>
        </div>

        {analysisError ? (
          <div className="hero-error-body" style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '15px' }}>
              ⚠ Document Analysis Error
            </div>
            <div style={{ color: 'var(--muted-2)', fontSize: '13px', lineHeight: 1.5 }}>
              {analysisError}
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
              {onRetry && (
                <button type="button" className="btn-fill" onClick={onRetry}>
                  ⟳ Retry analysis
                </button>
              )}
              {onReanalyze && (
                <button type="button" className="btn-outline" onClick={onReanalyze}>
                  Upload a different document
                </button>
              )}
            </div>
          </div>
        ) : isAnalyzing ? null : (
          <div className="hero-body" id="heroBody">
            <div className="hero-ref">
              Ref: <span id="ref">{refId || 'VIC-2026-CT-0001'}</span>
            </div>
            <h1 className="hero-title" id="title">{title}</h1>
            <p className="hero-sub" id="subtitle">{subtitle}</p>

            <div className="hero-progress">
              {(progressStages && progressStages.length > 0
                ? progressStages
                : [
                    { state: 'done' },
                    { state: 'done' },
                    { state: 'todo' },
                    { state: 'todo' },
                    { state: 'todo' },
                  ]
              ).map((seg, idx) => (
                <div
                  key={idx}
                  className={`hero-seg${seg.state === 'todo' || seg.state === 'pending' ? ' todo' : ''}`}
                />
              ))}
            </div>

            <div className="hero-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={onNewSimulation}
              >
                New simulation
              </button>
              <button
                type="button"
                className="btn-fill"
                onClick={onSaveToVault}
                disabled={savingSession || savedSession}
              >
                {savingSession ? 'Saving…' : savedSession ? '✓ Saved' : 'Save to case vault'}
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Case summary ledger: dynamic columns per matter type */}
      {summaryColumns && summaryColumns.length > 0 && !isAnalyzing && !analysisError && (
        <div className="summary">
          {summaryColumns.map((col, idx) => {
            let colId = col.id;
            if (!colId) {
              const norm = (col.label || '').toLowerCase();
              if (norm.includes('plaintiff') || norm.includes('petitioner') || norm.includes('appellant') || norm.includes('complainant') || norm.includes('claimant')) {
                colId = 'plaintiff';
              } else if (norm.includes('defendant') || norm.includes('respondent') || norm.includes('accused')) {
                colId = 'defendant';
              } else if (norm.includes('contract value') || norm.includes('claim amount') || norm.includes('dispute value')) {
                colId = 'contractValue';
              } else if (norm.includes('advance') || norm.includes('deposit')) {
                colId = 'advancePaid';
              } else if (norm.includes('relief') || norm.includes('prayer') || norm.includes('compensation') || norm.includes('damages')) {
                colId = 'reliefSought';
              } else {
                colId = `sum-${norm.replace(/[^a-z0-9]/g, '-')}`;
              }
            }
            return (
              <div className="sum-col" key={idx}>
                <div className="sum-label">{col.label}</div>
                <div className="sum-value" id={colId}>{col.value}</div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
