import { useState, useEffect, useCallback, useMemo } from 'react';
import * as Ic from '../icons.jsx';
import districtsJson from '../data/districts.json';
import { formatCourtDisplayName, getMetroComplexes, resolveDistrictSelection } from '../utils/courtNameFormatter.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const TABS = [
  { id: 'supreme', label: 'Supreme Court' },
  { id: 'high', label: 'High Courts' },
  { id: 'district', label: 'District Courts' },
  { id: 'judges', label: 'Judges' },
  { id: 'rosters', label: 'Rosters' },
  { id: 'bar', label: 'Bar Councils' },
  { id: 'acts', label: 'Bare Acts' },
  { id: 'causelists', label: 'Cause Lists' },
  { id: 'courtfee', label: 'Fee Calculator' },
  { id: 'iptracker', label: 'IP Tracker' },
  { id: 'feed', label: 'Legal Feed' },
];

function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
const generateCauseListUrl = (districtUrl) => {
  if (!districtUrl) return '#';
  try { return districtUrl.replace(/\/?$/, '') + '/cause-list/'; } catch { return '#'; }
};
const fmtIpDate = (d) => {
  if (!d) return '—';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; }
};

// District complexes whose judicial-officer rosters are served live by
// /api/directory/judges. Delhi HC itself uses the national roster below.
const DISTRICT_COMPLEXES = [
  { key: 'delhi_rohini', label: 'Rohini — North District' },
  { key: 'delhi_rohini_nw', label: 'Rohini — North-West District' },
];

async function getJSON(path) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(res.status === 401
      ? 'Your session has expired. Please sign in again.'
      : `The directory service is unavailable right now (${res.status}).`);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error('The server returned an unexpected response.');
  return res.json();
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const openExternal = (url) => url && window.open(url, '_blank', 'noopener,noreferrer');

// Backend /api/court-data/<id> falls back to Delhi's roster for any id it
// doesn't recognise, so a returned court is only trusted when its name
// actually matches the court the user picked.
function sameCourt(a, b) {
  if (!a || !b) return false;
  const key = (s) => String(s).toLowerCase().replace(/high court|of|and|&|the/g, '').replace(/[^a-z]/g, '');
  const ka = key(a); const kb = key(b);
  return !!ka && !!kb && (ka.includes(kb) || kb.includes(ka));
}

function prettify(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bHc\b/g, 'HC')
    .replace(/\bSc\b/g, 'SC');
}

