import React, { useState, useRef } from 'react';
import { runConflictCheck, analyzeConflicts, saveClearanceMemo } from '../services/api';

// Severity weighting by matter type — drives the intake risk badge
const MATTER_RISK = {
  Criminal:    { level: 'High Risk',    cls: 'high' },
  Matrimonial: { level: 'High Risk',    cls: 'high' },
  Civil:       { level: 'Medium Risk',  cls: 'potential' },
  Commercial:  { level: 'Medium Risk',  cls: 'potential' },
  Corporate:   { level: 'Lower Risk',   cls: 'clear' },
  IP:          { level: 'Lower Risk',   cls: 'clear' },
  Arbitration: { level: 'Medium Risk',  cls: 'potential' },
  Writ:        { level: 'High Risk',    cls: 'high' },
};

// Derive a visual breadcrumb chain from a single result row
function buildBreadcrumb(result, entityName) {
  const { match_type, case_title, client, matched_doc } = result;
  switch (match_type) {
    case 'Primary Client Match':
      return [`Target: ${entityName}`, `Our Client: ${client}`, case_title, '🛑 Direct Conflict'];
    case 'Adverse Party Match':
      return [`Target: ${entityName}`, `Adverse to: ${client}`, case_title, '🛑 Direct Conflict'];
    case 'Case Title Match':
      return [`Target: ${entityName}`, 'In Case Title', case_title, '⚠️ Potential'];
    case 'Document Ingestion Mention':
      return [`Target: ${entityName}`, `Vault Doc: ${matched_doc || 'Unknown'}`, case_title, '⚠️ Potential'];
    case 'Ingested Clause Match':
      return [`Target: ${entityName}`, 'Clause Reference', matched_doc || case_title, 'ℹ️ Monitor'];
    default:
      return [`Target: ${entityName}`, match_type, case_title];
  }
}

// Wrap matching entity name in <mark> tags for clause highlighting
function highlightTerm(text, term) {
  if (!text || !term) return text || '';
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === term.toLowerCase()
      ? <mark key={i} className="clause-mark">{part}</mark>
      : part
  );
}

