// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as L from './scanLayout.js';
import { readView } from './hubState.js';

const mk = () => ({ docs: [L.emptyDoc([1, 2, 3], { key: 'a', title: 'A', case_ref: 'lpms:1' }), L.emptyDoc([4, 5], { key: 'b', title: 'B' })], removed: [9] });
const pages = (l) => l.docs.map((d) => d.pages);

describe('scan layout editing', () => {
  it('splits a document after a page and keeps its case', () => {
    const base = mk();
    const s = L.splitDoc(base, 'a', 1);
    expect(pages(s.layout)).toEqual([[1], [2, 3], [4, 5]]);
    expect(s.layout.docs[1].case_ref).toBe('lpms:1');
    expect(L.splitDoc(base, 'a', 0).key).toBeNull();
    expect(L.splitDoc(base, 'a', 3).key).toBeNull();
  });

  it('merges two documents into the first', () => {
    const base = mk();
    const m = L.mergeDocs(base, 'a', 'b');
    expect(pages(m)).toEqual([[1, 2, 3, 4, 5]]);
    expect(m.docs[0].title).toBe('A');
    expect(L.mergeDocs(base, 'a', 'a')).toBe(base);
  });

  it('moves a page into another document, before a page, or into a new document', () => {
    const base = mk();
    expect(pages(L.movePage(base, 2, 'b', 5))).toEqual([[1, 3], [4, 2, 5]]);
    expect(pages(L.movePage(base, 4, 'a'))).toEqual([[1, 2, 3, 4], [5]]);
    expect(pages(L.movePage(base, 5, 'b', 4))).toEqual([[1, 2, 3], [5, 4]]);
    expect(pages(L.movePage(base, 4, null))).toEqual([[1, 2, 3], [4], [5]]);
    expect(L.movePage(base, 3, 'a', 3)).toBe(base);
    expect(L.movePage(base, 99, 'a')).toBe(base);
  });

  it('removes a document that has lost its last page', () => {
    const l = { docs: [L.emptyDoc([7], { key: 'x' }), L.emptyDoc([8], { key: 'y' })], removed: [] };
    expect(pages(L.movePage(l, 7, 'y'))).toEqual([[8, 7]]);
  });

  it('sets pages aside and restores them', () => {
    const base = mk();
    const a = L.setAside(base, 4);
    expect(pages(a)).toEqual([[1, 2, 3], [5]]);
    expect(a.removed).toEqual([9, 4]);
    const both = L.setAside(L.setAside(base, 4), 5);
    expect(both.docs).toHaveLength(1);
    const r = L.restorePage(both, 5);
    expect(pages(r)).toEqual([[1, 2, 3, 5]]);                              // goes back after the page scanned just before it
    expect(r.removed).not.toContain(5);
    expect(L.restorePage(base, 1)).toBe(base);
    const ad = L.setAsideDoc(base, 'a');
    expect(ad.removed).toEqual([9, 1, 2, 3]);
    expect(ad.docs).toHaveLength(1);
  });

  it('puts a page back where it was scanned, or makes a document when nothing is left', () => {
    const base = mk();
    const mid = L.restorePageWhere(L.setAside(base, 2), 2);
    expect(pages(mid.layout)).toEqual([[1, 2, 3], [4, 5]]);
    expect(mid.into).toBe('a');
    const first = L.restorePageWhere(L.setAside(L.setAside(base, 1), 4), 1);          // nothing earlier: before the next page
    expect(pages(first.layout)).toEqual([[1, 2, 3], [5]]);
    const none = L.restorePageWhere({ docs: [], removed: [3] }, 3);
    expect(pages(none.layout)).toEqual([[3]]);
    expect(none.into).toBeNull();
    expect(L.restorePageWhere(base, 1).layout).toBe(base);
  });

  it('reorders documents', () => {
    const base = mk();
    expect(L.moveDoc(base, 'a', 1).docs.map((d) => d.key)).toEqual(['b', 'a']);
    expect(L.moveDoc(base, 'a', -1)).toBe(base);
  });

  it('drops deleted pages and appends newly proposed documents without repeating pages', () => {
    const base = mk();
    expect(L.dropPage(base, 2).docs[0].pages).toEqual([1, 3]);
    expect(L.dropPage(base, 9).removed).toEqual([]);
    const ap = L.appendProposed(base, [{ key: 'n', pages: [10, 11, 1], title: 'N' }, { key: 'o', pages: [2] }], [{ id: 12 }, { id: 9 }, { id: 4 }]);
    expect(pages(ap)).toEqual([[1, 2, 3], [4, 5], [10, 11]]);
    expect(ap.removed).toEqual([9, 12]);
  });

  it('sends only what the server needs and never mutates its input', () => {
    const base = mk();
    const frozen = JSON.stringify(base);
    const sv = L.forServer(base);
    expect(sv.docs[0].case_ref).toBe('lpms:1');
    expect('case_label' in sv.docs[0]).toBe(false);
    L.splitDoc(base, 'a', 1); L.mergeDocs(base, 'a', 'b'); L.movePage(base, 2, 'b', 5); L.setAside(base, 4);
    expect(JSON.stringify(base)).toBe(frozen);
  });
});

describe('Document Hub tab from the address', () => {
  const v = (q) => readView(new URLSearchParams(q));
  it('opens the tab named by ?view=', () => {
    expect(v('view=paper')).toBe('paper');
    expect(v('view=bundles&case=lpms:1')).toBe('bundles');
    expect(v('')).toBe('library');
    expect(v('view=nonsense')).toBe('library');
  });
  it('opens the right tab from a QR label, a scan or a bundle link', () => {
    expect(v('pf=abc')).toBe('paper');
    expect(v('scan=xyz')).toBe('scan');
    expect(v('bundle=3')).toBe('bundles');
  });
});
