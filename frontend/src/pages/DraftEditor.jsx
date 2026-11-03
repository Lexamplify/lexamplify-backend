import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import WordCraftEditor from '../components/editor/WordCraftEditor.jsx';
import AiPanel from '../components/editor/AiPanel.jsx';
import PresenceBar from '../components/editor/PresenceBar.jsx';
import ShareDialog from '../components/editor/ShareDialog.jsx';
import { useCollabDoc } from '../collab/useCollabDoc.js';
import { useDocStore, can, ROLE_LABEL } from '../collab/useDocStore.js';

export default function DraftEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { peers } = useCollabDoc(id); // presence only (who else has the doc open)

  const storeDoc = useDocStore((s) => s.docs[id]);
  const rename = useDocStore((s) => s.rename);
  const myRole = useDocStore((s) => s.myRole(id));
  const role = storeDoc ? myRole : 'editor'; // link visitors (doc not in local store) can edit
  const doc = storeDoc || { title: 'Shared draft', matter: '' };
  const editable = can.edit(role);

  const [bridge, setBridge] = useState(null);
  // Chunk 2 — "N fields need attention" counter. Polls the editor iframe for
  // <mark class="lx-attn"> elements the backend/skeleton rendered for unfilled
  // slots. Clicking "Next field" scrolls the iframe to the next one and
  // flashes it so the lawyer can type the real value in place.
  const [attnCount, setAttnCount] = useState(0);
  const attnCursor = useRef(0);
  // Letterhead toggle — "Include letterhead header & footer in this draft".
  // When on, the editor shows a visible letterhead strip at the top and a
  // footer strip at the bottom (so what the lawyer SEES is what gets
  // printed) and the Export call carries the chosen letterhead_id so the
  // DOCX/PDF renders the full first-page letterhead + continuation
  // header + 3-column footer we built in Chunk 4.
  const [letterheads, setLetterheads] = useState([]);
  const [letterheadOn, setLetterheadOn] = useState(() => {
    try { return localStorage.getItem(`lx-lh-on-${id}`) === '1'; } catch { return false; }
  });
  const [letterheadId, setLetterheadId] = useState(() => {
    try { return Number(localStorage.getItem(`lx-lh-id-${id}`)) || null; } catch { return null; }
  });
  const [confidential, setConfidential] = useState(() => {
    try { return localStorage.getItem(`lx-lh-conf-${id}`) === '1'; } catch { return false; }
  });
  useEffect(() => {
    const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
    fetch(`${API_BASE}/api/letterheads`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { letterheads: [] }))
      .then((d) => {
        const list = d.letterheads || [];
        setLetterheads(list);
        if (!letterheadId && list[0]) setLetterheadId(list[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { try { localStorage.setItem(`lx-lh-on-${id}`, letterheadOn ? '1' : '0'); } catch {} }, [letterheadOn, id]);
  useEffect(() => { try { if (letterheadId) localStorage.setItem(`lx-lh-id-${id}`, String(letterheadId)); } catch {} }, [letterheadId, id]);
  useEffect(() => { try { localStorage.setItem(`lx-lh-conf-${id}`, confidential ? '1' : '0'); } catch {} }, [confidential, id]);
  const activeLetterhead = letterheads.find((l) => l.id === letterheadId) || null;

  async function createLetterhead() {
    const name = window.prompt("Firm name (as it will appear at the top of every letter)")?.trim();
    if (!name) return;
    const tagline = window.prompt("Tagline — e.g. 'Advocates & Solicitors' (optional)")?.trim() || '';
    const address = window.prompt("Full address — one line, commas between parts (optional)")?.trim() || '';
    const contact = window.prompt("Phone / email (optional)")?.trim() || '';
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${API_BASE}/api/letterheads`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ name, tagline, address, contact }),
      });
      if (!res.ok) throw new Error(`Could not save letterhead (${res.status})`);
      const d = await res.json();
      const created = d.letterhead || d;
      setLetterheads((prev) => [...prev, created]);
      setLetterheadId(created.id);
      setLetterheadOn(true);
    } catch (e) {
      alert(e.message);
    }
  }
  const [showShare, setShowShare] = useState(false);
  const [showAssistant, setShowAssistant] = useState(true);
  const [saved, setSaved] = useState('saved');
  const [finalising, setFinalising] = useState(false);
  const [finalised, setFinalised] = useState(false);
  const wsRef = useRef(null);
  const saveTimer = useRef(null);

  function csrf() {
    const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function finalise() {
    if (finalising || finalised) return;
    if (!window.confirm('Finalise this draft? You can keep editing after.')) return;
    setFinalising(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${API_BASE}/api/drafts/sessions/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ status: 'done' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Could not finalise (${res.status})`);
      }
      setFinalised(true);
      setTimeout(() => navigate('/draft'), 800);
    } catch (e) {
      alert(e.message);
    } finally {
      setFinalising(false);
    }
  }

  // Debounce the "Saving…" indicator so WordCraft's rapid internal change
  // events during the initial seedHtml load don't make it flicker — only show
  // "Saving…" once the user has been typing for 400ms, and clear it 1200ms
  // after they stop.
  const typingTimer = useRef(null);
  const onChange = useCallback(() => {
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      setSaved('saving');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaved('saved'), 1200);
    }, 400);
    if (storeDoc) useDocStore.getState().touch(id, {});
  }, [id, storeDoc]);

  // Poll the WordCraft iframe for unfilled-field chips every 1.2s. The editor
  // is cross-doc (iframe) so we reach in through contentDocument. If an
  // iframe isn't ready yet, the count stays at zero (safe default).
  // Also runs an idle-sweep auto-highlighter: if the document has blank
  // patterns ("____", "[date]", "₹____") that aren't chipped yet, wrap
  // them. The sweep only runs when the editor has been quiet for >1 tick
  // so it never fights the typing cursor.
  useEffect(() => {
    let lastHtml = '';
    let stableTicks = 0;
    const BLANK_RE = /(_{3,}|\[[A-Za-z0-9 ,.\/\-'’]{1,80}\]|__\/__\/____|₹\s*_{2,}|Rs\.?\s*_{2,})/g;
    const CHIP = 'background:#fff3cd;color:#8a5a00;border:1px dashed #c38a00;border-radius:4px;padding:1px 6px;font-weight:600;cursor:pointer;';
    const sweep = (doc) => {
      try {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
        const victims = [];
        let n = walker.nextNode();
        while (n) {
          if (!n.parentElement?.closest('mark.lx-attn') && BLANK_RE.test(n.nodeValue || '')) victims.push(n);
          BLANK_RE.lastIndex = 0;
          n = walker.nextNode();
        }
        victims.forEach((node) => {
          const parent = node.parentNode; if (!parent) return;
          const frag = doc.createDocumentFragment();
          const t = node.nodeValue; let last = 0; BLANK_RE.lastIndex = 0; let m;
          while ((m = BLANK_RE.exec(t)) != null) {
            if (m.index > last) frag.appendChild(doc.createTextNode(t.slice(last, m.index)));
            const mark = doc.createElement('mark');
            mark.className = 'lx-attn';
            mark.setAttribute('data-field', m[0].replace(/[\[\]_]/g, '').trim() || 'fill in');
            mark.setAttribute('style', CHIP);
            mark.setAttribute('title', 'Click to fill in');
            mark.textContent = m[0];
            frag.appendChild(mark);
            last = m.index + m[0].length;
          }
          if (last < t.length) frag.appendChild(doc.createTextNode(t.slice(last)));
          parent.replaceChild(frag, node);
        });
      } catch { /* ignore */ }
    };
    const tick = () => {
      try {
        const iframe = wsRef.current?.querySelector('iframe.wce-frame');
        const doc = iframe?.contentDocument;
        if (!doc?.body) { setAttnCount(0); return; }
        const html = doc.body.innerHTML || '';
        if (html === lastHtml) stableTicks += 1; else { stableTicks = 0; lastHtml = html; }
        // Only sweep once editor has been idle for ~2.5s — never during typing.
        if (stableTicks === 2) sweep(doc);
        const marks = doc.querySelectorAll('mark.lx-attn');
        setAttnCount(marks.length);
      } catch { /* cross-origin or not-yet-ready — ignore */ }
    };
    tick();
    const id = setInterval(tick, 1200);
    return () => clearInterval(id);
  }, [bridge]);

  function jumpToNextAttention() {
    try {
      const iframe = wsRef.current?.querySelector('iframe.wce-frame');
      const doc = iframe?.contentDocument;
      const marks = doc ? Array.from(doc.querySelectorAll('mark.lx-attn')) : [];
      if (!marks.length) return;
      const i = attnCursor.current % marks.length;
      attnCursor.current = (i + 1) % marks.length;
      const el = marks[i];
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prev = el.style.outline;
      el.style.outline = '2px solid #c38a00';
      el.style.outlineOffset = '2px';
      setTimeout(() => { el.style.outline = prev; }, 1200);
    } catch { /* ignore */ }
  }

  function fullscreen() {
    const el = wsRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }

  async function exportDocx() {
    if (!bridge) return;
    // If letterhead is OFF, use WordCraft's native .docx bytes (fast, no
    // round-trip). If ON, call the server /export so the Chunk-4 legal-
    // grade header/footer renderer wraps the content.
    if (!letterheadOn || !letterheadId) {
      const bytes = await bridge.bytes('docx');
      if (!bytes) return;
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (doc.title || 'draft').replace(/[^\w.-]+/g, '_') + '.docx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      return;
    }
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
      const text = (bridge.text() || '').trim();
      const blocks = text.split(/\n{2,}/).map((p) => ({ type: 'para', text: p }));
      const res = await fetch(`${API_BASE}/api/drafts/export`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({
          format: 'docx',
          title: doc.title || 'draft',
          blocks,
          letterhead_id: letterheadId,
          confidential,
        }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (doc.title || 'draft').replace(/[^\w.-]+/g, '_') + '.docx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="dez" ref={wsRef}>
      <header className="dez-head">
        <div className="dez-head-l">
          <button className="dez-back" onClick={() => navigate('/draft')} aria-label="Back"><Ic.Arrow size={15} style={{ transform: 'rotate(180deg)' }} /></button>
          <div className="dez-mono">L</div>
          <div className="dez-title-wrap">
            {editable ? (
              <input className="dez-title" value={doc.title} onChange={(e) => rename(id, e.target.value)} spellCheck={false} />
            ) : (
              <div className="dez-title dez-title--ro">{doc.title}</div>
            )}
            <div className="dez-sub">
              {doc.matter && <span>{doc.matter}</span>}
              <span className={`dez-save dez-save--${saved}`}>{saved === 'saving' ? 'Saving…' : 'All changes saved'}</span>
              {!editable && <span className="dez-rolechip"><Ic.Eye size={12} /> {ROLE_LABEL[role]}</span>}
            </div>
          </div>
        </div>

        <div className="dez-head-r">
          <PresenceBar peers={peers} />
          {attnCount > 0 && (
            <button
              className="lx-btn lx-btn--sm"
              onClick={jumpToNextAttention}
              title="Jump to the next field that still needs your attention"
              style={{ background: '#fff3cd', color: '#8a5a00', border: '1px dashed #c38a00', fontWeight: 600 }}
            >
              <Ic.Draft size={14} /> {attnCount} field{attnCount === 1 ? '' : 's'} need{attnCount === 1 ? 's' : ''} your attention
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-card)' }} title="Include your firm's letterhead in the view and the export">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: letterheads.length > 0 ? 'pointer' : 'not-allowed', opacity: letterheads.length > 0 ? 1 : 0.6 }}>
              <input
                type="checkbox"
                checked={letterheadOn && letterheads.length > 0}
                disabled={letterheads.length === 0}
                onChange={(e) => setLetterheadOn(e.target.checked)}
              />
              Letterhead
            </label>
            {letterheads.length === 0 && (
              <button
                type="button"
                className="lx-btn lx-btn--sm"
                style={{ fontSize: 11.5, padding: '2px 8px' }}
                onClick={createLetterhead}
                title="You have no letterhead saved yet — create one for your firm"
              >
                + Create
              </button>
            )}
            {letterheadOn && letterheads.length > 1 && (
              <select value={letterheadId || ''} onChange={(e) => setLetterheadId(Number(e.target.value) || null)} style={{ fontSize: 12, border: '1px solid var(--rule)', borderRadius: 6, padding: '2px 6px' }}>
                {letterheads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            {letterheadOn && letterheads.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }} title="Mark page as confidential in the footer">
                <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
                Conf.
              </label>
            )}
          </div>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setShowAssistant((v) => !v)} title="Toggle AI assistant"><Ic.Sparkle size={14} /> Assistant</button>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={fullscreen} title="Full screen"><Ic.Draft size={14} /> Focus</button>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={exportDocx} title="Export .docx"><Ic.Upload size={14} /> Export</button>
          <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => setShowShare(true)}><Ic.Share size={14} /> Share</button>
          <button className="lx-btn lx-btn--gold lx-btn--sm" onClick={finalise} disabled={finalising || finalised || !editable}>
            <Ic.Check size={14} /> {finalised ? 'Finalised' : (finalising ? 'Finalising…' : 'Finalise')}
          </button>
        </div>
      </header>

      <div className="dez-body">
        <div className="dez-editor" style={{ display: 'flex', flexDirection: 'column' }}>
          {letterheadOn && activeLetterhead && (
            <div style={{
              padding: '14px 24px 12px', background: 'var(--bg-card)',
              borderBottom: '2px solid var(--accent)', textAlign: 'center',
              fontFamily: 'var(--font-serif, Georgia, serif)',
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)', letterSpacing: '.02em' }}>{activeLetterhead.name}</div>
              {activeLetterhead.tagline && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic', marginTop: 2 }}>{activeLetterhead.tagline}</div>}
              {activeLetterhead.address && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4, whiteSpace: 'pre-line' }}>{activeLetterhead.address}</div>}
              {activeLetterhead.contact && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 2 }}>{activeLetterhead.contact}</div>}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0 }}>
            <WordCraftEditor
              key={id}
              docId={id}
              seedHtml={storeDoc?.seedHtml || ''}
              onBridge={setBridge}
              onChange={onChange}
            />
          </div>
          {letterheadOn && activeLetterhead && (
            <div style={{
              padding: '6px 24px', background: 'var(--bg-card)',
              borderTop: '1px solid var(--rule)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 10.5, color: 'var(--muted)',
            }}>
              <span>{confidential ? 'CONFIDENTIAL & PRIVILEGED' : ''}</span>
              <span>{activeLetterhead.footer || activeLetterhead.name}</span>
              <span>Page X of Y</span>
            </div>
          )}
        </div>
        {showAssistant && (
          <div className="dez-side">
            <AiPanel bridge={bridge} canEdit={editable} />
          </div>
        )}
      </div>

      {showShare && <ShareDialog docId={id} myRole={role} onClose={() => setShowShare(false)} />}
    </div>
  );
}
