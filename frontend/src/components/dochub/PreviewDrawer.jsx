import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, dh } from './api.js';
import { Icon } from './icons.jsx';
import { Chip, Confirm, Menu, Portal, useDialog, useHotkeys } from './ui.jsx';
import { HitList, PageView, TextView, ZOOMS, useHits, useTermsKey } from './Viewer.jsx';
import { KIND_LABEL, STATUS, fmtAgo, fmtBytes, fmtDate, fmtNum } from './format.js';

const toForm = (d) => ({
  title: d.title || '',
  doc_class: d.doc_class || 'Unclassified',
  doc_date: d.doc_date || '',
  next_hearing: d.next_hearing || '',
  parties: d.parties || '',
  court: d.court || '',
  case_numbers: (d.case_numbers || []).join(', '),
  tags: d.tags || [],
  folder_id: d.folder_id ? String(d.folder_id) : '',
  matter_id: d.matter_id ? String(d.matter_id) : '',
});

const splitCases = (s) => s.split(/[;\n,]+/).map((x) => x.trim()).filter(Boolean);

// only the fields that really changed go to the server (and into the audit trail)
function diff(form, base) {
  const out = {};
  if (form.title.trim() !== base.title) out.title = form.title.trim();
  if (form.doc_class !== base.doc_class) out.doc_class = form.doc_class;
  if (form.doc_date !== base.doc_date) out.doc_date = form.doc_date || null;
  if (form.next_hearing !== base.next_hearing) out.next_hearing = form.next_hearing || null;
  if (form.parties.trim() !== base.parties) out.parties = form.parties.trim() || null;
  if (form.court.trim() !== base.court) out.court = form.court.trim() || null;
  if (splitCases(form.case_numbers).join('|') !== splitCases(base.case_numbers).join('|')) out.case_numbers = splitCases(form.case_numbers);
  if (form.tags.join('|') !== base.tags.join('|')) out.tags = form.tags;
  if (form.folder_id !== base.folder_id) out.folder_id = form.folder_id ? Number(form.folder_id) : null;
  if (form.matter_id !== base.matter_id) out.matter_id = form.matter_id ? Number(form.matter_id) : null;
  return out;
}

function TagInput({ value, onChange, disabled }) {
  const [draft, setDraft] = useState('');
  const add = (raw) => {
    const t = raw.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (t && !value.some((x) => x.toLowerCase() === t.toLowerCase()) && value.length < 20) onChange([...value, t]);
    setDraft('');
  };
  return (
    <div className="dh-taginput">
      {value.map((t) => (
        <span key={t} className="dh-chip removable"><Icon name="tag" />{t}
          {!disabled ? <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}><Icon name="close" size={10} /></button> : null}
        </span>
      ))}
      {!disabled ? (
        <input value={draft} placeholder={value.length ? '' : 'Add a tag and press Enter'} maxLength={40} aria-label="Add a tag"
          onChange={(e) => setDraft(e.target.value)} onBlur={() => draft && add(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
            else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }} />
      ) : null}
    </div>
  );
}

