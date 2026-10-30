// "Bundles": pick documents, put them in order, get ONE court-ready PDF — cover sheet, index, annexure labels and a running
// page number on every page. The original documents are never changed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CasePicker, DocPickerModal, Spinner } from './FilesCommon.jsx';
import { fx, openPdf } from './filesApi.js';
import { fmtAgo, fmtBytes, fmtNum, plural } from './format.js';
import { Icon } from './icons.jsx';
import { Confirm, EmptyState, Menu, Modal, useDebounced } from './ui.jsx';

const BUILD_STATE = { done: ['Built', ''], building: ['Building…', 'warn'], failed: ['Failed', 'bad'], none: ['Not built yet', ''] };
const PAGINATION = [['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-right', 'Top right'], ['none', 'No page numbers']];
const NUMBER_FORMATS = [['Page {n} of {N}', 'Page 7 of 120'], ['{n}', '7'], ['- {n} -', '- 7 -'], ['Page {n}', 'Page 7']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

// ── list ─────────────────────────────────────────────────────────────────────────────────
function NewBundleModal({ caseRef, caseLabel, onClose, onCreated, toast }) {
  const [title, setTitle] = useState('');
  const [ref, setRef] = useState(caseRef || '');
  const [label, setLabel] = useState(caseLabel || '');
  const [fromCase, setFromCase] = useState(!!caseRef);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (!title.trim() && !ref) { setErr('Name the bundle, or choose its case.'); return; }
    setBusy(true); setErr('');
    try { const r = await fx.bundleCreate({ title: title.trim(), case_ref: ref || null, from_case: !!(ref && fromCase) }); onCreated(r.bundle); }
    catch (ex) { setErr(ex.message || 'Could not create the bundle.'); setBusy(false); toast?.(ex.message, { tone: 'bad' }); }
  };
  return (
    <Modal small title="New bundle" onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="fx-newbundle" className="dh-btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create bundle'}</button></>}>
      <form id="fx-newbundle" onSubmit={submit} className="fx-form">
        <label className="dh-field"><span className="lab">Name</span><input className="dh-input" autoFocus value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Paper book for hearing on 14 Oct" /></label>
        <div className="dh-field"><span className="lab">Case</span>
          <CasePicker value={ref} label={label} allowNone noneLabel="Not linked to a case" placeholder="Link to a case (optional)" onChange={(r, c) => { setRef(r); setLabel(c?.title || ''); if (!r) setFromCase(false); }} />
          <span className="hint">The court, case number and title on the cover are filled in from the case.</span></div>
        {ref ? <label className="dh-check"><input type="checkbox" checked={fromCase} onChange={(e) => setFromCase(e.target.checked)} />Start with every document already filed on this case, oldest first</label> : null}
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </form>
    </Modal>
  );
}

