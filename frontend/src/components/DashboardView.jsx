import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchTrackedCases } from '../services/api';
import { buildHandoff, HANDOFF_KEY, HANDOFF_TARGETS } from '../utils/moduleHandoff';
import DraftsModal from './DraftsModal';
import TEMPLATES from '../data/legalTemplates.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const QUICK_DRAFT_TEMPLATE_IDS = [
  'mutual-nda',
  'legal-notice-recovery-of-dues',
  'eviction-petition',
  'bail-application-439',
  'employment-offer-letter',
];

const CHECK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const UPLOAD_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

const DOC_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" />
  </svg>
);

const SCALE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18" /><path d="M5 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6" /><path d="M19 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6" /><path d="M5 7h14" /><path d="M9 21h6" />
  </svg>
);

const LIGHTNING_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 3L4 14h7l-1 7 9-11h-7z" />
  </svg>
);

const CLOCK_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
  </svg>
);

const FOLDER_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const SEARCH_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
);

const SPINNER_SVG = (
  <span style={{ display: 'inline-block', width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: '6px', verticalAlign: 'middle' }} />
);

export default function DashboardView() {
  const navigate = useNavigate();

  const [cases, setCases] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [calendarEvents, setCalEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showingEmpty, setShowingEmpty] = useState(false);

  // ── Junction data: the dashboard reads from every module ────────────────────
  // Practice (matters, hearings, pending actions), Case Vault (documents,
  // counters) and Document Hub (index stats, recently filed documents) each
  // answer separately, so one module being down or unconfigured degrades that
  // card alone instead of blanking the dashboard.
  const [practice, setPractice] = useState(null);
  const [practiceState, setPracticeState] = useState('loading'); // loading | ready | none | error
  const [vaultOverview, setVaultOverview] = useState(null);
  const [hubStats, setHubStats] = useState(null);
  const [hubDocs, setHubDocs] = useState([]);

  // Guards every setState in the async loaders: this screen is one Ctrl+K away
  // from being unmounted mid-flight, and React logs a warning (and leaks the
  // update) if a resolved fetch writes into a dead component.
  const aliveRef = useRef(true);
  useEffect(() => {
    // Re-arm on every mount, not just initialise once. A ref survives the
    // unmount/remount cycle, so a cleanup-only version latches to false the
    // first time this screen is left — and from then on every resolved fetch
    // is discarded and the dashboard sits on its loading spinners forever.
    // (React StrictMode's double-mount in development triggers this on the
    // very first render; in production, navigating away and back does.)
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // ── Quick Draft (⌘K style template picker) ──────────────────────────────────
  const [quickDraftOpen, setQuickDraftOpen] = useState(false);
  const [quickDraftQuery, setQuickDraftQuery] = useState('');

  const quickDraftTemplates = QUICK_DRAFT_TEMPLATE_IDS
    .map((id) => TEMPLATES.find((t) => t.id === id))
    .filter(Boolean);

  const filteredQuickDraftTemplates = quickDraftQuery.trim()
    ? quickDraftTemplates.filter((t) => t.title.toLowerCase().includes(quickDraftQuery.trim().toLowerCase()))
    : quickDraftTemplates;

  useEffect(() => {
    if (!quickDraftOpen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setQuickDraftOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quickDraftOpen]);

  const handleQuickDraftSelect = (template) => {
    setQuickDraftOpen(false);
    setQuickDraftQuery('');
    navigate('/firm-library/draft', { state: { templateId: template.id } });
  };

  // ── Saved session drafts modal ──────────────────────────────────────────────
  const [showDraftsModal, setShowDraftsModal] = useState(false);

  // ── CNR sync bar ────────────────────────────────────────────────────────────
  const [cnrNumber, setCnrNumber] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [cnrToast, setCnrToast] = useState('');

  const openAgent = () => window.dispatchEvent(new CustomEvent('toggle-rag-palette'));

  // A failed module must never take the dashboard down with it, so every
  // request resolves to a shape the render can consume. `null` means "this
  // module did not answer" and is rendered as a quiet unavailable state —
  // deliberately distinct from an empty array, which means "answered, nothing
  // to show" and gets a real empty state.
  const getJSON = (path, fallback = null) =>
    fetch(`${API_BASE}${path}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          const err = new Error(body.message || `HTTP ${r.status}`);
          err.status = r.status;
          err.code = body.code;
          throw err;
        }
        return r.json();
      })
      .catch((e) => ({ __error: e }));

  const loadAllData = () => {
    setLoading(true);
    // Clear the previous attempt's banner, or a one-off failure stays on screen
    // for the rest of the session even after a successful reload.
    setError(null);
    Promise.allSettled([
      fetchTrackedCases(),
      // The vault list is paginated; the rail only ever shows a handful, and
      // asking for everything on a firm with thousands of documents would
      // stall the first paint.
      getJSON('/api/vault/documents?limit=25'),
      getJSON('/api/calendar/events'),
      getJSON('/api/practice/dashboard?scope=firm'),
      getJSON('/api/vault/overview'),
      getJSON('/api/dms/stats'),
      // facets=0 matters: the Document Hub's default facet build is a far more
      // expensive query than the document page itself and nothing here uses it.
      // sort=newest is the backend's actual key; an unrecognised value falls
      // back to the same order silently, which is the kind of thing that keeps
      // working until someone changes the default.
      getJSON('/api/dms/docs?per_page=12&facets=0&sort=newest'),
    ]).then(([casesRes, docsRes, eventsRes, practiceRes, vaultRes, hubStatsRes, hubDocsRes]) => {
      if (!aliveRef.current) return;
      const val = (res) => (res.status === 'fulfilled' ? res.value : { __error: res.reason });
      const ok = (v) => v && !v.__error;

      const casesVal = val(casesRes);
      if (Array.isArray(casesVal) && !casesVal.error) {
        setCases(casesVal);
      } else {
        setError('Could not load tracked cases from the server.');
      }

      const docsVal = val(docsRes);
      setDocuments(ok(docsVal) ? (docsVal.documents || []) : []);

      const eventsVal = val(eventsRes);
      setCalEvents(ok(eventsVal) ? (eventsVal.events || []) : []);

      // A practice that has not been set up yet answers 403 NO_FIRM. That is an
      // onboarding state, not a failure — surfacing it as an error would tell
      // every brand-new advocate their dashboard is broken on day one.
      const practiceVal = val(practiceRes);
      if (ok(practiceVal)) {
        setPractice(practiceVal);
        setPracticeState('ready');
      } else if (practiceVal.__error?.code === 'NO_FIRM') {
        setPractice(null);
        setPracticeState('none');
      } else {
        setPractice(null);
        setPracticeState('error');
      }

      const vaultVal = val(vaultRes);
      setVaultOverview(ok(vaultVal) ? vaultVal : null);

      const hubStatsVal = val(hubStatsRes);
      setHubStats(ok(hubStatsVal) ? hubStatsVal : null);

      const hubDocsVal = val(hubDocsRes);
      setHubDocs(ok(hubDocsVal) ? (hubDocsVal.docs || []) : []);
    }).finally(() => {
      if (aliveRef.current) setLoading(false);
    });
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // ── CNR sync handler ────────────────────────────────────────────────────────
  const handleCnrSync = async (e) => {
    e?.preventDefault();
    if (!cnrNumber.trim()) return;
    setIsSyncing(true);
    // This used to swallow every failure: a network error was caught and
    // replaced with a fabricated `{success:true, hearings_added:3}`, and an
    // HTTP 4xx/5xx with a JSON body fell through to the same success toast. The
    // advocate was told three hearings had been added to their calendar when
    // nothing had been synced at all — and the "Sync failed" branch was
    // unreachable. On a system that tracks limitation dates, a false
    // confirmation is worse than a visible error.
    try {
      const res = await fetch(`${API_BASE}/api/ecourts/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnr: cnrNumber.trim() }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false || result.error) {
        throw new Error(result.message || 'eCourts did not accept that CNR number.');
      }
      const added = Number(result.hearings_added) || 0;
      setCnrToast(
        added > 0
          ? `Matter synced — ${added} hearing${added === 1 ? '' : 's'} added to your Legal Calendar.`
          : 'Matter synced — no new hearings were listed for this CNR.'
      );
      loadAllData();
      setCnrNumber('');
      setTimeout(() => { if (aliveRef.current) setCnrToast(''); }, 5000);
    } catch (err) {
      // The CNR stays in the box on failure so it can be corrected and retried
      // rather than retyped from the court papers.
      setCnrToast(`Sync failed — ${err.message || 'could not reach eCourts.'} Check the CNR and try again.`);
      setTimeout(() => { if (aliveRef.current) setCnrToast(''); }, 6000);
    } finally {
      if (aliveRef.current) setIsSyncing(false);
    }
  };

  // ── Derived Triage Metrics ──────────────────────────────────────────────────
  const now = new Date();
  // Everything date-based is measured from the START of today, never from the
  // current instant. A limitation date is a whole day, not a moment: an expiry
  // dated today is still live at 4pm and must stay on the board until the day
  // is over.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in7d = new Date(startOfToday.getTime() + 7 * 86400000);
  const in48h = new Date(startOfToday.getTime() + 48 * 3600000);

  // `calendar_events.event_date` is a bare 'YYYY-MM-DD'. new Date() reads that
  // as UTC midnight, which in IST is 05:30 the same morning — so comparing it
  // against the current time dropped every deadline due TODAY from both the
  // limitation tile and the 48-hour panel from breakfast onwards, and the
  // dashboard cheerfully reported "Clear — no urgent deadlines" on the day a
  // limitation period actually ran out. Parse date-only values as local midnight.
  const parseEventDate = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const limitationExpiries = calendarEvents.filter(ev => {
    const t = ((ev.event_type || '') + ' ' + (ev.title || '')).toLowerCase();
    if (!['drop_dead', 'tickler', 'deadline', 'limitation'].some(k => t.includes(k))) return false;
    const d = parseEventDate(ev.event_date);
    return d && d >= startOfToday && d <= in7d;
  }).length;

  // Deduped: a matter can satisfy both the event-text scan and the case-status
  // scan, and counting it twice inflated this tile against the list it claims
  // to summarise.
  const pendingJudgmentKeys = new Set([
    ...calendarEvents
      .filter(ev => {
        const s = ((ev.event_type || '') + ' ' + (ev.title || '')).toLowerCase();
        return s.includes('judgment') || s.includes('order') || s.includes('awaiting');
      })
      .map(ev => `e:${ev.id ?? `${ev.title}|${ev.event_date}`}`),
    ...cases
      .filter(c => ['awaiting', 'judgment'].some(k => (c.status || '').toLowerCase().includes(k)))
      .map(c => `c:${c.id ?? c.case_number ?? c.case_name}`),
  ]);
  const pendingJudgments = pendingJudgmentKeys.size;

  // Prefer the Document Hub's real review queue over the old title-matching
  // guess. Matching on the word "draft" in a filename counted finished,
  // filed documents ("Draft Sale Deed - EXECUTED.pdf") as outstanding work,
  // which made this tile read high and untrustworthy. hubStats.review is the
  // set the hub itself flags as needing a human decision. The old heuristic
  // stays as the fallback for when the hub is unreachable, so the tile still
  // says something rather than dropping to a confident zero.
  const heuristicDrafts = documents.filter(d =>
    (d.doc_type || '').toLowerCase().includes('draft') ||
    (d.title || '').toLowerCase().includes('draft') ||
    d.needs_review
  ).length;
  const draftsCount = hubStats ? (hubStats.review || 0) : heuristicDrafts;

  const activeMatterCount = practiceState === 'ready'
    ? (practice?.counts?.active ?? 0)
    : cases.length;

  // ── 4 Stat Tiles Specification ──────────────────────────────────────────────
  const stats = [
    {
      key: 'limitation_expiries',
      label: 'Limitation expiries',
      value: limitationExpiries,
      severity: 'urgent',
      sub: '7-DAY WATCH · LIMITATION ACT 1963',
      statusOk: 'CLEAR',
      statusFlag: `${limitationExpiries} DUE`,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
        </svg>
      ),
      onClick: () => navigate('/calendar'),
    },
    {
      key: 'pending_judgments',
      label: 'Pending judgments',
      value: pendingJudgments,
      severity: 'caution',
      sub: 'AWAITING COURT RESERVED ORDERS',
      statusOk: 'CLEAR',
      statusFlag: `${pendingJudgments} WAITING`,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" /><path d="M9.5 12l2 2 3.2-3.6" />
        </svg>
      ),
      onClick: () => navigate('/calendar'),
    },
    {
      key: 'drafts_pending_review',
      label: 'Drafts pending review',
      value: draftsCount,
      severity: 'neutral',
      sub: hubStats ? 'DOCUMENT HUB · AWAITING YOUR DECISION' : 'PLEADINGS & CONTRACTS IN VAULT',
      statusOk: 'CLEAR',
      statusFlag: `${draftsCount} OPEN`,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" />
        </svg>
      ),
      // The click has to land where the number came from: once this counts the
      // hub's review queue, opening the session-drafts modal would show an
      // unrelated (usually empty) list and look like the tile is lying.
      onClick: () => (hubStats ? navigate('/document-hub') : setShowDraftsModal(true)),
    },
    {
      key: 'tracked_cases',
      label: 'Tracked cases',
      // Counted from the practice register when there is one. This tile used
      // to read only the eCourts causelist table, so an advocate with three
      // live matters in their practice saw "0 active matters on record" right
      // above a panel listing all three — the dashboard contradicting itself
      // on one screen. The causelist count remains the fallback for firms that
      // track matters by CNR without using the practice module.
      value: activeMatterCount,
      severity: 'neutral',
      sub: practiceState === 'ready' ? 'ACTIVE MATTERS IN YOUR PRACTICE' : 'ACTIVE MATTERS ON RECORD',
      statusOk: 'CLEAR',
      statusFlag: `${activeMatterCount} ACTIVE`,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </svg>
      ),
      // Follow the number to its source, as with the review tile above.
      onClick: () => navigate(practiceState === 'ready' ? '/practice/cases' : '/vault'),
    },
  ];

  // ── Urgent Items (Next 48 Hours) ────────────────────────────────────────────
  const urgentItems = calendarEvents
    .filter(ev => {
      const d = parseEventDate(ev.event_date);
      return d && d >= startOfToday && d <= in48h;
    })
    .sort((a, b) => (parseEventDate(a.event_date) || 0) - (parseEventDate(b.event_date) || 0));

  const formatWhen = (eventDate) => {
    const evD = parseEventDate(eventDate);
    if (!evD) return '';
    // Whole-day difference from the start of today, so a hearing listed for
    // today reads "Today" all day rather than flipping to "Tomorrow" once the
    // clock passes the event's notional midnight.
    const diffDays = Math.round((evD.getTime() - startOfToday.getTime()) / 86400000);
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    return `In ${diffDays} days`;
  };

  const recentVaultDocs = [...documents]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 4);

  // ── The junction rail: one document list spanning every module ──────────────
  // Case Vault, Document Hub and Practice all key their documents off the same
  // `case_vault.id` (dms_docs.doc_id IS case_vault.id, and the practice
  // dashboard joins the two), so the same physical document routinely appears
  // in more than one feed. Merging therefore dedupes by id — otherwise the rail
  // shows one document three times with three different chips and the advocate
  // can't tell whether those are duplicates in their filing or in our UI.
  //
  // When a document does appear in several feeds, the richest provenance wins:
  // a linked practice matter says more than a Hub classification, which says
  // more than "it's in the vault".
  const [docFilter, setDocFilter] = useState('all');

  const workspaceDocs = useMemo(() => {
    const byId = new Map();
    const put = (doc) => {
      const existing = byId.get(doc.id);
      // Rank is provenance richness, not recency — see note above.
      const rank = { practice: 3, hub: 2, vault: 1 };
      if (!existing) { byId.set(doc.id, { ...doc, sources: [doc.source] }); return; }
      // Remember every feed a document came from, not just the winning one.
      // Filtering on the winning source alone made the Vault chip report zero
      // for a firm whose vault documents were all indexed by the Hub too —
      // the filter contradicting the vault's own document count.
      const sources = existing.sources.includes(doc.source)
        ? existing.sources
        : [...existing.sources, doc.source];
      if (rank[doc.source] <= rank[existing.source]) {
        byId.set(doc.id, { ...existing, sources });
        return;
      }
      // Spreading the richer source wholesale would let its null/undefined
      // fields erase good values the weaker source supplied — a practice row
      // with no created_at would blank the vault's date, dropping the document
      // to the bottom of a date-sorted rail with no date chip. Only defined
      // values win.
      const merged = { ...existing };
      Object.entries(doc).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') merged[k] = v;
      });
      // Source/label must always follow the winning row, even if blank-ish.
      merged.source = doc.source;
      merged.sourceLabel = doc.sourceLabel;
      merged.sources = sources;
      byId.set(doc.id, merged);
    };

    (documents || []).forEach((d) => {
      if (d?.id == null) return;
      put({
        id: String(d.id),
        name: d.smart_title || d.title || 'Untitled document',
        source: 'vault',
        sourceLabel: 'Case Vault',
        kind: d.doc_type || d.file_format || 'Document',
        date: d.created_at,
        href: '/vault',
      });
    });

    (hubDocs || []).forEach((d) => {
      if (d?.id == null) return;
      put({
        id: String(d.id),
        name: d.title || d.original_name || 'Untitled document',
        source: 'hub',
        sourceLabel: 'Document Hub',
        kind: d.doc_class && d.doc_class !== 'Unclassified' ? d.doc_class : (d.kind || 'Document'),
        date: d.created_at,
        needsReview: d.review === 'needs_review',
        href: '/document-hub',
      });
    });

    (practice?.documents || []).forEach((d) => {
      if (d?.id == null) return;
      put({
        id: String(d.id),
        name: d.title || 'Untitled document',
        source: 'practice',
        sourceLabel: 'Practice',
        kind: d.doc_class || 'Document',
        date: d.created_at,
        caseLabel: d.case_no || d.case_title || '',
        href: d.case_id ? `/practice/cases/${d.case_id}` : '/practice',
      });
    });

    return [...byId.values()].sort(
      (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
    );
  }, [documents, hubDocs, practice]);

  const matchingWorkspaceDocs = useMemo(
    () => (docFilter === 'all'
      ? workspaceDocs
      : workspaceDocs.filter((d) => (d.sources || [d.source]).includes(docFilter))),
    [workspaceDocs, docFilter]
  );
  // Six keeps the rail scannable; the count below links to the full list.
  const filteredWorkspaceDocs = useMemo(() => matchingWorkspaceDocs.slice(0, 6), [matchingWorkspaceDocs]);
  const visibleDocCount = matchingWorkspaceDocs.length;

  // ── Sending a document into a tool ──────────────────────────────────────────
  // Text is fetched only at the moment the advocate picks an action, never for
  // the whole list: /content converts docx/pdf to HTML per document, so
  // pre-fetching a rail of twelve would make every dashboard load pay for
  // conversions nobody asked for.
  const [sendingDoc, setSendingDoc] = useState(null); // `${id}:${tool}`
  const [sendError, setSendError] = useState(null);

  const sendDocToTool = async (doc, tool) => {
    const target = HANDOFF_TARGETS[tool];
    if (!target) return;
    setSendError(null);
    setSendingDoc(`${doc.id}:${tool}`);
    try {
      // Every source shares the case_vault id space, so this one endpoint
      // resolves text for a vault, Hub or practice document alike.
      const res = await fetch(`${API_BASE}/api/vault/documents/${encodeURIComponent(doc.id)}/content`);
      if (!res.ok) throw new Error(`Could not open “${doc.name}” (HTTP ${res.status}).`);
      const detail = await res.json();
      if (!aliveRef.current) return;
      navigate(target, {
        state: {
          [HANDOFF_KEY]: buildHandoff({
            id: doc.id,
            name: doc.name,
            text: detail.text || '',
            source: doc.source,
            sourceLabel: doc.sourceLabel,
            docType: doc.kind,
          }),
        },
      });
    } catch (e) {
      if (aliveRef.current) setSendError(e.message || 'Could not open that document.');
    } finally {
      if (aliveRef.current) setSendingDoc(null);
    }
  };

  // ── Needs attention: real work items, merged across modules ─────────────────
  const attentionItems = useMemo(() => {
    const items = [];
    (practice?.pending || []).forEach((p, i) => {
      items.push({
        // Index-suffixed: two follow-ups with the same kind, title and due date
        // are entirely possible, and identical React keys make rows vanish or
        // swap content when the list re-renders.
        key: `p-${i}-${p.kind}-${p.date || ''}`,
        title: p.title,
        sub: p.sub,
        severity: p.severity === 'overdue' ? 'overdue' : p.severity === 'soon' ? 'soon' : 'info',
        // The API already returns an app-absolute path ("/practice/cases/12").
        // Prefixing it again would route to /practice/practice/... and land on
        // the practice router's catch-all redirect instead of the case.
        to: typeof p.link === 'string' && p.link.startsWith('/practice') ? p.link : '/practice',
      });
    });
    if (hubStats?.review > 0) {
      items.push({
        key: 'hub-review',
        title: `${hubStats.review} document${hubStats.review === 1 ? '' : 's'} awaiting review`,
        sub: 'Document Hub · classification needs confirming',
        severity: 'soon',
        to: '/document-hub',
      });
    }
    if (hubStats?.problems > 0) {
      items.push({
        key: 'hub-problems',
        title: `${hubStats.problems} document${hubStats.problems === 1 ? '' : 's'} failed to process`,
        sub: 'Document Hub · needs OCR or re-upload',
        severity: 'overdue',
        to: '/document-hub',
      });
    }
    const weight = { overdue: 0, soon: 1, info: 2 };
    return items.sort((a, b) => weight[a.severity] - weight[b.severity]).slice(0, 6);
  }, [practice, hubStats]);

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const formattedToday = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="dt-container">
      <style>{`
        /* ============================================================
           ADVOCATE TERMINAL (Dashboard) — v2 Slate & Rust Token Styles
           ============================================================ */
        .dt-container {
          --bg: #191C1D;
          --paper: #212527;
          --paper-2: #2A2F31;
          --ink: #D6D9D9;
          --ink-soft: #AAAEAE;
          --muted: #727776;
          --muted-2: #494E4D;
          --rule: #333939;
          --accent: #CC6B48;
          --accent-soft: #3B281F;
          --major: #D9AD5C;
          --major-soft: #35301C;
          --on-accent: #FBF7EE;
          --shadow: 0 20px 50px rgba(0,0,0,.45);
          --overlay: rgba(10,10,10,.6);
          padding: 0;
          color: var(--ink);
          font-family: 'IBM Plex Sans', sans-serif;
          min-height: 100%;
        }
        [data-theme="light"] .dt-container, :root[data-theme="light"] .dt-container {
          --bg: #DFE1E0;
          --paper: #EAEBE8;
          --paper-2: #E3E4E1;
          --ink: #181B1D;
          --ink-soft: #494E51;
          --muted: #868C8E;
          --muted-2: #B3B8B9;
          --rule: #D2D5D4;
          --accent: #B24A2E;
          --accent-soft: #EFDCD1;
          --major: #9C7A2E;
          --major-soft: #F1E6C9;
          --on-accent: #FBF7EE;
          --shadow: 0 20px 50px rgba(30,25,18,.14);
          --overlay: rgba(24,20,15,.45);
        }
        [data-theme="dark"] .dt-container, :root[data-theme="dark"] .dt-container, .dark .dt-container {
          --bg: #191C1D;
          --paper: #212527;
          --paper-2: #2A2F31;
          --ink: #D6D9D9;
          --ink-soft: #AAAEAE;
          --muted: #727776;
          --muted-2: #494E4D;
          --rule: #333939;
          --accent: #CC6B48;
          --accent-soft: #3B281F;
          --major: #D9AD5C;
          --major-soft: #35301C;
          --on-accent: #FBF7EE;
          --shadow: 0 20px 50px rgba(0,0,0,.45);
          --overlay: rgba(10,10,10,.6);
        }

        .serif { font-family: 'Fraunces', serif; font-style: italic; letter-spacing: -0.01em; }
        .mono { font-family: 'IBM Plex Mono', monospace; }

        .topbar-dash {
          display: flex;
          align-items: flex-start;
          gap: 20px;
          padding: 28px 36px 0;
        }
        .eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .page-title {
          font-size: 30px;
          margin-top: 6px;
          margin-bottom: 0;
          color: var(--ink);
        }
        .page-sub {
          font-size: 13px;
          color: var(--ink-soft);
          margin-top: 7px;
        }
        .badge, .badge-live {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 5px 11px 5px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 500;
          background: var(--paper-2);
          color: var(--ink-soft);
          border: 1px solid var(--rule);
          font-family: 'IBM Plex Mono', monospace;
          letter-spacing: .04em;
          margin-top: 8px;
        }
        .live-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--ink-soft);
          position: relative;
          flex-shrink: 0;
        }
        .live-dot::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 50%;
          border: 1px solid var(--ink-soft);
          opacity: .5;
        }
        .topbar-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-top: 2px;
          flex-shrink: 0;
        }
        .btn, .btn-dt {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-radius: 9px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          white-space: nowrap;
          transition: all 0.15s;
        }
        .btn:hover, .btn-dt:hover {
          border-color: var(--accent);
          color: var(--accent);
        }
        .btn-primary, .btn-dt-primary {
          background: var(--accent) !important;
          border-color: var(--accent) !important;
          color: var(--on-accent) !important;
        }
        .btn-primary:hover, .btn-dt-primary:hover {
          filter: brightness(1.08);
          color: var(--on-accent) !important;
        }
        .btn-sm, .btn-dt-sm {
          padding: 7px 12px;
          font-size: 12px;
        }
        .kbd, .kbd-badge {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9.5px;
          opacity: .85;
          border: 1px solid rgba(251,247,238,.35);
          border-radius: 4px;
          padding: 1px 5px;
          margin-left: 2px;
        }

        .content-dash {
          padding: 26px 36px 70px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        /* ── CNR Sync Card ── */
        .sync-card {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 14px;
          padding: 18px 20px;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .sync-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: var(--accent-soft);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .sync-input-wrap { flex-grow: 1; }
        .sync-label {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--muted);
          margin-bottom: 6px;
        }
        .sync-row {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .sync-input {
          flex-grow: 1;
          background: var(--paper-2);
          border: 1px solid var(--rule);
          border-radius: 9px;
          padding: 10px 13px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          color: var(--ink);
          outline: none;
        }
        .sync-input:focus { border-color: var(--accent); }
        .sync-input::placeholder {
          color: var(--muted);
          font-family: 'IBM Plex Sans', sans-serif;
        }
        .sync-hint {
          font-size: 11px;
          color: var(--muted);
          white-space: nowrap;
        }
        .sync-pill-btn {
          color: var(--ink-soft);
          background: var(--paper-2);
          border: 1px solid var(--rule);
          border-radius: 5px;
          padding: 2px 6px;
          margin-left: 4px;
          cursor: pointer;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          transition: border-color 0.15s;
        }
        .sync-pill-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

        /* ── Stat Grid ── */
        .stat-grid, .stat-grid-dash {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }
        .stat-tile {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 14px;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          position: relative;
          overflow: hidden;
          cursor: pointer;
          transition: transform 0.15s, border-color 0.15s;
          /* Resets so the <button> element renders identically to the div it
             replaced (buttons centre their text and inherit none of the page
             font by default). */
          text-align: left;
          font: inherit;
          color: inherit;
          width: 100%;
        }
        .stat-tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .stat-tile:hover {
          transform: translateY(-2px);
          border-color: var(--rule);
        }
        .stat-tile::before {
          content: '';
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3px;
          background: var(--rule);
        }
        .stat-tile.urgent::before { background: var(--accent); }
        .stat-tile.caution::before { background: var(--major); }
        .stat-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .stat-icon {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          background: var(--paper-2);
          color: var(--muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stat-tile.urgent .stat-icon {
          background: var(--accent-soft);
          color: var(--accent);
        }
        .stat-tile.caution .stat-icon {
          background: var(--major-soft);
          color: var(--major);
        }
        .stat-status {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: .05em;
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--paper-2);
          color: var(--muted);
          border: 1px solid var(--rule);
        }
        .stat-tile.urgent .stat-status.flagged {
          background: var(--accent-soft);
          color: var(--accent);
          border-color: transparent;
        }
        .stat-tile.caution .stat-status.flagged {
          background: var(--major-soft);
          color: var(--major);
          border-color: transparent;
        }
        .stat-value {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 28px;
          font-weight: 600;
          color: var(--ink);
        }
        .stat-label {
          font-size: 13px;
          font-weight: 500;
          color: var(--ink);
          margin-top: 2px;
        }
        .stat-sub {
          font-size: 11.5px;
          color: var(--muted);
        }
        .stat-tile.urgent .stat-sub { color: var(--accent); }
        .stat-tile.caution .stat-sub { color: var(--major); }

        /* ── Morning Triage / Vault Digest ── */
        .digest-grid {
          display: grid;
          grid-template-columns: 1.3fr 1fr;
          gap: 16px;
        }
        .panel, .panel-dash {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 14px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 15px 18px;
          border-bottom: 1px solid var(--rule);
        }
        .panel-head-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: .04em;
          text-transform: uppercase;
          color: var(--ink-soft);
        }
        .panel-head-title svg { color: var(--accent); }
        .panel-link, .panel-head a {
          font-size: 12px;
          color: var(--accent);
          text-decoration: none;
          font-weight: 500;
          cursor: pointer;
        }
        .panel-link:hover, .panel-head a:hover { text-decoration: underline; }
        .panel-body, .panel-body-dash {
          padding: 18px;
          flex-grow: 1;
        }

        .event-chip {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 10px 8px;
          border-radius: 9px;
          transition: background 0.15s;
        }
        .event-chip:hover { background: var(--paper-2); }
        .event-chip + .event-chip { border-top: 1px dashed var(--rule); }
        .event-dot {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--muted-2);
        }
        .event-dot.deadline { background: var(--accent); }
        .event-dot.hearing { background: var(--major); }
        .event-title {
          font-size: 13px;
          font-weight: 500;
          color: var(--ink);
        }
        .event-meta {
          font-size: 11px;
          color: var(--muted);
          margin-top: 2px;
        }
        .event-countdown {
          margin-left: auto;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--paper-2);
          color: var(--ink-soft);
          white-space: nowrap;
        }
        .event-countdown.urgent {
          background: var(--accent-soft);
          color: var(--accent);
        }

        .clear-state {
          text-align: center;
          padding: 30px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .clear-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--paper-2);
          color: var(--ink-soft);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .clear-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--ink);
        }
        .clear-sub {
          font-size: 12px;
          color: var(--muted);
          max-width: 280px;
          line-height: 1.5;
        }

        .doc-row {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 9px 8px;
          border-radius: 9px;
          text-decoration: none;
          color: inherit;
          transition: background 0.15s;
        }
        .doc-row:hover { background: var(--paper-2); }
        .doc-row + .doc-row { border-top: 1px dashed var(--rule); }
        .doc-icon, .doc-icon-wrap {
          width: 28px;
          height: 28px;
          border-radius: 7px;
          background: var(--paper-2);
          color: var(--ink-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .doc-name {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--ink);
        }
        .doc-meta {
          font-size: 11px;
          color: var(--muted);
          margin-top: 2px;
        }

        /* ── Quick Draft Banner ── */
        .draft-banner {
          display: flex;
          align-items: center;
          gap: 16px;
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 13px;
          padding: 16px 20px;
          cursor: pointer;
          text-align: left;
          color: var(--ink);
          width: 100%;
          transition: border-color 0.15s;
        }
        .draft-banner:hover { border-color: var(--accent); }
        .draft-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: var(--accent-soft);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .draft-title {
          font-size: 13.5px;
          font-weight: 600;
        }
        .draft-sub {
          font-size: 12px;
          color: var(--muted);
          margin-top: 2px;
        }

        /* ── Law Practice Modules Grid ── */
        .section-eyebrow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 4px;
        }
        .module-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-top: 12px;
        }
        .module-card {
          background: var(--paper);
          border: 1px solid var(--rule);
          border-radius: 13px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          cursor: pointer;
          text-align: left;
          color: var(--ink);
          text-decoration: none;
          transition: border-color 0.15s, transform 0.15s;
        }
        .module-card:hover {
          border-color: var(--accent);
          transform: translateY(-2px);
        }
        .module-icon {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          background: var(--paper-2);
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .module-title {
          font-size: 13.5px;
          font-weight: 600;
        }
        .module-sub {
          font-size: 11.5px;
          color: var(--muted);
          margin-top: 2px;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        @media (max-width: 980px) {
          .digest-grid { grid-template-columns: 1fr; }
          .stat-grid, .stat-grid-dash { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .module-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
          .stat-grid, .stat-grid-dash, .module-grid { grid-template-columns: 1fr; }
          .content-dash, .topbar-dash { padding-left: 18px; padding-right: 18px; }
          .sync-row { flex-direction: column; align-items: stretch; }
        }
        /* ── Junction: workspace document rail ── */
        .jx-filters {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
        }
        .jx-chip {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          letter-spacing: .04em;
          text-transform: uppercase;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          transition: color .15s, background .15s, border-color .15s;
        }
        .jx-chip:hover { color: var(--ink); background: var(--paper-2); }
        .jx-chip.active {
          color: var(--accent);
          border-color: var(--accent);
          background: var(--accent-soft);
        }
        .jx-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        .jx-doc {
          display: flex;
          align-items: center;
          gap: 13px;
          padding: 12px 10px;
          border-radius: 10px;
          transition: background .15s;
        }
        .jx-doc:hover { background: var(--paper-2); }
        .jx-doc + .jx-doc { border-top: 1px dashed var(--rule); }
        .jx-doc-main { flex: 1; min-width: 0; }
        .jx-doc-name {
          font-size: 13.5px;
          color: var(--ink);
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .jx-doc-meta {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          color: var(--muted);
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 7px;
          flex-wrap: wrap;
        }
        .jx-src {
          padding: 2px 7px;
          border-radius: 4px;
          background: var(--paper-2);
          border: 1px solid var(--rule);
          color: var(--ink-soft);
          letter-spacing: .03em;
        }
        .jx-src.practice { color: var(--accent); border-color: var(--accent-soft); background: var(--accent-soft); }
        .jx-src.hub { color: var(--major); border-color: var(--major-soft); background: var(--major-soft); }
        .jx-actions {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-shrink: 0;
          /* Deliberately always visible. Sending a document straight into the
             Analyzer / Auto-Draft / Conflict Engine is the whole point of this
             rail, and an advocate who never hovers a row would never discover
             it. They are kept visually quiet instead (muted, hairline border)
             and lift to full contrast on row hover. */
          opacity: .72;
          transition: opacity .15s;
        }
        .jx-doc:hover .jx-actions,
        .jx-doc:focus-within .jx-actions { opacity: 1; }
        .jx-act {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 10px;
          border-radius: 7px;
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink-soft);
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: border-color .15s, color .15s;
        }
        .jx-act:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .jx-act:disabled { opacity: .55; cursor: progress; }
        .jx-act:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .jx-act svg { width: 13px; height: 13px; }

        /* ── Needs attention ── */
        .jx-att {
          display: flex;
          align-items: flex-start;
          gap: 11px;
          padding: 11px 8px;
          border-radius: 9px;
          text-decoration: none;
          color: inherit;
          transition: background .15s;
        }
        .jx-att:hover { background: var(--paper-2); }
        .jx-att + .jx-att { border-top: 1px dashed var(--rule); }
        .jx-att-bar {
          width: 3px;
          align-self: stretch;
          border-radius: 2px;
          background: var(--muted-2);
          flex-shrink: 0;
        }
        .jx-att-bar.overdue { background: var(--accent); }
        .jx-att-bar.soon { background: var(--major); }
        .jx-att-title { font-size: 13px; color: var(--ink); font-weight: 500; }
        .jx-att-sub {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          color: var(--muted);
          margin-top: 3px;
        }

        /* ── Practice strip ── */
        .jx-mini-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 4px;
        }
        .jx-mini {
          background: var(--paper-2);
          border: 1px solid var(--rule);
          border-radius: 10px;
          padding: 12px 13px;
          text-decoration: none;
          color: inherit;
          display: block;
          transition: border-color .15s;
        }
        .jx-mini:hover { border-color: var(--accent); }
        .jx-mini-val { font-size: 21px; font-weight: 600; color: var(--ink); line-height: 1.1; }
        .jx-mini-lab {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 9.5px;
          letter-spacing: .06em;
          text-transform: uppercase;
          color: var(--muted);
          margin-top: 5px;
        }
        @media (max-width: 760px) { .jx-mini-grid { grid-template-columns: repeat(2, 1fr); } }

        .jx-matter {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 10px 8px;
          border-radius: 9px;
          text-decoration: none;
          color: inherit;
          transition: background .15s;
        }
        .jx-matter:hover { background: var(--paper-2); }
        .jx-matter + .jx-matter { border-top: 1px dashed var(--rule); }
        .jx-matter-no {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          color: var(--muted);
          background: var(--paper-2);
          border: 1px solid var(--rule);
          border-radius: 4px;
          padding: 3px 6px;
          flex-shrink: 0;
        }

        .jx-inline-note {
          font-size: 12.5px;
          color: var(--muted);
          padding: 18px;
          text-align: center;
          line-height: 1.6;
        }

        .link-toggle {
          background: none;
          border: 0;
          color: var(--muted);
          text-decoration: underline;
          text-underline-offset: 3px;
          font-size: 12px;
          cursor: pointer;
          padding: 0;
        }
        .link-toggle:hover {
          color: var(--accent);
        }
      `}</style>

      {/* ── TOPBAR MASTHEAD ── */}
      <header className="topbar-dash">
        <div style={{ flexGrow: 1 }}>
          <div className="eyebrow">Workspace · Advocate Terminal</div>
          <h1 className="page-title serif">{timeGreeting}, Counsel</h1>
          <div className="page-sub">{formattedToday} — everything below is live from your practice records.</div>
          <div className="badge">
            <span className="live-dot" />
            Live eCourts sync active
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn btn-primary" onClick={openAgent}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16v12H8l-4 4z" />
            </svg>
            Ask LexAmplify AI <span className="kbd">⌘K</span>
          </button>
        </div>
      </header>

      <div className="content-dash">

        {/* ── CNR SYNC BAR ── */}
        <form onSubmit={handleCnrSync} className="sync-card">
          <div className="sync-icon">
            {SCALE_ICON}
          </div>
          <div className="sync-input-wrap">
            <div className="sync-label">Sync a matter from eCourts</div>
            <div className="sync-row">
              <input
                className="sync-input"
                type="text"
                placeholder="Enter 16-digit CNR number…"
                aria-label="CNR number"
                value={cnrNumber}
                onChange={(e) => setCnrNumber(e.target.value)}
                disabled={isSyncing}
              />
              <span className="sync-hint">
                Try
                <button
                  type="button"
                  className="sync-pill-btn"
                  onClick={() => setCnrNumber('MHNS010123452024')}
                  title="Click to autofill sample CNR"
                >
                  MHNS010123452024
                </button>
              </span>
              <button
                type="submit"
                disabled={isSyncing || !cnrNumber.trim()}
                className="btn btn-primary btn-sm"
              >
                {isSyncing ? <>{SPINNER_SVG} Syncing…</> : 'Sync matter'}
              </button>
            </div>
          </div>
        </form>

        {/* Preview mode is a design/demo affordance that forces every figure on
            this page to zero. On a board an advocate reads limitation expiries
            off, a silent zero is the most dangerous thing it could display, so
            while it is on it says so continuously and offers one click out. */}
        {showingEmpty && (
          <div
            role="status"
            style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '12px 16px', borderRadius: '10px',
              background: 'var(--major-soft)', border: '1px solid var(--major)',
              color: 'var(--major)', fontSize: '13px', fontWeight: 500,
            }}
          >
            <span style={{ flex: 1 }}>
              Preview mode — every figure below is forced to zero. These are not your real deadlines or matters.
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setShowingEmpty(false)}>
              Show real figures
            </button>
          </div>
        )}

        {/* CNR Toast */}
        {cnrToast && (
          <div style={{
            padding: '12px 18px', borderRadius: '10px',
            background: 'var(--paper-2)', border: '1px solid var(--rule)',
            color: 'var(--ink)', fontSize: '13px', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            {CHECK_ICON} {cnrToast}
          </div>
        )}

        {/* ── 4 STAT CARDS ── */}
        <div className="stat-grid">
          {stats.map((s) => {
            const displayVal = showingEmpty ? 0 : s.value;
            const isFlagged = displayVal > 0;
            const tileCls = isFlagged && s.severity !== 'neutral' ? s.severity : '';
            const statusLabel = isFlagged ? s.statusFlag : s.statusOk;

            return (
              // A real button, not a clickable div: these four tiles are the
              // dashboard's primary navigation and were unreachable by keyboard
              // and invisible to a screen reader.
              <button
                type="button"
                key={s.key}
                className={`stat-tile ${tileCls}`}
                onClick={s.onClick}
                aria-label={`${s.label}: ${loading ? 'loading' : displayVal}. ${s.sub}`}
              >
                <div className="stat-top">
                  <div className="stat-icon">{s.icon}</div>
                  <div className={`stat-status ${isFlagged && tileCls ? 'flagged' : ''}`}>
                    {statusLabel}
                  </div>
                </div>
                <div>
                  <div className="stat-value">
                    {loading ? SPINNER_SVG : displayVal}
                  </div>
                  <div className="stat-label">{s.label}</div>
                </div>
                <div className="stat-sub">{s.sub}</div>
              </button>
            );
          })}
        </div>

        {error && !loading && (
          <div style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: '10px', padding: '12px 16px', fontSize: '13px', color: 'var(--accent)' }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── WORKSPACE DOCUMENTS — the junction rail ──────────────────────────
            Every document the firm holds, wherever it is filed, with the three
            tools that act on documents reachable from the row itself. */}
        <div className="panel">
          <div className="panel-head">
            <div className="panel-head-title">
              {DOC_ICON}
              Work on a document
            </div>
            <div className="jx-filters" role="group" aria-label="Filter documents by where they are filed">
              {[
                { key: 'all', label: `All ${workspaceDocs.length ? `(${workspaceDocs.length})` : ''}`.trim() },
                { key: 'vault', label: 'Vault' },
                { key: 'hub', label: 'Hub' },
                { key: 'practice', label: 'Practice' },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`jx-chip ${docFilter === f.key ? 'active' : ''}`}
                  aria-pressed={docFilter === f.key}
                  onClick={() => setDocFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-body">
            {sendError && (
              <div style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)', borderRadius: '9px', padding: '10px 13px', fontSize: '12.5px', color: 'var(--accent)', marginBottom: '12px' }}>
                {sendError}
              </div>
            )}
            {loading ? (
              <div className="jx-inline-note">{SPINNER_SVG} Gathering documents from your vault, hub and practice…</div>
            ) : (filteredWorkspaceDocs.length === 0 || showingEmpty) ? (
              <div className="clear-state">
                <div className="clear-icon">{UPLOAD_ICON}</div>
                <div className="clear-title">
                  {showingEmpty || workspaceDocs.length === 0
                    ? 'No documents yet'
                    : `Nothing filed in ${docFilter === 'hub' ? 'the Document Hub' : docFilter === 'practice' ? 'a practice matter' : 'the Case Vault'}`}
                </div>
                <div className="clear-sub">
                  {showingEmpty || workspaceDocs.length === 0
                    ? 'Once contracts, pleadings or orders are in your vault or hub, you can analyse, draft from and conflict-check them straight from here.'
                    : 'Switch the filter above, or open the module to file something there.'}
                </div>
                <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: '8px' }} onClick={() => navigate('/document-hub')}>
                  Upload a document
                </button>
              </div>
            ) : (
              <>
              {filteredWorkspaceDocs.map((d) => (
                <div key={d.id} className="jx-doc">
                  <div className="doc-icon">{DOC_ICON}</div>
                  <div className="jx-doc-main">
                    <div className="jx-doc-name" title={d.name}>{d.name}</div>
                    <div className="jx-doc-meta">
                      {/* While a filter is active the chip names the filtered
                          source, so "Vault" never lists rows badged "Document
                          Hub" just because the Hub also indexes them. */}
                      <span className={`jx-src ${docFilter === 'all' ? d.source : docFilter}`}>
                        {docFilter === 'all'
                          ? d.sourceLabel
                          : { vault: 'Case Vault', hub: 'Document Hub', practice: 'Practice' }[docFilter]}
                      </span>
                      {d.kind && <span>{d.kind}</span>}
                      {d.caseLabel && <span>· {d.caseLabel}</span>}
                      {d.date && <span>· {new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
                      {d.needsReview && <span style={{ color: 'var(--major)' }}>· needs review</span>}
                    </div>
                  </div>
                  <div className="jx-actions">
                    {[
                      { tool: 'analyzer', label: 'Analyse', title: `Review “${d.name}” for risk in the Contract Analyzer` },
                      { tool: 'draft', label: 'Draft from', title: `Use “${d.name}” as reference context in Auto-Draft Studio` },
                      { tool: 'conflict', label: 'Conflicts', title: `Check “${d.name}” for conflicts against your other documents` },
                    ].map((a) => {
                      const isThisOne = sendingDoc === `${d.id}:${a.tool}`;
                      return (
                        <button
                          key={a.tool}
                          type="button"
                          className="jx-act"
                          title={a.title}
                          // Only the button actually fetching shows a busy
                          // state. Disabling all of them at once left a dozen
                          // greyed-out buttons with no explanation, which reads
                          // as the page having broken rather than one action
                          // being in flight — while still preventing a second
                          // navigation racing the first.
                          disabled={sendingDoc !== null}
                          aria-busy={isThisOne}
                          style={isThisOne ? undefined : { cursor: sendingDoc ? 'default' : 'pointer' }}
                          onClick={() => sendDocToTool(d, a.tool)}
                        >
                          {isThisOne ? 'Opening…' : a.label}
                        </button>
                      );
                    })}
                    <Link className="jx-act" to={d.href} title={`Open where “${d.name}” is filed`}>Open</Link>
                  </div>
                </div>
              ))}
              {/* The filter chip counts everything that matched; the rail shows
                  the six most recent. Without this line the two numbers simply
                  disagreed on screen with no way to reach the rest. */}
              {visibleDocCount > filteredWorkspaceDocs.length && (
                <div style={{ paddingTop: '12px', textAlign: 'center' }}>
                  <Link to="/document-hub" className="panel-link">
                    View all {visibleDocCount} documents →
                  </Link>
                </div>
              )}
              </>
            )}
          </div>
        </div>

        {/* ── MORNING TRIAGE / VAULT DIGEST SPLIT SCREEN ── */}
        <div className="digest-grid">

          {/* Left: Urgent — Next 48 Hours */}
          <div className="panel">
            <div className="panel-head">
              <div className="panel-head-title">
                {LIGHTNING_ICON}
                Urgent — Next 48 hours
              </div>
              <Link to="/calendar" className="panel-link">Open calendar →</Link>
            </div>
            <div className="panel-body">
              {loading ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                  {SPINNER_SVG} Loading triage items…
                </div>
              ) : (urgentItems.length === 0 || showingEmpty) ? (
                <div className="clear-state">
                  <div className="clear-icon">{CHECK_ICON}</div>
                  <div className="clear-title">Clear — no urgent deadlines</div>
                  <div className="clear-sub">You have no limitation expiries or court appearances in the next 48 hours.</div>
                </div>
              ) : (
                urgentItems.map((ev, i) => {
                  const evType = (ev.event_type || '').toLowerCase();
                  const dotType = evType.includes('deadline') || evType.includes('drop_dead') || evType.includes('limitation')
                    ? 'deadline'
                    : evType.includes('appearance') || evType.includes('hearing')
                    ? 'hearing'
                    : '';
                  const whenStr = formatWhen(ev.event_date);
                  const isUrgentChip = whenStr === 'Today' || whenStr === 'Tomorrow';

                  return (
                    <div key={ev.id || i} className="event-chip">
                      <div className={`event-dot ${dotType}`} />
                      <div>
                        <div className="event-title">{ev.title}</div>
                        <div className="event-meta">
                          {ev.location && <span>{ev.location}</span>}
                          {ev.location && ev.opposing_counsel && <span> · </span>}
                          {ev.opposing_counsel && <span>{ev.opposing_counsel}</span>}
                          {!ev.location && !ev.opposing_counsel && <span>{(ev.event_type || 'Event').replace(/_/g, ' ')}</span>}
                        </div>
                      </div>
                      <div className={`event-countdown ${isUrgentChip ? 'urgent' : ''}`}>
                        {whenStr}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Needs attention — overdue and due-soon work, merged */}
          <div className="panel">
            <div className="panel-head">
              <div className="panel-head-title">
                {CLOCK_ICON}
                Needs your attention
              </div>
              <Link to="/practice" className="panel-link">Practice →</Link>
            </div>
            <div className="panel-body">
              {loading ? (
                <div className="jx-inline-note">{SPINNER_SVG} Checking your matters…</div>
              ) : (practiceState === 'none' && (attentionItems.length === 0 || showingEmpty)) ? (
                // Only offer onboarding when there is genuinely nothing to show.
                // Gating the whole panel on "no practice" hid real Document Hub
                // work — unreviewed and failed documents — from exactly the
                // users who have no practice module to distract them from it.
                <div className="clear-state">
                  <div className="clear-icon">{SCALE_ICON}</div>
                  <div className="clear-title">Practice not set up yet</div>
                  <div className="clear-sub">Set up your practice to track matters, hearings and follow-ups — they'll surface here automatically.</div>
                  <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: '8px' }} onClick={() => navigate('/practice')}>
                    Set up practice
                  </button>
                </div>
              ) : (attentionItems.length === 0 || showingEmpty) ? (
                <div className="clear-state">
                  <div className="clear-icon">{CHECK_ICON}</div>
                  <div className="clear-title">Nothing waiting on you</div>
                  <div className="clear-sub">No overdue actions, unreviewed documents or follow-ups across your workspace.</div>
                </div>
              ) : (
                attentionItems.map((a) => (
                  <Link key={a.key} to={a.to} className="jx-att">
                    <span className={`jx-att-bar ${a.severity}`} />
                    <span style={{ minWidth: 0 }}>
                      <span className="jx-att-title" style={{ display: 'block' }}>{a.title}</span>
                      {a.sub && <span className="jx-att-sub" style={{ display: 'block' }}>{a.sub}</span>}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── PRACTICE & FILING AT A GLANCE ────────────────────────────────────
            The numbers an advocate would otherwise open three modules to read,
            each one a link straight to the screen that explains it. */}
        <div className="digest-grid">
          <div className="panel">
            <div className="panel-head">
              <div className="panel-head-title">
                {SCALE_ICON}
                Your practice
              </div>
              <Link to="/practice/cases" className="panel-link">All matters →</Link>
            </div>
            <div className="panel-body">
              {loading ? (
                <div className="jx-inline-note">{SPINNER_SVG} Loading your matters…</div>
              ) : practiceState === 'none' ? (
                <div className="jx-inline-note">
                  Your practice isn't set up yet. Once it is, active matters, this week's hearings and recent case activity appear here.
                </div>
              ) : practiceState === 'error' ? (
                <div className="jx-inline-note">Practice records are unavailable right now. Everything else on this page is still live.</div>
              ) : (
                <>
                  <div className="jx-mini-grid">
                    <Link to="/practice/cases" className="jx-mini">
                      <div className="jx-mini-val">{showingEmpty ? 0 : (practice?.counts?.active ?? 0)}</div>
                      <div className="jx-mini-lab">Active matters</div>
                    </Link>
                    <Link to="/practice/hearings" className="jx-mini">
                      <div className="jx-mini-val">{showingEmpty ? 0 : (practice?.counts?.today ?? 0)}</div>
                      <div className="jx-mini-lab">Hearings today</div>
                    </Link>
                    <Link to="/practice/hearings" className="jx-mini">
                      <div className="jx-mini-val">{showingEmpty ? 0 : (practice?.counts?.week ?? 0)}</div>
                      <div className="jx-mini-lab">This week</div>
                    </Link>
                    <Link to="/practice/rti" className="jx-mini">
                      <div className="jx-mini-val">{showingEmpty ? 0 : (practice?.counts?.rti_open ?? 0)}</div>
                      <div className="jx-mini-lab">Open RTI</div>
                    </Link>
                  </div>
                  {(showingEmpty || !(practice?.recent || []).length) ? (
                    <div className="jx-inline-note">No recent matter activity.</div>
                  ) : (
                    practice.recent.slice(0, 4).map((c) => (
                      <Link key={c.id} to={`/practice/cases/${c.id}`} className="jx-matter">
                        <span className="jx-matter-no">{c.case_no || `#${c.id}`}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="jx-doc-name" style={{ display: 'block' }}>{c.title || 'Untitled matter'}</span>
                          <span className="jx-att-sub" style={{ display: 'block' }}>
                            {[c.client_name, c.court, c.last_event].filter(Boolean).join(' · ') || 'No activity recorded'}
                          </span>
                        </span>
                      </Link>
                    ))
                  )}
                </>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="panel-head-title" style={{ color: 'var(--ink-soft)' }}>
                {FOLDER_ICON}
                Vault &amp; filing
              </div>
              <Link to="/document-hub" className="panel-link">Document Hub →</Link>
            </div>
            <div className="panel-body">
              {loading ? (
                <div className="jx-inline-note">{SPINNER_SVG} Loading your filing…</div>
              ) : (
                <>
                  <div className="jx-mini-grid">
                    {/* An em dash where a counter's own endpoint did not
                        answer. Falling back to documents.length would print a
                        confident "25" — the page size of the rail's query —
                        for a vault holding nine hundred documents. */}
                    <Link to="/vault" className="jx-mini">
                      <div className="jx-mini-val">{showingEmpty ? 0 : (vaultOverview ? (vaultOverview.documents ?? 0) : '—')}</div>
                      <div className="jx-mini-lab">In vault</div>
                    </Link>
                    <Link to="/document-hub" className="jx-mini">
                      <div className="jx-mini-val">{showingEmpty ? 0 : (hubStats ? (hubStats.added_7d ?? 0) : '—')}</div>
                      <div className="jx-mini-lab">Filed this week</div>
                    </Link>
                    <Link to="/document-hub" className="jx-mini">
                      <div className="jx-mini-val">{showingEmpty ? 0 : (hubStats ? (hubStats.review ?? 0) : '—')}</div>
                      <div className="jx-mini-lab">To review</div>
                    </Link>
                    <Link to="/firm-library" className="jx-mini">
                      <div className="jx-mini-val">{showingEmpty ? 0 : (vaultOverview ? (vaultOverview.drafts ?? 0) : '—')}</div>
                      <div className="jx-mini-lab">Saved drafts</div>
                    </Link>
                  </div>
                  {(showingEmpty || recentVaultDocs.length === 0) ? (
                    <div className="jx-inline-note">Nothing filed in your vault yet.</div>
                  ) : (
                    recentVaultDocs.map((d) => (
                      <Link
                        key={d.id}
                        to={`/case/vault/doc/${d.id}`}
                        state={{ fromVault: true, docData: { id: d.id, title: d.title, text: d.content, doc_type: d.doc_type } }}
                        className="doc-row"
                      >
                        <div className="doc-icon">{DOC_ICON}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="doc-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.smart_title || d.title || 'Untitled Document'}
                          </div>
                          <div className="doc-meta">
                            {d.doc_type || 'Document'} {d.created_at ? `· ${new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '-10px' }}>
          <button className="link-toggle" onClick={() => setShowingEmpty(v => !v)}>
            {showingEmpty ? 'Exit preview — show my real figures' : 'Preview the "all clear" empty state'}
          </button>
        </div>

        {/* ── QUICK DRAFT BANNER ── */}
        <button className="draft-banner" onClick={() => setQuickDraftOpen(true)}>
          <div className="draft-icon">
            {LIGHTNING_ICON}
          </div>
          <div style={{ flexGrow: 1 }}>
            <div className="draft-title">Quick Draft</div>
            <div className="draft-sub">Jump straight to a legal template — NDA, recovery notice, bail petition, eviction petition — without leaving this console.</div>
          </div>
          <span className="kbd">⌘K</span>
        </button>

        {/* ── LAW PRACTICE MODULES GRID (QUICK ACTIONS) ── */}
        <div>
          <div className="section-eyebrow">
            <div className="eyebrow" style={{ marginBottom: 0 }}>Law practice modules</div>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Quick Actions</span>
          </div>
          <div className="module-grid">
            <Link to="/contract-analyzer" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" />
                </svg>
              </div>
              <div>
                <div className="module-title">Contract Analyzer</div>
                <div className="module-sub">Risk scan &amp; AI redlining</div>
              </div>
            </Link>

            <Link to="/court-resources" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v18" /><path d="M5 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6" /><path d="M19 7l-3 6a3.5 3.5 0 0 0 7 0l-3-6" /><path d="M5 7h14" /><path d="M9 21h6" />
                </svg>
              </div>
              <div>
                <div className="module-title">Court Resources</div>
                <div className="module-sub">IPC, BNS, CrPC &amp; Bare Acts</div>
              </div>
            </Link>

            <Link to="/conflict-engine" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
                </svg>
              </div>
              <div>
                <div className="module-title">Conflict Engine</div>
                <div className="module-sub">Adverse-party conflict check</div>
              </div>
            </Link>

            <Link to="/legal-forms" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <div>
                <div className="module-title">Legal Forms</div>
                <div className="module-sub">50+ Indian legal templates</div>
              </div>
            </Link>

            <Link to="/war-room" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21h18" /><path d="M4 21V10l8-6 8 6v11" /><path d="M9 21v-6h6v6" />
                </svg>
              </div>
              <div>
                <div className="module-title">Virtual Courtroom</div>
                <div className="module-sub">AI bench litigation sim</div>
              </div>
            </Link>

            <Link to="/vault" className="module-card">
              <div className="module-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" /><path d="M9.5 12l2 2 3.2-3.6" />
                </svg>
              </div>
              <div>
                <div className="module-title">Case Vault</div>
                <div className="module-sub">Secure evidence repository</div>
              </div>
            </Link>
          </div>
        </div>

      </div>

      {/* ── QUICK DRAFT MODAL OVERLAY ── */}
      {quickDraftOpen && (
        <div
          onClick={() => setQuickDraftOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000, background: 'var(--overlay)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: '540px', background: 'var(--paper)', border: '1px solid var(--rule)',
              borderRadius: '16px', boxShadow: 'var(--shadow)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rule)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              {SEARCH_ICON}
              <input
                autoFocus
                type="text"
                placeholder="Search templates… (Press Esc to close)"
                value={quickDraftQuery}
                onChange={(e) => setQuickDraftQuery(e.target.value)}
                style={{
                  width: '100%', background: 'transparent', border: 'none', outline: 'none',
                  color: 'var(--ink)', fontSize: '15px', fontFamily: 'var(--font-sans)',
                }}
              />
            </div>
            <div style={{ maxHeight: '340px', overflowY: 'auto', padding: '10px' }}>
              {filteredQuickDraftTemplates.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: '13.5px' }}>
                  No matching legal templates found.
                </div>
              ) : (
                filteredQuickDraftTemplates.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => handleQuickDraftSelect(t)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                      padding: '12px 14px', borderRadius: '10px', cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: '14px', color: 'var(--ink)', fontWeight: 600 }}>📋 {t.title}</span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', background: 'var(--paper-2)', padding: '2px 8px', borderRadius: '4px' }}>{t.category}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SAVED SESSION DRAFTS MODAL OVERLAY ── */}
      <DraftsModal isOpen={showDraftsModal} onClose={() => setShowDraftsModal(false)} />
    </div>
  );
}
