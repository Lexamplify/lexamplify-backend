import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import {
  Sparkles, Send, Copy, Replace, CornerDownLeft, ArrowDownToLine, Loader2, FileSearch, ShieldAlert, Scale, ListChecks,
  Wand2, Scissors, BookOpen, Gavel, Handshake, FilePlus2, Eraser, Mail, X,
} from 'lucide-react';
import { sanitizeHtml, rawTextToHtml } from '../../tiptap/textToHtml.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const REVIEW = [
  { label: 'Summarise draft', Icon: FileSearch, prompt: 'Summarise this draft: what kind of agreement it is, who the parties are, the key commercial terms, and how it ends.' },
  { label: 'Risks & gaps', Icon: ShieldAlert, prompt: 'Review this draft for anything missing, one-sided, ambiguous or risky under Indian law. List each issue with the clause number and a one-line fix.' },
  { label: 'Indian-law check', Icon: Scale, prompt: 'Check this draft against Indian law: stamp duty, enforceability of restrictive clauses (Section 27 Indian Contract Act), governing law, jurisdiction and dispute resolution. Flag what to correct.' },
  { label: 'Details to fill', Icon: ListChecks, prompt: 'List every [Bracketed] detail still to be filled in this draft, grouped by clause, and say what information I need to collect from the client for each.' },
];
const ADD = [
  { label: 'Arbitration clause', Icon: Gavel, prompt: 'Draft an arbitration clause for this agreement under the Arbitration and Conciliation Act, 1996 (seat [City], sole arbitrator, English). Number it to fit this draft. Return only the clause.' },
  { label: 'Confidentiality', Icon: Handshake, prompt: 'Draft a confidentiality clause that fits this agreement, with standard exclusions and a survival period. Number it to fit this draft. Return only the clause.' },
  { label: 'Termination', Icon: Eraser, prompt: 'Draft a termination clause for this agreement covering notice, cure period and consequences of termination. Number it to fit this draft. Return only the clause.' },
  { label: 'Cover email', Icon: Mail, prompt: 'Draft a short, courteous cover email to the other party sending this draft for review (100 words, no legal jargon).' },
];
const BLANK = [
  { label: 'Which clauses does an NDA need?', Icon: FilePlus2, prompt: 'Which clauses should a mutual NDA under Indian law contain, and what are the common mistakes?' },
  { label: 'Draft a service agreement outline', Icon: FileSearch, prompt: 'Outline the clauses of a services agreement between two Indian companies, with a one-line note on each.' },
  { label: 'Rent agreement essentials', Icon: ListChecks, prompt: 'What must a residential rent agreement in India contain to be enforceable, including registration and stamp duty points?' },
];
const SELECTION = [
  { label: 'Improve wording', Icon: Wand2, prompt: 'Rewrite my selected text to be clearer and more precise, keeping the legal meaning. Return only the rewritten text.' },
  { label: 'More formal', Icon: Scale, prompt: 'Rewrite my selected text in formal legal drafting language. Return only the rewritten text.' },
  { label: 'Shorten', Icon: Scissors, prompt: 'Shorten my selected text by about a third without losing any legal meaning. Return only the rewritten text.' },
  { label: 'Plain language', Icon: BookOpen, prompt: 'Rewrite my selected text in plain English a client would understand. Return only the rewritten text.' },
  { label: 'More balanced', Icon: Handshake, prompt: 'Rewrite my selected text so it is balanced between both parties, keeping it enforceable under Indian law. Return only the rewritten text.' },
  { label: 'Explain this', Icon: FileSearch, prompt: 'Explain my selected text in plain language and say what to watch out for.' },
];

export function answerToHtml(text) {
  try { return sanitizeHtml(marked.parse(String(text || ''), { async: false })); } catch { return sanitizeHtml(rawTextToHtml(text)); }
}