const styles = `
  .conflict-container {
    font-family: var(--font-sans);
    color: var(--text-dark-primary);
    min-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
  }

  .conflict-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 12px;
  }

  .mode-tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--border-dark-subtle);
    padding-bottom: 8px;
  }

  .mode-tab-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted);
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.2s ease-in-out;
  }

  .mode-tab-btn:hover {
    color: var(--text-primary);
    background-color: var(--hover-bg);
  }

  .mode-tab-btn.active {
    color: var(--accent-primary);
    background-color: var(--accent-muted);
    font-weight: 600;
  }

  /* ── Triage intake form ── */
  .triage-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  @media (max-width: 640px) {
    .triage-grid { grid-template-columns: 1fr; }
  }

  .triage-field-label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dark-muted);
    margin-bottom: 6px;
  }

  .matter-risk-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 20px;
    margin-left: 8px;
    vertical-align: middle;
  }

  /* ── Control Panel ── */
  .control-panel {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 24px;
    box-shadow: var(--shadow-card);
  }

  /* ── Status Badges ── */
  .badge-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 12px;
    border-radius: 20px;
    white-space: nowrap;
  }

  .badge-status.clear {
    background-color: var(--badge-clear-bg);
    color: var(--badge-clear-color);
    border: 1px solid var(--badge-clear-border);
  }

  .badge-status.potential {
    background-color: var(--badge-warn-bg);
    color: var(--badge-warn-color);
    border: 1px solid var(--badge-warn-border);
  }

  .badge-status.high {
    background-color: var(--badge-danger-bg);
    color: var(--badge-danger-color);
    border: 1px solid var(--badge-danger-border);
  }

  /* ── Grid and Data Table ── */
  .data-grid-container {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: var(--shadow-card);
  }

  .premium-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 14px;
  }

  .premium-table th {
    background-color: var(--bg-dark-sidebar);
    color: var(--text-badge);
    font-weight: 600;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border-dark-subtle);
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.05em;
  }

  .premium-table td {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-primary);
  }

  .premium-table tbody tr {
    transition: background-color 0.15s ease-in-out;
  }

  .premium-table tbody tr:hover {
    background-color: var(--hover-bg);
  }

  /* ── Relational Breadcrumbs ── */
  .breadcrumb-chain {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
    padding: 10px 14px;
    background-color: var(--stat-bg);
    border: 1px solid var(--stat-border);
    border-radius: 8px;
  }

  .crumb {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-dark-muted);
    padding: 3px 8px;
    border-radius: 4px;
    background-color: var(--hover-bg);
    white-space: nowrap;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .crumb-terminal {
    color: var(--badge-danger-color);
    background-color: var(--badge-danger-bg);
  }

  .crumb-terminal.warn {
    color: var(--badge-warn-color);
    background-color: var(--badge-warn-bg);
  }

  .crumb-terminal.info {
    color: var(--badge-clear-color);
    background-color: var(--badge-clear-bg);
  }

  .crumb-arrow {
    font-size: 12px;
    color: var(--text-dark-muted);
    opacity: 0.5;
    flex-shrink: 0;
  }

  /* ── Pulsing Skeleton Loader ── */
  .skeleton-pulse-wrapper {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 30px;
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
  }

  .skeleton-bar {
    background: linear-gradient(90deg, var(--skeleton-from) 25%, var(--skeleton-to) 50%, var(--skeleton-from) 75%);
    background-size: 200% 100%;
    animation: shimmer-animation 1.5s infinite;
    border-radius: 6px;
    height: 16px;
    width: 100%;
  }

  @keyframes shimmer-animation {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ── Error Banner ── */
  .error-banner {
    background-color: var(--badge-danger-bg);
    border: 1px solid var(--badge-danger-border);
    border-radius: 8px;
    padding: 16px 20px;
    color: var(--badge-danger-color);
    font-size: 14px;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* ── Field inputs (token-based, replaces .dark-input) ── */
  .field-input {
    background-color: var(--input-bg) !important;
    border: 1px solid var(--input-border) !important;
    color: var(--input-color) !important;
    border-radius: 0.5rem !important;
    padding: 0.75rem !important;
    outline: none;
    width: 100%;
    font-family: var(--font-sans);
    font-size: 14px;
    transition: all 0.2s ease-in-out;
  }

  .field-input:focus {
    border-color: var(--accent-primary) !important;
    box-shadow: 0 0 0 3px var(--input-focus-shadow, rgba(59,130,246,0.15)) !important;
  }

  .field-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .field-select {
    background-color: var(--input-bg) !important;
    border: 1px solid var(--input-border) !important;
    color: var(--input-color) !important;
    border-radius: 0.5rem !important;
    padding: 0.75rem !important;
    outline: none;
    width: 100%;
    font-family: var(--font-sans);
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239CA3AF' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 32px;
  }

  /* ── Intelligence Dropzone ── */
  .intel-dz {
    position: relative; overflow: hidden;
    border: 2px dashed rgba(59,130,246,0.25);
    border-radius: 16px;
    background: var(--bg-dark-app);
    min-height: 230px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px;
    cursor: pointer; text-align: center;
    padding: 44px 32px;
    margin-bottom: 20px;
    transition: border-color 0.22s, background 0.22s, box-shadow 0.22s;
  }
  .intel-dz:hover, .intel-dz.dragover {
    border-color: var(--accent-primary);
    background: var(--accent-muted);
    box-shadow: 0 0 0 4px rgba(59,130,246,0.06), 0 8px 32px rgba(59,130,246,0.1);
  }
  .intel-dz.has-files {
    min-height: 130px; border-style: solid;
    border-color: rgba(59,130,246,0.3);
  }
  .intel-dz-glow {
    position: absolute; inset: 0; pointer-events: none; border-radius: 16px;
    background: radial-gradient(ellipse at 50% 0%, rgba(59,130,246,0.1) 0%, transparent 68%);
    opacity: 0; transition: opacity 0.3s;
  }
  .intel-dz.dragover .intel-dz-glow { opacity: 1; }
  .intel-dz-icon {
    width: 62px; height: 62px; border-radius: 14px;
    background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.22);
    display: flex; align-items: center; justify-content: center;
    color: var(--accent-primary); flex-shrink: 0;
    transition: transform 0.22s cubic-bezier(0.16,1,0.3,1), background 0.22s;
  }
  .intel-dz:hover .intel-dz-icon, .intel-dz.dragover .intel-dz-icon {
    transform: scale(1.08) translateY(-3px);
    background: rgba(59,130,246,0.18);
  }
  /* File session chips */
  .file-session { display: flex; flex-direction: column; gap: 7px; margin-bottom: 20px; }
  .file-chip {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 14px;
    background: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle); border-radius: 8px;
    transition: border-color 0.15s;
    animation: chip-in 0.22s cubic-bezier(0.16,1,0.3,1);
  }
  @keyframes chip-in {
    from { opacity: 0; transform: translateY(5px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)  scale(1); }
  }
  .file-chip:hover { border-color: rgba(59,130,246,0.3); }
  .file-chip-idx {
    width: 22px; height: 22px; border-radius: 50%;
    background: rgba(59,130,246,0.12); color: var(--accent-primary);
    font-size: 10px; font-weight: 800;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .file-chip-meta { flex: 1; min-width: 0; }
  .file-chip-name { font-size: 13px; font-weight: 600; color: var(--text-dark-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-chip-size { font-size: 11px; color: var(--text-dark-muted); margin-top: 1px; }
  .file-chip-remove {
    background: transparent; border: none; color: var(--text-dark-muted);
    cursor: pointer; width: 26px; height: 26px; border-radius: 5px;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }
  .file-chip-remove:hover { color: var(--accent-danger); background: rgba(239,68,68,0.1); }
  /* Recent Reports */
  .recent-reports {
    background: var(--bg-dark-panel); border: 1px solid var(--border-dark-subtle);
    border-radius: 12px; overflow: hidden; margin-bottom: 24px;
  }
  .recent-reports-head {
    padding: 11px 18px; border-bottom: 1px solid var(--border-dark-subtle);
    display: flex; align-items: center; justify-content: space-between;
    background: rgba(59,130,246,0.03);
  }
  .report-item {
    display: flex; align-items: center; gap: 12px;
    padding: 11px 18px; border-bottom: 1px solid var(--border-dark-subtle);
    cursor: pointer; transition: background 0.15s;
  }
  .report-item:last-child { border-bottom: none; }
  .report-item:hover { background: var(--accent-muted); }
  .report-item.selected { background: rgba(59,130,246,0.07); }
  .report-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .report-detail-panel {
    background: var(--bg-dark-panel); border: 1px solid var(--border-dark-subtle);
    border-left: 3px solid var(--accent-primary);
    border-radius: 0 0 10px 10px; padding: 16px 18px;
  }

  /* ── Cross-Document results ── */
  .cross-results-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
    margin-top: 24px;
  }

  @media (min-width: 1024px) {
    .cross-results-grid { grid-template-columns: 0.35fr 0.65fr; }
  }

  .summary-card {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    padding: 24px;
    position: sticky;
    top: 24px;
    box-shadow: var(--shadow-card);
  }

  .conflict-detail-card {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    margin-bottom: 16px;
    overflow: hidden;
    transition: transform 0.2s ease-in-out;
    box-shadow: var(--shadow-card);
  }

  .conflict-detail-card:hover  { transform: translateY(-2px); }
  .conflict-detail-card.critical { border-left: 4px solid var(--accent-danger); }
  .conflict-detail-card.major    { border-left: 4px solid var(--accent-warning); }
  .conflict-detail-card.minor    { border-left: 4px solid var(--accent-primary); }

  .conflict-card-header {
    background-color: var(--bg-dark-sidebar);
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border-dark-subtle);
  }

  /* ── Clause-Level Side-by-Side Excerpts ── */
  .excerpts-container {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 20px;
  }

  @media (min-width: 768px) {
    .excerpts-container { grid-template-columns: 1fr 1fr; }
  }

  .excerpt-box {
    border-radius: 8px;
    padding: 14px;
    position: relative;
  }

  .excerpt-box.doc-a {
    background-color: var(--excerpt-a-bg);
    border: 1px solid var(--excerpt-a-border);
    border-left: 3px solid var(--accent-danger);
  }

  .excerpt-box.doc-b {
    background-color: var(--excerpt-b-bg);
    border: 1px solid var(--excerpt-b-border);
    border-left: 3px solid var(--accent-warning);
  }

  /* Clause highlighting mark */
  .clause-mark {
    background-color: rgba(252, 211, 77, 0.30);
    color: inherit;
    border-radius: 2px;
    padding: 0 2px;
    font-style: normal;
  }

  /* ── Clearance Memo Panel ── */
  .clearance-panel {
    background-color: var(--badge-clear-bg);
    border: 1px solid var(--badge-clear-border);
    border-left: 4px solid var(--badge-clear-color);
    border-radius: 12px;
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: var(--shadow-card);
  }

  .memo-preview-box {
    background-color: var(--bg-dark-app);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 8px;
    padding: 20px 24px;
    font-family: 'Courier New', monospace;
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--text-dark-primary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 360px;
    overflow-y: auto;
  }

  @media print {
    .no-print { display: none !important; }
    .memo-preview-box {
      max-height: none;
      border: none;
      font-size: 11pt;
      line-height: 1.6;
    }
  }

  /* ── Toast ── */
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background-color: var(--bg-dark-sidebar);
    border: 1px solid var(--accent-success);
    color: var(--accent-success);
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 13.5px;
    font-weight: 600;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
    z-index: 1000;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.warn {
    border-color: var(--accent-warning, #F59E0B);
    color: var(--accent-warning, #F59E0B);
  }

  /* ── Add to current session button ── */
  .btn-add-session {
    width: 100%; padding: 11px;
    background: rgba(59,130,246,0.07);
    border: 1px dashed rgba(59,130,246,0.3);
    border-radius: 8px; color: var(--accent-primary);
    font-size: 13px; font-weight: 600; cursor: pointer;
    transition: all 0.18s ease;
    display: flex; align-items: center; justify-content: center; gap: 7px;
    font-family: var(--font-sans); margin-bottom: 8px;
  }
  .btn-add-session:hover {
    background: rgba(59,130,246,0.14);
    border-color: rgba(59,130,246,0.55);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(59,130,246,0.12);
  }
`;

