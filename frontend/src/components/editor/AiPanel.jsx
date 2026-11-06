import { useState, useRef, useEffect } from 'react';
import * as Ic from '../../icons.jsx';
import { runAiEdit, hasLLM, STANDARD_CLAUSES } from '../../collab/aiEdit.js';
import AiReview from '../studio/AiReview.jsx';
import MicButton, { LangPicker } from '../MicButton.jsx';
import { applySpokenCommands } from '../../utils/dictation.js';

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

// Feature A — wrap every unfilled-placeholder pattern the AI drops into
// its output (___, [date], [amount], __/__/____, ₹____) as a visibly
// highlighted attention chip in the editor iframe. Runs AFTER the AI
// finishes inserting so we never fight the typing cursor. Walks text
// nodes, skips anything already inside a mark, and swaps matched text
// for <mark class="lx-attn"> spans the DraftEditor header counter picks
// up automatically.
const BLANK_RE = /(_{3,}|\[[A-Za-z0-9 ,.\/\-'']{1,80}\]|__\/__\/____|₹\s*_{2,}|Rs\.?\s*_{2,})/g;
const CHIP_STYLE = (
  'background:#fff3cd;color:#8a5a00;border:1px dashed #c38a00;'
  + 'border-radius:4px;padding:1px 6px;font-weight:600;cursor:pointer;'
);
function highlightBlanksInIframe(iframeEl) {
  try {
    const doc = iframeEl?.contentDocument;
    if (!doc?.body) return;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    const victims = [];
    let n = walker.nextNode();
    while (n) {
      if (n.parentElement?.closest('mark.lx-attn') == null && BLANK_RE.test(n.nodeValue || '')) {
        victims.push(n);
      }
      BLANK_RE.lastIndex = 0;
      n = walker.nextNode();
    }
    victims.forEach((node) => {
      const parent = node.parentNode;
      if (!parent) return;
      const frag = doc.createDocumentFragment();
      const text = node.nodeValue;
      let lastIdx = 0;
      BLANK_RE.lastIndex = 0;
      let m;
      while ((m = BLANK_RE.exec(text)) != null) {
        if (m.index > lastIdx) frag.appendChild(doc.createTextNode(text.slice(lastIdx, m.index)));
        const mark = doc.createElement('mark');
        mark.className = 'lx-attn';
        mark.setAttribute('data-field', m[0].replace(/[\[\]_]/g, '').trim() || 'fill in');
        mark.setAttribute('style', CHIP_STYLE);
        mark.setAttribute('title', 'Click to fill in');
        mark.textContent = m[0];
        frag.appendChild(mark);
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < text.length) frag.appendChild(doc.createTextNode(text.slice(lastIdx)));
      parent.replaceChild(frag, node);
    });
  } catch { /* iframe not ready or cross-origin — safe to ignore */ }
}
// Find the editor iframe from inside this component's rendered chrome.
function findEditorIframe() {
  return document.querySelector('iframe.wce-frame');
}

