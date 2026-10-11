import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import { Sparkles, Send, Copy, CornerDownLeft, Replace, FileSearch, CalendarClock, Users, ListChecks, MessageSquareText, ShieldAlert, Wand2, Scale, Scissors, BookOpen, Loader2, X } from 'lucide-react';
import { rawTextToHtml, sanitizeHtml } from '../../../tiptap/textToHtml.js';
import { vaultApi } from '../vaultApi.js';

const UNDERSTAND = [
  { label: 'Summarise', Icon: FileSearch, prompt: 'Summarise this document for me in plain language: what it is, who is involved, and what it asks for or decides.' },
  { label: 'Key dates & deadlines', Icon: CalendarClock, prompt: 'List every date, deadline and next step mentioned in this document, in order, with what happens on each.' },
  { label: 'Parties & claims', Icon: Users, prompt: 'Who are the parties, their counsel, and what does each side claim or admit in this document?' },
  { label: 'Spot gaps & risks', Icon: ShieldAlert, prompt: 'Point out anything missing, inconsistent or risky in this document that the advocate should check.' },
];
const DRAFT = [
  { label: 'Next steps', Icon: ListChecks, prompt: 'Based only on this document, what should the advocate do next on this matter, and by when?' },
  { label: 'Client update', Icon: MessageSquareText, prompt: 'Draft a short, plain-language update for the client about this document (no legal jargon, 120 words).' },
];
const SELECTION = [
  { label: 'Improve wording', Icon: Wand2, prompt: 'Rewrite my selected text to be clearer and more precise, keeping the legal meaning. Return only the rewritten text.' },
  { label: 'More formal', Icon: Scale, prompt: 'Rewrite my selected text in formal legal drafting language. Return only the rewritten text.' },
  { label: 'Shorten', Icon: Scissors, prompt: 'Shorten my selected text by about a third without losing any legal meaning. Return only the rewritten text.' },
  { label: 'Plain language', Icon: BookOpen, prompt: 'Rewrite my selected text in plain English a client would understand. Return only the rewritten text.' },
  { label: 'Explain this', Icon: FileSearch, prompt: 'Explain my selected text in plain language and say what to watch out for.' },
];

export function mdToHtml(text) {
  try {
    return sanitizeHtml(marked.parse(String(text || ''), { async: false }));
  } catch {
    return sanitizeHtml(rawTextToHtml(text));
  }
}

export default function AssistantPanel({ docId, ready, editor, selection, getText, onClose, onNotify }) {
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const chatRef = useRef(null);
  const taRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => { setMsgs([]); setDraft(''); }, [docId]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { const el = chatRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, busy]);
  useEffect(() => {
    const ta = taRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; }
  }, [draft]);

  const ask = async (text) => {
    const q = (text || '').trim();
    if (!q || busy || !ready) return;
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: 'user', content: q }]);
    setDraft(''); setBusy(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await vaultApi.assistant(docId, { message: q, history, selection, document_text: getText() }, ac.signal);
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, ai: r.ai !== false }]);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setMsgs((m) => [...m, { role: 'assistant', content: e.message || 'The assistant could not answer just now.', ai: false, failed: true }]);
    } finally {
      setBusy(false);
    }
  };

  const put = (content) => {
    if (!editor || editor.isDestroyed) return;
    editor.chain().focus().insertContent(mdToHtml(content)).run();
  };
  const copy = async (content) => {
    try { await navigator.clipboard.writeText(content); onNotify?.('ok', 'Copied to the clipboard.'); } catch { onNotify?.('err', 'Copy is blocked by the browser here.'); }
  };
  const QuickBtn = ({ q }) => (
    <button type="button" className="vw-quick" disabled={busy || !ready} onClick={() => ask(q.prompt)}><q.Icon size={15} strokeWidth={1.8} /><span>{q.label}</span></button>
  );

  return (
    <aside className="vw-ai" aria-label="Document assistant">
      <div className="vw-ai-head">
        <div className="vw-ai-mark"><Sparkles size={16} strokeWidth={2} /></div>
        <div className="vw-ai-title"><b>Document assistant</b><span>Reads only this document, including your unsaved edits</span></div>
        <button type="button" className="vw-mini icon" onClick={onClose} aria-label="Hide assistant"><X size={15} /></button>
      </div>
      <div className="vw-chat" ref={chatRef} aria-live="polite">
        {msgs.length === 0 && !busy && (
          <div className="vw-ai-empty">
            <p>Ask anything about this document, or start with an action.</p>
            <div className="vw-quick-label">Understand</div>
            <div className="vw-quick-grid">{UNDERSTAND.map((q) => <QuickBtn key={q.label} q={q} />)}</div>
            <div className="vw-quick-label">Draft</div>
            <div className="vw-quick-grid">{DRAFT.map((q) => <QuickBtn key={q.label} q={q} />)}</div>
            <p className="vw-ai-tip">Tip: select text in the page and the rewrite actions appear here. Check anything the assistant says against the source.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`vw-msg ${m.role}`}>
            {m.role === 'assistant' ? <div className="vw-md" dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} /> : m.content}
            {m.role === 'assistant' && !m.failed && (
              <div className="vw-msg-actions">
                <button type="button" onClick={() => put(m.content)}>{selection ? <Replace size={13} /> : <CornerDownLeft size={13} />}{selection ? 'Replace selection' : 'Insert at cursor'}</button>
                <button type="button" onClick={() => copy(m.content)}><Copy size={13} />Copy</button>
              </div>
            )}
            {m.role === 'assistant' && m.ai === false && !m.failed && <div className="vw-warn">Plain read-out of the document — the AI service did not answer.</div>}
          </div>
        ))}
        {busy && <div className="vw-typing"><Loader2 size={14} className="vw-spin" /> Reading the document…</div>}
      </div>
      <form className="vw-compose" onSubmit={(e) => { e.preventDefault(); ask(draft); }}>
        {selection && (
          <div className="vw-sel">
            <div className="vw-sel-head"><b>{selection.length > 200 ? `${selection.slice(0, 200)}…` : selection}</b></div>
            <div className="vw-sel-chips">{SELECTION.map((q) => <button type="button" key={q.label} disabled={busy} onClick={() => ask(q.prompt)}><q.Icon size={13} />{q.label}</button>)}</div>
          </div>
        )}
        <div className="vw-compose-row">
          <textarea ref={taRef} rows={1} value={draft} placeholder={selection ? 'Ask about the selected text…' : 'Ask about this document…'} aria-label="Ask the document assistant"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }} disabled={!ready} />
          <button type="submit" className="vw-send" disabled={busy || !draft.trim() || !ready} aria-label="Ask">{busy ? <Loader2 size={16} className="vw-spin" /> : <Send size={16} />}</button>
        </div>
      </form>
    </aside>
  );
}
