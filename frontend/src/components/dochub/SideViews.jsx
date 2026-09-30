import { useCallback, useEffect, useState } from 'react';
import { dh } from './api.js';
import { DocRow, Pager, Skeleton } from './DocList.jsx';
import { Icon } from './icons.jsx';
import { Chip, Confirm, EmptyState } from './ui.jsx';
import { fmtAgo, fmtBytes, fmtNum, plural } from './format.js';

// ── Trash ──────────────────────────────────────────────────────────────────────────────
export function TrashView({ onOpen, onChanged, toast, folderLabel }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (p = page) => {
    try {
      const r = await dh.trashList(p);
      if (!r.docs.length && p > 1) { setPage(p - 1); return; }
      setData(r);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Could not load the trash.');
    }
  }, [page]);
  useEffect(() => { load(page); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSel(new Set()); }, [page]);

  const ids = [...sel];
  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const r = await fn();
      setSel(new Set());
      await load(page);
      onChanged?.();
      if (msg) toast?.(msg(r));
    } catch (e) {
      toast?.(e.message || 'That did not work.', { tone: 'bad' });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const restore = (list) => act(() => dh.bulk(list, 'restore'), (r) => `Restored ${plural(r.done, 'document')}${r.skipped?.length ? ` · ${r.skipped.length} could not be restored` : ''}`);
  const purge = (list) => act(() => dh.bulk(list, 'purge'), (r) => `Deleted ${plural(r.done, 'document')} for good${r.skipped?.length ? ` · ${r.skipped.length} kept (${r.skipped[0].reason})` : ''}`);
  const empty = () => act(async () => {
    let purged = 0; let skipped = 0;
    for (let i = 0; i < 30; i += 1) {
      const r = await dh.emptyTrash();
      purged += r.purged; skipped += r.skipped;
      if (!r.more || !r.purged) break;
    }
    return { purged, skipped };
  }, (r) => `Emptied the trash: ${plural(r.purged, 'document')} deleted${r.skipped ? `, ${r.skipped} kept (legal hold)` : ''}`);

  if (err && !data) return <div className="dh-errbox" role="alert"><Icon name="alert" /><div className="body">{err}</div><button type="button" className="dh-btn ghost sm" onClick={() => load(page)}>Try again</button></div>;
  if (!data) return <Skeleton rows={4} />;

  return (
    <>
      <p className="dh-note">
        Deleted documents wait here for <b>{data.days} days</b>, then are removed for good. Restoring puts a document back exactly where it was, with all its versions. Documents under legal hold can never be deleted.
      </p>
      {data.docs.length === 0 ? (
        <EmptyState icon="trash" title="The trash is empty">Nothing has been deleted. When you delete a document it waits here first, so mistakes are easy to undo.</EmptyState>
      ) : (
        <>
          <div className="dh-toolbar">
            <label className="dh-check"><input type="checkbox" checked={sel.size > 0 && sel.size === data.docs.length}
              onChange={(e) => setSel(e.target.checked ? new Set(data.docs.map((d) => d.id)) : new Set())} aria-label="Select all on this page" /><span>Select page</span></label>
            <span className="count"><b>{fmtNum(data.total)}</b> in the trash</span>
            <span className="sp" />
            {sel.size ? (
              <>
                <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => restore(ids)}><Icon name="restore" />Restore {fmtNum(sel.size)}</button>
                <button type="button" className="dh-btn danger sm" disabled={busy} onClick={() => setConfirm({ kind: 'purge', ids })}><Icon name="trash" />Delete {fmtNum(sel.size)} for good</button>
              </>
            ) : <button type="button" className="dh-btn danger sm" disabled={busy} onClick={() => setConfirm({ kind: 'empty' })}><Icon name="trash" />Empty trash</button>}
          </div>
          <div className="dh-list">
            {data.docs.map((d) => (
              <DocRow key={d.id} doc={d} selected={sel.has(d.id)} folderLabel={folderLabel} onOpen={onOpen}
                onSelect={(id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
                extra={<span className="dh-chip warn" style={{ marginTop: 8 }}>Removed for good in {plural(d.days_left ?? data.days, 'day')}</span>}
                actions={<button type="button" className="dh-btn quiet sm" onClick={(e) => { e.stopPropagation(); restore([d.id]); }}><Icon name="restore" />Restore</button>} />
            ))}
          </div>
          <Pager page={page} perPage={50} total={data.total} onPage={setPage} />
        </>
      )}
      {confirm?.kind === 'purge' ? (
        <Confirm danger title="Delete for good?" confirmLabel="Delete for good" busy={busy} onConfirm={() => purge(confirm.ids)} onCancel={() => setConfirm(null)}>
          {plural(confirm.ids.length, 'document')} and all their versions will be removed permanently. This cannot be undone.
        </Confirm>
      ) : null}
      {confirm?.kind === 'empty' ? (
        <Confirm danger title="Empty the trash?" confirmLabel="Empty trash" busy={busy} onConfirm={empty} onCancel={() => setConfirm(null)}>
          Everything in the trash ({fmtNum(data.total)}) will be removed permanently. Documents under legal hold are kept. This cannot be undone.
        </Confirm>
      ) : null}
    </>
  );
}

// ── Duplicates ─────────────────────────────────────────────────────────────────────────
export function DuplicatesView({ onOpen, onChanged, toast, folderLabel }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await dh.duplicates()); setErr(''); } catch (e) { setErr(e.message || 'Could not look for duplicates.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const trashOthers = async (group, keepId) => {
    const others = group.docs.filter((d) => d.id !== keepId).map((d) => d.id);
    setBusy(true);
    try {
      const r = await dh.bulk(others, 'trash');
      toast?.(`Moved ${plural(r.done, 'copy', 'copies')} to the trash${r.skipped?.length ? ` · ${r.skipped.length} kept (${r.skipped[0].reason})` : ''}`);
      onChanged?.();
      await load();
    } catch (e) {
      toast?.(e.message || 'That did not work.', { tone: 'bad' });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (err && !data) return <div className="dh-errbox" role="alert"><Icon name="alert" /><div className="body">{err}</div><button type="button" className="dh-btn ghost sm" onClick={load}>Try again</button></div>;
  if (!data) return <Skeleton rows={4} />;
  return (
    <>
      <p className="dh-note">
        <b>Same file</b> means byte-for-byte identical. <b>Same text</b> means the words match but the file differs — for example a scan and the Word original. Nothing is deleted until you choose; the ones you remove go to the trash, where they can be restored.
      </p>
      {data.groups.length === 0 ? (
        <EmptyState icon="copy" title="No duplicates found">Every document in your library is different from every other. New uploads are checked automatically, so a repeated file is stopped at the door.</EmptyState>
      ) : (
        <>
          <p className="dh-note" style={{ marginTop: -4 }}><b>{fmtNum(data.count)}</b> group{data.count === 1 ? '' : 's'} · <b>{fmtNum(data.extra_docs)}</b> extra {data.extra_docs === 1 ? 'copy' : 'copies'} you could tidy away.</p>
          {data.groups.map((g) => (
            <section className="dh-dupgroup" key={`${g.kind}-${g.key}`} aria-label={`${g.kind} group`}>
              <header>
                <Chip tone={g.kind === 'same file' ? 'warn' : ''} icon="copy">{g.kind}</Chip>
                <span className="t"><b>{g.docs.length}</b> documents{g.docs[0]?.size ? ` · ${fmtBytes(g.docs[0].size)}` : ''}</span>
                <button type="button" className="dh-btn ghost sm" disabled={busy} onClick={() => setConfirm({ group: g, keep: g.docs[0].id })}>Keep the oldest, trash the rest</button>
              </header>
              {g.docs.map((d, i) => (
                <div key={d.id} className={`dh-duprow${i === 0 ? ' keep' : ''}`}>
                  <div className="dh-badge" aria-hidden="true">{(d.ext || 'file').slice(0, 4).toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="ttl">{d.title}</div>
                    <div className="meta">{i === 0 ? 'Oldest · ' : ''}added {fmtAgo(d.created_at)}{d.folder_id ? ` · ${folderLabel?.(d.folder_id) || 'in a folder'}` : ' · not filed'}{d.legal_hold ? ' · legal hold' : ''}</div>
                  </div>
                  <div className="acts">
                    <button type="button" className="dh-btn quiet sm" onClick={() => onOpen(d.id)}><Icon name="eye" />View</button>
                    <button type="button" className="dh-btn ghost sm" disabled={busy || d.level === 'view'} onClick={() => setConfirm({ group: g, keep: d.id })}>Keep only this</button>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
      {confirm ? (
        <Confirm danger title="Trash the other copies?" confirmLabel="Move to trash" busy={busy} onConfirm={() => trashOthers(confirm.group, confirm.keep)} onCancel={() => setConfirm(null)}>
          You keep “{confirm.group.docs.find((d) => d.id === confirm.keep)?.title}”. The other {plural(confirm.group.docs.length - 1, 'copy', 'copies')} go to the trash for 30 days. Anything under legal hold stays.
        </Confirm>
      ) : null}
    </>
  );
}
