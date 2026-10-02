// "To file": documents the hub has read but that are not on a case yet. One suggestion per document, with the reasons in plain
// words; one click files it. Anything the hub is certain about is filed automatically (and can be undone from here).
import { useCallback, useEffect, useRef, useState } from 'react';
import { CasePicker } from './FilesCommon.jsx';
import { fx } from './filesApi.js';
import { fmtAgo, fmtNum, plural } from './format.js';
import { Icon } from './icons.jsx';
import { Pager } from './DocList.jsx';
import { Confirm, EmptyState } from './ui.jsx';

const PER = 20;
const SUBS = [
  { id: 'pending', label: 'Suggestions', key: 'pending' },
  { id: 'nomatch', label: 'No match found', key: 'nomatch' },
  { id: 'filed', label: 'Filed recently', key: 'auto_recent' },
  { id: 'dismissed', label: 'Set aside', key: null },
];

const confidenceWord = (s) => (s >= 0.82 ? 'Very likely' : s >= 0.6 ? 'Likely' : 'Possible');

function Row({ item, state, busy, onFile, onSkip, onOpen, onUndo, onBack }) {
  const d = item.doc;
  const top = item.candidates?.[0];
  const others = (item.candidates || []).slice(1);
  const [other, setOther] = useState(false);
  const nums = (d.case_numbers || []).slice(0, 2);
  return (
    <article className={`fx-fcard${busy ? ' busy' : ''}`} data-doc-id={d.id}>
      <div className="doc">
        <button type="button" className="ttl" onClick={() => onOpen(d.id)} title="Open this document">
          <Icon name="doc" />
          <span className="nm">{d.title}</span>
        </button>
        <div className="meta">
          {d.doc_class && d.doc_class !== 'Unclassified' ? <span className="dh-chip class">{d.doc_class}</span> : null}
          {nums.map((n) => <span key={n} className="dh-chip">{n}</span>)}
          <span className="mut">{d.page_count ? plural(d.page_count, 'page') : '—'} · added {fmtAgo(d.created_at)}</span>
        </div>
      </div>

      <div className="sug">
        {state === 'pending' && top ? (
          <>
            <div className="top">
              <span className={`conf${item.confident ? ' sure' : ''}`}>{item.confident ? 'Certain' : confidenceWord(top.score)}</span>
              <span className="case">{top.label}</span>
            </div>
            <ul className="why">{(top.reasons || []).slice(0, 3).map((r) => <li key={r}>{r}</li>)}</ul>
            {others.length ? (
              <div className="alt"><span className="mut">Or:</span>
                {others.map((o) => <button key={o.ref} type="button" className="dh-chip btn" disabled={busy} onClick={() => onFile(d.id, o.ref, o.label)} title={(o.reasons || [])[0]}>{o.label}</button>)}
              </div>
            ) : null}
          </>
        ) : null}
        {state === 'nomatch' ? <p className="none">No open case matches this document. Choose one yourself, or leave it for now.</p> : null}
        {state === 'filed' && item.filed ? (
          <div className="top"><span className="conf sure">Filed</span><span className="case">{item.filed.label}</span>
            <span className="mut">{item.filed.via === 'auto' ? 'automatically' : item.filed.via === 'bulk' ? 'in bulk' : 'by you'} · {fmtAgo(item.filed.at)}</span></div>
        ) : null}
        {state === 'dismissed' ? <p className="none">You set this aside. It stays in the library, just not in this queue.</p> : null}
      </div>

      <div className="acts">
        {state === 'pending' && top ? <button type="button" className="dh-btn primary sm" disabled={busy} onClick={() => onFile(d.id, top.ref, top.label)}><Icon name="check" />File here</button> : null}
        {(state === 'pending' || state === 'nomatch') ? (
          other ? (
            <CasePicker compact defaultOpen up={false} placeholder="Pick the case…" onChange={(ref, c) => { setOther(false); if (ref) onFile(d.id, ref, c?.title); }} />
          ) : (
            <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => setOther(true)}>{top ? 'Another case…' : 'Choose a case…'}</button>
          )
        ) : null}
        {(state === 'pending' || state === 'nomatch') ? <button type="button" className="dh-btn quiet sm" disabled={busy} onClick={() => onSkip(d.id)} title="Leave it out of this queue">Not now</button> : null}
        {state === 'filed' ? <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => onUndo(d.id)}><Icon name="undo" />Undo</button> : null}
        {state === 'dismissed' ? <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => onBack(d.id)}>Bring back</button> : null}
      </div>
    </article>
  );
}

