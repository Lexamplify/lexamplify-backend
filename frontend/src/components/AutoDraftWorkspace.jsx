import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import ContractTiptapEditor from './ContractTiptapEditor.jsx';
import DraftsModal from './DraftsModal.jsx';
import { useContractStore } from '../store/useContractStore.js';
import { fetchDocuments, extractContractText } from '../services/api.js';
import { smartFormatUploadedText } from '../tiptap/textToHtml.js';
import { useLetterheads } from '../hooks/useLetterheads.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const LETTERHEAD_STORAGE_KEY = 'userLetterheads';
const SCRATCHPAD_STORAGE_KEY = 'autodraft_active_scratchpad';
const CREATE_LETTERHEAD_SENTINEL = 'create_custom';
const AUTO_DETECT_SENTINEL = 'auto_detect';
// Firm branding lives at the very top (cover page/header) or the very
// end (signature block) of a document, never the middle — slicing to
// just those two windows before sending to the LLM keeps a long draft
// well under Groq's per-request TPM budget (see utils/ai_helper.py)
// instead of shipping the whole document for a detail that's never
// actually buried in its body text.
const LETTERHEAD_SLICE_CHARS = 3000;
// Mirrors the backend's own defense-in-depth check (routes/contract_routes.py's
// _BRACKET_PLACEHOLDER_RE) — belt and suspenders in case a future backend
// change ever lets a raw "[Party A]"-shaped placeholder back through
// unfiltered; the frontend shouldn't silently accept that as a real firm.
const BRACKET_PLACEHOLDER_RE = /^\s*\[.*\]\s*$/;

const DRAFT_STAGES = [
  { title: 'Statutory Interpretation', desc: 'Analyzing instructions and Indian legal framework bounds' },
  { title: 'Statutory Alignment', desc: 'Cross-referencing Indian Contract Act, 1872 & landmark case law' },
  { title: 'Operative Clause Synthesis', desc: 'Drafting structured, multi-tier terms, remedies & obligations' },
  { title: 'Execution Finalization', desc: 'Formatting numbered clauses, statutory indents & signature blocks' },
];

