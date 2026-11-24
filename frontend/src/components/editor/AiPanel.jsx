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

function extractQuestions(text) {
  const lines = (text || '').split('\n');
  const qs = [];
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (m) qs.push(m[2].replace(/\*\*/g, '').trim());
  }
  return qs.length >= 2 ? qs : null;
}

function InlineChatFields({ questions, onSubmit }) {
  const [values, setValues] = useState({});
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit() {
    const parts = questions.map((q, i) => {
      const v = (values[i] || '').trim();
      return v ? `${i + 1}. ${q}: ${v}` : `${i + 1}. ${q}: [skip]`;
    });
    setSubmitted(true);
    onSubmit(parts.join('\n'));
  }

  if (submitted) {
    return <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Details submitted — generating draft…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
        Fill in the details or leave blank to use placeholders:
      </div>
      {questions.map((q, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={{ fontSize: 11.5, color: 'var(--ink-soft)', fontWeight: 500 }}>{i + 1}. {q}</label>
          <input
            style={{ border: '1px solid var(--rule)', borderRadius: 6, padding: '5px 8px', fontSize: 12, background: 'var(--paper)', color: 'var(--ink)', outline: 'none' }}
            placeholder={`Enter or leave blank…`}
            value={values[i] || ''}
            onChange={(e) => setValues((v) => ({ ...v, [i]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter' && i === questions.length - 1) handleSubmit(); }}
          />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={handleSubmit} style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Generate Draft</button>
        <button onClick={() => { setSubmitted(true); onSubmit('skip all, use placeholders'); }} style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>Skip all</button>
      </div>
    </div>
  );
}

function InlinePlaceholderFields({ fields, bridge }) {
  const [values, setValues] = useState({});
  const [filled, setFilled] = useState({});
  const [skipped, setSkipped] = useState(false);

  function fillOne(token) {
    const val = (values[token] || '').trim();
    if (!val || !bridge) return;
    try {
      const html = bridge.html();
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const updated = html.replace(new RegExp(escaped, 'g'), val);
      if (updated !== html) {
        bridge.loadHtml(updated);
        setFilled((f) => ({ ...f, [token]: val }));
      }
    } catch {}
  }

  function fillAll() {
    if (!bridge) return;
    let html = bridge.html();
    const newFilled = { ...filled };
    fields.forEach((token) => {
      const val = (values[token] || '').trim();
      if (!val || filled[token]) return;
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(escaped, 'g'), val);
      newFilled[token] = val;
    });
    bridge.loadHtml(html);
    setFilled(newFilled);
  }

  if (skipped) {
    return <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Placeholders left as-is. Fill them from the Fields tab anytime.</div>;
  }

  const pending = fields.filter((t) => !filled[t]);
  const allDone = pending.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
        {allDone ? 'All fields filled!' : `${fields.length} placeholder${fields.length !== 1 ? 's' : ''} found — fill in or skip:`}
      </div>
      {fields.map((token) => (
        <div key={token} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{
            fontSize: 11, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace",
            color: filled[token] ? 'var(--accent)' : 'var(--ink-soft)',
            background: filled[token] ? 'color-mix(in srgb, var(--accent) 10%, var(--paper))' : 'color-mix(in srgb, var(--ink) 6%, var(--paper))',
            borderRadius: 4, padding: '2px 6px', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140,
            textDecoration: filled[token] ? 'line-through' : 'none',
          }} title={token}>{token}</span>
          {filled[token] ? (
            <span style={{ fontSize: 11, color: 'var(--accent)' }}>{filled[token]}</span>
          ) : (
            <>
              <input
                style={{ flex: 1, border: '1px solid var(--rule)', borderRadius: 6, padding: '4px 8px', fontSize: 12, background: 'var(--paper)', color: 'var(--ink)', outline: 'none', minWidth: 0 }}
                placeholder={token.replace(/[\[\]]/g, '')}
                value={values[token] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [token]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') fillOne(token); }}
              />
              <button
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                disabled={!(values[token] || '').trim()}
                onClick={() => fillOne(token)}
              >Fill</button>
            </>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {!allDone && (
          <>
            <button onClick={fillAll} style={{ padding: '5px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Fill all</button>
            <button onClick={() => setSkipped(true)} style={{ padding: '5px 14px', borderRadius: 8, border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>Skip</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AiPanel({ bridge, canEdit, initialInput = '', onDraftInserted }) {
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
        setPendingDraft({ originalInstruction: instruction, requirementsText: r.text });
        const qs = extractQuestions(r.text);
        if (qs) {
          setLog((l) => [...l, { who: 'ai', chatFields: qs, rawText: r.text }]);
        } else {
          setLog((l) => [...l, { who: 'ai', text: r.text, chat: true, html: mdToHtml(r.text) }]);
        }
      } else if (r.mode === 'insert') {
        bridge.insertText('\n' + r.text + '\n');
        setTimeout(() => highlightBlanksInIframe(findEditorIframe()), 350);
        setLog((l) => [...l, { who: 'ai', text: r.note, undo: true }]);
        const _ph = (r.text || '').match(/\[([^\]\n]{1,80})\]/g) || [];
        if (_ph.length > 0) {
          const _unique = [...new Set(_ph)];
          setLog((l) => [...l, { who: 'ai', fields: _unique }]);
        }
        if (onDraftInserted) setTimeout(() => onDraftInserted(r.text), 500);
      } else {
        bridge.loadHtml(textToHtml(r.text));
        setTimeout(() => highlightBlanksInIframe(findEditorIframe()), 600);
        setLog((l) => [...l, { who: 'ai', text: r.note, undo: true }]);
        const _ph = (r.text || '').match(/\[([^\]\n]{1,80})\]/g) || [];
        if (_ph.length > 0) {
          const _unique = [...new Set(_ph)];
          setLog((l) => [...l, { who: 'ai', fields: _unique }]);
        }
        if (onDraftInserted) setTimeout(() => onDraftInserted(r.text), 800);
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
          <div key={i} className={`aip-msg aip-msg--${m.who}`} style={m.chat || m.fields || m.chatFields ? { fontSize: 13, lineHeight: 1.5 } : undefined}>
            {m.chatFields
              ? <InlineChatFields questions={m.chatFields} onSubmit={(answers) => apply(answers)} />
              : m.fields
              ? <InlinePlaceholderFields fields={m.fields} bridge={bridge} />
              : m.html
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
              title={'Speak and the words are typed at your cursor. Say "full stop", "comma" or "new paragraph" to punctuate.'} disabled={!bridge || busy} />
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
            <MicButton onText={(text) => setInput((prev) => (prev ? prev + ' ' : '') + text)} spokenCommands={false} disabled={busy}
              hotkey={{ key: 'h', ctrl: true }} />
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
