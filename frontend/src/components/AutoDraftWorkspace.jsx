import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import ContractTiptapEditor from './ContractTiptapEditor.jsx';
import DraftsModal from './DraftsModal.jsx';
import { useContractStore } from '../store/useContractStore.js';
import { fetchDocuments, extractContractText } from '../services/api.js';
import { smartFormatUploadedText } from '../tiptap/textToHtml.js';

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

  // ── Letterhead export ────────────────────────────────────────────────────
  // Previously lived behind a generic "Export" button that opened a modal
  // containing the letterhead picker — confirmed with the founder that this
  // buried the one thing lawyers actually asked for (drafting on the firm's
  // letterhead) behind a click that didn't read as "letterhead" at all. Now
  // an always-visible bar under the toolbar, no modal, no extra click.
  //
  // No firm-branding/settings table exists anywhere in this codebase (the
  // backend confirmed this last cycle), and building one is out of scope
  // here — user-defined letterheads are persisted client-side in
  // localStorage instead, and their full data is sent with each export
  // rather than a server-side lookup key.
  const [savedLetterheads, setSavedLetterheads] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(LETTERHEAD_STORAGE_KEY) || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  });
  const [selectedLetterheadId, setSelectedLetterheadId] = useState('none');
  const [showLetterheadModal, setShowLetterheadModal] = useState(false);
  const [newLetterheadFirmName, setNewLetterheadFirmName] = useState('');
  const [newLetterheadTagline, setNewLetterheadTagline] = useState('');
  const [newLetterheadAddress, setNewLetterheadAddress] = useState('');
  const [newLetterheadContact, setNewLetterheadContact] = useState('');
  const [letterheadFormError, setLetterheadFormError] = useState('');
  // Contextual guidance shown above the creation form when Auto-Detect
  // comes back empty/placeholder-only — opening the modal WITH an
  // explanation instead of a dead-end toast the lawyer has to separately
  // notice and then go find "+ Add / Manage Letterheads..." themselves.
  const [letterheadModalNotice, setLetterheadModalNotice] = useState('');
  const [showExportMenu, setShowExportMenu] = useState(false);
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

  useEffect(() => {
    try {
      localStorage.setItem(LETTERHEAD_STORAGE_KEY, JSON.stringify(savedLetterheads));
    } catch {}
  }, [savedLetterheads]);

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

      const entry = {
        id: `lh-${Date.now()}`,
        // "name" is the list/dropdown label only — marks this entry as
        // machine-detected there. "firmName" stays the clean extracted
        // value, since that's what actually gets printed on the exported
        // letterhead itself; it must never carry the "(Auto-Detected)" suffix.
        name: `${firmName} (Auto-Detected)`,
        firmName,
        tagline: data.tagline || '',
        address: data.address || '',
        contact: data.contact || '',
      };
      setSavedLetterheads((prev) => [...prev, entry]);
      setSelectedLetterheadId(entry.id);
      showToast(`Detected letterhead: "${firmName}".`);
    } catch (err) {
      openLetterheadModalWithNotice(NOTHING_FOUND_NOTICE);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSaveLetterhead = () => {
    const firmName = newLetterheadFirmName.trim();
    if (!firmName) {
      setLetterheadFormError('Firm name is required.');
      return;
    }
    const entry = {
      id: `lh-${Date.now()}`,
      name: firmName,
      firmName,
      tagline: newLetterheadTagline.trim(),
      address: newLetterheadAddress.trim(),
      contact: newLetterheadContact.trim(),
    };
    setSavedLetterheads((prev) => [...prev, entry]);
    setSelectedLetterheadId(entry.id);
    setNewLetterheadFirmName('');
    setNewLetterheadTagline('');
    setNewLetterheadAddress('');
    setNewLetterheadContact('');
    closeLetterheadModal();
  };

  const handleDeleteLetterhead = (id) => {
    setSavedLetterheads((prev) => prev.filter((l) => l.id !== id));
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

    try {
      const existing = JSON.parse(localStorage.getItem('lexamplify_drafts') || '[]');
      const updated = [newDraft, ...existing.filter((d) => d.id !== newDraft.id)];
      localStorage.setItem('lexamplify_drafts', JSON.stringify(updated));
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

  return (
    <div className="autodraft-page-wrapper">
      <style>{`
        .autodraft-page-wrapper {
          padding: 24px 28px;
          max-width: 1560px;
          margin: 0 auto;
          color: var(--text-primary);
          font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        }

        /* Top Header Bar */
        .ad-header-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          padding: 16px 24px;
          border-radius: 14px;
          margin-bottom: 24px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        }

        .ad-header-title-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ad-title-gradient {
          font-size: 20px;
          font-weight: 800;
          margin: 0;
          color: var(--text-primary);
          letter-spacing: -0.02em;
        }

        .ad-sovereign-badge {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          background: var(--accent-muted, rgba(59,130,246,0.12));
          color: var(--accent-primary, #3B82F6);
          border: 1px solid rgba(59,130,246,0.3);
          padding: 3px 10px;
          border-radius: 20px;
        }

        /* Workspace Grid */
        .ad-workspace-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(370px, 0.75fr);
          gap: 24px;
          align-items: start;
        }

        @media (max-width: 1080px) {
          .ad-workspace-grid {
            grid-template-columns: 1fr;
          }
        }

        /* Left Canvas Panel */
        .ad-canvas-panel {
          background: var(--bg-panel);
          border-radius: 16px;
          border: 1px solid var(--border-subtle);
          padding: 24px;
          min-height: 720px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 16px 40px rgba(0,0,0,0.15);
          position: relative;
        }

        .ad-canvas-header {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--border-subtle);
          margin-bottom: 16px;
        }

        .ad-canvas-header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        /* Wraps onto a second line instead of overlapping the title —
           at anything less than a very wide viewport, 6 action buttons
           plus the title never actually fit on one row. */
        .ad-toolbar-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }

        .ad-metric-pill {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          padding: 4px 10px;
          border-radius: 6px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .ad-action-btn {
          font-size: 12px;
          font-weight: 600;
          padding: 7px 14px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: none;
        }

        .ad-btn-primary {
          background: var(--accent-primary, #3B82F6);
          color: #FFFFFF !important;
          box-shadow: 0 4px 12px rgba(37,99,235,0.25);
        }
        .ad-btn-primary:hover {
          background: var(--accent-hover, #2563EB);
          transform: translateY(-1px);
        }

        .ad-btn-secondary {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
        }
        .ad-btn-secondary:hover {
          background: var(--accent-muted);
          border-color: var(--accent-primary);
        }

        .ad-btn-purple {
          background: rgba(139,92,246,0.14);
          border: 1px solid rgba(139,92,246,0.35);
          color: #8B5CF6;
        }
        .ad-btn-purple:hover {
          background: rgba(139,92,246,0.25);
        }

        /* Letterhead & export bar — permanently visible (no modal) so the
           letterhead option is actually discoverable, not a click away. */
        .ad-letterhead-bar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding: 12px 14px;
          margin-bottom: 20px;
          border-radius: 10px;
          background: rgba(139,92,246,0.07);
          border: 1px solid rgba(139,92,246,0.2);
        }
        .ad-letterhead-label {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
        }
        .ad-letterhead-select {
          flex: 1 1 200px;
          min-width: 180px;
          padding: 7px 10px;
          border-radius: 7px;
          font-size: 12.5px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
        }
        .ad-letterhead-error {
          flex-basis: 100%;
          font-size: 12px;
          color: #EF4444;
        }

        /* Multi-format export split-button */
        .ad-export-menu-wrap {
          position: relative;
          display: inline-flex;
        }
        .ad-export-menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 40;
          background: var(--bg-panel, var(--bg-card));
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          box-shadow: 0 12px 32px rgba(0,0,0,0.18);
          display: flex;
          flex-direction: column;
          min-width: 180px;
          padding: 6px;
          gap: 2px;
        }
        .ad-export-menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-primary);
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          width: 100%;
        }
        .ad-export-menu-item:hover {
          background: var(--accent-muted, rgba(59,130,246,0.08));
        }

        /* Create-letterhead modal */
        .ad-modal-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
          z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px;
        }
        .ad-modal {
          background: var(--bg-panel, var(--bg-card)); border: 1px solid var(--border-subtle);
          border-radius: 14px; width: 100%; max-width: 440px; box-shadow: 0 24px 60px rgba(0,0,0,0.35);
        }
        .ad-modal-header {
          padding: 18px 20px; border-bottom: 1px solid var(--border-subtle);
          display: flex; align-items: center; justify-content: space-between;
        }
        .ad-modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
        .ad-modal-footer {
          padding: 14px 20px; border-top: 1px solid var(--border-subtle);
          display: flex; gap: 10px; justify-content: flex-end;
        }
        .ad-modal-label {
          font-size: 12px; font-weight: 600; color: var(--text-muted);
          display: block; margin-bottom: 6px;
        }
        .ad-modal-input {
          width: 100%; padding: 9px 12px; border-radius: 8px; font-size: 13px;
          background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text-primary);
          box-sizing: border-box;
        }

        /* Adaptive-fallback notice shown when Auto-Detect found nothing */
        .ad-letterhead-notice {
          font-size: 12.5px; line-height: 1.5; color: var(--text-primary);
          background: rgba(139,92,246,0.08); border: 1px solid rgba(139,92,246,0.28);
          border-radius: 8px; padding: 10px 12px;
        }

        /* Manage / delete saved letterheads, inside the same modal */
        .ad-letterhead-manage {
          border-top: 1px solid var(--border-subtle); padding-top: 14px; margin-top: 2px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .ad-letterhead-manage-title {
          font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
          color: var(--text-muted);
        }
        .ad-letterhead-manage-list {
          display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto;
        }
        .ad-letterhead-manage-row {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 7px 10px; border-radius: 7px;
          background: var(--bg-card); border: 1px solid var(--border-subtle);
        }
        .ad-letterhead-manage-name {
          font-size: 12.5px; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ad-letterhead-delete-btn {
          font-size: 11.5px; font-weight: 600; color: #EF4444;
          background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25);
          border-radius: 6px; padding: 4px 10px; cursor: pointer; flex-shrink: 0;
        }
        .ad-letterhead-delete-btn:hover { background: rgba(239,68,68,0.16); }

        /* Letterhead auto-detect toast */
        .ad-toast {
          position: fixed; bottom: 24px; right: 24px; z-index: 1300;
          max-width: 340px;
          background: var(--bg-panel, var(--bg-card)); border: 1px solid rgba(139,92,246,0.4); color: var(--text-primary);
          padding: 11px 18px; border-radius: 9px; font-size: 13px; font-weight: 600;
          box-shadow: 0 12px 32px rgba(0,0,0,0.25);
          animation: ad-toast-in 0.25s ease;
        }
        @keyframes ad-toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Print-only letterhead — invisible on screen, drawn only when
           window.print() (the PDF export path) is active. */
        .print-only-letterhead { display: none; }

        @media print {
          /* Hide everything except the letterhead + the actual document
             body: global app chrome (rendered by AppRouter's Layout, not
             this component, but this <style> tag is a plain unscoped
             global style like the rest of this file's CSS), this page's
             own hero header / toolbar / letterhead controls / right
             panel, and the editor's own formatting toolbar. */
          .sidebar, .topbar,
          .ad-header-card, .ad-canvas-header, .ad-letterhead-bar,
          .ad-controls-panel, .ad-variables-panel,
          .rich-text-toolbar {
            display: none !important;
          }
          .ad-workspace-grid { display: block !important; }
          .ad-canvas-panel {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            min-height: 0 !important;
          }
          .tiptap-editor-shell, .scanner-body {
            border: none !important;
            box-shadow: none !important;
            background: #fff !important;
            color: #000 !important;
          }
          body, html { background: #fff !important; }

          .print-only-letterhead {
            display: block;
            text-align: center;
            font-family: Georgia, 'Times New Roman', serif;
            padding-bottom: 14px;
            margin-bottom: 20px;
            border-bottom: 2px solid #333;
          }
          .print-lh-firm { font-size: 20px; font-weight: 700; letter-spacing: 0.02em; color: #000; }
          .print-lh-tagline { font-size: 12px; color: #333; margin-top: 4px; }
          .print-lh-contact { font-size: 10.5px; color: #444; margin-top: 6px; }
        }

        /* Right Control Panel */
        .ad-controls-panel {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .ad-card {
          background: var(--bg-panel);
          border-radius: 16px;
          border: 1px solid var(--border-subtle);
          padding: 20px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.1);
        }

        .ad-card-highlight {
          border-color: rgba(59,130,246,0.3);
          background: linear-gradient(180deg, var(--bg-panel), rgba(59,130,246,0.03));
        }

        .ad-card-title {
          font-size: 12.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-primary);
          margin-bottom: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ad-precedent-grid {
          display: flex;
          flex-direction: column;
          gap: 9px;
          max-height: 480px;
          overflow-y: auto;
          padding-right: 2px;
        }

        .ad-precedent-card {
          display: flex;
          flex-direction: column;
          text-align: left;
          padding: 11px 13px;
          border-radius: 10px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .ad-precedent-card:hover {
          background: var(--accent-muted);
          border-color: var(--accent-primary);
          transform: translateX(3px);
        }

        .ad-precedent-title {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .ad-precedent-desc {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.4;
          margin-top: 3px;
        }

        .ad-precedent-badge {
          font-size: 9.5px;
          font-weight: 700;
          background: rgba(59,130,246,0.12);
          color: var(--accent-primary);
          padding: 2px 7px;
          border-radius: 4px;
          border: 1px solid rgba(59,130,246,0.25);
        }

        .ad-chip-btn {
          font-size: 11px;
          font-weight: 600;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          padding: 5px 10px;
          border-radius: 14px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .ad-chip-btn:hover {
          background: var(--accent-muted);
          color: var(--accent-primary);
          border-color: var(--accent-primary);
        }

        /* ── ELEGANT AI SYNTHESIS SUITE ANIMATION ── */
        .ad-synthesis-suite {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 24px;
          flex: 1;
          text-align: center;
        }

        .ad-orbit-wrapper {
          position: relative;
          width: 90px;
          height: 90px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ad-orbit-pulse {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(59,130,246,0.25) 0%, rgba(59,130,246,0) 70%);
          animation: orbGlow 2.4s ease-in-out infinite alternate;
        }

        .ad-orbit-ring-outer {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px dashed rgba(59,130,246,0.4);
          animation: spin 10s linear infinite;
        }

        .ad-orbit-ring-inner {
          position: absolute;
          inset: 10px;
          border-radius: 50%;
          border: 2.5px solid transparent;
          border-top-color: #3B82F6;
          border-right-color: #8B5CF6;
          animation: spin 1.8s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
        }

        .ad-orbit-core {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: linear-gradient(135deg, #2563EB, #7C3AED);
          color: #FFFFFF;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 18px rgba(37,99,235,0.4);
          position: relative;
          z-index: 2;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes orbGlow {
          0% { transform: scale(0.9); opacity: 0.4; }
          100% { transform: scale(1.15); opacity: 0.9; }
        }

        .ad-synthesis-heading {
          font-size: 16px;
          font-weight: 750;
          color: var(--text-primary);
          margin-bottom: 6px;
          letter-spacing: -0.01em;
        }

        .ad-synthesis-subtext {
          font-size: 12.5px;
          color: var(--text-muted);
          max-width: 460px;
          line-height: 1.5;
          margin-bottom: 24px;
        }

        /* Progress Laser Bar */
        .ad-progress-container {
          width: 100%;
          max-width: 440px;
          margin-bottom: 28px;
        }

        .ad-progress-track {
          width: 100%;
          height: 6px;
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          overflow: hidden;
          position: relative;
        }

        .ad-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #2563EB, #3B82F6, #8B5CF6);
          border-radius: 10px;
          transition: width 0.35s ease;
          position: relative;
        }

        .ad-progress-fill::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent);
          animation: shimmer 1.5s infinite;
        }

        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }

        .ad-progress-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 8px;
          font-size: 11.5px;
          font-weight: 600;
        }

        .ad-stage-name {
          color: var(--accent-primary, #3B82F6);
        }

        .ad-stage-pct {
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }

        /* 4-Step Interactive Pipeline Tracker */
        .ad-pipeline-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          width: 100%;
          max-width: 520px;
          text-align: left;
        }

        .ad-step-card {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          opacity: 0.5;
          transition: all 0.25s ease;
        }

        .ad-step-card.active {
          opacity: 1;
          border-color: var(--accent-primary);
          background: rgba(59,130,246,0.08);
          box-shadow: 0 4px 14px rgba(59,130,246,0.12);
        }

        .ad-step-card.done {
          opacity: 0.9;
          border-color: rgba(16,185,129,0.4);
          background: rgba(16,185,129,0.06);
        }

        .ad-step-badge {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .ad-step-card.active .ad-step-badge {
          background: #3B82F6;
          color: #FFFFFF;
          border-color: #3B82F6;
          box-shadow: 0 0 8px rgba(59,130,246,0.6);
        }

        .ad-step-card.done .ad-step-badge {
          background: #10B981;
          color: #FFFFFF;
          border-color: #10B981;
        }

        .ad-step-info {
          min-width: 0;
        }

        .ad-step-title {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ad-step-desc {
          font-size: 10px;
          color: var(--text-muted);
          line-height: 1.35;
          margin-top: 2px;
        }

        .ad-document-canvas {
          position: relative;
        }

        /* Non-blocking upload overlay — shown while parsing an uploaded
           draft, without hiding or unmounting the editor underneath. */
        .ad-upload-overlay {
          position: absolute;
          inset: 0;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-dark-card, rgba(15,23,42,0.7));
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s ease;
          border-radius: 12px;
        }
        .ad-upload-overlay.visible {
          opacity: 1;
          pointer-events: auto;
        }
        .ad-upload-spinner {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.25);
          border-top-color: #3B82F6;
          animation: spin 0.8s linear infinite;
        }

        .ad-variables-panel {
          margin-top: 12px;
          padding: 14px 16px;
          border-radius: 10px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
        }
        .ad-variable-chip {
          display: inline-flex;
          align-items: center;
          font-size: 11.5px;
          font-weight: 600;
          background: rgba(59,130,246,0.14);
          color: #1D4ED8;
          border: 1px solid rgba(59,130,246,0.3);
          border-radius: 5px;
          padding: 3px 8px;
          margin: 0 6px 6px 0;
        }

        /* TipTap Document Canvas Styling */
        .ad-document-canvas .scanner-body .ProseMirror {
          min-height: 520px;
          padding: 28px 32px;
          background: var(--bg-card);
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          font-size: 14px;
          line-height: 1.8;
          color: var(--text-primary);
          outline: none;
        }

        .ad-document-canvas .scanner-body .ProseMirror h1,
        .ad-document-canvas .scanner-body .ProseMirror h2,
        .ad-document-canvas .scanner-body .ProseMirror h3,
        .ad-document-canvas .scanner-body .ProseMirror h4 {
          font-size: 1.25rem;
          font-weight: 750;
          color: var(--text-primary);
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 6px;
          margin-top: 1.8rem;
          margin-bottom: 1.1rem;
        }

        .ad-document-canvas .scanner-body .ProseMirror p {
          margin-bottom: 1.25rem;
          line-height: 1.8;
          text-align: justify;
          color: var(--text-primary);
        }

        .ad-document-canvas .scanner-body .ProseMirror strong,
        .ad-document-canvas .scanner-body .ProseMirror b {
          color: var(--accent-primary, #3B82F6);
          font-weight: 700;
        }

        /* ── TipTap Toolbar Font & Size Select Overrides ── */
        .toolbar-select {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          font-size: 12.5px;
          font-weight: 550;
          border-radius: 6px;
          padding: 4px 8px;
          height: 32px;
          cursor: pointer;
          font-family: inherit;
          flex-shrink: 0;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          appearance: auto;
          -webkit-appearance: auto;
          outline: none;
          vertical-align: middle;
        }
        .toolbar-select-font { min-width: 155px; width: auto; }
        .toolbar-select-size { min-width: 110px; width: auto; }
        .toolbar-select option {
          background: #111827;
          color: #F8FAFC;
          font-size: 12.5px;
          padding: 6px 10px;
        }
        .toolbar-select:hover { border-color: var(--accent-primary); }
        .toolbar-select:focus { outline: none; border-color: var(--accent-primary); box-shadow: 0 0 0 2px rgba(59,130,246,0.25); }

        /* ── LIGHT THEME COMPLETE HIGH-CONTRAST OVERRIDES ── */
        :root[data-theme="light"] .ad-header-card {
          background: #FFFFFF !important;
          border-color: #CBD5E1 !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.06) !important;
        }

        :root[data-theme="light"] .ad-title-gradient {
          color: #0F172A !important;
        }

        :root[data-theme="light"] .ad-sovereign-badge {
          background: rgba(37,99,235,0.1) !important;
          color: #1D4ED8 !important;
          border-color: rgba(37,99,235,0.3) !important;
        }

        :root[data-theme="light"] .ad-card {
          background: #FFFFFF !important;
          border-color: #CBD5E1 !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.06) !important;
        }

        :root[data-theme="light"] .ad-card-highlight {
          border-color: #93C5FD !important;
          background: #FFFFFF !important;
        }

        :root[data-theme="light"] .ad-card-title {
          color: #0F172A !important;
          font-weight: 800 !important;
        }

        :root[data-theme="light"] .ad-canvas-panel {
          background: #FFFFFF !important;
          border-color: #CBD5E1 !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.06) !important;
        }

        :root[data-theme="light"] .ad-precedent-card {
          background: #F8FAFC !important;
          border-color: #E2E8F0 !important;
        }

        :root[data-theme="light"] .ad-precedent-card:hover {
          background: #EFF6FF !important;
          border-color: #3B82F6 !important;
        }

        :root[data-theme="light"] .ad-precedent-title {
          color: #0F172A !important;
          font-weight: 700 !important;
        }

        :root[data-theme="light"] .ad-precedent-desc {
          color: #334155 !important;
        }

        :root[data-theme="light"] .ad-precedent-badge {
          background: rgba(37,99,235,0.1) !important;
          color: #1D4ED8 !important;
          border-color: rgba(37,99,235,0.3) !important;
        }

        :root[data-theme="light"] .ad-chip-btn {
          background: #F1F5F9 !important;
          border-color: #CBD5E1 !important;
          color: #0F172A !important;
          font-weight: 600 !important;
        }

        :root[data-theme="light"] .ad-chip-btn:hover {
          background: #DBEAFE !important;
          color: #1D4ED8 !important;
          border-color: #3B82F6 !important;
        }

        :root[data-theme="light"] .ad-progress-track {
          background: #E2E8F0 !important;
        }

        :root[data-theme="light"] .ad-step-card {
          background: #F8FAFC !important;
          border-color: #E2E8F0 !important;
        }

        :root[data-theme="light"] .ad-step-card.active {
          background: #EFF6FF !important;
          border-color: #2563EB !important;
        }

        :root[data-theme="light"] .ad-step-card.done {
          background: #F0FDF4 !important;
          border-color: #86EFAC !important;
        }

        :root[data-theme="light"] .toolbar-select {
          background-color: #FFFFFF !important;
          border: 1px solid #CBD5E1 !important;
          color: #0F172A !important;
          font-weight: 600 !important;
        }

        :root[data-theme="light"] .toolbar-select option {
          background-color: #FFFFFF !important;
          color: #0F172A !important;
        }

        :root[data-theme="light"] .toolbar-select:hover {
          background-color: #F8FAFC !important;
          border-color: #94A3B8 !important;
        }

        :root[data-theme="light"] .toolbar-select:focus {
          border-color: #2563EB !important;
          box-shadow: 0 0 0 2px rgba(37,99,235,0.2) !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body {
          background: #F8FAFC !important;
          border: 1px solid #CBD5E1 !important;
          border-radius: 12px !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror {
          background: #FFFFFF !important;
          color: #0F172A !important;
          border: none !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror p {
          color: #1E293B !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror h1,
        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror h2,
        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror h3,
        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror h4 {
          color: #0F172A !important;
          border-bottom: 1px solid #E2E8F0 !important;
        }

        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror strong,
        :root[data-theme="light"] .ad-document-canvas .scanner-body .ProseMirror b {
          color: #1D4ED8 !important;
          font-weight: 700 !important;
        }

        :root[data-theme="light"] textarea,
        :root[data-theme="light"] select {
          background: #FFFFFF !important;
          border-color: #CBD5E1 !important;
          color: #0F172A !important;
        }

        :root[data-theme="light"] .ad-metric-pill {
          background: #F1F5F9 !important;
          border-color: #CBD5E1 !important;
          color: #334155 !important;
        }

        :root[data-theme="light"] .ad-btn-secondary {
          background: #F8FAFC !important;
          border-color: #CBD5E1 !important;
          color: #0F172A !important;
        }

        /* OVERRIDE FOR MOBILE OPTIMIZATIONS */
        @media (max-width: 768px) {
          .ad-header-card {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 8px !important;
          }
          .ad-sovereign-badge, .ad-active-contract-status {
            position: static !important;
            margin: 8px 0 0 0 !important;
            width: 100% !important;
          }
          .ad-pipeline-grid {
            grid-template-columns: 1fr !important;
          }
          .ad-draft-scope-grid {
            display: flex !important;
            flex-direction: column !important;
            width: 100% !important;
            gap: 8px !important;
          }
          .ad-synthesize-btn {
            width: 100% !important;
            min-height: 48px !important;
            font-size: 14px !important;
          }
          .autodraft-page-wrapper {
            padding-bottom: 96px !important;
            overflow-x: hidden !important;
            width: 100% !important;
            box-sizing: border-box !important;
          }
        }
      `}</style>

      {/* ── TOP HEADER & NAVIGATION ── */}
      <div className="ad-header-card">
        <div>
          <div className="ad-header-title-row">
            <span style={{ fontSize: '22px' }}>⚡</span>
            <h1 className="ad-title-gradient">Auto-Draft Studio</h1>
            <span className="ad-sovereign-badge">Sovereign Legal Engine · Indian Law</span>
          </div>
          <p className="ad-header-desc" style={{ fontSize: '12.5px', margin: '4px 0 0', color: 'var(--text-muted)' }}>
            Synthesize execution-ready Indian legal agreements, clauses, and precedents with AI statutory reasoning
          </p>
        </div>

        {/* Active Contract & Toolbar Shortcuts */}
        <div className="ad-active-contract-status" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              padding: '8px 14px',
              background: rawText.trim() ? 'rgba(16,185,129,0.08)' : 'var(--bg-card)',
              border: rawText.trim() ? '1px solid rgba(16,185,129,0.3)' : '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: rawText.trim() ? '#10B981' : '#94A3B8' }} />
            <span>
              {rawText.trim() ? (
                <>Active Contract Loaded: <strong style={{ color: 'var(--text-primary)' }}>{rawText.length.toLocaleString()} chars</strong></>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>No Active Contract (Standalone Clause Synthesis)</span>
              )}
            </span>
          </div>

          <button onClick={openDraftsModal} className="ad-action-btn ad-btn-purple">
            📁 Saved Drafts
          </button>

          <Link to="/contract-analyzer" style={{ textDecoration: 'none' }}>
            <button className="ad-action-btn ad-btn-primary">
              🔍 Open Contract Analyzer →
            </button>
          </Link>
        </div>
      </div>

      {/* ── MAIN WORKSPACE GRID ── */}
      <div className="ad-workspace-grid">

        {/* LEFT COLUMN — Live Editor & Document Canvas */}
        <div className="ad-canvas-panel">
          {/* Invisible on screen, shown only under @media print (see
              styles below) — the PDF export path is window.print() with
              no backend rendering engine, so this is the only place the
              letterhead is actually drawn for a PDF. */}
          <div className="print-only-letterhead">
            {activeLetterhead && (
              <>
                <div className="print-lh-firm">{activeLetterhead.firmName}</div>
                {activeLetterhead.tagline && <div className="print-lh-tagline">{activeLetterhead.tagline}</div>}
                {(activeLetterhead.address || activeLetterhead.contact) && (
                  <div className="print-lh-contact">
                    {[activeLetterhead.address, activeLetterhead.contact].filter(Boolean).join('   ·   ')}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="ad-canvas-header">
            {/* Title row */}
            <div className="ad-canvas-header-top">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 750, color: 'var(--text-primary)', margin: 0, whiteSpace: 'nowrap' }}>
                  Synthesized Document
                </h3>
                {autoDraftText && (
                  <span className="ad-metric-pill" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ⚡ {wordCount} words · {charCount} chars
                  </span>
                )}
              </div>
            </div>

            {/* Action toolbar — wraps onto its own line(s) instead of
                squeezing into the title row and overlapping it, which is
                what a hard nowrap here used to do at anything less than a
                very wide viewport. */}
            {autoDraftText && (
              <div className="ad-toolbar-row">
                <button type="button" onClick={handleCopyDraft} className="ad-action-btn ad-btn-secondary" style={{ padding: '6px 12px' }}>
                  {copied ? '✓ Copied!' : '📋 Copy'}
                </button>
                <button type="button" onClick={handleSaveToDrafts} className="ad-action-btn ad-btn-purple" style={{ padding: '6px 12px' }}>
                  {savedSuccess ? '✓ Saved!' : '💾 Save Draft'}
                </button>
                {rawText.trim() && (
                  <button type="button" onClick={handleAppendToContract} className="ad-action-btn ad-btn-primary" style={{ padding: '6px 12px' }}>
                    {appended ? '✓ Appended!' : '➕ Append'}
                  </button>
                )}
                <button type="button" onClick={handleExtractVariables} className="ad-action-btn ad-btn-secondary" style={{ padding: '6px 12px' }}>
                  🔎 Extract Variables
                </button>
                <button
                  type="button"
                  onClick={handlePushToAnalyzer}
                  className="ad-action-btn ad-btn-secondary"
                  title="Load this document into Contract Analyzer and open it there"
                  style={{ padding: '6px 12px' }}
                >
                  🔍 Push to Analyzer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAutoDraftText('');
                    setAutoDraftHtml('');
                    setShowVariablesPanel(false);
                    try { sessionStorage.removeItem(SCRATCHPAD_STORAGE_KEY); } catch {}
                  }}
                  style={{
                    padding: '6px 12px', borderRadius: '8px', fontSize: '12px', background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Letterhead & export — a founder-requested feature that used to
              live behind a generically-labeled "Export" button opening a
              modal, which meant it wasn't actually discoverable as "the
              letterhead option." Now a permanently visible strip: pick the
              letterhead, hit download, no modal in between. */}
          {autoDraftText && (
            <div className="ad-letterhead-bar">
              <span className="ad-letterhead-label">🖨️ Draft on Letterhead</span>
              <select
                className="ad-letterhead-select"
                value={selectedLetterheadId}
                onChange={handleLetterheadSelectChange}
                disabled={exportingDocx || isExtracting}
                title="Choose which firm letterhead to apply to the exported document"
              >
                <option value="none">No Letterhead (Plain)</option>
                <option value={AUTO_DETECT_SENTINEL}>✨ Auto-Detect from Draft</option>
                {savedLetterheads.length > 0 && (
                  <optgroup label="Saved Letterheads">
                    {savedLetterheads.map((lh) => (
                      <option key={lh.id} value={lh.id}>{lh.name || lh.firmName}</option>
                    ))}
                  </optgroup>
                )}
                <option value={CREATE_LETTERHEAD_SENTINEL}>+ Add / Manage Letterheads...</option>
              </select>

              <div className="ad-export-menu-wrap" ref={exportMenuRef}>
                <button
                  type="button"
                  className="ad-action-btn ad-btn-primary"
                  onClick={() => setShowExportMenu((v) => !v)}
                  disabled={exportingDocx || isExtracting}
                  style={{ padding: '7px 14px' }}
                >
                  {isExtracting ? 'Extracting Firm Data…' : exportingDocx ? 'Exporting…' : exportedSuccess ? '✓ Downloaded!' : '⬇ Export ▾'}
                </button>
                {showExportMenu && (
                  <div className="ad-export-menu">
                    <button type="button" className="ad-export-menu-item" onClick={() => { setShowExportMenu(false); handleExportDocx(); }}>
                      📄 Export as .docx
                    </button>
                    <button type="button" className="ad-export-menu-item" onClick={() => { setShowExportMenu(false); handleExportPdf(); }}>
                      🖨️ Export as .pdf
                    </button>
                    <button type="button" className="ad-export-menu-item" onClick={() => { setShowExportMenu(false); handleExportTxt(); }}>
                      📝 Export as .txt
                    </button>
                  </div>
                )}
              </div>

              {exportError && <span className="ad-letterhead-error">{exportError}</span>}
            </div>
          )}

          {showVariablesPanel && (
            <div className="ad-variables-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {extractedVariables.length > 0
                    ? `${extractedVariables.length} placeholder${extractedVariables.length === 1 ? '' : 's'} found`
                    : 'No bracketed placeholders found'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowVariablesPanel(false)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px' }}
                >
                  ✕
                </button>
              </div>
              {extractedVariables.length > 0 && (
                <div>
                  {extractedVariables.map((v) => (
                    <span key={v} className="ad-variable-chip">[{v}]</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Editor Canvas / In-Flight Reasoning State / Standby Hero */}
          <div className="ad-document-canvas" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className={`ad-upload-overlay${uploadingDraft ? ' visible' : ''}`}>
              <div className="ad-upload-spinner" />
            </div>
            {drafting ? (
              <div className="ad-synthesis-suite">
                {/* Glowing Orbit Radar Rings */}
                <div className="ad-orbit-wrapper">
                  <div className="ad-orbit-pulse" />
                  <div className="ad-orbit-ring-outer" />
                  <div className="ad-orbit-ring-inner" />
                  <div className="ad-orbit-core">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </div>
                </div>

                {/* Status Heading & Active Stage Description */}
                <div className="ad-synthesis-heading">
                  Synthesizing Execution-Ready Legal Agreement
                </div>
                <div className="ad-synthesis-subtext">
                  {DRAFT_STAGES[draftStep]?.desc || 'Cross-referencing Indian Contract Act, statutory enforceability parameters, and precedents…'}
                </div>

                {/* Smooth Progress Laser Bar */}
                <div className="ad-progress-container">
                  <div className="ad-progress-track">
                    <div className="ad-progress-fill" style={{ width: `${draftProgress}%` }} />
                  </div>
                  <div className="ad-progress-meta">
                    <span className="ad-stage-name">{DRAFT_STAGES[draftStep]?.title}</span>
                    <span className="ad-stage-pct">{Math.round(draftProgress)}% Completed</span>
                  </div>
                </div>

                {/* 4-Step Interactive Pipeline Tracker */}
                <div className="ad-pipeline-grid">
                  {DRAFT_STAGES.map((stg, sIdx) => {
                    const isDone = sIdx < draftStep;
                    const isCurrent = sIdx === draftStep;
                    return (
                      <div key={stg.title} className={`ad-step-card ${isDone ? 'done' : isCurrent ? 'active' : ''}`}>
                        <div className="ad-step-badge">
                          {isDone ? '✓' : `0${sIdx + 1}`}
                        </div>
                        <div className="ad-step-info">
                          <div className="ad-step-title">{stg.title}</div>
                          <div className="ad-step-desc">{stg.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : draftError ? (
              <div style={{ padding: '24px', borderRadius: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)', color: '#EF4444', marginBottom: '16px' }}>
                <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚠️</span> Synthesis Error
                </div>
                <div style={{ fontSize: '13px', lineHeight: 1.6, color: '#FCA5A5' }}>{draftError}</div>
                <button onClick={() => setDraftError('')} style={{ marginTop: '14px', padding: '6px 14px', borderRadius: '6px', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#EF4444', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Dismiss</button>
              </div>
            ) : autoDraftText ? (
              <ContractTiptapEditor
                documentKey={autoDraftVersion}
                initialRawText={autoDraftText}
                initialHtml={autoDraftHtml}
                onTextChange={setAutoDraftText}
                onHtmlChange={setAutoDraftHtml}
                clauses={[]}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ width: '64px', height: '64px', borderRadius: '16px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </div>
                <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>Enterprise Auto-Draft Canvas Ready</div>
                <div style={{ fontSize: '13px', maxWidth: '420px', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                  Enter drafting instructions in the top right console or select an Indian Playbook Precedent to synthesize structured, execution-ready contract clauses.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — Synthesis Control Console (Instructions at the TOP!) */}
        <div className="ad-controls-panel">

          {/* CARD 1 (TOP): AI Synthesis Instructions & Engine */}
          <div className="ad-card ad-card-highlight">
            <div className="ad-card-title">
              <span>✍️</span> Custom Drafting Instructions
            </div>

            <form onSubmit={handleSynthesize} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <textarea
                  ref={promptTextareaRef}
                  required
                  rows={4}
                  placeholder="e.g. Synthesize a complete Non-Disclosure & Non-Circumvention Agreement under the Indian Contract Act, 1872 with 3-year survival, confidential definitions, mutual indemnity, and New Delhi arbitration..."
                  value={autoDraftPrompt}
                  onChange={(e) => setAutoDraftPrompt(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: '10px',
                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)', fontSize: '13.5px', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
                  }}
                />
              </div>

              {/* Quick Modifier Chips */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Quick Provision Insert Modifiers:
                </div>
                <div className="ad-modifiers-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Include 30-day written cure period before escalation.')}>
                    + 30-Day Cure
                  </button>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Cap aggregate liability at 100% of fees paid.')}>
                    + 100% Fee Cap
                  </button>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Seat of arbitration shall be New Delhi under Arbitration Act 1996.')}>
                    + New Delhi Seat
                  </button>
                  <button type="button" className="ad-chip-btn" onClick={() => handleAddModifier('Include Section 27 Indian Contract Act exception for trade secrets.')}>
                    + Sec 27 Carve-out
                  </button>
                </div>
              </div>

              {/* Synthesis Depth & Context Controls */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '10px', marginTop: '2px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Reference Context
                  </label>
                  <select
                    value={selectedContextMode}
                    onChange={(e) => setSelectedContextMode(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: '7px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: '12px' }}
                  >
                    <option value="active_contract">Active Contract ({rawText.length} chars)</option>
                    <option value="none">No Context (Standalone)</option>
                    {vaultDocs.length > 0 && (
                      <optgroup label="Vault Documents">
                        {vaultDocs.map((doc) => (
                          <option key={doc.id} value={doc.id}>{doc.filename}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Scope Depth
                  </label>
                  <select
                    value={draftDepth}
                    onChange={(e) => setDraftDepth(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: '7px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: '12px' }}
                  >
                    <option value="comprehensive">Comprehensive</option>
                    <option value="standard">Standard Clause</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button
                  type="submit"
                  disabled={drafting}
                  className="ad-action-btn ad-btn-primary ad-synthesize-btn"
                  style={{ flex: 1, padding: '13px', fontSize: '14px', fontWeight: 700, borderRadius: '10px', justifyContent: 'center' }}
                >
                  {drafting ? 'Synthesizing Legal Clause…' : '⚡ Synthesize Enterprise Clause'}
                </button>
                <button
                  type="button"
                  disabled={uploadingDraft}
                  onClick={() => draftUploadInputRef.current?.click()}
                  className="ad-action-btn ad-btn-secondary"
                  title="Upload an existing draft (PDF, DOCX, or TXT) directly into the editor"
                  style={{ padding: '13px 16px', fontSize: '13px', fontWeight: 600, borderRadius: '10px', justifyContent: 'center', flexShrink: 0 }}
                >
                  {uploadingDraft ? '…' : '📤 Upload Draft'}
                </button>
                <input
                  type="file"
                  ref={draftUploadInputRef}
                  style={{ display: 'none' }}
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => handleUploadDraft(e.target.files)}
                />
              </div>
              {draftUploadError && (
                <div style={{ fontSize: '11.5px', color: '#EF4444', marginTop: '-4px' }}>
                  {draftUploadError}
                </div>
              )}
            </form>
          </div>

          {/* CARD 2 (BOTTOM): Indian Playbook Precedent Inserts */}
          <div className="ad-card">
            <div className="ad-card-title">
              <span>📜</span> Indian Playbook Precedent Inserts
            </div>
            <div className="ad-precedent-grid">
              {PRECEDENTS.map(({ label, badge, prompt }) => (
                <div
                  key={label}
                  className="ad-precedent-card"
                  onClick={() => {
                    setAutoDraftPrompt(prompt);
                    if (promptTextareaRef.current) {
                      promptTextareaRef.current.focus();
                      promptTextareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                >
                  <div className="ad-precedent-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                    <span className="ad-precedent-title">{label}</span>
                    <span className="ad-precedent-badge">
                      {badge}
                    </span>
                  </div>
                  <span className="ad-precedent-desc" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {prompt}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

      <DraftsModal />

      {/* Portaled straight to document.body — AppRouter.jsx's page-transition
          wrapper (.page-enter) applies a CSS transform to every route's
          root, and a transformed ancestor becomes the containing block for
          any position:fixed descendant, so without the portal this overlay
          would resolve "fixed" relative to that in-flow page wrapper
          instead of the viewport. Same bug/fix already applied to
          FirmLibrary's document viewer and (previously) this component's
          own export modal. */}
      {showLetterheadModal && createPortal(
        <div className="ad-modal-overlay" onClick={closeLetterheadModal}>
          <div className="ad-modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="ad-modal-header">
              <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Add / Manage Letterheads</span>
              <button
                onClick={closeLetterheadModal}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <div className="ad-modal-body">
              {letterheadModalNotice && (
                <div className="ad-letterhead-notice">{letterheadModalNotice}</div>
              )}
              <div>
                <label className="ad-modal-label">Firm Name *</label>
                <input
                  className="ad-modal-input"
                  value={newLetterheadFirmName}
                  onChange={(e) => setNewLetterheadFirmName(e.target.value)}
                  placeholder="e.g. Sharma & Associates"
                  autoFocus
                />
              </div>
              <div>
                <label className="ad-modal-label">Tagline</label>
                <input
                  className="ad-modal-input"
                  value={newLetterheadTagline}
                  onChange={(e) => setNewLetterheadTagline(e.target.value)}
                  placeholder="e.g. Advocates & Solicitors, Mumbai"
                />
              </div>
              <div>
                <label className="ad-modal-label">Address</label>
                <input
                  className="ad-modal-input"
                  value={newLetterheadAddress}
                  onChange={(e) => setNewLetterheadAddress(e.target.value)}
                  placeholder="e.g. 4th Floor, Nariman Point, Mumbai 400021"
                />
              </div>
              <div>
                <label className="ad-modal-label">Contact (Email / Phone)</label>
                <input
                  className="ad-modal-input"
                  value={newLetterheadContact}
                  onChange={(e) => setNewLetterheadContact(e.target.value)}
                  placeholder="e.g. contact@firm.com · +91 98765 43210"
                />
              </div>
              {letterheadFormError && (
                <div style={{ fontSize: '12px', color: '#EF4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)', borderRadius: '8px', padding: '10px 12px' }}>
                  {letterheadFormError}
                </div>
              )}

              {/* Native <select> can't render a clickable delete button per
                  option, so multi-letterhead management lives here instead. */}
              {savedLetterheads.length > 0 && (
                <div className="ad-letterhead-manage">
                  <div className="ad-letterhead-manage-title">Manage Saved Letterheads</div>
                  <div className="ad-letterhead-manage-list">
                    {savedLetterheads.map((lh) => (
                      <div key={lh.id} className="ad-letterhead-manage-row">
                        <span className="ad-letterhead-manage-name">{lh.name || lh.firmName}</span>
                        <button
                          type="button"
                          className="ad-letterhead-delete-btn"
                          onClick={() => handleDeleteLetterhead(lh.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="ad-modal-footer">
              <button type="button" className="ad-action-btn ad-btn-secondary" onClick={closeLetterheadModal}>
                Cancel
              </button>
              <button type="button" className="ad-action-btn ad-btn-primary" onClick={handleSaveLetterhead}>
                Save Letterhead
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Also portaled — a plain fixed-position div here would resolve
          relative to .page-enter's transformed box like everything else
          in this file, not the true viewport corner. */}
      {toast && createPortal(
        <div className="ad-toast">{toast}</div>,
        document.body
      )}
    </div>
  );
}
