import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractContractText } from '../../services/api';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/* The ask-first drafting flow. Nothing is generated until the advocate has said
   which matter (or file) the document is for and confirmed the facts. Anything
   left unanswered reaches the draft as a visible [Bracketed Field], never as an
   invented name, date or amount. */

export const DOC_TYPES = [
  { key: 'notice', label: 'Legal notice', hint: 'Demand, recovery, breach or termination', request: 'Draft a legal notice' },
  { key: 'bail', label: 'Bail application', hint: 'Regular, anticipatory or interim', request: 'Draft a bail application' },
  { key: 'affidavit', label: 'Affidavit', hint: 'With verification and deponent details', request: 'Draft an affidavit' },
  { key: 'nda', label: 'Non-disclosure agreement', hint: 'Mutual or one-way', request: 'Draft a non-disclosure agreement' },
  { key: 'lease', label: 'Rent or lease agreement', hint: 'Residential or commercial', request: 'Draft a rent agreement' },
  { key: 'employment', label: 'Employment agreement', hint: 'Offer, role, notice and restrictions', request: 'Draft an employment agreement' },
  { key: 'contract', label: 'Service agreement', hint: 'Commercial services between two parties', request: 'Draft a service agreement' },
];

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CONTEXT_CHARS = 40000;

const clip = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) : String(s || ''));

async function readError(res, fallback) {
  try {
    const j = await res.json();
    const m = j.message || (typeof j.error === 'string' ? j.error : '');
    return typeof m === 'string' && m.trim() ? m : fallback;
  } catch { return fallback; }
}

/** What the matter file says, as plain facts the drafting model may use (and nothing else). */
export function caseFacts(c) {
  if (!c) return '';
  const lines = [];
  const add = (k, v) => { if (v && String(v).trim()) lines.push(`${k}: ${String(v).trim()}`); };
  add('Case title', c.title); add('Case number', c.case_no); add('Court', c.court); add('Case type', c.case_type);
  add('Client', c.client_name); add('Opposite party', c.opposite_party); add('Judge', c.judge);
  add('Filing date', c.filing_date); add('Registration number', c.reg_no); add('Next hearing', c.next_hearing);
  add('Remarks', c.remarks);
  (Array.isArray(c.parties) ? c.parties : []).forEach((p) => add(`Party (${String(p.role || '').replace(/_/g, ' ')})`, p.name));
  return lines.join('\n');
}

/** Known question ids that the matter file can answer. Returns {id: value}. */
export function prefillFromCase(c, questions) {
  if (!c) return {};
  const out = {};
  const client = (c.client_name || '').trim();
  const other = (c.opposite_party || '').trim();
  (questions || []).forEach((q) => {
    if (q.id === 'sender' && client && other) out.sender = `${client} to ${other}`;
    if (q.id === 'parties' && client && other) out.parties = `${client} and ${other}`;
    if (q.id === 'accused' && client) out.accused = client;
    if (q.id === 'deponent' && client) out.deponent = client;
    if (q.id === 'client' && client) out.client = client;
  });
  return out;
}

