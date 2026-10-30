import { useState, useRef, useCallback } from 'react';
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

  function fullscreen() {
    const el = wsRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }

  async function exportDocx() {
    if (!bridge) return;
    const bytes = await bridge.bytes('docx');
    if (!bytes) return;
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (doc.title || 'draft').replace(/[^\w.-]+/g, '_') + '.docx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
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
        <div className="dez-editor">
          <WordCraftEditor
            key={id}
            docId={id}
            seedHtml={storeDoc?.seedHtml || ''}
            onBridge={setBridge}
            onChange={onChange}
          />
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
