import React from 'react';

// Horizontal stepper — replaces the vertical ~190px rail entirely.
// Sits directly beneath the topbar inside a shared sticky header container.
// Shows all 4 stages: Facts & Issues, Precedents, Opening Draft, Simulation Room
// as a single row: dot, name, status, connected by horizontal rule lines.
export default function StageRail({ stages, activeId, onSelect }) {
  const activeIndex = stages.findIndex((s) => s.id === activeId);

  return (
    <nav className="h-rail" id="hRail" aria-label="Litigation stages">
      {stages.map((stage, i) => {
        const isDone = i < activeIndex;
        const isActive = i === activeIndex;
        const stateClass = isDone ? 'done' : isActive ? 'active' : '';

        return (
          <React.Fragment key={stage.id}>
            {i > 0 && <div className="h-connector" aria-hidden="true" />}
            <div
              className={`h-stage ${stateClass}`}
              data-target={stage.id}
              onClick={() => onSelect(stage.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(stage.id); }}
            >
              <div className="h-dot">{isDone ? '✓' : i + 1}</div>
              <div>
                <div className="h-name">{stage.label}</div>
                <div className="h-status">{stage.status}</div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

