// The review board of Scan & file: every document the hub found in the pile, as a card of page thumbnails you can reorder,
// split, merge and move between documents before anything is filed.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AuthImg, CasePicker } from './FilesCommon.jsx';
import { fx } from './filesApi.js';
import { plural } from './format.js';
import { Icon } from './icons.jsx';
import { Menu, Modal, Portal, useDialog } from './ui.jsx';

export const thumbLoader = (sid, p, kind = 'thumb') => () => fx.scanPageImg(sid, p.id, kind, p.v);
const keyOf = (sid, p, kind) => `${kind}-${sid}-${p.id}-${p.v || 0}-${p.rot || 0}`;

// ── one page ─────────────────────────────────────────────────────────────────────────────
function Thumb({ sid, page, n, locked, ownKey, onOpen, onRotate, onAside, onMove, drag, setDrag, onDropOn }) {
  const busy = page.status !== 'ready';
  return (
    <div className={`fx-thumb${busy ? ' busy' : ''}${drag === page.id ? ' dragging' : ''}`} draggable={!locked && !busy}
      onDragStart={(e) => { setDrag(page.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(page.id)); } catch { /* ignore */ } }}
      onDragEnd={() => setDrag(null)}
      onDragOver={(e) => { if (drag !== null && !locked && drag !== page.id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
      onDrop={(e) => { if (drag === null || locked) return; e.preventDefault(); e.stopPropagation(); const d = drag; setDrag(null); onDropOn(d, ownKey, page.id); }}>
      <button type="button" className="pic" onClick={() => onOpen(page.id)} aria-label={`Open page ${n}`}>
        {busy ? <span className="fx-pending"><Icon name="refresh" className="dh-spin" /></span> : <AuthImg cacheKey={keyOf(sid, page, 'thumb')} load={thumbLoader(sid, page)} alt={`Page ${n}`} />}
        <span className="no mono">{n}</span>
        {page.blank ? <span className="tag">looks blank</span> : null}
      </button>
      {!locked && !busy ? (
        <div className="tools">
          <button type="button" className="dh-ibtn" aria-label={`Turn page ${n} to the right`} title="Turn right" onClick={() => onRotate(page.id, 90)}><Icon name="rotate" size={14} /></button>
          <button type="button" className="dh-ibtn" aria-label={`Set page ${n} aside`} title="Leave this page out" onClick={() => onAside(page.id)}><Icon name="close" size={14} /></button>
          <button type="button" className="dh-ibtn" aria-label={`Move page ${n} to another document`} title="Move to another document" onClick={() => onMove(page.id)}><Icon name="arrowRight" size={14} /></button>
        </div>
      ) : null}
    </div>
  );
}

// ── one document ─────────────────────────────────────────────────────────────────────────
export function DocCard({ sid, doc, n, count, pages, classes, defaults, labels, filed, busy, drag, setDrag, handlers }) {
  const locked = !!(filed && !filed.error);
  const eff = doc.case_ref || defaults.case_ref || null;
  const effLabel = eff ? (labels[eff] || eff) : null;
  const hint = !doc.case_ref && !defaults.case_ref ? doc.hint : null;
  const hintMatched = doc.case_ref && doc.hint && doc.hint.ref === doc.case_ref;
  const allReady = doc.pages.every((pid) => pages[pid]?.status === 'ready');
  const unreadable = allReady && !doc.pages.some((pid) => pages[pid]?.chars > 0);
  const [over, setOver] = useState(false);
  return (
    <article className={`fx-doc${locked ? ' filed' : ''}${filed?.error ? ' err' : ''}${over ? ' over' : ''}${busy ? ' busy' : ''}`} data-key={doc.key}
      onDragOver={(e) => { if (drag !== null && !locked) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { setOver(false); if (drag === null || locked) return; e.preventDefault(); const d = drag; setDrag(null); handlers.drop(d, doc.key, null); }}>
      <header>
        <span className="no mono">{n}</span>
        <div className="fields">
          <input className="dh-input title" value={doc.title || ''} disabled={locked} maxLength={180} placeholder={busy ? 'Reading this document…' : 'Name this document'} aria-label={`Name of document ${n}`}
            onChange={(e) => handlers.patch(doc.key, { title: e.target.value })} />
          <div className="row">
            <select className="dh-select type" value={doc.doc_class || ''} disabled={locked} aria-label={`Type of document ${n}`} onChange={(e) => handlers.patch(doc.key, { doc_class: e.target.value || null })}>
              <option value="">Type: not sure</option>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {locked ? <span className="dh-chip"><Icon name="briefcase" />{filed.case_label || 'No case yet'}</span> : (
              <CasePicker compact value={doc.case_ref || ''} label={doc.case_ref ? (labels[doc.case_ref] || doc.case_ref) : ''} allowNone noneLabel={defaults.case_ref ? 'Use the case chosen above' : 'No case yet'}
                placeholder={effLabel || (defaults.pfile_id ? 'Case of the paper file' : 'No case yet')} onChange={(ref, c) => handlers.setCase(doc.key, ref, c)} />
            )}
          </div>
        </div>
        {!locked ? (
          <Menu icon="more" label="" chevron={false} right className="dh-ibtn boxed" title="More">
            {(close) => (
              <>
                <button type="button" role="menuitem" disabled={n === 1} onClick={() => { close(); handlers.merge(doc.key, -1); }}><Icon name="merge" />Join with the one before</button>
                <button type="button" role="menuitem" disabled={n === count} onClick={() => { close(); handlers.merge(doc.key, 1); }}><Icon name="merge" />Join with the next one</button>
                <button type="button" role="menuitem" disabled={n === 1} onClick={() => { close(); handlers.moveDoc(doc.key, -1); }}><Icon name="arrowUp" />Move up</button>
                <button type="button" role="menuitem" disabled={n === count} onClick={() => { close(); handlers.moveDoc(doc.key, 1); }}><Icon name="arrowDown" />Move down</button>
                <button type="button" role="menuitem" onClick={() => { close(); handlers.reread(doc.key); }}><Icon name="refresh" />Suggest name and type again</button>
                <button type="button" role="menuitem" onClick={() => { close(); handlers.asideDoc(doc.key); }}><Icon name="close" />Leave this document out</button>
              </>
            )}
          </Menu>
        ) : null}
      </header>

      {hint ? (
        <div className="fx-hint"><Icon name="spark" /><span><b>{hint.confident ? 'Looks like' : 'Might belong to'}</b> {hint.label}{hint.reasons?.[0] ? <span className="mut"> — {hint.reasons[0]}</span> : null}</span>
          <button type="button" className="dh-btn ghost sm" disabled={locked} onClick={() => handlers.setCase(doc.key, hint.ref, { title: hint.label })}>Use it</button></div>
      ) : null}
      {hintMatched ? <div className="fx-hint soft"><Icon name="checkCircle" /><span>Matched to this case{doc.hint.reasons?.[0] ? <span className="mut"> — {doc.hint.reasons[0]}</span> : null}</span></div> : null}
      {!locked && doc.reasons?.[0] && n > 1 ? <div className="fx-why">{doc.reasons[0]}</div> : null}
      {!locked && unreadable ? <div className="fx-why warn"><Icon name="info" />No text could be read from these pages, so the name and case are for you to choose.</div> : null}

      <div className="strip" role="list" aria-label={`Pages of document ${n}`}>
        {doc.pages.map((pid, i) => {
          const p = pages[pid];
          if (!p) return null;
          return (
            <span key={pid} className="cell" role="listitem">
              <Thumb sid={sid} page={p} n={i + 1} locked={locked} ownKey={doc.key} onOpen={handlers.open} onRotate={handlers.rotate} onAside={handlers.aside}
                onMove={handlers.move} drag={drag} setDrag={setDrag} onDropOn={handlers.drop} />
              {!locked && i < doc.pages.length - 1 ? <button type="button" className="fx-cut" title="Split into two documents here" aria-label={`Split after page ${i + 1}`} onClick={() => handlers.split(doc.key, i + 1)}><Icon name="scissors" size={14} /></button> : null}
            </span>
          );
        })}
      </div>

      <footer>
        <span className="mut">{plural(doc.pages.length, 'page')}</span>
        {locked && !filed.error ? <span className="done"><Icon name="checkCircle" />Filed{filed.paper_file ? ` · linked to ${filed.paper_file}` : ''}</span> : null}
        {filed?.error ? <span className="bad"><Icon name="alert" />{filed.error}</span> : null}
        {locked && filed.doc_id ? <button type="button" className="fx-link" onClick={() => handlers.openDoc(filed.doc_id)}>Open it</button> : null}
      </footer>
    </article>
  );
}

// ── move a page to another document (a list is easier than aiming a drag on a phone) ─────────
export function MovePageModal({ docs, ownKey, onPick, onClose }) {
  return (
    <Modal small title="Move this page to…" onClose={onClose}>
      <div className="fx-movelist">
        {docs.filter((d) => d.key !== ownKey && !d.locked).map((d) => (
          <button key={d.key} type="button" className="fx-pickopt" onClick={() => onPick(d.key)}><span className="nm">Document {d.n}</span><span className="mt">{d.title || 'Not named yet'} · {plural(d.pages, 'page')}</span></button>
        ))}
        <button type="button" className="fx-pickopt none" onClick={() => onPick(null)}><span className="nm"><Icon name="plus" size={13} /> A separate document of its own</span></button>
      </div>
    </Modal>
  );
}

// ── pages left out ───────────────────────────────────────────────────────────────────────
export function AsideTray({ sid, ids, pages, onRestore, onOpen, onDelete }) {
  const [open, setOpen] = useState(false);
  if (!ids.length) return null;
  return (
    <section className="fx-aside" aria-label="Pages left out">
      <button type="button" className="head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} /><b>{plural(ids.length, 'page')} left out</b>
        <span className="mut">blank pages and separator sheets are left out automatically — they are never filed</span>
      </button>
      {open ? (
        <div className="strip">
          {ids.map((pid) => {
            const p = pages[pid];
            if (!p) return null;
            return (
              <div key={pid} className="fx-thumb static">
                <button type="button" className="pic" onClick={() => onOpen(pid)} aria-label="Open this page">
                  {p.status !== 'ready' ? <span className="fx-pending"><Icon name="refresh" className="dh-spin" /></span> : <AuthImg cacheKey={keyOf(sid, p, 'thumb')} load={thumbLoader(sid, p)} alt="" />}
                  {p.separator ? <span className="tag">separator</span> : p.blank ? <span className="tag">blank</span> : null}
                </button>
                <div className="under"><button type="button" className="dh-btn ghost sm" onClick={() => onRestore(pid)}>Bring back</button>
                  <button type="button" className="dh-ibtn" aria-label="Delete this page for good" title="Delete for good" onClick={() => onDelete(pid)}><Icon name="trash" size={14} /></button></div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ── big view of one page ─────────────────────────────────────────────────────────────────
export function Lightbox({ sid, order, pages, startId, where, onClose, onRotate, onAside, onRestore, onDelete, onRetry }) {
  const [id, setId] = useState(startId);
  const [text, setText] = useState(null);
  const [showText, setShowText] = useState(false);
  const ref = useRef(null);
  useDialog(ref, onClose);
  const i = Math.max(0, order.indexOf(id));
  const p = pages[id];
  const go = (d) => { const j = i + d; if (j >= 0 && j < order.length) { setId(order[j]); setText(null); } };

  useEffect(() => {
    const k = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  useEffect(() => {
    if (!showText || !p || p.status !== 'ready') return undefined;
    let dead = false;
    setText(null);
    fx.scanPageText(sid, id).then((r) => { if (!dead) setText(r.text || ''); }).catch(() => { if (!dead) setText(''); });
    return () => { dead = true; };
  }, [showText, id, sid, p?.v]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!p) onClose(); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return null;
  const w = where[id];
  return (
    <Portal>
      <div className="dh-scrim fx-lbscrim" onMouseDown={onClose} />
      <div className="fx-lb" role="dialog" aria-modal="true" aria-label={`Page ${i + 1} of ${order.length}`} ref={ref}>
        <header>
          <span className="mono">Page {i + 1} of {order.length}</span>
          <span className="mut">{w ? `in document ${w}` : 'left out'}{p.rot ? ` · turned ${p.rot}°` : ''}</span>
          <span className="sp" />
          <button type="button" className="dh-ibtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="stage">
          <button type="button" className="nav l" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous page"><Icon name="chevL" size={22} /></button>
          <div className="img">
            {p.status === 'ready' ? <AuthImg eager cacheKey={keyOf(sid, p, 'view')} load={thumbLoader(sid, p, 'view')} alt={`Page ${i + 1}`} />
              : p.status === 'failed' ? <div className="fx-lbmsg"><Icon name="alert" /><p>{p.error || 'This page could not be cleaned.'}</p><button type="button" className="dh-btn primary sm" onClick={() => onRetry(id)}>Try again</button></div>
                : <div className="fx-lbmsg"><Icon name="refresh" className="dh-spin" /><p>Cleaning this page…</p></div>}
          </div>
          <button type="button" className="nav r" onClick={() => go(1)} disabled={i >= order.length - 1} aria-label="Next page"><Icon name="chevR" size={22} /></button>
        </div>
        {showText ? <pre className="fx-lbtext" aria-label="Text read from this page">{text === null ? 'Reading…' : (text.trim() || 'No text could be read from this page.')}</pre> : null}
        <footer>
          <button type="button" className="dh-btn ghost sm" disabled={p.status !== 'ready'} onClick={() => onRotate(id, 270)}><Icon name="rotate" className="flip" />Turn left</button>
          <button type="button" className="dh-btn ghost sm" disabled={p.status !== 'ready'} onClick={() => onRotate(id, 90)}><Icon name="rotate" />Turn right</button>
          <button type="button" className="dh-btn ghost sm" onClick={() => setShowText((s) => !s)} disabled={p.status !== 'ready'}><Icon name="doc" />{showText ? 'Hide the text' : 'Show the text read'}</button>
          <span className="sp" />
          {w ? <button type="button" className="dh-btn ghost sm" onClick={() => { onAside(id); }}>Leave this page out</button> : <button type="button" className="dh-btn ghost sm" onClick={() => onRestore(id)}>Bring it back</button>}
          <button type="button" className="dh-btn danger sm" onClick={() => onDelete(id)}><Icon name="trash" />Delete</button>
        </footer>
      </div>
    </Portal>
  );
}

// small helper for the studio: the order of every page in the session, and which document number it sits in
export function usePageIndex(pagesList, layout) {
  return useMemo(() => {
    const order = pagesList.map((p) => p.id);
    const where = {};
    (layout?.docs || []).forEach((d, i) => d.pages.forEach((pid) => { where[pid] = i + 1; }));
    return { order, where };
  }, [pagesList, layout]);
}

export function useStable(fn) {
  const r = useRef(fn);
  r.current = fn;
  return useRef((...a) => r.current(...a)).current;
}

export function useDragReset() {
  const [drag, setDrag] = useState(null);
  useEffect(() => {
    const end = () => setDrag(null);
    window.addEventListener('dragend', end);
    window.addEventListener('drop', end);
    return () => { window.removeEventListener('dragend', end); window.removeEventListener('drop', end); };
  }, []);
  return [drag, setDrag];
}
