import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// ── Seed data — realistic Indian law firm KM entries ──────────────────────────
const SEED_ENTRIES = [
  {
    id: 1,
    title: 'Standard NDA (Mutual) — Commercial Disputes',
    category: 'Template',
    author: 'Firm Library',
    updated: '2026-06-20',
    tags: ['Contract Act', 'Confidentiality', 'Commercial'],
    description: 'Mutual Non-Disclosure Agreement compliant with Section 27 of the Indian Contract Act, 1872. Approved for use in High Court commercial disputes. Includes arbitration clause per DIAC Rules 2023.',
  },
  {
    id: 2,
    title: 'S. 138 NI Act — Cheque Dishonour Complaint',
    category: 'Precedent',
    author: 'Kumar & Associates',
    updated: '2026-06-15',
    tags: ['NI Act', 'Criminal', 'Delhi HC'],
    description: 'Complaint under Section 138 of the Negotiable Instruments Act, 1881. Delhi High Court approved format with standard prayers, demand notice, and legal notice compliance checklist.',
  },
  {
    id: 3,
    title: 'Anticipatory Bail Application — BNS 2023',
    category: 'Precedent',
    author: 'Sharma & Co.',
    updated: '2026-06-10',
    tags: ['BNS', 'BNSS', 'Criminal', 'Sessions Court'],
    description: 'Anticipatory bail application template updated for Bharatiya Nyaya Sanhita 2023 and BNSS. Cross-references equivalent CrPC sections for transitional matters. Validated by Sessions Court, Dwarka.',
  },
  {
    id: 4,
    title: 'Employment Agreement — IT Sector (NASSCOM Format)',
    category: 'Template',
    author: 'Firm Library',
    updated: '2026-05-28',
    tags: ['Employment', 'IT', 'ESOP', 'Non-Compete'],
    description: 'Standard employment agreement for the Indian IT sector. Includes ESOP vesting schedule, IP assignment clauses under the Patents Act and Copyright Act, and non-compete provisions tested under Section 27 CA.',
  },
  {
    id: 5,
    title: 'Writ Petition (PIL) — Environmental Violation',
    category: 'Precedent',
    author: 'Green Legal Cell',
    updated: '2026-05-15',
    tags: ['PIL', 'Environment', 'NGT', 'HC'],
    description: 'Public Interest Litigation template for filing before the National Green Tribunal and High Courts. Compliant with Section 16 NGT Act 2010. Includes prayer for interim injunction under Order 39 CPC.',
  },
  {
    id: 6,
    title: 'Due Diligence Checklist — M&A Transactions (India)',
    category: 'Practice Guide',
    author: 'M&A Desk',
    updated: '2026-04-30',
    tags: ['M&A', 'SEBI', 'Companies Act', 'Competition Act'],
    description: '52-point legal due diligence checklist for mergers and acquisitions under the Companies Act 2013, SEBI SAST Regulations 2011, and Competition Act 2002. Covers FEMA implications for cross-border deals.',
  },
  {
    id: 7,
    title: 'Arbitration Clause — DIAC Rules 2023 (B2B)',
    category: 'Standard Form',
    author: 'Firm Library',
    updated: '2026-04-12',
    tags: ['Arbitration', 'DIAC', 'ADR', 'Commercial'],
    description: 'Dispute resolution clause for commercial agreements adopting Delhi International Arbitration Centre Rules 2023. Seat: New Delhi. Provides for emergency arbitrator provisions and expedited procedure for claims under ₹1 Cr.',
  },
  {
    id: 8,
    title: 'Research Memo: BNS 2023 vs IPC 1860 — Key Divergences',
    category: 'Research Memo',
    author: 'Legal Research Team',
    updated: '2026-03-22',
    tags: ['BNS', 'IPC', 'Criminal Law', 'Transitional'],
    description: 'Comparative analysis of 58 key sections changed between IPC 1860 and Bharatiya Nyaya Sanhita 2023. Covers sentencing changes, new offences (organised crime, terrorism financing), and removal of obsolete provisions.',
  },
  {
    id: 9,
    title: 'Consumer Forum Complaint — SCDRC Format',
    category: 'Standard Form',
    author: 'Consumer Cell',
    updated: '2026-03-05',
    tags: ['Consumer Protection', 'SCDRC', 'Deficiency'],
    description: 'State Consumer Disputes Redressal Commission complaint format under Consumer Protection Act 2019. Includes limitation period checklist (2-year rule), deficiency in service heads, and reliefs available under Section 39.',
  },
  {
    id: 10,
    title: 'Section 9 Arbitration — Interim Relief Application',
    category: 'Precedent',
    author: 'Arbitration Desk',
    updated: '2026-02-18',
    tags: ['Arbitration Act', 'Interim Relief', 'HC'],
    description: 'Application for interim measures under Section 9 of the Arbitration and Conciliation Act 1996 (as amended 2021). Drafted for High Court filing with prayer for appointment of receiver and status quo injunction.',
  },
];