function Loading({ label }) {
  return <div className="lx-empty"><p>{label}</p></div>;
}
function ErrorState({ message, onRetry }) {
  return (
    <div className="lx-empty">
      <div className="lx-empty__ico"><Ic.Shield size={22} /></div>
      <h4>Couldn’t load this directory</h4>
      <p>{message}</p>
      {onRetry && <button className="lx-btn lx-btn--sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}
function Empty({ icon: Icon = Ic.Scale, title, children }) {
  return (
    <div className="lx-empty">
      <div className="lx-empty__ico"><Icon size={22} /></div>
      <h4>{title}</h4>
      <p>{children}</p>
    </div>
  );
}

export default function CourtResources() {
  const [tab, setTab] = useState('supreme');
  const [copied, setCopied] = useState('');
  const [pdfDoc, setPdfDoc] = useState(null);

  // Open a document in-app: PDFs render in an embedded viewer (streamed
  // same-origin through /api/court-pdf); interactive portals/pages still
  // open externally.
  const openDoc = (url, title) => {
    if (url && /\.pdf(\?|#|$)/i.test(url)) setPdfDoc({ url, title });
    else openExternal(url);
  };

  const copy = (text, key) => {
    if (!text) return;
    try { navigator.clipboard?.writeText(text); } catch { /* clipboard unavailable */ }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? '' : c)), 1600);
  };

  // ── Shared globals: bare acts + cause-list portals ──────────────────────
  const [globals, setGlobals] = useState({ bare_acts: [], cause_list_urls: {} });
  const [globalsState, setGlobalsState] = useState('idle');
  const loadGlobals = useCallback(async () => {
    setGlobalsState('loading');
    try {
      const data = await getJSON('/api/court-globals');
      setGlobals({
        bare_acts: asArray(data?.bare_acts),
        cause_list_urls: data?.cause_list_urls && typeof data.cause_list_urls === 'object' ? data.cause_list_urls : {},
      });
      setGlobalsState('ready');
    } catch (e) { setGlobalsState('error:' + e.message); }
  }, []);

  // ── Supreme Court roster ────────────────────────────────────────────────
  const [sc, setSc] = useState([]);
  const [scState, setScState] = useState('idle');
  const [scQ, setScQ] = useState('');
  const loadSc = useCallback(async () => {
    setScState('loading');
    try { setSc(asArray(await getJSON('/api/directory/supreme-court'))); setScState('ready'); }
    catch (e) { setScState('error:' + e.message); }
  }, []);

  // ── High Courts: searchable list + per-court detail ─────────────────────
  const [hcList, setHcList] = useState([]);
  const [hcListState, setHcListState] = useState('idle');
  const [hcQ, setHcQ] = useState('');
  const [selectedHc, setSelectedHc] = useState(null);
  const [hcDetail, setHcDetail] = useState({ hc: null, judges: [], forms: [], trusted: false });
  const [hcDetailState, setHcDetailState] = useState('idle');

  const loadHcList = useCallback(async () => {
    setHcListState('loading');
    try {
      const data = await getJSON('/api/courts/high-courts');
      setHcList(asArray(data).filter((c) => c && c.id));
      setHcListState('ready');
    } catch (e) { setHcListState('error:' + e.message); }
  }, []);

  const openHighCourt = useCallback(async (court) => {
    setSelectedHc(court);
    setHcDetailState('loading');
    try {
      const data = await getJSON(`/api/court-data/${encodeURIComponent(court.id)}`);
      const trusted = sameCourt(data?.hc?.name, court.name);
      setHcDetail({
        hc: data?.hc && typeof data.hc === 'object' ? data.hc : null,
        judges: trusted ? asArray(data?.judges) : [],
        forms: trusted ? asArray(data?.forms) : [],
        trusted,
      });
      setHcDetailState('ready');
    } catch (e) { setHcDetailState('error:' + e.message); }
  }, []);

  // ── Judges: national roster + district officers ─────────────────────────
  const [jMode, setJMode] = useState('national');
  const [national, setNational] = useState({ judges: [], errors: [] });
  const [nationalState, setNationalState] = useState('idle');
  const [jQ, setJQ] = useState('');
  const [courtFilter, setCourtFilter] = useState('All');
  const loadNational = useCallback(async () => {
    setNationalState('loading');
    try {
      const data = await getJSON('/api/courts/judges');
      setNational({ judges: asArray(data?.judges), errors: asArray(data?.errors) });
      setNationalState('ready');
    } catch (e) { setNationalState('error:' + e.message); }
  }, []);

  const [distKey, setDistKey] = useState(DISTRICT_COMPLEXES[0].key);
  const [distJudges, setDistJudges] = useState([]);
  const [distState, setDistState] = useState('idle');
  const loadDistrict = useCallback(async (key) => {
    setDistState('loading');
    try { setDistJudges(asArray(await getJSON(`/api/directory/judges?district=${encodeURIComponent(key)}`))); setDistState('ready'); }
    catch (e) { setDistState('error:' + e.message); }
  }, []);

  // ── Legal feed ──────────────────────────────────────────────────────────
  const [events, setEvents] = useState([]);
  const [eventsState, setEventsState] = useState('idle');
  const [eventCat, setEventCat] = useState('all');
  const loadEvents = useCallback(async () => {
    setEventsState('loading');
    try {
      const data = await getJSON('/api/legal-events');
      if (data?.error) throw new Error(data.error);
      setEvents(asArray(data?.events));
      setEventsState('ready');
    } catch (e) { setEventsState('error:' + e.message); }
  }, []);

  // ── Court rosters (sitting / bail / duty / vacation) ────────────────────
  const [rosters, setRosters] = useState([]);
  const [rostersState, setRostersState] = useState('idle');
  const [rosterCat, setRosterCat] = useState('all');
  const [rosterQ, setRosterQ] = useState('');
  const loadRosters = useCallback(async () => {
    setRostersState('loading');
    try { const data = await getJSON('/api/court-rosters'); setRosters(asArray(data?.rosters)); setRostersState('ready'); }
    catch (e) { setRostersState('error:' + e.message); }
  }, []);

  // ── Bar associations / councils directory ───────────────────────────────
  const [bars, setBars] = useState([]);
  const [barsState, setBarsState] = useState('idle');
  const [barQ, setBarQ] = useState('');
  const loadBars = useCallback(async () => {
    setBarsState('loading');
    try { const data = await getJSON('/api/court-bar-associations'); setBars(asArray(data?.bar_associations)); setBarsState('ready'); }
    catch (e) { setBarsState('error:' + e.message); }
  }, []);

  // ── Lazy per-tab loading ────────────────────────────────────────────────
  useEffect(() => {
    if (tab === 'supreme' && scState === 'idle') loadSc();
    if (tab === 'high' && hcListState === 'idle') loadHcList();
    if (tab === 'judges' && nationalState === 'idle') loadNational();
    if ((tab === 'acts' || tab === 'causelists') && globalsState === 'idle') loadGlobals();
    if (tab === 'feed' && eventsState === 'idle') loadEvents();
    if (tab === 'rosters' && rostersState === 'idle') loadRosters();
    if (tab === 'bar' && barsState === 'idle') loadBars();
  }, [tab, scState, hcListState, nationalState, globalsState, eventsState, rostersState, barsState,
      loadSc, loadHcList, loadNational, loadGlobals, loadEvents, loadRosters, loadBars]);

  useEffect(() => { if (jMode === 'district') loadDistrict(distKey); }, [jMode, distKey, loadDistrict]);

  // ── Derived views ───────────────────────────────────────────────────────
  const scRows = useMemo(() => {
    const q = scQ.trim().toLowerCase();
    return sc.filter((c) => !q
      || String(c.court_room).toLowerCase().includes(q)
      || String(c.judges || '').toLowerCase().includes(q));
  }, [sc, scQ]);

  const hcRows = useMemo(() => {
    const q = hcQ.trim().toLowerCase();
    return hcList.filter((c) => !q
      || String(c.name || '').toLowerCase().includes(q)
      || String(c.jurisdiction || '').toLowerCase().includes(q));
  }, [hcList, hcQ]);

  const courtOptions = useMemo(() => {
    const set = new Set(national.judges.map((j) => j.court).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [national.judges]);

  const nationalRows = useMemo(() => {
    const q = jQ.trim().toLowerCase();
    return national.judges.filter((j) =>
      (courtFilter === 'All' || j.court === courtFilter) &&
      (!q || String(j.name || '').toLowerCase().includes(q) || String(j.designation || '').toLowerCase().includes(q)));
  }, [national.judges, jQ, courtFilter]);

  const eventCats = useMemo(() => {
    const set = new Set(events.map((e) => e.category).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [events]);
  const eventRows = useMemo(
    () => events.filter((e) => eventCat === 'all' || e.category === eventCat),
    [events, eventCat]);

  const [actQ, setActQ] = useState('');
  const actRows = useMemo(() => {
    const q = actQ.trim().toLowerCase();
    return globals.bare_acts
      .map((a) => ({ name: a?.name || a?.title || a?.act || 'Untitled', url: a?.url || a?.link || a?.href || '' }))
      .filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [globals.bare_acts, actQ]);

  const causeRows = useMemo(() =>
    Object.entries(globals.cause_list_urls || {})
      .filter(([, url]) => typeof url === 'string' && url)
      .map(([key, url]) => ({ label: prettify(key), url })),
  [globals.cause_list_urls]);

  const rosterCats = useMemo(() => {
    const set = new Set(rosters.map((r) => r.category).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [rosters]);
  const rosterRows = useMemo(() => {
    const q = rosterQ.trim().toLowerCase();
    return rosters.filter((r) =>
      (rosterCat === 'all' || r.category === rosterCat) &&
      (!q || String(r.title || '').toLowerCase().includes(q) || String(r.court || '').toLowerCase().includes(q)));
  }, [rosters, rosterCat, rosterQ]);

  const barRows = useMemo(() => {
    const q = barQ.trim().toLowerCase();
    return bars.filter((b) => !q
      || String(b.name || '').toLowerCase().includes(q)
      || String(b.state || '').toLowerCase().includes(q)
      || String(b.kind || '').toLowerCase().includes(q));
  }, [bars, barQ]);

  const errMsg = (s) => (s.startsWith('error:') ? s.slice(6) : '');

  // ── District Courts ────────────────────────────────────────────────────
  const [districtsDb] = useState(districtsJson);
  const [selectedDistState, setSelectedDistState] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const stateLabelMap = useMemo(() => ({
    DELHI: 'Delhi', MAHARASHTRA: 'Maharashtra', KARNATAKA: 'Karnataka', TAMIL_NADU: 'Tamil Nadu',
    GUJARAT: 'Gujarat', WEST_BENGAL: 'West Bengal', UTTAR_PRADESH: 'Uttar Pradesh', PUNJAB: 'Punjab',
    RAJASTHAN: 'Rajasthan', KERALA: 'Kerala', TELANGANA: 'Telangana', HARYANA: 'Haryana',
    ANDHRA_PRADESH: 'Andhra Pradesh', BIHAR: 'Bihar', ODISHA: 'Odisha', MADHYA_PRADESH: 'Madhya Pradesh',
  }), []);

  // ── Court Fee ──────────────────────────────────────────────────────────
  const [feeAmount, setFeeAmount] = useState('');
  const [feeCourt, setFeeCourt] = useState('delhi_hc');
  const [calculatedFee, setCalculatedFee] = useState(null);
  const [feeNote, setFeeNote] = useState('');
  const [calculatingFee, setCalculatingFee] = useState(false);
  async function handleCalculateFee(e) {
    e.preventDefault();
    if (!feeAmount) return;
    setCalculatingFee(true); setCalculatedFee(null); setFeeNote('');
    try {
      const r = await fetch(`${API_BASE}/api/calculate-fee`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken() },
        body: JSON.stringify({ amount: parseFloat(feeAmount), court_type: feeCourt }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.message || 'Could not calculate the fee.');
      setCalculatedFee(d.fee ?? d.calculated_fee ?? 0);
      setFeeNote(d.note || d.message || '');
    } catch (err) { setCalculatedFee('Error'); setFeeNote(err.message); }
    finally { setCalculatingFee(false); }
  }

  // ── IP Tracker ─────────────────────────────────────────────────────────
  const [ipAssets, setIpAssets] = useState([]);
  const [loadingIP, setLoadingIP] = useState(false);
  const [ipErr, setIpErr] = useState('');
  const [ipModal, setIpModal] = useState(null); // {mode:'add'|'edit', asset?}
  const loadIpAssets = useCallback(async () => {
    setLoadingIP(true); setIpErr('');
    try {
      const r = await fetch(`${API_BASE}/api/ip/list`, { credentials: 'include' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Could not load IP assets.');
      setIpAssets(Array.isArray(d) ? d : (d.assets || []));
    } catch (e) { setIpErr(e.message); }
    finally { setLoadingIP(false); }
  }, []);
  useEffect(() => { if (tab === 'iptracker') loadIpAssets(); }, [tab, loadIpAssets]);
  async function saveIpAsset(payload, id) {
    const url = id ? `${API_BASE}/api/ip/update/${id}` : `${API_BASE}/api/ip/add`;
    const r = await fetch(url, {
      method: id ? 'PUT' : 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrfToken() },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || 'Could not save.'); }
  }
  async function deleteIpAsset(id, title) {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    const r = await fetch(`${API_BASE}/api/ip/delete/${id}`, {
      method: 'DELETE', credentials: 'include', headers: { 'X-CSRF-TOKEN': csrfToken() },
    });
    if (r.ok) loadIpAssets();
    else alert('Could not delete asset.');
  }

  return (
    <div className="lx-page lx-rise">
      <div className="ph">
        <span className="ph__eyebrow">Reference</span>
        <h1 className="ph__title">Court Resources</h1>
        <p className="ph__sub">The Supreme Court, every High Court, judges, sitting &amp; bail rosters, bar councils, bare acts and daily cause lists — one considered desk.</p>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── SUPREME COURT ── */}
      {tab === 'supreme' && (
        <section className="lx-stack" style={{ gap: 20 }}>
          <div className="lx-between" style={{ flexWrap: 'wrap', gap: 14 }}>
            <div className="lx-field" style={{ height: 40, maxWidth: 300 }}>
              <Ic.Search size={15} />
              <input value={scQ} onChange={(e) => setScQ(e.target.value)} placeholder="Filter by court or judge…" style={{ fontSize: 14 }} />
            </div>
            {causeRows.length === 0 && (
              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => openExternal('https://www.sci.gov.in/cause-list/')}>
                <Ic.Calendar size={15} /> Official cause list
              </button>
            )}
          </div>

          <div className="lx-card lx-card--pad">
            {scState === 'loading' ? <Loading label="Loading the Supreme Court directory…" />
              : scState.startsWith('error') ? <ErrorState message={errMsg(scState)} onRetry={loadSc} />
              : scRows.length === 0 ? <Empty icon={Ic.Gavel} title="No courtrooms here">{sc.length === 0 ? 'The roster is empty right now.' : 'Nothing matches that search.'}</Empty>
              : (
                <div className="lx-list">
                  {scRows.map((c) => {
                    const hasVc = typeof c.vc_link === 'string' && c.vc_link.startsWith('http');
                    return (
                      <div className="lx-item" key={c.id || c.court_room}>
                        <div className="lx-item__ico"><Ic.Gavel size={18} /></div>
                        <div className="lx-item__body">
                          <div className="lx-item__title">Court {c.court_room}</div>
                          <div className="lx-item__meta">{c.judges || 'Vacant court'}{c.court_master_email ? ` · ${c.court_master_email}` : ''}</div>
                        </div>
                        {hasVc && (
                          <div className="lx-row" style={{ gap: 8 }}>
                            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => copy(c.vc_link, 'sc' + c.id)}>
                              <Ic.Copy size={14} /> {copied === 'sc' + c.id ? 'Copied' : 'Copy'}
                            </button>
                            <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => openExternal(c.vc_link)}>
                              Join court <Ic.Arrow size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
        </section>
      )}

      {/* ── HIGH COURTS ── */}
      {tab === 'high' && (
        <div className="lx-stack" style={{ gap: 20 }}>
          <div className="lx-field" style={{ height: 40, maxWidth: 340 }}>
            <Ic.Search size={15} />
            <input value={hcQ} onChange={(e) => setHcQ(e.target.value)} placeholder="Search all 25 High Courts…" style={{ fontSize: 14 }} />
          </div>

          <div className="lx-card lx-card--pad">
            {hcListState === 'loading' ? <Loading label="Loading High Courts…" />
              : hcListState.startsWith('error') ? <ErrorState message={errMsg(hcListState)} onRetry={loadHcList} />
              : hcRows.length === 0 ? <Empty title="No courts found">Try a different search term.</Empty>
              : (
                <div className="lx-list">
                  {hcRows.map((c) => (
                    <div className="lx-item" key={c.id} onClick={() => openHighCourt(c)} style={{ cursor: 'pointer' }}>
                      <div className="lx-item__ico"><Ic.Scale size={18} /></div>
                      <div className="lx-item__body">
                        <div className="lx-item__title">{c.name}</div>
                        <div className="lx-item__meta">{c.jurisdiction || 'High Court'}</div>
                      </div>
                      {selectedHc?.id === c.id
                        ? <span className="lx-badge lx-badge--ok">Selected</span>
                        : <Ic.Chevron size={16} />}
                    </div>
                  ))}
                </div>
              )}
          </div>

          {selectedHc && (
            <div className="lx-card lx-card--pad">
              <div className="lx-section-head"><h3>{selectedHc.name}</h3></div>
              {hcDetailState === 'loading' ? <Loading label="Opening the court directory…" />
                : hcDetailState.startsWith('error') ? <ErrorState message={errMsg(hcDetailState)} onRetry={() => openHighCourt(selectedHc)} />
                : !hcDetail.trusted ? (
                  <Empty icon={Ic.Scale} title="Roster not yet published">
                    The judges roster and forms for {selectedHc.name} haven’t been added to the directory yet. Its official portals remain accessible from the eCourts services.
                  </Empty>
                ) : (
                  <div className="lx-stack" style={{ gap: 26 }}>
                    <section>
                      <div className="lx-section-head" style={{ marginBottom: 12 }}>
                        <h3 style={{ fontSize: 15 }}>Judges roster</h3>
                        <span className="lx-item__meta">{hcDetail.judges.length} sitting</span>
                      </div>
                      {hcDetail.judges.length === 0 ? <Empty icon={Ic.Users} title="No roster loaded">This court’s sitting roster isn’t available yet.</Empty> : (
                        <div className="lx-list">
                          {hcDetail.judges.map((j, i) => {
                            const hasVc = typeof j.vc === 'string' && j.vc.startsWith('http');
                            return (
                              <div className="lx-item" key={i}>
                                <div className="lx-item__body">
                                  <div className="lx-item__title">{j.name}</div>
                                  <div className="lx-item__meta">{[j.room, j.email].filter(Boolean).join(' · ') || '—'}</div>
                                </div>
                                {hasVc && (
                                  <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => openExternal(j.vc)}>
                                    <Ic.Link size={14} /> Virtual court
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>

                    {hcDetail.forms.length > 0 && (
                      <section>
                        <div className="lx-section-head" style={{ marginBottom: 12 }}><h3 style={{ fontSize: 15 }}>Forms &amp; templates</h3></div>
                        <div className="lx-list">
                          {hcDetail.forms.map((f, i) => (
                            <div className="lx-item" key={i} onClick={() => openDoc(f.url, f.name)} style={{ cursor: f.url ? 'pointer' : 'default' }}>
                              <div className="lx-item__ico"><Ic.Doc size={18} /></div>
                              <div className="lx-item__body">
                                <div className="lx-item__title">{f.name}</div>
                                <div className="lx-item__meta">{[f.court, f.cat].filter(Boolean).join(' · ') || 'Template'}</div>
                              </div>
                              {f.url && <Ic.Arrow size={15} />}
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {/* ── JUDGES ── */}
      {tab === 'judges' && (
        <div className="lx-stack" style={{ gap: 20 }}>
          <div className="chip-row">
            <span className={`chip ${jMode === 'national' ? 'is-on' : ''}`} onClick={() => setJMode('national')}>Superior courts</span>
            <span className={`chip ${jMode === 'district' ? 'is-on' : ''}`} onClick={() => setJMode('district')}>District officers</span>
          </div>

          {jMode === 'national' ? (
            <>
              <div className="lx-between" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div className="lx-field" style={{ height: 40, maxWidth: 300 }}>
                  <Ic.Search size={15} />
                  <input value={jQ} onChange={(e) => setJQ(e.target.value)} placeholder="Search by name or designation…" style={{ fontSize: 14 }} />
                </div>
                <select className="inp" style={{ width: 'auto', minWidth: 200 }} value={courtFilter} onChange={(e) => setCourtFilter(e.target.value)}>
                  {courtOptions.map((c) => <option key={c} value={c}>{c === 'All' ? 'All courts' : c}</option>)}
                </select>
              </div>

              <div className="lx-card lx-card--pad">
                {nationalState === 'loading' ? <Loading label="Gathering the judges directory…" />
                  : nationalState.startsWith('error') ? <ErrorState message={errMsg(nationalState)} onRetry={loadNational} />
                  : nationalRows.length === 0 ? <Empty icon={Ic.Users} title="No judges to show">{national.judges.length === 0 ? 'The live sources returned no judges right now.' : 'Nothing matches those filters.'}</Empty>
                  : (
                    <>
                      {national.errors.length > 0 && (
                        <p className="lx-item__meta" style={{ marginBottom: 14 }}>Some sources were slow to respond — this list may be partial.</p>
                      )}
                      <div className="lx-list">
                        {nationalRows.map((j, i) => (
                          <div className="lx-item" key={`${j.court}-${j.name}-${i}`}>
                            <div className="lx-item__body">
                              <div className="lx-item__title">{j.name}</div>
                              <div className="lx-item__meta">{[j.designation, j.term].filter(Boolean).join(' · ') || '—'}</div>
                            </div>
                            {j.court && <span className="lx-badge lx-badge--muted">{j.court}</span>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
              </div>
            </>
          ) : (
            <>
              <select className="inp" style={{ width: 'auto', minWidth: 240, maxWidth: '100%' }} value={distKey} onChange={(e) => setDistKey(e.target.value)}>
                {DISTRICT_COMPLEXES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </select>

              <div className="lx-card lx-card--pad">
                {distState === 'loading' ? <Loading label="Loading judicial officers…" />
                  : distState.startsWith('error') ? <ErrorState message={errMsg(distState)} onRetry={() => loadDistrict(distKey)} />
                  : distJudges.length === 0 ? <Empty icon={Ic.Users} title="No officers listed">This complex has no roster published right now.</Empty>
                  : (
                    <div className="lx-list">
                      {distJudges.map((j) => {
                        const hasVc = typeof j.vc_link === 'string' && j.vc_link.startsWith('http');
                        return (
                          <div className="lx-item" key={j.id}>
                            <div className="lx-item__body">
                              <div className="lx-item__title">{j.hmj || j.name || 'Judicial officer'}</div>
                              <div className="lx-item__meta">{[j.designation, j.court_room && `Court ${j.court_room}`, j.email_id].filter(Boolean).join(' · ') || '—'}</div>
                            </div>
                            {j.vc_meeting_id && (
                              <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => copy(j.vc_meeting_id, 'd' + j.id)}>
                                <Ic.Copy size={14} /> {copied === 'd' + j.id ? 'Copied' : 'Meeting ID'}
                              </button>
                            )}
                            {hasVc && (
                              <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => openExternal(j.vc_link)}>
                                Join <Ic.Arrow size={14} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── BARE ACTS ── */}
      {tab === 'acts' && (
        <div className="lx-stack" style={{ gap: 20 }}>
          <div className="lx-field" style={{ height: 40, maxWidth: 340 }}>
            <Ic.Search size={15} />
            <input value={actQ} onChange={(e) => setActQ(e.target.value)} placeholder="Search bare acts…" style={{ fontSize: 14 }} />
          </div>
          <div className="lx-card lx-card--pad">
            {globalsState === 'loading' ? <Loading label="Loading the statute library…" />
              : globalsState.startsWith('error') ? <ErrorState message={errMsg(globalsState)} onRetry={loadGlobals} />
              : actRows.length === 0 ? <Empty icon={Ic.Doc} title="No acts found">{globals.bare_acts.length === 0 ? 'No statutes are published right now.' : 'Nothing matches that search.'}</Empty>
              : (
                <div className="lx-list">
                  {actRows.map((a, i) => (
                    <div className="lx-item" key={i} onClick={() => openExternal(a.url)} style={{ cursor: a.url ? 'pointer' : 'default' }}>
                      <div className="lx-item__ico"><Ic.Doc size={18} /></div>
                      <div className="lx-item__body"><div className="lx-item__title">{a.name}</div></div>
                      {a.url && <span className="lx-row" style={{ gap: 6, color: 'var(--accent-ink)', fontSize: 12.5, fontWeight: 500 }}>Read <Ic.Arrow size={14} /></span>}
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}

      {/* ── CAUSE LISTS ── */}
      {tab === 'causelists' && (
        <div className="lx-card lx-card--pad">
          {globalsState === 'loading' ? <Loading label="Loading cause-list portals…" />
            : globalsState.startsWith('error') ? <ErrorState message={errMsg(globalsState)} onRetry={loadGlobals} />
            : causeRows.length === 0 ? <Empty icon={Ic.Calendar} title="No portals listed">Daily cause-list portals haven’t been published to the directory yet.</Empty>
            : (
              <div className="lx-list">
                {causeRows.map((r, i) => (
                  <div className="lx-item" key={i} onClick={() => openExternal(r.url)} style={{ cursor: 'pointer' }}>
                    <div className="lx-item__ico"><Ic.Calendar size={18} /></div>
                    <div className="lx-item__body">
                      <div className="lx-item__title">{r.label}</div>
                      <div className="lx-item__meta">Daily cause list &amp; board</div>
                    </div>
                    <Ic.Globe size={16} />
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {/* ── ROSTERS ── */}
      {tab === 'rosters' && (
        <div className="lx-stack" style={{ gap: 20 }}>
          <div className="lx-between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="chip-row">
              {rosterCats.map((c) => (
                <span key={c} className={`chip ${rosterCat === c ? 'is-on' : ''}`} onClick={() => setRosterCat(c)} style={{ textTransform: 'capitalize' }}>
                  {c === 'all' ? 'All' : c}
                </span>
              ))}
            </div>
            <div className="lx-field" style={{ height: 40, maxWidth: 280 }}>
              <Ic.Search size={15} />
              <input value={rosterQ} onChange={(e) => setRosterQ(e.target.value)} placeholder="Filter rosters…" style={{ fontSize: 14 }} />
            </div>
          </div>

          <div className="lx-card lx-card--pad">
            {rostersState === 'loading' ? <Loading label="Loading court rosters…" />
              : rostersState.startsWith('error') ? <ErrorState message={errMsg(rostersState)} onRetry={loadRosters} />
              : rosterRows.length === 0 ? <Empty icon={Ic.Calendar} title="No rosters published">{rosters.length === 0 ? 'The latest sitting, bail, duty and vacation rosters appear here once the daily capture has run.' : 'Nothing matches those filters.'}</Empty>
              : (
                <div className="lx-list">
                  {rosterRows.map((r, i) => (
                    <div className="lx-item" key={r.url || i} onClick={() => openDoc(r.url, r.title)} style={{ cursor: r.url ? 'pointer' : 'default', alignItems: 'flex-start' }}>
                      <div className="lx-item__ico"><Ic.Doc size={18} /></div>
                      <div className="lx-item__body">
                        <div className="lx-row" style={{ gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          {r.category && <span className="lx-badge lx-badge--muted" style={{ textTransform: 'capitalize' }}>{r.category}</span>}
                          {r.effective_date && <span className="lx-item__meta">w.e.f. {r.effective_date}</span>}
                        </div>
                        <div className="lx-item__title" style={{ whiteSpace: 'normal' }}>{r.title}</div>
                        <div className="lx-item__meta">{r.court}</div>
                      </div>
                      {r.url && <Ic.Arrow size={15} />}
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}

      {/* ── BAR COUNCILS ── */}
      {tab === 'bar' && (
        <div className="lx-stack" style={{ gap: 20 }}>
          <div className="lx-field" style={{ height: 40, maxWidth: 340 }}>
            <Ic.Search size={15} />
            <input value={barQ} onChange={(e) => setBarQ(e.target.value)} placeholder="Search bar councils & associations…" style={{ fontSize: 14 }} />
          </div>
          <div className="lx-card lx-card--pad">
            {barsState === 'loading' ? <Loading label="Loading the bar directory…" />
              : barsState.startsWith('error') ? <ErrorState message={errMsg(barsState)} onRetry={loadBars} />
              : barRows.length === 0 ? <Empty icon={Ic.Scale} title="No bodies listed">{bars.length === 0 ? 'The bar directory hasn’t been populated yet. Verified councils and associations appear here once added.' : 'Nothing matches that search.'}</Empty>
              : (
                <div className="lx-list">
                  {barRows.map((b, i) => (
                    <div className="lx-item" key={b.url || i} onClick={() => openExternal(b.url)} style={{ cursor: b.url ? 'pointer' : 'default' }}>
                      <div className="lx-item__ico"><Ic.Scale size={18} /></div>
                      <div className="lx-item__body">
                        <div className="lx-item__title">{b.name}</div>
                        <div className="lx-item__meta">{[b.state, b.phone, b.email].filter(Boolean).join(' · ') || 'Bar body'}</div>
                      </div>
                      {b.kind && <span className="lx-badge lx-badge--muted">{b.kind}</span>}
                      {b.url && <Ic.Arrow size={15} />}
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}

      {/* ── LEGAL FEED ── */}
      {/* ── DISTRICT COURTS ── */}
      {tab === 'district' && (
        <section className="lx-stack" style={{ gap: 20 }}>
          <div className="lx-between" style={{ flexWrap: 'wrap', gap: 14 }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: 'var(--ink)' }}>District Courts</h2>
              <p className="lx-muted">Portals and daily cause lists for subordinate judiciary.</p>
            </div>
          </div>
          <div className="lx-card lx-card--pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div className="lx-muted" style={{ fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>State</div>
              <select value={selectedDistState} onChange={(e) => { setSelectedDistState(e.target.value); setSelectedDistrict(''); }}
                style={{ width: '100%', height: 42, border: '1px solid var(--rule)', borderRadius: 10, padding: '0 12px', background: 'var(--bg-card)', color: 'var(--ink)' }}>
                <option value="">Select state</option>
                {Object.keys(districtsDb).sort().map(st => (<option key={st} value={st}>{stateLabelMap[st] || st}</option>))}
              </select>
            </div>
            <div>
              <div className="lx-muted" style={{ fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>District court</div>
              <select value={selectedDistrict} onChange={(e) => setSelectedDistrict(e.target.value)} disabled={!selectedDistState}
                style={{ width: '100%', height: 42, border: '1px solid var(--rule)', borderRadius: 10, padding: '0 12px', background: 'var(--bg-card)', color: 'var(--ink)', opacity: selectedDistState ? 1 : 0.5 }}>
                <option value="">Select district</option>
                {selectedDistState && (() => {
                  const options = [];
                  for (const d of (districtsDb[selectedDistState] || [])) {
                    const complexes = getMetroComplexes(selectedDistState, d.name);
                    if (complexes) complexes.forEach((label, i) => options.push({ value: `${d.name}::${i}`, label }));
                    else options.push({ value: d.name, label: formatCourtDisplayName(selectedDistState, d.name) });
                  }
                  options.sort((a, b) => a.label.localeCompare(b.label));
                  return options.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>));
                })()}
              </select>
            </div>
          </div>
          {selectedDistrict ? (() => {
            const { realDistrictName, displayName } = resolveDistrictSelection(selectedDistState, selectedDistrict);
            const distData = (districtsDb[selectedDistState] || []).find(d => d.name === realDistrictName);
            const officialUrl = distData?.url || null;
            const causeListUrl = generateCauseListUrl(officialUrl);
            return (
              <div className="lx-card lx-card--pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="lx-between">
                  <div>
                    <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, color: 'var(--ink)' }}>{displayName}</div>
                    <div className="lx-muted" style={{ fontSize: 13 }}>District & Sessions Court · Subordinate Judiciary</div>
                  </div>
                  <span className="lx-badge">{stateLabelMap[selectedDistState] || selectedDistState}</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="lx-btn lx-btn--primary lx-btn--sm" disabled={!officialUrl} onClick={() => openExternal(officialUrl)}>
                    <Ic.Shield size={14} /> Official website
                  </button>
                  <button className="lx-btn lx-btn--ghost lx-btn--sm" disabled={causeListUrl === '#'} onClick={() => openExternal(causeListUrl)}>
                    <Ic.Scale size={14} /> Daily cause list
                  </button>
                </div>
              </div>
            );
          })() : (
            <Empty icon={Ic.Scale} title="Select a district">Pick a state and district court above to reveal portal access.</Empty>
          )}
        </section>
      )}

      {/* ── COURT FEE CALCULATOR ── */}
      {tab === 'courtfee' && (
        <section className="lx-stack" style={{ gap: 20 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: 'var(--ink)' }}>Court Fee Calculator</h2>
            <p className="lx-muted">Compute standardised court fees for civil suits and petition filings.</p>
          </div>
          <form className="lx-card lx-card--pad" onSubmit={handleCalculateFee} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 520 }}>
            <div>
              <div className="lx-muted" style={{ fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>Claim value (₹)</div>
              <input type="number" min="0" required value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} placeholder="e.g. 500000"
                style={{ width: '100%', height: 42, border: '1px solid var(--rule)', borderRadius: 10, padding: '0 12px', background: 'var(--bg-card)', color: 'var(--ink)' }} />
            </div>
            <div>
              <div className="lx-muted" style={{ fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>Jurisdiction / Suit type</div>
              <select value={feeCourt} onChange={(e) => setFeeCourt(e.target.value)}
                style={{ width: '100%', height: 42, border: '1px solid var(--rule)', borderRadius: 10, padding: '0 12px', background: 'var(--bg-card)', color: 'var(--ink)' }}>
                <option value="delhi_hc">Delhi HC — Commercial Suit</option>
                <option value="bombay_hc">Bombay HC — Original Side Civil Suit</option>
                <option value="madras_hc">Madras HC — Civil Suit</option>
                <option value="sc_filing">Supreme Court — SLP</option>
              </select>
            </div>
            <button type="submit" className="lx-btn lx-btn--primary" style={{ alignSelf: 'flex-start' }} disabled={calculatingFee || !feeAmount}>
              <Ic.Sparkle size={14} /> {calculatingFee ? 'Calculating…' : 'Calculate fee'}
            </button>
          </form>
          {calculatedFee !== null && (
            <div className="lx-card lx-card--pad" style={{ maxWidth: 520 }}>
              <div className="lx-muted" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>Estimated filing stamp duty</div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 600, color: 'var(--ink)', marginTop: 6 }}>
                {typeof calculatedFee === 'number' ? `₹ ${calculatedFee.toLocaleString('en-IN')}` : calculatedFee}
              </div>
              {feeNote && <p className="lx-muted" style={{ marginTop: 8, fontSize: 13 }}>{feeNote}</p>}
            </div>
          )}
        </section>
      )}

      {/* ── IP TRACKER ── */}
      {tab === 'iptracker' && (
        <section className="lx-stack" style={{ gap: 20 }}>
          <div className="lx-between" style={{ flexWrap: 'wrap', gap: 14 }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: 'var(--ink)' }}>IP Asset Tracker</h2>
              <p className="lx-muted">Trademarks, patents and copyrights with renewal alerts.</p>
            </div>
            <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={() => setIpModal({ mode: 'add' })}>
              <Ic.Plus size={14} /> Add IP asset
            </button>
          </div>
          {loadingIP ? <Loading label="Loading IP portfolio…" />
            : ipErr ? <ErrorState message={ipErr} onRetry={loadIpAssets} />
            : ipAssets.length === 0 ? <Empty icon={Ic.Shield} title="No assets tracked yet">Add trademarks, patents or copyrights to see renewal alerts here.</Empty>
            : (
              <div className="lx-card" style={{ overflow: 'hidden' }}>
                <div className="lx-list">
                  {ipAssets.map((a) => {
                    let alertColor = ''; let renewalText = fmtIpDate(a.renewal_due);
                    if (a.renewal_due) {
                      const today = new Date(); today.setHours(0,0,0,0);
                      const days = Math.round((new Date(a.renewal_due + 'T00:00:00') - today) / 86400000);
                      if (days < 0) { renewalText = `${fmtIpDate(a.renewal_due)} · OVERDUE`; alertColor = 'var(--accent-danger, #c0392b)'; }
                      else if (days <= 30) { renewalText = `${fmtIpDate(a.renewal_due)} · ${days}d`; alertColor = 'var(--accent-warning, #d68910)'; }
                    }
                    return (
                      <div className="lx-item" key={a.id} style={{ padding: '14px 16px' }}>
                        <div className="lx-item__ico"><Ic.Shield size={18} /></div>
                        <div className="lx-item__body" style={{ flex: 2 }}>
                          <div className="lx-item__title">{a.title}</div>
                          <div className="lx-item__meta">
                            {a.ip_type} · {a.registration_number || 'no reg #'} · filed {fmtIpDate(a.filing_date)}
                          </div>
                        </div>
                        <div style={{ fontSize: 12.5, color: alertColor || 'var(--muted)', fontWeight: alertColor ? 700 : 400, minWidth: 160, textAlign: 'right' }}>
                          {renewalText}
                        </div>
                        <span className={`lx-badge lx-badge--${a.status === 'Active' ? 'ok' : a.status === 'Expired' ? 'risk' : 'warn'}`}>{a.status || '—'}</span>
                        <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setIpModal({ mode: 'edit', asset: a })}>Edit</button>
                        <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => deleteIpAsset(a.id, a.title)}>Delete</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          {ipModal && (
            <IpAssetModal
              initial={ipModal.asset}
              onClose={() => setIpModal(null)}
              onSave={async (payload) => {
                try { await saveIpAsset(payload, ipModal.asset?.id); setIpModal(null); loadIpAssets(); }
                catch (e) { alert(e.message); }
              }}
            />
          )}
        </section>
      )}

      {tab === 'feed' && (
        <div className="lx-stack" style={{ gap: 20 }}>
          <div className="lx-between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="chip-row">
              {eventCats.map((c) => (
                <span key={c} className={`chip ${eventCat === c ? 'is-on' : ''}`} onClick={() => setEventCat(c)} style={{ textTransform: 'capitalize' }}>
                  {c === 'all' ? 'All' : c}
                </span>
              ))}
            </div>
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={loadEvents} disabled={eventsState === 'loading'}>
              <Ic.Sparkle size={14} /> Refresh
            </button>
          </div>

          <div className="lx-card lx-card--pad">
            {eventsState === 'loading' ? <Loading label="Pulling the live legal feed…" />
              : eventsState.startsWith('error') ? <ErrorState message={errMsg(eventsState)} onRetry={loadEvents} />
              : eventRows.length === 0 ? <Empty icon={Ic.Bell} title="Nothing in the feed">{events.length === 0 ? 'No updates are available right now.' : `No ${eventCat} items at the moment.`}</Empty>
              : (
                <div className="lx-list">
                  {eventRows.map((e) => (
                    <div className="lx-item" key={e.id} onClick={() => openExternal(e.link)} style={{ cursor: e.link ? 'pointer' : 'default', alignItems: 'flex-start' }}>
                      <div className="lx-item__body">
                        <div className="lx-row" style={{ gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          {e.category && <span className="lx-badge lx-badge--muted" style={{ textTransform: 'capitalize' }}>{e.category}</span>}
                          {e.source && <span className="lx-item__meta">{e.source}</span>}
                          {e.date && <span className="lx-item__meta">· {e.date}</span>}
                        </div>
                        <div className="lx-item__title" style={{ whiteSpace: 'normal' }}>{e.title}</div>
                        {e.description && <div className="lx-item__meta" style={{ whiteSpace: 'normal', marginTop: 4 }}>{e.description}</div>}
                      </div>
                      {e.link && <Ic.Arrow size={15} />}
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}

      {pdfDoc && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) setPdfDoc(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(12,20,16,0.55)',
                   display: 'flex', flexDirection: 'column', padding: 'min(4vh,32px) min(4vw,32px)' }}>
          <div onMouseDown={(e) => e.stopPropagation()}
            style={{ background: 'var(--surface, #fff)', color: 'var(--ink, #111)', borderRadius: 14,
                     display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden',
                     boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div className="lx-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line, #e5e7eb)', gap: 12 }}>
              <div className="lx-row" style={{ gap: 10, minWidth: 0 }}>
                <Ic.Doc size={18} />
                <span className="lx-item__title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pdfDoc.title || 'Document'}</span>
              </div>
              <div className="lx-row" style={{ gap: 8 }}>
                <a className="lx-btn lx-btn--ghost lx-btn--sm" href={pdfDoc.url} target="_blank" rel="noopener noreferrer"><Ic.Globe size={14} /> Original</a>
                <button className="lx-btn lx-btn--sm" onClick={() => setPdfDoc(null)}>Close</button>
              </div>
            </div>
            <iframe title={pdfDoc.title || 'Court document'}
              src={`${API_BASE}/api/court-pdf?url=${encodeURIComponent(pdfDoc.url)}`}
              style={{ flex: 1, width: '100%', border: 0, background: '#f3f4f6' }} />
          </div>
        </div>
      )}
    </div>
  );
}

function IpAssetModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    ip_type: initial?.ip_type || 'Trademark',
    title: initial?.title || '',
    registration_number: initial?.registration_number || '',
    filing_date: initial?.filing_date || '',
    renewal_due: initial?.renewal_due || '',
    status: initial?.status || 'Pending',
    notes: initial?.notes || '',
    alert_email: initial?.alert_email ?? true,
  }));
  const [busy, setBusy] = useState(false);
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true);
    try { await onSave(form); } finally { setBusy(false); }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="lx-card lx-card--pad" style={{ width: 'min(560px, 92vw)', maxHeight: '88vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="lx-between">
          <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--ink)' }}>{initial ? 'Edit IP asset' : 'Add IP asset'}</h3>
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label><div className="lx-muted" style={{ fontWeight: 600, fontSize: 12 }}>Type</div>
            <select value={form.ip_type} onChange={(e) => set('ip_type', e.target.value)} style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--ink)' }}>
              <option>Trademark</option><option>Patent</option><option>Copyright</option><option>Design</option>
            </select></label>
          <label><div className="lx-muted" style={{ fontWeight: 600, fontSize: 12 }}>Status</div>
            <select value={form.status} onChange={(e) => set('status', e.target.value)} style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--ink)' }}>
              <option>Pending</option><option>Active</option><option>Expired</option><option>Opposed</option>
            </select></label>
        </div>
        <label><div className="lx-muted" style={{ fontWeight: 600, fontSize: 12 }}>Title *</div>
          <input required value={form.title} onChange={(e) => set('title', e.target.value)} style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--ink)' }} /></label>
        <label><div className="lx-muted" style={{ fontWeight: 600, fontSize: 12 }}>Registration / Application #</div>
          <input value={form.registration_number} onChange={(e) => set('registration_number', e.target.value)} style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--ink)' }} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label><div className="lx-muted" style={{ fontWeight: 600, fontSize: 12 }}>Filing date</div>
            <input type="date" value={form.filing_date} onChange={(e) => set('filing_date', e.target.value)} style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--ink)' }} /></label>
          <label><div className="lx-muted" style={{ fontWeight: 600, fontSize: 12 }}>Renewal due</div>
            <input type="date" value={form.renewal_due} onChange={(e) => set('renewal_due', e.target.value)} style={{ width: '100%', height: 38, padding: '0 10px', border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--ink)' }} /></label>
        </div>
        <label><div className="lx-muted" style={{ fontWeight: 600, fontSize: 12 }}>Notes</div>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} style={{ width: '100%', padding: 10, border: '1px solid var(--rule)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--ink)', resize: 'vertical' }} /></label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)' }}>
          <input type="checkbox" checked={!!form.alert_email} onChange={(e) => set('alert_email', e.target.checked)} />
          Email me renewal alerts (requires SMTP configured in Settings)
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button type="button" className="lx-btn lx-btn--ghost lx-btn--sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="lx-btn lx-btn--primary lx-btn--sm" disabled={busy || !form.title.trim()}>
            {busy ? 'Saving…' : (initial ? 'Save changes' : 'Add asset')}
          </button>
        </div>
      </form>
    </div>
  );
}
