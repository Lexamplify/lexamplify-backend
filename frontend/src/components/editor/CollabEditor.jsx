import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, FontFamily } from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { getIdentity } from '../../collab/identity.js';
import * as Ic from '../../icons.jsx';

// The real editor: TipTap bound to a Yjs document for realtime co-editing + local autosave.
// `ydoc`/`provider` come from useCollabDoc in the parent. Collaboration owns history, so the
// StarterKit undo/redo is disabled and undo flows through the shared y-undo stack.

function Btn({ on, active, disabled, title, children }) {
  return (
    <button type="button" className={`ced-tool ${active ? 'is-active' : ''}`} onMouseDown={(e) => e.preventDefault()}
      onClick={on} disabled={disabled} title={title} aria-label={title}>{children}</button>
  );
}
const Sep = () => <span className="ced-sep" />;

export default function CollabEditor({ ydoc, provider, synced, seedHtml, editable = true, onEditor, onSelection }) {
  const me = getIdentity();

  const editor = useEditor({
    editable,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Underline,
      TextStyle,
      FontFamily,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: 'Start drafting, or ask the assistant on the right to write it for you…' }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({ provider, user: { name: me.name, color: me.color } }),
    ],
    editorProps: { attributes: { class: 'ced-doc', spellcheck: 'true' } },
  }, [ydoc, provider]);

  // Seed the shared doc once, when it's empty after local + peer sync.
  useEffect(() => {
    if (!editor || !synced) return;
    const frag = ydoc.getXmlFragment('default');
    if (frag.length === 0 && seedHtml) {
      editor.commands.setContent(seedHtml, { emitUpdate: true });
    }
  }, [editor, synced, ydoc, seedHtml]);

  useEffect(() => { if (editor) editor.setEditable(editable); }, [editor, editable]);

  useEffect(() => {
    if (!editor) return undefined;
    onEditor?.(editor);
    const emit = () => {
      const { from, to } = editor.state.selection;
      onSelection?.(editor.state.doc.textBetween(from, to, ' '));
    };
    editor.on('selectionUpdate', emit);
    emit();
    return () => { editor.off('selectionUpdate', emit); };
  }, [editor, onEditor, onSelection]);

  if (!editor) return <div className="ced-loading">Preparing editor…</div>;

  return (
    <div className="ced">
      {editable && (
        <div className="ced-bar">
          <Btn on={() => editor.chain().focus().undo().run()} title="Undo"><Ic.Undo size={16} /></Btn>
          <Btn on={() => editor.chain().focus().redo().run()} title="Redo"><Ic.Redo size={16} /></Btn>
          <Sep />
          <select className="ced-select" value={currentHeading(editor)} onChange={(e) => applyHeading(editor, e.target.value)} title="Style">
            <option value="p">Body</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>
          <select className="ced-select" onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()} title="Font" defaultValue="">
            <option value="" disabled>Font</option>
            <option value="var(--font-serif), Georgia, serif">Serif</option>
            <option value="var(--font-sans), system-ui, sans-serif">Sans</option>
            <option value="'Times New Roman', serif">Times</option>
          </select>
          <Sep />
          <Btn on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold"><b>B</b></Btn>
          <Btn on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic"><i>I</i></Btn>
          <Btn on={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline"><u>U</u></Btn>
          <Sep />
          <Btn on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list"><Ic.List size={16} /></Btn>
          <Btn on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list"><Ic.ListOrdered size={16} /></Btn>
          <Btn on={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote"><Ic.Quote size={16} /></Btn>
          <Sep />
          <Btn on={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left"><Ic.AlignLeft size={16} /></Btn>
          <Btn on={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Center"><Ic.AlignCenter size={16} /></Btn>
          <Btn on={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify"><Ic.AlignJustify size={16} /></Btn>
        </div>
      )}
      <div className="ced-scroll">
        <div className="ced-paper"><EditorContent editor={editor} /></div>
      </div>
    </div>
  );
}

function currentHeading(editor) {
  for (const lvl of [1, 2, 3]) if (editor.isActive('heading', { level: lvl })) return String(lvl);
  return 'p';
}
function applyHeading(editor, v) {
  if (v === 'p') editor.chain().focus().setParagraph().run();
  else editor.chain().focus().toggleHeading({ level: Number(v) }).run();
}