function BundleList({ caseRef, caseLabel, onOpen, toast, onGoCase }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(false);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fx.bundles(caseRef).then((r) => { setList(r.bundles); setErr(''); }).catch((e) => setErr(e.message || 'Could not load bundles.')), [caseRef]);
  useEffect(() => { setList(null); load(); }, [load]);
  const remove = async () => {
    setBusy(true);
    try { await fx.bundleDelete(del.id); toast('Bundle deleted — the documents in it are untouched'); setDel(null); load(); }
    catch (e) { toast(e.message || 'Could not delete it.', { tone: 'bad' }); setDel(null); } finally { setBusy(false); }
  };
  const dup = async (b) => { try { const r = await fx.bundleDuplicate(b.id); toast('Copied'); onOpen(r.bundle?.id || r.id); } catch (e) { toast(e.message, { tone: 'bad' }); } };
  return (
    <section className="fx-section" aria-label="Bundles">
      <div className="fx-intro">
        <div>
          <h2 className="fx-h">Court-ready bundles</h2>
          <p className="fx-lead">Choose the documents, drag them into order, and get one PDF with a cover sheet, an index and a page number on every page — the paper book a court expects, without hours of stapling and photocopying.</p>
        </div>
        <div className="fx-introacts"><button type="button" className="dh-btn primary" onClick={() => setModal(true)}><Icon name="plus" />New bundle</button></div>
      </div>
      {caseRef ? <div className="dh-banner plain"><Icon name="briefcase" /><div className="body">Showing the bundles of <b>{caseLabel || 'one case'}</b>.</div><button type="button" className="dh-btn quiet sm" onClick={() => onGoCase(null)}>Show all</button></div> : null}
      {err ? <div className="dh-errbox" role="alert"><Icon name="alert" /><div className="body">{err}</div><button type="button" className="dh-btn ghost sm" onClick={load}>Try again</button></div> : null}
      {!list && !err ? <div className="fx-skel" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="dh-skel" style={{ animationDelay: `${i * 80}ms` }}><i /></div>)}</div> : null}
      {list && !list.length ? (
        <EmptyState icon="bundle" title="No bundles yet" actions={<button type="button" className="dh-btn primary" onClick={() => setModal(true)}><Icon name="plus" />Make the first bundle</button>}>
          A bundle is a list of documents in a chosen order. You can build the PDF again whenever a document changes.
        </EmptyState>
      ) : null}
      {list && list.length ? (
        <div className="fx-bgrid">
          {list.map((b) => {
            const [txt, tone] = BUILD_STATE[b.state] || BUILD_STATE.none;
            return (
              <article key={b.id} className="fx-bcard">
                <button type="button" className="main" onClick={() => onOpen(b.id)} aria-label={`Open ${b.title}`}>
                  <span className="ic"><Icon name="bundle" size={20} /></span>
                  <span className="ttl">{b.title}</span>
                  <span className="sub">{b.case_label || 'Not linked to a case'}</span>
                  <span className="row"><span className={`dh-chip ${tone}`}>{txt}{b.state === 'done' && b.built_pages ? ` · ${plural(b.built_pages, 'page')}` : ''}</span>
                    <span className="mut">{plural(b.documents, 'document')} · {fmtAgo(b.updated_at)}</span></span>
                </button>
                <Menu icon="more" label="" chevron={false} right className="dh-ibtn" title="More">
                  {(close) => (
                    <>
                      <button type="button" role="menuitem" onClick={() => { close(); dup(b); }}><Icon name="copy" />Make a copy</button>
                      <button type="button" role="menuitem" onClick={() => { close(); setDel(b); }}><Icon name="trash" />Delete</button>
                    </>
                  )}
                </Menu>
              </article>
            );
          })}
        </div>
      ) : null}
      {modal ? <NewBundleModal caseRef={caseRef} caseLabel={caseLabel} toast={toast} onClose={() => setModal(false)} onCreated={(b) => { setModal(false); onOpen(b.id); }} /> : null}
      {del ? <Confirm danger title={`Delete “${del.title}”?`} confirmLabel="Delete bundle" busy={busy} onConfirm={remove} onCancel={() => setDel(null)}>The bundle and its built PDF are removed. The documents themselves stay in your library.</Confirm> : null}
    </section>
  );
}

// ── one item: edit its title / label / page selection ──────────────────────────────────────
function ItemModal({ item, onClose, onSave, onOpenDoc }) {
  const isSection = item.kind === 'section';
  const [title, setTitle] = useState(item.title || '');
  const [label, setLabel] = useState(item.label || '');
  const [pages, setPages] = useState(item.pages || '');
  const [inIndex, setInIndex] = useState(item.in_index);
  const [note, setNote] = useState(item.note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (isSection && !title.trim()) { setErr('A section needs a heading.'); return; }
    setBusy(true); setErr('');
    try { await onSave(isSection ? { title: title.trim() } : { title: title.trim(), label: label.trim(), pages: pages.trim(), in_index: inIndex, note: note.trim() }); }
    catch (ex) { setErr(ex.message || 'Could not save.'); setBusy(false); }
  };
  return (
    <Modal small title={isSection ? 'Section heading' : 'Document settings'} onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="fx-itemform" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="fx-itemform" onSubmit={submit} className="fx-form">
        <label className="dh-field"><span className="lab">{isSection ? 'Heading' : 'Name in the index'}</span>
          <input className="dh-input" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={isSection ? 'e.g. Part A — Pleadings' : (item.doc?.title || 'Document name')} />
          {!isSection ? <span className="hint">Leave empty to use the document’s own name.</span> : null}</label>
        {!isSection ? (
          <>
            <label className="dh-field"><span className="lab">Annexure label</span>
              <input className="dh-input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder={item.auto_label || 'e.g. Annexure P-3'} />
              <span className="hint">Shown in the index and on the divider sheet.</span></label>
            <label className="dh-field"><span className="lab">Only these pages</span>
              <input className="dh-input mono" value={pages} maxLength={120} onChange={(e) => setPages(e.target.value)} placeholder={item.page_count ? `all ${item.page_count} pages` : 'all pages'} />
              <span className="hint">For example <b>1-3, 5, 8-10</b>. Leave empty for the whole document.</span></label>
            <label className="dh-field"><span className="lab">Note in the index</span><input className="dh-input" value={note} maxLength={160} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. dated 12.03.2024" /></label>
            <label className="dh-check"><input type="checkbox" checked={inIndex} onChange={(e) => setInIndex(e.target.checked)} />List this document in the index</label>
            {item.doc?.id ? <p style={{ margin: '12px 0 0' }}><button type="button" className="fx-link" onClick={() => onOpenDoc(item.doc.id)}>Open the document</button></p> : null}
          </>
        ) : null}
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </form>
    </Modal>
  );
}

