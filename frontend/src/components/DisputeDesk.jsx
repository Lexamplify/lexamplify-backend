import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildDisputeDoc, formFields, matchDisputes, reviewDraft, searchDisputes,
} from '../utils/disputeDraft.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const NOTICE = 'Drafting aid, not legal advice. Check every provision on India Code before filing.';

const KIND_LABEL = { petition: 'Petition / suit', notice: 'Legal notice', reply: 'Reply', rti: 'RTI' };

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  return { ok: res.ok && data.ok !== false, status: res.status, data };
}

const ico = {
  search: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  spark: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>,
  close: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  ok: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  warn: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 16.5h.01" /></svg>,
  info: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" /></svg>,
};

export default function DisputeDesk({ active, setActive, hasContent, currentText, onInsert }) {
  const [catalog, setCatalog] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('all');
  const [finder, setFinder] = useState('');
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [tool, setTool] = useState('review');

  useEffect(() => {
    let alive = true;
    import('../data/disputeCatalog.json')
      .then((m) => { if (alive) setCatalog(m.default || m); })
      .catch(() => { if (alive) setLoadErr('The dispute library could not be loaded.'); });
    return () => { alive = false; };
  }, []);

  const byId = useMemo(() => {
    const m = new Map();
    if (catalog) catalog.disputes.forEach((d) => m.set(d.id, d));
    return m;
  }, [catalog]);

  const list = useMemo(() => (catalog ? searchDisputes(catalog.disputes, query, cat) : []), [catalog, query, cat]);
  const activeDispute = active && byId.get(active.id);

  const runFinder = async () => {
    const q = finder.trim();
    if (q.length < 6 || !catalog) return;
    setFinding(true);
    setFound(null);
    let result = null;
    try {
      const r = await postJson('/api/disputes/match', { description: q });
      if (r.ok && Array.isArray(r.data.matches)) result = { source: r.data.source, matches: r.data.matches };
    } catch { /* offline / backend down - fall back below */ }
    if (!result) {
      result = { source: 'keywords', matches: matchDisputes(q, catalog, 4).map((m) => ({ id: m.id, why: byId.get(m.id).blurb })) };
    }
    result.matches = result.matches.filter((m) => byId.has(m.id));
    setFound(result);
    setFinding(false);
  };

  return (
    <div className="dd-root">
      <style>{DD_CSS}</style>

      {activeDispute && (
        <ActiveCard
          dispute={activeDispute}
          active={active}
          bases={catalog.bases}
          currentText={currentText}
          tool={tool}
          setTool={setTool}
          onEdit={() => setOpenId(activeDispute.id)}
          onClose={() => setActive(null)}
        />
      )}

      <div className="dd-finder">
        <label className="dd-lab" htmlFor="dd-finder-in">Not sure which one? Describe the matter</label>
        <div className="dd-row">
          <input
            id="dd-finder-in" type="text" value={finder} placeholder="e.g. client fears arrest over a cheating complaint"
            onChange={(e) => setFinder(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runFinder(); }}
          />
          <button className="btn btn-sm" onClick={runFinder} disabled={finding || finder.trim().length < 6 || !catalog}>{finding ? '…' : 'Find'}</button>
        </div>
        {found && (
          <div className="dd-found">
            <div className="dd-note">{found.matches.length ? `Best matches (${found.source === 'ai' ? 'AI-ranked, library entries only' : 'keyword match'})` : 'Nothing in the library fits that description - try different words, or browse below.'}</div>
            {found.matches.map((m) => (
              <button key={m.id} className="dd-card" onClick={() => setOpenId(m.id)}>
                <span className="dd-card-t">{byId.get(m.id).title}</span>
                <span className="dd-card-b">{m.why}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="dd-search">
        {ico.search}
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={catalog ? `Search ${catalog.meta.count} disputes…` : 'Loading…'} aria-label="Search disputes" />
      </div>

      {catalog && (
        <div className="dd-chips" role="tablist" aria-label="Dispute categories">
          <button className={`dd-chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>All</button>
          {catalog.categories.map((c) => (
            <button key={c.id} className={`dd-chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)} title={c.blurb}>
              {c.label} <span className="dd-chip-n">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {loadErr && <div className="dd-note">{loadErr}</div>}
      {!catalog && !loadErr && <div className="dd-note">Loading the library…</div>}

      <div className="dd-list">
        {catalog && list.length === 0 && <div className="dd-note">No dispute matches "{query}". Try a section number, a court, or a plain word like "bail" or "rent".</div>}
        {list.map((d) => (
          <button key={d.id} className={`dd-card ${active && active.id === d.id ? 'cur' : ''}`} onClick={() => setOpenId(d.id)}>
            <span className="dd-card-top">
              <span className="dd-card-t">{d.title}</span>
              <span className="dd-kind">{KIND_LABEL[d.kind]}</span>
            </span>
            <span className="dd-card-b">{d.blurb}</span>
            <span className="dd-card-f">{d.forum}</span>
          </button>
        ))}
      </div>

      {catalog && <div className="dd-foot">{NOTICE} Library reviewed {catalog.meta.reviewed}.</div>}

      {openId && catalog && byId.get(openId) && (
        <DisputeModal
          dispute={byId.get(openId)}
          bases={catalog.bases}
          initialFacts={active && active.id === openId ? active.facts : {}}
          hasContent={hasContent}
          onClose={() => setOpenId(null)}
          onInsert={(payload) => { onInsert({ ...payload, catLabel: (catalog.categories.find((c) => c.id === payload.dispute.cat) || {}).label || '' }); setOpenId(null); setTool('review'); }}
        />
      )}
    </div>
  );
}

// ───────────────────────── active dispute card ─────────────────────────
function ActiveCard({ dispute, active, bases, currentText, tool, setTool, onEdit, onClose }) {
  const review = useMemo(() => reviewDraft(dispute, active.facts || {}, bases, currentText), [dispute, active.facts, bases, currentText]);
  const warnCount = review.filter((r) => r.level === 'warn').length;
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [cites, setCites] = useState(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState('');

  const ask = async () => {
    if (q.trim().length < 3 || asking) return;
    setAsking(true); setErr(''); setAnswer(null);
    try {
      const r = await postJson('/api/disputes/ask', { question: q.trim(), dispute_id: dispute.id, draft_text: currentText.slice(0, 4500) });
      if (r.ok) setAnswer(r.data); else setErr(r.data.message || 'The AI could not answer right now.');
    } catch { setErr('Could not reach the server.'); }
    setAsking(false);
  };
  const verify = async () => {
    setChecking(true); setErr(''); setCites(null);
    try {
      const r = await postJson('/api/disputes/verify', { text: currentText });
      if (r.ok) setCites(r.data); else setErr(r.data.message || 'Could not check citations right now.');
    } catch { setErr('Could not reach the server.'); }
    setChecking(false);
  };

  return (
    <div className="dd-active">
      <div className="dd-active-h">
        <div>
          <div className="dd-lab" style={{ margin: 0 }}>Working on</div>
          <div className="dd-active-t">{dispute.title}</div>
        </div>
        <div className="dd-row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={onEdit}>Edit facts</button>
          <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={onClose} aria-label="Stop working on this dispute" title="Stop working on this dispute">{ico.close}</button>
        </div>
      </div>

      {active.notes && (active.notes.missing?.length > 0 || active.notes.flags?.length > 0) && (
        <div className="dd-ainote">
          {active.notes.missing?.length > 0 && <div><b>The AI says it still needs:</b> {active.notes.missing.join('; ')}.</div>}
          {active.notes.flags?.length > 0 && <div><b>{active.notes.flags.length} thing{active.notes.flags.length > 1 ? 's' : ''} tagged "verify"</b> - the AI wrote something that was not in your facts or the library entry. Amber highlights in the draft.</div>}
        </div>
      )}

      <div className="dd-tabs" role="tablist">
        {[['review', `Review${warnCount ? ` (${warnCount})` : ''}`], ['ask', 'Ask'], ['cites', 'Citations']].map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tool === id} className={`dd-tab ${tool === id ? 'on' : ''}`} onClick={() => setTool(id)}>{l}</button>
        ))}
      </div>

      {tool === 'review' && (
        <div className="dd-rev">
          {review.map((r, i) => (
            <div key={i} className={`dd-rev-i ${r.level}`}>
              <span className="dd-rev-ic">{r.level === 'ok' ? ico.ok : r.level === 'warn' ? ico.warn : ico.info}</span>
              <div><b>{r.title}</b>{r.detail && <span>{r.detail}</span>}</div>
            </div>
          ))}
        </div>
      )}

      {tool === 'ask' && (
        <div className="dd-ask">
          <div className="dd-note">Answers come only from this library entry and closely related ones. If it is not in there, it says so instead of guessing. It never cites case law.</div>
          <textarea rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What is the limitation for this filing? Which forum? What must I annex?" aria-label="Ask a question" />
          <button className="btn btn-primary btn-sm" onClick={ask} disabled={asking || q.trim().length < 3}>{asking ? 'Checking the library…' : 'Ask'}</button>
          {answer && (
            <div className="dd-answer">
              <p>{answer.answer}</p>
              {answer.flags?.length > 0 && <div className="dd-note">{answer.flags.length} item{answer.flags.length > 1 ? 's were' : ' was'} tagged "verify" because they are not in the library.</div>}
              {answer.grounded_on?.length > 0 && <div className="dd-note">From: {answer.grounded_on.map((id) => dispute.id === id ? dispute.title : id).join(', ')}</div>}
            </div>
          )}
        </div>
      )}

      {tool === 'cites' && (
        <div className="dd-ask">
          <div className="dd-note">Looks up each "Section X of the … Act" in the draft on India Code / Indian Kanoon. A hit means a page exists - it does not confirm the section says what the draft says.</div>
          <button className="btn btn-sm" onClick={verify} disabled={checking || !currentText.trim()}>{checking ? 'Searching…' : 'Check citations now'}</button>
          {cites && (
            <div className="dd-rev">
              {cites.results?.length === 0 && <div className="dd-note">{cites.message}</div>}
              {cites.results?.map((c, i) => (
                <div key={i} className={`dd-rev-i ${c.verified ? 'ok' : 'warn'}`}>
                  <span className="dd-rev-ic">{c.verified ? ico.ok : ico.warn}</span>
                  <div><b>{c.citation}</b><span>{c.verified ? <a href={c.url} target="_blank" rel="noreferrer">{c.title || c.url}</a> : 'No matching page found - check it by hand.'}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {err && <div className="dd-note dd-err">{err}</div>}
    </div>
  );
}

// ───────────────────────── modal: facts form ─────────────────────────
function DisputeModal({ dispute, bases, initialFacts, hasContent, onClose, onInsert }) {
  const groups = useMemo(() => formFields(dispute, bases), [dispute, bases]);
  const [facts, setFacts] = useState(() => ({ ...initialFacts }));
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(null); // null | 'plain' | 'ai'
  const firstRef = useRef(null);
  const set = (k, v) => setFacts((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    if (firstRef.current) firstRef.current.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const cleanFacts = () => Object.fromEntries(Object.entries(facts).filter(([, v]) => String(v ?? '').trim()));

  const insert = (slots, notes) => {
    const f = cleanFacts();
    const doc = buildDisputeDoc(dispute, f, bases, slots);
    onInsert({ dispute, facts: f, html: doc.html, text: doc.text, notes });
  };

  const go = async (mode) => {
    if (hasContent && confirm !== mode) { setConfirm(mode); return; }
    setConfirm(null);
    setErr('');
    if (mode === 'plain') { insert(null, null); return; }
    setBusy(true);
    try {
      const r = await postJson('/api/disputes/draft', { dispute_id: dispute.id, facts: cleanFacts(), instructions: instructions.trim() });
      if (r.ok && r.data.slots) {
        insert(r.data.slots, { missing: r.data.missing || [], flags: r.data.flags || [], usedAI: true });
      } else {
        setErr(`${r.data.message || 'The AI could not draft this right now.'} You can still build the skeleton without AI.`);
      }
    } catch {
      setErr('Could not reach the server, so the AI could not run. You can still build the skeleton without AI.');
    }
    setBusy(false);
  };

  const renderField = (f, i) => {
    const id = `dd-f-${f.key}`;
    const common = { id, value: facts[f.key] || '', onChange: (e) => set(f.key, e.target.value), placeholder: f.hint || '' };
    return (
      <div key={f.key} className={`dd-field ${f.type === 'textarea' ? 'wide' : ''}`}>
        <label htmlFor={id}>{f.label}</label>
        {f.type === 'textarea' ? <textarea rows={3} {...common} ref={i === 0 && f.group === 'matter' ? firstRef : undefined} />
          : <input type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} {...common} ref={i === 0 && f.group === 'matter' ? firstRef : undefined} />}
      </div>
    );
  };

  const host = document.querySelector('.autodraft-page-wrapper') || document.body;
  return createPortal(
    <div className="dd-back" onClick={() => !busy && onClose()} role="presentation">
      <style>{DD_CSS}</style>
      <div className="dd-modal" role="dialog" aria-modal="true" aria-label={dispute.title} onClick={(e) => e.stopPropagation()}>
        <div className="dd-mh">
          <div>
            <div className="dd-kind" style={{ display: 'inline-block', marginBottom: 6 }}>{KIND_LABEL[dispute.kind]}</div>
            <h3 className="dd-mt">{dispute.title}</h3>
            <div className="dd-note" style={{ marginTop: 3 }}>{dispute.doc} · {dispute.forum}</div>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">{ico.close}</button>
        </div>

        <div className="dd-mb">
          <div className="dd-form">
            <div className="dd-ftitle">Matter facts <span>Only what you type here is used. Leave blank what you do not know - it becomes a highlighted placeholder, never a guess.</span></div>
            <div className="dd-grid">{groups.matter.map(renderField)}</div>
            <div className="dd-ftitle">Parties &amp; filing details</div>
            <div className="dd-grid">{groups.setup.map((f, i) => renderField(f, i + 1))}</div>
            <div className="dd-ftitle">Instructions to the AI <span>Optional. Style or emphasis only - they cannot add law.</span></div>
            <textarea rows={2} className="dd-instr" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Keep the facts short. Stress that the applicant has cooperated with the investigation." aria-label="Instructions to the AI" />
          </div>

          <aside className="dd-side" aria-label="Library notes">
            <div className="dd-ftitle" style={{ marginTop: 0 }}>From the library</div>
            {dispute.limitation && <div className="dd-box"><b>Limitation</b><p>{dispute.limitation}</p></div>}
            {dispute.statutes.length > 0 && (
              <div className="dd-box"><b>Provisions</b>
                <ul>{dispute.statutes.map((s, i) => <li key={i}><span className="dd-ref">{s.ref}</span>{s.note ? <em> — {s.note}</em> : null}</li>)}</ul>
              </div>
            )}
            {dispute.pre.length > 0 && <div className="dd-box"><b>Before filing</b><ul>{dispute.pre.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
            {dispute.cautions.length > 0 && <div className="dd-box warn"><b>Cautions</b><ul>{dispute.cautions.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
            {dispute.annex.length > 0 && <div className="dd-box"><b>Documents to attach</b><ul>{dispute.annex.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
            <div className="dd-note">{NOTICE}</div>
          </aside>
        </div>

        <div className="dd-mf">
          {err && <div className="dd-note dd-err" style={{ flex: 1 }}>{err}</div>}
          {confirm && (
            <div className="dd-confirm">
              <span>This replaces the document currently in the editor.</span>
              <button className="btn btn-sm" onClick={() => setConfirm(null)}>Keep current</button>
              <button className="btn btn-primary btn-sm" onClick={() => go(confirm)}>Replace it</button>
            </div>
          )}
          {!confirm && (
            <>
              <button className="btn" onClick={() => go('plain')} disabled={busy} title="Fills the skeleton from the library and your facts, with no AI">Build skeleton (no AI)</button>
              {dispute.ai && (
                <button className="btn btn-primary" onClick={() => go('ai')} disabled={busy}>
                  {ico.spark}{busy ? 'Drafting from your facts…' : 'Build with AI drafting'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    host,
  );
}

const DD_CSS = `
.dd-root { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dd-lab { display: block; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.dd-note { font-size: 11.5px; line-height: 1.5; color: var(--muted); }
.dd-err { color: var(--accent); }
.dd-row { display: flex; gap: 8px; align-items: center; }
.dd-root input[type=text], .dd-search input, .dd-root textarea, .dd-modal input, .dd-modal textarea { width: 100%; box-sizing: border-box; background: var(--bg); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; color: var(--ink); font-family: inherit; line-height: 1.45; }
.dd-root textarea, .dd-modal textarea { resize: vertical; }
.dd-root input:focus, .dd-root textarea:focus, .dd-modal input:focus, .dd-modal textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.dd-search { display: flex; align-items: center; gap: 8px; background: var(--bg); border: 1px solid var(--rule); border-radius: 9px; padding: 0 10px; color: var(--muted); }
.dd-search input { border: 0; background: transparent; padding: 9px 0; outline: none !important; }
.dd-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dd-chip { border: 1px solid var(--rule); background: var(--paper); color: var(--ink-soft); border-radius: 999px; padding: 4px 10px; font-size: 11.5px; cursor: pointer; }
.dd-chip:hover { border-color: var(--muted); }
.dd-chip.on { background: var(--accent-soft); border-color: var(--accent); color: var(--ink); }
.dd-chip-n { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); margin-left: 2px; }
.dd-list, .dd-found { display: flex; flex-direction: column; gap: 8px; }
.dd-card { text-align: left; display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); border-radius: 10px; padding: 10px 12px; cursor: pointer; font-family: inherit; }
.dd-card:hover { border-color: var(--accent); }
.dd-card.cur { border-color: var(--accent); background: var(--accent-soft); }
.dd-card-top { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
.dd-card-t { font-size: 13px; font-weight: 600; line-height: 1.35; }
.dd-card-b { font-size: 12px; color: var(--ink-soft); line-height: 1.45; }
.dd-card-f { font-size: 11px; color: var(--muted); }
.dd-kind { flex-shrink: 0; font-size: 10px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule); white-space: nowrap; }
.dd-foot { font-size: 11px; color: var(--muted); line-height: 1.5; padding-top: 4px; border-top: 1px solid var(--rule); }
.dd-active { border: 1px solid var(--accent); background: var(--paper); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.dd-active-h { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
.dd-active-t { font-size: 13.5px; font-weight: 600; line-height: 1.35; }
.dd-ainote { font-size: 12px; line-height: 1.5; background: var(--major-soft); color: var(--ink); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.dd-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--rule); }
.dd-tab { border: 0; background: transparent; color: var(--muted); padding: 6px 10px; font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: inherit; }
.dd-tab.on { color: var(--ink); border-bottom-color: var(--accent); }
.dd-rev, .dd-ask { display: flex; flex-direction: column; gap: 8px; }
.dd-rev-i { display: flex; gap: 8px; font-size: 12px; line-height: 1.45; align-items: flex-start; }
.dd-rev-i b { display: block; font-weight: 600; }
.dd-rev-i span { color: var(--ink-soft); display: block; }
.dd-rev-i a { color: var(--accent); }
.dd-rev-ic { flex-shrink: 0; margin-top: 2px; }
.dd-rev-i.ok .dd-rev-ic { color: #4E9A5F; }
.dd-rev-i.warn .dd-rev-ic { color: var(--major); }
.dd-rev-i.info .dd-rev-ic { color: var(--muted); }
.dd-answer { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 8px; padding: 10px 12px; }
.dd-answer p { margin: 0 0 6px; font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; }
.dd-back { position: fixed; inset: 0; z-index: 250; background: var(--overlay, rgba(10,10,10,.6)); display: flex; align-items: flex-start; justify-content: center; padding: 20px 16px; box-sizing: border-box; }
.dd-modal { width: 1040px; max-width: 100%; max-height: calc(100vh - 96px); display: flex; flex-direction: column; background: var(--paper); color: var(--ink); border: 1px solid var(--rule); border-radius: 14px; box-shadow: var(--shadow, 0 20px 50px rgba(0,0,0,.4)); overflow: hidden; font-family: 'IBM Plex Sans', sans-serif; }
.dd-mh { display: flex; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--rule); align-items: flex-start; }
.dd-mt { margin: 0; font-size: 16px; font-weight: 600; }
.dd-mb { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(260px, 1fr); gap: 0; overflow: hidden; min-height: 0; flex: 1; }
.dd-form { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.dd-side { padding: 16px 18px; overflow-y: auto; border-left: 1px solid var(--rule); background: var(--paper-2); display: flex; flex-direction: column; gap: 10px; }
.dd-ftitle { font-size: 11.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-top: 8px; }
.dd-ftitle span { display: block; text-transform: none; letter-spacing: 0; font-weight: 400; margin-top: 3px; line-height: 1.45; }
.dd-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; }
.dd-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dd-field.wide { grid-column: 1 / -1; }
.dd-field label { font-size: 12px; color: var(--ink-soft); font-weight: 500; }
.dd-box { border: 1px solid var(--rule); background: var(--paper); border-radius: 10px; padding: 9px 11px; font-size: 12px; line-height: 1.5; }
.dd-box b { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.dd-box p { margin: 4px 0 0; }
.dd-box ul { margin: 4px 0 0; padding-left: 16px; }
.dd-box li { margin-bottom: 4px; }
.dd-box.warn { border-color: var(--major); }
.dd-ref { font-weight: 600; }
.dd-box em { color: var(--ink-soft); font-style: normal; }
.dd-mf { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; padding: 14px 20px; border-top: 1px solid var(--rule); }
.dd-confirm { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12.5px; }
@media (max-width: 860px) { .dd-mb { grid-template-columns: 1fr; overflow-y: auto; } .dd-side { border-left: 0; border-top: 1px solid var(--rule); } .dd-grid { grid-template-columns: 1fr; } .dd-form, .dd-side { overflow: visible; } }
`;
