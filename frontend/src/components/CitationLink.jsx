import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { parseCitations, resolveCitation, buildSearchUrls, TREATMENT_META } from '../utils/citationParser';

const GUTTER = 8;
const EST_WIDTH = 236;
const EST_HEIGHT = 168;

const STYLE_ID = 'lex-citation-link-styles';
const CITATION_CSS = `
  .lex-citation-link {
    display: inline-flex; align-items: center; gap: 4px;
    background: none; border: none; padding: 0 1px; margin: 0;
    font: inherit; color: #7EB3F5; cursor: pointer;
    border-bottom: 1px dashed rgba(126,179,245,0.45);
    transition: color .15s, border-color .15s;
  }
  .lex-citation-link:hover { color: #A5C9FF; border-bottom-color: rgba(165,201,255,0.7); }
  .lex-citation-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }

  .lex-citation-popover {
    position: fixed; z-index: 100; width: 236px;
    background: #0D1117; border: 1px solid rgba(255,255,255,.1);
    border-radius: 10px; padding: 10px;
    box-shadow: 0 16px 48px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.3);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    animation: lex-citation-pop-in .14s cubic-bezier(0.16,1,0.3,1);
    display: flex; flex-direction: column; gap: 6px;
  }
  @keyframes lex-citation-pop-in { from { opacity:0; transform: translateY(-3px); } to { opacity:1; transform:translateY(0); } }
  .lex-citation-pop-header { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
  .lex-citation-pop-dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
  .lex-citation-pop-raw { font-size:11.5px; color:#8CA0B8; background:rgba(255,255,255,.03); border-radius:5px; padding:5px 7px; word-break:break-word; margin-bottom:2px; }
  .lex-citation-pop-action {
    display:block; text-align:left; width:100%; box-sizing:border-box;
    background: rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08);
    color:#C8D8E8; font-size:12px; font-weight:500; padding:7px 10px; border-radius:6px;
    cursor:pointer; text-decoration:none; transition: all .15s;
  }
  .lex-citation-pop-action:hover { background: rgba(59,130,246,.14); border-color: rgba(59,130,246,.4); color:#fff; }
  .lex-citation-pop-action.primary { background: rgba(59,130,246,.16); border-color: rgba(59,130,246,.4); color:#93C5FD; font-weight:600; }
  .lex-citation-pop-action.primary:hover { background: rgba(59,130,246,.26); color:#fff; }
`;

function ensureStylesInjected() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CITATION_CSS;
  document.head.appendChild(style);
}

// Compute a viewport-clamped position anchored to the trigger's rect —
// flips horizontally/vertically before clamping so the popover can never
// clip regardless of where the citation sits on screen.
function computePosition(rect) {
  let left = rect.left;
  let top = rect.bottom + 6;

  if (left + EST_WIDTH > window.innerWidth - GUTTER) {
    left = rect.right - EST_WIDTH;
  }
  if (top + EST_HEIGHT > window.innerHeight - GUTTER) {
    top = rect.top - EST_HEIGHT - 6;
  }

  left = Math.max(GUTTER, Math.min(left, window.innerWidth - EST_WIDTH - GUTTER));
  top = Math.max(GUTTER, Math.min(top, window.innerHeight - EST_HEIGHT - GUTTER));
  return { left, top };
}

export default function CitationLink({ raw }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [copiedFor, setCopiedFor] = useState('');
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  useEffect(() => { ensureStylesInjected(); }, []);

  const resolved = resolveCitation(raw);
  const meta = TREATMENT_META[resolved.treatment];
  const urls = buildSearchUrls(raw);

  const reposition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    // Auto-close if the anchor has scrolled out of the viewport entirely —
    // avoids a floating popover detached from its citation.
    if (rect.bottom < 0 || rect.top > window.innerHeight) { setOpen(false); return; }
    setPos(computePosition(rect));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    reposition();

    const onScroll = () => reposition();
    const onResize = () => reposition();
    const onMouseDown = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };

    window.addEventListener('scroll', onScroll, true); // capture phase — catches nested scroll containers
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, reposition]);

  const handleOpen = (e) => {
    e.stopPropagation();
    reposition();
    setOpen(true);
  };

  const copyAndOpen = (url, tag) => {
    navigator.clipboard.writeText(raw).catch(() => {});
    window.open(url, '_blank', 'noopener,noreferrer');
    setCopiedFor(tag);
    setTimeout(() => setCopiedFor(''), 1600);
  };

  return (
    <>
      <button ref={triggerRef} type="button" className="lex-citation-link" onClick={handleOpen} title={raw}>
        <span className="lex-citation-dot" style={{ background: meta.color }} />
        {raw}
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="lex-citation-popover"
          style={{ left: pos.left, top: pos.top }}
          onClick={e => e.stopPropagation()}
        >
          <div className="lex-citation-pop-header">
            <span className="lex-citation-pop-dot" style={{ background: meta.color }} />
            <span style={{ color: meta.color }}>{meta.label}</span>
          </div>
          <div className="lex-citation-pop-raw">{raw}</div>

          <a
            className="lex-citation-pop-action primary"
            href={urls.indianKanoon}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            Open in Indian Kanoon
          </a>
          <button className="lex-citation-pop-action" onClick={() => copyAndOpen(urls.sccOnline, 'scc')}>
            {copiedFor === 'scc' ? '✓ Copied — paste in SCC Online' : 'Search SCC Online'}
          </button>
          <button className="lex-citation-pop-action" onClick={() => copyAndOpen(urls.manupatra, 'manu')}>
            {copiedFor === 'manu' ? '✓ Copied — paste in Manupatra' : 'Search Manupatra'}
          </button>
        </div>,
        document.body
      )}
    </>
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