// Minimal markdown renderer for the chat log — enough for the
// requirements-analysis response (bold, headings, nested lists). Keeps
// a tiny whitelist of inline/block constructs so we don't ship a full
// markdown dep for one feature. Everything is escaped before formatting
// so no HTML injection path.
function _escHtml(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function mdToHtml(src) {
  const safe = _escHtml(src);
  const lines = safe.split(/\r?\n/);
  const out = [];
  let listKind = null; // 'ul' | 'ol' | null
  const flush = () => { if (listKind) { out.push(`</${listKind}>`); listKind = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const trim = line.trimStart();
    const indent = line.length - trim.length;
    const olMatch = trim.match(/^(\d+)\.\s+(.*)$/);
    const ulMatch = trim.match(/^[-•]\s+(.*)$/);
    if (olMatch) {
      if (listKind !== 'ol') { flush(); out.push('<ol style="margin:4px 0 6px 20px;padding:0">'); listKind = 'ol'; }
      out.push(`<li style="margin:2px 0;${indent > 2 ? 'padding-left:8px' : ''}">${olMatch[2]}</li>`);
    } else if (ulMatch) {
      if (listKind !== 'ul') { flush(); out.push('<ul style="margin:4px 0 6px 20px;padding:0;list-style:disc">'); listKind = 'ul'; }
      out.push(`<li style="margin:2px 0;${indent > 2 ? 'padding-left:8px' : ''}">${ulMatch[1]}</li>`);
    } else if (trim === '') {
      flush();
      out.push('<div style="height:6px"></div>');
    } else {
      flush();
      out.push(`<div style="margin:3px 0">${line}</div>`);
    }
  }
  flush();
  return out.join('');
}

export default function AiPanel({ bridge, canEdit, initialInput = '' }) {
  const [log, setLog] = useState([
    { who: 'ai', text: "Describe a change and I'll apply it. I can draft new clauses, rewrite selected text, or shape the whole document." },
  ]);
  const [input, setInput] = useState(initialInput);
  const [busy, setBusy] = useState(false);
  // Ask-first conversation state: when the AI asks for details before
  // drafting, we stash the original instruction and the AI's questions so
  // the next user message can bundle them as context for the real draft.
  const [pendingDraft, setPendingDraft] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [log, busy]);

  async function apply(instruction) {
    if (!bridge || !canEdit || busy) return;
    const fullText = bridge.text();
    setLog((l) => [...l, { who: 'you', text: instruction }]);
    setBusy(true);

    // If we have a pending draft context (AI asked questions, user is
    // now answering), bundle everything together so the backend can
    // draft the complete document with the user's answers.
    let apiArgs = { instruction, selection: '', fullText };
    if (pendingDraft) {
      apiArgs.context = {
        originalInstruction: pendingDraft.originalInstruction,
        requirementsAnalysis: pendingDraft.requirementsText,
        userAnswers: instruction,
      };
      setPendingDraft(null);
    }

    try {
      const r = await runAiEdit(apiArgs);
      if (r.mode === 'chat') {
        // Feature B — ask-first mode. The backend decided this is a
        // "draft X from scratch" request and returned a requirements
        // analysis + question list for the lawyer. Show the questions in
        // chat; do NOT insert into the document.
        // Stash the context so the user's next reply triggers the actual draft.
        setPendingDraft({ originalInstruction: instruction, requirementsText: r.text });
        setLog((l) => [...l, { who: 'ai', text: r.text, chat: true, html: mdToHtml(r.text) }]);
      } else if (r.mode === 'insert') {
        bridge.insertText('\n' + r.text + '\n');
        // Feature A — wrap AI-emitted blanks as attention chips so the
        // DraftEditor header counter can find them. Delay one tick for
        // WordCraft to commit the insert into the DOM.
        setTimeout(() => highlightBlanksInIframe(findEditorIframe()), 350);
        setLog((l) => [...l, { who: 'ai', text: r.note, undo: true }]);
      } else {
        // Whole-document rewrite: rebuild as HTML and reload the doc.
        bridge.loadHtml(textToHtml(r.text));
        setTimeout(() => highlightBlanksInIframe(findEditorIframe()), 600);
        setLog((l) => [...l, { who: 'ai', text: r.note, undo: true }]);
      }
    } catch (e) {
      setLog((l) => [...l, { who: 'ai', text: 'Could not apply that edit: ' + e.message }]);
    } finally {
      setBusy(false);
    }
  }

  // Speak straight into the document at the cursor.
  function dictateIntoDocument(text) {
    if (!bridge || !canEdit) return;
    const t = applySpokenCommands(text).trim();
    if (!t) return;
    bridge.insertText(t + ' ');
    setLog((l) => [...l, { who: 'ai', text: 'Added your dictation at the cursor.', undo: true }]);
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

      <AiReview bridge={bridge} />

      <div className="aip-log" ref={scrollRef}>
        {log.map((m, i) => (
          <div key={i} className={`aip-msg aip-msg--${m.who}`} style={m.chat ? { fontSize: 13, lineHeight: 1.5 } : undefined}>
            {m.html
              ? <div dangerouslySetInnerHTML={{ __html: m.html }} />
              : m.text}
            {m.undo && (
              <button className="aip-undo" onClick={() => bridge.exec('edit.undo', {})}><Ic.Undo size={12} /> Undo</button>
            )}
          </div>
        ))}
        {busy && <div className="aip-msg aip-msg--ai aip-typing"><span /><span /><span /></div>}
      </div>

      {canEdit ? (
        <div className="aip-foot">
          <div className="aip-dictate">
            <MicButton variant="pill" label="Dictate into document" onText={dictateIntoDocument} spokenCommands
              hotkey={{ key: 'd', ctrl: true }}
              title={'Speak and the words are typed at your cursor (Ctrl+D). Say "full stop", "comma" or "new paragraph" to punctuate.'} disabled={!bridge || busy} />
            <LangPicker />
          </div>
          <div className="aip-chips">
            {QUICK.map((q) => <button key={q.label} className="aip-chip" disabled={busy} onClick={() => apply(q.instruction)}>{q.label}</button>)}
          </div>
          <div className="aip-chips aip-chips--clause">
            <span className="aip-chips-label">Add clause:</span>
            {CLAUSES.map((c) => <button key={c} className="aip-chip aip-chip--ghost" disabled={busy} onClick={() => apply('Add a standard ' + c + ' clause.')}>{c}</button>)}
          </div>
          <form className="aip-input" onSubmit={onSend}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask to edit, add a clause or rephrase…" disabled={busy} />
            <MicButton scope="form" spokenCommands={false} disabled={busy} />
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
