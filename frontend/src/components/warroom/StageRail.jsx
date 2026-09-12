// Sticky left stage-rail — 4 stops (stage 4 "Red team" + stage 5 "Chat"
// share one stop, since they're rendered as one merged Simulation Room
// section on the page). Items before the active one show a filled/done
// dot, the active one shows brass, everything after shows an outline —
// driven purely by index relative to activeId, which WarRoomView keeps in
// sync with real scroll position via IntersectionObserver-style tracking.
export default function StageRail({ stages, activeId, onSelect }) {
  const activeIndex = stages.findIndex((s) => s.id === activeId);

  return (
    <nav className="vc-stage-rail">
      {stages.map((stage, i) => {
        const state = i < activeIndex ? 'is-done' : i === activeIndex ? 'is-active' : '';
        return (
          <a
            key={stage.id}
            className={`vc-rail-item ${state}`}
            onClick={() => onSelect(stage.id)}
          >
            <span className="vc-rail-track">
              <span className="vc-rail-dot">{state === 'is-done' ? '✓' : i + 1}</span>
              {i < stages.length - 1 && <span className="vc-rail-connector" />}
            </span>
            <span>
              <span className="vc-rail-label">{stage.label}</span>
              <span className="vc-rail-status">{stage.status}</span>
            </span>
          </a>
        );
      })}
    </nav>
  );
}