export function PreviewDrawer({ docId, q, terms, neighbors, folderIndex, matters, config, onClose, onNavigate, onChanged, onRemoved, onFilterCase, onAddToBundle, toast }) {
  const ref = useRef(null);
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState('pages');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [textStart, setTextStart] = useState(1);
  const [form, setForm] = useState(null);
  const [base, setBase] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [verUpload, setVerUpload] = useState(null);      // {file, note}
  const fileIn = useRef(null);
  const lastDoc = useRef(null);
  const formRef = useRef(null);
  const baseRef = useRef(null);
  formRef.current = form;

  const hits = useHits(docId, q);
  const words = useTermsKey(terms && terms.length ? terms : hits.terms);
  const level = doc?.level || 'view';
  const canEdit = level === 'edit' || level === 'own';
  const canPages = doc && (doc.kind === 'pdf' || doc.kind === 'image') && doc.status !== 'failed';   // a file that would not open has no pages to draw

  const dirtyFields = useMemo(() => (form && base ? diff(form, base) : {}), [form, base]);
  const dirty = Object.keys(dirtyFields).length > 0;

  const guard = useCallback((run) => {
    if (dirty) setConfirm({ kind: 'discard', run }); else run();
  }, [dirty]);
  const close = useCallback(() => guard(onClose), [guard, onClose]);
  useDialog(ref, close);

  const load = useCallback(async (silent) => {
    try {
      const d = await dh.get(docId);
      setDoc(d);
      setErr(null);
      return d;
    } catch (e) {
      if (!silent) setErr(e);
      return null;
    }
  }, [docId]);

  // a different document: start clean
  useEffect(() => {
    baseRef.current = null;
    setDoc(null); setErr(null); setForm(null); setBase(null); setPage(1); setTextStart(1); setVerUpload(null); lastDoc.current = null;
    load(false);
  }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  // the form follows the server copy unless the person is in the middle of editing
  useEffect(() => {
    if (!doc || doc.id !== docId) return;
    const fresh = toForm(doc);
    const idChanged = lastDoc.current !== doc.id;
    lastDoc.current = doc.id;
    if (idChanged) {
      setMode((doc.kind === 'pdf' || doc.kind === 'image') && doc.status !== 'failed' ? 'pages' : 'text');
    }
    const editing = formRef.current && baseRef.current && Object.keys(diff(formRef.current, baseRef.current)).length > 0;
    baseRef.current = fresh;
    setBase(fresh);
    if (idChanged || !editing) setForm(fresh);
  }, [doc, docId]);

  // still being read: check back until it is done
  useEffect(() => {
    if (!doc || !['queued', 'processing'].includes(doc.status)) return undefined;
    const t = setInterval(async () => {
      const d = await load(true);
      if (d && !['queued', 'processing'].includes(d.status)) onChanged?.(d);
    }, 2000);
    return () => clearInterval(t);
  }, [doc?.status, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageCount = Math.max(1, doc?.page_count || 1);
  const go = (p) => setPage(Math.min(pageCount, Math.max(1, p)));

  const run = async (label, fn, okMsg) => {
    setBusy(label);
    try {
      const r = await fn();
      if (okMsg) toast?.(okMsg);
      return r ?? true;
    } catch (e) {
      toast?.(e.message || 'That did not work.', { tone: 'bad' });
      return null;
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const r = await dh.patch(docId, dirtyFields);
      const merged = { ...doc, ...r.doc, level: doc.level };
      setDoc(merged);
      onChanged?.(merged);
      const fresh = toForm(merged);
      setBase(fresh);
      setForm(fresh);
      toast?.('Saved');
      load(true);
    } catch (e) {
      toast?.(e.message || 'Could not save.', { tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const quickPatch = async (body, okMsg) => {
    const r = await run('patch', () => dh.patch(docId, body), okMsg);
    if (r && r !== true) {
      const merged = { ...doc, ...r.doc, level: doc.level };
      setDoc(merged);
      onChanged?.(merged);
      load(true);
    }
    return r;
  };

  const trash = async () => {
    setConfirm(null);
    const r = await run('trash', () => dh.trash(docId));
    if (r) {
      onRemoved?.(docId);
      toast?.('Moved to the trash', { action: { label: 'Undo', run: () => dh.restore(docId).then(() => { onChanged?.(); toast?.('Restored'); }).catch((e) => toast?.(e.message, { tone: 'bad' })) } });
    }
  };

  const openOriginal = async () => {
    const w = window.open('', '_blank');
    try {
      const blob = await dh.fileBlob(docId);
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      if (w) w.close();
      toast?.(e.message || 'Could not open the file.', { tone: 'bad' });
    }
  };

  const uploadVersion = async () => {
    if (!verUpload) return;
    const r = await run('version', () => dh.newVersion(docId, verUpload.file, verUpload.note), 'New version added — it is being read now');
    if (r && r !== true) {
      setVerUpload(null);
      onChanged?.(r.doc);
      onNavigate?.(r.doc.id, { force: true });
    }
  };

  useHotkeys({
    ArrowLeft: (e) => { if (mode === 'pages' && canPages) { e.preventDefault(); go(page - 1); } },
    ArrowRight: (e) => { if (mode === 'pages' && canPages) { e.preventDefault(); go(page + 1); } },
    j: () => neighbors?.next && guard(() => onNavigate(neighbors.next)),
    k: () => neighbors?.prev && guard(() => onNavigate(neighbors.prev)),
  }, !confirm);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const st = doc ? (STATUS[doc.status] || STATUS.ready) : null;
  const inProblem = doc && ['failed', 'needs_ocr', 'ready_partial', 'empty', 'unsupported'].includes(doc.status);
  const needsReview = doc && doc.review === 'needs_review' && !['queued', 'processing'].includes(doc.status);
  const folderOptions = folderIndex.options;
  const alternatives = (doc?.alternatives || []).filter((a) => a.doc_class && a.doc_class !== doc.doc_class).slice(0, 3);
  const readOnly = !canEdit || !!doc?.deleted_at;

  const jumpToHit = (p) => {
    if (canPages) { setMode('pages'); go(p); } else { setMode('text'); setTextStart(p); }
  };

  const body = (() => {
    if (err) {
      return (
        <div style={{ margin: 'auto', padding: 30, textAlign: 'center', maxWidth: 420 }}>
          <Icon name="alert" size={26} />
          <h3 style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic', color: 'var(--ink)', margin: '10px 0 6px' }}>{err instanceof ApiError && err.status === 404 ? 'This document is no longer here' : 'Could not open this document'}</h3>
          <p style={{ color: 'var(--muted)', margin: '0 0 16px' }}>{err.message}</p>
          <div className="dh-empty row" style={{ border: 'none', padding: 0, background: 'transparent' }}>
            {!(err instanceof ApiError && err.status === 404) ? <button type="button" className="dh-btn ghost" onClick={() => { setErr(null); load(false); }}>Try again</button> : null}
            <button type="button" className="dh-btn primary" onClick={onClose}>Close</button>
          </div>
        </div>
      );
    }
    if (!doc) {
      return <div style={{ margin: 'auto', color: 'var(--muted)', display: 'flex', gap: 10, alignItems: 'center' }} aria-busy="true"><Icon name="refresh" className="dh-spin" />Opening…</div>;
    }
    const reading = ['queued', 'processing'].includes(doc.status);
    return (
      <div className="dh-dbody">
        {/* ── left: the document itself ── */}
        <section className="dh-viewer" aria-label="Document view">
          <div className="dh-vbar">
            <div className="dh-seg" role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected={mode === 'pages'} className={mode === 'pages' ? 'on' : ''} disabled={!canPages} onClick={() => setMode('pages')}
                title={canPages ? 'See the pages as they are' : 'No page view for this kind of file'}>Pages</button>
              <button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'on' : ''} onClick={() => setMode('text')} title="Text the hub read from the file">Text</button>
            </div>
            {mode === 'pages' && canPages ? (
              <>
                <span className="pgno">
                  <button type="button" className="dh-ibtn" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="Previous page"><Icon name="chevL" /></button>
                  <input className="dh-input" value={page} inputMode="numeric" aria-label="Page number"
                    onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); if (Number.isFinite(n)) go(n); }} />
                  <span>of {fmtNum(pageCount)}</span>
                  <button type="button" className="dh-ibtn" onClick={() => go(page + 1)} disabled={page >= pageCount} aria-label="Next page"><Icon name="chevR" /></button>
                </span>
                <span className="sp" />
                <button type="button" className="dh-ibtn" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom <= 0} aria-label="Zoom out"><Icon name="minus" /></button>
                <button type="button" className="dh-ibtn" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom >= ZOOMS.length - 1} aria-label="Zoom in"><Icon name="plus" /></button>
              </>
            ) : <span className="sp" />}
            {doc.inline_ok ? <button type="button" className="dh-btn quiet sm" onClick={openOriginal}><Icon name="arrowUR" />Open original</button> : null}
          </div>
          <div className="dh-vscroll">
            {reading ? (
              <div className="dh-pagebox" aria-busy="true"><Icon name="refresh" className="dh-spin" size={24} />
                <div><b style={{ color: 'var(--ink)' }}>{doc.status === 'queued' ? 'Waiting to be read' : 'Reading this document'}</b><br />Text, dates, case numbers and the document type are being worked out. This page updates by itself.</div>
              </div>
            ) : null}
            {!reading && mode === 'pages' && canPages ? (
              <>
                <HitList hits={hits.list} onPick={go} current={page} />
                <PageView docId={docId} page={page} pageCount={pageCount} zoom={zoom} terms={words} onDownload={() => dh.download(docId, doc.original_name).catch((e) => toast?.(e.message, { tone: 'bad' }))} />
              </>
            ) : null}
            {!reading && mode === 'text' ? (
              <>
                {!canPages && doc.status !== 'failed' ? <p className="dh-note" style={{ maxWidth: 860, width: '100%', margin: 0 }}>This kind of file has no page picture, so you are reading the text the hub extracted. <b>Download</b> gives you the original.</p> : null}
                <HitList hits={hits.list} onPick={jumpToHit} current={textStart} />
                <TextView docId={docId} start={textStart} words={words} pageKind={doc.page_kind} />
              </>
            ) : null}
          </div>
        </section>

        {/* ── right: what the hub knows, and what you can change ── */}
        <aside className="dh-side" aria-label="Details">
          {doc.deleted_at ? (
            <div className="dh-review-note"><Icon name="trash" /><div><div className="t">In the trash</div><div className="d">This document is deleted and will be removed for good in {doc.days_left ?? config?.trash_days ?? 30} days. Restore it to edit it.</div>
              <div className="row"><button type="button" className="dh-btn primary sm" onClick={async () => { const r = await run('restore', () => dh.restore(docId), 'Restored'); if (r) { onChanged?.(); load(true); } }}><Icon name="restore" />Restore</button></div></div></div>
          ) : null}

          {needsReview && !doc.deleted_at ? (
            <div className="dh-review-note">
              <Icon name="alert" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t">{doc.doc_class === 'Unclassified' ? 'The hub could not tell what this is' : `Filed as “${doc.doc_class}” — is that right?`}</div>
                <div className="d">{doc.doc_class === 'Unclassified' ? 'Choose the type below, or pick one of these.' : `${doc.class_conf != null ? `About ${Math.round(doc.class_conf * 100)}% sure. ` : ''}It is only a suggestion until you confirm it.`}</div>
                {doc.class_evidence?.length ? <div className="dh-evidence">{doc.class_evidence.slice(0, 4).map((e) => <span key={e} className="dh-chip">“{e}”</span>)}</div> : null}
                {canEdit ? (
                  <div className="row">
                    {doc.doc_class !== 'Unclassified' ? <button type="button" className="dh-btn primary sm" disabled={!!busy} onClick={() => quickPatch({ review: 'reviewed' }, 'Confirmed')}><Icon name="check" />Yes, that’s right</button> : null}
                    {alternatives.map((a) => <button key={a.doc_class} type="button" className="dh-btn ghost sm" disabled={!!busy} onClick={() => quickPatch({ doc_class: a.doc_class }, `Set to ${a.doc_class}`)}>{a.doc_class}</button>)}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {inProblem && !doc.deleted_at ? (
            <div className="dh-review-note" style={{ background: doc.status === 'failed' ? 'var(--accent-soft)' : undefined }}>
              <Icon name="alert" />
              <div>
                <div className="t">{st.label}</div>
                <div className="d">{doc.status_note || st.hint}
                  {doc.status === 'needs_ocr' ? ' The text can be read later, once the OCR engine is available on the server — nothing is lost.' : ''}
                </div>
                {(doc.warnings || []).length ? <div className="d" style={{ marginTop: 4 }}>{doc.warnings.slice(0, 3).join(' · ')}</div> : null}
                {canEdit ? <div className="row"><button type="button" className="dh-btn ghost sm" disabled={!!busy} onClick={async () => { const r = await run('reprocess', () => dh.reprocess(docId), 'Reading again…'); if (r) { load(true); onChanged?.(); } }}><Icon name="refresh" />Try reading again</button>
                  <button type="button" className="dh-btn quiet sm" onClick={() => dh.download(docId, doc.original_name).catch((e) => toast?.(e.message, { tone: 'bad' }))}><Icon name="download" />Download original</button></div> : null}
              </div>
            </div>
          ) : null}

          {readOnly && !doc.deleted_at ? <div className="dh-pii" style={{ marginBottom: 16 }}><Icon name="eye" /><span>You can view this document but not change it. It was shared with you by its owner.</span></div> : null}

          {form ? (
            <>
              <div className="dh-sec">
                <h3>Details</h3>
                <label className="dh-field"><span className="lab">Title</span>
                  <input className="dh-input" value={form.title} disabled={readOnly} maxLength={180} onChange={(e) => set({ title: e.target.value })} /></label>
                <label className="dh-field"><span className="lab">Document type</span>
                  <select className="dh-select" value={form.doc_class} disabled={readOnly} onChange={(e) => set({ doc_class: e.target.value })}>
                    {(config?.classes || [form.doc_class]).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {doc.class_src === 'user' ? <span className="hint">Set by a person, so the hub will not change it.</span> : doc.class_conf != null ? <span className="hint">The hub’s guess, {Math.round(doc.class_conf * 100)}% sure.</span> : null}
                </label>
                <div className="dh-row2">
                  <label className="dh-field"><span className="lab">Document date</span>
                    <input className="dh-input" type="date" value={form.doc_date} disabled={readOnly} onChange={(e) => set({ doc_date: e.target.value })} /></label>
                  <label className="dh-field"><span className="lab">Next hearing</span>
                    <input className="dh-input" type="date" value={form.next_hearing} disabled={readOnly} onChange={(e) => set({ next_hearing: e.target.value })} /></label>
                </div>
                <label className="dh-field"><span className="lab">Case number(s)</span>
                  <input className="dh-input" value={form.case_numbers} disabled={readOnly} placeholder="W.P.(C) 1234/2024, CS(OS) 55/2021" onChange={(e) => set({ case_numbers: e.target.value })} />
                  {(doc.case_numbers || []).length ? (
                    <span className="hint" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>Find everything in:
                      {doc.case_numbers.map((n) => <button key={n} type="button" className="dh-chip" style={{ cursor: 'pointer' }} onClick={() => guard(() => onFilterCase?.(n))}><Icon name="search" />{n}</button>)}
                    </span>
                  ) : null}
                </label>
                <label className="dh-field"><span className="lab">Parties</span>
                  <input className="dh-input" value={form.parties} disabled={readOnly} maxLength={200} placeholder="A vs B" onChange={(e) => set({ parties: e.target.value })} /></label>
                <label className="dh-field"><span className="lab">Court</span>
                  <input className="dh-input" value={form.court} disabled={readOnly} maxLength={200} onChange={(e) => set({ court: e.target.value })} /></label>
                <div className="dh-field"><span className="lab">Tags</span>
                  <TagInput value={form.tags} disabled={readOnly} onChange={(tags) => set({ tags })} /></div>
              </div>

              <div className="dh-sec">
                <h3>Where it lives</h3>
                <label className="dh-field"><span className="lab">Folder</span>
                  <select className="dh-select" value={form.folder_id} disabled={readOnly} onChange={(e) => set({ folder_id: e.target.value })}>
                    <option value="">Not filed yet</option>
                    {folderOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  {doc.auto_filed ? <span className="hint">Filed here automatically because the type was clear. Move it if that is wrong.</span> : null}
                </label>
                <label className="dh-field"><span className="lab">Matter</span>
                  <select className="dh-select" value={form.matter_id} disabled={readOnly} onChange={(e) => set({ matter_id: e.target.value })}>
                    <option value="">Not linked to a matter</option>
                    {matters.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
                  </select>
                </label>
                {doc.suggested_matter && !doc.matter_id && canEdit && !doc.deleted_at ? (
                  <div className="dh-pii" style={{ alignItems: 'center' }}><Icon name="briefcase" />
                    <span style={{ flex: 1 }}>Looks like it belongs to <b style={{ color: 'var(--ink)' }}>{doc.suggested_matter.title}</b>.<br /><span style={{ color: 'var(--muted)' }}>{doc.suggested_matter.reason}</span></span>
                    <button type="button" className="dh-btn ghost sm" disabled={!!busy} onClick={() => quickPatch({ matter_id: doc.suggested_matter.id }, 'Linked to the matter')}>Link</button>
                  </div>
                ) : null}
                {(doc.paper || []).length ? (
                  <div className="dh-field" style={{ marginTop: 12 }}><span className="lab">Paper original</span>
                    <div className="fx-paperchips">
                      {doc.paper.map((p) => (
                        <span key={p.id} className={`dh-chip${p.overdue ? ' bad' : ''}`} title={p.title}><Icon name="cabinet" /><span className="mono">{p.file_no}</span>
                          {p.status === 'out' ? ` · with ${p.holder}${p.overdue ? ' (overdue)' : ''}` : p.location ? ` · ${p.location}` : ''}</span>
                      ))}
                    </div>
                    <span className="hint">The paper this scan came from is kept in this file.</span></div>
                ) : null}
                {level === 'own' && !doc.deleted_at ? (
                  <label className="dh-check" style={{ marginTop: 12 }}>
                    <input type="checkbox" checked={!!doc.legal_hold} disabled={!!busy} onChange={(e) => quickPatch({ legal_hold: e.target.checked }, e.target.checked ? 'Legal hold on' : 'Legal hold lifted')} />
                    <span><b style={{ color: 'var(--ink)', fontWeight: 600 }}>Legal hold</b> — cannot be deleted while this is on</span>
                  </label>
                ) : doc.legal_hold ? <div className="dh-pii" style={{ marginTop: 12 }}><Icon name="lock" /><span>Under legal hold by the owner. It cannot be deleted.</span></div> : null}
              </div>
            </>
          ) : null}

          {(doc.pii || []).length ? (
            <div className="dh-sec">
              <h3>Sensitive content</h3>
              <div className="dh-pii"><Icon name="alert" /><span>May contain: <b style={{ color: 'var(--ink)' }}>{doc.pii.join(', ')}</b>. Be careful before sharing this document outside the firm.</span></div>
            </div>
          ) : null}

          <div className="dh-sec">
            <h3>About the file</h3>
            <dl className="dh-kv">
              <dt>File</dt><dd>{doc.original_name}</dd>
              <dt>Kind</dt><dd>{KIND_LABEL[doc.kind] || doc.kind}{doc.ext ? ` · .${doc.ext}` : ''} · {fmtBytes(doc.size)}</dd>
              <dt>Length</dt><dd>{doc.page_count ? `${fmtNum(doc.page_count)} ${doc.page_kind === 'sheet' ? 'sheets' : doc.page_kind === 'slide' ? 'slides' : 'pages'}` : '—'}</dd>
              <dt>Read by</dt><dd>{doc.method || '—'}{doc.ocr_pages ? ` · ${fmtNum(doc.ocr_pages)} scanned page${doc.ocr_pages === 1 ? '' : 's'}${doc.ocr_conf != null ? ` (${Math.round(doc.ocr_conf)}% confidence)` : ''}` : ''}</dd>
              {(doc.scripts || []).length ? <><dt>Script</dt><dd>{doc.scripts.join(', ')}</dd></> : null}
              {(doc.fir_numbers || []).length ? <><dt>FIR</dt><dd>{doc.fir_numbers.join(', ')}</dd></> : null}
              {(doc.cnr || []).length ? <><dt>CNR</dt><dd className="mono">{doc.cnr.join(', ')}</dd></> : null}
              {(doc.case_mentions || []).length ? <><dt>Also mentions</dt><dd>{doc.case_mentions.slice(0, 5).join(', ')}</dd></> : null}
              {doc.rel_path ? <><dt>Imported from</dt><dd className="mono">{doc.rel_path}</dd></> : null}
              <dt>Added</dt><dd>{fmtAgo(doc.created_at)}</dd>
              {doc.sha256 ? <><dt>Fingerprint</dt><dd className="mono" title={doc.sha256}>{doc.sha256.slice(0, 16)}…</dd></> : null}
            </dl>
          </div>

          <div className="dh-sec">
            <h3>Versions{(doc.versions || []).length > 1 ? ` · ${doc.versions.length}` : ''}</h3>
            {(doc.versions || []).map((v) => (
              <div key={v.doc_id} className={`dh-ver${v.doc_id === doc.id ? ' cur' : ''}`}>
                <span className="v">v{v.version}</span>
                <span className="m">{v.is_current ? 'Current · ' : ''}{fmtBytes(v.size)} · {fmtAgo(v.created_at)}{v.version_note ? ` · ${v.version_note}` : ''}</span>
                {v.doc_id !== doc.id ? <button type="button" className="dh-btn quiet sm" onClick={() => guard(() => onNavigate(v.doc_id))}>View</button> : <span className="dh-chip">Viewing</span>}
                {!v.is_current && canEdit && !doc.deleted_at ? (
                  <button type="button" className="dh-btn quiet sm" disabled={!!busy} onClick={async () => { const r = await run('promote', () => dh.promote(v.doc_id), `v${v.version} is now the current version`); if (r) { onChanged?.(); load(true); } }}>Make current</button>
                ) : null}
              </div>
            ))}
            {canEdit && !doc.deleted_at ? (
              verUpload ? (
                <div className="dh-pii" style={{ display: 'grid', gap: 8 }}>
                  <div><Icon name="doc" /> <b style={{ color: 'var(--ink)' }}>{verUpload.file.name}</b> · {fmtBytes(verUpload.file.size)}</div>
                  <input className="dh-input" placeholder="What changed? (optional)" maxLength={200} value={verUpload.note} onChange={(e) => setVerUpload((v) => ({ ...v, note: e.target.value }))} aria-label="Version note" />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="dh-btn primary sm" disabled={busy === 'version'} onClick={uploadVersion}>{busy === 'version' ? 'Uploading…' : 'Add as new version'}</button>
                    <button type="button" className="dh-btn quiet sm" onClick={() => setVerUpload(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className="dh-btn ghost sm" onClick={() => fileIn.current?.click()}><Icon name="upload" />Upload a new version</button>
                  <input ref={fileIn} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setVerUpload({ file: f, note: '' }); e.target.value = ''; }} aria-label="Choose the new version" />
                </>
              )
            ) : null}
          </div>

          {(doc.copies || []).length ? (
            <div className="dh-sec">
              <h3>Also in your library</h3>
              {doc.copies.map((c) => (
                <div key={c.id} className="dh-ver">
                  <Icon name="copy" />
                  <span className="m" style={{ color: 'var(--ink-soft)' }}>{c.title}</span>
                  <Chip tone={c.same_file ? 'warn' : ''}>{c.same_file ? 'same file' : 'same text'}</Chip>
                  <button type="button" className="dh-btn quiet sm" onClick={() => guard(() => onNavigate(c.id))}>View</button>
                </div>
              ))}
            </div>
          ) : null}

          {dirty ? (
            <div className="dh-savebar" role="region" aria-label="Unsaved changes">
              <span className="msg">Unsaved changes</span>
              <button type="button" className="dh-btn quiet sm" disabled={saving} onClick={() => setForm(base)}>Undo</button>
              <button type="button" className="dh-btn primary sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          ) : null}
        </aside>
      </div>
    );
  })();

  return (
    <Portal>
      <div className="dh-scrim" onMouseDown={close} />
      <div className="dh-drawer" role="dialog" aria-modal="true" aria-label={doc?.title || 'Document'} ref={ref}>
        <div className="dh-dhead">
          <div className="nav">
            <button type="button" className="dh-ibtn boxed" onClick={() => guard(() => onNavigate(neighbors.prev))} disabled={!neighbors?.prev} aria-label="Previous document" title="Previous (k)"><Icon name="chevU" /></button>
            <button type="button" className="dh-ibtn boxed" onClick={() => guard(() => onNavigate(neighbors.next))} disabled={!neighbors?.next} aria-label="Next document" title="Next (j)"><Icon name="chevD" /></button>
          </div>
          <div className="ttl">
            <h2>{doc?.title || 'Opening…'}</h2>
            <div className="sub">
              {doc ? <>{doc.doc_class}{doc.case_numbers?.length ? ` · ${doc.case_numbers[0]}` : ''}{doc.doc_date ? ` · ${fmtDate(doc.doc_date)}` : ''}{doc.legal_hold ? ' · legal hold' : ''}</> : ' '}
            </div>
          </div>
          {doc && !doc.deleted_at ? (
            <>
              <button type="button" className="dh-btn ghost sm" onClick={() => run('download', () => dh.download(docId, doc.original_name))} disabled={busy === 'download'} aria-label="Download the original"><Icon name="download" /><span className="lbl">Download</span></button>
              <Menu icon="more" label="" chevron={false} right className="dh-ibtn boxed" title="More actions">
                {(closeMenu) => (
                  <>
                    <button type="button" className="item" disabled={!canEdit} onClick={async () => { closeMenu(); const r = await run('reprocess', () => dh.reprocess(docId), 'Reading again…'); if (r) { load(true); onChanged?.(); } }}><Icon name="refresh" />Read this document again</button>
                    {onAddToBundle ? <button type="button" className="item" onClick={() => { closeMenu(); onAddToBundle(docId); }}><Icon name="bundle" />Add to a court bundle…</button> : null}
                    <hr />
                    <button type="button" className="item danger" disabled={!canEdit} onClick={() => { closeMenu(); setConfirm({ kind: 'trash' }); }}><Icon name="trash" />Move to trash</button>
                  </>
                )}
              </Menu>
            </>
          ) : null}
          <button type="button" className="dh-ibtn boxed" onClick={close} aria-label="Close preview"><Icon name="close" /></button>
        </div>
        {body}
      </div>
      {confirm?.kind === 'trash' ? (
        <Confirm danger title="Move to trash?" confirmLabel="Move to trash" busy={busy === 'trash'} onConfirm={trash} onCancel={() => setConfirm(null)}>
          “{doc?.title}” and all its versions will be kept in the trash for {config?.trash_days ?? 30} days, then removed for good. You can restore it any time before that.
        </Confirm>
      ) : null}
      {confirm?.kind === 'discard' ? (
        <Confirm title="Discard your changes?" confirmLabel="Discard" danger onConfirm={() => { const r = confirm.run; setConfirm(null); setForm(base); r(); }} onCancel={() => setConfirm(null)}>
          You edited this document’s details but did not save them.
        </Confirm>
      ) : null}
    </Portal>
  );
}

