import { useState, useEffect, useMemo } from 'react';

function diffLines(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const result = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const o = oldLines[i] ?? null;
    const n = newLines[i] ?? null;
    if (o === n) {
      result.push({ type: 'same', text: o });
    } else {
      if (o !== null) result.push({ type: 'removed', text: o });
      if (n !== null) result.push({ type: 'added', text: n });
    }
  }
  return result;
}

function htmlToText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.innerText || div.textContent || '';
}

function DocCompare({ oldVersion, currentHtml, onClose }) {
  const oldText = useMemo(() => htmlToText(oldVersion?.document?.html), [oldVersion]);
  const newText = useMemo(() => htmlToText(currentHtml), [currentHtml]);
  const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);

  const stats = useMemo(() => {
    let added = 0, removed = 0;
    lines.forEach((l) => { if (l.type === 'added') added++; if (l.type === 'removed') removed++; });
    return { added, removed };
  }, [lines]);

  return (
    <div className="ads-dc__overlay" onClick={onClose}>
      <div className="ads-dc__modal" onClick={(e) => e.stopPropagation()}>
        <div className="ads-dc__head">
          <div>
            <div className="ads-dc__title">Compare versions</div>
            <div className="ads-dc__stats">
              <span className="ads-dc__stat ads-dc__stat--add">+{stats.added} added</span>
              <span className="ads-dc__stat ads-dc__stat--del">-{stats.removed} removed</span>
            </div>
          </div>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onClose}>Close</button>
        </div>
        <div className="ads-dc__labels">
          <span>Old version</span>
          <span>Current</span>
        </div>
        <div className="ads-dc__body">
          {lines.map((l, i) => (
            <div key={i} className={`ads-dc__line ads-dc__line--${l.type}`}>
              <span className="ads-dc__gutter">
                {l.type === 'added' ? '+' : l.type === 'removed' ? '-' : ' '}
              </span>
              <span className="ads-dc__text">{l.text || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default DocCompare;
