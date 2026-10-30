// Review mode: the hub is unsure about some documents. This walks through them one at a time, biggest doubt
// first is not needed - the point is that each one is a single keypress: Enter to confirm, 1-3 to pick another type.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dh } from './api.js';
import { Icon } from './icons.jsx';
import { Portal, useDialog } from './ui.jsx';
import { PageView, TextView, fetchPage } from './Viewer.jsx';
import { fmtDate, fmtNum } from './format.js';

export function ReviewMode({ config, onClose, onChanged, toast }) {
  const ref = useRef(null);
  const [queue, setQueue] = useState([]);
  const [startTotal, setStartTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(0);
  const [detail, setDetail] = useState(null);
  const [page, setPage] = useState(1);
  const seen = useRef(new Set());
  const history = useRef([]);
  const changed = useRef(0);
  const close = useCallback(() => onClose(changed.current), [onClose]);
  useDialog(ref, close);

  const fetchUnseen = useCallback(async () => {
    for (let p = 1; p <= 12; p += 1) {
      const r = await dh.queue('review', p, 100);
      const fresh = r.docs.filter((d) => !seen.current.has(d.id));
      if (fresh.length) return { docs: fresh, total: r.total };
      if (p * 100 >= r.total) break;
    }
    return { docs: [], total: 0 };
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetchUnseen();
        if (dead) return;
        setQueue(r.docs);
        setStartTotal(r.total);
      } catch (e) {
        if (!dead) setErr(e.message || 'Could not load the documents to review.');
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [fetchUnseen]);

  const cur = queue[0];
  // the queue payload is the light version; the doubts (alternatives, evidence) come with the detail
  useEffect(() => {
    setDetail(null);
    setPage(1);
    if (!cur) return undefined;
    let dead = false;
    dh.get(cur.id).then((d) => { if (!dead) setDetail(d); }).catch(() => {});
    const nxt = queue[1];   // warm the next page picture, but only for files that have one
    if (nxt && (nxt.kind === 'pdf' || nxt.kind === 'image') && nxt.status !== 'failed') { fetchPage(nxt.id, 1, 1000, []).catch(() => {}); }
    return () => { dead = true; };
  }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const advance = useCallback(async (didAccept) => {
    const done = queue[0];
    if (!done) return;
    seen.current.add(done.id);
    if (didAccept) setResolved((n) => n + 1); else history.current.push(done);   // only skipped ones can be revisited
    const rest = queue.slice(1);
    if (rest.length) { setQueue(rest); return; }
    setLoading(true);
    try {
      const r = await fetchUnseen();
      setQueue(r.docs);
    } catch (e) {
      setErr(e.message || 'Could not load more.');
    } finally {
      setLoading(false);
    }
  }, [queue, fetchUnseen]);

  const apply = useCallback(async (body, msg) => {
    if (!cur || busy) return;
    setBusy(true);
    try {
      await dh.patch(cur.id, body);
      changed.current += 1;
      onChanged?.();
      if (msg) toast?.(msg);
      await advance(true);
    } catch (e) {
      toast?.(e.message || 'Could not save that.', { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }, [cur, busy, advance, onChanged, toast]);

  const skip = useCallback(() => { if (cur && !busy) advance(false); }, [cur, busy, advance]);
  const back = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    seen.current.delete(prev.id);
    setQueue((q) => [prev, ...q]);
  }, []);

  const alternatives = useMemo(() => (detail?.alternatives || []).filter((a) => a.doc_class && cur && a.doc_class !== cur.doc_class).slice(0, 3), [detail, cur]);
  const known = cur && cur.doc_class !== 'Unclassified';

  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === 'Enter' || e.key === 'a') { if (known) { e.preventDefault(); apply({ review: 'reviewed' }, null); } }
      else if (e.key === 's' || e.key === 'ArrowRight') { e.preventDefault(); skip(); }
      else if (e.key === 'ArrowLeft' || e.key === 'b') { e.preventDefault(); back(); }
      else if (['1', '2', '3'].includes(e.key)) { const a = alternatives[Number(e.key) - 1]; if (a) { e.preventDefault(); apply({ doc_class: a.doc_class }, null); } }
      else if (e.key === 't') { e.preventDefault(); ref.current?.querySelector('#dh-rv-type')?.focus(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [known, apply, skip, back, alternatives]);

  const pct = startTotal ? Math.min(100, Math.round((resolved / startTotal) * 100)) : 0;
  const canPages = cur && (cur.kind === 'pdf' || cur.kind === 'image') && cur.status !== 'failed';
  const pages = Math.max(1, cur?.page_count || 1);
  const finished = !loading && !err && !cur;

  return (
    <Portal>
      <div className="dh-review" role="dialog" aria-modal="true" aria-label="Review documents" ref={ref}>
        <div className="dh-rvhead">
          <h2>Review</h2>
          <div className="prog" aria-label={`${resolved} of ${startTotal} confirmed`}>
            <div className="dh-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
            <span>{fmtNum(resolved)} / {fmtNum(startTotal)}</span>
          </div>
          <span className="sp" />
          <span className="dh-rvkeys">
            <span className="dh-kbd" title="Enter confirms">Enter</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>confirm</span>
            <span className="dh-kbd">S</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>skip</span>
          </span>
          <button type="button" className="dh-btn ghost sm" onClick={close}><Icon name="close" />Close</button>
        </div>

        {loading && !cur ? <div style={{ margin: 'auto', color: 'var(--muted)', display: 'flex', gap: 10, alignItems: 'center' }}><Icon name="refresh" className="dh-spin" />Loading…</div> : null}
        {err ? <div className="dh-done"><div className="ic"><Icon name="alert" /></div><h3>Could not load</h3><p>{err}</p><button type="button" className="dh-btn primary" onClick={close}>Back to the library</button></div> : null}
        {finished ? (
          <div className="dh-done">
            <div className="ic"><Icon name="checkCircle" /></div>
            <h3>{resolved ? 'All caught up' : 'Nothing to review'}</h3>
            <p>{resolved ? `You checked ${fmtNum(resolved)} document${resolved === 1 ? '' : 's'}. Anything you skipped is still waiting in Review.` : 'Every document has a type you have confirmed or the hub was sure about.'}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              {history.current.length ? <button type="button" className="dh-btn ghost" onClick={back}><Icon name="back" />Go back one</button> : null}
              <button type="button" className="dh-btn primary" onClick={close}>Back to the library</button>
            </div>
          </div>
        ) : null}

        {cur ? (
          <div className="dh-rvbody">
            <section className="dh-viewer" aria-label="Document">
              <div className="dh-vbar">
                {canPages && pages > 1 ? (
                  <span className="pgno">
                    <button type="button" className="dh-ibtn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page"><Icon name="chevL" /></button>
                    Page {page} of {fmtNum(pages)}
                    <button type="button" className="dh-ibtn" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Next page"><Icon name="chevR" /></button>
                  </span>
                ) : <span className="pgno" style={{ color: 'var(--muted)' }}>{canPages ? 'One page' : 'Text of the file'}</span>}
                <span className="sp" />
                <span className="dh-chip">{fmtNum(queue.length)} left in this list</span>
              </div>
              <div className="dh-vscroll">
                {canPages ? <PageView docId={cur.id} page={page} pageCount={pages} zoom={1} terms={[]} onDownload={() => dh.download(cur.id, cur.original_name)} />
                  : <TextView docId={cur.id} start={1} words={[]} pageKind={cur.page_kind} />}
              </div>
            </section>

            <aside className="dh-rvcard" aria-label="Decide">
              <div>
                <div className="name">{cur.title}</div>
                <div className="file">{cur.original_name}</div>
              </div>

              <div className={`dh-suggest${known ? '' : ' none'}`}>
                <div className="k">{known ? 'The hub thinks this is' : 'The hub could not tell'}</div>
                <div className="v">{known ? cur.doc_class : 'Unknown type'}</div>
                <div className="c">{known ? `About ${Math.round((cur.class_conf || 0) * 100)}% sure` : 'Please choose what it is.'}</div>
                {(cur.class_evidence || []).length ? <div className="dh-evidence">{cur.class_evidence.slice(0, 4).map((e) => <span key={e} className="dh-chip">“{e}”</span>)}</div> : null}
              </div>

              {alternatives.length ? (
                <div>
                  <div className="dh-rail-h" style={{ marginBottom: 8 }}><span>Or maybe</span></div>
                  <div className="dh-alts">
                    {alternatives.map((a, i) => (
                      <button key={a.doc_class} type="button" className="dh-alt" disabled={busy} onClick={() => apply({ doc_class: a.doc_class })}>
                        <Icon name="tag" />{a.doc_class}<span className="key dh-kbd">{i + 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="dh-field" style={{ marginBottom: 0 }}>
                <span className="lab">Something else? <span className="dh-kbd" style={{ marginLeft: 4 }}>T</span></span>
                <select id="dh-rv-type" className="dh-select" value="" disabled={busy} onChange={(e) => e.target.value && apply({ doc_class: e.target.value })}>
                  <option value="">Choose a type…</option>
                  {(config?.classes || []).filter((c) => c !== 'Unclassified').map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>

              <dl className="dh-kv">
                {(cur.case_numbers || []).length ? <><dt>Case</dt><dd>{cur.case_numbers.join(', ')}</dd></> : null}
                {cur.parties ? <><dt>Parties</dt><dd>{cur.parties}</dd></> : null}
                {cur.court ? <><dt>Court</dt><dd>{cur.court}</dd></> : null}
                {cur.doc_date ? <><dt>Dated</dt><dd>{fmtDate(cur.doc_date)}</dd></> : null}
                {cur.page_count ? <><dt>Length</dt><dd>{fmtNum(cur.page_count)} {cur.page_count === 1 ? 'page' : 'pages'}</dd></> : null}
              </dl>

              <div className="dh-rvfoot">
                <button type="button" className="dh-btn primary" disabled={busy || !known} onClick={() => apply({ review: 'reviewed' })} title={known ? 'Keep this type' : 'Choose a type first'}>
                  <Icon name="check" />{known ? 'Yes, that’s right' : 'Pick a type above'}
                </button>
                <button type="button" className="dh-btn ghost" disabled={busy} onClick={skip}><Icon name="skip" />Skip for now</button>
                <span className="sp" />
                <button type="button" className="dh-btn quiet" disabled={!history.current.length || busy} onClick={back}><Icon name="back" />Back</button>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </Portal>
  );
}
