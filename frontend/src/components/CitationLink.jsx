import React, { useState } from 'react';
import { parseCitations, getTreatment, TREATMENT_META } from '../utils/citationParser';
import { buildKanoonUrl } from '../utils/citationResolver';
import { resolveKanoonDoc } from '../utils/kanoonFetcher';

const STYLE_ID = 'lex-citation-link-styles-v4';
const CITATION_CSS = `
  .lex-citation-link {
    display: inline-flex; align-items: center; gap: 4px;
    color: #7EB3F5; text-decoration: none; padding: 0 1px;
    border-bottom: 1px dashed rgba(126,179,245,0.45);
    transition: color .15s, border-color .15s, opacity .15s;
  }
  .lex-citation-link:hover { color: #A5C9FF; border-bottom-color: rgba(165,201,255,0.7); }
  .lex-citation-link.is-resolving { opacity: 0.6; cursor: wait; }
  .lex-citation-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .lex-citation-dot.is-pulsing { animation: lex-citation-pulse 0.9s ease-in-out infinite; }
  @keyframes lex-citation-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
`;

function ensureStylesInjected() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CITATION_CSS;
  document.head.appendChild(style);
}
ensureStylesInjected();

// Pre-open pattern: browsers only allow window.open() to bypass the popup
// blocker when called synchronously inside the click handler. So we open a
// blank tab immediately, resolve the exact doc URL in the background, then
// redirect that already-open tab — an async window.open() would get blocked.
export default function CitationLink({ raw, year, caseTitle }) {
  const [isResolving, setIsResolving] = useState(false);
  const meta = TREATMENT_META[getTreatment(raw)];
  const fallbackUrl = buildKanoonUrl(raw, year, caseTitle);

  const handleClick = async (e) => {
    e.preventDefault();
    const targetTab = window.open('about:blank', '_blank');
    if (!targetTab) {
      window.location.href = fallbackUrl;
      return;
    }

    setIsResolving(true);
    const resolvedUrl = await resolveKanoonDoc(raw);
    try {
      targetTab.location.href = resolvedUrl;
    } catch {
      // user closed the placeholder tab before resolution finished
    }
    setIsResolving(false);
  };

  return (
    <a
      className={`lex-citation-link${isResolving ? ' is-resolving' : ''}`}
      href={fallbackUrl}
      onClick={handleClick}
      target="_blank"
      rel="noopener noreferrer"
      title={raw}
    >
      <span className={`lex-citation-dot${isResolving ? ' is-pulsing' : ''}`} style={{ background: meta.color }} />
      {raw}
    </a>
  );
}

// Splits raw text into plain-text segments interleaved with <CitationLink>
// nodes for every detected citation — drop-in replacement for rendering any
// free-text block that may contain legal citations. `caseTitle` is optional —
// pass it whenever the surrounding text belongs to a single known case (an
// entry description, a judgment headnote) so citations inside it can be
// routed via the more precise appellant+citation search.
export function renderWithCitations(text, caseTitle) {
  if (!text) return text;
  const citations = parseCitations(text);
  if (citations.length === 0) return text;

  const nodes = [];
  let cursor = 0;
  citations.forEach((c, i) => {
    if (c.index > cursor) nodes.push(text.slice(cursor, c.index));
    nodes.push(<CitationLink key={`cite-${i}-${c.index}`} raw={c.raw} year={c.components?.year} caseTitle={caseTitle} />);
    cursor = c.index + c.length;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
