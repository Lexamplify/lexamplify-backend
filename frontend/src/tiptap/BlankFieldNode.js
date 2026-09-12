import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import BlankFieldView from './BlankField.jsx';

// Fillable field for legal pleadings (court name, date, amount, %) — the
// custom "blot/embed" the redesign brief asked for, built on this codebase's
// existing Tiptap stack (see InlineCitationNode.js for the same pattern)
// rather than introducing Quill as a second, unrelated rich-text engine.
//
// renderHTML emits the CURRENT value (or the bracketed label as a
// placeholder) as the node's own text content — that's what lets a plain
// editor.getHTML() call, with no extra serialization step, already contain
// the filled-in text for both "Copy text" and the .docx export POST.
export const BlankField = Node.create({
  name: 'blankField',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      blankId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-blank-id'),
        renderHTML: (attrs) => (attrs.blankId ? { 'data-blank-id': attrs.blankId } : {}),
      },
      label: {
        default: 'Fill value',
        parseHTML: (el) => el.getAttribute('data-blank-label') || 'Fill value',
        renderHTML: (attrs) => ({ 'data-blank-label': attrs.label }),
      },
      value: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-blank-value') || '',
        renderHTML: (attrs) => ({ 'data-blank-value': attrs.value || '' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-blank-id]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const text = node.attrs.value?.trim() ? node.attrs.value : `[${node.attrs.label}]`;
    return ['span', mergeAttributes(HTMLAttributes, { class: 'blank-field-node' }), text];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlankFieldView);
  },
});
