import { useMemo, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { rawTextToHtml } from '../../tiptap/textToHtml.js';
import { BlankField } from '../../tiptap/BlankFieldNode.js';

// Same fillable-blank conventions the backend prompt now targets and the
// old parser recognized: bracketed placeholders, Rs.-prefixed underscores,
// bare underscore runs, and dot-leader lines as a fallback for anything
// that still slips through un-bracketed.
const BLANK_PATTERN = /(Rs\.\s*_{2,}|_{3,}|\[[A-Za-z0-9\s,./_'-]{2,80}\]|(?:\.\s?){4,})/g;

// Tags blanks on the RAW text before marked() ever sees it, not after HTML
// conversion — a raw run of 3+ underscores is ambiguous markdown emphasis
// syntax, and letting marked() parse it first risks it mangling exactly the
// placeholders we're trying to preserve.  sentinels are inert to
// markdown and HTML-safe, so they survive the marked() pass untouched and
// get swapped for real blank-field spans afterward.
function buildEditorHtml(rawArgumentText) {
  if (!rawArgumentText) return '<p></p>';
  const blanksMeta = [];
  let counter = 0;

  const tokenized = rawArgumentText.replace(BLANK_PATTERN, (raw) => {
    const id = `blank_${counter++}`;
    let label;
    if (raw.startsWith('[') && raw.endsWith(']')) label = raw.slice(1, -1).trim();
    else if (/Rs\./i.test(raw)) label = 'Rs. Amount';
    else label = 'Fill value';
    blanksMeta.push({ id, label });
    return `${id}`;
  });

  let html = rawTextToHtml(tokenized);

  blanksMeta.forEach(({ id, label }) => {
    const token = `${id}`;
    const span = `<span data-blank-id="${id}" data-blank-label="${label.replace(/"/g, '&quot;')}" data-blank-value=""></span>`;
    html = html.split(token).join(span);
  });

  return html;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function PleadingDocument({ rawArgumentText, matterTitle, apiBase }) {
  const initialHtml = useMemo(() => buildEditorHtml(rawArgumentText), [rawArgumentText]);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const editor = useEditor({
    extensions: [StarterKit, BlankField],
    content: initialHtml,
    editable: false, // the surrounding legal text is read-only; only the
    // blank fields (real <input>s inside their NodeView) accept typing —
    // that works regardless of this flag, since it only gates ProseMirror's
    // own contentEditable input handling, not plain DOM form elements.
  });

  const handleCopyText = () => {
    if (!editor) return;
    const el = document.createElement('div');
    el.innerHTML = editor.getHTML();
    navigator.clipboard.writeText(el.innerText || el.textContent || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportDocx = async () => {
    if (!editor) return;
    setExporting(true);
    setExportError('');
    try {
      const res = await fetch(`${apiBase}/api/contract/export-form-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: editor.getHTML(), title: matterTitle }),
      });
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      downloadBlob(blob, `${matterTitle.replace(/[^A-Za-z0-9]+/g, '_')}.docx`);
    } catch (err) {
      setExportError(err.message || 'Export failed.');
    }
    setExporting(false);
  };

  return (
    <div>
      <div className="vc-doc-toolbar">
        <button type="button" className="vc-tool-btn" onClick={handleCopyText}>
          {copied ? '✓ Copied' : 'Copy text'}
        </button>
        <button type="button" className="vc-tool-btn" onClick={handleExportDocx} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export as .docx'}
        </button>
        <button
          type="button"
          className="vc-tool-btn"
          disabled
          title="Regenerating a single section isn't wired up yet — it would require re-running the drafting step server-side."
        >
          Regenerate section
        </button>
      </div>
      {exportError && <div className="vc-doc-error">{exportError}</div>}
      <div className="vc-paper">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
