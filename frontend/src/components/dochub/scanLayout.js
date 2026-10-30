// Pure helpers for the scan board: a layout is { docs: [{key, pages: [pageId...], title, doc_class, case_ref, ...}], removed: [pageId...] }.
// Every function returns a NEW layout and never touches the one passed in, so "undo" is just keeping the previous one.

export const newKey = () => `d${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export const emptyDoc = (pages, extra = {}) => ({ key: newKey(), pages, title: null, doc_class: null, case_ref: null, pfile_id: null, folder_id: null, reasons: [], hint: null, ...extra });

export function placedIds(layout) {
  const s = new Set(layout?.removed || []);
  (layout?.docs || []).forEach((d) => d.pages.forEach((p) => s.add(p)));
  return s;
}

const find = (layout, pid) => {
  for (let i = 0; i < layout.docs.length; i += 1) {
    const j = layout.docs[i].pages.indexOf(pid);
    if (j >= 0) return [i, j];
  }
  return [-1, -1];
};

export function splitDoc(layout, key, at) {
  const i = layout.docs.findIndex((d) => d.key === key);
  if (i < 0) return { layout, key: null };
  const d = layout.docs[i];
  if (at < 1 || at >= d.pages.length) return { layout, key: null };
  const right = emptyDoc(d.pages.slice(at), { case_ref: d.case_ref, reasons: ['You split it here'] });
  const docs = layout.docs.slice();
  docs[i] = { ...d, pages: d.pages.slice(0, at) };
  docs.splice(i + 1, 0, right);
  return { layout: { ...layout, docs }, key: right.key };
}

// B joins the end of A (B disappears; A keeps its own name, type and case)
export function mergeDocs(layout, keyA, keyB) {
  const a = layout.docs.find((d) => d.key === keyA);
  const b = layout.docs.find((d) => d.key === keyB);
  if (!a || !b || a === b) return layout;
  return { ...layout, docs: layout.docs.filter((d) => d !== b).map((d) => (d === a ? { ...a, pages: [...a.pages, ...b.pages] } : d)) };
}

// Put one page into document `toKey` (before page `beforePid`, or at the end). toKey === null makes a new document next to the page's own.
export function movePage(layout, pid, toKey, beforePid = null) {
  const [si, sj] = find(layout, pid);
  if (si < 0) return layout;
  if (toKey && layout.docs[si].key === toKey && beforePid === pid) return layout;
  let docs = layout.docs.map((d) => ({ ...d, pages: d.pages.slice() }));
  docs[si].pages.splice(sj, 1);
  if (toKey === null) {
    const created = emptyDoc([pid], { case_ref: docs[si].case_ref, reasons: ['Moved here by you'] });
    docs.splice(sj === 0 && docs[si].pages.length ? si : si + 1, 0, created);   // a first page keeps its place in the order
  } else {
    const t = docs.find((d) => d.key === toKey);
    if (!t) return layout;
    const at = beforePid ? t.pages.indexOf(beforePid) : -1;
    if (at >= 0) t.pages.splice(at, 0, pid); else t.pages.push(pid);
  }
  docs = docs.filter((d) => d.pages.length > 0);
  return { ...layout, docs };
}

export function setAside(layout, pid) {
  const [si, sj] = find(layout, pid);
  if (si < 0) return layout;
  const docs = layout.docs.map((d) => ({ ...d, pages: d.pages.slice() }));
  docs[si].pages.splice(sj, 1);
  return { docs: docs.filter((d) => d.pages.length > 0), removed: [...layout.removed.filter((x) => x !== pid), pid] };
}

export function setAsideDoc(layout, key) {
  const d = layout.docs.find((x) => x.key === key);
  if (!d) return layout;
  return { docs: layout.docs.filter((x) => x !== d), removed: [...layout.removed, ...d.pages.filter((p) => !layout.removed.includes(p))] };
}

// Page ids grow in the order the pages were scanned, so a page that comes back goes where it was scanned: right after the nearest
// earlier page that is still in a document (or before the nearest later one). With no pages left anywhere it becomes a document.
// -> { layout, into: 'key of the document it joined' | null }
export function restorePageWhere(layout, pid) {
  if (!layout.removed.includes(pid)) return { layout, into: null };
  const removed = layout.removed.filter((x) => x !== pid);
  let before = null;
  let after = null;
  layout.docs.forEach((d, di) => d.pages.forEach((x, pi) => {
    if (x < pid && (before === null || x > before.id)) before = { id: x, di, pi };
    if (x > pid && (after === null || x < after.id)) after = { id: x, di, pi };
  }));
  const at = before || after;
  if (!at) return { layout: { docs: [...layout.docs, emptyDoc([pid], { reasons: ['Brought back by you'] })], removed }, into: null };
  const docs = layout.docs.map((d, di) => {
    if (di !== at.di) return d;
    const pages = d.pages.slice();
    pages.splice(before ? at.pi + 1 : at.pi, 0, pid);
    return { ...d, pages };
  });
  return { layout: { docs, removed }, into: docs[at.di].key };
}

export function restorePage(layout, pid) {
  return restorePageWhere(layout, pid).layout;
}

export function moveDoc(layout, key, delta) {
  const i = layout.docs.findIndex((d) => d.key === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= layout.docs.length) return layout;
  const docs = layout.docs.slice();
  const [m] = docs.splice(i, 1);
  docs.splice(j, 0, m);
  return { ...layout, docs };
}

export function patchDoc(layout, key, patch) {
  return { ...layout, docs: layout.docs.map((d) => (d.key === key ? { ...d, ...patch } : d)) };
}

// the pages of a page that no longer exists on the server (deleted) leave the layout
export function dropPage(layout, pid) {
  return { docs: layout.docs.map((d) => ({ ...d, pages: d.pages.filter((p) => p !== pid) })).filter((d) => d.pages.length), removed: layout.removed.filter((p) => p !== pid) };
}

export function appendProposed(layout, proposed, removed) {
  const have = placedIds(layout);
  const docs = [];
  (proposed || []).forEach((p) => {
    const pages = p.pages.filter((x) => !have.has(x));
    if (!pages.length) return;
    pages.forEach((x) => have.add(x));
    docs.push({ ...p, pages });
  });
  const gone = (removed || []).map((r) => r.id).filter((id) => !have.has(id));
  return { docs: [...layout.docs, ...docs], removed: [...layout.removed, ...gone] };
}

// what the server stores (no UI-only fields)
export function forServer(layout) {
  return {
    docs: layout.docs.map((d) => ({ key: d.key, pages: d.pages, title: d.title || null, doc_class: d.doc_class || null, case_ref: d.case_ref || null, pfile_id: d.pfile_id || null,
      folder_id: d.folder_id || null, reasons: d.reasons || [], hint: d.hint || null })),
    removed: layout.removed,
  };
}

// how many whole documents and pages a layout holds
export const totals = (layout, skip = {}) => {
  const live = layout.docs.filter((d) => !skip[d.key]);
  return { docs: live.length, pages: live.reduce((n, d) => n + d.pages.length, 0) };
};