const CATEGORIES = ['All', 'Template', 'Precedent', 'Research Memo', 'Standard Form', 'Practice Guide'];

const CAT_COLORS = {
  Template:        { bg: 'rgba(59,130,246,0.12)',  color: '#60A5FA', border: 'rgba(59,130,246,0.25)' },
  Precedent:       { bg: 'rgba(245,158,11,0.12)', color: '#FBBF24', border: 'rgba(245,158,11,0.25)' },
  'Research Memo': { bg: 'rgba(139,92,246,0.12)', color: '#A78BFA', border: 'rgba(139,92,246,0.25)' },
  'Standard Form': { bg: 'rgba(16,185,129,0.12)', color: '#34D399', border: 'rgba(16,185,129,0.25)' },
  'Practice Guide':{ bg: 'rgba(20,184,166,0.12)', color: '#2DD4BF', border: 'rgba(20,184,166,0.25)' },
};

const getCatStyle = (cat) => CAT_COLORS[cat] || { bg: 'rgba(107,114,128,0.12)', color: '#9CA3AF', border: 'rgba(107,114,128,0.2)' };

// ── Sort icon ─────────────────────────────────────────────────────────────────
const SortIcon = ({ active, dir }) => (
  <svg width="11" height="11" viewBox="0 0 10 14" fill="none" style={{ marginLeft: 4, opacity: active ? 1 : 0.3, flexShrink: 0 }}>
    <path d="M5 1 L5 13 M1 4 L5 1 L9 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ opacity: active && dir === 'asc' ? 1 : 0.35 }} />
    <path d="M1 10 L5 13 L9 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ opacity: active && dir === 'desc' ? 1 : 0.35 }} />
  </svg>
);

