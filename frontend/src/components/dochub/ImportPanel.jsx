import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './icons.jsx';
import { Modal } from './ui.jsx';
import { fmtBytes, fmtDuration, fmtNum } from './format.js';
import { fromInput, grabDrop, uploader } from './uploader.js';

export function useUploader() {
  return useSyncExternalStore(uploader.subscribe, uploader.getSnapshot);
}

const STATUS_ICON = { queued: 'inbox', retry: 'refresh', sending: 'refresh', stored: 'check', dup: 'copy', failed: 'alert', skipped: 'minus' };
const STATUS_TEXT = { queued: 'Waiting', retry: 'Retrying', sending: 'Sending', stored: 'Added', dup: 'Duplicate', failed: 'Not added', skipped: 'Skipped' };
const tone = (s) => (s === 'failed' ? 'bad' : s === 'dup' || s === 'skipped' ? 'warn' : s === 'stored' ? 'done' : '');

// Shared by the drop zone and the page-wide drop overlay.
export function useFileIntake(destination, { onScanning } = {}) {
  return useMemo(() => ({
    fromPicker(list) {
      const files = fromInput(list);
      return uploader.add(files, destination);
    },
    async fromDrop(dt) {
      const collect = grabDrop(dt);
      onScanning?.(0);
      try {
        const files = await collect((n) => onScanning?.(n));
        return uploader.add(files, destination);
      } finally {
        onScanning?.(null);
      }
    },
  }), [destination, onScanning]);
}

