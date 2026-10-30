import { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons.jsx';
import { KIND_LABEL, STATUS, fmtNum } from './format.js';

function Facet({ label, count, on, onClick, zero, title }) {
  return (
    <button type="button" className={`dh-facet${on ? ' on' : ''}${zero && !on ? ' zero' : ''}`} onClick={onClick} aria-pressed={on} title={title || label}>
      <span className="t">{label}</span>
      {count != null ? <span className="c">{fmtNum(count)}</span> : null}
    </button>
  );
}

function FolderNode({ id, depth, index, counts, selected, expanded, toggle, pick }) {
  const f = index.byId.get(id);
  const kids = index.kids.get(id) || [];
  const isOpen = expanded.has(id);
  const n = counts.get(id) || 0;
  return (
    <>
      <div className="dh-fnode" style={{ paddingLeft: depth * 12 }}>
        <button type="button" className={`tg${isOpen ? ' open' : ''}${kids.length ? '' : ' none'}`} onClick={() => toggle(id)}
          aria-label={isOpen ? `Collapse ${f.name}` : `Expand ${f.name}`} tabIndex={kids.length ? 0 : -1}><Icon name="chevR" /></button>
        <Facet label={<><Icon name={selected === String(id) ? 'folderOpen' : 'folder'} />{f.name}</>} count={n} on={selected === String(id)} zero={n === 0} title={index.pathOf(id).join(' › ')} onClick={() => pick(String(id))} />
      </div>
      {isOpen ? kids.map((k) => (
        <FolderNode key={k} id={k} depth={depth + 1} index={index} counts={counts} selected={selected} expanded={expanded} toggle={toggle} pick={pick} />
      )) : null}
    </>
  );
}

export function FacetRail({ filters, facets, total, folderIndex, folderCounts, set, clearAll, view, matters, open, onClose, onNewFolder, activeCount }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [allTypes, setAllTypes] = useState(false);

  // keep the selected folder visible: open every parent of it
  useEffect(() => {
    const id = Number(filters.folder);
    if (!id || !folderIndex.byId.has(id)) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let cur = folderIndex.byId.get(id);
      for (let i = 0; cur && cur.parent_id && i < 16; i += 1) { next.add(cur.parent_id); cur = folderIndex.byId.get(cur.parent_id); }
      return next.size === prev.size ? prev : next;
    });
  }, [filters.folder, folderIndex]);

  // first load: open the top level so a blueprint of 5 folders is visible straight away
  const roots = folderIndex.roots.join(',');
  useEffect(() => { if (roots && roots.split(',').length <= 8) setExpanded((p) => (p.size ? p : new Set(folderIndex.roots))); }, [roots]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setExpanded((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pickFolder = (v) => set({ folder: filters.folder === v ? '' : v });

  const classes = useMemo(() => {
    const entries = Object.entries(facets?.classes || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (filters.cls && !entries.some(([k]) => k === filters.cls)) entries.push([filters.cls, 0]);
    return entries;
  }, [facets, filters.cls]);
  const shownClasses = allTypes ? classes : classes.slice(0, 8);
  const statuses = Object.entries(facets?.statuses || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const kinds = Object.entries(facets?.kinds || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const foldTotal = Object.values(facets?.folders || {}).reduce((a, b) => a + b, 0);
  const inReview = view === 'review';
  const inProblems = view === 'problems';

  return (
    <aside className={`dh-rail${open ? ' open' : ''}`} aria-label="Filters">
      <div className="dh-rail-h" style={{ marginBottom: 12 }}>
        <span>Filters{activeCount ? ` · ${activeCount}` : ''}</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {activeCount ? <button type="button" onClick={clearAll}>Clear all</button> : null}
          <button type="button" className="dh-ibtn dh-rail-close" onClick={onClose} aria-label="Close filters"><Icon name="close" /></button>
        </span>
      </div>

      <section className="dh-rail-sec" aria-label="Folders">
        <div className="dh-rail-h"><span>Folders</span><button type="button" onClick={onNewFolder}>+ New</button></div>
        <Facet label="All folders" count={foldTotal} on={!filters.folder} onClick={() => set({ folder: '' })} />
        <Facet label={<><Icon name="inbox" />Not filed yet</>} count={facets?.folders?.['0'] ?? 0} on={filters.folder === 'none'} zero={!facets?.folders?.['0']} onClick={() => pickFolder('none')} />
        <div className="dh-ftree">
          {folderIndex.roots.map((id) => (
            <FolderNode key={id} id={id} depth={0} index={folderIndex} counts={folderCounts} selected={filters.folder} expanded={expanded} toggle={toggle} pick={pickFolder} />
          ))}
        </div>
      </section>

      <section className="dh-rail-sec" aria-label="Document type">
        <div className="dh-rail-h"><span>Document type</span>{filters.cls ? <button type="button" onClick={() => set({ cls: '' })}>Clear</button> : null}</div>
        {shownClasses.map(([k, n]) => <Facet key={k} label={k} count={n} on={filters.cls === k} zero={n === 0} onClick={() => set({ cls: filters.cls === k ? '' : k })} />)}
        {!shownClasses.length ? <p className="dh-note" style={{ margin: 0 }}>Nothing to filter yet.</p> : null}
        {classes.length > 8 ? <button type="button" className="dh-more" onClick={() => setAllTypes((v) => !v)}>{allTypes ? 'Show fewer' : `Show ${classes.length - 8} more`}</button> : null}
      </section>

      {!inReview && !inProblems && (facets?.review || facets?.problems || filters.review || filters.problems) ? (
        <section className="dh-rail-sec" aria-label="Attention">
          <div className="dh-rail-h"><span>Needs attention</span></div>
          <Facet label="Type needs a check" count={facets?.review ?? 0} on={!!filters.review} zero={!facets?.review} onClick={() => set({ review: filters.review ? '' : '1' })} />
          <Facet label="Could not be fully read" count={facets?.problems ?? 0} on={!!filters.problems} zero={!facets?.problems} onClick={() => set({ problems: filters.problems ? '' : '1' })} />
        </section>
      ) : null}

      {statuses.length > 1 || filters.status ? (
        <section className="dh-rail-sec" aria-label="Reading status">
          <div className="dh-rail-h"><span>Reading status</span>{filters.status ? <button type="button" onClick={() => set({ status: '' })}>Clear</button> : null}</div>
          {statuses.map(([k, n]) => <Facet key={k} label={(STATUS[k] || { label: k }).label} count={n} on={filters.status === k} onClick={() => set({ status: filters.status === k ? '' : k })} />)}
        </section>
      ) : null}

      {kinds.length > 1 || filters.kind ? (
        <section className="dh-rail-sec" aria-label="File type">
          <div className="dh-rail-h"><span>File type</span>{filters.kind ? <button type="button" onClick={() => set({ kind: '' })}>Clear</button> : null}</div>
          {kinds.map(([k, n]) => <Facet key={k} label={KIND_LABEL[k] || k} count={n} on={filters.kind === k} onClick={() => set({ kind: filters.kind === k ? '' : k })} />)}
        </section>
      ) : null}

      <section className="dh-rail-sec" aria-label="Dates">
        <div className="dh-rail-h"><span>Document date</span>{filters.from || filters.to ? <button type="button" onClick={() => set({ from: '', to: '' })}>Clear</button> : null}</div>
        <div className="dh-datepair">
          <input className="dh-input" type="date" value={filters.from || ''} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} aria-label="Document date from" />
          <input className="dh-input" type="date" value={filters.to || ''} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label="Document date to" />
        </div>
        <div className="dh-rail-h" style={{ marginTop: 14 }}><span>Date added</span>{filters.addedFrom || filters.addedTo ? <button type="button" onClick={() => set({ addedFrom: '', addedTo: '' })}>Clear</button> : null}</div>
        <div className="dh-datepair">
          <input className="dh-input" type="date" value={filters.addedFrom || ''} max={filters.addedTo || undefined} onChange={(e) => set({ addedFrom: e.target.value })} aria-label="Added from" />
          <input className="dh-input" type="date" value={filters.addedTo || ''} min={filters.addedFrom || undefined} onChange={(e) => set({ addedTo: e.target.value })} aria-label="Added to" />
        </div>
      </section>

      <section className="dh-rail-sec" aria-label="Matter">
        <div className="dh-rail-h"><span>Matter</span></div>
        <select className="dh-select" value={filters.matter || ''} onChange={(e) => set({ matter: e.target.value })} aria-label="Matter">
          <option value="">Any matter</option>
          <option value="none">Not linked to a matter</option>
          {matters.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
        <label className="dh-check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={!!filters.hold} onChange={(e) => set({ hold: e.target.checked ? '1' : '' })} />
          <span>Legal hold only</span>
        </label>
      </section>
      <span className="dh-sr" aria-live="polite">{fmtNum(total)} documents match</span>
    </aside>
  );
}
