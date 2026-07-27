import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { RiskDecoration, updateRiskDecorations } from '../tiptap/riskDecorationExtension.js';
import { AiInsertion, AiDeletion, TrackChangesCommands } from '../tiptap/trackChangesMarks.js';
import { InlineCitation } from '../tiptap/InlineCitationNode.js';
import { UserComment } from '../tiptap/userCommentMark.js';
import { rawTextToHtml } from '../tiptap/textToHtml.js';

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
      <div className="toolbar-divider" />
      <ToolbarButton
        title="Comment on selection"
        onClick={() => {
          const ok = editor.commands.setComment();
          if (!ok) alert('Select some text first to attach a comment.');
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
      </ToolbarButton>
    </div>
  );
}

function ContractTiptapEditor({
  documentKey, initialRawText, clauses, scanStrategy, onRiskClick, onTextChange, onEditorReady, editable = true,
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
  const debounceTimerRef = useRef(null);

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
        UserComment,
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
    },
    [documentKey]
  );

  useEffect(() => {
    onEditorReady?.(editor);
  }, [editor, onEditorReady]);

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
      <EditorContent editor={editor} className="scanner-body" />
    </div>
  );
}

export default ContractTiptapEditor;
