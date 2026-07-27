import { useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { useCitationStore } from './citationStore.js';

// Inline styles (not a shared stylesheet class) so this widget renders
// correctly regardless of where it's mounted — no dependency on a parent
// component's <style> block having already loaded or won a specificity fight.
const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
  padding: '1px 6px',
  margin: '0 1px',
  borderRadius: '10px',
  fontSize: '10.5px',
  fontWeight: 700,
  background: 'rgba(59,130,246,0.16)',
  color: '#93C5FD',
  border: '1px solid rgba(59,130,246,0.35)',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  verticalAlign: 'baseline',
};

const hoverCardStyle = {
  position: 'absolute',
  zIndex: 50,
  bottom: 'calc(100% + 6px)',
  left: 0,
  width: '280px',
  background: '#111827',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '8px',
  padding: '10px 12px',
  boxShadow: '0 12px 24px rgba(0,0,0,0.45)',
  fontSize: '12px',
  lineHeight: 1.45,
  color: '#E5E7EB',
  whiteSpace: 'normal',
};

export default function CitationBadge({ node }) {
  const citationId = node.attrs.citationId;
  // Scoped selector — only re-renders THIS badge when ITS OWN citation
  // entry changes, never on unrelated store writes.
  const citation = useCitationStore((state) => state.citations[citationId]);
  // Hover is local component state, never written to the store or to the
  // editor — hovering never triggers a TipTap transaction/re-render.
  const [hovered, setHovered] = useState(false);

  return (
    <NodeViewWrapper as="span" style={{ position: 'relative', display: 'inline-block' }}>
      <span
        style={pillStyle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        contentEditable={false}
        data-citation-id={citationId}
      >
        📖 {citation?.shortLabel || citation?.caseName || 'Citation'}
      </span>
      {hovered && citation && (
        <span style={hoverCardStyle} contentEditable={false}>
          <strong style={{ display: 'block', marginBottom: '4px', color: '#93C5FD' }}>
            {citation.caseName}
          </strong>
          <span>{citation.summary}</span>
        </span>
      )}
    </NodeViewWrapper>
  );
}
