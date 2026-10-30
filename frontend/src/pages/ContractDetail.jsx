import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as Ic from '../icons.jsx';
import Modal from '../components/Modal.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// Map the backend severity vocabulary onto the luxury badge tones/levels.
const SEV = {
  critical: { tone: 'risk', level: 'High risk' },
  caution: { tone: 'warn', level: 'Caution' },
  major: { tone: 'warn', level: 'Major' },
  minor: { tone: 'ok', level: 'Minor' },
};
function sevInfo(s) {
  const l = (s || '').toLowerCase();
  if (SEV[l]) return SEV[l];
  return { tone: 'muted', level: s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Note' };
}
const plural = (n) => (n === 1 ? '' : 's');

export default function ContractDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  // phase: loading | running | complete | failed | gone | expired
  const [phase, setPhase] = useState('loading');
  const [stage, setStage] = useState('Preparing the review…');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const timerRef = useRef(null);

  // Per-risk redline suggestions keyed by the risk id (falling back to its index).
  // Shape: { [key]: { loading, text, error, copied } }
  const [redlines, setRedlines] = useState({});
  // Export report state (POST /api/contract/export → downloadable file blob).
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState('');

  // Flag navigator — tracks which risk is currently focused on the document surface
  const [activeFlagId, setActiveFlagId] = useState(null);
  // Missing clauses inserted into the document, kept as (id -> inserted text).
  // On insert we append the model clause to a supplement block appended to rawText.
  const [insertedMissing, setInsertedMissing] = useState({}); // { [id]: text }
  // Progress log entries — the backend's stage string pushed as timestamped lines
  // during polling. Shown in a small console beside the progress bar.
  const [logs, setLogs] = useState([]);
  const startedAtRef = useRef(0);
  // Save-to-drafts state
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftMsg, setDraftMsg] = useState(null); // { ok, text }

  // Inline comments pinned to selected text in the document surface.
  // Shape: { id, quote, body, created_at }
  const [comments, setComments] = useState(() => {
    try { const v = localStorage.getItem(`contract_comments_${id}`); return v ? JSON.parse(v) : []; }
    catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(`contract_comments_${id}`, JSON.stringify(comments)); } catch {}
  }, [comments, id]);
  const addComment = (quote, body) => {
    const c = { id: `c-${Date.now()}`, quote, body, created_at: new Date().toISOString() };
    setComments((prev) => [c, ...prev]);
  };
  const deleteComment = (cid) => setComments((prev) => prev.filter((x) => x.id !== cid));

  // AI chat + cross-document conflicts modals — both need the raw contract text,
  // which we stashed in sessionStorage at upload time (see Contracts.jsx start()).
  const [showChat, setShowChat] = useState(false);
  const [showCrossCheck, setShowCrossCheck] = useState(false);
  // These start from sessionStorage, but if the user refreshes/reopens the page
  // on a different browser we fall back to the DB-stored copy (see loadFromDb below).
  const [rawText, setRawText] = useState(() => {
    try { return sessionStorage.getItem(`contract_raw_${id}`) || ''; }
    catch { return ''; }
  });
  const [contractDisplayName, setContractDisplayName] = useState(() => {
    try { return sessionStorage.getItem(`contract_name_${id}`) || ''; }
    catch { return ''; }
  });

  // Load a persisted analysis from DB when the in-memory job is gone (page refresh,
  // new browser, server restart). Fills result + rawText so chat/cross-check still work.
  const loadFromDb = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/contract/analyses/${id}`, { credentials: 'include' });
      if (!r.ok) return false;
      const d = await r.json();
      if (d && d.results) {
        setResult(d.results);
        setProgress(100);
        setPhase('complete');
        if (d.raw_text) setRawText(d.raw_text);
        if (d.document_name) setContractDisplayName(d.document_name);
        return true;
      }
    } catch { /* ignore */ }
    return false;
  };

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/contract/analysis-status/${id}`, { credentials: 'include', cache: 'no-store' });
        if (!alive) return;
        if (res.status === 404) {
          // In-memory job gone — try the DB-saved copy before giving up.
          const restored = await loadFromDb();
          if (!restored && alive) setPhase('gone');
          return;
        }
        if (res.status === 401 || res.status === 403) { setPhase('expired'); return; }
        if (!res.ok) throw new Error('status ' + res.status);

        const data = await res.json();
        if (!alive) return;

        if (data.status === 'complete') {
          if (!data.results) {
            setErrMsg('The analysis finished without a result. Please run it again.');
            setPhase('failed');
            return;
          }
          setResult(data.results);
          setProgress(100);
          setPhase('complete');
          return;
        }
        if (data.status === 'failed') {
          setErrMsg(data.error || 'The analysis could not be completed. Please try again.');
          setPhase('failed');
          return;
        }
        // still running
        setPhase('running');
        if (!startedAtRef.current) startedAtRef.current = Date.now();
        if (typeof data.progress === 'number') setProgress(Math.max(5, Math.min(95, data.progress)));
        if (data.stage && data.stage !== stage) {
          const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
          const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
          const ss = String(elapsed % 60).padStart(2, '0');
          setLogs((prev) => [...prev.slice(-29), { t: `${mm}:${ss}`, text: data.stage }]);
          setStage(data.stage);
        }
        timerRef.current = setTimeout(poll, 2000);
      } catch {
        if (!alive) return;
        // Transient network / cold-start: keep showing the running state and retry.
        setPhase((p) => (p === 'complete' || p === 'failed' || p === 'gone' || p === 'expired' ? p : 'running'));
        setStage('Reconnecting to the server…');
        timerRef.current = setTimeout(poll, 3000);
      }
    };

    poll();
    return () => { alive = false; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [id]);

  // ── Suggest a redline for one flagged clause ────────────────────────────────
  // POST /api/contract/rewrite  { original_clause, issue, user_intent }
  //   → { rewritten, revision, replacementText, diffSegments, diffHtml }
  const suggestRedline = async (key, risk) => {
    const original = (risk.excerpt || risk.original || risk.original_text || risk.text || '').trim();
    if (!original) {
      setRedlines((p) => ({ ...p, [key]: { loading: false, text: '', error: 'This flag has no clause text to rewrite.' } }));
      return;
    }
    setRedlines((p) => ({ ...p, [key]: { loading: true, text: '', error: '' } }));
    try {
      const res = await fetch(`${API_BASE}/api/contract/rewrite`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({
          original_clause: original,
          issue: (risk.recommendation || risk.rationale || risk.title || '').trim(),
          user_intent: 'Rewrite this clause to be fair, balanced, and enforceable under Indian contract law.',
        }),
      });
      if (res.status === 401 || res.status === 403) {
        setRedlines((p) => ({ ...p, [key]: { loading: false, text: '', error: 'Your session has expired. Please sign in again.' } }));
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRedlines((p) => ({ ...p, [key]: { loading: false, text: '', error: data.error || 'Could not generate a redline. Please try again.' } }));
        return;
      }
      const text = (data.rewritten || data.revision || data.replacementText || '').trim();
      if (!text) {
        setRedlines((p) => ({ ...p, [key]: { loading: false, text: '', error: 'The AI did not return a rewrite. Please try again.' } }));
        return;
      }
      setRedlines((p) => ({ ...p, [key]: { loading: false, text, error: '' } }));
    } catch {
      setRedlines((p) => ({ ...p, [key]: { loading: false, text: '', error: 'Unable to reach the rewrite service. Please check your connection.' } }));
    }
  };

  const copyRedline = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setRedlines((p) => (p[key] ? { ...p, [key]: { ...p[key], copied: true } } : p));
      setTimeout(() => setRedlines((p) => (p[key] ? { ...p, [key]: { ...p[key], copied: false } } : p)), 2000);
    } catch {
      /* clipboard unavailable — the text is still visible for manual copy */
    }
  };

  // ── Export the review as a downloadable report ──────────────────────────────
  // POST /api/contract/export { document_text, format } → file blob (send_file).
  // Compose the reviewed contract (original + inserted standard clauses) and save
  // it as a new draft the user can open in Auto-Draft Studio to keep editing.
  const saveToDrafts = async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    setDraftMsg(null);
    try {
      const compiled = (rawText || '') + Object.values(insertedMissing).join('');
      const r = await fetch(`${API_BASE}/api/contract/save-to-draft`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({
          title: contractDisplayName || docName || 'Reviewed contract',
          text: compiled,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Could not save to drafts.');
      setDraftMsg({ ok: true, text: 'Saved to Auto-Draft Studio.' });
      setTimeout(() => setDraftMsg(null), 4000);
    } catch (e) {
      setDraftMsg({ ok: false, text: e.message || 'Could not save.' });
    } finally {
      setSavingDraft(false);
    }
  };

  const exportReport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportErr('');
    try {
      const lines = [];
      lines.push(`CONTRACT REVIEW — ${docName}`);
      if (pages || words) lines.push([pages ? `${pages} page${plural(pages)}` : '', words ? `${words.toLocaleString()} words` : ''].filter(Boolean).join(' · '));
      lines.push('');
      lines.push(`Summary: ${risks.length} risk flag${plural(risks.length)}, ${missing.length} missing standard clause${plural(missing.length)}, ${citations.length} citation${plural(citations.length)} matched.`);
      lines.push('');
      if (risks.length) {
        lines.push('FLAGGED CLAUSES');
        risks.forEach((x, i) => {
          const info = sevInfo(x.severity);
          lines.push(`${i + 1}. [${info.level}] ${x.title || x.location || `Clause ${i + 1}`}${x.location && x.location !== x.title ? ` (${x.location})` : ''}`);
          if (x.excerpt || x.original || x.text) lines.push(`   Clause: ${x.excerpt || x.original || x.text}`);
          if (x.recommendation || x.rationale) lines.push(`   Recommendation: ${x.recommendation || x.rationale}`);
          lines.push('');
        });
      }
      if (missing.length) {
        lines.push('MISSING STANDARD CLAUSES');
        missing.forEach((m, i) => {
          lines.push(`${i + 1}. ${m.title}`);
          if (m.rationale || m.model || m.clause) lines.push(`   ${m.rationale || m.model || m.clause}`);
          lines.push('');
        });
      }
      const res = await fetch(`${API_BASE}/api/contract/export`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ document_text: lines.join('\n'), format: 'pdf' }),
      });
      if (res.status === 401 || res.status === 403) { setExportErr('Your session has expired. Please sign in again.'); return; }
      if (!res.ok) { setExportErr('Could not generate the report. Please try again.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${String(docName).replace(/\.[^/.]+$/, '') || 'Contract'}_Review.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportErr('Unable to reach the export service. Please check your connection.');
    } finally {
      setExporting(false);
    }
  };

  // ── Derive the real analysis shape ──────────────────────────────────────────
  const risks = result ? (result.risks || result.clauses || []) : [];
  const missing = result ? (result.missing || result.missing_clauses || []) : [];
  const citations = result ? (result.citations || []) : [];
  const warnings = (result && result.coverage && Array.isArray(result.coverage.warnings)) ? result.coverage.warnings : [];
  const pages = result ? (result.page_count || null) : null;
  const words = result ? (result.word_count || null) : null;
  const docName = (result && (result.document_name || result.name)) || 'Contract analysis';

  const metaBits = [];
  if (pages) metaBits.push(`${pages} page${plural(pages)}`);
  if (words) metaBits.push(`${words.toLocaleString()} words`);
  metaBits.push(phase === 'complete' ? 'Reviewed just now' : 'Review in progress');

  return (
    <div className="lx-page lx-rise">
      <div className="dh">
        <button className="dh__back" onClick={() => navigate('/contracts')}><Ic.Arrow size={14} style={{ transform: 'rotate(180deg)' }} /> All contracts</button>
        <div className="dh__row">
          <div>
            <h1 className="dh__title font-display">{phase === 'complete' ? docName : 'Contract review'}</h1>
            <div className="dh__meta">
              {metaBits.map((b, i) => <span key={i}>{i === 0 && phase === 'complete' ? <b>{b}</b> : b}</span>)}
            </div>
          </div>
          {phase === 'complete' && (
            <div className="lx-stack" style={{ gap: 6, alignItems: 'flex-end' }}>
              <div className="lx-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {rawText && (
                  <button
                    className="lx-btn lx-btn--ghost lx-btn--sm"
                    onClick={() => setShowCrossCheck(true)}
                    title="Compare this contract with another document to find conflicting clauses"
                  >
                    <Ic.Doc size={14} /> Compare with…
                  </button>
                )}
                {rawText && (
                  <button
                    className="lx-btn lx-btn--gold lx-btn--sm"
                    onClick={() => setShowChat(true)}
                  >
                    <Ic.Sparkle size={14} /> Ask about this contract
                  </button>
                )}
                {rawText && (
                  <button
                    className="lx-btn lx-btn--ghost lx-btn--sm"
                    onClick={saveToDrafts}
                    disabled={savingDraft}
                    title="Save the reviewed contract (with inserted clauses) as a draft in Auto-Draft Studio"
                  >
                    <Ic.Draft size={14} /> {savingDraft ? 'Saving…' : 'Save to drafts'}
                  </button>
                )}
                <button
                  className="lx-btn lx-btn--ghost lx-btn--sm"
                  onClick={exportReport}
                  disabled={exporting}
                >
                  <Ic.Upload size={14} /> {exporting ? 'Preparing…' : 'Export report'}
                </button>
              </div>
              {exportErr && <div style={{ fontSize: 12, color: 'var(--risk)', maxWidth: 240, textAlign: 'right' }}>{exportErr}</div>}
              {draftMsg && <div style={{ fontSize: 12, color: draftMsg.ok ? 'var(--accent-ink, #0b7a60)' : 'var(--risk)', maxWidth: 320, textAlign: 'right' }}>{draftMsg.text}</div>}
            </div>
          )}
        </div>
      </div>

      {phase === 'complete' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 0.9fr)', gap: 24, alignItems: 'start' }} className="draft-grid">
          <div className="lx-stack" style={{ gap: 24 }}>
          {/* ── Document surface — raw contract with risks highlighted inline ─────── */}
          {rawText && (
            <DocumentSurface
              rawText={rawText}
              risks={risks}
              activeFlagId={activeFlagId}
              onFlagClick={setActiveFlagId}
              insertedClauses={Object.values(insertedMissing)}
              onAddComment={addComment}
            />
          )}

          {/* ── Comments — stored locally per analysis, pinned to selected text ─── */}
          {rawText && comments.length > 0 && (
            <div className="lx-card lx-card--pad">
              <div className="lx-between" style={{ marginBottom: 12 }}>
                <div className="lx-title" style={{ fontSize: 16 }}>Comments</div>
                <span className="lx-muted" style={{ fontSize: 13 }}>{comments.length}</span>
              </div>
              <div className="lx-list">
                {comments.map((c) => (
                  <div key={c.id} className="lx-item" style={{ alignItems: 'flex-start', padding: '12px 2px' }}>
                    <div className="lx-item__ico"><Ic.Doc size={14} /></div>
                    <div className="lx-item__body">
                      <blockquote style={{
                        margin: 0, padding: '6px 10px',
                        background: 'var(--paper-2, var(--bg-card))',
                        borderLeft: '3px solid var(--accent-ink, #c99a4a)',
                        borderRadius: '0 6px 6px 0',
                        fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5,
                        fontStyle: 'italic',
                      }}>"{c.quote.length > 180 ? c.quote.slice(0, 180) + '…' : c.quote}"</blockquote>
                      <div style={{ fontSize: 13.5, color: 'var(--ink)', marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                        {new Date(c.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <button
                      className="lx-btn lx-btn--ghost lx-btn--sm"
                      style={{ padding: '4px 10px', fontSize: 11 }}
                      onClick={() => deleteComment(c.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="lx-card lx-card--pad">
            <div className="lx-between" style={{ marginBottom: 14 }}>
              <div className="lx-title" style={{ fontSize: 16 }}>Clause-by-clause</div>
              <span className={`lx-badge lx-badge--${risks.length ? 'warn' : 'ok'}`}>{risks.length} flag{plural(risks.length)}</span>
            </div>
            {risks.length === 0 ? (
              <div className="lx-empty" style={{ padding: '28px 10px' }}>
                <div className="lx-empty__ico"><Ic.Check size={20} /></div>
                <h4>No material issues</h4>
                <p>The AI did not flag any high-risk clauses in this document.</p>
              </div>
            ) : (
              <div className="lx-list">
                {risks.map((x, i) => {
                  const info = sevInfo(x.severity);
                  const note = x.excerpt || x.original || x.original_text || x.text || x.recommendation || x.rationale || '';
                  const key = x.id || i;
                  const canRedline = !!(x.excerpt || x.original || x.original_text || x.text);
                  const rl = redlines[key];
                  return (
                    <div
                      className="lx-item"
                      key={x.id || i}
                      style={{
                        alignItems: 'flex-start',
                        padding: '16px 4px',
                        cursor: 'pointer',
                        background: activeFlagId === key ? 'var(--paper-2, var(--bg-card))' : 'transparent',
                        borderRadius: 8,
                      }}
                      onClick={() => setActiveFlagId(key)}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: info.tone === 'risk' ? 'var(--risk)' : info.tone === 'warn' ? 'var(--warn)' : info.tone === 'ok' ? 'var(--ok)' : 'var(--muted-2)' }} />
                      <div className="lx-item__body">
                        <div className="lx-between" style={{ alignItems: 'baseline', gap: 10 }}>
                          <div className="lx-item__title" style={{ fontSize: 15 }}>{x.title || x.location || `Clause ${i + 1}`}</div>
                          <span className={`lx-badge lx-badge--${info.tone}`} style={{ flexShrink: 0 }}>{info.level}</span>
                        </div>
                        {x.location && x.title && x.location !== x.title && (
                          <div className="lx-item__meta" style={{ marginTop: 2 }}>{x.location}</div>
                        )}
                        {note && <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, marginTop: 4 }}>{note}</p>}

                        {canRedline && (
                          <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start' }}>
                            {!rl || (!rl.loading && !rl.text && !rl.error) ? (
                              <button
                                className="lx-btn lx-btn--gold lx-btn--sm"
                                style={{ width: 'auto', alignSelf: 'flex-start' }}
                                onClick={() => suggestRedline(key, x)}
                              >
                                <Ic.Sparkle size={13} /> Suggest redline
                              </button>
                            ) : rl.loading ? (
                              <button className="lx-btn lx-btn--gold lx-btn--sm" style={{ width: 'auto', alignSelf: 'flex-start' }} disabled>
                                <Ic.Sparkle size={13} /> Drafting redline…
                              </button>
                            ) : rl.error ? (
                              <div className="lx-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                                <span style={{ fontSize: 12.5, color: 'var(--risk)' }}>{rl.error}</span>
                                <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => suggestRedline(key, x)}>Try again</button>
                              </div>
                            ) : (
                              <div style={{ marginTop: 2, border: '1px solid var(--rule)', borderRadius: 12, padding: '12px 14px', background: 'var(--surface-2, var(--surface, transparent))' }}>
                                <div className="lx-between" style={{ alignItems: 'center', marginBottom: 8 }}>
                                  <div className="lx-item__meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Ic.Sparkle size={12} /> Suggested redline</div>
                                  <div className="lx-row" style={{ gap: 8 }}>
                                    <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => copyRedline(key, rl.text)}>
                                      <Ic.Copy size={13} /> {rl.copied ? 'Copied' : 'Copy'}
                                    </button>
                                    <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => suggestRedline(key, x)}>Regenerate</button>
                                  </div>
                                </div>
                                <p style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>{rl.text}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {missing.length > 0 && (
              <>
                <hr className="lx-rule" style={{ margin: '22px 0 18px' }} />
                <div className="lx-title" style={{ fontSize: 16, marginBottom: 12 }}>Missing standard clauses</div>
                <div className="lx-list">
                  {missing.map((m, i) => {
                    const mid = m.id || `missing-${i}`;
                    const isInserted = !!insertedMissing[mid];
                    const modelText = m.model || m.clause || m.suggested_text || m.standard_text || '';
                    return (
                      <div className="lx-item" key={mid} style={{ alignItems: 'flex-start', padding: '14px 4px' }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: isInserted ? 'var(--ok)' : 'var(--warn)' }} />
                        <div className="lx-item__body">
                          <div className="lx-between" style={{ alignItems: 'baseline', gap: 10 }}>
                            <div className="lx-item__title" style={{ fontSize: 14.5 }}>{m.title}</div>
                            {isInserted && <span className="lx-badge lx-badge--ok" style={{ flexShrink: 0 }}>Inserted</span>}
                          </div>
                          {m.rationale && (
                            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, marginTop: 4 }}>{m.rationale}</p>
                          )}
                          {modelText && (
                            <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start' }}>
                              {!isInserted ? (
                                <button
                                  className="lx-btn lx-btn--gold lx-btn--sm"
                                  style={{ width: 'auto', alignSelf: 'flex-start' }}
                                  onClick={() => setInsertedMissing((prev) => ({ ...prev, [mid]: `\n\n${m.title.toUpperCase()}\n\n${modelText}` }))}
                                >
                                  <Ic.Plus size={13} /> Insert into document
                                </button>
                              ) : (
                                <div className="lx-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                                  <button
                                    className="lx-btn lx-btn--ghost lx-btn--sm"
                                    onClick={() => setInsertedMissing((prev) => { const n = { ...prev }; delete n[mid]; return n; })}
                                  >
                                    Undo insert
                                  </button>
                                  <button
                                    className="lx-btn lx-btn--ghost lx-btn--sm"
                                    onClick={() => { try { navigator.clipboard.writeText(modelText); } catch {} }}
                                  >
                                    <Ic.Copy size={12} /> Copy model
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          </div>

          <aside className="lx-stack" style={{ gap: 24 }}>
            <div className="lx-card lx-card--pad" style={{ textAlign: 'center' }}>
              <div className="lx-stat__num" style={{ fontSize: 56 }}>{risks.length}</div>
              <div className="lx-stat__label lx-mt-m">{risks.length ? `Clause${plural(risks.length)} to review` : 'Clauses flagged'}</div>
              <div className="lx-stat__sub">{missing.length ? `${missing.length} missing standard clause${plural(missing.length)}` : 'No missing standard clauses'}</div>
              <hr className="lx-rule" style={{ margin: '20px 0' }} />
              {(() => {
                // Count how many standard clauses can still be inserted (not already inserted)
                const pending = missing.filter((m, i) => {
                  const mid = m.id || `missing-${i}`;
                  return !insertedMissing[mid] && (m.model || m.clause || m.suggested_text || m.standard_text);
                });
                const insertAll = () => {
                  const next = { ...insertedMissing };
                  missing.forEach((m, i) => {
                    const mid = m.id || `missing-${i}`;
                    if (next[mid]) return;
                    const modelText = m.model || m.clause || m.suggested_text || m.standard_text || '';
                    if (!modelText) return;
                    next[mid] = `\n\n${(m.title || 'Clause').toUpperCase()}\n\n${modelText}`;
                  });
                  setInsertedMissing(next);
                };
                const insertedCount = Object.keys(insertedMissing).length;
                if (pending.length === 0 && insertedCount === 0) {
                  return (
                    <button
                      className="lx-btn lx-btn--primary"
                      style={{ width: '100%' }}
                      disabled
                      title="No missing standard clauses to accept."
                    >
                      <Ic.Check size={15} /> No suggestions to accept
                    </button>
                  );
                }
                if (pending.length === 0) {
                  return (
                    <button
                      className="lx-btn lx-btn--ghost"
                      style={{ width: '100%' }}
                      onClick={() => setInsertedMissing({})}
                      title="Undo all inserted standard clauses"
                    >
                      <Ic.Check size={15} /> All {insertedCount} accepted — undo
                    </button>
                  );
                }
                return (
                  <button
                    className="lx-btn lx-btn--primary"
                    style={{ width: '100%' }}
                    onClick={insertAll}
                    title={`Insert all ${pending.length} missing standard clauses into the document`}
                  >
                    <Ic.Check size={15} /> Accept {pending.length} suggestion{pending.length === 1 ? '' : 's'}
                  </button>
                );
              })()}
            </div>
            <div className="lx-card lx-card--pad">
              <div className="lx-section-head" style={{ marginBottom: 12 }}><h3>Summary</h3></div>
              <p className="lx-muted" style={{ lineHeight: 1.6 }}>
                {risks.length} risk flag{plural(risks.length)}, {missing.length} missing standard clause{plural(missing.length)} and {citations.length} citation{plural(citations.length)} matched{pages ? ` across ${pages} page${plural(pages)}` : ''}.
              </p>
              {warnings.length > 0 && (
                <ul style={{ margin: '12px 0 0', paddingLeft: 18, color: 'var(--ink-soft)', fontSize: 13, lineHeight: 1.6 }}>
                  {warnings.map((w, i) => <li key={i}>{typeof w === 'string' ? w : (w.message || w.text || '')}</li>)}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : (
        <div className="lx-card lx-card--pad">
          {phase === 'gone' ? (
            <div className="lx-empty" style={{ padding: '44px 20px' }}>
              <div className="lx-empty__ico"><Ic.Contracts size={22} /></div>
              <h4>This review is no longer available</h4>
              <p>The server no longer has this analysis — it may have finished some time ago or the server restarted. Please start a new review.</p>
              <button className="lx-btn lx-btn--gold" style={{ marginTop: 14 }} onClick={() => navigate('/contracts')}><Ic.Upload size={15} /> New contract review</button>
            </div>
          ) : phase === 'expired' ? (
            <div className="lx-empty" style={{ padding: '44px 20px' }}>
              <div className="lx-empty__ico"><Ic.Contracts size={22} /></div>
              <h4>Your session has expired</h4>
              <p>Please sign in again, then reopen this review.</p>
            </div>
          ) : phase === 'failed' ? (
            <div className="lx-empty" style={{ padding: '44px 20px' }}>
              <div className="lx-empty__ico"><Ic.Contracts size={22} /></div>
              <h4>The review could not be completed</h4>
              <p>{errMsg || 'Please try again.'}</p>
              <button className="lx-btn lx-btn--gold" style={{ marginTop: 14 }} onClick={() => navigate('/contracts')}><Ic.Upload size={15} /> Start over</button>
            </div>
          ) : (
            <div className="lx-empty" style={{ padding: '44px 20px' }}>
              <div className="lx-empty__ico"><Ic.Sparkle size={22} /></div>
              <h4>Reading your contract…</h4>
              <p>{stage}</p>
              <div style={{ maxWidth: 320, margin: '18px auto 0', height: 6, borderRadius: 999, background: 'var(--rule)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(5, progress)}%`, height: '100%', background: 'var(--accent-ink, var(--ink))', transition: 'width .4s ease' }} />
              </div>
              {logs.length > 0 && (
                <div style={{
                  margin: '24px auto 0', maxWidth: 560, textAlign: 'left',
                  background: '#0d1117', color: '#8bd8a6', borderRadius: 10,
                  padding: '12px 14px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12, lineHeight: 1.55, maxHeight: 180, overflowY: 'auto',
                  border: '1px solid #1f2a37',
                }}>
                  <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 }}>PROGRESS LOG</div>
                  {logs.map((l, i) => (
                    <div key={i}>
                      <span style={{ color: '#64748b', marginRight: 10 }}>{l.t}</span>
                      <span>{l.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showChat && (
        <ContractChatModal
          rawText={rawText}
          docName={contractDisplayName || docName}
          onClose={() => setShowChat(false)}
        />
      )}
      {showCrossCheck && (
        <CrossCheckModal
          primaryText={rawText}
          primaryName={contractDisplayName || docName}
          onClose={() => setShowCrossCheck(false)}
        />
      )}
    </div>
  );
}

/**
 * Document surface — renders the raw contract text with each flagged clause
 * highlighted inline (color-coded by severity) and clickable. Includes a Flag
 * Navigator (Prev / N of M / Next) at the top so you can step through risks.
 */
function DocumentSurface({ rawText, risks, activeFlagId, onFlagClick, insertedClauses = [], onAddComment }) {
  // Floating "Add comment" button that appears above a text selection in the surface.
  const [selPopup, setSelPopup] = useState(null); // { x, y, quote } | null
  const [composing, setComposing] = useState(null); // { quote } when the input is open
  const [draft, setDraft] = useState('');
  const surfaceRef = useRef(null);

  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const quote = sel && sel.toString().trim();
      if (!quote || !surfaceRef.current) { setSelPopup(null); return; }
      if (!surfaceRef.current.contains(sel.anchorNode)) { setSelPopup(null); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const sRect = surfaceRef.current.getBoundingClientRect();
      setSelPopup({ x: rect.left - sRect.left + rect.width / 2, y: rect.top - sRect.top - 10, quote });
    };
    const onClear = () => {
      if (!window.getSelection() || !window.getSelection().toString().trim()) setSelPopup(null);
    };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('selectionchange', onClear);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('selectionchange', onClear); };
  }, []);
  // Each risk's excerpt may or may not match the exact raw text. We try to locate
  // the longest contiguous match; if it doesn't appear we show the risk as a chip
  // above the document body instead of in-line.
  const segments = (() => {
    const text = rawText || '';
    if (!risks?.length) return [{ kind: 'text', text }];
    // Build a list of [start, end, riskIdx, riskId, severity, title] non-overlapping ranges.
    const ranges = [];
    risks.forEach((r, idx) => {
      const needle = (r.excerpt || r.original || r.original_text || r.text || '').trim();
      if (!needle || needle.length < 10) return;
      // Try full match first, then first ~60 chars (what the UI often shows)
      let pos = text.indexOf(needle);
      if (pos === -1 && needle.length > 60) pos = text.indexOf(needle.slice(0, 60));
      if (pos === -1) return;
      ranges.push({ start: pos, end: pos + Math.min(needle.length, text.length - pos), idx, id: r.id || idx, sev: (r.severity || '').toLowerCase(), title: r.title || r.issue || `Flag ${idx + 1}` });
    });
    ranges.sort((a, b) => a.start - b.start);
    // Resolve overlaps — keep the earliest, drop any that start before the previous ends.
    const nonOverlap = [];
    let cursor = -1;
    for (const r of ranges) {
      if (r.start < cursor) continue;
      nonOverlap.push(r);
      cursor = r.end;
    }
    // Emit segments
    const segs = [];
    let i = 0;
    for (const r of nonOverlap) {
      if (r.start > i) segs.push({ kind: 'text', text: text.slice(i, r.start) });
      segs.push({ kind: 'flag', text: text.slice(r.start, r.end), id: r.id, idx: r.idx, sev: r.sev, title: r.title });
      i = r.end;
    }
    if (i < text.length) segs.push({ kind: 'text', text: text.slice(i) });
    return segs;
  })();

  const flagList = risks.map((r, idx) => ({ id: r.id || idx, idx, title: r.title || r.issue || `Flag ${idx + 1}` }));
  const activeIdx = flagList.findIndex((f) => f.id === activeFlagId);
  const total = flagList.length;

  const goPrev = () => {
    if (total === 0) return;
    const next = activeIdx <= 0 ? total - 1 : activeIdx - 1;
    onFlagClick(flagList[next].id);
  };
  const goNext = () => {
    if (total === 0) return;
    const next = activeIdx < 0 ? 0 : (activeIdx + 1) % total;
    onFlagClick(flagList[next].id);
  };

  // When active flag changes, scroll it into view
  useEffect(() => {
    if (activeFlagId == null) return;
    const el = document.querySelector(`[data-flag-id="${activeFlagId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeFlagId]);

  const sevColor = (s) => {
    const l = (s || '').toLowerCase();
    if (l === 'critical' || l === 'high' || l === 'red') return { bg: 'rgba(239,68,68,.14)', border: 'rgba(239,68,68,.5)', dot: '#ef4444' };
    if (l === 'caution' || l === 'major' || l === 'warn' || l === 'amber') return { bg: 'rgba(245,158,11,.14)', border: 'rgba(245,158,11,.45)', dot: '#f59e0b' };
    return { bg: 'rgba(59,130,246,.1)', border: 'rgba(59,130,246,.35)', dot: '#3b82f6' };
  };

  return (
    <div className="lx-card lx-card--pad">
      <div className="lx-between" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div className="lx-title" style={{ fontSize: 16 }}>Document</div>
        {total > 0 && (
          <div className="lx-row" style={{ gap: 8, alignItems: 'center' }}>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={goPrev} title="Previous flag" style={{ padding: '4px 10px' }}>
              <Ic.Arrow size={13} style={{ transform: 'rotate(180deg)' }} /> Prev
            </button>
            <span className="lx-muted" style={{ fontSize: 12, minWidth: 90, textAlign: 'center' }}>
              {activeIdx >= 0 ? `Flag ${activeIdx + 1} of ${total}` : `${total} flag${total === 1 ? '' : 's'}`}
            </span>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={goNext} title="Next flag" style={{ padding: '4px 10px' }}>
              Next <Ic.Arrow size={13} />
            </button>
          </div>
        )}
      </div>
      <div
        ref={surfaceRef}
        style={{
          maxHeight: 520,
          overflowY: 'auto',
          padding: '18px 20px',
          background: 'var(--paper-2, var(--bg-card))',
          border: '1px solid var(--rule)',
          borderRadius: 10,
          fontFamily: 'var(--font-serif, Georgia, serif)',
          fontSize: 14.5,
          lineHeight: 1.75,
          color: 'var(--ink)',
          whiteSpace: 'pre-wrap',
          position: 'relative',
        }}
      >
        {selPopup && onAddComment && !composing && (
          <button
            onMouseDown={(e) => { e.preventDefault(); setComposing({ quote: selPopup.quote }); setSelPopup(null); setDraft(''); }}
            style={{
              position: 'absolute',
              left: Math.max(10, selPopup.x - 60),
              top: Math.max(0, selPopup.y),
              zIndex: 10,
              background: 'var(--ink)', color: 'var(--paper)',
              border: 0, borderRadius: 999, padding: '6px 12px',
              fontSize: 12, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,.15)',
            }}
          >
            + Add comment
          </button>
        )}
        {composing && onAddComment && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 5,
            background: 'var(--paper)', border: '1px solid var(--rule)',
            borderRadius: 10, padding: '12px 14px', marginBottom: 14,
          }}>
            <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>Comment on</div>
            <blockquote style={{
              margin: '0 0 10px', padding: '6px 10px',
              background: 'var(--paper-2)',
              borderLeft: '3px solid var(--accent-ink, #c99a4a)',
              borderRadius: '0 6px 6px 0',
              fontSize: 13, color: 'var(--ink-soft)', fontStyle: 'italic',
            }}>"{composing.quote.length > 180 ? composing.quote.slice(0, 180) + '…' : composing.quote}"</blockquote>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Your note…"
              autoFocus
              style={{
                width: '100%', minHeight: 60, border: '1px solid var(--rule)', borderRadius: 8,
                padding: 10, fontSize: 13.5, fontFamily: 'var(--font-sans)',
                color: 'var(--ink)', background: 'var(--bg-card)',
              }}
            />
            <div className="lx-row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => { setComposing(null); setDraft(''); }}>Cancel</button>
              <button
                className="lx-btn lx-btn--primary lx-btn--sm"
                disabled={!draft.trim()}
                onClick={() => { onAddComment(composing.quote, draft.trim()); setComposing(null); setDraft(''); }}
              >
                Save comment
              </button>
            </div>
          </div>
        )}
        {segments.map((seg, i) => {
          if (seg.kind === 'text') return <span key={i}>{seg.text}</span>;
          const c = sevColor(seg.sev);
          const isActive = seg.id === activeFlagId;
          return (
            <span
              key={i}
              data-flag-id={seg.id}
              onClick={() => onFlagClick(seg.id)}
              title={seg.title}
              style={{
                background: c.bg,
                borderBottom: `2px solid ${c.border}`,
                borderRadius: 3,
                padding: '1px 2px',
                cursor: 'pointer',
                outline: isActive ? `2px solid ${c.dot}` : 'none',
                outlineOffset: 2,
              }}
            >
              {seg.text}
            </span>
          );
        })}
        {insertedClauses.length > 0 && (
          <>
            <div style={{
              margin: '28px 0 14px', padding: '6px 10px',
              display: 'inline-block',
              background: 'rgba(16,185,129,.1)', color: 'var(--accent-ink, #0b7a60)',
              border: '1px solid rgba(16,185,129,.3)', borderRadius: 999,
              fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600,
            }}>Added clauses</div>
            {insertedClauses.map((text, i) => (
              <span
                key={i}
                style={{
                  display: 'block',
                  background: 'rgba(16,185,129,.07)',
                  borderLeft: '3px solid rgba(16,185,129,.6)',
                  padding: '10px 14px',
                  marginBottom: 10,
                  borderRadius: '0 6px 6px 0',
                }}
              >
                {text}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** Ask about this contract — chats with /api/contract/chat using the raw text as context. */
function ContractChatModal({ rawText, docName, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: `I've read "${docName}". Ask anything — I'll answer from the contract text. For questions outside the document, I'll start with "Based on general legal knowledge…" so you know when I'm not quoting the file.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setInput('');
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/contract/chat`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ raw_text: rawText, query: q }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || data.message || 'The AI did not respond.');
      const reply = data.response || data.reply || 'No response.';
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Ask about "${docName}"`} wide onClose={onClose}
      footer={
        <div className="lx-row" style={{ gap: 10, width: '100%' }}>
          <input
            className="inp"
            style={{ flex: 1 }}
            placeholder="Ask a question about this contract…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={busy}
          />
          <button className="lx-btn lx-btn--primary" onClick={send} disabled={busy || !input.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>
      }>
      {err && <div role="alert" style={{ marginBottom: 10, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}
      <div className="lx-stack" style={{ gap: 12 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            padding: '12px 14px', borderRadius: 10,
            background: msg.role === 'user' ? 'var(--accent-soft, var(--paper-2))' : 'var(--bg-card, var(--paper-2))',
            borderLeft: `3px solid ${msg.role === 'user' ? 'var(--accent-ink, #c99a4a)' : 'var(--ink-soft, #475569)'}`,
            fontSize: 14, lineHeight: 1.55, color: 'var(--ink)', whiteSpace: 'pre-wrap',
          }}>
            <div style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>
              {msg.role === 'user' ? 'You' : 'AI'}
            </div>
            {msg.content}
          </div>
        ))}
        {busy && <div style={{ fontSize: 13, color: 'var(--muted)' }}>AI is reading…</div>}
      </div>
      <p className="lx-muted" style={{ fontSize: 12, marginTop: 14 }}>
        Answers from the contract text are grounded. Anything beyond the document is prefixed with "Based on general legal knowledge…" so you can distinguish them.
      </p>
    </Modal>
  );
}

/** Compare this contract with a second document — surfaces contradicting clauses. */
function CrossCheckModal({ primaryText, primaryName, onClose }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [conflicts, setConflicts] = useState(null);
  const [refName, setRefName] = useState('');
  const fileRef = useRef(null);

  const run = async () => {
    if (!file) { setErr('Pick a second document to compare against.'); return; }
    setBusy(true); setErr(''); setConflicts(null);
    try {
      // 1. Extract text from the reference document
      const fd = new FormData();
      fd.append('file', file);
      const exRes = await fetch(`${API_BASE}/api/contract/extract-text`, {
        method: 'POST', credentials: 'include',
        headers: { 'X-CSRF-TOKEN': csrf() },
        body: fd,
      });
      if (!exRes.ok) {
        const d = await exRes.json().catch(() => ({}));
        throw new Error(d.message || `Could not read ${file.name}.`);
      }
      const exData = await exRes.json();
      const refText = (exData.raw_text || exData.text || '').trim();
      if (!refText) throw new Error('No readable text in the second document.');
      setRefName(file.name);

      // 2. Compare
      const r = await fetch(`${API_BASE}/api/contract/cross-check`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ primary_text: primaryText, secondary_text: refText, ref_doc_name: file.name }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || data.message || 'Comparison failed.');
      setConflicts(Array.isArray(data.conflicts) ? data.conflicts : []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Compare "${primaryName}" with another document`} wide onClose={onClose}
      footer={<>
        <button className="lx-btn lx-btn--ghost" onClick={onClose} disabled={busy}>Close</button>
        {!conflicts && (
          <button className="lx-btn lx-btn--primary" onClick={run} disabled={busy || !file}>
            {busy ? 'Comparing…' : 'Find conflicts'}
          </button>
        )}
        {conflicts && (
          <button className="lx-btn lx-btn--primary" onClick={() => { setFile(null); setConflicts(null); setRefName(''); }}>
            Compare another
          </button>
        )}
      </>}>
      {err && <div role="alert" style={{ marginBottom: 12, color: 'var(--risk)', fontSize: 13 }}>{err}</div>}

      {!conflicts && (
        <>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files?.[0]) { setFile(e.target.files[0]); setErr(''); } }} />
          <div
            onClick={() => !busy && fileRef.current && fileRef.current.click()}
            style={{ border: '1.5px dashed var(--rule)', borderRadius: 14, padding: '28px 20px', textAlign: 'center', background: 'var(--paper-2)', cursor: busy ? 'default' : 'pointer' }}
          >
            <div className="lx-empty__ico" style={{ margin: '0 auto 10px' }}><Ic.Doc size={22} /></div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 16, color: 'var(--ink)' }}>
              {file ? file.name : 'Pick the reference document'}
            </div>
            <div className="lx-muted" style={{ marginTop: 6, fontSize: 13 }}>
              {file ? 'Click to choose a different file' : 'PDF or Word. The AI will flag contradicting clauses.'}
            </div>
          </div>
          <p className="lx-muted" style={{ fontSize: 12, marginTop: 12 }}>
            Common uses: original agreement vs. amendment; master services agreement vs. SOW; two drafts of the same contract.
          </p>
        </>
      )}

      {conflicts && (
        <div>
          <div className="lx-between" style={{ marginBottom: 14 }}>
            <div className="lx-muted" style={{ fontSize: 13 }}>
              Compared against: <b style={{ color: 'var(--ink)' }}>{refName}</b>
            </div>
            <span className={`lx-badge lx-badge--${conflicts.length > 0 ? 'risk' : 'ok'}`}>
              {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}
            </span>
          </div>
          {conflicts.length === 0 ? (
            <div className="lx-empty" style={{ padding: '24px 10px' }}>
              <div className="lx-empty__ico"><Ic.Check size={22} /></div>
              <h4>No contradicting clauses found</h4>
              <p>The AI did not detect any conflicting terms between the two documents.</p>
            </div>
          ) : (
            <div className="lx-stack" style={{ gap: 14 }}>
              {conflicts.map((cf, i) => {
                const title = cf.topic || cf.title || `Conflict ${i + 1}`;
                const sev = (cf.severity || '').toLowerCase();
                const sevTone = sev === 'critical' || sev === 'high' ? 'risk' : sev === 'minor' || sev === 'low' ? 'ok' : 'warn';
                // The backend's current prompt returns `summary` for the detail text; older/richer prompts
                // may return `primary` + `reference` + `explanation` — render whichever shape came back.
                const hasRich = !!(cf.primary || cf.reference || cf.explanation);
                return (
                  <div key={i} className="lx-card lx-card--pad" style={{ borderLeft: '3px solid var(--risk, #ef4444)' }}>
                    <div className="lx-between" style={{ marginBottom: 10, alignItems: 'flex-start', gap: 10 }}>
                      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 15, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>
                        {title}
                      </div>
                      {cf.severity && (
                        <span className={`lx-badge lx-badge--${sevTone}`} style={{ textTransform: 'capitalize', flexShrink: 0 }}>
                          {cf.severity}
                        </span>
                      )}
                    </div>
                    {cf.summary && (
                      <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
                        {cf.summary}
                      </div>
                    )}
                    {hasRich && (
                      <div className="lx-stack" style={{ gap: 10, marginTop: cf.summary ? 10 : 0 }}>
                        {cf.primary && (
                          <div>
                            <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
                              In this contract
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{cf.primary}</div>
                          </div>
                        )}
                        {cf.reference && (
                          <div>
                            <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4 }}>
                              In {refName}
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>{cf.reference}</div>
                          </div>
                        )}
                        {cf.explanation && (
                          <div style={{ padding: '10px 12px', background: 'var(--paper-2)', borderRadius: 8, fontSize: 13, color: 'var(--ink)' }}>
                            {cf.explanation}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