export default function ConflictEngine() {
  const [activeMode, setActiveMode] = useState('database');

  // ── Triage Intake ──
  const [triageForm, setTriageForm] = useState({ targetEntity: '', opposingParty: '', matterType: 'Civil' });
  const debounceRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [dbResults, setDbResults] = useState(null);

  // ── Clearance Memo ──
  const [memoStatus, setMemoStatus] = useState('idle');
  const [memoText, setMemoText] = useState('');

  // ── Cross-Doc ──
  const [sessionFiles, setSessionFiles] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [recentReports, setRecentReports] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lexai_conflict_reports') || '[]'); } catch { return []; }
  });
  const [selectedReport, setSelectedReport] = useState(null);
  const [crossResults, setCrossResults] = useState(null);
  const [addingToSet, setAddingToSet] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('✅ Copied to clipboard');
  const [toastWarn, setToastWarn] = useState(false);
  const filePickerRef = useRef(null);

  const matterRisk = MATTER_RISK[triageForm.matterType] || { level: 'Medium Risk', cls: 'potential' };

  // ── 1. DATABASE TRIAGE SEARCH ──────────────────────────────────────
  const handleDbSearchSubmit = (e) => {
    e.preventDefault();
    if (!triageForm.targetEntity.trim() || isLoading) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      setError('');
      setDbResults(null);
      setMemoStatus('idle');
      setMemoText('');

      const res = await runConflictCheck({
        targetEntity: triageForm.targetEntity.trim(),
        opposingParty: triageForm.opposingParty.trim(),
        matterType: triageForm.matterType,
      });

      setIsLoading(false);
      if (res.error) {
        setError(res.message || 'Analysis failed. Please check the backend connection.');
      } else {
        setDbResults(res);
      }
    }, 300);
  };

  // ── 2. CLEARANCE MEMO ──────────────────────────────────────────────
  const handleGenerateMemo = async () => {
    setMemoStatus('generating');
    const refId = `CLR-${Date.now()}-${triageForm.targetEntity.replace(/\s+/g, '').substring(0, 6).toUpperCase()}`;
    const now = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });

    const content =
