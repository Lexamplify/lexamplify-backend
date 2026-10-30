import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import * as Ic from '../icons.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// Matter types, ordered from the exposures that most often carry a
// positional conflict down to the quieter advisory work.
const MATTER_TYPES = ['Civil', 'Commercial', 'Corporate', 'Criminal', 'Matrimonial', 'Arbitration', 'IP', 'Writ'];

// Translate whatever the backend calls a match's severity into one of the
// three luxury badge tones. Anything that reads as a firm, live conflict is
// red; a softer "potential / review" match is amber; an explicit all-clear
// is green. Unknown labels fall back to amber so nothing dangerous is ever
// shown as safe by omission.
function toneForStatus(status) {
  const s = String(status || '').toLowerCase();
  if (/(high|direct|hard|actual|disqualif)/.test(s)) return 'risk';
  if (/(clear|none|no conflict|safe)/.test(s)) return 'ok';
  return 'warn';
}

// A debounced autocomplete field that suggests parties and matters already
// on record, so a name is checked in the exact form the practice stored it.
function PartyField({ label, value, onChange, placeholder, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setItems([]); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/cases/autocomplete?q=${encodeURIComponent(q)}`, { credentials: 'include' });
        const data = res.ok ? await res.json() : [];
        setItems(Array.isArray(data) ? data.slice(0, 6) : []);
      } catch {
        setItems([]);
      } finally {
        setBusy(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [value]);

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const showMenu = open && value.trim().length >= 2;

  return (
    <div style={{ position: 'relative' }} ref={boxRef}>
      <label className="lbl">{label}</label>
      <input
        className="inp"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {showMenu && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 20,
          background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 10,
          boxShadow: 'var(--lx-shadow-2)', overflow: 'hidden', maxHeight: 240, overflowY: 'auto',
        }}>
          {busy ? (
            <div style={{ padding: '11px 14px', fontSize: 12.5, color: 'var(--muted)' }}>Searching records…</div>
          ) : items.length ? (
            items.map((it) => (
              <button
                key={it.id ?? it.title}
                type="button"
                onMouseDown={() => { onChange(it.title || it.name || ''); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 0,
                  borderBottom: '1px solid var(--rule)', background: 'transparent', cursor: 'pointer',
                  padding: '10px 14px', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'var(--font-sans)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 6%, transparent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {it.title || it.name}
              </button>
            ))
          ) : (
            <div style={{ padding: '11px 14px', fontSize: 12.5, color: 'var(--muted)' }}>No matching record on file.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConflictEngine() {
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [mode, setMode] = useState('clearance'); // 'clearance' | 'analyzer'

  const [client, setClient] = useState('');
  const [opponent, setOpponent] = useState('');
  const [matterType, setMatterType] = useState('Civil');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [checkedName, setCheckedName] = useState('');

  // ── Document analyzer state ─────────────────────────────────────────────
  const [docs, setDocs] = useState([]);        // [{file, label}]
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeErr, setAnalyzeErr] = useState('');
  const [analysis, setAnalysis] = useState(null);  // { conflicts, summary, documents }
  const [exporting, setExporting] = useState(false);
  const [memoBusy, setMemoBusy] = useState(false);
  const [memoMsg, setMemoMsg] = useState('');
  const fileInputRef = useRef(null);

  function addFiles(fileList) {
    const picked = [...(fileList || [])].slice(0, 10 - docs.length);
    setDocs((xs) => [...xs, ...picked.map((f) => ({ file: f, label: f.name }))]);
  }
  function removeDoc(i) { setDocs((xs) => xs.filter((_, idx) => idx !== i)); }

  async function runAnalysis() {
    if (docs.length < 2 || analyzing) return;
    setAnalyzing(true); setAnalyzeErr(''); setAnalysis(null); setMemoMsg('');
    try {
      const fd = new FormData();
      docs.forEach((d, i) => {
        fd.append(`doc${i + 1}`, d.file);
        fd.append(`label${i + 1}`, d.label || d.file.name);
      });
      const r = await fetch(`${API_BASE}/api/conflict/analyze`, {
        method: 'POST', credentials: 'include', headers: { 'X-CSRF-TOKEN': csrf() }, body: fd,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || d.message || 'Analyzer failed. Please try again.');
      setAnalysis(d);
    } catch (e) { setAnalyzeErr(e.message); }
    finally { setAnalyzing(false); }
  }

  async function exportDocx() {
    if (!analysis?.conflicts?.length || exporting) return;
    setExporting(true);
    try {
      const r = await fetch(`${API_BASE}/api/conflict/export-docx`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({
          conflicts: analysis.conflicts,
          summary: analysis.summary,
          documents: (analysis.documents || []).map((d) => d.name || d).filter(Boolean),
          matter: client.trim() || 'Commercial Agreement Audit',
          title: 'Schedule of Discrepancies',
        }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || (typeof d.error === 'string' ? d.error : 'Export failed.')); }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Schedule_of_Discrepancies.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (e) { alert(e.message); }
    finally { setExporting(false); }
  }

  async function saveMemo() {
    if (memoBusy) return;
    setMemoBusy(true); setMemoMsg('');
    try {
      const conflictCount = analysis?.conflicts?.length ?? matches.length;
      // Fall back to a sensible label if the lawyer didn't type one — common on
      // the analyzer tab where the client/party fields live on the other tab.
      const target = client.trim() || (
        analysis ? `Document audit (${(analysis.documents || []).map((d) => d.name || d).join(', ').slice(0, 100) || 'uploaded files'})` : 'Clearance audit'
      );
      const bodyLines = [
        `CLEARANCE MEMO — ${new Date().toLocaleString('en-IN')}`,
        ``,
        `Target entity: ${target}`,
        opponent.trim() && `Opposing party: ${opponent.trim()}`,
        `Matter type: ${matterType}`,
        ``,
        analysis
          ? `Document analysis: ${conflictCount} contradiction(s) across ${analysis?.documents?.length || 0} documents.\n${analysis.summary || ''}`
          : result
            ? `Clearance check: ${outcome === 'conflicts' ? `${matches.length} possible conflict(s) found` : outcome === 'no-records' ? 'No records in practice to screen against' : 'No conflicts found'}`
            : `No automated scan recorded.`,
      ].filter(Boolean).join('\n');
      const r = await fetch(`${API_BASE}/api/conflict/clearance-memo`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({
          ref_id: `MEMO-${Date.now()}`,
          target_entity: target,
          opposing_party: opponent.trim(),
          matter_type: matterType,
          timestamp: new Date().toISOString(),
          memo_text: bodyLines,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || (typeof d.error === 'string' ? d.error : 'Could not save memo.'));
      setMemoMsg(`Clearance memo saved (ref ${d.ref_id || d.id || '—'}).`);
    } catch (e) { setMemoMsg(e.message); }
    finally { setMemoBusy(false); }
  }

  const matches = useMemo(() => (result && Array.isArray(result.results) ? result.results : []), [result]);

  // Normalize the three terminal states the backend can report, whatever
  // field it carries them in, so the result view below never has to guess.
  const outcome = useMemo(() => {
    if (!result) return null;
    const status = String(result.status || '').toLowerCase();
    if (matches.length > 0) return 'conflicts';
    if (status.includes('no record') || result.status === 'No Records') return 'no-records';
    return 'clear';
  }, [result, matches]);

  const searched = result?.searched || {};
  const searchedLine = useMemo(() => {
    const parts = [];
    if (searched.clients != null) parts.push(`${searched.clients} client${searched.clients === 1 ? '' : 's'}`);
    if (searched.cases != null) parts.push(`${searched.cases} matter${searched.cases === 1 ? '' : 's'}`);
    if (searched.parties != null) parts.push(`${searched.parties} part${searched.parties === 1 ? 'y' : 'ies'}`);
    return parts.join(' · ');
  }, [searched]);

  const canRun = client.trim().length > 0 && !loading;

  const run = useCallback(async () => {
    if (!client.trim() || loading) return;
    setLoading(true);
    setError('');
    setResult(null);
    const name = client.trim();
    try {
      const res = await fetch(`${API_BASE}/api/conflict/check`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({
          entity_name: name,
          opposing_party: opponent.trim(),
          matter_type: matterType,
        }),
      });
      if (!res.ok) {
        throw new Error(res.status === 401
          ? 'Your session has expired. Please sign in again.'
          : 'We could not complete the conflict check. Please try again.');
      }
      const data = await res.json();
      if (!mounted.current) return;
      setCheckedName(name);
      setResult(data || {});
    } catch (e) {
      if (!mounted.current) return;
      setError(e.message || 'We could not complete the conflict check. Please try again.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [client, opponent, matterType, loading]);

  const onSubmit = (e) => { e.preventDefault(); run(); };

  const reset = () => {
    setClient(''); setOpponent(''); setMatterType('Civil');
    setResult(null); setError(''); setCheckedName('');
  };

  return (
    <div className="lx-page lx-rise">
      <div className="ph">
        <span className="ph__eyebrow">Risk &amp; Compliance</span>
        <h1 className="ph__title">Conflict Engine</h1>
        <p className="ph__sub">
          Before you take on a matter, clear the parties against every client, adversary and
          case already on your record — in one pass.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={mode === 'clearance' ? 'is-on' : ''} onClick={() => setMode('clearance')}>Name clearance</button>
        <button className={mode === 'analyzer' ? 'is-on' : ''} onClick={() => setMode('analyzer')}>Document analyzer</button>
        <button className={mode === 'memos' ? 'is-on' : ''} onClick={() => setMode('memos')}>Past memos</button>
      </div>

      {mode === 'memos' && <PastMemos />}

      {mode === 'clearance' && (
      /* Intake */
      <form className="lx-card lx-card--pad" onSubmit={onSubmit}>
        <div className="lx-section-head" style={{ marginBottom: 20 }}>
          <h3><Ic.Shield size={17} style={{ verticalAlign: '-3px', marginRight: 8, color: 'var(--accent-ink)' }} />Clearance check</h3>
          {result && !loading && (
            <a onClick={reset} style={{ cursor: 'pointer' }}>Start over</a>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }} className="lx-ce-grid">
          <PartyField
            label="Proposed client / party"
            value={client}
            onChange={setClient}
            placeholder="e.g. Mehta Industries Pvt. Ltd."
            autoFocus
          />
          <PartyField
            label="Opposing party"
            value={opponent}
            onChange={setOpponent}
            placeholder="Known adversary or counter-party (optional)"
          />
        </div>

        <div style={{ marginTop: 20 }}>
          <label className="lbl">Matter type</label>
          <div className="chip-row">
            {MATTER_TYPES.map((t) => (
              <span
                key={t}
                className={`chip${matterType === t ? ' is-on' : ''}`}
                onClick={() => setMatterType(t)}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="lx-between" style={{ marginTop: 24, gap: 14, flexWrap: 'wrap' }}>
          <p className="lx-muted" style={{ maxWidth: 440, margin: 0 }}>
            Only names recorded in your practice are searched. A clear result is a check, not a legal clearance.
          </p>
          <button type="submit" className="lx-btn lx-btn--gold" disabled={!canRun}>
            <Ic.Search size={15} /> {loading ? 'Scanning records…' : 'Run conflict check'}
          </button>
        </div>
      </form>
      )}

      {/* Document analyzer */}
      {mode === 'analyzer' && (
        <section className="lx-card lx-card--pad">
          <div className="lx-section-head" style={{ marginBottom: 20 }}>
            <h3><Ic.Shield size={17} style={{ verticalAlign: '-3px', marginRight: 8, color: 'var(--accent-ink)' }} />Cross-document contradiction analyzer</h3>
            {docs.length > 0 && !analyzing && <a onClick={() => { setDocs([]); setAnalysis(null); setAnalyzeErr(''); }} style={{ cursor: 'pointer' }}>Clear</a>}
          </div>

          <p className="lx-muted" style={{ marginTop: -8, marginBottom: 18 }}>
            Upload 2+ related documents (contracts, SOWs, NDAs, pleadings) and the engine will do a pairwise clause comparison —
            flagging forum / arbitration / confidentiality / liability / notice / payment contradictions, with the quoted text from each side.
          </p>

          <div
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            style={{ border: '2px dashed var(--rule)', borderRadius: 14, padding: 32, textAlign: 'center', cursor: 'pointer', background: 'var(--paper-2)' }}
          >
            <Ic.Upload size={22} style={{ color: 'var(--accent-ink)', marginBottom: 8 }} />
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 15, color: 'var(--ink)' }}>Drop files here, or click to add</div>
            <div className="lx-muted" style={{ fontSize: 12.5, marginTop: 4 }}>PDF, DOCX, TXT — up to 10 at a time</div>
            <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc,.txt,.rtf"
              style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {docs.length > 0 && (
            <div className="lx-list" style={{ marginTop: 14 }}>
              {docs.map((d, i) => (
                <div className="lx-item" key={i} style={{ padding: '12px 4px' }}>
                  <div className="lx-item__ico"><Ic.Doc size={16} /></div>
                  <div className="lx-item__body">
                    <input className="inp" value={d.label} onChange={(e) => setDocs((xs) => xs.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                      style={{ fontSize: 14, fontFamily: 'var(--font-serif)', color: 'var(--ink)', background: 'transparent', border: 0, outline: 0, padding: 0 }} />
                    <div className="lx-item__meta">{(d.file.size / 1024).toFixed(0)} KB · {d.file.type || 'file'}</div>
                  </div>
                  <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => removeDoc(i)}>Remove</button>
                </div>
              ))}
            </div>
          )}

          <div className="lx-between" style={{ marginTop: 20, flexWrap: 'wrap', gap: 12 }}>
            <p className="lx-muted" style={{ margin: 0, maxWidth: 480 }}>
              At least 2 documents are required. Comparison is pair-by-pair across every uploaded file.
            </p>
            <button className="lx-btn lx-btn--gold" onClick={runAnalysis} disabled={docs.length < 2 || analyzing}>
              <Ic.Sparkle size={15} /> {analyzing ? 'Analysing documents…' : `Analyse ${docs.length || ''} documents`}
            </button>
          </div>
        </section>
      )}

      {/* Analyzer results */}
      {mode === 'analyzer' && (analyzeErr || analysis) && (
        <section style={{ marginTop: 24 }}>
          {analyzeErr && (
            <div className="lx-card lx-card--pad">
              <div className="lx-empty"><div className="lx-empty__ico"><Ic.Shield size={22} /></div><h4>Analysis failed</h4><p>{analyzeErr}</p></div>
            </div>
          )}
          {analysis && (
            <>
              <div className="lx-section-head">
                <h3>{(analysis.conflicts || []).length} contradiction{(analysis.conflicts || []).length === 1 ? '' : 's'} across {(analysis.documents || []).length} documents</h3>
                <div className="lx-row" style={{ gap: 10 }}>
                  <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={saveMemo} disabled={memoBusy}>
                    <Ic.Check size={14} /> {memoBusy ? 'Saving…' : 'Save clearance memo'}
                  </button>
                  <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={exportDocx} disabled={exporting || !(analysis.conflicts || []).length}>
                    <Ic.Upload size={14} style={{ transform: 'rotate(180deg)' }} /> {exporting ? 'Exporting…' : 'Export .docx'}
                  </button>
                </div>
              </div>
              {analysis.summary && <p className="lx-muted" style={{ marginBottom: 18, maxWidth: 720 }}>{analysis.summary}</p>}
              {memoMsg && <div style={{ marginBottom: 14, fontSize: 13, color: memoMsg.startsWith('Clearance memo saved') ? 'var(--ok, #2d7a3e)' : 'var(--risk, #c0392b)' }}>{memoMsg}</div>}

              {(analysis.conflicts || []).length === 0 ? (
                <div className="lx-card lx-card--pad">
                  <div className="lx-empty">
                    <div className="lx-empty__ico" style={{ background: 'color-mix(in srgb, var(--accent-success) 14%, transparent)', color: 'var(--accent-success)' }}><Ic.Check size={24} /></div>
                    <h4>No contradictions found</h4>
                    <p>All uploaded documents are internally consistent on the clauses our engine checks.</p>
                  </div>
                </div>
              ) : (
                <div className="lx-stack" style={{ gap: 14 }}>
                  {(analysis.conflicts || []).map((c, i) => {
                    const tone = c.severity === 'critical' ? 'risk' : 'warn';
                    return (
                      <div className="lx-card lx-card--pad" key={c.id || i}>
                        <div className="lx-between" style={{ marginBottom: 10 }}>
                          <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, color: 'var(--ink)' }}>{c.title}</div>
                          <span className={`lx-badge lx-badge--${tone}`}>{c.severity === 'critical' ? 'Critical' : 'Major'}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                          {['docA', 'docB'].map((k) => {
                            const d = c[k] || {};
                            return (
                              <div key={k} style={{ padding: '12px 14px', border: '1px solid var(--rule)', borderRadius: 10, background: 'var(--paper-2)' }}>
                                <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 4 }}>{d.file || d.name || k.toUpperCase()}</div>
                                <div className="lx-muted" style={{ fontSize: 11.5, marginBottom: 6 }}>{[d.section, d.page].filter(Boolean).join(' · ') || '—'}</div>
                                <blockquote style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6, borderLeft: '2px solid var(--rule)', paddingLeft: 10 }}>
                                  “{d.quote || '—'}”
                                </blockquote>
                              </div>
                            );
                          })}
                        </div>
                        {c.legalExplanation && (
                          <div style={{ marginTop: 14 }}>
                            <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 6 }}>Why it matters</div>
                            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.65 }}>{c.legalExplanation}</p>
                          </div>
                        )}
                        {c.harmonization && (
                          <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: 10 }}>
                            <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, marginBottom: 4, color: 'var(--accent-ink)' }}>Suggested harmonisation</div>
                            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.65 }}>{c.harmonization}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Clearance Results */}
      {mode === 'clearance' && (
      <div style={{ marginTop: 28 }}>
        {loading ? (
          <div className="lx-card lx-card--pad">
            <div className="lx-empty"><p>Scanning your practice records for a match…</p></div>
          </div>
        ) : error ? (
          <div className="lx-card lx-card--pad">
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Shield size={22} /></div>
              <h4>Check didn’t run</h4>
              <p>{error}</p>
              <button className="lx-btn lx-btn--sm" onClick={run}>Try again</button>
            </div>
          </div>
        ) : !result ? (
          <div className="lx-card lx-card--pad">
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Scale size={22} /></div>
              <h4>No check run yet</h4>
              <p>Enter a proposed client above and run a check to screen it against your records.</p>
            </div>
          </div>
        ) : outcome === 'conflicts' ? (
          <section>
            <div className="lx-section-head">
              <h3>
                {matches.length} possible conflict{matches.length === 1 ? '' : 's'} for “{checkedName}”
              </h3>
              {searchedLine && <span className="lx-muted">Searched {searchedLine}</span>}
            </div>
            {result.summary && (
              <p className="lx-muted" style={{ marginBottom: 16, maxWidth: 680 }}>{result.summary}</p>
            )}
            <div className="lx-card lx-card--pad">
              <div className="lx-list">
                {matches.map((m, i) => {
                  const tone = toneForStatus(m.conflict_status);
                  const sides = [m.client, m.opponent].filter(Boolean).join('  v.  ');
                  return (
                    <div className="lx-item" key={m.id ?? `${m.case_title}-${i}`} style={{ padding: '16px 4px' }}>
                      <div className="lx-item__ico"><Ic.Scale size={18} /></div>
                      <div className="lx-item__body" style={{ flex: 2 }}>
                        <div className="lx-item__title">{m.case_title || 'Matter on record'}</div>
                        <div className="lx-item__meta">{sides || '—'}</div>
                      </div>
                      {m.match_type && (
                        <div style={{ minWidth: 0 }} className="hide-sm">
                          <div className="lx-item__meta" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10 }}>Matched on</div>
                          <div style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>{m.match_type}</div>
                        </div>
                      )}
                      <span className={`lx-badge lx-badge--${tone}`} style={{ minWidth: 120, justifyContent: 'center' }}>
                        <span className="dot" />{m.conflict_status || 'Review'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="lx-muted" style={{ marginTop: 14 }}>
              Each match is a name overlap for you to weigh — not an automatic bar. The decision to accept the matter remains yours.
            </p>
          </section>
        ) : outcome === 'no-records' ? (
          <div className="lx-card lx-card--pad">
            <div className="lx-empty">
              <div className="lx-empty__ico"><Ic.Matters size={22} /></div>
              <h4>Nothing to check against yet</h4>
              <p>Your practice has no clients or matters on record, so there was nothing to search. Add them first, then run the check again.</p>
            </div>
          </div>
        ) : (
          <section>
            <div className="lx-card lx-card--pad">
              <div className="lx-empty">
                <div className="lx-empty__ico" style={{ background: 'color-mix(in srgb, var(--accent-success) 14%, transparent)', color: 'var(--accent-success)' }}>
                  <Ic.Check size={24} />
                </div>
                <h4>No conflicts found</h4>
                <p>
                  No record matching “{checkedName}”{opponent.trim() ? ` or “${opponent.trim()}”` : ''} was found
                  {searchedLine ? ` across ${searchedLine}` : ' in your practice records'}.
                </p>
              </div>
              <div style={{
                marginTop: 4, padding: '14px 16px', borderRadius: 12,
                background: 'var(--paper-2)', border: '1px solid var(--rule)',
                display: 'flex', gap: 12, alignItems: 'flex-start',
              }}>
                <span style={{ color: 'var(--accent-ink)', flexShrink: 0, marginTop: 1 }}><Ic.Shield size={16} /></span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>This is a check, not a clearance</div>
                  <div className="lx-muted" style={{ marginTop: 3 }}>
                    Only names recorded in your practice were searched. The advocate remains responsible for deciding whether to accept the matter.
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
        {/* Save-memo button for clearance mode too (shown once a check has been run) */}
        {result && outcome !== 'no-records' && (
          <div className="lx-row" style={{ gap: 10, marginTop: 16, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {memoMsg && <span className="lx-muted" style={{ fontSize: 12.5, color: memoMsg.startsWith('Clearance memo saved') ? 'var(--ok, #2d7a3e)' : 'var(--risk, #c0392b)' }}>{memoMsg}</span>}
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={saveMemo} disabled={memoBusy}>
              <Ic.Check size={14} /> {memoBusy ? 'Saving…' : 'Save clearance memo'}
            </button>
          </div>
        )}
      </div>
      )}

      <style>{`
        @media (max-width: 560px) { .lx-ce-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

// ── PAST CLEARANCE MEMOS ─────────────────────────────────────────────────────
// Audit record of every clearance memo saved — Bar Council Rule 1.7 defence trail.
function PastMemos() {
  const [memos, setMemos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`${API_BASE}/api/conflict/clearance-memos`, { credentials: 'include' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || (typeof d.error === 'string' ? d.error : 'Could not load memos.'));
      setMemos(Array.isArray(d.memos) ? d.memos : []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function fmt(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
  }

  return (
    <section className="lx-card lx-card--pad">
      <div className="lx-section-head" style={{ marginBottom: 14 }}>
        <h3><Ic.Shield size={17} style={{ verticalAlign: '-3px', marginRight: 8, color: 'var(--accent-ink)' }} />Past clearance memos</h3>
        <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={load} disabled={loading}>Refresh</button>
      </div>
      <p className="lx-muted" style={{ marginTop: -8, marginBottom: 18 }}>
        Every memo saved from a conflict check or document audit, newest first. These are your compliance trail
        under Bar Council Rule 1.7 — produce the ref ID if a client ever disputes whether a check was run.
      </p>

      {loading ? (
        <div className="lx-empty"><p>Loading past memos…</p></div>
      ) : err ? (
        <div className="lx-empty"><div className="lx-empty__ico"><Ic.Shield size={22} /></div><h4>Couldn't load memos</h4><p>{err}</p><button className="lx-btn lx-btn--sm" onClick={load}>Try again</button></div>
      ) : memos.length === 0 ? (
        <div className="lx-empty"><div className="lx-empty__ico"><Ic.Scale size={22} /></div><h4>No memos saved yet</h4><p>Save a clearance memo from a Name clearance or Document analyzer result and it will appear here.</p></div>
      ) : (
        <div className="lx-list">
          {memos.map((m) => (
            <div className="lx-item" key={m.id} onClick={() => setOpen(open?.id === m.id ? null : m)} style={{ padding: '14px 4px', cursor: 'pointer', flexWrap: 'wrap' }}>
              <div className="lx-item__ico"><Ic.Shield size={17} /></div>
              <div className="lx-item__body" style={{ flex: 2 }}>
                <div className="lx-item__title">{m.target_entity || '—'}</div>
                <div className="lx-item__meta">
                  {m.ref_id} · {m.matter_type || 'Matter'} · {fmt(m.generated_at)}
                  {m.opposing_party ? ` · v. ${m.opposing_party}` : ''}
                </div>
              </div>
              <span className="lx-badge lx-badge--muted">#{m.id}</span>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} className="lx-card lx-card--pad" style={{ width: 'min(640px, 92vw)', maxHeight: '85vh', overflow: 'auto' }}>
            <div className="lx-between" style={{ marginBottom: 12 }}>
              <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--ink)' }}>Memo {open.ref_id}</h3>
              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            <div className="lx-muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
              Saved {fmt(open.generated_at)} · DB id {open.id}
            </div>
            <pre style={{ background: 'var(--bg-card)', border: '1px solid var(--rule)', borderRadius: 10, padding: 16, fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink)', whiteSpace: 'pre-wrap', margin: 0 }}>
              {open.memo_text || '— no body saved —'}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
