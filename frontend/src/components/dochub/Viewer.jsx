// The left half of the preview: page images (with search words highlighted by the server) or extracted text.
import { useEffect, useMemo, useRef, useState } from 'react';
import { dh } from './api.js';
import { Icon } from './icons.jsx';
import { Marked } from './DocList.jsx';
import { highlightWords, fmtNum } from './format.js';

// ── page-image cache: blob URLs, least-recently-used out ─────────────────────────────────
const LRU_MAX = 32;
const cache = new Map();
const inflight = new Map();

function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v);
  return v;
}
function cacheSet(key, url) {
  cache.set(key, url);
  while (cache.size > LRU_MAX) {
    const [k, v] = cache.entries().next().value;
    cache.delete(k);
    URL.revokeObjectURL(v);
  }
}

export const ZOOMS = [700, 1000, 1400, 1800];

export function fetchPage(docId, page, width, terms) {
  const key = `${docId}|${page}|${width}|${terms.join(' ')}`;
  const hit = cacheGet(key);
  if (hit) return Promise.resolve(hit);
  if (inflight.has(key)) return inflight.get(key);
  const p = dh.pageBlob(docId, page, width, terms).then((blob) => {
    const url = URL.createObjectURL(blob);
    cacheSet(key, url);
    return url;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function PageView({ docId, page, pageCount, zoom, terms, onDownload }) {
  const [state, setState] = useState({ url: null, err: null });
  const termsKey = terms.join(' ');
  const width = ZOOMS[zoom];
  useEffect(() => {
    let dead = false;
    setState((s) => ({ url: s.url, err: null, loading: true }));
    fetchPage(docId, page, width, terms).then((url) => { if (!dead) setState({ url, err: null }); })
      .catch((e) => { if (!dead) setState({ url: null, err: e.message || 'Could not draw this page.' }); });
    // quietly fetch the neighbours so turning a page feels instant
    const warm = (p) => { if (p >= 1 && p <= pageCount) fetchPage(docId, p, width, terms).catch(() => {}); };
    const t = setTimeout(() => { warm(page + 1); warm(page - 1); }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [docId, page, width, termsKey, pageCount]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.err) {
    return (
      <div className="dh-pagebox" role="alert">
        <Icon name="alert" size={22} />
        <div>{state.err}</div>
        <button type="button" className="dh-btn ghost sm" onClick={onDownload}><Icon name="download" />Download the original</button>
      </div>
    );
  }
  if (!state.url) return <div className="dh-pagebox" aria-busy="true"><Icon name="refresh" className="dh-spin" size={22} />Drawing page {page}…</div>;
  return (
    <img className="dh-pageimg" src={state.url} alt={`Page ${page}`} style={{ maxWidth: width, opacity: state.loading ? 0.7 : 1 }}
      onLoad={() => setState((s) => ({ ...s, loading: false }))} />
  );
}

export function TextView({ docId, start, words, pageKind }) {
  const [pages, setPages] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const next = useRef(start);
  const gen = useRef(0);
  const label = pageKind === 'sheet' ? 'Sheet' : pageKind === 'slide' ? 'Slide' : 'Page';

  const more = async (reset) => {
    const g = (gen.current += 1);
    setBusy(true);
    setErr('');
    try {
      const from = reset ? start : next.current;
      const r = await dh.text(docId, from, 8);
      if (g !== gen.current) return;             // a newer request (another document) has taken over
      setPages((p) => (reset ? r.pages : [...p, ...r.pages]));
      setTotal(r.total);
      next.current = from + r.pages.length;
      if (r.pages.length) next.current = r.pages[r.pages.length - 1].page + 1;
    } catch (e) {
      if (g === gen.current) setErr(e.message || 'Could not load the text.');
    } finally {
      if (g === gen.current) setBusy(false);
    }
  };
  useEffect(() => { next.current = start; setPages([]); more(true); }, [docId, start]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = pages.length ? pages[pages.length - 1].page : 0;
  return (
    <>
      {pages.map((p) => (
        <article key={p.page} className="dh-textpage">
          <h4>{label} {p.page}</h4>
          <pre>{highlightWords(p.text, words).map((s, i) => (s.hit ? <mark key={i} className="dh-mark">{s.text}</mark> : <span key={i}>{s.text}</span>))}</pre>
          {p.truncated ? <p className="dh-note" style={{ margin: '10px 0 0' }}>Long page — only the first part is shown here. Download the original to read all of it.</p> : null}
        </article>
      ))}
      {err ? <div className="dh-pagebox" role="alert"><Icon name="alert" size={22} /><div>{err}</div><button type="button" className="dh-btn ghost sm" onClick={() => more(!pages.length)}>Try again</button></div> : null}
      {!err && !busy && !pages.length ? (
        <div className="dh-pagebox"><Icon name="scan" size={22} /><div>No readable text was found in this file.</div></div>
      ) : null}
      {busy && !err ? <div className="dh-pagebox" style={{ minHeight: 120 }} aria-busy="true"><Icon name="refresh" className="dh-spin" size={20} />Loading text…</div> : null}
      {!busy && !err && shown < total ? (
        <button type="button" className="dh-btn ghost sm" onClick={() => more(false)}>Show more ({fmtNum(total - shown)} {label.toLowerCase()}{total - shown === 1 ? '' : 's'} left)</button>
      ) : null}
    </>
  );
}

export function HitList({ hits, onPick, current }) {
  if (!hits.length) return null;
  return (
    <div className="dh-hits">
      <h4>{fmtNum(hits.length)} page{hits.length === 1 ? '' : 's'} with your words</h4>
      {hits.slice(0, 40).map((h) => (
        <button key={h.page} type="button" className="dh-hit" onClick={() => onPick(h.page)} style={current === h.page ? { borderColor: 'var(--accent)' } : undefined}>
          <span className="pg">p.{h.page}</span><Marked text={h.snippet} />
        </button>
      ))}
      {hits.length > 40 ? <p className="dh-note" style={{ margin: '6px 2px 0' }}>+{fmtNum(hits.length - 40)} more pages</p> : null}
    </div>
  );
}

export function useHits(docId, q) {
  const [state, setState] = useState({ list: [], terms: [] });
  useEffect(() => {
    let dead = false;
    setState({ list: [], terms: [] });
    if (!q || !q.trim()) return undefined;
    const ctrl = new AbortController();
    dh.hits(docId, q, ctrl.signal).then((r) => { if (!dead) setState({ list: r.hits || [], terms: r.terms || [] }); }).catch(() => {});
    return () => { dead = true; ctrl.abort(); };
  }, [docId, q]);
  return state;
}

export function useTermsKey(terms) {
  const key = (terms || []).join('\u0001');      // the list is rebuilt only when its content changes, not when the array identity does
  return useMemo(() => (terms || []).filter(Boolean), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