// ── Styles ────────────────────────────────────────────────────────────────────
const flStyles = `
  .fl-page { padding: 28px 32px; font-family: var(--font-sans); color: var(--text-primary); }
  .fl-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
  .fl-toolbar {
    display: flex; gap: 10px; align-items: center;
    margin-bottom: 16px; flex-wrap: wrap;
  }
  .fl-search-wrap {
    flex: 1; min-width: 220px;
    position: relative; display: flex; align-items: center;
  }
  .fl-search-icon {
    position: absolute; left: 12px;
    color: var(--text-muted); pointer-events: none;
    display: flex; align-items: center;
  }
  .fl-search-input {
    width: 100%; padding: 9px 12px 9px 36px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 8px; outline: none;
    color: var(--text-primary); font-family: var(--font-sans);
    font-size: 13.5px; transition: border-color 0.18s, box-shadow 0.18s;
  }
  .fl-search-input::placeholder { color: var(--text-muted); }
  .fl-search-input:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
  }
  .fl-cat-filter {
    display: flex; gap: 4px; flex-wrap: wrap;
  }
  .fl-cat-btn {
    padding: 7px 13px; border-radius: 7px; font-size: 12px; font-weight: 500;
    border: 1px solid var(--border-subtle);
    background: var(--bg-panel); color: var(--text-muted);
    cursor: pointer; transition: all 0.15s; white-space: nowrap;
    font-family: var(--font-sans);
  }
  .fl-cat-btn:hover { border-color: var(--accent-primary); color: var(--accent-primary); }
  .fl-cat-btn.active {
    background: var(--accent-primary); color: #fff;
    border-color: var(--accent-primary);
    font-weight: 600;
  }
  /* Table */
  .fl-table-wrap {
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 12px; overflow: hidden;
  }
  .fl-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .fl-table th {
    padding: 12px 18px;
    background: var(--bg-card);
    color: var(--text-muted); font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer; user-select: none;
    white-space: nowrap;
  }
  .fl-table th:hover { color: var(--text-primary); }
  .fl-table th.sorted { color: var(--accent-primary); }
  .fl-table th-inner { display: flex; align-items: center; gap: 2px; }
  .fl-table td {
    padding: 13px 18px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary); vertical-align: middle;
  }
  .fl-table tbody tr { transition: background 0.12s; position: relative; }
  .fl-table tbody tr:hover { background: rgba(59,130,246,0.04); }
  .fl-table tbody tr:last-child td { border-bottom: none; }
  /* Category chip */
  .fl-cat-chip {
    display: inline-flex; align-items: center;
    padding: 2px 9px; border-radius: 20px;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.03em; white-space: nowrap;
    border: 1px solid;
  }
  /* Three-dot action menu */
  .fl-row-actions { position: relative; }
  .fl-dots-btn {
    width: 28px; height: 28px; border-radius: 6px;
    background: transparent; border: none; cursor: pointer;
    color: var(--text-muted); display: flex; align-items: center; justify-content: center;
    transition: background 0.15s, color 0.15s; opacity: 0;
  }
  tr:hover .fl-dots-btn, .fl-dots-btn.open { opacity: 1; }
  .fl-dots-btn:hover, .fl-dots-btn.open { background: rgba(59,130,246,0.1); color: var(--accent-primary); }
  .fl-action-menu {
    position: fixed; z-index: 1000;
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: 8px; padding: 4px;
    min-width: 168px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.22);
    animation: fl-menu-in 0.14s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes fl-menu-in {
    from { opacity: 0; transform: scale(0.94) translateY(-4px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  .fl-menu-item {
    display: flex; align-items: center; gap: 9px;
    padding: 8px 12px; border-radius: 5px; font-size: 13px;
    color: var(--text-primary); cursor: pointer; transition: background 0.12s;
  }
  .fl-menu-item:hover { background: rgba(59,130,246,0.07); }
  .fl-menu-item.danger { color: var(--accent-danger); }
  .fl-menu-item.danger:hover { background: rgba(239,68,68,0.07); }
  .fl-menu-divider { height: 1px; background: var(--border-subtle); margin: 3px 0; }
  /* Quick Preview panel — Architect's Innovation */
  .fl-preview-panel {
    position: fixed; z-index: 1100;
    width: 308px;
    background: var(--bg-card);
    border: 1px solid var(--border-subtle);
    border-radius: 12px; padding: 18px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.28), 0 0 0 1px rgba(59,130,246,0.1);
    pointer-events: auto;
    transition: opacity 0.2s cubic-bezier(0.16,1,0.3,1), transform 0.2s cubic-bezier(0.16,1,0.3,1);
    opacity: 0; transform: scale(0.94) translateY(8px);
    transform-origin: top center;
    will-change: opacity, transform;
  }
  .fl-preview-panel.visible {
    opacity: 1; transform: scale(1) translateY(0);
  }
  .fl-preview-title {
    font-size: 14px; font-weight: 700; font-family: var(--font-serif);
    color: var(--text-primary); line-height: 1.35; margin-bottom: 10px;
  }
  .fl-preview-desc {
    font-size: 12.5px; color: var(--text-muted); line-height: 1.6;
    margin-bottom: 12px;
  }
  .fl-preview-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 14px; }
  .fl-preview-tag {
    font-size: 10px; font-weight: 600; padding: 2px 7px;
    border-radius: 4px; background: rgba(59,130,246,0.08);
    color: var(--accent-primary); border: 1px solid rgba(59,130,246,0.18);
  }
  .fl-preview-actions { display: flex; gap: 7px; }
  .fl-preview-btn {
    flex: 1; padding: 7px 10px; border-radius: 6px;
    font-size: 11.5px; font-weight: 600; cursor: pointer;
    font-family: var(--font-sans); transition: all 0.15s; text-align: center;
  }
  .fl-preview-btn.primary {
    background: var(--accent-primary); color: #fff; border: none;
  }
  .fl-preview-btn.primary:hover { background: var(--accent-hover); }
  .fl-preview-btn.secondary {
    background: transparent; color: var(--accent-primary);
    border: 1px solid rgba(59,130,246,0.3);
  }
  .fl-preview-btn.secondary:hover { background: rgba(59,130,246,0.08); }
  /* Skeleton */
  .fl-skeleton-row td { padding: 16px 18px; }
  .fl-skel-bar {
    height: 13px; border-radius: 5px;
    background: linear-gradient(90deg, var(--border-subtle) 25%, rgba(255,255,255,0.04) 50%, var(--border-subtle) 75%);
    background-size: 200% 100%; animation: fl-shimmer 1.4s infinite;
  }
  @keyframes fl-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  /* Empty state */
  .fl-empty {
    padding: 56px 24px; text-align: center;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
  }
  .fl-empty-icon { font-size: 32px; }
  /* Add entry modal */
  .fl-modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
    z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .fl-modal {
    background: var(--bg-panel); border: 1px solid var(--border-subtle);
    border-radius: 14px; width: 100%; max-width: 520px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.35);
    animation: fl-modal-in 0.22s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes fl-modal-in { from { opacity: 0; transform: scale(0.95) translateY(10px); } to { opacity: 1; transform: none; } }
  .fl-modal-header {
    padding: 18px 20px; border-bottom: 1px solid var(--border-subtle);
    display: flex; align-items: center; justify-content: space-between;
  }
  .fl-modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .fl-modal-footer { padding: 14px 20px; border-top: 1px solid var(--border-subtle); display: flex; gap: 10px; justify-content: flex-end; }
  .fl-input {
    width: 100%; padding: 9px 12px;
    background: var(--bg-card); border: 1px solid var(--border-subtle);
    border-radius: 7px; outline: none; color: var(--text-primary);
    font-family: var(--font-sans); font-size: 13.5px; transition: border-color 0.18s, box-shadow 0.18s;
  }
  .fl-input::placeholder { color: var(--text-muted); }
  .fl-input:focus { border-color: var(--accent-primary); box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
  .fl-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 5px; display: block; }
  /* Toast */
  .fl-toast {
    position: fixed; bottom: 24px; right: 24px; z-index: 1300;
    background: var(--bg-card); border: 1px solid var(--accent-success);
    color: var(--accent-success); padding: 10px 20px; border-radius: 8px;
    font-size: 13px; font-weight: 600;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    opacity: 0; transform: translateY(8px); transition: all 0.25s;
    pointer-events: none;
  }
  .fl-toast.show { opacity: 1; transform: translateY(0); }
  /* Light theme */
  :root[data-theme="light"] .fl-table-wrap { box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  :root[data-theme="light"] .fl-action-menu { box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
  :root[data-theme="light"] .fl-preview-panel { box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 0 0 1px rgba(59,130,246,0.1); }
`;

