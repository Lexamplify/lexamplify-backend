import { Mark } from '@tiptap/core';

function generateCommentId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// priority: 100 — same StarterKit-collision guard used for the track-changes
// marks; nothing in StarterKit currently claims span.user-comment, but a
// generic bare `span` parse rule from a future extension could, and this
// costs nothing to guard against now.
export const UserComment = Mark.create({
  name: 'userComment',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => (attrs.commentId ? { 'data-comment-id': attrs.commentId } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span.user-comment', priority: 100 }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'user-comment' }, 0];
  },

  addCommands() {
    return {
      // Wraps the current selection in a userComment mark and notifies the
      // frontend so the sidebar can open a comment box for this span. Fails
      // (returns false) on an empty selection — there's nothing to anchor
      // a comment to.
      setComment:
        (commentId) =>
        ({ tr, state, dispatch }) => {
          const { from, to, empty } = state.selection;
          if (empty) return false;

          const id = commentId || generateCommentId();
          if (dispatch) {
            const text = state.doc.textBetween(from, to, ' ');
            tr.addMark(from, to, state.schema.marks.userComment.create({ commentId: id }));
            dispatch(tr);

            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('lex:tiptap-comment', { detail: { commentId: id, text, from, to } })
              );
            }
          }
          return true;
        },
    };
  },
});
