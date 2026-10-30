import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import CitationBadge from './CitationBadge.jsx';

export const InlineCitation = Node.create({
  name: 'inlineCitation',
  group: 'inline',
  inline: true,
  atom: true, // indestructible unit — cursor cannot enter it, backspace removes it whole

  addAttributes() {
    return {
      citationId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-citation-id'),
        renderHTML: (attrs) => (attrs.citationId ? { 'data-citation-id': attrs.citationId } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-citation-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'inline-citation-node' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CitationBadge);
  },
});