const CSS = `
.ada { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--paper); }
.ada-head { display: flex; align-items: center; gap: 11px; padding: 14px 16px 12px; border-bottom: 1px solid var(--rule); }
.ada-mark { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; color: var(--on-accent, #fff); flex-shrink: 0;
  background: linear-gradient(145deg, var(--accent), color-mix(in srgb, var(--accent) 62%, #000)); box-shadow: 0 6px 16px -8px var(--accent), inset 0 1px 0 rgba(255,255,255,.22); }
.ada-title { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.ada-title b { font-size: 13.5px; color: var(--ink); }
.ada-title span { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ada-icon { width: 28px; height: 28px; border-radius: 8px; border: 0; background: transparent; color: var(--muted); cursor: pointer; display: grid; place-items: center; }
.ada-icon:hover { background: var(--paper-2); color: var(--ink); }
.ada-chat { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px 8px; display: flex; flex-direction: column; gap: 12px; scrollbar-width: thin; }
.ada-empty p { margin: 0 0 12px; font-size: 13px; line-height: 1.55; color: var(--ink-soft); }
.ada-label { font: 700 9.5px 'IBM Plex Mono', monospace; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin: 14px 0 7px; }
.ada-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.ada-grid.one { grid-template-columns: 1fr; }
.ada-quick { display: flex; align-items: center; gap: 8px; text-align: left; padding: 9px 11px; border-radius: 11px; border: 1px solid var(--rule); background: var(--paper-2);
  color: var(--ink); font-size: 12px; font-weight: 500; line-height: 1.25; cursor: pointer; transition: border-color .15s ease, background .15s ease, transform .12s ease; }
.ada-quick svg { color: var(--accent); flex-shrink: 0; }
.ada-quick:hover:not(:disabled) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--paper-2)); transform: translateY(-1px); }
.ada-quick:disabled { opacity: .5; cursor: not-allowed; }
.ada-tip { font-size: 11.5px; color: var(--muted); line-height: 1.5; margin-top: 18px; }
.ada-msg { max-width: 100%; font-size: 13px; line-height: 1.6; color: var(--ink); }
.ada-msg.user { align-self: flex-end; max-width: 88%; background: color-mix(in srgb, var(--accent) 12%, var(--paper-2)); border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--rule));
  border-radius: 14px 14px 4px 14px; padding: 9px 12px; white-space: pre-wrap; word-break: break-word; }
.ada-msg.assistant { align-self: stretch; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 4px 14px 14px 14px; padding: 11px 13px 9px; }
.ada-md > :first-child { margin-top: 0; } .ada-md > :last-child { margin-bottom: 0; }
.ada-md p { margin: 0 0 8px; } .ada-md ul, .ada-md ol { margin: 4px 0 8px; padding-left: 20px; } .ada-md li { margin: 3px 0; }
.ada-md h1, .ada-md h2, .ada-md h3 { font-size: 13.5px; margin: 10px 0 5px; } .ada-md strong { color: var(--ink); }
.ada-md table { border-collapse: collapse; font-size: 12px; } .ada-md td, .ada-md th { border: 1px solid var(--rule); padding: 4px 8px; }
.ada-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; padding-top: 9px; border-top: 1px dashed var(--rule); }
.ada-actions button { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 8px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink-soft);
  font-size: 11.5px; font-weight: 600; cursor: pointer; transition: all .15s ease; }
.ada-actions button:hover { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--paper)); }
.ada-actions button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent, #fff); }
.ada-actions button.primary:hover { filter: brightness(1.08); color: var(--on-accent, #fff); }
.ada-warn { margin-top: 8px; font-size: 11px; color: var(--major, #b7791f); }
.ada-typing { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); padding: 2px 4px; }
.ada-spin { animation: ada-spin .9s linear infinite; } @keyframes ada-spin { to { transform: rotate(360deg); } }
.ada-compose { padding: 10px 14px 14px; border-top: 1px solid var(--rule); background: var(--paper); }
.ada-sel { border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--rule)); background: color-mix(in srgb, var(--accent) 7%, var(--paper)); border-radius: 12px; padding: 8px 10px; margin-bottom: 9px; }
.ada-sel-head { display: flex; gap: 8px; align-items: flex-start; font-size: 11.5px; color: var(--ink-soft); font-style: italic; line-height: 1.4; }
.ada-sel-head span { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.ada-sel-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.ada-sel-chips button { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); font-size: 11px; font-weight: 600; cursor: pointer; }
.ada-sel-chips button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ada-row { display: flex; align-items: flex-end; gap: 8px; border: 1px solid var(--rule); border-radius: 14px; background: var(--paper-2); padding: 6px 6px 6px 12px; transition: border-color .15s ease, box-shadow .15s ease; }
.ada-row:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent); }
.ada .ada-row textarea { flex: 1; resize: none; border: 0 !important; outline: 0 !important; box-shadow: none !important; background: transparent !important; color: var(--ink); font-family: inherit; font-size: 13px; line-height: 20px; height: 32px; min-height: 32px; max-height: 140px; padding: 6px 0; margin: 0; overflow-y: auto; }
.ada .ada-row textarea::placeholder { color: var(--muted); }
.ada-send { width: 32px; height: 32px; border-radius: 10px; border: 0; background: var(--accent); color: var(--on-accent, #fff); cursor: pointer; display: grid; place-items: center; flex-shrink: 0; }
.ada-send:disabled { opacity: .4; cursor: not-allowed; }
.ada-foot { font-size: 10.5px; color: var(--muted); text-align: center; margin-top: 8px; }
`;

