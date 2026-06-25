import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchTrackedCases, fetchDocuments, fetchDocumentDetails } from '../services/api';
import { useAdversarialAgent } from '../hooks/useAdversarialAgent';
import { renderMarkdown, MARKDOWN_CSS } from '../utils/markdownUtils';

// ── Trial stage definitions ───────────────────────────────────────────────────
const STAGES = [
  { id: 'pre_filing',  label: 'Pre-Filing Risk Scan',   roman: 'I'   },
  { id: 'bail',        label: 'Bail Argument',           roman: 'II'  },
  { id: 'cross_exam',  label: 'Cross-Examination',       roman: 'III' },
  { id: 'final_args',  label: 'Final Arguments',         roman: 'IV'  },
];

// ── SVG icons (self-contained — no theme dependency) ─────────────────────────
const GavelIcon = ({ size = 18, color = '#DC2626' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m14.5 12.5-8 8a2.12 2.12 0 0 1-3-3l8-8"/>
    <path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/>
  </svg>
);
const FolderIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);
const SendIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);
const UserIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="#1D4ED8">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

// ── Styles ────────────────────────────────────────────────────────────────────
const VC_CSS = `
${MARKDOWN_CSS}

/* ─────────────── SHELL ────────────────────────────────────────────── */
.vc-shell {
  height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #090B10;
  font-family: 'Inter', 'SF Pro Display', system-ui, -apple-system, sans-serif;
}

/* ─────────────── STAGE BAR ────────────────────────────────────────── */
.vc-stage-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 18px;
  background: #0C0E14;
  border-bottom: 1px solid rgba(185, 28, 28, 0.22);
  min-height: 46px;
  gap: 2px;
}
.vc-stage-label {
  font-size: 8.5px;
  font-weight: 800;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 1.1px;
  margin-right: 10px;
  flex-shrink: 0;
}
.vc-stage-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 13px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 600;
  color: #4B5563;
  transition: color 0.16s, background 0.16s, border-color 0.16s;
  white-space: nowrap;
  font-family: inherit;
}
.vc-stage-btn:hover { color: #9CA3AF; background: rgba(255,255,255,0.03); }
.vc-stage-btn.vc-active {
  color: #FECACA;
  background: rgba(220, 38, 38, 0.09);
  border-color: rgba(220, 38, 38, 0.24);
}
.vc-stage-roman {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 16px;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0;
  background: rgba(220, 38, 38, 0.12);
  color: #DC2626;
  transition: background 0.16s, color 0.16s;
}
.vc-stage-btn.vc-active .vc-stage-roman { background: rgba(220,38,38,0.22); color: #F87171; }

/* ─────────────── BODY ──────────────────────────────────────────────── */
.vc-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* ─────────────── EVIDENCE BOARD ───────────────────────────────────── */
.vc-eb {
  width: 268px;
  flex-shrink: 0;
  background: #0B0D12;
  border-right: 1px solid rgba(255,255,255,0.055);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.vc-eb-head {
  flex-shrink: 0;
  padding: 13px 15px 11px;
  border-bottom: 1px solid rgba(255,255,255,0.045);
}
.vc-eb-heading {
  font-size: 8.5px;
  font-weight: 800;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 10px;
}
.vc-eb-live-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #DC2626;
  box-shadow: 0 0 6px rgba(220,38,38,0.8);
  animation: vc-pulse-dot 2.2s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes vc-pulse-dot {
  0%,100% { opacity: 1; }
  50% { opacity: 0.25; }
}
.vc-case-select {
  width: 100%;
  background: rgba(255,255,255,0.035);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  color: #CBD5E1;
  font-size: 12px;
  padding: 7px 10px;
  outline: none;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.14s;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%234B5563' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}
.vc-case-select:focus { border-color: rgba(220,38,38,0.38); }
.vc-case-select option { background: #12151C; color: #CBD5E1; }

/* Doc list */
.vc-docs-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}
.vc-docs-scroll::-webkit-scrollbar { width: 3px; }
.vc-docs-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 2px; }

.vc-doc-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.12s;
  border-left: 2px solid transparent;
}
.vc-doc-row:hover { background: rgba(255,255,255,0.025); }
.vc-doc-row.vc-doc-active {
  background: rgba(220,38,38,0.05);
  border-left-color: #DC2626;
}
.vc-doc-check {
  width: 13px; height: 13px;
  border-radius: 3px;
  border: 1px solid rgba(255,255,255,0.11);
  flex-shrink: 0;
  margin-top: 1px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.14s;
}
.vc-doc-row.vc-doc-active .vc-doc-check {
  background: rgba(220,38,38,0.18);
  border-color: rgba(220,38,38,0.45);
}
.vc-doc-info { min-width: 0; flex: 1; }
.vc-doc-name {
  font-size: 11.5px;
  color: #94A3B8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
  transition: color 0.12s;
}
.vc-doc-row.vc-doc-active .vc-doc-name { color: #FCA5A5; }
.vc-doc-type {
  font-size: 8.5px;
  color: #374151;
  font-family: 'Fira Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-top: 2px;
}

/* Evidence board empty / loading states */
.vc-eb-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 18px;
  text-align: center;
}
.vc-eb-state-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: rgba(220,38,38,0.07);
  border: 1px solid rgba(220,38,38,0.14);
  display: flex; align-items: center; justify-content: center;
  color: #7F1D1D;
}
.vc-eb-state-text { font-size: 11px; color: #374151; line-height: 1.55; }
.vc-eb-spin {
  width: 18px; height: 18px;
  border: 2px solid rgba(220,38,38,0.2);
  border-top-color: #DC2626;
  border-radius: 50%;
  animation: vc-spin 0.85s linear infinite;
}
@keyframes vc-spin { to { transform: rotate(360deg); } }

/* Preview pane */
.vc-preview {
  flex-shrink: 0;
  max-height: 148px;
  border-top: 1px solid rgba(255,255,255,0.04);
  padding: 10px 14px;
  overflow-y: auto;
}
.vc-preview::-webkit-scrollbar { width: 2px; }
.vc-preview-label {
  font-size: 8px;
  font-weight: 700;
  color: #1F2937;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
}
.vc-preview-text {
  font-size: 10.5px;
  color: #374151;
  line-height: 1.65;
  font-family: 'Fira Mono', 'Courier New', monospace;
}

/* Docs-in-evidence status strip */
.vc-evidence-strip {
  flex-shrink: 0;
  padding: 7px 14px;
  border-top: 1px solid rgba(255,255,255,0.04);
  display: flex;
  align-items: center;
  gap: 7px;
}
.vc-evidence-live { width: 5px; height: 5px; border-radius: 50%; background: #10B981; box-shadow: 0 0 5px rgba(16,185,129,0.65); }
.vc-evidence-strip-text { font-size: 9.5px; color: #374151; font-weight: 600; }

/* ─────────────── INTERROGATION PANE ───────────────────────────────── */
.vc-int {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #0D0F14;
  min-width: 0;
}

/* Interrogation header */
.vc-int-head {
  flex-shrink: 0;
  padding: 11px 20px;
  background: #0E1017;
  border-bottom: 1px solid rgba(185,28,28,0.14);
  display: flex;
  align-items: center;
  gap: 10px;
}
.vc-int-head-meta { flex: 1; min-width: 0; }
.vc-int-head-title {
  font-size: 10px;
  font-weight: 800;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 1px;
}
.vc-int-head-sub { font-size: 9.5px; color: #1F2937; }
.vc-int-stage-chip {
  font-size: 10.5px; font-weight: 600;
  color: #F87171;
  background: rgba(220,38,38,0.08);
  border: 1px solid rgba(220,38,38,0.16);
  border-radius: 5px;
  padding: 3px 9px;
  flex-shrink: 0;
}
.vc-int-docs-chip {
  font-size: 10.5px;
  color: #4B5563;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 5px;
  padding: 3px 9px;
  flex-shrink: 0;
}
.vc-reset-btn {
  font-size: 10.5px; font-weight: 600;
  color: #374151; background: transparent;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 5px; padding: 3px 9px;
  cursor: pointer; font-family: inherit;
  transition: color 0.14s, border-color 0.14s;
  flex-shrink: 0;
}
.vc-reset-btn:hover { color: #9CA3AF; border-color: rgba(255,255,255,0.12); }

/* ─────────────── EXCHANGE LOG ──────────────────────────────────────── */
.vc-log {
  flex: 1;
  overflow-y: auto;
  padding: 26px 26px 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
}
.vc-log::-webkit-scrollbar { width: 3px; }
.vc-log::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 2px; }

/* Empty state */
.vc-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  padding: 40px 32px;
}
.vc-empty-icon {
  width: 54px; height: 54px; border-radius: 14px;
  background: rgba(220,38,38,0.07);
  border: 1px solid rgba(220,38,38,0.18);
  display: flex; align-items: center; justify-content: center;
}
.vc-empty-title { font-size: 14px; font-weight: 700; color: #374151; }
.vc-empty-sub { font-size: 12px; color: #1F2937; line-height: 1.65; max-width: 360px; }
.vc-empty-sub em { color: #374151; font-style: normal; }

/* AI message */
.vc-msg-ai {
  background: #160B0B;
  border: 1px solid rgba(220,38,38,0.13);
  border-left: 3px solid #DC2626;
  border-radius: 0 9px 9px 0;
  padding: 15px 18px;
  max-width: 860px;
  animation: vc-in-left 0.26s cubic-bezier(0.16,1,0.3,1) both;
}
@keyframes vc-in-left {
  from { opacity: 0; transform: translateX(-8px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* User message */
.vc-msg-user {
  background: #090F1C;
  border: 1px solid rgba(59,130,246,0.1);
  border-right: 3px solid #1D4ED8;
  border-radius: 9px 0 0 9px;
  padding: 13px 18px;
  max-width: 820px;
  align-self: flex-end;
  animation: vc-in-right 0.22s cubic-bezier(0.16,1,0.3,1) both;
}
@keyframes vc-in-right {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}

.vc-msg-header {
  font-size: 8.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 9px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.vc-msg-ai .vc-msg-header { color: #EF4444; }
.vc-msg-user .vc-msg-header { color: #3B82F6; }
.vc-msg-ts { margin-left: auto; font-size: 8.5px; color: #1F2937; font-family: monospace; font-weight: 400; }
.vc-msg-body {
  font-size: 13.5px;
  line-height: 1.78;
  color: #CBD5E1;
}
.vc-msg-ai .vc-msg-body { color: #E2E8F0; }

/* Thinking indicator */
.vc-thinking {
  background: #160B0B;
  border: 1px solid rgba(220,38,38,0.09);
  border-left: 3px solid rgba(220,38,38,0.35);
  border-radius: 0 9px 9px 0;
  padding: 13px 18px;
  max-width: 340px;
  display: flex;
  align-items: center;
  gap: 12px;
  animation: vc-in-left 0.26s cubic-bezier(0.16,1,0.3,1) both;
}
.vc-thinking-dots { display: flex; gap: 5px; }
.vc-td {
  width: 5px; height: 5px; border-radius: 50%; background: #DC2626;
  animation: vc-bounce 1.4s ease-in-out infinite;
}
.vc-td:nth-child(2) { animation-delay: 0.16s; }
.vc-td:nth-child(3) { animation-delay: 0.32s; }
@keyframes vc-bounce {
  0%,80%,100% { transform: translateY(0); opacity: 0.35; }
  40% { transform: translateY(-5px); opacity: 1; }
}
.vc-thinking-text { font-size: 11.5px; color: #374151; font-style: italic; }

/* ─────────────── INPUT AREA ────────────────────────────────────────── */
.vc-input-zone {
  flex-shrink: 0;
  padding: 14px 20px 18px;
  background: #0E1017;
  border-top: 1px solid rgba(255,255,255,0.045);
}
.vc-input-row {
  display: flex;
  gap: 9px;
  align-items: flex-end;
}
.vc-textarea {
  flex: 1;
  background: rgba(255,255,255,0.035);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  color: #E2E8F0;
  font-size: 13.5px;
  line-height: 1.6;
  padding: 11px 14px;
  resize: none;
  min-height: 50px;
  max-height: 160px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.14s;
}
.vc-textarea::placeholder { color: #1F2937; }
.vc-textarea:focus { border-color: rgba(220,38,38,0.32); }
.vc-textarea:disabled { opacity: 0.45; cursor: not-allowed; }
.vc-submit {
  padding: 11px 17px;
  background: linear-gradient(135deg, #B91C1C 0%, #DC2626 100%);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 700;
  font-family: inherit;
  letter-spacing: 0.02em;
  transition: all 0.14s;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
.vc-submit:hover:not(:disabled) {
  background: linear-gradient(135deg, #991B1B 0%, #B91C1C 100%);
  box-shadow: 0 4px 18px rgba(220,38,38,0.42);
  transform: translateY(-1px);
}
.vc-submit:disabled { opacity: 0.38; cursor: not-allowed; transform: none; box-shadow: none; }
.vc-input-hint {
  font-size: 10px;
  color: #1F2937;
  margin-top: 7px;
  text-align: center;
}

/* ─────────────── PRESSURE INDEX COLUMN ────────────────────────────── */
.vc-pressure-col {
  width: 50px;
  flex-shrink: 0;
  background: #090B10;
  border-left: 1px solid rgba(255,255,255,0.04);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px 0;
  gap: 12px;
}
.vc-pressure-heading {
  font-size: 7.5px;
  font-weight: 800;
  color: #1F2937;
  text-transform: uppercase;
  letter-spacing: 1px;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
}
.vc-pressure-track {
  position: relative;
  width: 10px;
  height: 160px;
  background: rgba(255,255,255,0.035);
  border-radius: 5px;
  overflow: hidden;
}
.vc-pressure-fill {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  border-radius: 5px;
  transition: height 0.95s cubic-bezier(0.16,1,0.3,1),
              background 0.65s ease,
              box-shadow 0.65s ease;
}
.vc-pressure-val {
  font-size: 10px;
  font-weight: 800;
  font-family: monospace;
  transition: color 0.5s ease;
}
.vc-pressure-state {
  font-size: 7px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transition: color 0.5s ease;
}
`;

