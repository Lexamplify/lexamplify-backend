import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function fmtWhen(iso) {
  if (!iso) return '';
  // SQLite CURRENT_TIMESTAMP returns 'YYYY-MM-DD HH:MM:SS' in UTC. Treat as UTC.
  const t = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : String(iso).replace(' ', 'T') + 'Z').getTime();
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days < 30 ? `${days}d ago` : new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function Contracts() {
  const navigate = useNavigate();
  const location = useLocation();
  const [upload, setUpload] = useState(false);
  const [handoffText, setHandoffText] = useState('');
  const [handoffName, setHandoffName] = useState('');
  const [past, setPast] = useState([]);
  const [loading, setLoading] = useState(true);

  // Dashboard / Case Vault handoff: another page can navigate to /contracts with
  // location.state = { prefillText, prefillName } to open the upload modal with
  // the document text already loaded. Great for "Analyze this doc" buttons.
  useEffect(() => {
    const s = location.state;
    if (s && (s.prefillText || s.prefillName)) {
      setHandoffText(s.prefillText || '');
      setHandoffName(s.prefillName || '');
      setUpload(true);
      // Clear state so a refresh doesn't re-trigger
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const loadPast = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/contract/analyses`, { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        setPast(Array.isArray(d.analyses) ? d.analyses : []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPast(); }, [loadPast]);

  const deleteOne = async (jobId) => {
    try {
      await fetch(`${API_BASE}/api/contract/analyses/${jobId}`, {
        method: 'DELETE', credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrf() },
      });
      loadPast();
    } catch { /* ignore */ }
  };

  return (
    <div className="lx-page lx-rise">
      <div className="lx-between ph" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 18 }}>
        <div>
          <span className="ph__eyebrow">Contract review</span>
          <h1 className="ph__title">Contracts</h1>
          <p className="ph__sub">Clauses read, risks surfaced and terms benchmarked against the market — in minutes.</p>
        </div>
        <button className="lx-btn lx-btn--gold" onClick={() => setUpload(true)}><Ic.Upload size={15} /> Upload contract</button>
      </div>

      <div className="lx-section-head lx-mt-xl"><h3>Review a contract</h3></div>
      <div className="lx-card lx-card--pad">
        <div className="lx-empty" style={{ padding: '48px 20px' }}>
          <div className="lx-empty__ico"><Ic.Contracts size={22} /></div>
          <h4>Start a new contract review</h4>
          <p style={{ maxWidth: 440, margin: '0 auto' }}>
            Upload a PDF or Word file, or paste the text, and the AI reads every clause — surfacing risks,
            missing protections and anything that sits below market. Reviewed in under a minute.
          </p>
          <button className="lx-btn lx-btn--gold" style={{ marginTop: 16 }} onClick={() => setUpload(true)}>
            <Ic.Upload size={15} /> Upload or paste a contract
          </button>
        </div>
      </div>

      {/* Past analyses — persisted so they survive refresh and process restarts */}
      {!loading && past.length > 0 && (
        <>
          <div className="lx-section-head lx-mt-xl">
            <h3>Past reviews</h3>
            <span className="lx-muted" style={{ fontSize: 13 }}>{past.length} saved</span>
          </div>
          <div className="lx-card lx-card--pad">
            <div className="lx-list">
              {past.map((a) => (
                <div className="lx-item" key={a.id} style={{ padding: '14px 2px', cursor: 'pointer' }} onClick={() => navigate('/contracts/' + a.job_id)}>
                  <div className="lx-item__ico"><Ic.Contracts size={16} /></div>
                  <div className="lx-item__body">
                    <div className="lx-item__title">{a.document_name || 'Contract analysis'}</div>
                    <div className="lx-item__meta">
                      {[
                        a.scan_strategy && a.scan_strategy[0].toUpperCase() + a.scan_strategy.slice(1).toLowerCase() + ' scan',
                        a.page_count ? `${a.page_count} page${a.page_count === 1 ? '' : 's'}` : null,
                        a.word_count ? `${a.word_count.toLocaleString()} words` : null,
                        fmtWhen(a.created_at),
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="lx-btn lx-btn--ghost lx-btn--sm"
                    style={{ padding: '4px 10px', fontSize: 11 }}
                    onClick={(e) => { e.stopPropagation(); if (confirm('Delete this saved review?')) deleteOne(a.job_id); }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {upload && (
        <UploadModal
          onClose={() => { setUpload(false); setHandoffText(''); setHandoffName(''); }}
          onStarted={(jobId) => { setUpload(false); navigate('/contracts/' + jobId); }}
          prefillText={handoffText}
          prefillName={handoffName}
        />
      )}
    </div>
  );
}

// Scan modes supported by the backend: controls how aggressive the AI pass is.
const SCAN_MODES = [
  { id: 'quick',      label: 'Quick',      desc: 'Critical risks only. Fastest for first-pass triage.' },
  { id: 'balanced',   label: 'Balanced',   desc: 'Material risks + missing standard clauses. Recommended.' },
  { id: 'aggressive', label: 'Aggressive', desc: 'Also flags stylistic and low-materiality items. High-value contracts.' },
];

function UploadModal({ onClose, onStarted, prefillText = '', prefillName = '' }) {
  const [file, setFile] = useState(null);
  const [playbook, setPlaybook] = useState(null);
  const [scanMode, setScanMode] = useState('balanced');
  const [text, setText] = useState(prefillText || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const playbookRef = useRef(null);

  const pick = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setErr('');
    }
  };
  const pickPlaybook = (e) => {
    if (e.target.files && e.target.files[0]) {
      setPlaybook(e.target.files[0]);
      setErr('');
    }
  };

  // Extract text from a file via /api/contract/extract-text; returns raw text.
  const extractTextFrom = async (f) => {
    const fd = new FormData();
    fd.append('file', f);
    const r = await fetch(`${API_BASE}/api/contract/extract-text`, {
      method: 'POST', credentials: 'include',
      headers: { 'X-CSRF-TOKEN': csrf() },
      body: fd,
    });
    if (r.status === 401) throw new Error('Your session has expired. Please sign in again.');
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.message || `We could not read ${f.name}. Try a PDF or Word file with selectable text.`);
    }
    const d = await r.json();
    const out = (d.raw_text || d.text || '').trim();
    if (!out) throw new Error(`No readable text could be extracted from ${f.name}.`);
    return out;
  };

  const start = async () => {
    setErr('');
    if (!file && !text.trim()) { setErr('Upload a file or paste contract text to begin.'); return; }
    setBusy(true);
    try {
      let contractText = text.trim();
      if (file) contractText = await extractTextFrom(file);

      // Playbook text (optional) — the firm's custom rulebook that the AI uses as review criteria.
      let ruleBookText = '';
      if (playbook) {
        try {
          ruleBookText = await extractTextFrom(playbook);
        } catch (pbErr) {
          // Don't fail the whole analysis if the playbook can't be read; fall back to standard rules
          console.warn('Playbook text extraction failed, using standard rules:', pbErr.message);
        }
      }

      const res = await fetch(`${API_BASE}/api/contract/analyze`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ text: contractText, ruleBook: ruleBookText, scanStrategy: scanMode }),
      });
      if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.job_id) {
        throw new Error(data.message || (typeof data.error === 'string' ? data.error : '') || 'The analysis could not be started. Please try again.');
      }

      // Persist the raw contract text so the Detail page can power AI chat + cross-check without
      // another extraction round-trip. Scoped by job_id so parallel jobs don't collide.
      try {
        sessionStorage.setItem(`contract_raw_${data.job_id}`, contractText);
        sessionStorage.setItem(`contract_name_${data.job_id}`, file ? file.name : (prefillName || 'Pasted contract'));
      } catch { /* storage may be blocked */ }

      onStarted(data.job_id);
    } catch (e) {
      setErr(e.message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Review a contract"
      onClose={busy ? () => {} : onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={start} disabled={busy}>{busy ? 'Starting review…' : 'Analyze contract'}</button>
      </>}
    >
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}

      {/* Main contract file / paste */}
      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{ display: 'none' }} onChange={pick} />
      <div
        onClick={() => !busy && fileRef.current && fileRef.current.click()}
        style={{ border: '1.5px dashed var(--rule)', borderRadius: 14, padding: '36px 20px', textAlign: 'center', background: 'var(--paper-2)', cursor: busy ? 'default' : 'pointer' }}
      >
        <div className="lx-empty__ico" style={{ margin: '0 auto 14px' }}><Ic.Upload size={22} /></div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--ink)' }}>
          {file ? file.name : 'Drop a PDF or Word file'}
        </div>
        <div className="lx-muted" style={{ marginTop: 6 }}>
          {file ? 'Click to choose a different file' : 'or click to browse — reviewed in under a minute'}
        </div>
      </div>

      <div style={{ textAlign: 'center', margin: '16px 0 4px', color: 'var(--muted)', fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase' }}>or paste the text</div>
      <div>
        <label className="lbl">Paste contract text</label>
        <textarea
          className="inp"
          value={text}
          onChange={(e) => { setText(e.target.value); if (e.target.value) setErr(''); }}
          placeholder="Paste the full contract text here…"
          style={{ minHeight: 100, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
      </div>

      {/* ── Scan mode selector ─────────────────────────────────────────── */}
      <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
        <label className="lbl">Scan mode</label>
        <div className="lx-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {SCAN_MODES.map((m) => (
            <button
              type="button"
              key={m.id}
              onClick={() => setScanMode(m.id)}
              className="lx-btn lx-btn--sm"
              style={scanMode === m.id
                ? { background: 'var(--ink)', color: 'var(--paper)' }
                : { background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--rule)' }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="lx-muted" style={{ fontSize: 12, marginTop: 6 }}>
          {SCAN_MODES.find((m) => m.id === scanMode)?.desc}
        </div>
      </div>

      {/* ── Playbook upload (optional) ────────────────────────────────── */}
      <div style={{ marginTop: 8 }}>
        <label className="lbl">
          Firm playbook <span className="lx-muted" style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, fontSize: 12 }}>— optional, custom rulebook</span>
        </label>
        <input ref={playbookRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{ display: 'none' }} onChange={pickPlaybook} />
        <div
          onClick={() => !busy && playbookRef.current && playbookRef.current.click()}
          style={{ border: '1px dashed var(--rule)', borderRadius: 10, padding: '14px 16px', background: 'var(--bg-card)', cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <Ic.Doc size={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>
              {playbook ? playbook.name : 'Add your firm’s playbook (PDF/DOCX/TXT)'}
            </div>
            <div className="lx-muted" style={{ fontSize: 12, marginTop: 2 }}>
              {playbook ? 'Click to replace. The AI will apply these rules on top of statutory review.' : 'Standard Indian contract rules apply when no playbook is provided.'}
            </div>
          </div>
          {playbook && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setPlaybook(null); }}
              className="lx-btn lx-btn--ghost lx-btn--sm"
              style={{ padding: '2px 10px', fontSize: 11 }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