export default function GuidedDraftModal({ open, initialRequest = '', initialType = '', loadedDoc = null, onClose, onGenerate, onOpenPractice }) {
  const [step, setStep] = useState('type');            // type | source | questions | review
  const [docType, setDocType] = useState(null);         // {key,label,request}
  const [customRequest, setCustomRequest] = useState('');
  const [mode, setMode] = useState('');                 // case | file | manual
  const [caseQuery, setCaseQuery] = useState('');
  const [cases, setCases] = useState(null);             // null = not loaded
  const [casesError, setCasesError] = useState('');
  const [chosenCase, setChosenCase] = useState(null);
  const [file, setFile] = useState(null);               // {name, text, chars, truncated}
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState('');
  const [intake, setIntake] = useState(null);           // {doc_label, summary, questions}
  const [answers, setAnswers] = useState({});
  const [fromCase, setFromCase] = useState({});         // ids prefilled from the matter file
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const dialogRef = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reset = useCallback(() => {
    setStep('type'); setDocType(null); setCustomRequest(''); setMode(''); setCaseQuery(''); setCases(null); setCasesError('');
    setChosenCase(null); setFile(null); setFileError(''); setIntake(null); setAnswers({}); setFromCase({}); setError(''); setBusy(false);
  }, []);

  // Open fresh each time; a request typed on the Auto-Draft screen skips the first step.
  useEffect(() => {
    if (!open) return;
    reset();
    const hit = DOC_TYPES.find((t) => t.key === initialType);
    if (hit) { setDocType(hit); setStep('source'); }
    else if (initialRequest.trim()) { setDocType({ key: 'custom', label: 'Document', request: initialRequest.trim() }); setCustomRequest(initialRequest.trim()); setStep('source'); }
  }, [open, initialRequest, initialType, reset]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const f = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, select, [href]')].filter((el) => el.offsetParent);
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Load the advocate's cases when the case option is chosen (debounced search).
  useEffect(() => {
    if (!open || mode !== 'case') return undefined;
    let live = true;
    const t = setTimeout(async () => {
      setCasesError('');
      try {
        const res = await fetch(`${API_BASE}/api/practice/cases?per_page=30&sort=updated&q=${encodeURIComponent(caseQuery.trim())}`);
        if (!res.ok) throw new Error(await readError(res, 'We could not load your cases.'));
        const data = await res.json();
        if (live) setCases(Array.isArray(data.cases) ? data.cases : []);
      } catch (e) { if (live) { setCases([]); setCasesError(e.message || 'We could not load your cases.'); } }
    }, caseQuery ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [open, mode, caseQuery]);

  const requestText = docType ? (docType.key === 'custom' ? (customRequest || docType.request) : docType.request) : '';

  const pickCase = async (c) => {
    setError(''); setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/practice/cases/${c.id}`);
      if (!res.ok) throw new Error(await readError(res, 'We could not open that case.'));
      const data = await res.json();
      setChosenCase(data.case || c);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const onFile = async (files) => {
    const f = files && files[0];
    if (!f) return;
    setFileError(''); setFile(null);
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) { setFileError('Please upload a PDF, Word (.docx) or text file.'); return; }
    if (f.size > MAX_FILE_BYTES) { setFileError('That file is over 25 MB. Please upload a smaller file.'); return; }
    if (f.size === 0) { setFileError('That file is empty.'); return; }
    setFileBusy(true);
    try {
      let text;
      if (ext === 'txt') text = await f.text();
      else {
        const r = await extractContractText(f);
        if (r && r.error) throw new Error(r.message || 'We could not read that file.');
        text = typeof r === 'string' ? r : (r && r.text) || '';
      }
      text = String(text || '').trim();
      if (!text) throw new Error('No readable text found. This looks like a scanned image. Upload a text-based PDF or Word file, or type the details in instead.');
      if (alive.current) setFile({ name: f.name, text: clip(text, MAX_CONTEXT_CHARS), chars: text.length, truncated: text.length > MAX_CONTEXT_CHARS });
    } catch (e) { if (alive.current) setFileError(e.message || 'We could not read that file.'); }
    finally { if (alive.current) setFileBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const sourceReady = mode === 'manual' || (mode === 'case' && chosenCase) || (mode === 'file' && file);

  const toQuestions = async () => {
    setError(''); setBusy(true);
    try {
      let ask = requestText;
      const facts = mode === 'case' ? caseFacts(chosenCase) : '';
      if (facts) ask += `\n\nKnown from the matter file (do not ask for these again):\n${facts}`;
      if (mode === 'file' && file) ask += `\n\nDocument provided (excerpt):\n${clip(file.text, 1500)}`;
      const res = await fetch(`${API_BASE}/api/ai/intake`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: clip(ask, 3800), has_attachment: mode === 'file' }),
      });
      if (!res.ok) throw new Error(await readError(res, 'We could not prepare the questions. Please try again.'));
      const data = await res.json();
      const qs = Array.isArray(data.questions) ? data.questions : [];
      const pre = mode === 'case' ? prefillFromCase(chosenCase, qs) : {};
      setIntake({ doc_label: data.doc_label || docType.label, summary: data.summary || '', questions: qs, kind: data.kind });
      setAnswers(pre); setFromCase(Object.fromEntries(Object.keys(pre).map((k) => [k, true])));
      setStep(qs.length ? 'questions' : 'review');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const setAnswer = (id, v) => { setAnswers((a) => ({ ...a, [id]: v })); setFromCase((f) => (f[id] ? { ...f, [id]: false } : f)); };

  const missing = useMemo(
    () => (intake?.questions || []).filter((q) => !String(answers[q.id] || '').trim()),
    [intake, answers],
  );

  const generate = async () => {
    setError(''); setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/intake/brief`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: requestText, questions: intake?.questions || [], answers }),
      });
      if (!res.ok) throw new Error(await readError(res, 'We could not prepare the draft. Please try again.'));
      const { brief } = await res.json();
      const parts = [];
      if (mode === 'case' && chosenCase) parts.push(`MATTER FILE\n${caseFacts(chosenCase)}`);
      if (mode === 'file' && file) parts.push(`UPLOADED DOCUMENT (${file.name})\n${file.text}`);
      onGenerate?.({
        brief, context: parts.join('\n\n---\n\n'), docLabel: intake?.doc_label || docType?.label || 'Document',
        caseId: chosenCase?.id || null, source: mode, fileName: file?.name || '',
      });
    } catch (e) { setError(e.message); setBusy(false); }
  };

  if (!open) return null;

  const stepIndex = { type: 1, source: 2, questions: 3, review: 4 }[step];
  const sourceSummary = mode === 'case' && chosenCase ? `Case: ${chosenCase.title}${chosenCase.case_no ? ` (${chosenCase.case_no})` : ''}`
    : mode === 'file' && file ? `File: ${file.name}` : 'Details typed by you';

  return (
    <div className="gdm-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <style>{CSS}</style>
      <div className="gdm" role="dialog" aria-modal="true" aria-labelledby="gdm-title" ref={dialogRef}>
        <header className="gdm-head">
          <div>
            <p className="gdm-step">Step {stepIndex} of 4</p>
            <h2 id="gdm-title">{step === 'type' ? 'What do you need to draft?'
              : step === 'source' ? 'Which case or file is this for?'
                : step === 'questions' ? `A few questions about the ${(intake?.doc_label || docType?.label || 'document').toLowerCase()}`
                  : 'Check, then generate'}</h2>
          </div>
          <button type="button" className="gdm-x" onClick={() => !busy && onClose?.()} aria-label="Close">×</button>
        </header>

        <div className="gdm-body">
          {step === 'type' && (
            <>
              <div className="gdm-grid">
                {DOC_TYPES.map((t) => (
                  <button key={t.key} type="button" className={`gdm-card${docType?.key === t.key ? ' is-on' : ''}`} onClick={() => { setDocType(t); setStep('source'); }}>
                    <b>{t.label}</b><span>{t.hint}</span>
                  </button>
                ))}
              </div>
              <div className="gdm-other">
                <label htmlFor="gdm-custom">Something else</label>
                <div className="gdm-row">
                  <input id="gdm-custom" className="gdm-input" placeholder="e.g. Reply to a legal notice, Vakalatnama, Sale deed" value={customRequest}
                    onChange={(e) => setCustomRequest(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && customRequest.trim().length > 3) { setDocType({ key: 'custom', label: 'Document', request: customRequest.trim() }); setStep('source'); } }} />
                  <button type="button" className="gdm-btn" disabled={customRequest.trim().length < 4}
                    onClick={() => { setDocType({ key: 'custom', label: 'Document', request: customRequest.trim() }); setStep('source'); }}>Continue</button>
                </div>
              </div>
            </>
          )}

          {step === 'source' && (
            <>
              <p className="gdm-lede">Drafting a <b>{(docType?.label || 'document').toLowerCase()}</b>. Pick where the facts come from. Nothing is made up: anything missing stays as a blank you fill in.</p>
              <div className="gdm-modes" role="radiogroup" aria-label="Where do the facts come from?">
                {[
                  ...(loadedDoc && loadedDoc.text ? [['loaded', 'Use the document already open', loadedDoc.name || 'The document sent to this screen']] : []),
                  ['case', 'A case in my practice', 'Uses the parties, court and details already on file'],
                  ['file', 'Upload a file', 'A contract, invoice, FIR or earlier notice (PDF, Word or text)'],
                  ['manual', 'I will type the details', 'Start with a blank set of questions']].map(([k, t, d]) => {
                  const on = k === 'loaded' ? (mode === 'file' && file && file.fromLoaded) : (k === 'file' ? (mode === 'file' && !(file && file.fromLoaded)) : mode === k);
                  return (
                  <button key={k} type="button" role="radio" aria-checked={!!on} className={`gdm-mode${on ? ' is-on' : ''}`}
                    onClick={() => {
                      setError('');
                      if (k === 'loaded') {
                        const t2 = String(loadedDoc.text || '').trim();
                        setMode('file'); setFileError('');
                        setFile({ name: loadedDoc.name || 'Open document', text: clip(t2, MAX_CONTEXT_CHARS), chars: t2.length, truncated: t2.length > MAX_CONTEXT_CHARS, fromLoaded: true });
                      } else {
                        if (file && file.fromLoaded) setFile(null);
                        setMode(k);
                      }
                    }}>
                    <b>{t}</b><span>{d}</span>
                  </button>
                  );
                })}
              </div>

              {mode === 'case' && (
                <div className="gdm-pane">
                  <label htmlFor="gdm-q">Find the case</label>
                  <input id="gdm-q" className="gdm-input" placeholder="Search by client, party, case number or court" value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} />
                  {casesError && <p className="gdm-err" role="alert">{casesError}</p>}
                  {cases === null && !casesError && <p className="gdm-muted">Loading your cases…</p>}
                  {cases && cases.length === 0 && !casesError && (
                    <p className="gdm-muted">{caseQuery ? 'No case matches that search.' : 'You have no cases yet.'} You can{' '}
                      <button type="button" className="gdm-link" onClick={() => onOpenPractice?.()}>add a case in Practice</button>, upload a file, or type the details instead.</p>
                  )}
                  <ul className="gdm-cases">
                    {(cases || []).map((c) => (
                      <li key={c.id}>
                        <button type="button" className={`gdm-case${chosenCase?.id === c.id ? ' is-on' : ''}`} onClick={() => pickCase(c)} disabled={busy}>
                          <b>{c.title}</b>
                          <span>{[c.case_no, c.court, c.client_name && `Client: ${c.client_name}`].filter(Boolean).join(' · ')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {mode === 'file' && (
                <div className="gdm-pane">
                  <input ref={fileRef} id="gdm-file" type="file" accept=".pdf,.docx,.txt" className="gdm-hidden" onChange={(e) => onFile(e.target.files)} />
                  {!file && (
                    <label htmlFor="gdm-file" className={`gdm-drop${fileBusy ? ' is-busy' : ''}`}
                      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files); }}>
                      {fileBusy ? 'Reading the file…' : 'Choose a file or drop it here'}<small>PDF, Word or text, up to 25 MB</small>
                    </label>
                  )}
                  {fileError && <p className="gdm-err" role="alert">{fileError}</p>}
                  {file && (
                    <div className="gdm-file">
                      <div><b>{file.name}</b><span>{file.chars.toLocaleString('en-IN')} characters read{file.truncated ? ` (the first ${MAX_CONTEXT_CHARS.toLocaleString('en-IN')} will be used)` : ''}</span></div>
                      <p>{clip(file.text.replace(/\s+/g, ' '), 220)}…</p>
                      <button type="button" className="gdm-link" onClick={() => setFile(null)}>Remove and choose another</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {step === 'questions' && intake && (
            <>
              {intake.summary && <p className="gdm-lede">{intake.summary}</p>}
              <p className="gdm-muted">Anything you leave blank stays in the draft as a <code>[Bracketed Field]</code>. Nothing is invented.</p>
              <div className="gdm-qs">
                {intake.questions.map((q, i) => {
                  const v = answers[q.id] || '';
                  const id = `gdm-q-${q.id}`;
                  return (
                    <div className="gdm-q" key={q.id}>
                      <label htmlFor={id}>{i + 1}. {q.label}{q.required ? <em> · needed</em> : null}{fromCase[q.id] ? <span className="gdm-tag">from the case file</span> : null}</label>
                      {q.why && <small>{q.why}</small>}
                      {q.type === 'choice' && Array.isArray(q.options) && q.options.length > 0 ? (
                        <div className="gdm-chips" role="radiogroup" aria-label={q.label}>
                          {q.options.map((o) => (
                            <button key={o} type="button" role="radio" aria-checked={v === o} className={`gdm-chip${v === o ? ' is-on' : ''}`} onClick={() => setAnswer(q.id, v === o ? '' : o)}>{o}</button>
                          ))}
                          <input id={id} className="gdm-input gdm-input--sm" placeholder={q.placeholder || 'Other'} value={q.options.includes(v) ? '' : v} onChange={(e) => setAnswer(q.id, e.target.value)} />
                        </div>
                      ) : q.type === 'date' ? (
                        <input id={id} className="gdm-input" type="date" value={v} onChange={(e) => setAnswer(q.id, e.target.value)} />
                      ) : q.type === 'number' ? (
                        <input id={id} className="gdm-input" type="number" inputMode="decimal" placeholder={q.placeholder} value={v} onChange={(e) => setAnswer(q.id, e.target.value)} />
                      ) : (
                        <textarea id={id} className="gdm-input gdm-ta" rows={2} maxLength={600} placeholder={q.placeholder} value={v} onChange={(e) => setAnswer(q.id, e.target.value)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {step === 'review' && (
            <>
              <dl className="gdm-sum">
                <div><dt>Document</dt><dd>{intake?.doc_label || docType?.label}</dd></div>
                <div><dt>Facts from</dt><dd>{sourceSummary}</dd></div>
                {(intake?.questions || []).filter((q) => String(answers[q.id] || '').trim()).map((q) => (
                  <div key={q.id}><dt>{q.label}</dt><dd>{answers[q.id]}</dd></div>
                ))}
              </dl>
              {missing.length > 0 ? (
                <div className="gdm-warn" role="status">
                  <b>{missing.length} detail{missing.length === 1 ? '' : 's'} will be left blank for you to fill in:</b>
                  <ul>{missing.map((q) => <li key={q.id}>{q.label}</li>)}</ul>
                  <button type="button" className="gdm-link" onClick={() => setStep('questions')}>Go back and answer</button>
                </div>
              ) : <p className="gdm-muted">Everything is answered. The draft will use only these facts.</p>}
            </>
          )}
          {error && <p className="gdm-err" role="alert">{error}</p>}
        </div>

        <footer className="gdm-foot">
          <button type="button" className="gdm-ghost" disabled={busy || step === 'type' || (step === 'source' && !!initialRequest.trim() && !initialType)}
            onClick={() => { setError(''); setStep(step === 'review' ? (intake?.questions?.length ? 'questions' : 'source') : step === 'questions' ? 'source' : 'type'); }}>Back</button>
          {step === 'source' && <button type="button" className="gdm-btn" disabled={!sourceReady || busy} onClick={toQuestions}>{busy ? 'Preparing…' : 'Continue'}</button>}
          {step === 'questions' && <button type="button" className="gdm-btn" onClick={() => setStep('review')}>Review</button>}
          {step === 'review' && <button type="button" className="gdm-btn" disabled={busy} onClick={generate}>{busy ? 'Starting…' : 'Generate draft'}</button>}
        </footer>
      </div>
    </div>
  );
}

const CSS = `
.gdm-back{position:fixed;inset:0;z-index:1200;background:rgba(20,26,31,.52);display:grid;place-items:center;padding:16px}
.gdm{width:min(720px,100%);max-height:min(92vh,860px);display:flex;flex-direction:column;background:var(--paper,#fff);color:var(--ink,#1c252c);border:1px solid var(--rule,#ddd);border-radius:16px;box-shadow:0 30px 80px -30px rgba(0,0,0,.5);font-family:'IBM Plex Sans',system-ui,sans-serif}
.gdm-head{display:flex;justify-content:space-between;gap:12px;padding:18px 22px 12px;border-bottom:1px solid var(--rule,#ddd)}
.gdm-step{margin:0 0 4px;font:600 10.5px 'IBM Plex Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#667)}
.gdm-head h2{margin:0;font-size:19px;line-height:1.3;font-weight:600;color:var(--ink,#1c252c)}
.gdm-x{border:0;background:none;font-size:26px;line-height:1;color:var(--muted,#667);cursor:pointer;padding:0 4px;align-self:flex-start}
.gdm-body{padding:16px 22px;overflow-y:auto;flex:1}
.gdm-foot{display:flex;justify-content:space-between;gap:10px;padding:12px 22px 16px;border-top:1px solid var(--rule,#ddd)}
.gdm-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.gdm-card,.gdm-mode,.gdm-case{display:flex;flex-direction:column;gap:3px;text-align:left;padding:12px 14px;border:1px solid var(--rule,#ddd);border-radius:12px;background:var(--paper-2,#faf8f3);cursor:pointer;color:var(--ink,#1c252c);font:inherit}
.gdm-card b,.gdm-mode b,.gdm-case b{font-size:14px;font-weight:600}
.gdm-card span,.gdm-mode span,.gdm-case span{font-size:12px;color:var(--muted,#667);line-height:1.4}
.gdm-card:hover,.gdm-mode:hover,.gdm-case:hover,.gdm-card.is-on,.gdm-mode.is-on,.gdm-case.is-on{border-color:var(--accent,#937243);background:color-mix(in srgb,var(--accent,#937243) 8%,var(--paper-2,#faf8f3))}
.gdm-other{margin-top:16px}.gdm-other label,.gdm-pane label,.gdm-q label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
.gdm-row{display:flex;gap:8px}
.gdm-input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--rule,#ccc);border-radius:10px;background:var(--paper,#fff)!important;color:var(--ink,#1c252c)!important;font:inherit;font-size:14px}
.gdm-input:focus-visible{outline:2px solid var(--accent,#937243);outline-offset:1px}
.gdm-input--sm{flex:1;min-width:150px;padding:6px 10px;font-size:13px}.gdm-ta{resize:vertical;min-height:54px}
.gdm-btn{padding:10px 18px;border:0;border-radius:10px;background:var(--accent,#937243);color:var(--on-accent,#fff);font:600 14px 'IBM Plex Sans',sans-serif;cursor:pointer;white-space:nowrap}
.gdm-btn:disabled{opacity:.4;cursor:not-allowed}
.gdm-ghost{padding:10px 16px;border:1px solid var(--rule,#ccc);border-radius:10px;background:none;color:var(--ink,#1c252c);font:500 14px 'IBM Plex Sans',sans-serif;cursor:pointer}
.gdm-ghost:disabled{opacity:.35;cursor:not-allowed}
.gdm-lede{margin:0 0 12px;font-size:14px;line-height:1.55;color:var(--ink-soft,#3a454c)}
.gdm-muted{margin:6px 0;font-size:12.5px;line-height:1.5;color:var(--muted,#667)}.gdm-muted code,.gdm-sum code{font-family:'IBM Plex Mono',monospace;font-size:12px}
.gdm-modes{display:grid;gap:8px;margin-bottom:14px}
.gdm-pane{margin-top:6px}
.gdm-cases{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:7px;max-height:250px;overflow-y:auto}
.gdm-hidden{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.gdm-drop{display:flex;flex-direction:column;gap:4px;align-items:center;padding:26px 14px;border:1.5px dashed var(--rule,#bbb);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;text-align:center}
.gdm-drop small{font-weight:400;color:var(--muted,#667);font-size:12px}.gdm-drop:hover{border-color:var(--accent,#937243)}.gdm-drop.is-busy{opacity:.6}
.gdm-file{border:1px solid var(--rule,#ddd);border-radius:12px;padding:12px 14px;background:var(--paper-2,#faf8f3)}
.gdm-file b{display:block;font-size:14px}.gdm-file span{font-size:12px;color:var(--muted,#667)}.gdm-file p{margin:8px 0;font-size:12.5px;color:var(--ink-soft,#3a454c);line-height:1.5}
.gdm-link{border:0;background:none;padding:0;color:var(--accent,#937243);font:inherit;font-size:inherit;text-decoration:underline;cursor:pointer}
.gdm-err{margin:10px 0 0;padding:9px 12px;border-radius:10px;background:#fbeaea;color:#8c2323;font-size:13px;line-height:1.45}
.gdm-qs{display:grid;gap:16px;margin-top:10px}.gdm-q small{display:block;margin:-2px 0 7px;font-size:12px;color:var(--muted,#667);line-height:1.45}
.gdm-q label em{font-style:normal;font-weight:500;color:var(--accent,#937243);font-size:12px}
.gdm-tag{margin-left:8px;padding:2px 7px;border-radius:99px;background:color-mix(in srgb,var(--accent,#937243) 12%,transparent);color:var(--accent,#937243);font:600 10.5px 'IBM Plex Mono',monospace;letter-spacing:.04em}
.gdm-chips{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.gdm-chip{padding:7px 12px;border:1px solid var(--rule,#ccc);border-radius:99px;background:var(--paper,#fff);color:var(--ink,#1c252c);font:500 13px 'IBM Plex Sans',sans-serif;cursor:pointer}
.gdm-chip.is-on{background:var(--accent,#937243);border-color:var(--accent,#937243);color:var(--on-accent,#fff)}
.gdm-sum{margin:0 0 12px}.gdm-sum div{display:grid;grid-template-columns:minmax(120px,38%) 1fr;gap:12px;padding:8px 0;border-bottom:1px solid var(--rule,#e5e5e5)}
.gdm-sum dt{font-size:12.5px;color:var(--muted,#667)}.gdm-sum dd{margin:0;font-size:13.5px;word-break:break-word}
.gdm-warn{padding:11px 14px;border-radius:12px;background:#fff6e5;border:1px solid #f0d9a8;color:#6b4e12;font-size:13px}
.gdm-warn ul{margin:6px 0 8px;padding-left:18px}
@media (max-width:560px){.gdm-grid{grid-template-columns:1fr}.gdm-sum div{grid-template-columns:1fr;gap:2px}.gdm-row{flex-direction:column}}
`;