export default function AutoDraftWorkspace() {
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const promptTextareaRef = useRef(null);
  const draftUploadInputRef = useRef(null);

  // Shared contract state lifted from store
  const {
    rawText,
    setRawText,
    setRawHtml,
    setClauses,
    setSummary,
    autoDraftText,
    setAutoDraftText,
    autoDraftHtml,
    setAutoDraftHtml,
    autoDraftPrompt,
    setAutoDraftPrompt,
    autoDraftVersion,
    setAutoDraftVersion,
    openDraftsModal,
  } = useContractStore();

  // Local synthesis studio state
  const [drafting, setDrafting] = useState(false);
  const [draftStep, setDraftStep] = useState(0);
  const [draftProgress, setDraftProgress] = useState(0);
  const [draftError, setDraftError] = useState('');
  const [vaultDocs, setVaultDocs] = useState([]);
  const [selectedContextMode, setSelectedContextMode] = useState('active_contract');
  const [draftDepth, setDraftDepth] = useState('comprehensive');
  const [copied, setCopied] = useState(false);
  const [appended, setAppended] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [uploadingDraft, setUploadingDraft] = useState(false);
  const [draftUploadError, setDraftUploadError] = useState('');
  const [showVariablesPanel, setShowVariablesPanel] = useState(false);
  const [extractedVariables, setExtractedVariables] = useState([]);

  const [activeMods, setActiveMods] = useState({ cure: false, feecap: false, seat: false, carveout: false });
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [toolbarRef, setToolbarRef] = useState(null);

  const toggleMod = (modKey, text) => {
    setActiveMods(prev => {
      const next = !prev[modKey];
      let currentPrompt = autoDraftPrompt || '';
      if (next) {
        if (!currentPrompt.includes(text)) {
           setAutoDraftPrompt(currentPrompt.trim() ? `${currentPrompt.trim()}\n- ${text}` : `- ${text}`);
        }
      } else {
        const regex = new RegExp(`\\n?- ${text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'g');
        setAutoDraftPrompt(currentPrompt.replace(regex, '').trim());
      }
      return { ...prev, [modKey]: next };
    });
  };

  const getStatutes = () => {
    const set = new Set();
    if (autoDraftText) {
      set.add('Indian Contract Act, 1872');
      if (autoDraftText.toLowerCase().includes('arbitration') || activeMods.carveout) set.add('Arbitration and Conciliation Act, 1996');
      if (autoDraftText.toLowerCase().includes('company')) set.add('Companies Act, 2013');
      if (autoDraftText.toLowerCase().includes('copyright')) set.add('Copyright Act, 1957');
    }
    return Array.from(set);
  };
  const statutes = getStatutes();

  const overflowRef = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (showOverflowMenu && overflowRef.current && !overflowRef.current.contains(e.target)) {
        setShowOverflowMenu(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showOverflowMenu]);

  // ── Workbench layout: outline rail + collapsible panels ──────────────────
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [outlineHeadings, setOutlineHeadings] = useState([]);
  const canvasContainerRef = useRef(null);
  const [intelTab, setIntelTab] = useState('instructions');
  const [precedentSearch, setPrecedentSearch] = useState('');

  // Client-side heading scan (no backend/section data model — see plan) —
  // the synthesized document is a flat string/HTML blob, so the outline is
  // derived by reading the rendered TipTap document's own heading nodes
  // rather than any structured {sections:[...]} the backend doesn't
  // produce. A MutationObserver (not just a re-scan on autoDraftText
  // change) is needed because the canvas is a contenteditable ProseMirror
  // tree — headings can be added/edited/removed by the user typing
  // directly into it without ever calling setAutoDraftText synchronously.
  //
  // Debounced via setTimeout (a macrotask) rather than scanning inside the
  // MutationObserver callback directly (a microtask) — TipTap/ProseMirror
  // mutates its own DOM on essentially every internal update (cursor
  // decorations, widget nodes), and calling setState synchronously from
  // that microtask risked a render -> DOM-touch -> new MutationRecord ->
  // microtask loop that never yields back to the event loop (confirmed
  // live: the tab hard-hung after Synthesize until reloaded). The
  // setTimeout hop plus a content-signature check before setState breaks
  // that cycle. Only childList/subtree is observed, not characterData —
  // a live rename of heading text is picked up on the next structural
  // edit or autoDraftText change rather than instantly, which is an
  // acceptable trade for never re-entering this loop.
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    let timeoutId = null;
    let lastSignature = null;

    const scan = () => {
      const nodes = container.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3');
      const next = Array.from(nodes).map((el, i) => ({
        id: `ad-outline-heading-${i}`,
        text: el.textContent || `Untitled ${i + 1}`,
        level: Number(el.tagName.slice(1)),
      }));
      const signature = next.map((h) => `${h.level}:${h.text}`).join('|');
      if (signature === lastSignature) return;
      lastSignature = signature;
      setOutlineHeadings(next);
    };

    const scheduleScan = () => {
      if (timeoutId) return;
      timeoutId = setTimeout(() => {
        timeoutId = null;
        scan();
      }, 400);
    };

    scan();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [autoDraftText, autoDraftVersion]);

  const jumpToHeading = (headingId) => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const index = Number(headingId.replace('ad-outline-heading-', ''));
    const nodes = container.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3');
    const el = nodes[index];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('ad-outline-flash');
    setTimeout(() => el.classList.remove('ad-outline-flash'), 900);
  };

  // Document Health — derived from state that already exists elsewhere in
  // this component (wordCount below, extractedVariables from Extract
  // Variables), not a new data source.
  const openPlaceholderCount = (autoDraftText.match(/\[([^\]\n]{1,80})\]/g) || []).length;

  // ── Letterhead export ────────────────────────────────────────────────────
  // Previously lived behind a generic "Export" button that opened a modal
  // containing the letterhead picker — confirmed with the founder that this
  // buried the one thing lawyers actually asked for (drafting on the firm's
  // letterhead) behind a click that didn't read as "letterhead" at all. Now
  // an always-visible bar under the toolbar, no modal, no extra click.
  //
  // Real per-user persistence (routes/letterhead_routes.py, `letterheads`
  // table) replaces the old localStorage-only `userLetterheads` array —
  // this hook owns the network calls; `savedLetterheads` below is a local
  // view shaped exactly like the old localStorage array (`id`/`name`/
  // `firmName`/`tagline`/`address`/`contact`) so the rest of this
  // component's logic (dedupe-by-firmName, activeLetterhead lookup, the
  // <select>/modal JSX) is unchanged.
  const { letterheads: serverLetterheads, loading: letterheadsLoading, createLetterhead, deleteLetterhead: deleteLetterheadRemote } = useLetterheads();
  const savedLetterheads = serverLetterheads.map((lh) => ({
    id: String(lh.id),
    name: lh.auto_detected ? `${lh.name} (Auto-Detected)` : lh.name,
    firmName: lh.name,
    tagline: lh.tagline || '',
    address: lh.address || '',
    contact: lh.contact || '',
  }));
  const [selectedLetterheadId, setSelectedLetterheadId] = useState('none');
  const [showLetterheadModal, setShowLetterheadModal] = useState(false);
  const [newLetterheadFirmName, setNewLetterheadFirmName] = useState('');
  const [newLetterheadTagline, setNewLetterheadTagline] = useState('');
  const [newLetterheadAddress, setNewLetterheadAddress] = useState('');
  const [newLetterheadContact, setNewLetterheadContact] = useState('');
  const [letterheadFormError, setLetterheadFormError] = useState('');
  // One-time carry-forward: real letterheads created before this backend
  // existed live only in localStorage. Unlike Home Gateway's seed/demo
  // placeholders, these are genuine user-created data worth keeping — so
  // if the server list comes back empty and an old localStorage array is
  // still there, push each entry to the server exactly once (guarded by a
  // ref, not state, so this can't re-fire on every serverLetterheads
  // refresh) rather than silently dropping them or migrating repeatedly.
  const letterheadCarryForwardDone = useRef(false);
  useEffect(() => {
    if (letterheadCarryForwardDone.current || letterheadsLoading) return;
    if (serverLetterheads.length > 0) { letterheadCarryForwardDone.current = true; return; }
    let stored = [];
    try {
      stored = JSON.parse(localStorage.getItem(LETTERHEAD_STORAGE_KEY) || '[]');
    } catch {
      stored = [];
    }
    if (!Array.isArray(stored) || stored.length === 0) { letterheadCarryForwardDone.current = true; return; }
    letterheadCarryForwardDone.current = true;
    (async () => {
      for (const lh of stored) {
        if (!lh || !lh.firmName) continue;
        try {
          await createLetterhead({
            name: lh.firmName,
            tagline: lh.tagline || '',
            address: lh.address || '',
            contact: lh.contact || '',
            autoDetected: /\(Auto-Detected\)$/.test(lh.name || ''),
          });
        } catch {}
      }
      try { localStorage.removeItem(LETTERHEAD_STORAGE_KEY); } catch {}
    })();
  }, [serverLetterheads, letterheadsLoading, createLetterhead]);
  // Contextual guidance shown above the creation form when Auto-Detect
  // comes back empty/placeholder-only — opening the modal WITH an
  // explanation instead of a dead-end toast the lawyer has to separately
  // notice and then go find "+ Add / Manage Letterheads..." themselves.
  const [letterheadModalNotice, setLetterheadModalNotice] = useState('');
  
  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportedSuccess, setExportedSuccess] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [toast, setToast] = useState('');
  const exportMenuRef = useRef(null);

  // Guards the sessionStorage scratchpad sync below against the mount-order
  // race: autoDraftHtml starts as '' on every fresh mount (a hard reload
  // resets the whole in-memory Zustand store), and a naive effect syncing
  // on every change would fire with that empty value BEFORE the rehydration
  // effect below has had a chance to read anything back — silently wiping
  // out whatever was saved from the previous session. Nothing is allowed to
  // write until rehydration has explicitly run once.
  const isRehydrated = useRef(false);

  // Mount-only rehydration. Only restores from sessionStorage when the
  // in-memory canvas is still empty — if autoDraftText already has content
  // (e.g. the user navigated to another route and back within the same SPA
  // session, so the Zustand store never reset), that live content is
  // authoritative and a possibly-older sessionStorage snapshot must not
  // clobber it. autoDraftText (not just autoDraftHtml) has to come back too
  // — the canvas below only mounts <ContractTiptapEditor> at all when
  // autoDraftText is non-empty, so restoring the HTML alone would leave the
  // rehydrated content sitting in the store with the placeholder still on
  // screen.
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem(SCRATCHPAD_STORAGE_KEY);
      if (cached && !autoDraftText.trim()) {
        const scratch = document.createElement('div');
        scratch.innerHTML = cached;
        const plainText = scratch.textContent || '';
        if (plainText.trim()) {
          setAutoDraftText(plainText);
          setAutoDraftHtml(cached);
        }
      }
    } catch {}
    // Marked rehydrated either way — a brand-new session with nothing cached
    // still needs to start persisting from here on, not stay permanently
    // disabled just because there was nothing to restore this time.
    isRehydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced sync: every edit lands in sessionStorage a moment after typing
  // settles, not on every keystroke.
  useEffect(() => {
    if (!isRehydrated.current || !autoDraftHtml.trim()) return;
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(SCRATCHPAD_STORAGE_KEY, autoDraftHtml);
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [autoDraftHtml]);

  // Close the export format menu on any outside click.
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const activeLetterhead = savedLetterheads.find((l) => l.id === selectedLetterheadId) || null;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const closeLetterheadModal = () => {
    setShowLetterheadModal(false);
    setLetterheadModalNotice('');
    setLetterheadFormError('');
  };

  const openLetterheadModalWithNotice = (notice) => {
    setLetterheadFormError('');
    setLetterheadModalNotice(notice);
    setShowLetterheadModal(true);
  };

  const handleLetterheadSelectChange = (e) => {
    const selectEl = e.target;
    const val = selectEl.value;
    // Cached before either branch below runs anything async — both
    // auto_detect and create_custom are actions, not real selections.
    const cachedActiveId = selectedLetterheadId;

    if (val === CREATE_LETTERHEAD_SENTINEL) {
      // The controlled `value` prop already resets this <select> to
      // cachedActiveId on the next render, but forcing the DOM value back
      // synchronously too means a second click on the same action option
      // is guaranteed to still register as a real change event even if
      // some other render doesn't land in between.
      selectEl.value = cachedActiveId;
      openLetterheadModalWithNotice('');
      return;
    }
    if (val === AUTO_DETECT_SENTINEL) {
      selectEl.value = cachedActiveId;
      handleAutoDetectLetterhead();
      return;
    }
    setSelectedLetterheadId(val);
    setExportError('');
  };

  // AI-assisted letterhead detection — reads the drafted document itself
  // (rather than making the lawyer type in a firm's details it can
  // already see on the page) and asks the backend's LLM gateway to pull
  // out {firmName, tagline, address, contact}, if any firm — or, failing
  // that, the primary corporate party — is actually named in the text.
  const handleAutoDetectLetterhead = async () => {
    if (!autoDraftText.trim() || isExtracting) return;
    setIsExtracting(true);
    setExportError('');
    const NOTHING_FOUND_NOTICE = 'No explicit firm details found in this draft. Enter your firm or chamber details below to create this letterhead.';
    try {
      const head = autoDraftText.slice(0, LETTERHEAD_SLICE_CHARS);
      const tail = autoDraftText.length > LETTERHEAD_SLICE_CHARS
        ? autoDraftText.slice(-LETTERHEAD_SLICE_CHARS)
        : '';
      const sliced = tail ? `${head}\n...\n${tail}` : head;

      const res = await fetch(`${API_BASE}/api/contract/extract-letterhead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sliced }),
      });
      const data = await res.json().catch(() => ({}));

      const rawFirmName = data.firmName ? String(data.firmName).trim() : '';
      const isPlaceholder = BRACKET_PLACEHOLDER_RE.test(rawFirmName);

      if (!res.ok || !rawFirmName || isPlaceholder) {
        // Adaptive fallback: open the creation modal directly, with a
        // contextual notice, instead of a dead-end toast the lawyer would
        // have to separately notice and then go find "+ Add / Manage
        // Letterheads..." themselves to actually act on.
        openLetterheadModalWithNotice(NOTHING_FOUND_NOTICE);
        return;
      }

      const firmName = rawFirmName;
      // Dedupe by firm name (case-insensitive) rather than blindly
      // appending — re-running Auto-Detect on the same draft, or on a
      // second draft from the same firm, would otherwise pile up
      // identical entries in localStorage every time.
      const existing = savedLetterheads.find(
        (l) => (l.firmName || '').trim().toLowerCase() === firmName.toLowerCase()
      );
      if (existing) {
        setSelectedLetterheadId(existing.id);
        showToast(`Using saved letterhead "${existing.firmName}".`);
        return;
      }

      const created = await createLetterhead({
        name: firmName,
        tagline: data.tagline || '',
        address: data.address || '',
        contact: data.contact || '',
        autoDetected: true,
      });
      setSelectedLetterheadId(String(created.id));
      showToast(`Detected letterhead: "${firmName}".`);
    } catch (err) {
      openLetterheadModalWithNotice(NOTHING_FOUND_NOTICE);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSaveLetterhead = async () => {
    const firmName = newLetterheadFirmName.trim();
    if (!firmName) {
      setLetterheadFormError('Firm name is required.');
      return;
    }
    try {
      const created = await createLetterhead({
        name: firmName,
        tagline: newLetterheadTagline.trim(),
        address: newLetterheadAddress.trim(),
        contact: newLetterheadContact.trim(),
      });
      setSelectedLetterheadId(String(created.id));
      setNewLetterheadFirmName('');
      setNewLetterheadTagline('');
      setNewLetterheadAddress('');
      setNewLetterheadContact('');
      closeLetterheadModal();
    } catch (err) {
      setLetterheadFormError(err.message || 'Failed to save letterhead.');
    }
  };

  const handleDeleteLetterhead = async (id) => {
    try {
      await deleteLetterheadRemote(id);
    } catch {}
    // Deleting the currently-active letterhead falls back to plain —
    // activeLetterhead's own .find() would already resolve to null for a
    // dangling id, but resetting the <select> explicitly avoids leaving
    // it visually pointed at an option that no longer exists.
    setSelectedLetterheadId((prev) => (prev === id ? 'none' : prev));
  };

  useEffect(() => {
    isMountedRef.current = true;
    const loadVault = async () => {
      try {
        const res = await fetchDocuments();
        if (!isMountedRef.current) return;
        if (Array.isArray(res)) {
          setVaultDocs(res);
        }
      } catch (e) {}
    };
    loadVault();
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Smooth multi-stage animation & progress tracker during synthesis
  useEffect(() => {
    if (!drafting) {
      setDraftStep(0);
      setDraftProgress(0);
      return;
    }

    setDraftStep(0);
    setDraftProgress(12);

    const stepInterval = setInterval(() => {
      setDraftStep((prev) => (prev < DRAFT_STAGES.length - 1 ? prev + 1 : prev));
    }, 2400);

    const progressInterval = setInterval(() => {
      setDraftProgress((prev) => {
        if (prev >= 94) return prev;
        const inc = Math.max(1, Math.floor((96 - prev) * 0.12));
        return Math.min(94, prev + inc);
      });
    }, 350);

    return () => {
      clearInterval(stepInterval);
      clearInterval(progressInterval);
    };
  }, [drafting]);

  const handleSynthesize = async (e) => {
    if (e) e.preventDefault();
    if (!autoDraftPrompt.trim()) {
      setDraftError('Please enter drafting instructions before synthesizing.');
      if (promptTextareaRef.current) promptTextareaRef.current.focus();
      return;
    }

    setDrafting(true);
    setDraftError('');

    try {
      let contextValue = null;
      if (selectedContextMode === 'active_contract' && rawText.trim()) {
        contextValue = rawText.trim();
      } else if (selectedContextMode !== 'none' && selectedContextMode !== 'active_contract') {
        contextValue = selectedContextMode;
      }

      // Backend now resumes truncated drafts with up to 4 follow-up LLM
      // calls (max_continuations in document_routes.py) AND retries any
      // individual call that hits Groq's account-wide rolling rate limit,
      // sleeping for however long Groq's own error says to wait (verified
      // live up to ~32s for one retry) before trying again. A large
      // reference-context draft can legitimately need several such waits
      // across its call chain. 300s gives real room for that without
      // waiting forever on a genuine hang — comfortably above the 90s
      // floor this needs at minimum.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      let response;
      try {
        response = await fetch(`${API_BASE}/api/documents/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: autoDraftPrompt.trim(),
            context: contextValue,
            depth: draftDepth,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const data = await response.json();

      if (!isMountedRef.current) return;
      setDraftProgress(100);
      setTimeout(() => {
        if (!isMountedRef.current) return;
        setDrafting(false);
      }, 400);

      if (response.ok && (data.draft || data.clause || data.content)) {
        const generated = (data.draft || data.clause || data.content).replace(/^"|"$/g, '').trim();
        setAutoDraftText(generated);
        setAutoDraftHtml('');
        setAutoDraftVersion((v) => v + 1);
        // A freshly synthesized draft replaces the canvas wholesale — drop
        // the old scratchpad snapshot so a stale one can't rehydrate over
        // this new draft if the component remounts before the debounced
        // sync above has had a chance to save it.
        try { sessionStorage.removeItem(SCRATCHPAD_STORAGE_KEY); } catch {}
      } else {
        setDraftError(data.message || 'Failed to synthesize auto-draft clause.');
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setDrafting(false);
      setDraftError(
        err?.name === 'AbortError'
          ? 'The AI reasoning engine took too long to respond (300s). Please retry — a shorter or more focused instruction may complete faster.'
          : 'Network timeout in the AI legal reasoning engine. Please retry.'
      );
    }
  };

  const handleUploadDraft = async (files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(extension)) {
      setDraftUploadError('Invalid format. Please upload a PDF, DOCX, or TXT file.');
      return;
    }
    if (file.size > 104857600) {
      setDraftUploadError('File exceeds 100MB. Please upload a smaller draft.');
      return;
    }

    setUploadingDraft(true);
    setDraftUploadError('');
    try {
      let extracted;
      if (extension === 'txt') {
        extracted = await file.text();
      } else {
        // Reuses the same /api/contract/extract-text route the Contract
        // Analyzer upload already relies on (PyMuPDF/pdfplumber/PyPDF2 for
        // PDF, python-docx for DOCX) — no new backend parsing needed.
        const res = await extractContractText(file);
        if (res?.error) throw new Error(res.message || 'Failed to extract document text.');
        extracted = typeof res === 'string' ? res : (res?.text || '');
      }

      if (!extracted || !extracted.trim()) {
        throw new Error('No readable text found in the uploaded file.');
      }

      // Same clause-numbering fixup ContractAnalyzer.jsx applies to its own
      // extracted text ("1.1" mis-split across a sentence boundary by PDF
      // extraction) — kept local since it's a one-line regex, not worth a
      // shared util for.
      const cleaned = extracted.replace(/(\w+)\.(\d+)\./g, '$1. $2.');
      setAutoDraftText(cleaned);
      // A plain extracted template has no markdown of its own (no ### or
      // **), so rawTextToHtml's generic pass would just render flat <p>
      // tags with no visual structure. smartFormatUploadedText detects
      // clause headings and highlights [bracketed] placeholders instead.
      setAutoDraftHtml(smartFormatUploadedText(cleaned));
      // An uploaded file is a brand-new template loaded onto the canvas —
      // same reasoning as the post-synthesis cleanup above.
      try { sessionStorage.removeItem(SCRATCHPAD_STORAGE_KEY); } catch {}
      setAutoDraftVersion((v) => v + 1);
    } catch (err) {
      setDraftUploadError(err?.message || 'Failed to read the uploaded draft.');
    } finally {
      setUploadingDraft(false);
      if (draftUploadInputRef.current) draftUploadInputRef.current.value = '';
    }
  };

  const handleAppendToContract = () => {
    if (!autoDraftText.trim()) return;
    const separator = rawText.trim() ? '\n\n' : '';
    setRawText(rawText + separator + autoDraftText);
    setAppended(true);
    setTimeout(() => setAppended(false), 2500);
  };

  // Distinct from Append above: this REPLACES whatever's currently loaded
  // in Contract Analyzer with the Auto-Draft document and jumps straight
  // there for a full risk scan, rather than merging into what's already
  // there. rawText/rawHtml are the same Zustand store fields Contract
  // Analyzer itself reads to hydrate its editor (confirmed by tracing its
  // own code, not guessed) — a shared reactive store, not a one-time
  // hydration key, so setting it here before navigating is sufficient; no
  // localStorage or route-state handoff needed. clauses/summary are reset
  // so a previous document's risk flags don't linger against this new text.
  const handlePushToAnalyzer = () => {
    if (!autoDraftText.trim()) return;
    setRawText(autoDraftText);
    setRawHtml(autoDraftHtml);
    setClauses([]);
    setSummary('');
    navigate('/contract-analyzer');
  };

  const handleExtractVariables = () => {
    const matches = Array.from(autoDraftText.matchAll(/\[([^\]\n]{1,80})\]/g)).map((m) => m[1]);
    const unique = Array.from(new Set(matches));
    setExtractedVariables(unique);
    setShowVariablesPanel(true);
  };

  const handleCopyDraft = () => {
    if (!autoDraftText.trim()) return;
    navigator.clipboard.writeText(autoDraftText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToDrafts = async () => {
    if (!autoDraftText.trim()) return;
    const titleMatch = autoDraftPrompt.slice(0, 45).replace(/[^\w\s]/g, '').trim();
    const title = titleMatch ? `Draft: ${titleMatch}…` : 'Synthesized Legal Clause Draft';

    const newDraft = {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      timestamp: new Date().toISOString(),
      rawText: autoDraftText,
      clauses: [],
      summary: 'Auto-Draft Studio synthesized legal draft.',
    };

    try {
      await fetch(`${API_BASE}/api/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDraft),
      });
    } catch (e) {}

    window.dispatchEvent(new CustomEvent('lexamplify-drafts-updated'));
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  // Reuses the exact fetch->blob->anchor-click download pattern already
  // proven working for Legal Forms' DOCX export (LegalForms.jsx) against
  // this same /api/contract/export-form-docx endpoint — the letterhead
  // param is new, but the transport mechanics are unchanged and known-good.
  const getExportTitle = () => {
    const titleMatch = autoDraftPrompt.slice(0, 45).replace(/[^\w\s]/g, '').trim();
    return titleMatch || 'Auto-Draft Studio Document';
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportDocx = async () => {
    if (!autoDraftText.trim()) return;
    setExportingDocx(true);
    setExportError('');
    setExportedSuccess(false);
    try {
      const title = getExportTitle();
      // autoDraftHtml is kept live by ContractTiptapEditor's onHtmlChange,
      // but stays '' for the brief window right after a fresh synthesis
      // before the editor has mounted and synced once — fall back to a
      // plain paragraph-per-line conversion so Export never sends empty
      // HTML that the backend would reject as "no document content".
      const html = autoDraftHtml.trim()
        || autoDraftText.split('\n').filter((l) => l.trim()).map((l) => `<p>${l.trim()}</p>`).join('');

      const res = await fetch(`${API_BASE}/api/contract/export-form-docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // activeLetterhead is null for "No Letterhead" — the backend
        // treats a missing/empty firmName as "skip the header/footer
        // entirely", so this doesn't need its own special-casing here.
        body: JSON.stringify({ html, title, letterhead_data: activeLetterhead }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      downloadBlob(blob, `${title.replace(/[^a-z0-9]+/gi, '_')}.docx`);
      setExportedSuccess(true);
      setTimeout(() => setExportedSuccess(false), 2500);
    } catch (err) {
      setExportError(err.message || 'DOCX export failed.');
    } finally {
      setExportingDocx(false);
    }
  };

  // Client-side, no backend round-trip — autoDraftText is already the
  // plain-text mirror ContractTiptapEditor keeps in sync via
  // onTextChange, so there's no HTML to parse here at all.
  const handleExportTxt = () => {
    if (!autoDraftText.trim()) return;
    setExportError('');
    const title = getExportTitle();
    const letterheadBlock = activeLetterhead
      ? [activeLetterhead.firmName, activeLetterhead.tagline, activeLetterhead.address, activeLetterhead.contact]
          .filter(Boolean)
          .join('\n') + `\n${'-'.repeat(48)}\n\n`
      : '';
    const blob = new Blob([letterheadBlock + autoDraftText], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${title.replace(/[^a-z0-9]+/gi, '_')}.txt`);
    setExportedSuccess(true);
    setTimeout(() => setExportedSuccess(false), 2500);
  };

  // Native browser print -> "Save as PDF", zero backend rendering engine
  // involved (no wkhtmltopdf/cairo dependency to keep alive in
  // production). print-only-letterhead and the @media print rules below
  // do the actual layout work; this just triggers the dialog and sets
  // document.title so the browser's own "Save as PDF" suggests a sane
  // filename instead of the page's normal title.
  const handleExportPdf = () => {
    if (!autoDraftText.trim()) return;
    setExportError('');
    const title = getExportTitle();
    const originalTitle = document.title;
    document.title = title;
    window.print();
    setTimeout(() => { document.title = originalTitle; }, 1000);
  };

  const handleAddModifier = (modifierText) => {
    const currentPrompt = autoDraftPrompt;
    if (currentPrompt.includes(modifierText)) return;
    setAutoDraftPrompt(currentPrompt.trim() ? `${currentPrompt.trim()}\n- ${modifierText}` : modifierText);
  };

  const PRECEDENTS = [
    {
      label: 'Dispute Escalation & Arbitration',
      badge: 'Arbitration Act 1996',
      prompt: 'Draft a three-tier dispute escalation clause: (1) Good-faith executive negotiation within 15 business days, (2) Conciliation under Indian Mediation Rules, and (3) Binding arbitration under the Arbitration and Conciliation Act, 1996 before a sole arbitrator seated in New Delhi. Language of proceedings shall be English.',
    },
    {
      label: 'Intellectual Property Assignment',
      badge: 'Copyright Act 1957',
      prompt: 'Draft a comprehensive IP Assignment & Work Made for Hire clause. All deliverables, software, documentation, and developments created by Party B shall vest exclusively in Party A under Section 17 of the Copyright Act, 1957. Include worldwide perpetual assignment, waiver of moral rights to the fullest extent permitted by Indian Law, and no residual vendor licenses.',
    },
    {
      label: 'Severability & Statutory Validity',
      badge: 'Contract Act s.24',
      prompt: 'Draft a severability clause under Section 24 of the Indian Contract Act, 1872. If any provision is held invalid, illegal, or unenforceable by a court of competent jurisdiction, such provision shall be modified to the minimum extent necessary to make it enforceable, or severed if modification is impossible, without invalidating the remainder of this Agreement.',
    },
    {
      label: 'Mutual Notice & Service Terms',
      badge: 'General Clauses Act 1897',
      prompt: 'Draft a comprehensive notice clause. All formal legal notices must be in writing and delivered by: (a) Hand delivery with signed receipt, (b) Registered Post AD to the registered office, or (c) Encrypted email with read-receipt. Deemed service dates: hand delivery on same day, registered post within 3 business days, email on acknowledgment.',
    },
    {
      label: 'Indemnification & Third-Party Claims',
      badge: 'Contract Act s.124',
      prompt: 'Draft a mutual indemnification clause under Section 124 of the Indian Contract Act, 1872. Each party shall defend, indemnify, and hold harmless the other party, its directors, officers, and employees against any third-party claims, liabilities, losses, or legal expenses arising from gross negligence, willful misconduct, or breach of confidentiality.',
    },
    {
      label: 'Non-Compete & Confidentiality',
      badge: 'Contract Act s.27',
      prompt: 'Draft a non-disclosure and non-compete provision compliant with Section 27 of the Indian Contract Act, 1872. Restrict disclosure of proprietary trade secrets during the term and for 3 years post-termination. For non-compete, scope shall be narrowly tailored to active client solicitation and misuse of proprietary know-how.',
    },
  ];

  const wordCount = autoDraftText.trim() ? autoDraftText.trim().split(/\s+/).length : 0;
  const charCount = autoDraftText.length;
  const paragraphCount = autoDraftText.trim() ? autoDraftText.split(/\n\s*\n/).length : 0;

  useEffect(() => {
    if (!autoDraftText) return;
    const matches = autoDraftText.match(/\[([^\]\n]{1,80})\]/g) || [];
    const counts = {};
    const order = [];
    matches.forEach(m => {
      const tok = m;
      if (!counts[tok]) { counts[tok] = 0; order.push(tok); }
      counts[tok]++;
    });
    setExtractedVariables(order.map(t => ({ token: t, count: counts[t] })));
  }, [autoDraftText]);
  return (
    <div className="autodraft-page-wrapper">
      <style>{`
        .autodraft-page-wrapper {
          --bg:#191C1D; --paper:#212527; --paper-2:#2A2F31;
          --ink:#D6D9D9; --ink-soft:#AAAEAE; --muted:#727776; --muted-2:#494E4D; --rule:#333939;
          --accent:#CC6B48; --accent-soft:#3B281F;
          --major:#D9AD5C; --major-soft:#35301C;
          --on-accent:#FBF7EE;
          --shadow: 0 20px 50px rgba(0,0,0,.45);
          --overlay: rgba(10,10,10,.6);
          --page-bg:#26292B;
          background: var(--bg); color: var(--ink);
          font-family: 'IBM Plex Sans', sans-serif;
          -webkit-font-smoothing: antialiased;
          transition: background .2s ease, color .2s ease;
          overflow: hidden;
          display: flex; height: 100vh;
        }
        [data-theme="light"] .autodraft-page-wrapper,
        :root[data-theme="light"] .autodraft-page-wrapper {
          --bg:#DFE1E0; --paper:#EAEBE8; --paper-2:#E3E4E1;
          --ink:#181B1D; --ink-soft:#494E51; --muted:#868C8E; --muted-2:#B3B8B9; --rule:#D2D5D4;
          --accent:#B24A2E; --accent-soft:#EFDCD1;
          --major:#9C7A2E; --major-soft:#F1E6C9;
          --on-accent:#FBF7EE;
          --shadow: 0 20px 50px rgba(30,25,18,.14);
          --overlay: rgba(24,20,15,.45);
          --page-bg:#FFFFFF;
        }

        .autodraft-page-wrapper * { box-sizing: border-box; }
        .autodraft-page-wrapper .serif { font-family: 'Fraunces', serif; font-style: italic; letter-spacing: -0.01em; }
        .autodraft-page-wrapper .mono { font-family: 'IBM Plex Mono', monospace; }
        .autodraft-page-wrapper a { color: inherit; }
        .autodraft-page-wrapper button, .autodraft-page-wrapper input, .autodraft-page-wrapper select, .autodraft-page-wrapper textarea { font-family: inherit; }
        .autodraft-page-wrapper ::selection { background: var(--accent-soft); color: var(--ink); }
        .autodraft-page-wrapper svg { display: block; }

        .autodraft-page-wrapper .btn { display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 9px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); white-space: nowrap; }
        .autodraft-page-wrapper .btn:hover { border-color: var(--muted); }
        .autodraft-page-wrapper .btn svg { flex-shrink: 0; }
        .autodraft-page-wrapper .btn-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
        .autodraft-page-wrapper .btn-primary:hover { filter: brightness(1.08); border-color: var(--accent); }
        .autodraft-page-wrapper .btn-ghost { background: transparent; border-color: transparent; }
        .autodraft-page-wrapper .btn-ghost:hover { background: var(--paper-2); border-color: transparent; color: var(--ink); }
        .autodraft-page-wrapper .btn-sm { padding: 6px 11px; font-size: 12px; }
        .autodraft-page-wrapper .btn:disabled { opacity: .45; cursor: not-allowed; }
        .autodraft-page-wrapper .btn:disabled:hover { border-color: var(--rule); }
        .autodraft-page-wrapper .icon-btn { width: 34px; height: 34px; flex-shrink:0; border-radius: 9px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink-soft); cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .autodraft-page-wrapper .icon-btn:hover { border-color: var(--accent); color: var(--accent); }
        .autodraft-page-wrapper .icon-btn.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
        .autodraft-page-wrapper .badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; font-size: 11.5px; font-weight: 500; background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule); }
        .autodraft-page-wrapper .badge svg { flex-shrink: 0; }
        .autodraft-page-wrapper .badge-amber { background: var(--major-soft); color: var(--major); border-color: transparent; }
        .autodraft-page-wrapper select.select-compact, .autodraft-page-wrapper .select-compact select {
          appearance: none; -webkit-appearance: none; background: var(--paper); border: 1px solid var(--rule); border-radius: 8px;
          color: var(--ink); font-size: 12.5px; padding: 7px 26px 7px 10px; cursor: pointer;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23868C8E' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>");
          background-repeat: no-repeat; background-position: right 7px center; background-size: 13px;
        }
        :root[data-theme="light"] .autodraft-page-wrapper select.select-compact { background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23AAAEAE' stroke-width='2'><path d='M6 9l6 6 6-6'/></svg>"); }
        .autodraft-page-wrapper .field-label { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; display: block; }
        
        .autodraft-page-wrapper .toast { position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%) translateY(12px); background: var(--paper); border: 1px solid var(--rule); box-shadow: var(--shadow); border-radius: 11px; padding: 12px 18px; font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 10px; opacity: 0; pointer-events: none; transition: opacity .18s ease, transform .18s ease; z-index: 300; }
        .autodraft-page-wrapper .toast.open { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }
        .autodraft-page-wrapper .toast svg { color: var(--accent); flex-shrink: 0; }
        
        .autodraft-page-wrapper .modal-overlay { position: fixed; inset: 0; background: var(--overlay); display: none; align-items: center; justify-content: center; padding: 30px; z-index: 200; }
        .autodraft-page-wrapper .modal-overlay.open { display: flex; }
        .autodraft-page-wrapper .modal { background: var(--paper); border: 1px solid var(--rule); border-radius: 16px; box-shadow: var(--shadow); width: 100%; max-width: 560px; max-height: 88vh; overflow-y: auto; }
        .autodraft-page-wrapper .modal.modal-wide { max-width: 720px; }
        .autodraft-page-wrapper .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--rule); position: sticky; top: 0; background: var(--paper); z-index: 10;}
        .autodraft-page-wrapper .modal-title { font-size: 18px; margin: 0; }
        .autodraft-page-wrapper .modal-body { padding: 22px 24px; display: flex; flex-direction: column; gap: 18px; }
        .autodraft-page-wrapper .modal-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--rule); position: sticky; bottom: 0; background: var(--paper); z-index: 10;}
        
        .autodraft-page-wrapper .field input, .autodraft-page-wrapper .field textarea { width: 100%; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 9px; padding: 10px 12px; font-size: 13.5px; color: var(--ink); outline: 0; }
        .autodraft-page-wrapper .field input:focus, .autodraft-page-wrapper .field textarea:focus { border-color: var(--accent); }
        .autodraft-page-wrapper .field input::placeholder, .autodraft-page-wrapper .field textarea::placeholder { color: var(--muted); }
        .autodraft-page-wrapper .field + .field { margin-top: 2px; }

        @keyframes shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
        .autodraft-page-wrapper .shimmer { background: linear-gradient(90deg, var(--paper-2) 25%, var(--rule) 37%, var(--paper-2) 63%); background-size: 800px 100%; animation: shimmer 1.4s linear infinite; border-radius: 6px; }
        @keyframes pulse-ring { 0% { box-shadow: 0 0 0 0 var(--accent-soft); } 100% { box-shadow: 0 0 0 8px rgba(0,0,0,0); } }
        @keyframes flash-highlight { 0%, 100% { background: var(--major-soft); } 45% { background: var(--major); } }
        .autodraft-page-wrapper .flash { animation: flash-highlight .9s ease; }

        .autodraft-page-wrapper .ads-main { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; height: 100%; }
        .autodraft-page-wrapper .crumbbar { display: flex; align-items: center; justify-content: space-between; padding: 16px 28px 0; font-size: 12.5px; color: var(--muted); flex-shrink: 0; }
        .autodraft-page-wrapper .crumbbar a { color: var(--accent); text-decoration: none; }
        .autodraft-page-wrapper .crumb-current { color: var(--ink-soft); }
        .autodraft-page-wrapper .jurisdiction-note { display: flex; align-items: center; gap: 8px; }

        .autodraft-page-wrapper .ads-commandbar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 28px; flex-shrink: 0; border-bottom: 1px solid var(--rule); }
        .autodraft-page-wrapper .ads-title-wrap { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .autodraft-page-wrapper .ads-icon { width: 38px; height: 38px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .autodraft-page-wrapper .ads-title { font-size: 22px; margin: 0; line-height: 1.1; }
        .autodraft-page-wrapper .ads-jbadge { font-size: 11px; }
        .autodraft-page-wrapper .ads-commandbar-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .autodraft-page-wrapper .context-chip { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 999px; background: var(--paper-2); border: 1px solid var(--rule); font-size: 12px; color: var(--ink-soft); }
        .autodraft-page-wrapper .context-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: #6FA97A; flex-shrink: 0; }
        .autodraft-page-wrapper .context-chip.empty .dot { background: var(--muted); }
        .autodraft-page-wrapper .context-chip b { color: var(--ink); font-weight: 600; }

        .autodraft-page-wrapper .ads-workbench { flex-grow: 1; min-height: 0; display: grid; grid-template-columns: 240px 20px 1fr 20px 380px; transition: grid-template-columns .28s cubic-bezier(.32,.72,0,1); }
        .autodraft-page-wrapper .ads-workbench.outline-collapsed { grid-template-columns: 0px 20px 1fr 20px 380px; }
        .autodraft-page-wrapper .ads-workbench.panel-collapsed { grid-template-columns: 240px 20px 1fr 20px 0px; }
        .autodraft-page-wrapper .ads-workbench.outline-collapsed.panel-collapsed { grid-template-columns: 0px 20px 1fr 20px 0px; }

        .autodraft-page-wrapper .outline-rail { border-right: 1px solid var(--rule); background: var(--paper); overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
        .autodraft-page-wrapper .outline-rail-inner { width: 240px; display: flex; flex-direction: column; min-height: 0; height: 100%; }
        .autodraft-page-wrapper .outline-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
        .autodraft-page-wrapper .outline-head-label { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 7px; }
        .autodraft-page-wrapper .outline-list { flex-grow: 1; overflow-y: auto; padding: 4px 10px 10px; display: flex; flex-direction: column; gap: 1px; }
        .autodraft-page-wrapper .outline-item { display: flex; align-items: baseline; gap: 9px; padding: 7px 9px; border-radius: 8px; border: 0; background: transparent; color: var(--ink-soft); font-size: 12.5px; text-align: left; cursor: pointer; width: 100%; transition: background .15s ease; }
        .autodraft-page-wrapper .outline-item:hover { background: var(--paper-2); }
        .autodraft-page-wrapper .outline-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
        .autodraft-page-wrapper .outline-item .num { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--muted); flex-shrink: 0; }
        .autodraft-page-wrapper .outline-item.active .num { color: var(--accent); }
        .autodraft-page-wrapper .outline-empty { padding: 20px 16px; font-size: 12px; color: var(--muted); line-height: 1.6; }
        .autodraft-page-wrapper .outline-health { margin: 8px 10px 14px; padding: 13px 14px; border-radius: 12px; background: var(--paper-2); border: 1px solid var(--rule); display: flex; flex-direction: column; gap: 9px; }
        .autodraft-page-wrapper .health-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
        .autodraft-page-wrapper .health-row span:first-child { color: var(--muted); }
        .autodraft-page-wrapper .health-row b { font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 12px; }
        .autodraft-page-wrapper .health-row.warn b { color: var(--major); }
        .autodraft-page-wrapper .health-row.ok b { color: #6FA97A; }

        .autodraft-page-wrapper .rail-toggle { width: 20px; align-self: stretch; border: 0; border-left: 1px solid var(--rule); background: var(--paper); color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .autodraft-page-wrapper .rail-toggle:hover { color: var(--accent); background: var(--paper-2); }
        .autodraft-page-wrapper .rail-toggle.right-edge { border-left: 0; border-right: 1px solid var(--rule); }
        .autodraft-page-wrapper .rail-toggle svg { transition: transform .2s ease; }

        .autodraft-page-wrapper .canvas-col { min-width: 0; display: flex; flex-direction: column; background: var(--bg); position: relative; min-height: 0; }
        .autodraft-page-wrapper .canvas-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 24px; border-bottom: 1px solid var(--rule); flex-shrink: 0; flex-wrap: wrap; background: var(--paper); }
        .autodraft-page-wrapper .doc-meta { display: flex; align-items: center; gap: 12px; min-width: 0; }
        .autodraft-page-wrapper .doc-meta-title { font-size: 14px; font-weight: 600; white-space: nowrap; }
        .autodraft-page-wrapper .doc-meta-count { font-size: 11.5px; color: var(--muted); }
        .autodraft-page-wrapper .autosave-chip { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
        .autodraft-page-wrapper .autosave-dot { width: 6px; height: 6px; border-radius: 50%; background: #6FA97A; animation: pulse-ring 1.8s ease-out infinite; }
        .autodraft-page-wrapper .toolbar-actions { display: flex; align-items: center; gap: 8px; }

        .autodraft-page-wrapper .overflow-wrap { position: relative; }
        .autodraft-page-wrapper .overflow-menu { position: absolute; top: calc(100% + 6px); right: 0; width: 210px; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; box-shadow: var(--shadow); padding: 6px; display: none; flex-direction: column; gap: 1px; z-index: 40; }
        .autodraft-page-wrapper .overflow-menu.open { display: flex; }
        .autodraft-page-wrapper .overflow-item { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; border: 0; background: transparent; color: var(--ink); font-size: 13px; cursor: pointer; text-align: left; width: 100%; transition: background .15s ease; }
        .autodraft-page-wrapper .overflow-item:hover { background: var(--paper-2); }
        .autodraft-page-wrapper .overflow-item svg { color: var(--ink-soft); flex-shrink: 0; }
        .autodraft-page-wrapper .overflow-item.danger { color: var(--accent); }
        .autodraft-page-wrapper .overflow-item.danger svg { color: var(--accent); }
        .autodraft-page-wrapper .overflow-divider { height: 1px; background: var(--rule); margin: 4px 2px; }

        .autodraft-page-wrapper .format-row { display: flex; align-items: center; gap: 8px; padding: 9px 24px; border-bottom: 1px solid var(--rule); flex-shrink: 0; flex-wrap: wrap; background: var(--paper); }
        .autodraft-page-wrapper .format-group { display: flex; align-items: center; gap: 4px; padding-right: 8px; border-right: 1px solid var(--rule); min-height: 34px; }
        .autodraft-page-wrapper .format-group:last-child { border-right: 0; }

        .autodraft-page-wrapper .rich-text-toolbar { border: 0 !important; background: transparent !important; padding: 0 !important; }
        :root[data-theme="light"] .autodraft-page-wrapper .rich-text-toolbar { border: 0 !important; background: transparent !important; }

        .autodraft-page-wrapper .trust-strip { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 9px 24px; border-bottom: 1px solid var(--rule); background: var(--paper); flex-shrink: 0; flex-wrap: wrap; }
        .autodraft-page-wrapper .trust-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .autodraft-page-wrapper .statute-chip { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; padding: 4px 9px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule); }
        .autodraft-page-wrapper .trust-empty { font-size: 11.5px; color: var(--muted); }
        .autodraft-page-wrapper .trust-disclaimer { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--major); white-space: nowrap; }

        .autodraft-page-wrapper .canvas-scroll { flex-grow: 1; overflow-y: auto; padding: 40px 40px 90px; display: flex; justify-content: center; }

        /* The canvas styling that actually applies to ContractTiptapEditor's ProseMirror container
           so it behaves correctly like a physical page (Lawyer's styling) */
        .autodraft-page-wrapper .tiptap-editor-shell { border: none !important; box-shadow: none !important; background: transparent !important; flex: 1; display: flex; flex-direction: column; }
        .autodraft-page-wrapper .scanner-body .ProseMirror {
          width: 100%;
          max-width: 820px; 
          margin: 0 auto; 
          background: var(--page-bg); 
          border-radius: 6px; 
          box-shadow: var(--shadow); 
          padding: 76px 84px; 
          min-height: 1000px; 
          color: #23262A;
          font-family: 'Source Serif 4', Georgia, serif; 
          font-size: 11pt; 
          line-height: 1.5; 
          text-align: justify;
          outline: none;
        }
        :root[data-theme="dark"] .autodraft-page-wrapper .scanner-body .ProseMirror {
          color: #EDEBE5;
        }
        .autodraft-page-wrapper .scanner-body .ProseMirror h1,
        .autodraft-page-wrapper .scanner-body .ProseMirror h2,
        .autodraft-page-wrapper .scanner-body .ProseMirror h3 {
          font-family: 'Source Serif 4', Georgia, serif;
          font-size: 1.25em;
          font-weight: 700;
          letter-spacing: .02em;
          margin: 34px 0 10px;
          padding-bottom: 8px;
          border-bottom: 1.5px solid currentColor;
          opacity: .92;
        }
        .autodraft-page-wrapper .scanner-body .ProseMirror h1:first-child,
        .autodraft-page-wrapper .scanner-body .ProseMirror h2:first-child,
        .autodraft-page-wrapper .scanner-body .ProseMirror h3:first-child {
          margin-top: 0;
        }
        .autodraft-page-wrapper .scanner-body .ProseMirror p {
          font-family: inherit;
          font-size: 11pt;
          line-height: 1.75;
          margin: 0 0 14px;
        }
        .autodraft-page-wrapper .scanner-body .ProseMirror strong,
        .autodraft-page-wrapper .scanner-body .ProseMirror b {
          color: inherit !important;
          font-weight: bold !important;
        }
        
        .autodraft-page-wrapper .doc-placeholder { background: var(--major-soft); color: var(--major); padding: 1px 5px; border-radius: 4px; font-weight: 600; cursor: default; transition: background .3s; }
        
        .autodraft-page-wrapper .empty-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; padding: 70px 20px 30px; }
        .autodraft-page-wrapper .empty-icon { width: 62px; height: 62px; border-radius: 16px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
        .autodraft-page-wrapper .empty-state h3 { font-size: 21px; margin: 0; }
        .autodraft-page-wrapper .empty-state p { font-size: 13.5px; color: var(--ink-soft); max-width: 460px; line-height: 1.6; margin: 0 0 18px; }
        .autodraft-page-wrapper .quickstart-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px; max-width: 760px; width: 100%; }
        .autodraft-page-wrapper .quickstart-card { display: flex; flex-direction: column; align-items: flex-start; gap: 9px; padding: 18px; border-radius: 13px; border: 1px solid var(--rule); background: var(--paper); cursor: pointer; text-align: left; transition: border-color .15s ease; }
        .autodraft-page-wrapper .quickstart-card:hover { border-color: var(--accent); }
        .autodraft-page-wrapper .quickstart-card svg { color: var(--accent); }
        .autodraft-page-wrapper .quickstart-card .qc-title { font-size: 13.5px; font-weight: 600; }
        .autodraft-page-wrapper .quickstart-card .qc-desc { font-size: 12px; color: var(--muted); line-height: 1.5; }

        .autodraft-page-wrapper .synth-loading { display: flex; flex-direction: column; gap: 16px; padding: 8px 0 30px; width: 100%; max-width: 820px; margin: 0 auto; background: var(--page-bg); border-radius: 6px; box-shadow: var(--shadow); padding: 76px 84px; min-height: 1000px; }
        .autodraft-page-wrapper .synth-loading-label { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--ink-soft); margin-bottom: 4px; }

        /* ----- intelligence panel ----- */
        .autodraft-page-wrapper .intel-panel { border-left: 1px solid var(--rule); background: var(--paper); overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
        .autodraft-page-wrapper .intel-panel-inner { width: 380px; display: flex; flex-direction: column; min-height: 0; height: 100%; }
        .autodraft-page-wrapper .intel-tabs { display: flex; gap: 2px; padding: 12px 16px 0; flex-shrink: 0; }
        .autodraft-page-wrapper .intel-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 10px 8px; border-radius: 9px 9px 0 0; border: 0; background: transparent; color: var(--muted); font-size: 12.5px; font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent; }
        .autodraft-page-wrapper .intel-tab.active { color: var(--accent); border-bottom-color: var(--accent); background: var(--paper-2); }
        .autodraft-page-wrapper .intel-body { flex-grow: 1; overflow-y: auto; padding: 18px 18px 24px; display: none; flex-direction: column; gap: 18px; }
        .autodraft-page-wrapper .intel-body.active { display: flex; }

        .autodraft-page-wrapper .instructions-textarea { width: 100%; min-height: 128px; resize: vertical; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 11px; padding: 13px 14px; font-size: 13px; line-height: 1.55; color: var(--ink); outline: 0; }
        .autodraft-page-wrapper .instructions-textarea:focus { border-color: var(--accent); }
        .autodraft-page-wrapper .instructions-textarea::placeholder { color: var(--muted); }

        .autodraft-page-wrapper .modifier-chips { display: flex; flex-wrap: wrap; gap: 7px; }
        .autodraft-page-wrapper .modifier-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--rule); background: var(--paper-2); color: var(--ink-soft); font-size: 12px; font-weight: 500; cursor: pointer; transition: background .15s ease; }
        .autodraft-page-wrapper .modifier-chip svg { width: 13px; height: 13px; }
        .autodraft-page-wrapper .modifier-chip.active { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }

        .autodraft-page-wrapper .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .autodraft-page-wrapper .field-row select { width: 100%; }

        .autodraft-page-wrapper .cta-primary { width: 100%; justify-content: center; padding: 13px 16px; font-size: 13.5px; font-weight: 600; }
        .autodraft-page-wrapper .cta-secondary { width: 100%; justify-content: center; }

        .autodraft-page-wrapper .precedent-search { display: flex; align-items: center; gap: 8px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: 9px; padding: 9px 11px; }
        .autodraft-page-wrapper .precedent-search svg { color: var(--muted); flex-shrink: 0; }
        .autodraft-page-wrapper .precedent-search input { border: 0; background: transparent; outline: 0; color: var(--ink); font-size: 13px; width: 100%; }
        .autodraft-page-wrapper .precedent-search input::placeholder { color: var(--muted); }
        .autodraft-page-wrapper .precedent-list { display: flex; flex-direction: column; gap: 8px; }
        .autodraft-page-wrapper .precedent-card { border: 1px solid var(--rule); border-radius: 11px; padding: 13px 14px; background: var(--paper-2); cursor: pointer; transition: border-color .15s ease; text-align: left; }
        .autodraft-page-wrapper .precedent-card:hover { border-color: var(--accent); }
        .autodraft-page-wrapper .precedent-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .autodraft-page-wrapper .precedent-title { font-size: 13px; font-weight: 600; line-height: 1.35; }
        .autodraft-page-wrapper .precedent-act { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; padding: 3px 7px; border-radius: 999px; background: var(--major-soft); color: var(--major); white-space: nowrap; flex-shrink: 0; }
        .autodraft-page-wrapper .precedent-desc { font-size: 12px; color: var(--muted); line-height: 1.55; margin: 7px 0 10px; }
        .autodraft-page-wrapper .precedent-insert { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--accent); background: transparent; border: 0; cursor: pointer; padding: 0; }
        .autodraft-page-wrapper .precedent-empty { padding: 24px 6px; text-align: center; font-size: 12.5px; color: var(--muted); }

        .autodraft-page-wrapper .extract-list { display: flex; flex-direction: column; gap: 6px; }
        .autodraft-page-wrapper .extract-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 9px; border: 1px solid var(--rule); background: var(--paper-2); cursor: pointer; transition: border-color .15s ease;}
        .autodraft-page-wrapper .extract-item:hover { border-color: var(--accent); }
        .autodraft-page-wrapper .extract-token { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--major); }
        .autodraft-page-wrapper .extract-count { font-size: 11px; color: var(--muted); }
        .autodraft-page-wrapper .saved-drafts-list { display: flex; flex-direction: column; gap: 8px; }
        .autodraft-page-wrapper .saved-draft-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 13px; border-radius: 10px; border: 1px solid var(--rule); }
        .autodraft-page-wrapper .saved-draft-name { font-size: 13px; font-weight: 500; }
        .autodraft-page-wrapper .saved-draft-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }

        @media (max-width: 1180px) {
          .autodraft-page-wrapper .ads-workbench { grid-template-columns: 0px 20px 1fr 20px 340px; }
          .autodraft-page-wrapper .ads-workbench.panel-collapsed { grid-template-columns: 0px 20px 1fr 20px 0px; }
        }
        
        .ad-outline-flash { animation: flash-highlight .9s ease; }
      `}</style>

      <div className="ads-main">
        <header className="ads-commandbar">
          <div className="ads-title-wrap">
            <div className="ads-icon">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"></path></svg>
            </div>
            <div>
              <h1 className="ads-title serif">Auto-Draft Studio</h1>
            </div>
            <span className="badge ads-jbadge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z"></path><path d="M9.5 12l2 2 3.2-3.6"></path></svg>
              Sovereign Legal Engine
            </span>
          </div>
          <div className="ads-commandbar-actions">
            <div className={`context-chip ${!rawText ? 'empty' : ''}`}>
              <span className="dot"></span>
              {rawText ? 
                <>Active Contract: <b>{rawText.length.toLocaleString()} chars</b></> :
                <>No Active Contract <span style={{color:'var(--muted)'}}>&middot; Standalone Synthesis</span></>
              }
            </div>
            <button className="btn btn-sm" onClick={() => openDraftsModal()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5.5S5 4 8 4s5 1.5 5 1.5v14S11 18 8 18s-5 1.5-5 1.5z"></path><path d="M21 5.5S19 4 16 4s-5 1.5-5 1.5v14S13 18 16 18s5 1.5 5 1.5z"></path></svg>
              Saved Drafts
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => {}}>
              Open Contract Analyzer
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="M13 6l6 6-6 6"></path></svg>
            </button>
          </div>
        </header>

        <div className={`ads-workbench ${outlineCollapsed ? 'outline-collapsed' : ''} ${panelCollapsed ? 'panel-collapsed' : ''}`}>
          
          {/* Outline rail */}
          <div className="outline-rail">
            <div className="outline-rail-inner">
              <div className="outline-head">
                <span className="outline-head-label">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13"></path><path d="M3 6h.01M3 12h.01M3 18h.01"></path></svg>
                  Outline
                </span>
              </div>
              <div className="outline-list">
                {!autoDraftText ? (
                  <div className="outline-empty">Synthesize or upload a draft to see its section outline here.</div>
                ) : (
                  outlineHeadings.map(h => (
                    <button key={h.id} className={`outline-item`} onClick={() => jumpToHeading(h.id)}>
                      <span className="num mono">{h.level}</span>
                      <span>{h.text}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="outline-health">
                {!autoDraftText ? (
                  <div className="health-row"><span>Document</span><b className="mono">&mdash;</b></div>
                ) : (
                  <>
                    <div className="health-row"><span>Sections</span><b className="mono">{outlineHeadings.length}</b></div>
                    <div className="health-row"><span>Words</span><b className="mono">{(autoDraftText.split(/\s+/).filter(Boolean).length || 0).toLocaleString()}</b></div>
                    <div className={`health-row ${extractedVariables.reduce((a,v) => a+v.count, 0) > 0 ? 'warn' : 'ok'}`}>
                      <span>Placeholders open</span><b className="mono">{extractedVariables.reduce((a,v) => a+v.count, 0)}</b>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          <button className="rail-toggle" onClick={() => setOutlineCollapsed(!outlineCollapsed)} aria-label="Toggle outline">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: outlineCollapsed ? 'rotate(180deg)' : '' }}><path d="M15 6l-6 6 6 6"></path></svg>
          </button>

          {/* Canvas column */}
          <div className="canvas-col">
            <div className="canvas-toolbar">
              <div className="doc-meta">
                <span className="doc-meta-title">Synthesized Document</span>
                <span className="doc-meta-count mono">{autoDraftText ? `${(autoDraftText.split(/\s+/).filter(Boolean).length || 0).toLocaleString()} words` : ''}</span>
                {autoDraftText && <span className="autosave-chip"><span className="autosave-dot"></span>Active Session</span>}
              </div>
              <div className="toolbar-actions">
                <button className="btn btn-sm" onClick={() => {
                  if (navigator.clipboard && navigator.clipboard.writeText && autoDraftText) {
                    navigator.clipboard.writeText(autoDraftText);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"></path></svg>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button className="btn btn-sm" onClick={() => {}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path></svg>
                  Save Draft
                </button>
                <div className="overflow-wrap" ref={overflowRef}>
                  <button className="icon-btn" onClick={() => setShowOverflowMenu(!showOverflowMenu)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="19" cy="12" r="1.6"></circle></svg>
                  </button>
                  <div className={`overflow-menu ${showOverflowMenu ? 'open' : ''}`}>
                    <button className="overflow-item" onClick={() => { setShowOverflowMenu(false); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v8M8 12h8"></path></svg>
                      Append clause
                    </button>
                    <button className="overflow-item" onClick={() => { setShowOverflowMenu(false); setShowVariablesPanel(true); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18M3 15v4a2 2 0 0 0 2 2h4"></path></svg>
                      Extract variables
                    </button>
                    <button className="overflow-item" onClick={() => { setShowOverflowMenu(false); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7z"></path></svg>
                      Push to Analyzer
                    </button>
                    <div className="overflow-divider"></div>
                    <button className="overflow-item danger" onClick={() => { setShowOverflowMenu(false); setShowClearConfirm(true); }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>
                      Clear document
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="format-row">
              <div ref={setToolbarRef} style={{ display: 'flex', alignItems: 'center' }} />
              <div className="format-group" style={{ flexGrow:1, justifyContent:'flex-end', borderRight:0, gap:'8px' }}>
                <select className="select-compact" style={{ width: '200px' }} value={selectedLetterheadId} onChange={(e) => {
                  if (e.target.value === '__create') { setShowLetterheadModal(true); return; }
                  setSelectedLetterheadId(e.target.value);
                }}>
                  <option value="none">No Letterhead (Plain)</option>
                  <option value="standard">Standard Firm Letterhead (Mock)</option>
                  {savedLetterheads.map(lh => (
                    <option key={lh.id} value={lh.id}>{lh.name || lh.firmName}</option>
                  ))}
                  <option value="__create">+ Create Custom Letterhead&hellip;</option>
                </select>
                <div className="overflow-wrap">
                  <button className="btn btn-sm" onClick={() => setShowExportMenu(!showExportMenu)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"></path><path d="M7 10l5 5 5-5"></path><path d="M5 21h14"></path></svg>
                    Export
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
                  </button>
                  <div className={`overflow-menu ${showExportMenu ? 'open' : ''}`} style={{ width: '160px' }}>
                    <button className="overflow-item" onClick={() => { setShowExportMenu(false); handleExportDocx(); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path><path d="M14 3v5h5"></path></svg>Word (.docx)</button>
                    <button className="overflow-item" onClick={() => { setShowExportMenu(false); handleExportPdf(); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path><path d="M14 3v5h5"></path></svg>PDF</button>
                    <button className="overflow-item" onClick={() => { setShowExportMenu(false); handleExportTxt(); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path><path d="M14 3v5h5"></path></svg>Plain text</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="trust-strip">
              <div className="trust-left">
                {!statutes.length ? (
                  <span className="trust-empty">No statutes referenced yet</span>
                ) : (
                  statutes.map(s => <span key={s} className="statute-chip">{s}</span>)
                )}
              </div>
              <div className="trust-disclaimer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4M12 16.5h.01"></path></svg>
                AI-synthesized — review before use
              </div>
            </div>

            <div className="canvas-scroll" ref={canvasContainerRef}>
              {drafting ? (
                <div className="synth-loading">
                  <div className="synth-loading-label"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin .9s linear infinite' }}><path d="M12 2a10 10 0 0 1 10 10"></path></svg>Synthesizing against Indian statutory precedent...</div>
                  <div className="shimmer" style={{ height: '22px', width: '40%' }}></div>
                  <div className="shimmer" style={{ height: '14px', width: '92%' }}></div>
                  <div className="shimmer" style={{ height: '14px', width: '86%' }}></div>
                  <div className="shimmer" style={{ height: '14px', width: '70%' }}></div>
                  <div className="shimmer" style={{ height: '22px', width: '32%', marginTop: '14px' }}></div>
                  <div className="shimmer" style={{ height: '14px', width: '94%' }}></div>
                  <div className="shimmer" style={{ height: '14px', width: '60%' }}></div>
                </div>
              ) : autoDraftText ? (
                <ContractTiptapEditor
                  documentKey={autoDraftVersion}
                  initialRawText={autoDraftText}
                  initialHtml={autoDraftHtml}
                  onTextChange={setAutoDraftText}
                  onHtmlChange={setAutoDraftHtml}
                  clauses={[]}
                  toolbarPortalTarget={toolbarRef}
                />
              ) : (
                <div className="empty-state">
                  <div className="empty-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg></div>
                  <h3 className="serif">Enterprise Auto-Draft Canvas Ready</h3>
                  <p>Describe what you need, pick a Playbook precedent, or upload a draft to extract and append — the canvas will fill in as a real, navigable document.</p>
                  <div className="quickstart-grid">
                    <button className="quickstart-card" onClick={() => { setIntelTab('instructions'); setTimeout(() => promptTextareaRef.current?.focus(), 10); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg><span className="qc-title">Describe what you need</span><span className="qc-desc">Write drafting instructions and let the engine synthesize a full agreement.</span></button>
                    <button className="quickstart-card" onClick={() => setIntelTab('playbook')}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5.5S5 4 8 4s5 1.5 5 1.5v14S11 18 8 18s-5 1.5-5 1.5z"></path><path d="M21 5.5S19 4 16 4s-5 1.5-5 1.5v14S13 18 16 18s5 1.5 5 1.5z"></path></svg><span className="qc-title">Start from a precedent</span><span className="qc-desc">Insert an Indian Playbook clause and build outward from it.</span></button>
                    <button className="quickstart-card" onClick={() => draftUploadInputRef.current?.click()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9"></path><path d="M7 14l5-5 5 5"></path><path d="M5 21h14"></path></svg><span className="qc-title">Upload a draft</span><span className="qc-desc">Extract deadlines, defined terms and structure from an existing file.</span></button>
                  </div>
                  <input type="file" ref={draftUploadInputRef} style={{ display: 'none' }} accept=".pdf,.docx,.txt" onChange={(e) => {}} />
                </div>
              )}
            </div>
          </div>

          {/* Intelligence Panel */}
          <button className="rail-toggle right-edge" onClick={() => setPanelCollapsed(!panelCollapsed)} aria-label="Toggle draft intelligence panel">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: panelCollapsed ? 'rotate(180deg)' : '' }}><path d="M9 6l6 6-6 6"></path></svg>
          </button>
          <div className="intel-panel">
            <div className="intel-panel-inner">
              <div className="intel-tabs">
                <button className={`intel-tab ${intelTab === 'instructions' ? 'active' : ''}`} onClick={() => setIntelTab('instructions')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>
                  Instructions
                </button>
                <button className={`intel-tab ${intelTab === 'playbook' ? 'active' : ''}`} onClick={() => setIntelTab('playbook')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5.5S5 4 8 4s5 1.5 5 1.5v14S11 18 8 18s-5 1.5-5 1.5z"></path><path d="M21 5.5S19 4 16 4s-5 1.5-5 1.5v14S13 18 16 18s5 1.5 5 1.5z"></path></svg>
                  Playbook
                </button>
              </div>

              <div className={`intel-body ${intelTab === 'instructions' ? 'active' : ''}`}>
                <div>
                  <span className="field-label">Custom Drafting Instructions</span>
                  <textarea 
                    className="instructions-textarea" 
                    ref={promptTextareaRef}
                    placeholder="e.g. Synthesize a complete Non-Disclosure & Non-Circumvention Agreement under the Indian Contract Act, 1872..."
                    value={autoDraftPrompt}
                    onChange={(e) => setAutoDraftPrompt(e.target.value)}
                  />
                  {draftError && <div style={{ fontSize: '12.5px', color: '#EF4444', marginTop: '6px' }}>{draftError}</div>}
                </div>
                <div>
                  <span className="field-label">Quick Provision Insert Modifiers</span>
                  <div className="modifier-chips">
                    <button className={`modifier-chip ${activeMods.cure ? 'active' : ''}`} onClick={() => toggleMod('cure', 'Include 30-day written cure period before escalation.')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"></path></svg>30-Day Cure</button>
                    <button className={`modifier-chip ${activeMods.feecap ? 'active' : ''}`} onClick={() => toggleMod('feecap', 'Cap aggregate liability at 100% of fees paid.')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"></path></svg>100% Fee Cap</button>
                    <button className={`modifier-chip ${activeMods.seat ? 'active' : ''}`} onClick={() => toggleMod('seat', 'Seat of arbitration shall be New Delhi under Arbitration Act 1996.')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"></path></svg>New Delhi Seat</button>
                    <button className={`modifier-chip ${activeMods.carveout ? 'active' : ''}`} onClick={() => toggleMod('carveout', 'Include Section 27 Indian Contract Act exception for trade secrets.')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"></path></svg>Sec 27 Carve-out</button>
                  </div>
                </div>
                <div className="field-row">
                  <div>
                    <span className="field-label">Reference Context</span>
                    <select className="select-compact" style={{ width: '100%' }} value={selectedContextMode} onChange={(e) => setSelectedContextMode(e.target.value)}>
                      <option value="active_contract">Active Contract</option>
                      <option value="none">Standalone (no reference)</option>
                      {vaultDocs && vaultDocs.map(doc => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}
                    </select>
                  </div>
                  <div>
                    <span className="field-label">Scope Depth</span>
                    <select className="select-compact" style={{ width: '100%' }} value={draftDepth} onChange={(e) => setDraftDepth(e.target.value)}>
                      <option value="essential">Essential</option>
                      <option value="standard">Standard</option>
                      <option value="comprehensive">Comprehensive</option>
                    </select>
                  </div>
                </div>
                <button className="btn btn-primary cta-primary" onClick={handleSynthesize} disabled={drafting}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h6l-1 8 9-12h-6z"></path></svg>
                  {drafting ? 'Synthesizing...' : 'Synthesize Enterprise Clause'}
                </button>
              </div>

              <div className={`intel-body ${intelTab === 'playbook' ? 'active' : ''}`}>
                <div className="precedent-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>
                  <input placeholder="Search Indian Playbook precedents…" value={precedentSearch} onChange={e => setPrecedentSearch(e.target.value)} />
                </div>
                <div className="precedent-list">
                  {PRECEDENTS && PRECEDENTS.filter(p => !precedentSearch || p.label.toLowerCase().includes(precedentSearch.toLowerCase()) || p.badge.toLowerCase().includes(precedentSearch.toLowerCase()) || p.prompt.toLowerCase().includes(precedentSearch.toLowerCase())).map(p => (
                    <div key={p.label} className="precedent-card" onClick={() => {
                      const existing = (autoDraftPrompt || '').trim();
                      const newPrompt = existing ? `${existing}\n\n${p.prompt}` : p.prompt;
                      setAutoDraftPrompt(newPrompt);
                      setIntelTab('instructions');
                      setTimeout(() => {
                        if (promptTextareaRef.current) {
                          promptTextareaRef.current.focus();
                          promptTextareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                      }, 10);
                    }}>
                      <div className="precedent-card-head">
                        <span className="precedent-title">{p.label}</span>
                        <span className="precedent-act mono">{p.badge}</span>
                      </div>
                      <div className="precedent-desc">{p.prompt}</div>
                      <button className="precedent-insert">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v8M8 12h8"></path></svg>
                        Insert into instructions
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <DraftsModal />

      {/* Modals */}
      {showClearConfirm && createPortal(
        <div className="modal-overlay open" onClick={() => setShowClearConfirm(false)}>
          <div className="modal" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Clear this document?</h3>
              <button className="icon-btn" onClick={() => setShowClearConfirm(false)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"></path><path d="M6 6l12 12"></path></svg></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize:'13px', color:'var(--ink-soft)', margin:0, lineHeight:1.55 }}>This removes the synthesized document from the canvas. This can't be undone — save or export first if you want to keep it.</p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowClearConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: 'var(--accent)' }} onClick={() => { setAutoDraftText(''); setAutoDraftHtml(''); setShowClearConfirm(false); }}>Clear document</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showVariablesPanel && createPortal(
        <div className="modal-overlay open" onClick={() => setShowVariablesPanel(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Extract Variables</h3>
              <button className="icon-btn" onClick={() => setShowVariablesPanel(false)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"></path><path d="M6 6l12 12"></path></svg></button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '12.5px', color: 'var(--ink-soft)', margin: 0, lineHeight: 1.55 }}>Every bracketed placeholder found in the current draft. Click one to jump to its first occurrence in the document.</p>
              <div className="extract-list">
                {!extractedVariables.length ? (
                  <div className="precedent-empty">No open placeholders — this draft is fully filled in.</div>
                ) : (
                  extractedVariables.map(p => (
                    <button key={p.token} className="extract-item" onClick={() => {
                      setShowVariablesPanel(false);
                      setTimeout(() => {
                        const nodes = canvasContainerRef.current?.querySelectorAll('.doc-placeholder, .placeholder, span');
                        let target = null;
                        nodes?.forEach(n => { if (n.textContent === p.token) target = n; });
                        if (target) {
                          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          target.classList.add('flash');
                          setTimeout(() => target.classList.remove('flash'), 950);
                        }
                      }, 100);
                    }}>
                      <span className="extract-token mono">{p.token}</span>
                      <span className="extract-count">{p.count} {p.count === 1 ? 'occurrence' : 'occurrences'}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowVariablesPanel(false)}>Close</button>
              <button className="btn btn-primary" onClick={() => {
                const text = extractedVariables.map(v => v.token).join('\n');
                navigator.clipboard.writeText(text);
              }}>Copy list</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showLetterheadModal && createPortal(
        <div className="modal-overlay open" onClick={closeLetterheadModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create Custom Letterhead</h3>
              <button className="icon-btn" onClick={closeLetterheadModal}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"></path><path d="M6 6l12 12"></path></svg></button>
            </div>
            <div className="modal-body">
              <div className="field"><span className="field-label">Firm Name *</span><input value={newLetterheadFirmName} onChange={e => setNewLetterheadFirmName(e.target.value)} placeholder="e.g. Sharma & Associates" /></div>
              <div className="field"><span className="field-label">Tagline</span><input value={newLetterheadTagline} onChange={e => setNewLetterheadTagline(e.target.value)} placeholder="e.g. Advocates & Solicitors, Mumbai" /></div>
              <div className="field"><span className="field-label">Address</span><input value={newLetterheadAddress} onChange={e => setNewLetterheadAddress(e.target.value)} placeholder="e.g. 4th Floor, Nariman Point, Mumbai 400021" /></div>
              <div className="field"><span className="field-label">Contact (Email / Phone)</span><input value={newLetterheadContact} onChange={e => setNewLetterheadContact(e.target.value)} placeholder="e.g. contact@firm.com · +91 98765 43210" /></div>
              {letterheadFormError && <div style={{ fontSize: '12px', color: '#EF4444', marginTop: '4px' }}>{letterheadFormError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={closeLetterheadModal}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveLetterhead}>Save Letterhead</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {toast && createPortal(
        <div className="toast open">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
          <span id="toastMsg">{toast}</span>
        </div>,
        document.body
      )}
    </div>
  );
}
