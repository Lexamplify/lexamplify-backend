import { useState } from 'react';

const TRUNCATE_LEN = 200;

// Compact law-report entry — replaces the old generic content-card styling.
// Case name in italic serif, a muted "Indian Kanoon · [year]" meta line
// instead of a loud colored pill, and a plain text source link (no arrow).
export default function PrecedentEntry({ metaLine, caseName, note, url }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = note.length > TRUNCATE_LEN;
  const displayNote = isLong && !expanded
    ? note.slice(0, TRUNCATE_LEN).replace(/\s+\S*$/, '') + '…'
    : note;

  return (
    <div className="vc-precedent">
      <div className="vc-precedent-meta">{metaLine}</div>
      <h3>{caseName}</h3>
      <p>
        {displayNote}
        {isLong && (
          <>
            {' '}
            <span className="vc-precedent-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Show less' : 'Read more'}
            </span>
          </>
        )}
      </p>
      <a className="vc-precedent-link" href={url} target="_blank" rel="noopener noreferrer">
        View source
      </a>
    </div>
  );
}
