import React, { useState, useRef, useEffect } from 'react';
import { parseCitations, getTreatment, TREATMENT_META } from '../utils/citationParser';
import { resolveCitation } from '../utils/citationResolver';

const STYLE_ID = 'lex-citation-link-styles-v2';
const CITATION_CSS = `
  .lex-citation-wrap { display: inline; position: relative; }
  .lex-citation-link {
    display: inline-flex; align-items: center; gap: 4px;
    background: none; border: none; padding: 0 1px; margin: 0;
    font: inherit; color: #7EB3F5; cursor: pointer;
    border-bottom: 1px dashed rgba(126,179,245,0.45);
    transition: color .15s, border-color .15s;
  }
  .lex-citation-link:hover:not(:disabled) { color: #A5C9FF; border-bottom-color: rgba(165,201,255,0.7); }
  .lex-citation-link:disabled { cursor: default; opacity: .75; }
  .lex-citation-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .lex-citation-spinner {
    width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    border: 1.5px solid rgba(126,179,245,.35); border-top-color: #7EB3F5;
    animation: lex-citation-spin .7s linear infinite;
  }
  @keyframes lex-citation-spin { to { transform: rotate(360deg); } }

  .lex-citation-fallback {
    display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
    margin-left: 6px; padding: 3px 8px 3px 9px; font-size: 11px;
    color: #FBBF24; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.28);
    border-radius: 12px; vertical-align: middle;
    animation: lex-citation-fallback-in .16s ease-out;
  }
  @keyframes lex-citation-fallback-in { from { opacity:0; transform: translateY(-2px); } to { opacity:1; transform:none; } }
  .lex-citation-fallback a { color: #FDE68A; font-weight: 600; text-decoration: underline; text-decoration-style: dotted; }
  .lex-citation-fallback a:hover { color: #FEF3C7; }
  .lex-citation-fallback-close {
    background: none; border: none; color: #FBBF24; cursor: pointer; font-size: 13px; line-height: 1;
    padding: 0 0 0 2px; opacity: .7;
  }
  .lex-citation-fallback-close:hover { opacity: 1; }
`;

function ensureStylesInjected() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CITATION_CSS;
  document.head.appendChild(style);
}

export default function CitationLink({ raw }) {
  const [status, setStatus] = useState('idle'); // idle | resolving | found | not_found
  const mountedRef = useRef(true);

  useEffect(() => {
    // Re-assert true on every setup — StrictMode double-invokes this effect
    // (setup -> cleanup -> setup) on mount in development, and without this
    // the cleanup's `false` would never be reset by the second setup,
    // permanently poisoning the guard for a component that is very much
    // still mounted and interactive.
    mountedRef.current = true;
    ensureStylesInjected();
    return () => { mountedRef.current = false; };
  }, []);

  const treatment = getTreatment(raw);
  const meta = TREATMENT_META[treatment];

  const handleClick = async (e) => {
    e.preventDefault();
    if (status === 'resolving') return; // guard re-entrant clicks

    // CRITICAL: window.open must happen synchronously, in the same call stack
    // as the click event — any `await` before this and browsers treat it as
    // an unrequested popup and silently block it.
    const newTab = window.open('about:blank', '_blank');

    setStatus('resolving');
    const result = await resolveCitation(raw);

    // The tab may have been closed by the user, or the component unmounted,
    // while we were waiting — guard every access.
    const tabIsUsable = newTab && !newTab.closed;

    if (result.status === 'found') {
      if (tabIsUsable) newTab.location.href = result.url;
      if (mountedRef.current) setStatus('found');
    } else {
      if (tabIsUsable) newTab.close();
      if (mountedRef.current) setStatus('not_found');
    }
  };

  const dismissFallback = () => setStatus('idle');

  return (
    <span className="lex-citation-wrap">
      <button
        type="button"
        className="lex-citation-link"
        onClick={handleClick}
        disabled={status === 'resolving'}
        title={raw}
      >
        <span className="lex-citation-dot" style={{ background: meta.color }} />
        {raw}
        {status === 'resolving' && <span className="lex-citation-spinner" />}
      </button>

      {status === 'not_found' && (
        <span className="lex-citation-fallback">
          Not available on Indian Kanoon — search via:
          <a
            href="https://www.scconline.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => navigator.clipboard.writeText(raw).catch(() => {})}
          >
            SCC Online
          </a>
          <a
            href="https://www.manupatrafast.com"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => navigator.clipboard.writeText(raw).catch(() => {})}
          >
            Manupatra
          </a>
          <button type="button" className="lex-citation-fallback-close" onClick={dismissFallback} title="Dismiss">×</button>
        </span>
      )}
    </span>
  );
}

// Splits raw text into plain-text segments interleaved with <CitationLink>
// nodes for every detected citation — drop-in replacement for rendering any
// free-text block that may contain legal citations.
export function renderWithCitations(text) {
  if (!text) return text;
  const citations = parseCitations(text);
  if (citations.length === 0) return text;

  const nodes = [];
  let cursor = 0;
  citations.forEach((c, i) => {
    if (c.index > cursor) nodes.push(text.slice(cursor, c.index));
    nodes.push(<CitationLink key={`cite-${i}-${c.index}`} raw={c.raw} />);
    cursor = c.index + c.length;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
