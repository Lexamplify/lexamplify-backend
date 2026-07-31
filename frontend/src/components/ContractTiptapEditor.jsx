import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { RiskDecoration, updateRiskDecorations } from '../tiptap/riskDecorationExtension.js';
import { AiInsertion, AiDeletion, TrackChangesCommands } from '../tiptap/trackChangesMarks.js';
import { InlineCitation } from '../tiptap/InlineCitationNode.js';
import { CommentHighlight } from '../tiptap/commentHighlightMark.js';
import { rawTextToHtml } from '../tiptap/textToHtml.js';

function generateCommentId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// "Logical" text = as if every pending suggestion were already resolved:
// ai-deletion-marked spans are dropped, everything else (including pending
// ai-insertion text) is kept. Matches Word/Google Docs' "clean view"
// semantics for a document with open tracked changes, and is what gets
// synced back to the parent's rawText — NOT editor.getText() directly,
// which would double-count an unresolved suggestion's old + new text.
function getLogicalText(editor) {
  let text = '';
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    const isDeleted = node.marks.some((m) => m.type.name === 'aiDeletion');
    if (!isDeleted) text += node.text;
  });
  return text;
}

function ToolbarButton({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className={`toolbar-btn${active ? ' active' : ''}`}
    >
      {children}
    </button>
  );
}

function ContractEditorToolbar({ editor }) {
  if (!editor) return null;
  return (
    <div className="rich-text-toolbar">
      <ToolbarButton title="Undo" onClick={() => editor.chain().focus().undo().run()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
      </ToolbarButton>
      <ToolbarButton title="Redo" onClick={() => editor.chain().focus().redo().run()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></svg>
      </ToolbarButton>
      <div className="toolbar-divider" />
      <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong style={{ fontSize: '13px' }}>B</strong>
      </ToolbarButton>
      <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em style={{ fontSize: '13px' }}>I</em>
      </ToolbarButton>
      <ToolbarButton title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span style={{ textDecoration: 'underline', fontSize: '13px' }}>U</span>
      </ToolbarButton>
      <div className="toolbar-divider" />
      <ToolbarButton title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg>
      </ToolbarButton>
      <ToolbarButton title="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>
      </ToolbarButton>
      <ToolbarButton title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" /></svg>
      </ToolbarButton>
      <ToolbarButton title="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
      </ToolbarButton>
    </div>
  );
}

// Selecting text now surfaces this instead of a toolbar button — comment /
// draft-revision only make sense in the context of a live selection, so a
// tethered menu that appears exactly where the selection is beats a
// permanently-visible toolbar icon the user has to go hunt for.
function CommentBubbleMenu({ editor, onAction }) {
  if (!editor) return null;
  return (
    <BubbleMenu editor={editor} shouldShow={({ state }) => !state.selection.empty}>
      <div className="ca-bubble-menu">
        <button
          type="button"
          className="ca-bubble-menu-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onAction('comment')}
        >
          💬 Comment
        </button>
        <button
          type="button"
          className="ca-bubble-menu-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onAction('draft-revision')}
        >
          🪄 Draft Revision
        </button>
      </div>
    </BubbleMenu>
  );
}

function ContractTiptapEditor({
  documentKey, initialRawText, clauses, scanStrategy, onRiskClick, onTextChange, onEditorReady, editable = true,
  onCommentRequest, onHighlightClick,
}) {
  // Callback props are read through refs inside extension options so the
  // editor instance itself only gets rebuilt when `documentKey` changes —
  // not on every parent re-render (which would otherwise tear down and
  // recreate the whole ProseMirror view, losing the cursor/undo history).
  // Written from an effect (not inline during render) so ref mutation never
  // happens during the render phase itself.
  const onRiskClickRef = useRef(onRiskClick);
  useEffect(() => { onRiskClickRef.current = onRiskClick; }, [onRiskClick]);
  const onTextChangeRef = useRef(onTextChange);
  useEffect(() => { onTextChangeRef.current = onTextChange; }, [onTextChange]);
  const onHighlightClickRef = useRef(onHighlightClick);
  useEffect(() => { onHighlightClickRef.current = onHighlightClick; }, [onHighlightClick]);
  const debounceTimerRef = useRef(null);
  const lastHighlightIdRef = useRef(null);

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        TextAlign.configure({ types: ['paragraph'] }),
        // onRiskClickRef always holds the latest onRiskClick (kept current
        // via the effect above); this closure is only ever invoked later,
        // from a real editor click, never read synchronously during render.
        // eslint-disable-next-line react-hooks/refs
        RiskDecoration.configure({
          clauses: clauses || [],
          scanStrategy,
          onRiskClick: (id) => onRiskClickRef.current?.(id),
        }),
        AiInsertion,
        AiDeletion,
        TrackChangesCommands,
        InlineCitation,
        CommentHighlight.configure({ multicolor: true }),
      ],
      content: rawTextToHtml(initialRawText),
      editable,
      onUpdate: ({ editor: ed }) => {
        // Debounced — onUpdate fires per keystroke/transaction, and syncing
        // rawText that often would mean a sessionStorage write per keystroke
        // on a long contract. 400ms is short enough that a click away from
        // the editor (export, rewrite, tab switch) has always already seen
        // the flush by the time it reads rawText.
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          onTextChangeRef.current?.(getLogicalText(ed));
        }, 400);
      },
      // Bidirectional scrolling (editor → card): whenever the cursor lands
      // inside a comment highlight, look up its id via TipTap's own
      // getAttributes() and let the parent scroll the matching card into
      // view. Guarded by lastHighlightIdRef so clicking around inside the
      // SAME highlighted span doesn't re-fire the scroll on every keystroke.
      onSelectionUpdate: ({ editor: ed }) => {
        const id = ed.getAttributes('highlight').id || null;
        if (id !== lastHighlightIdRef.current) {
          lastHighlightIdRef.current = id;
          if (id) onHighlightClickRef.current?.(id);
        }
      },
    },
    [documentKey]
  );

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

  // BubbleMenu action: capture the selection's from/to and the selected text
  // THE INSTANT the user clicks — not when they later hit Save on the
  // comment card. By then a click on the sidebar/card has already blurred
  // the editor, and ProseMirror's selection state does not survive that
  // (it collapses/resets), so from/to captured at Save time would be wrong
  // or missing entirely.
  const handleBubbleAction = (mode) => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const text = editor.state.doc.textBetween(from, to, ' ');
    const id = generateCommentId();
    editor.chain().setTextSelection({ from, to }).setHighlight({ id, color: '#fef08a' }).run();
    onCommentRequest?.({ commentId: id, text, from, to, mode });
  };

  // Reactive risk-decoration refresh — a meta-only transaction, never a
  // setContent call, so this never touches the cursor or undo history.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      updateRiskDecorations(editor, clauses || [], scanStrategy);
    }
  }, [editor, clauses, scanStrategy]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="tiptap-editor-shell">
      <ContractEditorToolbar editor={editor} />
      <CommentBubbleMenu editor={editor} onAction={handleBubbleAction} />
      <EditorContent editor={editor} className="scanner-body" />
    </div>
  );
}

export default ContractTiptapEditor;
