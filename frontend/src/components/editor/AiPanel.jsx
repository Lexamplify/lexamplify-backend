import { useState, useRef, useEffect } from 'react';
import * as Ic from '../../icons.jsx';
import { runAiEdit, hasLLM, STANDARD_CLAUSES } from '../../collab/aiEdit.js';

// "Ask AI to edit" — the user describes a change in plain words and it is applied to the
// WordCraft document through the bridge (insert at cursor, or rebuild the whole draft).

const QUICK = [
  { label: 'Strengthen', instruction: 'Strengthen this argument and make it more forceful.' },
  { label: 'Shorten', instruction: 'Make this more concise.' },
  { label: 'Formal', instruction: 'Make the language more formal and professional.' },
  { label: 'Plain language', instruction: 'Rewrite this in plainer, clearer language.' },
];
const CLAUSES = Object.keys(STANDARD_CLAUSES);

function textToHtml(t) {
  return `<div>${t
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>`)
    .join('')}</div>`;
}

export default function AiPanel({ bridge, canEdit }) {
  const [log, setLog] = useState([
    { who: 'ai', text: 'Describe a change and I’ll apply it. I can draft new clauses, rewrite selected text, or shape the whole document.' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [log, busy]);

  async function apply(instruction) {
    if (!bridge || !canEdit || busy) return;
    const fullText = bridge.text();
    setLog((l) => [...l, { who: 'you', text: instruction }]);
    setBusy(true);
    try {
      const r = await runAiEdit({ instruction, selection: '', fullText });
      if (r.mode === 'insert') {
        bridge.insertText('\n' + r.text + '\n');
      } else {
        // Whole-document rewrite: rebuild as HTML and reload the doc.
        bridge.loadHtml(textToHtml(r.text));
      }
      setLog((l) => [...l, { who: 'ai', text: r.note, undo: true }]);
    } catch (e) {
      setLog((l) => [...l, { who: 'ai', text: 'Could not apply that edit: ' + e.message }]);
    } finally {
      setBusy(false);
    }
  }

  function onSend(e) {
    e.preventDefault();
    const v = input.trim();
    if (!v) return;
    setInput('');
    apply(v);
  }

  return (
    <aside className="aip">
      <div className="aip-head">
        <span className="lx-badge"><Ic.Sparkle size={13} /> AI assistant</span>
        {hasLLM() && <span className="aip-dot" title="Your AI model is connected" />}
      </div>

      <div className="aip-log" ref={scrollRef}>
        {log.map((m, i) => (
          <div key={i} className={`aip-msg aip-msg--${m.who}`}>
            {m.text}
            {m.undo && (
              <button className="aip-undo" onClick={() => bridge.exec('edit.undo', {})}><Ic.Undo size={12} /> Undo</button>
            )}
          </div>
        ))}
        {busy && <div className="aip-msg aip-msg--ai aip-typing"><span /><span /><span /></div>}
      </div>

      {canEdit ? (
        <div className="aip-foot">
          <div className="aip-chips">
            {QUICK.map((q) => <button key={q.label} className="aip-chip" disabled={busy} onClick={() => apply(q.instruction)}>{q.label}</button>)}
          </div>
          <div className="aip-chips aip-chips--clause">
            <span className="aip-chips-label">Add clause:</span>
            {CLAUSES.map((c) => <button key={c} className="aip-chip aip-chip--ghost" disabled={busy} onClick={() => apply('Add a standard ' + c + ' clause.')}>{c}</button>)}
          </div>
          <form className="aip-input" onSubmit={onSend}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask to edit, add a clause or rephrase…" disabled={busy} />
            <button type="submit" className="aip-send" disabled={busy || !input.trim()} aria-label="Send"><Ic.Arrow size={16} /></button>
          </form>
          <div className="aip-hint">Tip: place your cursor in the document first — clauses insert there.</div>
        </div>
      ) : (
        <div className="aip-foot"><div className="aip-readonly">You have view-only access. Ask the owner for edit rights to use the assistant.</div></div>
      )}
    </aside>
  );
}
