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
  // In-flight analyses, fetched from /analyses/active. These render as
  // live cards at the top of Past Reviews with their own progress bar
  // and stage line. Polled every 2s while any job is live, so completed
  // ones flip over to the persisted shape without manual refresh.
  // null = first fetch hasn't landed yet (don't render anything that
  // depends on it); [] = fetch landed and there's nothing in flight.
  // This stops the inline panel from FLICKERING on re-mount: between
  // navigating in and the first /active response, the user used to
  // briefly see the "Start a new contract review" empty state before
  // the panel re-appeared.
  const [active, setActive] = useState(null);
  // Error from the one-click submit (fetch failure, 401, 429, etc).
  const [submitError, setSubmitError] = useState('');

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

  const loadActive = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/contract/analyses/active`, { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        // Merge server rows with any optimistic placeholders already
        // in state. A placeholder has job_id starting with 'optim_' and
        // sticks around until the real analyze-file POST returns the
        // server job_id (which replaces it).
        setActive((prev) => {
          const serverRows = Array.isArray(d.active) ? d.active : [];
          const stillOptim = (prev || []).filter((r2) => String(r2.job_id).startsWith('optim_'));
          return [...stillOptim, ...serverRows];
        });
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadPast(); loadActive(); }, [loadPast, loadActive]);

  // Poll /analyses/active while any job is in-flight so the live card's
  // progress + stage update even if the user is sitting on this page.
  // 2s cadence is fine — the job store writes at every stage boundary
  // and OCR page completion, so the user sees real motion.
  useEffect(() => {
    if (!active || active.length === 0) return undefined;
    const t = setInterval(async () => {
      await loadActive();
    }, 2000);
    return () => clearInterval(t);
  }, [active, loadActive]);

  // Also refetch Past when an active job vanishes (completed → persisted).
  const prevActiveIdsRef = useRef('');
  useEffect(() => {
    if (!active) return;
    const nowIds = active.map((a) => a.job_id).sort().join(',');
    const prev = prevActiveIdsRef.current;
    if (prev && prev !== nowIds) loadPast();
    prevActiveIdsRef.current = nowIds;
  }, [active, loadPast]);

  // Submit a file for analysis. Called by UploadModal on click. We
  // insert an optimistic placeholder into `active` SYNCHRONOUSLY so
  // the inline panel appears before the backend has even been contacted
  // — the modal closes instantly, no awkward "modal plus panel visible
  // at the same time" moment the user flagged. The real fetch resolves
  // in the background and the server job_id replaces the placeholder.
  const submitAnalysis = useCallback(async ({ file, playbook, scanMode, text, name }) => {
    setSubmitError('');
    // Optimistic placeholder — opens the inline panel the instant the
    // modal closes.
    const optimId = `optim_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const placeholder = {
      job_id: optimId,
      status: 'processing',
      progress: 1,
      stage: file ? `Uploading ${file.name}…` : 'Starting the review…',
      document_name: file ? file.name : (name || 'Pasted contract'),
      scan_strategy: scanMode,
      created_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
    };
    setActive((prev) => [placeholder, ...(prev || [])]);

    try {
      let data;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        if (playbook) fd.append('playbook', playbook);
        fd.append('scanStrategy', scanMode);
        const res = await fetch(`${API_BASE}/api/contract/analyze-file`, {
          method: 'POST', credentials: 'include',
          headers: { 'X-CSRF-TOKEN': csrf() },
          body: fd,
        });
        if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
        data = await res.json().catch(() => ({}));
        if (!res.ok || !data.job_id) throw new Error(data.message || 'The analysis could not be started.');
      } else {
        const res = await fetch(`${API_BASE}/api/contract/analyze`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
          body: JSON.stringify({ text: text.trim(), scanStrategy: scanMode }),
        });
        if (res.status === 401) throw new Error('Your session has expired. Please sign in again.');
        data = await res.json().catch(() => ({}));
        if (!res.ok || !data.job_id) throw new Error(data.message || 'The analysis could not be started.');
      }

      try {
        sessionStorage.setItem(`contract_name_${data.job_id}`, file ? file.name : (name || 'Pasted contract'));
      } catch { /* ignore */ }
      try {
        const { useJobsStore } = await import('../stores/useJobsStore.js');
        useJobsStore.getState().register(data.job_id, 'contract', {
          title: file ? file.name : (name || 'Pasted contract'),
        });
      } catch { /* ignore */ }

      // Replace the optimistic row with a stub carrying the real job_id,
      // then kick a fresh /active poll so the stage/progress bind to the
      // backend's own numbers on the next render.
      setActive((prev) => (prev || []).map((r) =>
        r.job_id === optimId
          ? { ...r, job_id: data.job_id, status: 'processing', stage: 'Reading document…' }
          : r
      ));
      loadActive();
    } catch (e) {
      // Drop the placeholder and surface the error inline.
      setActive((prev) => (prev || []).filter((r) => r.job_id !== optimId));
      setSubmitError(e.message || 'Could not start the analysis.');
    }
  }, [loadActive]);

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

      {submitError && (
        <div role="alert" style={{
          margin: '16px 0', padding: '12px 16px',
          background: 'rgba(220, 60, 60, 0.08)', border: '1px solid rgba(220, 60, 60, 0.3)',
          color: 'var(--risk, #b53535)', borderRadius: 10, fontSize: 13,
        }}>
          {submitError}
        </div>
      )}
      <div className="lx-section-head lx-mt-xl"><h3>Review a contract</h3></div>
      <div className="lx-card lx-card--pad">
        {active === null ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Loading your contract reviews…
          </div>
        ) : active.filter((a) => a.status !== 'failed').length > 0 ? (
          // The TOP panel always shows the most-recent STILL-RUNNING
          // job. Failed ones push down into the Past Reviews list where
          // they get a Dismiss button. This stops a failed row from
          // claiming the big inline panel real estate while a newer
          // retry is actually making progress below.
          <InlineAnalysisPanel
            job={active.filter((a) => a.status !== 'failed')[0]}
            others={active.filter((a) => a.status !== 'failed').slice(1)}
            onStartAnother={() => setUpload(true)}
          />
        ) : active.length > 0 ? (
          // No in-flight jobs but at least one failure in the window —
          // show a quiet "nothing's running" state with a Start-another
          // call to action. The failure rows render below in Past
          // Reviews with their Dismiss / Try again buttons.
          <div className="lx-empty" style={{ padding: '48px 20px' }}>
            <div className="lx-empty__ico"><Ic.Contracts size={22} /></div>
            <h4>No reviews in progress</h4>
            <p style={{ maxWidth: 440, margin: '0 auto' }}>
              Your last review ran into a problem — see the row below. You can retry it
              or start a new one.
            </p>
            <button className="lx-btn lx-btn--gold" style={{ marginTop: 16 }} onClick={() => setUpload(true)}>
              <Ic.Upload size={15} /> Upload or paste a contract
            </button>
          </div>
        ) : (
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
        )}
      </div>

      {/* Past analyses — persisted so they survive refresh and process restarts.
          In-flight jobs render as live rows at the TOP (orange progress), then
          completed rows below. One section, one list, so the user doesn't have
          to look in two places for "what's being reviewed right now". */}
      {!loading && (((active || []).length > 0) || past.length > 0) && (
        <>
          <div className="lx-section-head lx-mt-xl">
            <h3>Past reviews</h3>
            <span className="lx-muted" style={{ fontSize: 13 }}>
              {(active || []).length > 0 && `${(active || []).length} in progress · `}{past.length} saved
            </span>
          </div>
          <div className="lx-card lx-card--pad">
            <div className="lx-list">
              {(active || []).map((a) => (
                <LiveReviewRow
                  key={`live-${a.job_id}`}
                  job={a}
                  onOpen={() => a.job_id && !String(a.job_id).startsWith('optim_') && navigate('/contracts/' + a.job_id)}
                  onDismiss={a.status === 'failed' ? async () => {
                    // Hide optimistically, then tell the server not to
                    // re-surface it. Even if the DELETE fails (server
                    // down), the row stays gone on this client.
                    setActive((prev) => (prev || []).filter((r) => r.job_id !== a.job_id));
                    try {
                      await fetch(`${API_BASE}/api/contract/analyses/active/${a.job_id}`, {
                        method: 'DELETE', credentials: 'include',
                        headers: { 'X-CSRF-TOKEN': csrf() },
                      });
                    } catch { /* ignore */ }
                  } : undefined}
                  onRetry={a.status === 'failed' ? () => {
                    // "Try again" just re-opens the upload modal with
                    // the previous file's name as a prefill hint, since
                    // the actual bytes aren't kept client-side.
                    setHandoffName(a.document_name || '');
                    setUpload(true);
                  } : undefined}
                />
              ))}
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
          // One-click submit: the modal just hands up the picked file +
          // strategy and closes IMMEDIATELY. Parent inserts an optimistic
          // placeholder into `active` synchronously so the inline panel
          // appears before the backend has even been contacted. The
          // actual /analyze-file fetch runs in the parent so it survives
          // the modal unmount — no race between "did the backend return
          // the job_id yet?" and "modal is still open showing the old
          // striped bar."
          onSubmit={(payload) => {
            setUpload(false);
            setHandoffText(''); setHandoffName('');
            submitAnalysis(payload);
          }}
          prefillText={handoffText}
          prefillName={handoffName}
        />
      )}
    </div>
  );
}