export function ImportPanel({ config, folderIndex, matters, defaultFolderId, defaultMatterId, onClose, onViewBatch, onReview, onCreateFolder }) {
  const snap = useUploader();
  const [folderId, setFolderId] = useState(defaultFolderId ? String(defaultFolderId) : '');
  const [matterId, setMatterId] = useState(defaultMatterId ? String(defaultMatterId) : '');
  const [over, setOver] = useState(false);
  const [scanning, setScanning] = useState(null);
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const fileIn = useRef(null);
  const dirIn = useRef(null);
  const locked = snap.active > 0;

  const dest = useMemo(() => ({ folderId: folderId ? Number(folderId) : null, matterId: matterId ? Number(matterId) : null }), [folderId, matterId]);
  useEffect(() => { if (!locked) uploader.setDestination(dest); }, [dest, locked]);
  const intake = useFileIntake(dest, { onScanning: setScanning });

  const report = (r) => {
    if (!r) return;
    const bits = [];
    if (r.added) bits.push(`${fmtNum(r.added)} queued`);
    if (r.rejected) bits.push(`${fmtNum(r.rejected)} can't be added (see the list)`);
    if (r.skipped) bits.push(`${fmtNum(r.skipped)} system file${r.skipped === 1 ? '' : 's'} ignored`);
    setNotice(r.added || r.rejected || r.skipped ? bits.join(' · ') : 'No files found there.');
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setOver(false);
    if (!e.dataTransfer) return;
    report(await intake.fromDrop(e.dataTransfer));
  };
  const picked = (e) => {
    const list = e.target.files;
    if (list && list.length) report(intake.fromPicker(list));
    e.target.value = '';
  };

  const c = snap.counts;
  const finished = c.stored + c.dup + c.failed + c.skipped;
  const pct = snap.total ? Math.round((finished / snap.total) * 100) : 0;
  const elapsed = snap.startedAt ? (Date.now() - snap.startedAt) / 1000 : 0;
  const sentCount = c.stored + c.dup;
  const rate = elapsed > 3 && sentCount ? sentCount / elapsed : 0;
  const eta = rate && snap.active ? fmtDuration(snap.active / rate) : '';
  const bi = snap.batchInfo;
  const readPct = bi && bi.total ? Math.round((bi.done / bi.total) * 100) : 0;

  const list = useMemo(() => {
    const pick = { all: () => true, active: (i) => ['queued', 'retry', 'sending'].includes(i.status), sent: (i) => i.status === 'stored', dup: (i) => i.status === 'dup', bad: (i) => i.status === 'failed' || i.status === 'skipped' };
    // the interesting rows first: problems, then what is happening, then the rest
    const rank = { failed: 0, sending: 1, retry: 1, dup: 2, queued: 3, skipped: 4, stored: 5 };
    const rows = snap.items.filter(pick[filter]);
    return { total: rows.length, rows: (filter === 'all' ? [...rows].sort((a, b) => rank[a.status] - rank[b.status]) : rows).slice(0, 250) };
  }, [snap.items, snap.version, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const pills = [
    ['all', 'All', snap.total], ['active', 'In progress', c.queued + c.sending], ['sent', 'Added', c.stored],
    ['dup', 'Duplicates', c.dup], ['bad', 'Not added', c.failed + c.skipped],
  ];
  const nothing = snap.total === 0;
  const allRead = snap.sent && !snap.reading && bi;
  const maxMb = config?.max_file_mb || 200;

  return (
    <Modal title="Import documents" onClose={onClose} label="Import documents"
      footer={(
        <>
          {snap.active > 0 && !snap.paused ? <button type="button" className="dh-btn ghost" onClick={() => uploader.pause()}><Icon name="pause" />Pause</button> : null}
          {snap.paused ? <button type="button" className="dh-btn ghost" onClick={() => uploader.resume()}><Icon name="play" />Resume</button> : null}
          {c.queued > 0 ? <button type="button" className="dh-btn quiet" onClick={() => uploader.cancelQueued()}>Cancel the rest</button> : null}
          {c.failed > 0 && snap.items.some((i) => i.status === 'failed' && i.file) ? <button type="button" className="dh-btn ghost" onClick={() => uploader.retryFailed()}><Icon name="refresh" />Retry failed ({fmtNum(c.failed)})</button> : null}
          {c.dup > 0 && snap.items.some((i) => i.status === 'dup' && i.file) ? <button type="button" className="dh-btn quiet" onClick={() => uploader.addAllDuplicatesAnyway()}>Add duplicates anyway</button> : null}
          <span className="sp" />
          {allRead && bi.review > 0 ? <button type="button" className="dh-btn ghost" onClick={() => onReview?.()}>Review {fmtNum(bi.review)} to check</button> : null}
          {c.stored > 0 ? <button type="button" className="dh-btn ghost" onClick={() => onViewBatch?.(snap.batchId)}>View these documents</button> : null}
          <button type="button" className="dh-btn primary" onClick={onClose}>{snap.active > 0 ? 'Keep working — continue in background' : 'Done'}</button>
        </>
      )}>
      <div className="dh-opts">
        <label className="dh-field" style={{ margin: 0 }}>
          <span className="lab">Save into</span>
          <select className="dh-select" value={folderId} disabled={locked} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">Let the hub file them by type (recommended)</option>
            {folderIndex.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <span className="hint">
            {folderId ? 'Everything in this import goes into this folder.' : 'Filed automatically only when the hub is confident; anything unsure waits in Review.'}
            {' '}<button type="button" className="dh-more" style={{ padding: 0 }} onClick={onCreateFolder}>New folder…</button>
          </span>
        </label>
        <label className="dh-field" style={{ margin: 0 }}>
          <span className="lab">Link to matter (optional)</span>
          <select className="dh-select" value={matterId} disabled={locked} onChange={(e) => setMatterId(e.target.value)}>
            <option value="">No matter — decide later</option>
            {matters.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </select>
          <span className="hint">{locked ? 'Locked while files are being sent.' : 'Case numbers found inside documents can suggest a matter later.'}</span>
        </label>
      </div>

      <div className={`dh-drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <div className="ic"><Icon name="upload" /></div>
        <h3>{scanning != null ? `Reading folder… ${fmtNum(scanning)} files found` : 'Drop files or a whole folder here'}</h3>
        <p>PDF, Word, Excel, PowerPoint, images, e-mails and text — up to {maxMb} MB each. Thousands at a time is fine; your folder structure is remembered.</p>
        <div className="row">
          <button type="button" className="dh-btn primary" onClick={() => fileIn.current?.click()}><Icon name="doc" />Choose files</button>
          <button type="button" className="dh-btn ghost" onClick={() => dirIn.current?.click()}><Icon name="folder" />Choose a folder</button>
        </div>
        <input ref={fileIn} type="file" multiple hidden onChange={picked} aria-label="Choose files" />
        <input ref={dirIn} type="file" multiple hidden onChange={picked} aria-label="Choose a folder" webkitdirectory="" directory="" />
      </div>
      {notice ? <p className="dh-note" style={{ margin: '10px 2px 0' }}>{notice}</p> : null}

      {!nothing ? (
        <>
          <div className="dh-sum">
            <div className="cell"><div className="n">{fmtNum(c.stored)}<span style={{ color: 'var(--muted)', fontSize: 12 }}> / {fmtNum(snap.total)}</span></div><div className="l">added</div></div>
            <div className="cell"><div className="n">{fmtNum(c.queued + c.sending)}</div><div className="l">in progress</div></div>
            <div className={`cell${c.dup ? ' warn' : ''}`}><div className="n">{fmtNum(c.dup)}</div><div className="l">already had</div></div>
            <div className={`cell${c.failed + c.skipped ? ' bad' : ''}`}><div className="n">{fmtNum(c.failed + c.skipped)}</div><div className="l">not added</div></div>
          </div>
          <div className="dh-bar thick" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Upload progress"><i style={{ width: `${pct}%` }} /></div>
          <p className="dh-note" style={{ margin: '8px 0 12px' }}>
            {snap.paused ? <b>Paused. </b> : null}
            {snap.active > 0 ? `Sending ${fmtNum(finished)} of ${fmtNum(snap.total)}${rate ? ` · ${rate.toFixed(1)} files/s` : ''}${eta ? ` · about ${eta} left` : ''}` : `All ${fmtNum(snap.total)} files handled.`}
            {snap.bytesDone ? ` ${fmtBytes(snap.bytesDone)} uploaded.` : ''}
            {snap.skippedJunk ? ` ${fmtNum(snap.skippedJunk)} system file${snap.skippedJunk === 1 ? '' : 's'} ignored.` : ''}
          </p>
          {bi && bi.total > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <div className="dh-bar" aria-label="Reading progress"><i style={{ width: `${readPct}%` }} /></div>
              <p className="dh-note" style={{ margin: '6px 0 0' }}>
                {bi.working > 0
                  ? <>Reading text and classifying: <b>{fmtNum(bi.done)}</b> of {fmtNum(bi.total)} done. You can search finished ones already.</>
                  : <>All {fmtNum(bi.total)} documents are read and searchable{bi.review ? <> — <b>{fmtNum(bi.review)}</b> need a quick look</> : null}{bi.problems ? <>, <b>{fmtNum(bi.problems)}</b> could not be fully read</> : null}.</>}
              </p>
            </div>
          ) : null}
          <div className="dh-filterpills">
            {pills.filter(([id, , n]) => id === 'all' || n > 0).map(([id, label, n]) => (
              <button key={id} type="button" className={`dh-pill${filter === id ? ' on' : ''}`} onClick={() => setFilter(id)}>{label}<span className="c">{fmtNum(n)}</span></button>
            ))}
          </div>
          <div className="dh-uplist" role="list">
            {list.rows.map((it) => (
              <div key={it.id} className={`dh-uprow ${tone(it.status)}`} role="listitem">
                <span className="ico"><Icon name={STATUS_ICON[it.status]} className={it.status === 'sending' || it.status === 'retry' ? 'dh-spin' : ''} /></span>
                <span className="nm" title={it.rel || it.name}>{it.name}<small>{it.rel && it.rel !== it.name ? it.rel.replace(/\/[^/]*$/, '') || fmtBytes(it.size) : fmtBytes(it.size)}</small></span>
                <span className="st">
                  <span>{it.msg || STATUS_TEXT[it.status]}</span>
                  {it.status === 'dup' && it.file ? <button type="button" className="dh-btn quiet sm" onClick={() => uploader.addAnyway(it.id)}>Add anyway</button> : null}
                  {it.status === 'failed' && it.file && it.retryable !== false ? <button type="button" className="dh-btn quiet sm" onClick={() => uploader.retry(it.id)}>Retry</button> : null}
                </span>
              </div>
            ))}
            {!list.rows.length ? <div className="dh-uprow"><span /><span className="nm" style={{ color: 'var(--muted)' }}>Nothing here.</span><span /></div> : null}
          </div>
          {list.total > list.rows.length ? <p className="dh-note" style={{ margin: '8px 2px 0' }}>Showing {fmtNum(list.rows.length)} of {fmtNum(list.total)}. Problems are listed first.</p> : null}
          {snap.sent && !snap.reading ? <p style={{ margin: '12px 0 0' }}><button type="button" className="dh-btn quiet sm" onClick={() => { uploader.reset(); setNotice(''); setFilter('all'); }}>Clear this list</button></p> : null}
        </>
      ) : null}
    </Modal>
  );
}

// Small floating progress card, shown when the import panel is closed but work is still going.
export function UploadDock({ onOpen, onView }) {
  const snap = useUploader();
  const [hidden, setHidden] = useState(null);
  const c = snap.counts;
  const show = snap.total > 0 && (snap.busy || snap.reading || snap.paused || (snap.sent && hidden !== snap.batchId));
  if (!show) return null;
  const finished = c.stored + c.dup + c.failed + c.skipped;
  const pct = snap.total ? Math.round((finished / snap.total) * 100) : 0;
  const done = snap.sent && !snap.reading && !snap.paused;
  const bi = snap.batchInfo;
  return (
    <div className="dh-dock" role="status">
      <div className="t">
        <Icon name={done ? 'checkCircle' : snap.paused ? 'pause' : 'upload'} />
        {done ? 'Import finished' : snap.paused ? 'Import paused' : snap.active > 0 ? 'Importing documents…' : 'Reading your documents…'}
      </div>
      {!done ? <div className="dh-bar" aria-hidden="true"><i style={{ width: `${snap.active > 0 || snap.paused ? pct : (bi && bi.total ? Math.round((bi.done / bi.total) * 100) : 100)}%` }} /></div> : null}
      <div className="s">
        {done
          ? `${fmtNum(c.stored)} added${c.dup ? ` · ${fmtNum(c.dup)} already had` : ''}${c.failed ? ` · ${fmtNum(c.failed)} not added` : ''}`
          : snap.active > 0 || snap.paused ? `${fmtNum(finished)} of ${fmtNum(snap.total)} sent${c.failed ? ` · ${fmtNum(c.failed)} not added` : ''}`
            : `${fmtNum(bi?.done || 0)} of ${fmtNum(bi?.total || c.stored)} read`}
      </div>
      <div className="row">
        <button type="button" className="dh-btn primary sm" onClick={onOpen}>{done ? 'Details' : 'Open'}</button>
        {snap.paused ? <button type="button" className="dh-btn ghost sm" onClick={() => uploader.resume()}>Resume</button> : null}
        {done && c.stored > 0 ? <button type="button" className="dh-btn ghost sm" onClick={() => onView?.(snap.batchId)}>View documents</button> : null}
        {done ? <button type="button" className="dh-btn quiet sm" onClick={() => setHidden(snap.batchId)}>Dismiss</button> : null}
      </div>
    </div>
  );
}
