import Highlight from '@tiptap/extension-highlight';

// The stock Highlight mark has no way to tag a specific span with an
// application-level id — extend it rather than hand-rolling a new mark, so
// we keep Highlight's built-in setHighlight()/toggleHighlight() commands and
// its data-color/style rendering, and only add what's missing: `id`.
// `multicolor: true` must be passed via .configure() where this is used —
// that's what makes Highlight accept a `color` attribute in the first place.
export const CommentHighlight = Highlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-comment-id': attrs.id } : {}),
      },
    };
  },
});