function SectionModal({ onClose, onSave }) {
  const [t, setT] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (!t.trim() || busy) return;
    setBusy(true); setErr('');
    try { await onSave(t.trim()); } catch (ex) { setErr(ex.message || 'Could not add it.'); setBusy(false); }
  };
  return (
    <Modal small title="Add a section heading" onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="fx-secform" className="dh-btn primary" disabled={!t.trim() || busy}>Add heading</button></>}>
      <form id="fx-secform" onSubmit={submit} className="fx-form">
        <label className="dh-field"><span className="lab">Heading</span><input className="dh-input" autoFocus value={t} maxLength={200} onChange={(e) => setT(e.target.value)} placeholder="e.g. Part A — Pleadings" />
          <span className="hint">A section heading gets its own page, in the index, to group the documents under it. It is added at the end — drag it where you want it.</span></label>
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </form>
    </Modal>
  );
}

function SaveModal({ bundle, folderIndex, onClose, onSaved }) {
  const [title, setTitle] = useState(bundle.title);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try { const r = await fx.bundleSave(bundle.id, { title: title.trim() || bundle.title, folder_id: folder ? Number(folder) : null }); onSaved(r.doc); }
    catch (ex) { setErr(ex.message || 'Could not save it.'); setBusy(false); }
  };
  return (
    <Modal small title="Save to the library" onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="fx-saveform" className="dh-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save to library'}</button></>}>
      <form id="fx-saveform" onSubmit={submit} className="fx-form">
        <p className="fx-note">The finished PDF becomes a document in your library{bundle.case_label ? <>, filed on <b>{bundle.case_label}</b></> : ''} — searchable like any other.</p>
        <label className="dh-field"><span className="lab">Name</span><input className="dh-input" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="dh-field"><span className="lab">Folder</span>
          <select className="dh-select" value={folder} onChange={(e) => setFolder(e.target.value)}><option value="">No folder</option>{(folderIndex?.options || []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </form>
    </Modal>
  );
}

// ── the builder ────────────────────────────────────────────────────────────────────────────
function Opt({ label, children, hint }) { return <label className="dh-field"><span className="lab">{label}</span>{children}{hint ? <span className="hint">{hint}</span> : null}</label>; }

function Builder({ id, onBack, onOpenDoc, toast, folderIndex }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState('');
  const [opts, setOpts] = useState(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const [edit, setEdit] = useState(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [problems, setProblems] = useState(null);
  const [nameEdit, setNameEdit] = useState(null);
  const optsSeq = useRef(0);
  const dirtyOpts = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const apply = useCallback((bundle, keepOpts) => {
    setB(bundle);
    if (!keepOpts || !dirtyOpts.current) setOpts(bundle.options);
  }, []);
  useEffect(() => {
    setB(null); setErr('');
    fx.bundle(id).then((x) => { apply(x.bundle || x); }).catch((e) => setErr(e.message || 'Could not open this bundle.'));
  }, [id, apply]);

  // while the PDF is being made, watch it
  const building = b?.build?.state === 'building';
  useEffect(() => {
    if (!building) return undefined;
    let dead = false;
    (async () => {
      while (!dead) {
        await sleep(1200);
        if (dead || !alive.current) return;
        try {
          const x = await fx.bundle(id);
          if (dead) return;
          apply(x.bundle || x, true);
          if ((x.bundle || x).build.state !== 'building') return;
        } catch { /* try again */ }
      }
    })();
    return () => { dead = true; };
  }, [building, id, apply]);

  // options autosave (debounced)
  const dOpts = useDebounced(opts, 700);
  useEffect(() => {
    if (!dOpts || !dirtyOpts.current) return;
    const seq = (optsSeq.current += 1);
    fx.bundleEdit(id, { options: dOpts }).then((r) => {
      if (seq !== optsSeq.current || !alive.current) return;
      const nb = r.bundle || r;
      if (nb?.items) setB((cur) => (cur ? { ...cur, estimate: nb.estimate, build: nb.build } : cur));
      dirtyOpts.current = false;
    }).catch((e) => toast(e.message || 'Could not save the settings.', { tone: 'bad' }));
  }, [dOpts]); // eslint-disable-line react-hooks/exhaustive-deps
  const setOpt = (k, v) => { dirtyOpts.current = true; setOpts((o) => ({ ...o, [k]: v })); };

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (r?.bundle) apply(r.bundle, true); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
    catch (e) { toast(e.message || 'That did not work.', { tone: 'bad' }); return null; }
    finally { setBusy(false); }
  };

  const items = b?.items || [];
  const lock = busy || building;
  const reorder = async (from, to) => {
    if (from === to || from < 0 || to < 0 || to >= items.length || lock) return;
    const next = items.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    const prev = b;
    setB({ ...b, items: next.map((x, i) => ({ ...x, seq: i + 1 })) });
    try { const r = await fx.bundleOrder(id, next.map((x) => x.id)); apply(r.bundle, true); }
    catch (e) { setB(prev); toast(e.message || 'Could not change the order.', { tone: 'bad' }); }
  };
  const addDocs = async (ids) => { setModal(null); await run(() => fx.bundleAdd(id, { doc_ids: ids }), (r) => `Added ${plural(r.added ?? ids.length, 'document')}${r.skipped ? ` · ${r.skipped} skipped` : ''}`); };
  const addSection = async (title) => { const r = await fx.bundleAdd(id, { kind: 'section', title }); apply(r.bundle, true); setModal(null); toast('Heading added at the end — drag it into place'); };
  const saveItem = async (item, body) => { const r = await fx.bundleItem(id, item.id, body); apply(r.bundle, true); setEdit(null); };
  const remove = (item) => run(() => fx.bundleRemoveItem(id, item.id), 'Removed from the bundle');
  const takeLatest = (item) => run(() => fx.bundleItem(id, item.id, { use_latest: true }), `Now using version ${item.newer?.version}`);
  const autoOrder = (by) => run(() => fx.bundleAutoOrder(id, by), 'Arranged');
  const rename = async () => {
    const t = (nameEdit || '').trim();
    setNameEdit(null);
    if (!t || t === b.title) return;
    await run(() => fx.bundleEdit(id, { title: t }).then((r) => ({ bundle: r.bundle || { ...b, title: t } })), null);
  };
  const setCase = (ref, c) => run(() => fx.bundleEdit(id, { case_ref: ref || null }).then(async (r) => { const x = r.bundle || (await fx.bundle(id)).bundle; return { bundle: x, c }; }), ref ? 'Linked to the case' : 'Unlinked from the case');
  const build = async () => {
    setProblems(null);
    setBusy(true);
    try { dirtyOpts.current = false; await fx.bundleEdit(id, { options: opts }); const r = await fx.bundleBuild(id); apply(r.bundle, true); }
    catch (e) { if (e.extra?.problems) setProblems(e.extra.problems); toast(e.message || 'Could not build the bundle.', { tone: 'bad' }); }
    finally { setBusy(false); }
  };
  const preview = async () => { try { openPdf(await fx.bundlePdf(id), `${b.title}.pdf`); } catch (e) { toast(e.message, { tone: 'bad' }); } };
  const download = () => fx.bundleDownload(id, `${b.title}.pdf`).catch((e) => toast(e.message, { tone: 'bad' }));

  if (err) return <section className="fx-section"><button type="button" className="dh-btn ghost sm" onClick={onBack}><Icon name="back" />All bundles</button><div className="dh-errbox" role="alert" style={{ marginTop: 14 }}><Icon name="alert" /><div className="body">{err}</div></div></section>;
  if (!b || !opts) return <section className="fx-section"><Spinner label="Opening the bundle…" /></section>;

  const est = b.estimate;
  const bad = est.problems;
  const bs = b.build;
  const docItems = items.filter((i) => i.kind === 'doc');
  const hasSections = items.some((i) => i.kind === 'section');

  return (
    <section className="fx-section" aria-label="Bundle builder">
      <div className="fx-bhead">
        <button type="button" className="dh-btn quiet sm" onClick={onBack}><Icon name="back" />All bundles</button>
        <div className="ttl">
          {nameEdit !== null ? (
            <input className="dh-input" autoFocus value={nameEdit} maxLength={160} onChange={(e) => setNameEdit(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setNameEdit(null); }} aria-label="Bundle name" />
          ) : (
            <h2 className="fx-h" title="Click to rename"><button type="button" onClick={() => setNameEdit(b.title)}>{b.title}<Icon name="edit" size={13} /></button></h2>
          )}
          <CasePicker compact value={b.case_ref || ''} label={b.case_label} allowNone noneLabel="Not linked to a case" placeholder="Link to a case" disabled={lock} onChange={setCase} />
        </div>
      </div>

      <div className="fx-bgridwrap">
        <div className="fx-bmain">
          <div className="fx-btools">
            <button type="button" className="dh-btn primary sm" disabled={lock} onClick={() => setModal('docs')}><Icon name="plus" />Add documents</button>
            <button type="button" className="dh-btn ghost sm" disabled={lock} onClick={() => setModal('section')}><Icon name="sections" />Add heading</button>
            <Menu icon="sort" label="Arrange" className="dh-btn ghost sm" disabled={lock || items.length < 2 || hasSections} title={hasSections ? 'Remove the section headings to arrange automatically' : undefined}>
              {(close) => (
                <>
                  <button type="button" role="menuitem" onClick={() => { close(); autoOrder('date'); }}>By document date, oldest first</button>
                  <button type="button" role="menuitem" onClick={() => { close(); autoOrder('type'); }}>By type (pleadings, orders, evidence…)</button>
                  <button type="button" role="menuitem" onClick={() => { close(); autoOrder('name'); }}>By name, A to Z</button>
                  <button type="button" role="menuitem" onClick={() => { close(); autoOrder('added'); }}>By the day they were added</button>
                </>
              )}
            </Menu>
            <span className="sp" />
            <span className="mut">{plural(docItems.length, 'document')}{hasSections ? ` · ${plural(items.length - docItems.length, 'heading')}` : ''}</span>
          </div>

          {!items.length ? (
            <EmptyState icon="bundle" title="This bundle is empty" actions={<button type="button" className="dh-btn primary" onClick={() => setModal('docs')}><Icon name="plus" />Add documents</button>}>Add the documents in any order — you can drag them into place afterwards.</EmptyState>
          ) : (
            <ol className="fx-items" aria-label="Documents in this bundle, in order">
              {items.map((it, i) => {
                const isSec = it.kind === 'section';
                const d = it.doc;
                const name = it.title || it.title_default || d?.title || 'Untitled';
                return (
                  <li key={it.id} className={`fx-item${isSec ? ' sec' : ''}${it.problem ? ' bad' : ''}${drag === i ? ' dragging' : ''}${over === i && drag !== null && drag !== i ? ' over' : ''}`}
                    draggable={!lock} onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(it.id)); } catch { /* old browsers */ } }}
                    onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(i); } }} onDragLeave={() => setOver((o) => (o === i ? null : o))}
                    onDrop={(e) => { e.preventDefault(); const from = drag; setDrag(null); setOver(null); if (from !== null) reorder(from, i); }} onDragEnd={() => { setDrag(null); setOver(null); }}>
                    <span className="grip" aria-hidden="true"><Icon name="grip" /></span>
                    <span className="no mono">{i + 1}</span>
                    <div className="body">
                      {isSec ? <div className="nm sec"><Icon name="sections" />{name}</div> : (
                        <>
                          <button type="button" className="nm" onClick={() => setEdit(it)} title="Change its name, label or pages">{name}</button>
                          <div className="meta">
                            {(it.label || it.auto_label) ? <span className="dh-chip">{it.label || it.auto_label}</span> : null}
                            {d?.doc_class && d.doc_class !== 'Unclassified' ? <span className="dh-chip">{d.doc_class}</span> : null}
                            <span className="mut">{it.pages ? `pages ${it.pages} (${it.pages_selected ?? '?'})` : it.page_count ? plural(it.page_count, 'page') : 'pages unknown'}{d?.version > 1 ? ` · v${d.version}` : ''}{!it.in_index ? ' · not in index' : ''}</span>
                          </div>
                        </>
                      )}
                      {it.problem ? <div className="why bad"><Icon name="alert" />{it.problem}</div> : null}
                      {!it.problem && it.warning ? <div className="why"><Icon name="info" />{it.warning}</div> : null}
                      {it.newer ? <div className="why"><Icon name="info" />A newer version (v{it.newer.version}) exists. <button type="button" className="fx-link" disabled={lock} onClick={() => takeLatest(it)}>Use the newer version</button></div> : null}
                    </div>
                    <div className="acts">
                      <button type="button" className="dh-ibtn" aria-label={`Move ${name} up`} title="Move up" disabled={lock || i === 0} onClick={() => reorder(i, i - 1)}><Icon name="arrowUp" /></button>
                      <button type="button" className="dh-ibtn" aria-label={`Move ${name} down`} title="Move down" disabled={lock || i === items.length - 1} onClick={() => reorder(i, i + 1)}><Icon name="arrowDown" /></button>
                      <button type="button" className="dh-ibtn" aria-label={`Settings for ${name}`} title="Settings" disabled={lock} onClick={() => setEdit(it)}><Icon name="edit" /></button>
                      <button type="button" className="dh-ibtn" aria-label={`Remove ${name}`} title="Remove from the bundle" disabled={lock} onClick={() => remove(it)}><Icon name="close" /></button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <aside className="fx-bside" aria-label="Bundle settings and PDF">
          <div className="fx-card">
            <h3 className="fx-h3">The PDF</h3>
            <dl className="fx-est">
              <div><dt>Documents</dt><dd>{fmtNum(est.documents)}</dd></div>
              <div><dt>Total pages</dt><dd>{est.unknown_pages ? `${fmtNum(est.total_pages)}+` : fmtNum(est.total_pages)}</dd></div>
              <div><dt>Index pages</dt><dd>{fmtNum(est.index_pages)}</dd></div>
            </dl>
            {est.unknown_pages ? <p className="fx-note">{plural(est.unknown_pages, 'document')} still being read, so the page count is a minimum.</p> : null}
            {bad ? <p className="fx-err"><Icon name="alert" />{plural(bad, 'item')} cannot go in the bundle yet — see the red lines on the left.</p> : null}
            {problems ? <ul className="fx-plist2">{problems.map((p, i) => <li key={i}><b>{p.item}</b> — {p.problem}</li>)}</ul> : null}
            {!b.converter && docItems.some((i) => /^(docx?|xlsx?|pptx?|odt|rtf)$/i.test(i.doc?.ext || '')) ? <p className="fx-note">This server cannot turn Word or Excel files into pages. Save those as PDF first.</p> : null}

            {building ? (
              <div className="fx-building" role="status"><div className="dh-bar thick"><i style={{ width: `${Math.max(4, bs.progress || 0)}%` }} /></div><span>Making your PDF… {bs.progress ? `${bs.progress}%` : ''}</span></div>
            ) : (
              <button type="button" className="dh-btn primary block" disabled={lock || !docItems.length || bad > 0} onClick={build}>
                <Icon name="bundle" />{bs.state === 'done' ? (bs.stale ? 'Build again' : 'Rebuild') : 'Build the PDF'}
              </button>
            )}

            {bs.state === 'failed' ? <div className="dh-banner rust" role="alert" style={{ marginTop: 12 }}><Icon name="alert" /><div className="body"><b>The PDF could not be made.</b> {bs.note || 'Please try again.'}
              {bs.problems?.length ? <ul className="fx-plist2">{bs.problems.map((p, i) => <li key={i}><b>{p.item}</b> — {p.problem}</li>)}</ul> : null}</div></div> : null}
            {bs.state === 'done' ? (
              <div className={`fx-done${bs.stale ? ' stale' : ''}`}>
                <div className="line"><Icon name={bs.stale ? 'alert' : 'checkCircle'} /><b>{bs.stale ? 'Out of date' : 'Ready'}</b><span className="mut">{plural(bs.pages, 'page')} · {fmtBytes(bs.size)} · {fmtAgo(bs.built_at)}</span></div>
                {bs.stale ? <p className="fx-note">The documents or settings changed after this PDF was made. Build again to bring it up to date.</p> : null}
                {(bs.warnings || []).length ? <ul className="fx-plist2 warn">{bs.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
                <div className="row">
                  <button type="button" className="dh-btn ghost sm" onClick={preview}><Icon name="eye" />Open</button>
                  <button type="button" className="dh-btn ghost sm" onClick={download}><Icon name="download" />Download</button>
                  <button type="button" className="dh-btn ghost sm" onClick={() => setModal('save')} disabled={!!bs.saved_doc_id && !bs.stale} title={bs.saved_doc_id ? 'Already saved' : undefined}><Icon name="disk" />{bs.saved_doc_id ? 'Saved' : 'Save to library'}</button>
                </div>
                {bs.saved_doc_id ? <button type="button" className="fx-link" onClick={() => onOpenDoc(bs.saved_doc_id)}>Open the saved copy in the library</button> : null}
              </div>
            ) : null}
          </div>

          <div className="fx-card">
            <h3 className="fx-h3">Cover sheet</h3>
            <label className="dh-check"><input type="checkbox" checked={opts.cover} onChange={(e) => setOpt('cover', e.target.checked)} />Add a cover sheet</label>
            {opts.cover ? (
              <div className="fx-optgrid">
                <Opt label="Court"><input className="dh-input" value={opts.court} maxLength={160} onChange={(e) => setOpt('court', e.target.value)} placeholder="e.g. High Court of Delhi" /></Opt>
                <Opt label="Case title"><input className="dh-input" value={opts.case_title} maxLength={200} onChange={(e) => setOpt('case_title', e.target.value)} placeholder="e.g. Sharma v. Verma" /></Opt>
                <Opt label="Case number"><input className="dh-input" value={opts.case_no} maxLength={80} onChange={(e) => setOpt('case_no', e.target.value)} placeholder="e.g. W.P.(C) 1234/2024" /></Opt>
                <Opt label="Heading under the title"><input className="dh-input" value={opts.subtitle} maxLength={80} onChange={(e) => setOpt('subtitle', e.target.value)} placeholder="Paper Book" /></Opt>
                <Opt label="Filed by"><input className="dh-input" value={opts.filed_by} maxLength={160} onChange={(e) => setOpt('filed_by', e.target.value)} placeholder="Advocate’s name and enrolment no." /></Opt>
                <Opt label="Filed for"><input className="dh-input" value={opts.filed_for} maxLength={160} onChange={(e) => setOpt('filed_for', e.target.value)} placeholder="e.g. the Petitioner" /></Opt>
                <Opt label="Date"><span className="fx-inline"><input className="dh-input" value={opts.date} maxLength={40} onChange={(e) => setOpt('date', e.target.value)} placeholder="e.g. 14 October 2026" /><button type="button" className="dh-btn ghost sm" onClick={() => setOpt('date', today())}>Today</button></span></Opt>
              </div>
            ) : null}
          </div>

          <div className="fx-card">
            <h3 className="fx-h3">Index and labels</h3>
            <label className="dh-check"><input type="checkbox" checked={opts.index} onChange={(e) => setOpt('index', e.target.checked)} />Add an index with page numbers</label>
            {opts.index ? <Opt label="Index heading"><input className="dh-input" value={opts.index_title} maxLength={40} onChange={(e) => setOpt('index_title', e.target.value)} /></Opt> : null}
            <label className="dh-check" style={{ marginTop: 10 }}><input type="checkbox" checked={opts.dividers} onChange={(e) => setOpt('dividers', e.target.checked)} />A divider sheet before every document</label>
            <label className="dh-check" style={{ marginTop: 10 }}><input type="checkbox" checked={opts.auto_label} onChange={(e) => setOpt('auto_label', e.target.checked)} />Number the documents as annexures</label>
            {opts.auto_label ? (
              <div className="fx-optgrid three">
                <Opt label="Starts with"><input className="dh-input" value={opts.label_prefix} maxLength={30} onChange={(e) => setOpt('label_prefix', e.target.value)} /></Opt>
                <Opt label="Style"><select className="dh-select" value={opts.label_style} onChange={(e) => setOpt('label_style', e.target.value)}><option value="number">1, 2, 3</option><option value="alpha">A, B, C</option><option value="roman">I, II, III</option></select></Opt>
                <Opt label="First number"><input className="dh-input" inputMode="numeric" value={opts.label_start} onChange={(e) => setOpt('label_start', e.target.value.replace(/[^\d]/g, '').slice(0, 4) || 1)} /></Opt>
              </div>
            ) : null}
          </div>

          <div className="fx-card">
            <h3 className="fx-h3">Page numbers</h3>
            <div className="fx-optgrid">
              <Opt label="Where"><select className="dh-select" value={opts.pagination} onChange={(e) => setOpt('pagination', e.target.value)}>{PAGINATION.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Opt>
              {opts.pagination !== 'none' ? <Opt label="How it reads"><select className="dh-select" value={opts.number_format} onChange={(e) => setOpt('number_format', e.target.value)}>{NUMBER_FORMATS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Opt> : null}
              {opts.pagination !== 'none' ? <Opt label="First page is number" hint="The cover and index are not numbered."><input className="dh-input" inputMode="numeric" value={opts.start_at} onChange={(e) => setOpt('start_at', e.target.value.replace(/[^\d]/g, '').slice(0, 5) || 1)} /></Opt> : null}
            </div>
          </div>
        </aside>
      </div>

      {modal === 'docs' ? <DocPickerModal title="Add documents to the bundle" confirmLabel="Add" caseRef={b.case_ref} exclude={docItems.map((i) => i.doc?.id).filter(Boolean)} busy={busy} onClose={() => setModal(null)} onConfirm={addDocs} /> : null}
      {modal === 'section' ? <SectionModal onClose={() => setModal(null)} onSave={addSection} /> : null}
      {modal === 'save' ? <SaveModal bundle={b} folderIndex={folderIndex} onClose={() => setModal(null)} onSaved={(doc) => { setModal(null); toast('Saved to your library', { action: { label: 'Open', run: () => onOpenDoc(doc.id) } }); fx.bundle(id).then((x) => apply(x.bundle || x, true)); }} /> : null}
      {edit ? <ItemModal item={edit} onClose={() => setEdit(null)} onSave={(body) => saveItem(edit, body)} onOpenDoc={onOpenDoc} /> : null}
    </section>
  );
}

export function Bundles({ bundleId, onBundleId, caseRef, caseLabel, onGoCase, ...rest }) {
  if (bundleId) return <Builder id={bundleId} onBack={() => onBundleId(null)} {...rest} />;
  return <BundleList caseRef={caseRef} caseLabel={caseLabel} onOpen={onBundleId} onGoCase={onGoCase} toast={rest.toast} />;
}

// ── "Add to a bundle" from the library (one document or a selection) ────────────────────────
export function AddToBundleModal({ docIds, caseRef, onClose, onDone, toast }) {
  const [list, setList] = useState(null);
  const [pick, setPick] = useState('new');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    fx.bundles().then((r) => { setList(r.bundles); if (r.bundles.length) setPick(String(r.bundles[0].id)); }).catch((e) => { setList([]); setErr(e.message); });
  }, []);
  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    if (pick === 'new' && !title.trim()) { setErr('Name the new bundle.'); return; }
    setBusy(true); setErr('');
    try {
      if (pick === 'new') { const r = await fx.bundleCreate({ title: title.trim(), case_ref: caseRef || null, doc_ids: docIds }); onDone(r.bundle.id, `Bundle “${r.bundle.title}” created with ${plural(r.bundle.estimate.documents, 'document')}`); }
      else { const r = await fx.bundleAdd(Number(pick), { doc_ids: docIds }); onDone(Number(pick), `Added ${plural(r.added, 'document')}${r.skipped ? ` · ${r.skipped} skipped` : ''}`); }
    } catch (ex) { setErr(ex.message || 'Could not add them.'); setBusy(false); toast?.(ex.message, { tone: 'bad' }); }
  };
  return (
    <Modal small title={`Add ${plural(docIds.length, 'document')} to a bundle`} onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="dh-btn ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="fx-addbundle" className="dh-btn primary" disabled={busy || list === null}>{busy ? 'Adding…' : 'Add'}</button></>}>
      <form id="fx-addbundle" onSubmit={submit} className="fx-form">
        {list === null ? <Spinner label="Loading your bundles…" /> : (
          <>
            <label className="dh-field"><span className="lab">Bundle</span>
              <select className="dh-select" value={pick} onChange={(e) => setPick(e.target.value)}>
                {list.map((b) => <option key={b.id} value={b.id}>{b.title}{b.case_label ? ` — ${b.case_label}` : ''}</option>)}
                <option value="new">＋ A new bundle…</option>
              </select></label>
            {pick === 'new' ? <label className="dh-field"><span className="lab">Name of the new bundle</span><input className="dh-input" autoFocus value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Paper book for hearing on 14 Oct" /></label> : null}
          </>
        )}
        {err ? <p role="alert" className="fx-err">{err}</p> : null}
      </form>
    </Modal>
  );
}
