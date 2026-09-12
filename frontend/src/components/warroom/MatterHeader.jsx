// Dark-ink topbar: replaces the old APPELLANT STRATEGY / PIPELINE COMPLETE
// status pills with one case-specific title line and a single 5-segment
// progress bar. Purely presentational — WarRoomView computes matterLabel/
// title/subLine/progressStages from real simulation data and passes them
// down, so this component carries no knowledge of the simulationData shape.

export default function MatterHeader({
  matterLabel,
  title,
  subLine,
  progressStages,
  onNewSimulation,
  onSaveToVault,
  savingSession,
  savedSession,
}) {
  return (
    <header className="vc-topbar">
      <div>
        <p className="vc-case-id">{matterLabel}</p>
        <h1 className="vc-case-title">{title}</h1>
        <p className="vc-case-sub">{subLine}</p>
        <div className="vc-progress">
          {progressStages.map((s, i) => (
            <div key={i} className={`vc-progress-seg ${s.state}`} />
          ))}
        </div>
        <div className="vc-progress-labels">
          {progressStages.map((s, i) => (
            <span key={i}>{s.label}</span>
          ))}
        </div>
      </div>
      <div className="vc-topbar-actions">
        <button type="button" className="vc-btn vc-btn-outline-light" onClick={onNewSimulation}>
          New simulation
        </button>
        <button
          type="button"
          className={`vc-btn vc-btn-pine${savedSession ? ' saved' : ''}`}
          onClick={onSaveToVault}
          disabled={savingSession || savedSession}
        >
          {savingSession ? 'Saving…' : savedSession ? '✓ Saved' : 'Save to case vault'}
        </button>
      </div>
    </header>
  );
}