export function FilingQueue({ summary, onSummary, toast, onOpenDoc, onChanged, onGo }) {
  const [sub, setSub] = useState('pending');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [tick, setTick] = useState(0);
  const req = useRef(0);

  const sum = summary || {};
  const load = useCallback((silent) => {
    const id = (req.current += 1);
    const ctrl = new AbortController();
    if (!silent) setData((d) => (d && d.state === sub ? d : null));
    fx.filing(sub, page, PER, ctrl.signal).then((r) => {
      if (id !== req.current) return;
      if (!r.items.length && r.total > 0 && page > 1) { setPage(Math.ceil(r.total / PER)); return; }
      setData(r); setErr('');
      onSummary?.(r.summary);
    }).catch((e) => { if (e?.name === 'AbortError' || id !== req.current) return; setErr(e.message || 'Could not load the queue.'); });
    return () => ctrl.abort();
  }, [sub, page, onSummary]);

  useEffect(() => load(false), [load, tick]);
  // documents are still being read in the background: look again every few seconds so new suggestions appear by themselves
  const reading = sum.reading || 0;
  useEffect(() => {
    if (!reading) return undefined;
    const t = setInterval(() => { if (!document.hidden) setTick((x) => x + 1); }, 5000);
    return () => clearInterval(t);
  }, [reading]);

  const mark = (id, on) => setBusyIds((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const drop = (id) => setData((d) => (d ? { ...d, items: d.items.filter((x) => x.doc.id !== id), total: Math.max(0, d.total - 1) } : d));

  const act = async (id, fn, after) => {
    mark(id, true);
    try { const r = await fn(); drop(id); if (r?.summary) onSummary?.(r.summary); after?.(r); onChanged?.(); setTick((x) => x + 1); }
    catch (e) { toast(e.message || 'That did not work.', { tone: 'bad' }); setTick((x) => x + 1); }
    finally { mark(id, false); }
  };
  const fileOne = (id, ref, label) => act(id, () => fx.fileConfirm(id, ref), (r) => toast(`Filed on ${r.label || label || 'the case'}`, {
    action: { label: 'Undo', run: () => fx.fileUndo(id).then((u) => { onSummary?.(u.summary); toast('Moved back'); onChanged?.(); setTick((x) => x + 1); }).catch((e) => toast(e.message, { tone: 'bad' })) } }));
  const skip = (id) => act(id, () => fx.fileDismiss(id), () => toast('Set aside', { action: { label: 'Undo', run: () => fx.fileReopen(id).then((u) => { onSummary?.(u.summary); setTick((x) => x + 1); }).catch((e) => toast(e.message, { tone: 'bad' })) } }));
  const undo = (id) => act(id, () => fx.fileUndo(id), () => toast('Moved back out of the case'));
  const back = (id) => act(id, () => fx.fileReopen(id), () => toast('Back in the queue'));

  const doAll = async () => {
    setBulkBusy(true);
    try {
      const r = await fx.fileAllConfident();
      onSummary?.(r.summary);
      toast(`Filed ${plural(r.filed, 'document')}${r.skipped?.length ? ` · ${r.skipped.length} skipped — ${r.skipped[0].reason}` : ''}`, r.filed ? {} : { tone: 'bad' });
      onChanged?.(); setTick((x) => x + 1);
    } catch (e) { toast(e.message, { tone: 'bad' }); }
    finally { setBulkBusy(false); setConfirmAll(false); }
  };
  const toggleAuto = async () => {
    try { const r = await fx.setAutoFile(!sum.auto_file); onSummary?.({ ...sum, auto_file: r.auto_file }); toast(r.auto_file ? 'New documents that match with certainty will be filed for you.' : 'Nothing will be filed without your click.'); }
    catch (e) { toast(e.message, { tone: 'bad' }); }
  };

  const items = data && data.state === sub ? data.items : null;
  const total = data && data.state === sub ? data.total : 0;
  const empty = {
    pending: ['inbox', 'Nothing is waiting to be filed', 'Documents you import appear here with a suggested case. Anything on a case already is not listed.'],
    nomatch: ['search', 'Every document found a suggestion', 'Documents with no matching case would be listed here.'],
    filed: ['check', 'Nothing filed in the last two weeks', 'Documents filed from this queue show here for 14 days, so you can undo a mistake.'],
    dismissed: ['inbox', 'Nothing set aside', 'Documents you choose “Not now” for are kept here.'],
  }[sub];

  return (
    <section className="fx-section" aria-label="To file">
      <div className="fx-intro">
        <div>
          <h2 className="fx-h">Put each document on its case</h2>
          <p className="fx-lead">The hub reads every document and matches it to a case from the case number, party names and court. You only confirm — one click per document, or one click for all the certain ones.</p>
        </div>
        <div className="fx-introacts">
          <label className="dh-check" title="Only documents with a case number and one more matching detail are ever filed without you"><input type="checkbox" checked={!!sum.auto_file} onChange={toggleAuto} />File certain matches automatically</label>
          {(sum.confident || 0) > 0 ? <button type="button" className="dh-btn primary" disabled={bulkBusy} onClick={() => setConfirmAll(true)}><Icon name="check" />File all {fmtNum(sum.confident)} certain</button> : null}
        </div>
      </div>

      {reading > 0 ? <div className="dh-reading" role="status"><Icon name="refresh" className="dh-spin" /><span>Still reading <b style={{ color: 'var(--ink)' }}>{fmtNum(reading)}</b> document{reading === 1 ? '' : 's'}. Suggestions appear here as each one is finished.</span></div> : null}

      <div className="fx-subtabs" role="tablist" aria-label="Queues">
        {SUBS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={sub === s.id} className={`fx-subtab${sub === s.id ? ' on' : ''}`} onClick={() => { setSub(s.id); setPage(1); }}>
            {s.label}{s.key && sum[s.key] ? <span className="ct">{fmtNum(sum[s.key])}</span> : null}
          </button>
        ))}
      </div>

      {err ? <div className="dh-errbox" role="alert"><Icon name="alert" /><div className="body">{err}</div><button type="button" className="dh-btn ghost sm" onClick={() => setTick((x) => x + 1)}>Try again</button></div> : null}
      {!items && !err ? <div className="fx-skel" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="dh-skel" style={{ animationDelay: `${i * 80}ms` }}><i /></div>)}</div> : null}
      {items && !items.length ? (
        <EmptyState icon={empty[0]} title={empty[1]}
          actions={sub === 'pending' ? <><button type="button" className="dh-btn primary" onClick={() => onGo('scan')}><Icon name="camera" />Scan paper documents</button><button type="button" className="dh-btn ghost" onClick={() => onGo('library', { import: 1 })}><Icon name="upload" />Import files</button></> : null}>
          {empty[2]}
        </EmptyState>
      ) : null}
      {items && items.length ? (
        <div className="fx-flist">
          {items.map((it) => <Row key={it.doc.id} item={it} state={sub} busy={busyIds.has(it.doc.id)} onFile={fileOne} onSkip={skip} onOpen={onOpenDoc} onUndo={undo} onBack={back} />)}
        </div>
      ) : null}
      <Pager page={page} perPage={PER} total={total} onPage={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />

      {confirmAll ? (
        <Confirm title={`File ${plural(sum.confident, 'document')}?`} confirmLabel="File them" busy={bulkBusy} onConfirm={doAll} onCancel={() => setConfirmAll(false)}>
          Each document goes to the case the hub is certain about (the case number and another detail both agree). You can undo any of them from “Filed recently” for 14 days.
        </Confirm>
      ) : null}
    </section>
  );
}