export default function AutoDraftAssistant({ text, editor, onNotify }) {
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState('');
  const chatRef = useRef(null);
  const taRef = useRef(null);
  const abortRef = useRef(null);
  const textRef = useRef(text);
  textRef.current = text;
  const hasDraft = !!(text && text.trim());

  // Track what the advocate has selected on the canvas, so rewrite actions and "Replace selection" know the target.
  useEffect(() => {
    if (!editor || editor.isDestroyed) { setSelection(''); return undefined; }
    const read = () => {
      try {
        const { from, to, empty } = editor.state.selection;
        setSelection(empty ? '' : editor.state.doc.textBetween(from, to, '\n').trim().slice(0, 4000));
      } catch { setSelection(''); }
    };
    editor.on('selectionUpdate', read);
    read();
    return () => { try { editor.off('selectionUpdate', read); } catch { /* editor already gone */ } };
  }, [editor]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy]);
  useEffect(() => {
    const ta = taRef.current;
    if (ta) { ta.style.height = '32px'; ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 32), 140)}px`; }
  }, [draft]);

  const ask = async (q0) => {
    const q = (q0 || '').trim();
    if (!q || busy) return;
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: q }]);
    setDraft(''); setBusy(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`${API_BASE}/api/documents/autodraft-assistant`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ message: q, history, selection, document_text: textRef.current || '' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message || j.error || 'The assistant could not answer just now.');
      setMsgs((m) => [...m, { role: 'assistant', content: j.answer, ai: j.ai !== false }]);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setMsgs((m) => [...m, { role: 'assistant', content: e.message || 'The assistant could not answer just now.', ai: false, failed: true }]);
    } finally {
      setBusy(false);
    }
  };

  const usable = !!editor && !editor.isDestroyed;
  const put = (content, where) => {
    if (!usable) { onNotify?.('Open or synthesize a draft first, then insert.'); return; }
    const html = answerToHtml(content);
    const chain = editor.chain();
    if (where === 'end') chain.focus('end').insertContent(html).run();
    else chain.focus().insertContent(html).run();   // with a selection this replaces it; otherwise inserts at the cursor
    onNotify?.(where === 'end' ? 'Added at the end of the draft.' : selection ? 'Replaced the selected text.' : 'Inserted at the cursor.');
  };
  const copy = async (content) => {
    try { await navigator.clipboard.writeText(content); onNotify?.('Copied to the clipboard.'); } catch { onNotify?.('Copy is blocked by the browser here.'); }
  };

  const Quick = ({ q }) => (
    <button type="button" className="ada-quick" disabled={busy} onClick={() => ask(q.prompt)}><q.Icon size={15} strokeWidth={1.8} /><span>{q.label}</span></button>
  );
  const placeholders = useMemo(() => (text || '').match(/\[([^\]\n]{1,80})\]/g) || [], [text]);

  return (
    <div className="ada" aria-label="Drafting assistant">
      <style>{CSS}</style>
      <div className="ada-head">
        <div className="ada-mark"><Sparkles size={17} strokeWidth={2} /></div>
        <div className="ada-title">
          <b>Drafting assistant</b>
          <span>{hasDraft ? `Reads your draft live${placeholders.length ? ` · ${placeholders.length} detail${placeholders.length === 1 ? '' : 's'} open` : ''}` : 'Ask drafting questions, or synthesize a draft first'}</span>
        </div>
        {msgs.length > 0 && <button type="button" className="ada-icon" onClick={() => { abortRef.current?.abort(); setMsgs([]); setBusy(false); }} title="Clear chat" aria-label="Clear chat"><Eraser size={15} /></button>}
      </div>

      <div className="ada-chat" ref={chatRef} aria-live="polite">
        {msgs.length === 0 && !busy && (
          <div className="ada-empty">
            <p>{hasDraft ? 'Ask anything about the draft on your canvas, or start with an action.' : 'The canvas is empty. You can still ask drafting questions here.'}</p>
            {hasDraft ? (
              <>
                <div className="ada-label">Review</div>
                <div className="ada-grid">{REVIEW.map((q) => <Quick key={q.label} q={q} />)}</div>
                <div className="ada-label">Add to the draft</div>
                <div className="ada-grid">{ADD.map((q) => <Quick key={q.label} q={q} />)}</div>
              </>
            ) : (
              <>
                <div className="ada-label">Try asking</div>
                <div className="ada-grid one">{BLANK.map((q) => <Quick key={q.label} q={q} />)}</div>
              </>
            )}
            <p className="ada-tip">Tip: select text on the canvas and rewrite actions appear below. Answers are drafting aids — check them before you use them.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ada-msg ${m.role}`}>
            {m.role === 'assistant' ? <div className="ada-md" dangerouslySetInnerHTML={{ __html: answerToHtml(m.content) }} /> : m.content}
            {m.role === 'assistant' && !m.failed && (
              <div className="ada-actions">
                <button type="button" className="primary" onClick={() => put(m.content, 'cursor')}>{selection ? <Replace size={13} /> : <CornerDownLeft size={13} />}{selection ? 'Replace selection' : 'Insert at cursor'}</button>
                <button type="button" onClick={() => put(m.content, 'end')}><ArrowDownToLine size={13} />Add at end</button>
                <button type="button" onClick={() => copy(m.content)}><Copy size={13} />Copy</button>
              </div>
            )}
            {m.role === 'assistant' && m.ai === false && !m.failed && <div className="ada-warn">Plain read-out of the draft — the AI service did not answer.</div>}
          </div>
        ))}
        {busy && <div className="ada-typing"><Loader2 size={14} className="ada-spin" /> Reading your draft…</div>}
      </div>

      <form className="ada-compose" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        {selection && (
          <div className="ada-sel">
            <div className="ada-sel-head"><span>“{selection}”</span></div>
            <div className="ada-sel-chips">{SELECTION.map((q) => <button type="button" key={q.label} disabled={busy} onClick={() => ask(q.prompt)}><q.Icon size={12} />{q.label}</button>)}</div>
          </div>
        )}
        <div className="ada-row">
          <textarea ref={taRef} rows={1} value={draft} aria-label="Ask the drafting assistant"
            placeholder={selection ? 'Ask about the selected text…' : hasDraft ? 'Ask about this draft…' : 'Ask a drafting question…'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }} />
          <button type="submit" className="ada-send" disabled={busy || !draft.trim()} aria-label="Ask">{busy ? <Loader2 size={16} className="ada-spin" /> : <Send size={16} />}</button>
        </div>
        <div className="ada-foot">Enter to send · Shift+Enter for a new line</div>
      </form>
    </div>
  );
}