// ── LS helpers ────────────────────────────────────────────────────────────────
const LS_KEY = 'lexai_firm_library';
const loadEntries = () => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const seeded = SEED_ENTRIES.map(e => ({ ...e }));
  try { localStorage.setItem(LS_KEY, JSON.stringify(seeded)); } catch {}
  return seeded;
};
const saveEntries = (entries) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(entries)); } catch {}
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function FirmLibrary() {
  const navigate = useNavigate();

  const [entries, setEntries] = useState(loadEntries);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [sortCol, setSortCol] = useState('updated');
  const [sortDir, setSortDir] = useState('desc');
  const [menuRow, setMenuRow] = useState(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [preview, setPreview] = useState(null);
  const [previewPos, setPreviewPos] = useState({ x: 0, y: 0 });
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState('');
  const [newEntry, setNewEntry] = useState({ title: '', category: 'Template', author: '', description: '', tags: '' });

  const hoverTimerRef = useRef(null);
  const previewHoveredRef = useRef(false);
  // Tracks live cursor position; updated on every mousemove over the table
  const mousePosRef = useRef({ x: 0, y: 0 });

  // Simulated load
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 480);
    return () => clearTimeout(t);
  }, []);

  // Close action menu on outside click
  useEffect(() => {
    if (!menuRow) return;
    const handler = () => setMenuRow(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuRow]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ── Sort ──────────────────────────────────────────────────────────────────
  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  // ── Filter + Search + Sort pipeline ───────────────────────────────────────
  const filtered = entries
    .filter(e => catFilter === 'All' || e.category === catFilter)
    .filter(e => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        e.title.toLowerCase().includes(q) ||
        e.author.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.tags || []).some(t => t.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      let va = a[sortCol] || '';
      let vb = b[sortCol] || '';
      if (sortCol === 'updated') { va = new Date(va); vb = new Date(vb); }
      else { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  // ── Quick Preview (Architect's Innovation) ─────────────────────────────────
  //
  // WHY mouse-relative, not <tr> bounding rect:
  //   getBoundingClientRect() on a <tr> in a full-width table returns
  //   rect.left ≈ sidebarWidth (~224px) and rect.right ≈ window.innerWidth.
  //   "Right of row" = window.innerWidth + offset = off-screen.
  //   "Left of row"  = 224 - 308 - 10 = -94px  = behind sidebar.
  //   No amount of clamping fixes a panel anchored to a full-viewport-width row.
  //
  //   Mouse-relative anchoring uses e.clientX / e.clientY, the actual pixel
  //   where the user's cursor is. The cursor is ALWAYS inside the viewport,
  //   so "right-of-cursor" or "left-of-cursor" is always a valid, visible position.
  //   This is the pattern used by Notion, Linear, and Airtable for hover previews.
  //
  // Capture strategy: mousePosRef is updated on every mousemove over the table
  // wrapper (one lightweight global handler). At row-enter we also sync the ref
  // immediately from `e.clientX/Y` so there's always a valid initial position even
  // before the first mousemove fires.
  const handleMouseMove = useCallback((e) => {
    mousePosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleRowMouseEnter = useCallback((entry, e) => {
    clearTimeout(hoverTimerRef.current);
    // Seed the ref at row-enter as a reliable initial position
    mousePosRef.current = { x: e.clientX, y: e.clientY };
    hoverTimerRef.current = setTimeout(() => {
      if (previewHoveredRef.current) return;

      const PANEL_W  = 308;
      const PANEL_H  = 300;
      const OFFSET   = 18;  // gap between cursor and panel edge
      const VP_PAD   = 12;
      const SIDEBAR_SAFE = 256; // hard left wall — never clip the sidebar

      const { x: mx, y: my } = mousePosRef.current;

      // Try right of cursor; if panel would bleed past right viewport edge → go left
      let x = mx + OFFSET;
      if (x + PANEL_W > window.innerWidth - VP_PAD) {
        x = mx - PANEL_W - OFFSET;
      }
      // Hard clamp: [sidebar-safe, right-viewport-edge]
      x = Math.max(SIDEBAR_SAFE, Math.min(x, window.innerWidth - PANEL_W - VP_PAD));

      // Y: slightly above cursor, clamped to viewport height
      let y = my - 60;
      y = Math.max(VP_PAD, Math.min(y, window.innerHeight - PANEL_H - VP_PAD));

      setPreviewPos({ x, y });
      setPreview(entry);
    }, 620);
  }, []);

  const handleRowMouseLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (!previewHoveredRef.current) setPreview(null);
    }, 140);
  }, []);

  const handlePreviewMouseEnter = () => {
    previewHoveredRef.current = true;
    clearTimeout(hoverTimerRef.current);
  };

  const handlePreviewMouseLeave = () => {
    previewHoveredRef.current = false;
    setPreview(null);
  };

  // ── Action menu ──────────────────────────────────────────────────────────
  const openMenu = (id, e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ x: rect.left - 140, y: rect.bottom + 4 });
    setMenuRow(id);
  };

  const deleteEntry = (id) => {
    setEntries(prev => {
      const updated = prev.filter(e => e.id !== id);
      saveEntries(updated);
      return updated;
    });
    setMenuRow(null);
    showToast('Entry removed from library');
  };

  const copyTitle = (title) => {
    navigator.clipboard.writeText(title).catch(() => {});
    setMenuRow(null);
    showToast('Title copied to clipboard');
  };

  const sendToConflict = (title) => {
    setMenuRow(null);
    navigate(`/conflict-engine?entity=${encodeURIComponent(title)}`);
  };

  // ── Add new entry ─────────────────────────────────────────────────────────
  const handleAddEntry = (e) => {
    e.preventDefault();
    if (!newEntry.title.trim()) return;
    const entry = {
      id: Date.now(),
      title: newEntry.title.trim(),
      category: newEntry.category,
      author: newEntry.author.trim() || 'Firm Library',
      updated: new Date().toISOString().split('T')[0],
      tags: newEntry.tags.split(',').map(t => t.trim()).filter(Boolean),
      description: newEntry.description.trim(),
    };
    setEntries(prev => {
      const updated = [entry, ...prev];
      saveEntries(updated);
      return updated;
    });
    setShowModal(false);
    setNewEntry({ title: '', category: 'Template', author: '', description: '', tags: '' });
    showToast('Entry added to Firm Library');
  };

  const ThHeader = ({ col, label, style }) => (
    <th
      onClick={() => handleSort(col)}
      className={sortCol === col ? 'sorted' : ''}
      style={style}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {label}
        <SortIcon active={sortCol === col} dir={sortDir} />
      </div>
    </th>
  );

  return (
    <>
      <style>{flStyles}</style>

      <div className="fl-page">

        {/* Header */}
        <div className="fl-header">
          <div>
            <h1 style={{ fontSize: '24px', margin: '0 0 4px', fontFamily: 'var(--font-serif)' }}>
              Firm Library
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              Central knowledge management — precedents, templates, and practice guides.
            </p>
          </div>
          <button
            className="btn-accent"
            onClick={() => setShowModal(true)}
            style={{ padding: '10px 20px', fontSize: '13px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: 7 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Entry
          </button>
        </div>

        {/* Toolbar */}
        <div className="fl-toolbar">
          <div className="fl-search-wrap">
            <span className="fl-search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </span>
            <input
              type="text"
              className="fl-search-input"
              placeholder="Search titles, authors, tags, descriptions…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="fl-cat-filter">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                className={`fl-cat-btn${catFilter === cat ? ' active' : ''}`}
                onClick={() => setCatFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        {!loading && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
            {search || catFilter !== 'All' ? ` matching filters` : ` in library`}
          </div>
        )}

        {/* Data Grid */}
        <div className="fl-table-wrap" onMouseMove={handleMouseMove}>
          <table className="fl-table">
            <thead>
              <tr>
                <ThHeader col="title" label="Document Title" style={{ width: '38%' }} />
                <ThHeader col="category" label="Category" style={{ width: '14%' }} />
                <ThHeader col="updated" label="Last Updated" style={{ width: '13%' }} />
                <ThHeader col="author" label="Author / Source" style={{ width: '18%' }} />
                <th style={{ width: '48px' }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="fl-skeleton-row">
                    <td><div className="fl-skel-bar" style={{ width: `${55 + (i % 3) * 15}%` }} /></td>
                    <td><div className="fl-skel-bar" style={{ width: '70%' }} /></td>
                    <td><div className="fl-skel-bar" style={{ width: '80%' }} /></td>
                    <td><div className="fl-skel-bar" style={{ width: '60%' }} /></td>
                    <td />
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <div className="fl-empty">
                      <div className="fl-empty-icon">📂</div>
                      <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>No entries found</div>
                      <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                        {search ? `No results for "${search}"` : 'Add the first entry to get started'}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : filtered.map(entry => {
                const catStyle = getCatStyle(entry.category);
                return (
                  <tr
                    key={entry.id}
                    onMouseEnter={e => handleRowMouseEnter(entry, e)}
                    onMouseLeave={handleRowMouseLeave}
                  >
                    <td>
                      <div style={{ fontWeight: '600', color: 'var(--text-primary)', marginBottom: 3, lineHeight: 1.35 }}>
                        {entry.title}
                      </div>
                      {entry.tags?.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {entry.tags.slice(0, 3).map(t => (
                            <span key={t} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: 'rgba(59,130,246,0.07)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>{t}</span>
                          ))}
                          {entry.tags.length > 3 && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>+{entry.tags.length - 3}</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="fl-cat-chip" style={{ background: catStyle.bg, color: catStyle.color, borderColor: catStyle.border }}>
                        {entry.category}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px', whiteSpace: 'nowrap' }}>
                      {new Date(entry.updated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{entry.author}</td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="fl-row-actions">
                        <button
                          className={`fl-dots-btn${menuRow === entry.id ? ' open' : ''}`}
                          onClick={e => openMenu(entry.id, e)}
                          title="Actions"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Action menu dropdown */}
        {menuRow && (
          <div
            className="fl-action-menu"
            style={{ top: menuPos.y, left: Math.max(8, menuPos.x) }}
            onClick={e => e.stopPropagation()}
          >
            <div className="fl-menu-item" onClick={() => copyTitle(entries.find(e => e.id === menuRow)?.title || '')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy Title
            </div>
            <div className="fl-menu-item" onClick={() => sendToConflict(entries.find(e => e.id === menuRow)?.title || '')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              Send to Conflict Engine
            </div>
            <div className="fl-menu-divider" />
            <div className="fl-menu-item danger" onClick={() => deleteEntry(menuRow)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              Remove from Library
            </div>
          </div>
        )}

        {/* Quick Preview panel — 600ms hover reveal */}
        {preview && (
          <div
            className={`fl-preview-panel${preview ? ' visible' : ''}`}
            style={{ top: previewPos.y, left: previewPos.x }}
            onMouseEnter={handlePreviewMouseEnter}
            onMouseLeave={handlePreviewMouseLeave}
          >
            <span className="fl-cat-chip" style={{ ...getCatStyle(preview.category), marginBottom: 10, display: 'inline-flex' }}>
              {preview.category}
            </span>
            <div className="fl-preview-title">{preview.title}</div>
            {preview.description && (
              <div className="fl-preview-desc">
                {preview.description.length > 200 ? preview.description.slice(0, 200) + '…' : preview.description}
              </div>
            )}
            {preview.tags?.length > 0 && (
              <div className="fl-preview-tags">
                {preview.tags.map(t => <span key={t} className="fl-preview-tag">{t}</span>)}
              </div>
            )}
            <div className="fl-preview-actions">
              <button className="fl-preview-btn secondary" onClick={() => { copyTitle(preview.title); setPreview(null); }}>
                Copy Title
              </button>
              <button className="fl-preview-btn primary" onClick={() => { sendToConflict(preview.title); setPreview(null); }}>
                Conflict Check →
              </button>
            </div>
          </div>
        )}

        {/* Add Entry Modal */}
        {showModal && (
          <div className="fl-modal-overlay" onClick={() => setShowModal(false)}>
            <div className="fl-modal" onClick={e => e.stopPropagation()}>
              <div className="fl-modal-header">
                <span style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' }}>Add to Firm Library</span>
                <button onClick={() => setShowModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>&times;</button>
              </div>
              <form onSubmit={handleAddEntry}>
                <div className="fl-modal-body">
                  <div>
                    <label className="fl-label">Document Title *</label>
                    <input required className="fl-input" placeholder="e.g., Standard Lease Agreement — Residential" value={newEntry.title} onChange={e => setNewEntry(p => ({ ...p, title: e.target.value }))} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label className="fl-label">Category</label>
                      <select className="fl-input" value={newEntry.category} onChange={e => setNewEntry(p => ({ ...p, category: e.target.value }))}>
                        {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="fl-label">Author / Source</label>
                      <input className="fl-input" placeholder="Firm Library" value={newEntry.author} onChange={e => setNewEntry(p => ({ ...p, author: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="fl-label">Tags (comma-separated)</label>
                    <input className="fl-input" placeholder="Contract Act, Commercial, High Court" value={newEntry.tags} onChange={e => setNewEntry(p => ({ ...p, tags: e.target.value }))} />
                  </div>
                  <div>
                    <label className="fl-label">Description</label>
                    <textarea className="fl-input" rows="3" placeholder="Brief description of this document's use case and legal basis…" value={newEntry.description} onChange={e => setNewEntry(p => ({ ...p, description: e.target.value }))} style={{ resize: 'none' }} />
                  </div>
                </div>
                <div className="fl-modal-footer">
                  <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn-accent" style={{ padding: '9px 24px' }}>Add to Library</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Toast */}
        <div className={`fl-toast${toast ? ' show' : ''}`}>{toast}</div>
      </div>
    </>
  );
}