// Inline analysis panel — replaces the "Start a new contract review"
// empty state on the Contracts page whenever at least one analysis is
// running. Shows the current stage ("Reading page 42 / 200",
// "Reviewing section 3 of 7") and a progress bar. Clicking the panel
// opens the detail page for live SSE streaming + the final results.
function InlineAnalysisPanel({ job, others = [], onStartAnother }) {
  const navigate = useNavigate();
  const [elapsed, setElapsed] = useState(0);
  const startedRef = useRef(job.created_at ? job.created_at * 1000 : Date.now());
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const progress = Math.max(2, Math.min(99, Math.round(job.progress || 0)));

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: 'rgba(178, 74, 46, 0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)',
        }}>
          <Ic.Contracts size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {job.document_name || 'Contract analysis'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            {job.scan_strategy ? `${job.scan_strategy} scan · ` : ''}{mm}:{ss} elapsed
          </div>
        </div>
        <button
          type="button"
          className="lx-btn lx-btn--ghost lx-btn--sm"
          onClick={() => navigate('/contracts/' + job.job_id)}
          style={{ fontSize: 12 }}
        >
          Open detail →
        </button>
      </div>
      {/* Progress bar — real value when known, indeterminate shimmer under 2%. */}
      <div style={{
        width: '100%', height: 6, background: 'rgba(0,0,0,0.06)',
        borderRadius: 999, overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${progress}%`,
          background: 'var(--accent)', borderRadius: 999,
          transition: 'width 0.5s ease-out',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, fontSize: 13 }}>
        <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{job.stage || 'Working…'}</span>
        <span style={{ color: 'var(--muted)' }}>{progress}%</span>
      </div>
      {/* Honest ETA — different for scanned vs digital, inferred from the stage text. */}
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        {/^OCR page/i.test(job.stage || '')
          ? 'This looks like a scanned PDF — OCR runs on every page. Expect ~1 minute per 20 pages. You can navigate anywhere; the review keeps running in the background.'
          : 'The AI is reading your contract. You can navigate anywhere; the review keeps running in the background.'}
      </div>
      {others.length > 0 && (
        <div style={{ marginTop: 18, padding: '12px 0 0 0', borderTop: '1px dashed var(--rule)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            Also running
          </div>
          {others.map((o) => (
            <div key={o.job_id} style={{ fontSize: 13, color: 'var(--ink)', padding: '4px 0', cursor: 'pointer' }} onClick={() => navigate('/contracts/' + o.job_id)}>
              {o.document_name || 'Contract'} — {o.stage || 'Working…'} ({Math.round(o.progress || 0)}%)
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onStartAnother}>
          <Ic.Upload size={13} /> Start another review
        </button>
      </div>
    </div>
  );
}

// Compact live-progress row for Past Reviews — one per in-flight job,
// rendered at the top of the saved list so the user has a single place
// to look for "what has been reviewed and what is being reviewed now".
// Failed jobs render here too (red state + Dismiss button + Retry link)
// so the user sees the real reason instead of the row silently vanishing.
function LiveReviewRow({ job, onOpen, onDismiss, onRetry }) {
  const failed = job.status === 'failed';
  const progress = Math.max(2, Math.min(99, Math.round(job.progress || 0)));
  if (failed) {
    return (
      <div className="lx-item" style={{ padding: '14px 2px', alignItems: 'flex-start' }}>
        <div className="lx-item__ico" style={{ color: 'var(--risk, #b53535)' }}>
          <Ic.Contracts size={16} />
        </div>
        <div className="lx-item__body">
          <div className="lx-item__title">{job.document_name || 'Contract analysis'}</div>
          <div className="lx-item__meta" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(220, 60, 60, 0.1)', color: 'var(--risk, #b53535)',
              padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
              alignSelf: 'flex-start',
            }}>
              Failed
            </span>
            {job.error && (
              <span style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.5 }}>
                {job.error}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {onRetry && (
            <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm"
                    style={{ padding: '2px 10px', fontSize: 11 }}
                    onClick={(e) => { e.stopPropagation(); onRetry(); }}>
              Try again
            </button>
          )}
          {onDismiss && (
            <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm"
                    style={{ padding: '2px 10px', fontSize: 11, color: 'var(--muted)' }}
                    onClick={(e) => { e.stopPropagation(); onDismiss(); }}>
              Dismiss
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="lx-item" style={{ padding: '14px 2px', cursor: 'pointer' }} onClick={onOpen}>
      <div className="lx-item__ico"><Ic.Contracts size={16} /></div>
      <div className="lx-item__body">
        <div className="lx-item__title">{job.document_name || 'Contract analysis'}</div>
        <div className="lx-item__meta" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(178, 74, 46, 0.1)', color: 'var(--accent)',
            padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                           animation: 'lxPulse 1.4s ease-in-out infinite' }} />
            Analysing · {progress}%
          </span>
          <span style={{ fontSize: 12 }}>{job.stage || 'Working…'}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Open →</div>
      <style>{`@keyframes lxPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }`}</style>
    </div>
  );
}

// Scan modes supported by the backend: controls how aggressive the AI pass is.
const SCAN_MODES = [
  { id: 'quick',      label: 'Quick',      desc: 'Critical risks only. Fastest for first-pass triage.' },
  { id: 'balanced',   label: 'Balanced',   desc: 'Material risks + missing standard clauses. Recommended.' },
  { id: 'aggressive', label: 'Aggressive', desc: 'Also flags stylistic and low-materiality items. High-value contracts.' },
];

function UploadModal({ onClose, onSubmit, prefillText = '', prefillName = '' }) {
  const [file, setFile] = useState(null);
  const [playbook, setPlaybook] = useState(null);
  const [scanMode, setScanMode] = useState('balanced');
  const [text, setText] = useState(prefillText || '');
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const playbookRef = useRef(null);
  // Note: the modal no longer owns the in-flight fetch, elapsed timer,
  // minimize state, or any striped-bar UI. All of that moved to the
  // parent (Contracts) so the modal can close INSTANTLY on click
  // instead of blocking while the backend creates the job.

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

  // One-click submit — validate locally, hand the payload up to the
  // parent, close in the same tick. Parent fires the fetch, inserts
  // the optimistic row into Past Reviews, and shows the inline panel.
  const start = () => {
    setErr('');
    if (!file && !text.trim()) { setErr('Upload a file or paste contract text to begin.'); return; }
    onSubmit({
      file, playbook, scanMode,
      text: text.trim(),
      name: file ? file.name : (prefillName || 'Pasted contract'),
    });
  };

  return (
    <Modal
      title="Review a contract"
      onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose}>Cancel</button>
        <button className="lx-btn lx-btn--primary" onClick={start}>Analyze contract</button>
      </>}
    >
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}

      {/* Main contract file / paste */}
      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{ display: 'none' }} onChange={pick} />
      <div
        onClick={() => fileRef.current && fileRef.current.click()}
        style={{ border: '1.5px dashed var(--rule)', borderRadius: 14, padding: '36px 20px', textAlign: 'center', background: 'var(--paper-2)', cursor: 'pointer' }}
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
          onClick={() => playbookRef.current && playbookRef.current.click()}
          style={{ border: '1px dashed var(--rule)', borderRadius: 10, padding: '14px 16px', background: 'var(--bg-card)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
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