`CONFLICT CLEARANCE MEMORANDUM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated:       ${now}
Reference No.:   ${refId}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TARGET ENTITY:     ${triageForm.targetEntity}
OPPOSING PARTY:    ${triageForm.opposingParty || 'Not Specified'}
MATTER TYPE:       ${triageForm.matterType}

CLEARANCE STATUS:  ✅ GRANTED — NO CONFLICT DETECTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SUMMARY:
A comprehensive conflict check was conducted for "${triageForm.targetEntity}" across
the case vault, active client roster, and all ingested document repositories.
No attorney-client conflict of interest was identified as of the date above.

LEGAL BASIS:
This clearance is issued pursuant to Rule 33 of the Bar Council of India
Rules, 1975 (Professional Conduct and Etiquette) and applicable professional
responsibility obligations governing concurrent and successive representation.

AUDIT TRAIL:
This memorandum is recorded in the firm's Conflict Intelligence audit log
for regulatory compliance and malpractice risk management.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENERATED BY: LexAmplify — Malpractice Shield Module
`;

    setMemoText(content);
    setMemoStatus('done');

    // Fire-and-forget audit record to backend
    saveClearanceMemo({
      ref_id: refId,
      target_entity: triageForm.targetEntity,
      opposing_party: triageForm.opposingParty,
      matter_type: triageForm.matterType,
      timestamp: new Date().toISOString(),
      memo_text: content,
    }).catch(() => {});
  };

  const showToastMsg = (msg, warn = false) => {
    setToastMsg(msg);
    setToastWarn(warn);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3400);
  };

  const copyMemo = () => {
    navigator.clipboard.writeText(memoText);
    showToastMsg('✅ Memo copied to clipboard');
  };

  const printMemo = () => window.print();

  // ── 3. CROSS-DOCUMENT FILE MANAGEMENT ─────────────────────────────

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []).filter(f => /\.(pdf|docx)$/i.test(f.name));
    if (!incoming.length) return;
    setSessionFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const fresh = incoming.filter(f => !existing.has(f.name));
      const dupes = incoming.filter(f => existing.has(f.name));
      if (dupes.length) {
        const label = dupes.slice(0, 2).map(f => f.name).join(', ') + (dupes.length > 2 ? '…' : '');
        setTimeout(() => showToastMsg(`⚠️ ${dupes.length} duplicate(s) skipped: ${label}`, true), 0);
      }
      return [...prev, ...fresh];
    });
  };

  const removeSessionFile = (idx) => {
    setSessionFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const persistReport = (result, files) => {
    const entry = {
      id: Date.now(),
      title: files.length >= 2
        ? `${files[0].name.replace(/\.[^.]+$/, '')} vs. ${files[1].name.replace(/\.[^.]+$/, '')}`
        : (files[0]?.name || 'Conflict Report'),
      timestamp: new Date().toISOString(),
      fileNames: files.map(f => f.name),
      conflictsCount: result.conflicts?.length ?? 0,
      summary: result.summary || '',
    };
    setRecentReports(prev => {
      const updated = [entry, ...prev].slice(0, 8);
      try { localStorage.setItem('lexai_conflict_reports', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const addToCurrentSet = () => {
    setAddingToSet(true);
    setCrossResults(null);
    setError('');
  };

  const handleCrossDocAnalyze = async () => {
    setAddingToSet(false);
    setSelectedReport(null);
    if (sessionFiles.length < 2) {
      alert('Load at least 2 documents to compare.');
      return;
    }
    setIsLoading(true);
    setError('');
    setCrossResults(null);

    const formData = new FormData();
    sessionFiles.forEach((f, idx) => {
      formData.append(`doc${idx + 1}`, f);
      formData.append(`label${idx + 1}`, f.name.replace(/\.[^.]+$/, ''));
    });

    const res = await analyzeConflicts(formData);
    setIsLoading(false);
    if (res.error) {
      setError(res.message || 'AI cross-document conflict scanning failed.');
    } else {
      setCrossResults(res);
      persistReport(res, sessionFiles);
    }
  };

  const copyResolutionToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showToastMsg('✅ Harmonized clause copied');
  };

  const resetCrossDoc = () => {
    setSessionFiles([]);
    setCrossResults(null);
    setAddingToSet(false);
    setSelectedReport(null);
    setError('');
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <>
      <style>{styles}</style>
      <div className="conflict-container p-4 md:p-8">

        {/* ── Header ── */}
        <div className="conflict-header">
          <div>
            <h1 style={{ fontSize: '24px', margin: '0 0 4px 0', fontFamily: 'var(--font-serif)' }}>
              Malpractice Shield
            </h1>
            <span style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)' }}>
              Conflict intelligence engine — database triage and cross-document clause analysis.
            </span>
          </div>
          <span style={{
            fontSize: '11px', fontWeight: '700', letterSpacing: '0.06em',
            textTransform: 'uppercase', padding: '4px 12px',
            background: 'linear-gradient(135deg, var(--gold, #c9a84c), var(--gold2, #e6c97a))',
            color: 'var(--navy, #0d1b2a)', borderRadius: '20px',
          }}>
            Flagship RAG node
          </span>
        </div>

        {/* ── Tab mode ── */}
        <div className="mode-tabs">
          <button className={`mode-tab-btn ${activeMode === 'database' ? 'active' : ''}`}
            onClick={() => { setActiveMode('database'); setError(''); }}>
            🔍 Triage Search
          </button>
          <button className={`mode-tab-btn ${activeMode === 'cross-doc' ? 'active' : ''}`}
            onClick={() => { setActiveMode('cross-doc'); setError(''); }}>
            📂 Cross-Document Uploader
          </button>
        </div>

        {/* ── Error Banner ── */}
        {error && (
          <div className="error-banner">
            <span>⚠️</span>
            <div>{error}</div>
          </div>
        )}

        {/* ══ MODE 1: DATABASE TRIAGE SEARCH ════════════════════════════════ */}
        {activeMode === 'database' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            <form onSubmit={handleDbSearchSubmit}>
              <div className="control-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-dark-primary)' }}>
                    Conflict Triage Intake
                  </span>
                  <span className={`badge-status ${matterRisk.cls} matter-risk-chip`}>
                    {matterRisk.level}
                  </span>
                </div>

                {/* Multi-field triage grid */}
                <div className="triage-grid">
                  <div>
                    <label className="triage-field-label">Target Entity *</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Corporation or individual name..."
                      value={triageForm.targetEntity}
                      onChange={(e) => setTriageForm(f => ({ ...f, targetEntity: e.target.value }))}
                      disabled={isLoading}
                      required
                    />
                  </div>
                  <div>
                    <label className="triage-field-label">Opposing Party</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="Known adversary or counter-party..."
                      value={triageForm.opposingParty}
                      onChange={(e) => setTriageForm(f => ({ ...f, opposingParty: e.target.value }))}
                      disabled={isLoading}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: '0 0 220px' }}>
                    <label className="triage-field-label">Matter Type</label>
                    <select
                      className="field-select"
                      value={triageForm.matterType}
                      onChange={(e) => setTriageForm(f => ({ ...f, matterType: e.target.value }))}
                      disabled={isLoading}
                    >
                      {Object.keys(MATTER_RISK).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="btn-accent"
                    style={{ padding: '12px 32px', flexShrink: 0, height: '48px' }}
                    disabled={isLoading || !triageForm.targetEntity.trim()}
                  >
                    {isLoading ? 'Scanning…' : 'Run Conflict Check'}
                  </button>
                </div>
              </div>
            </form>

            {/* Loading skeleton */}
            {isLoading && (
              <div className="skeleton-pulse-wrapper">
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div className="loading-spinner" style={{ width: '20px', height: '20px' }}></div>
                  <strong style={{ color: 'var(--accent-primary)', fontSize: '13px' }}>
                    Scanning case files, vault documents, and adverse party records…
                  </strong>
                </div>
                <div className="skeleton-bar" style={{ width: '80%' }}></div>
                <div className="skeleton-bar" style={{ width: '90%' }}></div>
                <div className="skeleton-bar" style={{ width: '60%' }}></div>
              </div>
            )}

            {/* Results */}
            {dbResults && !isLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* Result header */}
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  flexWrap: 'wrap', gap: '12px',
                  background: 'var(--bg-dark-panel)', padding: '16px 20px',
                  borderRadius: '8px', border: '1px solid var(--border-dark-subtle)',
                  boxShadow: 'var(--shadow-card)',
                }}>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', display: 'block' }}>
                      Search Target
                    </span>
                    <strong style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
                      {dbResults.entity_name}
                    </strong>
                    {triageForm.opposingParty && (
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-dark-muted)', marginTop: '2px' }}>
                        vs. {triageForm.opposingParty} · {triageForm.matterType}
                      </span>
                    )}
                  </div>
                  <span className={`badge-status ${
                    dbResults.status === 'High Conflict' ? 'high'
                    : dbResults.status === 'Potential' ? 'potential'
                    : 'clear'
                  }`}>
                    {dbResults.status === 'High Conflict' ? '🔴 High Conflict'
                      : dbResults.status === 'Potential' ? '🟡 Potential'
                      : '🟢 Clear'}
                  </span>
                </div>

                {/* ── Relational Breadcrumbs ── */}
                {dbResults.results && dbResults.results.length > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-dark-muted)', marginBottom: '8px', letterSpacing: '0.06em' }}>
                      Conflict Chain Visualization
                    </div>
                    {dbResults.results.slice(0, 3).map((r, idx) => {
                      const chain = buildBreadcrumb(r, dbResults.entity_name);
                      const last = chain[chain.length - 1];
                      const termCls = last.includes('🛑') ? '' : last.includes('⚠️') ? 'warn' : 'info';
                      return (
                        <div key={idx} className="breadcrumb-chain" style={{ marginBottom: '8px' }}>
                          {chain.map((step, i) => (
                            <React.Fragment key={i}>
                              <span className={`crumb${i === chain.length - 1 ? ` crumb-terminal${termCls ? ` ${termCls}` : ''}` : ''}`}>
                                {step}
                              </span>
                              {i < chain.length - 1 && <span className="crumb-arrow">→</span>}
                            </React.Fragment>
                          ))}
                        </div>
                      );
                    })}
                    {dbResults.results.length > 3 && (
                      <div style={{ fontSize: '12px', color: 'var(--text-dark-muted)', paddingLeft: '4px' }}>
                        + {dbResults.results.length - 3} more conflict nodes in table below
                      </div>
                    )}
                  </div>
                )}

                {/* Data table */}
                <div className="data-grid-container">
                  <div className="overflow-x-auto">
                    <table className="premium-table">
                      <thead>
                        <tr>
                          <th>Case / Document</th>
                          <th>Primary Client</th>
                          <th>Adversary</th>
                          <th>Match Type</th>
                          <th>Excerpt</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dbResults.results && dbResults.results.length > 0 ? (
                          dbResults.results.map((r, idx) => (
                            <tr key={idx}>
                              <td>
                                <strong style={{ color: 'var(--text-primary)' }}>{r.case_title}</strong>
                                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-dark-muted)' }}>
                                  ID: {r.case_id}
                                </span>
                              </td>
                              <td>{r.client}</td>
                              <td>{r.opponent}</td>
                              <td>
                                <span style={{ fontSize: '12.5px', color: 'var(--accent-primary)', fontWeight: '600' }}>
                                  {r.match_type}
                                </span>
                              </td>
                              <td style={{ maxWidth: '300px', fontSize: '13px', color: 'var(--text-dark-muted)', fontStyle: 'italic', wordBreak: 'break-word' }}>
                                {highlightTerm(r.excerpt, triageForm.targetEntity)}
                              </td>
                              <td>
                                <span className={`badge-status ${r.conflict_status === 'High Conflict' ? 'high' : 'potential'}`}>
                                  {r.conflict_status === 'High Conflict' ? '🔴 High' : '🟡 Potential'}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="6" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dark-muted)', fontStyle: 'italic' }}>
                              No conflict nodes identified. Conflict scan complete.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── Clearance Memo (zero-conflict only) ── */}
                {(!dbResults.results || dbResults.results.length === 0) && (
                  <div className="clearance-panel">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '28px' }}>✅</span>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--badge-clear-color)' }}>
                          Clearance Granted
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-dark-muted)', marginTop: '2px' }}>
                          No conflicts detected for <strong>{dbResults.entity_name}</strong>. Generate a formal clearance memorandum for the firm audit trail.
                        </div>
                      </div>
                    </div>

                    {memoStatus === 'idle' && (
                      <button
                        className="btn-accent no-print"
                        style={{ alignSelf: 'flex-start', padding: '10px 24px' }}
                        onClick={handleGenerateMemo}
                      >
                        Generate Clearance Memo
                      </button>
                    )}

                    {memoStatus === 'generating' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent-primary)' }}>
                        <div className="loading-spinner" style={{ width: '18px', height: '18px' }}></div>
                        <span style={{ fontSize: '13px' }}>Generating memo and logging audit record…</span>
                      </div>
                    )}

                    {memoStatus === 'done' && (
                      <>
                        <div className="memo-preview-box">{memoText}</div>
                        <div className="no-print" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          <button className="btn-accent" style={{ padding: '8px 20px', fontSize: '13px' }} onClick={copyMemo}>
                            Copy Memo
                          </button>
                          <button
                            className="btn-accent"
                            style={{ padding: '8px 20px', fontSize: '13px', opacity: 0.85 }}
                            onClick={printMemo}
                          >
                            Export PDF
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

              </div>
            )}
          </div>
        )}

        {/* ══ MODE 2: CROSS-DOCUMENT UPLOADER ═══════════════════════════════ */}
        {activeMode === 'cross-doc' && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {!crossResults ? (
              <>
                {/* Hidden file picker */}
                <input
                  type="file" ref={filePickerRef} style={{ display: 'none' }}
                  accept=".pdf,.docx" multiple
                  onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                />

                {/* Intelligence Dropzone */}
                <div
                  className={`intel-dz${sessionFiles.length > 0 ? ' has-files' : ''}${isDragOver ? ' dragover' : ''}`}
                  onClick={() => filePickerRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={e => { e.preventDefault(); setIsDragOver(false); }}
                  onDrop={e => { e.preventDefault(); setIsDragOver(false); addFiles(e.dataTransfer.files); }}
                >
                  <div className="intel-dz-glow" />
                  <div className="intel-dz-icon">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <path d="M12 18v-6M9 15l3-3 3 3"/>
                    </svg>
                  </div>
                  {sessionFiles.length === 0 ? (
                    <>
                      <div style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-dark-primary)' }}>
                        Drop all documents here
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text-dark-muted)', maxWidth: '400px', lineHeight: 1.55 }}>
                        Drag & drop multiple PDFs or DOCXs — or click to browse.
                        The engine runs clause-level cross-document conflict detection across all uploaded files simultaneously.
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {['PDF', 'DOCX', 'Multi-file drop'].map(t => (
                          <span key={t} style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '3px 9px', borderRadius: '20px', background: 'rgba(59,130,246,0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(59,130,246,0.2)' }}>{t}</span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-primary)' }}>
                      {sessionFiles.length} document{sessionFiles.length !== 1 ? 's' : ''} in session — drop more or click to add
                    </div>
                  )}
                </div>

                {/* File chips */}
                {sessionFiles.length > 0 && (
                  <div className="file-session">
                    {sessionFiles.map((f, idx) => (
                      <div className="file-chip" key={idx}>
                        <div className="file-chip-idx">{idx + 1}</div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                        </svg>
                        <div className="file-chip-meta">
                          <div className="file-chip-name">{f.name}</div>
                          <div className="file-chip-size">{formatBytes(f.size)}</div>
                        </div>
                        <button className="file-chip-remove" onClick={() => removeSessionFile(idx)} title="Remove">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 2px', marginTop: '4px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>{sessionFiles.length} file{sessionFiles.length !== 1 ? 's' : ''} loaded</span>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button className="btn-reset" style={{ padding: '8px 16px', fontSize: '12px' }} onClick={resetCrossDoc}>Clear All</button>
                        <button
                          className="btn-accent"
                          style={{ padding: '11px 34px', fontSize: '13.5px', fontWeight: '700' }}
                          onClick={handleCrossDocAnalyze}
                          disabled={sessionFiles.length < 2 || isLoading}
                        >
                          {isLoading ? 'Scanning…' : '⚡ Run Conflict Analysis'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {isLoading && (
                  <div className="skeleton-pulse-wrapper" style={{ marginTop: '8px', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div className="loading-spinner" style={{ width: '20px', height: '20px' }}></div>
                      <strong style={{ color: 'var(--accent-primary)', fontSize: '13px' }}>
                        Extracting {sessionFiles.length} documents and running clause-level RAG analysis…
                      </strong>
                    </div>
                    <div className="skeleton-bar" style={{ width: '85%' }}></div>
                    <div className="skeleton-bar" style={{ width: '70%' }}></div>
                    <div className="skeleton-bar" style={{ width: '78%' }}></div>
                  </div>
                )}

                {/* Recent Conflict Reports */}
                {recentReports.length > 0 && !isLoading && (
                  <div className="recent-reports">
                    <div className="recent-reports-head">
                      <span style={{ fontSize: '11.5px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-dark-muted)' }}>
                        Recent Conflict Reports
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>{recentReports.length} saved</span>
                    </div>
                    {recentReports.map(r => (
                      <div
                        key={r.id}
                        className={`report-item${selectedReport?.id === r.id ? ' selected' : ''}`}
                        onClick={() => setSelectedReport(prev => prev?.id === r.id ? null : r)}
                      >
                        <div className="report-dot" style={{ background: r.conflictsCount > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }} />
                        <span style={{ flex: 1, fontSize: '13px', fontWeight: '600', color: 'var(--text-dark-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', whiteSpace: 'nowrap', marginRight: '10px' }}>
                          {new Date(r.timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </span>
                        <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '10px', whiteSpace: 'nowrap', background: r.conflictsCount > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)', color: r.conflictsCount > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
                          {r.conflictsCount} conflict{r.conflictsCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    ))}
                    {selectedReport && (
                      <div className="report-detail-panel">
                        <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--accent-primary)', marginBottom: '6px', letterSpacing: '0.06em' }}>Report Summary</div>
                        <div style={{ fontSize: '13px', color: 'var(--text-dark-primary)', lineHeight: 1.6, marginBottom: '10px' }}>
                          {selectedReport.summary || 'No summary stored for this report.'}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {selectedReport.fileNames.map((n, i) => (
                            <span key={i} style={{ fontSize: '10.5px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(59,130,246,0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(59,130,246,0.18)' }}>
                              📄 {n}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* ── Results Panel ── */
              <div className="cross-results-grid">
                <div className="summary-col">
                  <div className="summary-card">
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: 'var(--accent-primary)', borderBottom: '1px solid var(--border-dark-subtle)', paddingBottom: '12px' }}>
                      📊 AI Summary
                    </h3>
                    <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Documents Analyzed</span>
                    <ul style={{ paddingLeft: '20px', margin: '8px 0 20px 0', fontSize: '13px', color: 'var(--text-dark-primary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {sessionFiles.map((f, i) => <li key={i}>📂 {f.name}</li>)}
                    </ul>
                    <div style={{ textAlign: 'center', padding: '16px', backgroundColor: 'var(--stat-bg)', border: '1px solid var(--stat-border)', borderRadius: '8px', marginBottom: '20px' }}>
                      <div style={{ fontSize: '36px', fontWeight: '700', color: 'var(--text-primary)' }}>{crossResults.conflicts?.length ?? 0}</div>
                      <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase' }}>Conflicts Found</span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--text-dark-muted)', lineHeight: '1.6', background: 'var(--stat-bg)', border: '1px solid var(--stat-border)', padding: '14px', borderRadius: '8px', marginBottom: '20px' }}>
                      {crossResults.summary}
                    </div>
                    <button className="btn-add-session" onClick={addToCurrentSet}>➕ Add Document to Current Set</button>
                    <button className="btn-reset" style={{ width: '100%', padding: '12px' }} onClick={resetCrossDoc}>🔄 Analyze New Documents</button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: 'var(--text-primary)' }}>Conflict Audit Logs</h3>
                  {crossResults.conflicts && crossResults.conflicts.length > 0 ? (
                    crossResults.conflicts.map((c, idx) => {
                      const sev = (c.severity || 'minor').toLowerCase();
                      return (
                        <div key={idx} className={`conflict-detail-card ${sev}`}>
                          <div className="conflict-card-header">
                            <strong style={{ color: 'var(--text-primary)', fontSize: '14.5px' }}>{c.title || `Conflict ${idx + 1}`}</strong>
                            <span className={`badge-status ${sev === 'critical' ? 'high' : sev === 'major' ? 'potential' : 'clear'}`}>{c.severity}</span>
                          </div>
                          <div className="excerpts-container">
                            <div className="excerpt-box doc-a">
                              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent-danger)', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>📄 {c.doc_a_name || 'Document A'}</span>
                              <div style={{ fontSize: '13px', color: 'var(--text-dark-primary)', fontStyle: 'italic', lineHeight: '1.6' }}>"{c.doc_a_excerpt}"</div>
                            </div>
                            <div className="excerpt-box doc-b">
                              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent-warning)', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>📄 {c.doc_b_name || 'Document B'}</span>
                              <div style={{ fontSize: '13px', color: 'var(--text-dark-primary)', fontStyle: 'italic', lineHeight: '1.6' }}>"{c.doc_b_excerpt}"</div>
                            </div>
                          </div>
                          <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ backgroundColor: 'var(--accent-muted)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: '8px', padding: '12px 14px' }}>
                              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent-primary)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>⚖️ Legal Explanation</span>
                              <div style={{ fontSize: '13px', color: 'var(--text-dark-muted)' }}>{c.legal_explanation}</div>
                            </div>
                            <div style={{ backgroundColor: 'var(--badge-clear-bg)', border: '1px solid var(--badge-clear-border)', borderRadius: '8px', padding: '12px 14px' }}>
                              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--badge-clear-color)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>✅ Recommended Harmonization</span>
                              <div style={{ fontSize: '13.5px', color: 'var(--text-primary)', marginBottom: '8px' }}>{c.recommended_resolution}</div>
                              <button className="btn-copy" style={{ backgroundColor: 'var(--badge-clear-bg)', border: '1px solid var(--badge-clear-border)', color: 'var(--badge-clear-color)', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', borderRadius: '4px' }} onClick={() => copyResolutionToClipboard(c.recommended_resolution)}>
                                Copy Harmonized Clause
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ padding: '40px', backgroundColor: 'var(--bg-dark-panel)', border: '1px solid var(--border-dark-subtle)', borderRadius: '12px', textAlign: 'center', fontStyle: 'italic', color: 'var(--text-dark-muted)' }}>
                      No conflicting statements found across compared files.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Toast ── */}
      <div className={`toast ${showToast ? 'show' : ''} ${toastWarn ? 'warn' : ''}`}>
        {toastMsg}
      </div>
    </>
  );
}
