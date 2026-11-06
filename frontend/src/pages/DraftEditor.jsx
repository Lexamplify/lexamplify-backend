import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import WordCraftEditor from '../components/editor/WordCraftEditor.jsx';
import AiPanel from '../components/editor/AiPanel.jsx';
import UnfilledFieldsPanel from '../components/autodraft/UnfilledFieldsPanel.jsx';
import PresenceBar from '../components/editor/PresenceBar.jsx';
import ShareDialog from '../components/editor/ShareDialog.jsx';
import EditorLayout from '../components/studio/EditorLayout.jsx';
import OutlinePanel from '../components/studio/OutlinePanel.jsx';
import FloatingToolbar from '../components/studio/FloatingToolbar.jsx';
import LetterheadEditor from '../components/studio/LetterheadEditor.jsx';
import { useCollabDoc } from '../collab/useCollabDoc.js';
import { useDocStore, can, ROLE_LABEL } from '../collab/useDocStore.js';
import '../styles/auto-draft-studio.css';

export default function DraftEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const initialPrompt = String(useLocation().state?.prompt || '');
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
        if (!letterheadId) {
          const def = list.find((l) => l.is_default) || list[0];
          if (def) setLetterheadId(def.id);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { try { localStorage.setItem(`lx-lh-on-${id}`, letterheadOn ? '1' : '0'); } catch {} }, [letterheadOn, id]);
  useEffect(() => { try { if (letterheadId) localStorage.setItem(`lx-lh-id-${id}`, String(letterheadId)); } catch {} }, [letterheadId, id]);
  useEffect(() => { try { localStorage.setItem(`lx-lh-conf-${id}`, confidential ? '1' : '0'); } catch {} }, [confidential, id]);
  const activeLetterhead = letterheads.find((l) => l.id === letterheadId) || null;

  const [lhExpanded, setLhExpanded] = useState(false);
  const [ribbonHidden, setRibbonHidden] = useState(false);
  const [lhModalOpen, setLhModalOpen] = useState(false);
  const [lhEditTarget, setLhEditTarget] = useState(null);
  function openLetterheadModal(editing = null) {
    setLhEditTarget(editing || null);
    setLhModalOpen(true);
  }
  function onLetterheadSaved(saved) {
    setLetterheads((prev) => {
      const exists = prev.find((l) => l.id === saved.id);
      if (exists) return prev.map((l) => (l.id === saved.id ? saved : l));
      return [...prev, saved];
    });
    setLetterheadId(saved.id);
    setLetterheadOn(true);
    setLhModalOpen(false);
  }
  async function setAsDefault(lhId) {
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${API_BASE}/api/letterheads/${lhId}/default`, {
        method: 'PUT', credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrf() },
      });
      if (res.ok) {
        setLetterheads((prev) => prev.map((l) => ({ ...l, is_default: l.id === lhId ? 1 : 0 })));
      }
    } catch { /* ignore */ }
  }
  const [showShare, setShowShare] = useState(false);
  const [showAssistant, setShowAssistant] = useState(true);
  const [showOutline, setShowOutline] = useState(true);
  const [rightTab, setRightTab] = useState('assistant');
  const [placeholderVars, setPlaceholderVars] = useState([]);
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
    const CHIP = 'background:color-mix(in srgb, var(--warn) 14%, transparent);color:color-mix(in srgb, var(--warn) 72%, black);border:1px dashed var(--warn);border-radius:4px;padding:1px 6px;font-weight:600;cursor:pointer;';
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
        const bText = bridge ? bridge.text() : '';
        const found = bText.match(/\[([^\]\n]{1,80})\]/g) || [];
        const counts = {};
        const order = [];
        found.forEach((tok) => { if (!counts[tok]) { counts[tok] = 0; order.push(tok); } counts[tok]++; });
        if (found.length === 0 && marks.length > 0) {
          marks.forEach((m) => {
            const tok = m.textContent;
            if (/^\[.+\]$/.test(tok)) {
              if (!counts[tok]) { counts[tok] = 0; order.push(tok); }
              counts[tok]++;
            }
          });
        }
        setPlaceholderVars(order.map((t) => ({ token: t, count: counts[t] })));
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
      el.style.outline = '2px solid var(--warn)';
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
    // Decide path. If letterhead is on AND an id is selected, go through
    // the server so the Chunk-4 legal-grade header/footer renderer wraps
    // the content. Otherwise fall back to WordCraft's native .docx bytes
    // (fast, no round-trip, but NO letterhead or footer).
    const goServer = letterheadOn && !!letterheadId;
    // Loud warning when the user has toggled letterhead ON but we can't
    // reach the server path — explains "no footer, colorless" exports.
    if (letterheadOn && !letterheadId) {
      alert(
        'Letterhead toggle is ON but no letterhead is selected — exporting the plain WordCraft file.\n\n'
        + 'Click "+ Create" to make one, or pick an existing letterhead, then export again.'
      );
    }
    if (!goServer) {
      const bytes = await bridge.bytes('docx');
      if (!bytes) return;
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (doc.title || 'draft').replace(/[^\w.-]+/g, '_') + '.docx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      // Loud log so the user / support can see which path ran.
      console.log('[export] native WordCraft bytes (no letterhead applied)');
      return;
    }
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
      const text = (bridge.text() || '').trim();
      if (!text) {
        alert('Nothing to export — type or paste some text into the draft first.');
        return;
      }
      const blocks = text.split(/\n{2,}/).map((p) => ({ type: 'para', text: p }));
      console.log('[export] server /api/drafts/export with letterhead_id=', letterheadId, 'confidential=', confidential, 'blocks=', blocks.length);
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Export failed (${res.status})`);
      }
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
              style={{ background: 'color-mix(in srgb, var(--warn) 14%, transparent)', color: 'color-mix(in srgb, var(--warn) 72%, black)', border: '1px dashed var(--warn)', fontWeight: 600 }}
            >
              <Ic.Draft size={14} /> {attnCount} field{attnCount === 1 ? '' : 's'}
            </button>
          )}
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setShowOutline((v) => !v)} title="Toggle outline panel"><Ic.Draft size={14} /></button>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setShowAssistant((v) => !v)} title="Toggle AI assistant"><Ic.Sparkle size={14} /></button>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={fullscreen} title="Full screen"><Ic.Draft size={14} /></button>
          <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={exportDocx} title="Export .docx"><Ic.Upload size={14} /> Export</button>
          <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => setShowShare(true)}><Ic.Share size={14} /> Share</button>
          <button className="lx-btn lx-btn--gold lx-btn--sm" onClick={finalise} disabled={finalising || finalised || !editable}>
            <Ic.Check size={14} /> {finalised ? 'Finalised' : (finalising ? 'Finalising…' : 'Finalise')}
          </button>
        </div>
      </header>

      <div className="dez-body">
        <EditorLayout
          showLeft={showOutline}
          showRight={showAssistant}
          onToggleLeft={() => setShowOutline((v) => !v)}
          onToggleRight={() => setShowAssistant((v) => !v)}
          left={
            <OutlinePanel
              wsRef={wsRef}
              bridge={bridge}
              docId={id}
              docTitle={doc.title}
              docType={storeDoc?.type}
              createdAt={storeDoc?.created_at}
            />
          }
          center={
            <div className="dez-editor" style={{ flexDirection: 'column' }}>
              {/* Paper container — scrollable document area */}
              <div className="ads-paper-scroll">
                <div className="ads-paper">
                  {/* Compact letterhead bar — always visible inside paper */}
                  <div className="ads-paper__lh-bar">
                    <label className="ads-paper__lh-bar__toggle">
                      <input
                        type="checkbox"
                        checked={letterheadOn && letterheads.length > 0}
                        disabled={letterheads.length === 0}
                        onChange={(e) => setLetterheadOn(e.target.checked)}
                      />
                      Letterhead
                    </label>
                    {letterheads.length === 0 && (
                      <button type="button" className="ads-paper__lh-bar__btn" onClick={openLetterheadModal}>+ Create</button>
                    )}
                    {letterheadOn && activeLetterhead && (
                      <span className="ads-paper__lh-bar__firm" onClick={() => setLhExpanded((v) => !v)}>
                        {activeLetterhead.name}
                      </span>
                    )}
                    {letterheadOn && letterheads.length > 1 && (
                      <select className="ads-paper__lh-bar__select" value={letterheadId || ''} onChange={(e) => setLetterheadId(Number(e.target.value) || null)}>
                        {letterheads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    )}
                    <span className="ads-paper__lh-bar__spacer" />
                    {letterheadOn && letterheads.length > 0 && (
                      <label className="ads-paper__lh-bar__toggle">
                        <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
                        Confidential
                      </label>
                    )}
                    {letterheadOn && activeLetterhead && (
                      <>
                        <button type="button" className="ads-paper__lh-bar__btn" onClick={() => openLetterheadModal(activeLetterhead)}>Edit</button>
                        {!activeLetterhead.is_default && (
                          <button type="button" className="ads-paper__lh-bar__btn" onClick={() => setAsDefault(activeLetterhead.id)}>Set default</button>
                        )}
                        <button
                          type="button"
                          className={`ads-paper__lh-bar__chevron${lhExpanded ? ' ads-paper__lh-bar__chevron--open' : ''}`}
                          onClick={() => setLhExpanded((v) => !v)}
                          title={lhExpanded ? 'Collapse preview' : 'Expand preview'}
                        >▾</button>
                      </>
                    )}
                  </div>

                  {/* Collapsible letterhead preview */}
                  <div className={`ads-paper__lh-preview${lhExpanded && letterheadOn && activeLetterhead ? ' ads-paper__lh-preview--open' : ''}`}>
                    {letterheadOn && activeLetterhead && activeLetterhead.header_image && (
                      <div className="ads-paper__lh-header">
                        <img src={`${import.meta.env.VITE_API_BASE_URL || ''}/api/letterheads/${activeLetterhead.id}/header-image?t=1`} alt="Letterhead" style={{ width: '100%', display: 'block' }} />
                        <div className="ads-paper__lh-rule" style={{ borderColor: activeLetterhead.accent_color || 'var(--accent)' }} />
                      </div>
                    )}
                    {letterheadOn && activeLetterhead && !activeLetterhead.header_image && (
                      <div className="ads-paper__lh-header">
                        {activeLetterhead.logo_path && <img src={`${import.meta.env.VITE_API_BASE_URL || ''}/api/letterheads/${activeLetterhead.id}/logo?t=1`} alt="" className="ads-paper__lh-logo" />}
                        <div className="ads-paper__lh-firm" style={{ color: activeLetterhead.accent_color || 'var(--ink)' }}>{activeLetterhead.name}</div>
                        {activeLetterhead.tagline && <div className="ads-paper__lh-tag">{activeLetterhead.tagline}</div>}
                        {activeLetterhead.qualifications && <div className="ads-paper__lh-detail">{activeLetterhead.qualifications}</div>}
                        {activeLetterhead.enrolment_number && <div className="ads-paper__lh-detail">Enrolment: {activeLetterhead.enrolment_number}{activeLetterhead.bar_council ? ` · ${activeLetterhead.bar_council}` : ''}</div>}
                        {activeLetterhead.courts && <div className="ads-paper__lh-detail">Courts: {activeLetterhead.courts}</div>}
                        {activeLetterhead.address && <div className="ads-paper__lh-addr">{activeLetterhead.address}</div>}
                        {activeLetterhead.contact && <div className="ads-paper__lh-detail">{activeLetterhead.contact}</div>}
                        {activeLetterhead.gstin && <div className="ads-paper__lh-detail" style={{ fontSize: 9 }}>GSTIN: {activeLetterhead.gstin}</div>}
                        <div className="ads-paper__lh-rule" style={{ borderColor: activeLetterhead.accent_color || 'var(--accent)' }} />
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="ads-ribbon-toggle"
                    onClick={() => setRibbonHidden((v) => !v)}
                    title={ribbonHidden ? 'Show toolbar' : 'Hide toolbar'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {ribbonHidden
                        ? <><polyline points="6 9 12 15 18 9" /></>
                        : <><polyline points="18 15 12 9 6 15" /></>
                      }
                    </svg>
                    {ribbonHidden ? 'Show Toolbar' : 'Hide Toolbar'}
                  </button>
                  <div className="ads-paper__editor">
                    <WordCraftEditor
                      key={id}
                      docId={id}
                      seedHtml={storeDoc?.seedHtml || ''}
                      onBridge={setBridge}
                      onChange={onChange}
                      ribbonHidden={ribbonHidden}
                    />
                  </div>
                  {letterheadOn && activeLetterhead && (
                    <div className="ads-paper__lh-footer">
                      <div className="ads-paper__lh-rule" style={{ borderColor: activeLetterhead.accent_color || 'var(--accent)' }} />
                      <div className="ads-paper__lh-foot-row">
                        <span>{confidential ? 'CONFIDENTIAL & PRIVILEGED' : ''}</span>
                        <span>{activeLetterhead.footer || activeLetterhead.name}</span>
                        <span>Page X of Y</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          }
          right={
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--rule)', background: 'var(--paper)', flexShrink: 0 }}>
                <button
                  onClick={() => setRightTab('assistant')}
                  style={{
                    flex: 1, padding: '9px 0', border: 'none', background: 'transparent', cursor: 'pointer',
                    fontSize: '12px', fontWeight: 600, color: rightTab === 'assistant' ? 'var(--accent)' : 'var(--muted)',
                    borderBottom: rightTab === 'assistant' ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  AI Assistant
                </button>
                <button
                  onClick={() => setRightTab('fields')}
                  style={{
                    flex: 1, padding: '9px 0', border: 'none', background: 'transparent', cursor: 'pointer',
                    fontSize: '12px', fontWeight: 600, color: rightTab === 'fields' ? 'var(--accent)' : 'var(--muted)',
                    borderBottom: rightTab === 'fields' ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  Fields{placeholderVars.length > 0 ? ` (${placeholderVars.length})` : ''}
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: rightTab === 'assistant' ? 'flex' : 'none', flexDirection: 'column' }}>
                <AiPanel bridge={bridge} canEdit={editable} />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: rightTab === 'fields' ? 'flex' : 'none', flexDirection: 'column' }}>
                <UnfilledFieldsPanel variables={placeholderVars} bridge={bridge} />
              </div>
            </div>
          }
        />
        <FloatingToolbar wsRef={wsRef} bridge={bridge} onAiAction={(action, text) => {
          console.log('[FloatingToolbar]', action, text?.substring(0, 80));
        }} />
      </div>

      {showShare && <ShareDialog docId={id} myRole={role} onClose={() => setShowShare(false)} />}

      {lhModalOpen && (
        <LetterheadEditor
          letterhead={lhEditTarget}
          onSave={onLetterheadSaved}
          onClose={() => setLhModalOpen(false)}
        />
      )}
    </div>
  );
}