// ── Pressure Index component ──────────────────────────────────────────────────
const PressureIndex = ({ value }) => {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct <= 35 ? '#10B981' : pct <= 70 ? '#F59E0B' : '#EF4444';
  const state = pct <= 35 ? 'SECURE' : pct <= 70 ? 'CONTESTED' : 'CRITICAL';
  return (
    <div className="vc-pressure-col">
      <div className="vc-pressure-heading">Pressure Index</div>
      <div className="vc-pressure-track">
        <div
          className="vc-pressure-fill"
          style={{
            height: `${pct}%`,
            background: color,
            boxShadow: `0 0 8px ${color}55`,
          }}
        />
      </div>
      <div className="vc-pressure-val" style={{ color }}>{pct}</div>
      <div className="vc-pressure-state" style={{ color }}>{state}</div>
    </div>
  );
};

// ── Format time helper ────────────────────────────────────────────────────────
const fmt = (date) =>
  date
    ? new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '';

// ── Main component ────────────────────────────────────────────────────────────
export default function VirtualCourtroom() {
  // Evidence Board
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [docs, setDocs] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [activeDocIds, setActiveDocIds] = useState(new Set());
  const [docCache, setDocCache] = useState({}); // id → full content string
  const [previewDocId, setPreviewDocId] = useState(null);

  // Adversarial hook
  const {
    messages, isThinking, pressure,
    stage, setStage,
    setCaseContext,
    sendMessage, clearSession,
  } = useAdversarialAgent();

  // Input
  const [input, setInput] = useState('');
  const logRef = useRef(null);
  const textareaRef = useRef(null);

  // ── Load tracked cases on mount ─────────────────────────────────────────────
  useEffect(() => {
    fetchTrackedCases()
      .then(data => { if (Array.isArray(data)) setCases(data); })
      .catch(() => {});
  }, []);

  // ── Load documents when case changes ───────────────────────────────────────
  useEffect(() => {
    if (!selectedCaseId) { setDocs([]); return; }
    setLoadingDocs(true);
    setActiveDocIds(new Set());
    setDocCache({});
    setPreviewDocId(null);
    fetchDocuments(selectedCaseId)
      .then(data => { setDocs(Array.isArray(data) ? data : []); })
      .catch(() => { setDocs([]); })
      .finally(() => setLoadingDocs(false));
  }, [selectedCaseId]);

  // ── Rebuild simulation context when active docs change ─────────────────────
  useEffect(() => {
    if (activeDocIds.size === 0) { setCaseContext(''); return; }
    const parts = [];
    activeDocIds.forEach(id => {
      const doc = docs.find(d => d.id === id);
      const content = docCache[id];
      if (!doc) return;
      const name = doc.filename || doc.title || `Document ${id}`;
      if (content) {
        parts.push(`[DOCUMENT: ${name}]\n${content.slice(0, 3200)}`);
      } else if (doc.summary) {
        parts.push(`[DOCUMENT: ${name}]\nSummary: ${doc.summary}`);
      }
    });
    setCaseContext(parts.join('\n\n---\n\n'));
  }, [activeDocIds, docCache, docs, setCaseContext]);

  // ── Auto-scroll log ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  // ── Toggle doc in evidence ──────────────────────────────────────────────────
  const handleDocToggle = useCallback(async (doc) => {
    const id = doc.id;
    const next = new Set(activeDocIds);
    if (next.has(id)) {
      next.delete(id);
      setActiveDocIds(next);
      if (previewDocId === id) setPreviewDocId(null);
      return;
    }
    next.add(id);
    setActiveDocIds(next);
    setPreviewDocId(id);
    if (!docCache[id]) {
      try {
        const details = await fetchDocumentDetails(id);
        if (!details.error) {
          const content = details.content || details.text || details.body || details.summary || '';
          setDocCache(prev => ({ ...prev, [id]: content }));
        }
      } catch { /* doc cache update is best-effort */ }
    }
  }, [activeDocIds, docCache, previewDocId]);

  // ── Submit handler ──────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isThinking) return;
    sendMessage(text);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, isThinking, sendMessage]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  // ── Derived state ───────────────────────────────────────────────────────────
  const currentStage = STAGES.find(s => s.id === stage) || STAGES[0];
  const previewDoc = docs.find(d => d.id === previewDocId);
  const previewContent =
    previewDocId
      ? (docCache[previewDocId] || previewDoc?.summary || '')
      : '';

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{VC_CSS}</style>
      <div className="vc-shell">

        {/* ── STAGE SELECTOR BAR ─────────────────────────────────────────── */}
        <div className="vc-stage-bar">
          <span className="vc-stage-label">Trial Phase</span>
          {STAGES.map(s => (
            <button
              key={s.id}
              className={`vc-stage-btn${stage === s.id ? ' vc-active' : ''}`}
              onClick={() => setStage(s.id)}
            >
              <span className="vc-stage-roman">{s.roman}</span>
              {s.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto' }}>
            {messages.length > 0 && (
              <button
                className="vc-reset-btn"
                onClick={() => { clearSession(); setInput(''); }}
              >
                New Session
              </button>
            )}
          </div>
        </div>

        {/* ── BODY ───────────────────────────────────────────────────────── */}
        <div className="vc-body">

          {/* ── LEFT: EVIDENCE BOARD ─────────────────────────────────────── */}
          <div className="vc-eb">
            <div className="vc-eb-head">
              <div className="vc-eb-heading">
                <span className="vc-eb-live-dot" />
                Evidence Board
              </div>
              <select
                className="vc-case-select"
                value={selectedCaseId}
                onChange={e => setSelectedCaseId(e.target.value)}
              >
                <option value="">— Select Case —</option>
                {cases.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.case_name || c.title || `Case #${c.id}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Document list */}
            {loadingDocs ? (
              <div className="vc-eb-state">
                <div className="vc-eb-spin" />
                <div className="vc-eb-state-text" style={{ fontSize: 10 }}>Loading vault…</div>
              </div>
            ) : !selectedCaseId ? (
              <div className="vc-eb-state">
                <div className="vc-eb-state-icon"><FolderIcon size={18} /></div>
                <div className="vc-eb-state-text">
                  Select a case to load its documents into evidence
                </div>
              </div>
            ) : docs.length === 0 ? (
              <div className="vc-eb-state">
                <div className="vc-eb-state-text" style={{ color: '#1F2937' }}>
                  No documents in this case vault
                </div>
              </div>
            ) : (
              <div className="vc-docs-scroll">
                {docs.map(doc => {
                  const isActive = activeDocIds.has(doc.id);
                  return (
                    <div
                      key={doc.id}
                      className={`vc-doc-row${isActive ? ' vc-doc-active' : ''}`}
                      onClick={() => handleDocToggle(doc)}
                      title={doc.filename || doc.title}
                    >
                      <div className="vc-doc-check">
                        {isActive && (
                          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="2 6 5 9 10 3" />
                          </svg>
                        )}
                      </div>
                      <div className="vc-doc-info">
                        <div className="vc-doc-name">
                          {doc.filename || doc.title || `Document #${doc.id}`}
                        </div>
                        {doc.filetype && (
                          <div className="vc-doc-type">{doc.filetype}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Document text preview */}
            {previewContent && (
              <div className="vc-preview">
                <div className="vc-preview-label">Preview</div>
                <div className="vc-preview-text">
                  {previewContent.slice(0, 340)}
                  {previewContent.length > 340 && '…'}
                </div>
              </div>
            )}

            {/* Active evidence strip */}
            {activeDocIds.size > 0 && (
              <div className="vc-evidence-strip">
                <div className="vc-evidence-live" />
                <span className="vc-evidence-strip-text">
                  {activeDocIds.size} doc{activeDocIds.size !== 1 ? 's' : ''} in evidence
                </span>
              </div>
            )}
          </div>

          {/* ── CENTRE: INTERROGATION PANE ───────────────────────────────── */}
          <div className="vc-int">

            {/* Header */}
            <div className="vc-int-head">
              <div className="vc-int-head-meta">
                <div className="vc-int-head-title">Adversarial Simulation</div>
                <div className="vc-int-head-sub">Indian Law · IPC / BNS / CrPC / BNSS / CPC / IEA</div>
              </div>
              <div className="vc-int-stage-chip">{currentStage.label}</div>
              {activeDocIds.size > 0 && (
                <div className="vc-int-docs-chip">
                  {activeDocIds.size} doc{activeDocIds.size !== 1 ? 's' : ''} loaded
                </div>
              )}
              {messages.length > 0 && (
                <button
                  className="vc-reset-btn"
                  onClick={() => { clearSession(); setInput(''); }}
                >
                  Reset
                </button>
              )}
            </div>

            {/* Exchange Log */}
            <div className="vc-log" ref={logRef}>
              {messages.length === 0 && !isThinking ? (
                <div className="vc-empty">
                  <div className="vc-empty-icon">
                    <GavelIcon size={26} color="#7F1D1D" />
                  </div>
                  <div className="vc-empty-title">The Court Is In Session</div>
                  <div className="vc-empty-sub">
                    State your opening argument or legal position below. Opposing Counsel will
                    attack it under <em>Indian Law</em>.
                    {activeDocIds.size === 0 && (
                      <> Load case documents from the Evidence Board for document-grounded attacks.</>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map(msg => {
                    const isAI = msg.role === 'ai';
                    return (
                      <div key={msg.id} className={isAI ? 'vc-msg-ai' : 'vc-msg-user'}>
                        <div className="vc-msg-header">
                          {isAI ? (
                            <>
                              <GavelIcon size={10} color="#DC2626" />
                              Opposing Counsel
                            </>
                          ) : (
                            <>
                              <UserIcon />
                              Your Argument
                            </>
                          )}
                          <span className="vc-msg-ts">{fmt(msg.ts)}</span>
                        </div>
                        <div
                          className="vc-msg-body md-body"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                        />
                      </div>
                    );
                  })}

                  {isThinking && (
                    <div className="vc-thinking">
                      <div className="vc-thinking-dots">
                        <div className="vc-td" />
                        <div className="vc-td" />
                        <div className="vc-td" />
                      </div>
                      <div className="vc-thinking-text">Opposing Counsel is formulating attack…</div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Input */}
            <div className="vc-input-zone">
              <div className="vc-input-row">
                <textarea
                  ref={textareaRef}
                  className="vc-textarea"
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="State your legal argument, cite your authority, present your evidence…"
                  disabled={isThinking}
                  rows={2}
                />
                <button
                  className="vc-submit"
                  onClick={handleSubmit}
                  disabled={!input.trim() || isThinking}
                >
                  <SendIcon />
                  Submit
                </button>
              </div>
              <div className="vc-input-hint">
                Ctrl+Enter to submit · Arguments grounded in Indian Law only
              </div>
            </div>
          </div>

          {/* ── RIGHT: PRESSURE INDEX ─────────────────────────────────────── */}
          <PressureIndex value={pressure} />
        </div>
      </div>
    </>
  );
}
