import { useState, useEffect, useRef } from 'react';

function OutlinePanel({ wsRef, bridge, docTitle, docType, createdAt }) {
  const [tab, setTab] = useState('outline');
  const [headings, setHeadings] = useState([]);
  const [wordCount, setWordCount] = useState(0);
  const [fieldCount, setFieldCount] = useState(0);

  useEffect(() => {
    const tick = () => {
      try {
        const iframe = wsRef?.current?.querySelector('iframe.wce-frame');
        const doc = iframe?.contentDocument;
        if (!doc?.body) return;

        const els = doc.querySelectorAll('h1, h2, h3, h4');
        const list = [];
        els.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) list.push({ level: parseInt(el.tagName[1]), text, el });
        });
        setHeadings(list);

        const text = doc.body.innerText || '';
        const words = text.split(/\s+/).filter(Boolean).length;
        setWordCount(words);

        const marks = doc.querySelectorAll('mark.lx-attn');
        setFieldCount(marks.length);
      } catch { /* cross-origin */ }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [wsRef, bridge]);

  function scrollTo(heading) {
    try {
      heading.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prev = heading.el.style.background;
      heading.el.style.background = 'color-mix(in srgb, var(--accent) 15%, transparent)';
      setTimeout(() => { heading.el.style.background = prev; }, 1500);
    } catch { /* ignore */ }
  }

  return (
    <div className="ads-outline">
      <div className="ads-outline__tabs">
        <button className={`ads-outline__tab${tab === 'outline' ? ' active' : ''}`} onClick={() => setTab('outline')}>Outline</button>
        <button className={`ads-outline__tab${tab === 'info' ? ' active' : ''}`} onClick={() => setTab('info')}>Info</button>
        <button className={`ads-outline__tab${tab === 'history' ? ' active' : ''}`} onClick={() => setTab('history')} disabled>History</button>
        <button className={`ads-outline__tab${tab === 'clauses' ? ' active' : ''}`} onClick={() => setTab('clauses')} disabled>Clauses</button>
      </div>

      {tab === 'outline' && (
        <div className="ads-outline__body">
          {headings.length === 0 ? (
            <div className="ads-outline__empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)', marginBottom: 8 }}>
                <line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" />
              </svg>
              <div>No headings found</div>
              <div className="ads-outline__empty-sub">Add headings in your document to see the outline here.</div>
            </div>
          ) : (
            <ul className="ads-outline__list">
              {headings.map((h, i) => (
                <li key={i} className={`ads-outline__item ads-outline__item--h${h.level}`} onClick={() => scrollTo(h)}>
                  <span className="ads-outline__marker">H{h.level}</span>
                  <span className="ads-outline__text">{h.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'info' && (
        <div className="ads-outline__body">
          <div className="ads-outline__info-grid">
            <div className="ads-outline__info-item">
              <div className="ads-outline__info-label">Title</div>
              <div className="ads-outline__info-value">{docTitle || 'Untitled'}</div>
            </div>
            {docType && (
              <div className="ads-outline__info-item">
                <div className="ads-outline__info-label">Type</div>
                <div className="ads-outline__info-value">{docType.replace(/_/g, ' ')}</div>
              </div>
            )}
            <div className="ads-outline__info-item">
              <div className="ads-outline__info-label">Words</div>
              <div className="ads-outline__info-value">{wordCount.toLocaleString()}</div>
            </div>
            <div className="ads-outline__info-item">
              <div className="ads-outline__info-label">Headings</div>
              <div className="ads-outline__info-value">{headings.length}</div>
            </div>
            <div className="ads-outline__info-item">
              <div className="ads-outline__info-label">Unresolved fields</div>
              <div className="ads-outline__info-value" style={fieldCount > 0 ? { color: '#c38a00', fontWeight: 600 } : {}}>
                {fieldCount}
              </div>
            </div>
            {createdAt && (
              <div className="ads-outline__info-item">
                <div className="ads-outline__info-label">Created</div>
                <div className="ads-outline__info-value">{new Date(createdAt).toLocaleDateString()}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="ads-outline__body">
          <div className="ads-outline__empty">
            <div>Version history</div>
            <div className="ads-outline__empty-sub">Coming in Phase 3.</div>
          </div>
        </div>
      )}

      {tab === 'clauses' && (
        <div className="ads-outline__body">
          <div className="ads-outline__empty">
            <div>Clause library</div>
            <div className="ads-outline__empty-sub">Coming in Phase 4.</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OutlinePanel;
