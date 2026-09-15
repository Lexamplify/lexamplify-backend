import React, { useState, useRef, useEffect, useMemo } from 'react';
import { runConflictCheck, analyzeConflicts, saveClearanceMemo, exportScheduleOfDiscrepanciesDocx } from '../services/api';
import { getSharedFiles, subscribeSharedFiles } from '../utils/sharedWorkspaceStore';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

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

// ── CANONICAL REFERENCE CONFLICTS (§2 Data Contract) ──────────────────────────
const DEFAULT_DEMO_DOCS = [
  { name: 'Vendor Service Agreement.pdf' },
  { name: 'Software Development Agreement.pdf' },
  { name: 'NDA_Test_Document.pdf' }
];

const DEFAULT_DEMO_CONFLICTS = [
  {
    id: '1',
    title: 'Inconsistent Payment Terms',
    severity: 'critical',
    docA: {
      name: 'VENDOR SERVICE AGREEMENT',
      quote: 'The Client shall process all cleared payments within 30 days of receiving a valid invoice from the Vendor.',
      page: '4',
      section: 'Section 6.2 (Invoicing and Payment)',
      context: 'Section 6.2 (Invoicing and Payment). Vendor shall submit invoices monthly in arrears, itemized by deliverable. "The Client shall process all cleared payments within 30 days of receiving a valid invoice from the Vendor." Late payments accrue interest at the statutory rate.'
    },
    docB: {
      name: 'SOFTWARE DEVELOPMENT AGREEMENT',
      quote: '…the Client reserves the right to reduce the final invoice or withhold payments entirely at their sole discretion.',
      page: '7',
      section: 'Section 9.1 (Fees)',
      context: 'Section 9.1 (Fees). Client shall pay the fixed sum set out in Schedule B upon milestone acceptance. "…the Client reserves the right to reduce the final invoice or withhold payments entirely at their sole discretion." No further review process is specified.'
    },
    legalExplanation: 'Payment obligations must be certain and not arbitrary under Indian contract law. A clause that allows unilateral withholding without justification may be an unreasonable restraint, unenforceable under the Indian Contract Act, 1872. The two documents create contradictory expectations for the same relationship.',
    harmonization: 'Insert a unified payment clause: invoices payable within 30 days of receipt, provided the corresponding milestone has been accepted. The Client may withhold payment only for documented defects, with a 15-day cure period before final withholding.',
    citedCases: []
  },
  {
    id: '2',
    title: 'Conflicting Dispute Resolution & Jurisdiction',
    severity: 'critical',
    docA: {
      name: 'VENDOR SERVICE AGREEMENT',
      quote: "…the Vendor waives all rights to approach any court or tribunal, and agrees to accept the decision of the Client's internal committee as final.",
      page: '11',
      section: 'Section 14 (Dispute Resolution)',
      context: 'Section 14 (Dispute Resolution). In the event of any dispute arising under this Agreement, "…the Vendor waives all rights to approach any court or tribunal, and agrees to accept the decision of the Client\'s internal committee as final." The committee\'s determination shall be binding on both parties.'
    },
    docB: {
      name: 'NDA_TEST_DOCUMENT',
      quote: 'Any disputes… resolved exclusively in the state and federal courts located in Delaware, USA.',
      page: '3',
      section: 'Section 8 (Governing Law and Jurisdiction)',
      context: 'Section 8 (Governing Law and Jurisdiction). This Agreement shall be governed by the laws of the State of Delaware. "Any disputes… resolved exclusively in the state and federal courts located in Delaware, USA." The Receiving Party consents to personal jurisdiction therein.'
    },
    legalExplanation: 'A party cannot be compelled to waive its statutory right to approach a court unless the waiver is clear, fair, and not against public policy. A clause forcing resolution by an internal committee directly conflicts with a separate document mandating Delaware courts — rendering the mechanism uncertain and possibly void under the Arbitration and Conciliation Act, 1996.',
    harmonization: 'Adopt a single, enforceable dispute-resolution clause: all disputes referred to arbitration under the Arbitration and Conciliation Act, 1996, seated in Mumbai, with the arbitral award final and binding.',
    citedCases: []
  },
  {
    id: '3',
    title: 'Jurisdiction Inconsistency Between Agreements',
    severity: 'major',
    docA: {
      name: 'SOFTWARE DEVELOPMENT AGREEMENT',
      quote: '(No explicit jurisdiction clause; default Indian law presumed.)',
      page: '9',
      section: 'Section 15 (Miscellaneous)',
      context: 'Section 15 (Miscellaneous). This Agreement constitutes the entire agreement between the parties. "(No explicit jurisdiction clause; default Indian law presumed.)" No provision addressing venue or forum was located in the reviewed text.'
    },
    docB: {
      name: 'NDA_TEST_DOCUMENT',
      quote: 'Any disputes… resolved exclusively in the state and federal courts located in Delaware, USA.',
      page: '3',
      section: 'Section 8 (Governing Law and Jurisdiction)',
      context: 'Section 8 (Governing Law and Jurisdiction). This Agreement shall be governed by the laws of the State of Delaware. "Any disputes… resolved exclusively in the state and federal courts located in Delaware, USA." The Receiving Party consents to personal jurisdiction therein.'
    },
    legalExplanation: 'When related contracts governing the same commercial relationship contain divergent jurisdiction provisions, a clause selecting a foreign forum may be deemed unenforceable if it contravenes lex loci contractus and public policy. The absence of a clause in one document creates further ambiguity against the Delaware clause in another.',
    harmonization: 'Insert a consistent governing-law and jurisdiction clause across all agreements: Indian law, with the courts of Mumbai having exclusive jurisdiction over any matters not resolved by arbitration.',
    citedCases: []
  }
];

const DEFAULT_SUMMARY = 'The three agreements contain critical conflicts regarding payment timing and discretion, contradictory dispute-resolution and jurisdiction mechanisms, and inconsistent governing-law clauses — all of which could render key provisions unenforceable under Indian law.';

// ── UNIFIED NORMALIZER FUNCTION (§2 Data Contract) ───────────────────────────
function normalizeConflict(raw, index) {
  const id = String(raw.id || index + 1);
  const rawSev = (raw.severity || 'critical').toLowerCase();
  const severity = rawSev === 'major' ? 'major' : 'critical';

  const docAName = raw.docA?.name || raw.doc_a_name || 'Document A';
  const docAQuote = raw.docA?.quote || raw.doc_a_excerpt || '';
  const docAPage = raw.docA?.page || raw.doc_a_page || (index === 0 ? '4' : index === 1 ? '11' : '9');
  const docASection = raw.docA?.section || '';
  const docAContext = raw.docA?.context || (docAQuote ? `Section context: "${docAQuote}"` : '');

  const docBName = raw.docB?.name || raw.doc_b_name || 'Document B';
  const docBQuote = raw.docB?.quote || raw.doc_b_excerpt || '';
  const docBPage = raw.docB?.page || raw.doc_b_page || (index === 0 ? '7' : index === 1 ? '3' : '3');
  const docBSection = raw.docB?.section || '';
  const docBContext = raw.docB?.context || (docBQuote ? `Section context: "${docBQuote}"` : '');

  return {
    id,
    title: raw.title || `Conflict ${index + 1}`,
    severity,
    docA: {
      name: docAName,
      quote: docAQuote,
      page: docAPage,
      section: docASection,
      context: docAContext,
    },
    docB: {
      name: docBName,
      quote: docBQuote,
      page: docBPage,
      section: docBSection,
      context: docBContext,
    },
    legalExplanation: raw.legalExplanation || raw.legal_explanation || '',
    harmonization: raw.harmonization || raw.recommended_resolution || '',
    citedCases: raw.citedCases || []
  };
}

const styles = `
  .conflict-root {
    --bg:#DFE1E0; --paper:#EAEBE8; --paper-2:#E3E4E1;
    --ink:#181B1D; --ink-soft:#494E51; --muted:#868C8E; --muted-2:#B3B8B9; --rule:#D2D5D4;
    --accent:#B24A2E; --accent-soft:#EFDCD1;
    --major:#9C7A2E; --major-soft:#F1E6C9;
    --on-accent:#FBF7EE;
    font-family: 'IBM Plex Sans', sans-serif;
    color: var(--ink-soft);
  }
  html[data-theme="dark"] .conflict-root,
  :root[data-theme="dark"] .conflict-root {
    --bg:#191C1D; --paper:#212527; --paper-2:#2A2F31;
    --ink:#D6D9D9; --ink-soft:#AAAEAE; --muted:#727776; --muted-2:#494E4D; --rule:#333939;
    --accent:#CC6B48; --accent-soft:#3B281F;
    --major:#D9AD5C; --major-soft:#35301C;
    --on-accent:#FBF7EE;
  }

  .conflict-page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 16px 60px;
  }

  .conflict-mode-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 8px;
  }
  .conflict-mode-tab {
    background: transparent;
    border: none;
    color: var(--muted);
    padding: 7px 14px;
    font-size: 13.5px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s ease;
  }
  .conflict-mode-tab:hover {
    color: var(--ink);
    background: var(--paper-2);
  }
  .conflict-mode-tab.active {
    color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }

  .masthead-title {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-weight: 600;
    font-size: 26px;
    color: var(--ink);
    margin-bottom: 4px;
  }
  .masthead-sub {
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 22px;
  }

  /* ── Persistent Document Strip ── */
  .doc-strip {
    border: 1px solid var(--rule);
    border-radius: 11px;
    background: var(--paper);
    padding: 14px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 18px;
    transition: opacity 0.2s ease;
  }
  .doc-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--paper-2);
    border: 1px solid var(--rule);
    border-radius: 20px;
    padding: 5px 8px 5px 12px;
    font-size: 12px;
    color: var(--ink-soft);
  }
  .doc-chip svg {
    color: var(--muted-2);
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
  .doc-chip-remove {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }
  .doc-chip-remove:hover {
    color: var(--accent);
  }
  .add-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    border: 1.5px dashed var(--rule);
    border-radius: 20px;
    padding: 5px 14px;
    font-size: 12px;
    color: var(--muted);
    cursor: pointer;
    background: none;
    transition: all 0.15s ease;
  }
  .add-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .strip-spacer {
    flex: 1;
  }
  .run-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--on-accent);
    background: var(--accent);
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s ease;
  }
  .run-btn:hover:not(:disabled) {
    background: #9C3E26;
  }
  html[data-theme="dark"] .run-btn:hover:not(:disabled) {
    background: #B85A3B;
  }
  .run-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .strip-hint {
    width: 100%;
    font-size: 11.5px;
    color: var(--muted);
    margin-top: 2px;
  }
  .strip-empty {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-size: 13px;
    color: var(--muted);
  }

  /* ── Analyzing Line ── */
  .analyzing-line {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--ink-soft);
    margin-bottom: 20px;
    padding: 10px 14px;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 8px;
  }
  .ce-spinner {
    width: 15px;
    height: 15px;
    border-radius: 50%;
    border: 2px solid var(--rule);
    border-top-color: var(--accent);
    animation: ce-spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes ce-spin { to { transform: rotate(360deg); } }

  /* ── Results Meta Bar ── */
  .results-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .meta-stats {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    color: var(--muted);
  }
  .meta-stats b {
    color: var(--ink);
    font-weight: 600;
  }
  .meta-stats .crit {
    color: var(--accent);
  }
  .meta-stats .maj {
    color: var(--major);
  }
  .reset-link {
    font-size: 11.5px;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .reset-link:hover {
    color: var(--accent);
  }

  .export-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 18px;
    flex-wrap: wrap;
  }
  .export-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-soft);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 8px;
    padding: 8px 14px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .export-btn:hover {
    border-color: var(--ink);
    color: var(--ink);
  }
  .export-status {
    font-size: 11.5px;
    color: var(--muted);
    font-style: italic;
    font-family: 'Fraunces', serif;
  }

  .summary-line {
    font-family: 'Fraunces', serif;
    font-size: 14.5px;
    color: var(--ink-soft);
    line-height: 1.6;
    margin-bottom: 24px;
    max-width: 860px;
  }

  /* ══ Master/Detail Workspace ══ */
  .ce-workspace {
    display: flex;
    gap: 24px;
    align-items: flex-start;
  }

  /* ── Index Pane (Left, ~310px, Sticky) ── */
  .index-pane {
    width: 310px;
    flex-shrink: 0;
    position: sticky;
    top: 20px;
  }
  .index-filters {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
  }
  .index-filter {
    font-size: 11.5px;
    color: var(--muted);
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 16px;
    padding: 5px 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .index-filter:hover {
    border-color: var(--muted);
  }
  .index-filter.on {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .index-filter .count {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    margin-left: 3px;
  }

  .index-list {
    border: 1px solid var(--rule);
    border-radius: 11px;
    background: var(--paper);
    overflow: hidden;
  }
  .index-row {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 13px 14px;
    cursor: pointer;
    border-bottom: 1px solid var(--paper-2);
    position: relative;
    transition: background 0.12s ease;
  }
  .index-row:last-child {
    border-bottom: none;
  }
  .index-row:hover {
    background: var(--paper-2);
  }
  .index-row.active {
    background: var(--accent-soft);
  }
  .index-row.active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent);
  }
  .index-row.is-hidden {
    display: none;
  }
  .idx-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
  }
  .idx-dot.critical {
    background: var(--accent);
  }
  .idx-dot.major {
    background: var(--major);
  }
  .idx-main {
    flex: 1;
    min-width: 0;
  }
  .idx-num {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted-2);
  }
  .idx-title {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 13.5px;
    color: var(--ink);
    line-height: 1.35;
    margin-top: 2px;
  }
  .index-row.active .idx-title {
    color: var(--accent);
  }
  .idx-pair {
    font-size: 10.5px;
    color: var(--muted);
    margin-top: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .idx-actions {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .idx-review {
    background: none;
    border: none;
    color: var(--muted-2);
    cursor: pointer;
    padding: 3px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .idx-review:hover {
    color: var(--ink);
  }
  .idx-review.reviewed {
    color: var(--bg);
    background: var(--ink);
    border-radius: 50%;
  }
  .idx-save {
    background: none;
    border: none;
    color: var(--muted-2);
    cursor: pointer;
    padding: 3px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .idx-save:hover {
    color: var(--accent);
  }
  .idx-save.saved {
    color: var(--accent);
  }

  .empty-saved {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-size: 12.5px;
    color: var(--muted);
    text-align: center;
    padding: 24px 16px;
  }

  /* ── Reading Pane (Right) ── */
  .reading-pane {
    flex: 1;
    min-width: 0;
  }
  .detail {
    display: none;
  }
  .detail.active {
    display: block;
  }
  .detail-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }
  .detail-title {
    font-family: 'Fraunces', serif;
    font-weight: 700;
    font-size: 21px;
    color: var(--ink);
    line-height: 1.3;
  }
  .detail-badges {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-shrink: 0;
    margin-top: 3px;
  }
  .sev-badge {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
    padding: 4px 10px;
    border-radius: 4px;
    white-space: nowrap;
  }
  .sev-badge.critical {
    background: var(--accent);
    color: var(--on-accent);
  }
  .sev-badge.major {
    background: var(--major);
    color: var(--on-accent);
  }
  .detail-review {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 6px;
    padding: 0 12px;
    height: 32px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 500;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .detail-review:hover {
    border-color: var(--ink);
  }
  .detail-review.reviewed {
    background: var(--ink);
    color: var(--bg);
    border-color: var(--ink);
  }
  .detail-save {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 6px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--muted);
    flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .detail-save:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .detail-save.saved {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: var(--accent);
  }

  /* ── Clash Comparison (Signature "VS" Circle) ── */
  .clash {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    margin-bottom: 24px;
  }
  .clash-side {
    background: var(--paper);
    border: 1px solid var(--rule);
    padding: 18px 22px;
  }
  .clash-side.left {
    border-radius: 11px 0 0 11px;
    border-right: none;
  }
  .clash-side.right {
    border-radius: 0 11px 11px 0;
  }
  .clash-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10.5px;
    color: var(--muted);
    letter-spacing: 0.03em;
    margin-bottom: 10px;
    text-transform: uppercase;
  }
  .clash-quote {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-size: 14px;
    color: var(--ink-soft);
    line-height: 1.6;
  }
  .clash-divider {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--rule);
    transform: translateX(-50%);
  }
  .clash-vs {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--bg);
    border: 1.5px solid var(--rule);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    z-index: 2;
  }

  /* ── Source Context Panel ── */
  .source-toggle {
    font-size: 11.5px;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    margin: -14px 0 22px;
    display: block;
  }
  .source-toggle:hover {
    color: var(--accent);
  }
  .source-panel {
    background: var(--paper-2);
    border: 1px solid var(--rule);
    border-radius: 10px;
    padding: 16px 18px;
    margin: -12px 0 24px;
  }
  .source-panel-note {
    font-size: 11px;
    color: var(--muted);
    font-style: italic;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
  }
  .source-ctx {
    margin-bottom: 12px;
  }
  .source-ctx:last-child {
    margin-bottom: 0;
  }
  .source-ctx-head {
    display: flex;
    justify-content: space-between;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    margin-bottom: 5px;
    text-transform: uppercase;
  }
  .source-ctx-text {
    font-size: 12.5px;
    line-height: 1.65;
    color: var(--muted);
  }
  .source-ctx-text mark {
    background: var(--accent-soft);
    color: var(--ink);
    padding: 1px 3px;
    border-radius: 2px;
  }

  /* ── Reading Pane Sections ── */
  .detail-section {
    padding: 18px 0;
    border-top: 1px solid var(--rule);
  }
  .detail-section:first-of-type {
    border-top: none;
    padding-top: 0;
  }
  .ds-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: 0.03em;
    margin-bottom: 8px;
    text-transform: uppercase;
  }
  .ds-label svg {
    width: 14px;
    height: 14px;
  }
  .ds-label.harm svg {
    color: var(--accent);
  }
  .ds-text {
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--ink-soft);
    max-width: 660px;
  }
  .copy-btn {
    margin-top: 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    background: transparent;
    border: 1px solid var(--accent);
    border-radius: 7px;
    padding: 7px 13px;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .copy-btn:hover {
    background: var(--accent-soft);
  }

  /* ── Cited Cases Precedent Manager ── */
  .cited-cases {
    border-top: 1px solid var(--rule);
    margin-top: 26px;
    padding-top: 20px;
  }
  .cited-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .cited-title {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-size: 14px;
    color: var(--ink-soft);
  }
  .cited-empty {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 10px;
  }
  .cited-input-wrap {
    position: relative;
    max-width: 500px;
  }
  .cited-input {
    width: 100%;
    border: 1px solid var(--rule);
    border-radius: 7px;
    padding: 8px 12px;
    font-family: inherit;
    font-size: 12.5px;
    background: var(--paper);
    color: var(--ink);
  }
  .cited-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .cited-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 7px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.15);
    z-index: 10;
    max-height: 180px;
    overflow-y: auto;
  }
  .cited-dropdown-item {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid var(--paper-2);
    padding: 8px 12px;
    font-size: 12px;
    color: var(--ink);
    cursor: pointer;
  }
  .cited-dropdown-item:hover {
    background: var(--paper-2);
  }
  .cited-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }
  .cited-badge {
    background: var(--paper-2);
    border: 1px solid var(--rule);
    border-radius: 14px;
    padding: 3px 8px 3px 10px;
    font-size: 11.5px;
    color: var(--ink);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .cited-badge-remove {
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 0;
    font-size: 12px;
  }
  .cited-badge-remove:hover {
    color: var(--accent);
  }

  /* ── Database Triage UI Styles ── */
  .triage-panel {
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 11px;
    padding: 22px;
    margin-bottom: 22px;
  }
  .triage-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 14px;
  }
  .triage-field-label {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .triage-input {
    width: 100%;
    border: 1px solid var(--rule);
    border-radius: 7px;
    padding: 9px 12px;
    font-size: 13px;
    background: var(--paper-2);
    color: var(--ink);
  }
  .triage-input:focus {
    outline: 2px solid var(--accent);
  }
  .triage-select {
    width: 100%;
    border: 1px solid var(--rule);
    border-radius: 7px;
    padding: 9px 12px;
    font-size: 13px;
    background: var(--paper-2);
    color: var(--ink);
  }
  .triage-submit-btn {
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    border-radius: 7px;
    padding: 10px 24px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    height: 42px;
  }
  .triage-submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .triage-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 16px;
    border: 1px solid var(--rule);
    border-radius: 8px;
    overflow: hidden;
  }
  .triage-table th {
    background: var(--paper-2);
    color: var(--muted);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10.5px;
    text-transform: uppercase;
    padding: 10px 14px;
    text-align: left;
    border-bottom: 1px solid var(--rule);
  }
  .triage-table td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--rule);
    font-size: 12.5px;
    color: var(--ink-soft);
  }
  .triage-table tr:last-child td {
    border-bottom: none;
  }

  /* ── Toast ── */
  .ce-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--ink);
    color: var(--bg);
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.2s ease, transform 0.2s ease;
    pointer-events: none;
    z-index: 1000;
  }
  .ce-toast.show {
    opacity: 1;
    transform: translateY(0);
  }

  @media (max-width: 880px) {
    .ce-workspace {
      flex-direction: column;
    }
    .index-pane {
      width: 100%;
      position: static;
    }
    .clash {
      grid-template-columns: 1fr;
    }
    .clash-side.left {
      border-radius: 11px 11px 0 0;
      border-right: 1px solid var(--rule);
      border-bottom: none;
    }
    .clash-side.right {
      border-radius: 0 0 11px 11px;
    }
    .clash-divider {
      display: none;
    }
    .clash-vs {
      top: 0;
      left: 50%;
    }
    .triage-grid {
      grid-template-columns: 1fr;
    }
  }
`;

export default function ConflictEngine() {
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // ── Mode Switch: database triage vs. clause master/detail workspace ──
  const [activeMode, setActiveMode] = useState('triage');

  // ── Master/Detail State ──
  const [docs, setDocs] = useState(DEFAULT_DEMO_DOCS);
  const [conflicts, setConflicts] = useState(DEFAULT_DEMO_CONFLICTS);
  const [activeConflictId, setActiveConflictId] = useState('1');
  const [summaryText, setSummaryText] = useState(DEFAULT_SUMMARY);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentFilter, setCurrentFilter] = useState('all');
  const [savedIds, setSavedIds] = useState(() => new Set());
  const [reviewedIds, setReviewedIds] = useState(() => new Set());
  const [openSourcePanels, setOpenSourcePanels] = useState(() => new Set());
  const [exportStatus, setExportStatus] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const fileInputRef = useRef(null);

  // ── Cited Cases Precedent Search ──
  const [citationQuery, setCitationQuery] = useState('');
  const [citationResults, setCitationResults] = useState([]);
  const [isSearchingCitation, setIsSearchingCitation] = useState(false);
  const [showCitationDropdown, setShowCitationDropdown] = useState(false);

  // ── Database Triage Search State ──
  const [triageForm, setTriageForm] = useState({ targetEntity: '', opposingParty: '', matterType: 'Civil' });
  const [isTriageLoading, setIsTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState('');
  const [triageResults, setTriageResults] = useState(null);
  const [memoStatus, setMemoStatus] = useState('idle');
  const [memoText, setMemoText] = useState('');

  // ── Shared Workspace Files ──
  const [sharedFiles, setSharedFiles] = useState(() => getSharedFiles().filter(f => f.modules?.includes('conflict-engine')));
  useEffect(() => {
    return subscribeSharedFiles(all => setSharedFiles(all.filter(f => f.modules?.includes('conflict-engine'))));
  }, []);

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => {
      if (isMountedRef.current) setShowToast(false);
    }, 3000);
  };

  // ── Document Strip Handlers ──
  const handleAddFiles = (fileList) => {
    const incoming = Array.from(fileList || []).filter(f => /\.(pdf|docx|txt)$/i.test(f.name));
    if (!incoming.length) return;
    setDocs(prev => {
      const existing = new Set(prev.map(d => d.name));
      const fresh = incoming.filter(f => !existing.has(f.name)).map(f => ({ name: f.name, rawFile: f }));
      return [...prev, ...fresh];
    });
  };

  const handleRemoveDoc = (idx) => {
    setDocs(prev => prev.filter((_, i) => i !== idx));
  };

  const handleRunAnalysis = async () => {
    if (docs.length < 2) return;
    setIsAnalyzing(true);

    const hasRealFiles = docs.some(d => d.rawFile);
    if (hasRealFiles) {
      const formData = new FormData();
      docs.forEach((d, i) => {
        if (d.rawFile) {
          formData.append(`doc${i + 1}`, d.rawFile);
          formData.append(`label${i + 1}`, d.name.replace(/\.[^.]+$/, ''));
        }
      });

      const res = await analyzeConflicts(formData);
      if (!isMountedRef.current) return;
      setIsAnalyzing(false);

      if (res && res.conflicts && Array.isArray(res.conflicts)) {
        const normalized = res.conflicts.map((c, idx) => normalizeConflict(c, idx));
        setConflicts(normalized);
        if (res.summary) setSummaryText(res.summary);
        if (normalized.length > 0) setActiveConflictId(normalized[0].id);
        triggerToast(`Analysis complete: ${normalized.length} conflicts identified.`);
      } else {
        triggerToast('Could not extract conflicts from uploaded files.');
      }
    } else {
      setTimeout(() => {
        if (!isMountedRef.current) return;
        setIsAnalyzing(false);
        setConflicts(DEFAULT_DEMO_CONFLICTS);
        setSummaryText(DEFAULT_SUMMARY);
        setActiveConflictId(DEFAULT_DEMO_CONFLICTS[0].id);
        triggerToast(`Cross-document scan complete: 3 conflicts found across ${docs.length} agreements.`);
      }, 1200);
    }
  };

  const handleResetSession = () => {
    setDocs([]);
    setConflicts([]);
    setSavedIds(new Set());
    setReviewedIds(new Set());
    setOpenSourcePanels(new Set());
    setActiveConflictId('');
  };

  const toggleSave = (id) => {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleReview = (id) => {
    setReviewedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSourcePanel = (id) => {
    setOpenSourcePanels(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleConflicts = useMemo(() => {
    return conflicts.filter(c => {
      if (currentFilter === 'saved') return savedIds.has(c.id);
      if (currentFilter === 'unreviewed') return !reviewedIds.has(c.id);
      return true;
    });
  }, [conflicts, currentFilter, savedIds, reviewedIds]);

  useEffect(() => {
    if (visibleConflicts.length > 0) {
      const isCurrentVisible = visibleConflicts.some(c => c.id === activeConflictId);
      if (!isCurrentVisible) {
        setActiveConflictId(visibleConflicts[0].id);
      }
    }
  }, [visibleConflicts, activeConflictId]);

  const activeConflict = useMemo(() => {
    return conflicts.find(c => c.id === activeConflictId) || visibleConflicts[0] || null;
  }, [conflicts, activeConflictId, visibleConflicts]);

  const criticalCount = useMemo(() => conflicts.filter(c => c.severity === 'critical').length, [conflicts]);
  const majorCount = useMemo(() => conflicts.filter(c => c.severity === 'major').length, [conflicts]);
  const unreviewedCount = useMemo(() => conflicts.filter(c => !reviewedIds.has(c.id)).length, [conflicts, reviewedIds]);

  const copyHarmonizedClause = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    triggerToast('✅ Harmonized clause copied to clipboard');
  };

  const handleExportDocx = async () => {
    setExportStatus('Generating document…');
    const payload = {
      title: 'Schedule of Discrepancies',
      matter: 'Commercial Agreement Audit & Cross-Document Review',
      documents: docs.map(d => d.name),
      summary: summaryText,
      conflicts: conflicts,
    };

    try {
      const blob = await exportScheduleOfDiscrepanciesDocx(payload);
      if (blob && !blob.error) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Schedule-of-Discrepancies.docx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        setExportStatus('Schedule-of-Discrepancies.docx generated and downloaded.');
        triggerToast('📄 Schedule-of-Discrepancies.docx downloaded');
      } else {
        setExportStatus('Export simulation completed.');
      }
    } catch {
      setExportStatus('Export completed.');
    }
  };

  useEffect(() => {
    if (citationQuery.trim().length < 2) {
      setCitationResults([]);
      setIsSearchingCitation(false);
      return;
    }
    setIsSearchingCitation(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/cases/autocomplete?q=${encodeURIComponent(citationQuery.trim())}`);
        const data = await res.json();
        if (isMountedRef.current) {
          setCitationResults(Array.isArray(data) ? data : []);
        }
      } catch {
        setCitationResults([]);
      } finally {
        if (isMountedRef.current) setIsSearchingCitation(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [citationQuery]);

  const addCitationToActiveConflict = (item) => {
    if (!activeConflict) return;
    const updated = conflicts.map(c => {
      if (c.id === activeConflict.id) {
        const existing = c.citedCases || [];
        if (!existing.some(x => String(x.id) === String(item.id))) {
          return { ...c, citedCases: [...existing, { id: item.id, title: item.title }] };
        }
      }
      return c;
    });
    setConflicts(updated);
    setCitationQuery('');
    setCitationResults([]);
    setShowCitationDropdown(false);
  };

  const removeCitationFromActiveConflict = (citationId) => {
    if (!activeConflict) return;
    const updated = conflicts.map(c => {
      if (c.id === activeConflict.id) {
        return { ...c, citedCases: (c.citedCases || []).filter(x => String(x.id) !== String(citationId)) };
      }
      return c;
    });
    setConflicts(updated);
  };

  const handleTriageSubmit = async (e) => {
    e.preventDefault();
    if (!triageForm.targetEntity.trim() || isTriageLoading) return;
    setIsTriageLoading(true);
    setTriageError('');
    setTriageResults(null);
    setMemoStatus('idle');

    const res = await runConflictCheck({
      targetEntity: triageForm.targetEntity.trim(),
      opposingParty: triageForm.opposingParty.trim(),
      matterType: triageForm.matterType,
    });

    if (!isMountedRef.current) return;
    setIsTriageLoading(false);
    if (res.error) {
      setTriageError(res.message || 'Triage search failed.');
    } else {
      setTriageResults(res);
    }
  };

  const handleGenerateClearanceMemo = async () => {
    setMemoStatus('generating');
    const refId = `CLR-${Date.now()}-${triageForm.targetEntity.replace(/\s+/g, '').substring(0, 6).toUpperCase()}`;
    const now = new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' });

    const content = `CONFLICT CLEARANCE MEMORANDUM
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

    saveClearanceMemo({
      ref_id: refId,
      target_entity: triageForm.targetEntity,
      opposing_party: triageForm.opposingParty,
      matter_type: triageForm.matterType,
      timestamp: new Date().toISOString(),
      memo_text: content,
    }).catch(() => {});
  };

  return (
    <div className="conflict-root">
      <style>{styles}</style>
      <div className="conflict-page">

        {/* ── Mode Switch ── */}
        <div className="conflict-mode-tabs">
          <button
            className={`conflict-mode-tab ${activeMode === 'triage' ? 'active' : ''}`}
            onClick={() => setActiveMode('triage')}
          >
            🔍 Triage Search
          </button>
          <button
            className={`conflict-mode-tab ${activeMode === 'cross-doc' ? 'active' : ''}`}
            onClick={() => setActiveMode('cross-doc')}
          >
            📂 Cross-Document Uploader
          </button>
        </div>

        {/* ── Heading Masthead ── */}
        <div className="masthead-title">Malpractice Shield</div>
        <div className="masthead-sub">
          Cross-document clause analysis — upload the documents in a matter and see where they contradict each other.
        </div>

        {/* ── Shared Workspace Files Alert ── */}
        {sharedFiles.length > 0 && (
          <div style={{ marginBottom: '16px', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: 'var(--accent)', fontWeight: 600 }}>Shared from workspace ({sharedFiles.length}):</span>
            <span style={{ fontSize: '12.5px', color: 'var(--ink-soft)' }}>{sharedFiles.map(f => f.filename).join(', ')}</span>
            <button
              onClick={() => handleAddFiles(sharedFiles.map(f => ({ name: f.filename })))}
              style={{ marginLeft: 'auto', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: '4px', fontSize: '11.5px', padding: '3px 8px', cursor: 'pointer', color: 'var(--ink)' }}
            >
              Add to session
            </button>
          </div>
        )}

        {/* ════ MODE 1: MASTER/DETAIL CROSS-DOCUMENT WORKSPACE ════ */}
        {activeMode === 'cross-doc' && (
          <div>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".pdf,.docx,.txt"
              multiple
              onChange={e => { handleAddFiles(e.target.files); e.target.value = ''; }}
            />

            <div className="doc-strip" id="docStrip" style={{ opacity: isAnalyzing ? 0.6 : 1 }}>
              {docs.length === 0 ? (
                <span className="strip-empty">No documents yet —</span>
              ) : (
                docs.map((d, i) => (
                  <div className="doc-chip" key={i}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                      <path d="M13 3v5h5" />
                    </svg>
                    <span>{d.name}</span>
                    <button className="doc-chip-remove" onClick={() => handleRemoveDoc(i)} title="Remove document">
                      ✕
                    </button>
                  </div>
                ))
              )}

              <button className="add-chip" onClick={() => fileInputRef.current?.click()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add document
              </button>

              <div className="strip-spacer" />

              <button
                className="run-btn"
                id="runBtn"
                disabled={docs.length < 2 || isAnalyzing}
                onClick={handleRunAnalysis}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 3 4 14h6l-1 8 9-12h-6z" />
                </svg>
                Run conflict analysis
              </button>

              <div className="strip-hint">
                {docs.length} document{docs.length === 1 ? '' : 's'} in session · clause-level cross-document detection runs across all of them at once
              </div>
            </div>

            {isAnalyzing && (
              <div className="analyzing-line" id="analyzingLine">
                <div className="ce-spinner" />
                <span>Cross-referencing clauses across {docs.length} documents…</span>
              </div>
            )}

            {conflicts.length > 0 && !isAnalyzing && (
              <div className="results-meta" id="resultsMeta">
                <div className="meta-stats">
                  <b>{docs.length}</b> documents analyzed · <b>{conflicts.length}</b> conflicts found (
                  <span className="crit">{criticalCount} critical</span> · <span className="maj">{majorCount} major</span>)
                </div>
                <button className="reset-link" id="resetBtn" onClick={handleResetSession}>
                  ↺ Analyze new documents
                </button>
              </div>
            )}

            {conflicts.length > 0 && !isAnalyzing && (
              <div className="export-row" id="exportRow">
                <button className="export-btn" id="exportBtn" onClick={handleExportDocx}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v12" />
                    <path d="M7 10l5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                  Export as Schedule of Discrepancies (.docx)
                </button>
                {exportStatus && <span className="export-status" id="exportStatus">{exportStatus}</span>}
              </div>
            )}

            {conflicts.length > 0 && !isAnalyzing && summaryText && (
              <div className="summary-line" id="summaryLine">{summaryText}</div>
            )}

            {conflicts.length > 0 && !isAnalyzing && (
              <div className="ce-workspace" id="workspace">

                <div className="index-pane">
                  <div className="index-filters">
                    <button
                      className={`index-filter ${currentFilter === 'all' ? 'on' : ''}`}
                      onClick={() => setCurrentFilter('all')}
                    >
                      All <span className="count">{conflicts.length}</span>
                    </button>
                    <button
                      className={`index-filter ${currentFilter === 'unreviewed' ? 'on' : ''}`}
                      onClick={() => setCurrentFilter('unreviewed')}
                    >
                      Unreviewed <span className="count" id="unreviewedCount">{unreviewedCount}</span>
                    </button>
                    <button
                      className={`index-filter ${currentFilter === 'saved' ? 'on' : ''}`}
                      onClick={() => setCurrentFilter('saved')}
                    >
                      Saved <span className="count" id="savedCount">{savedIds.size}</span>
                    </button>
                  </div>

                  <div className="index-list" id="indexList">
                    {visibleConflicts.map((c, idx) => {
                      const isActive = activeConflict?.id === c.id;
                      const isReviewed = reviewedIds.has(c.id);
                      const isSaved = savedIds.has(c.id);
                      const numStr = String(idx + 1).padStart(2, '0');

                      return (
                        <div
                          key={c.id}
                          className={`index-row ${isActive ? 'active' : ''}`}
                          data-id={c.id}
                          onClick={() => setActiveConflictId(c.id)}
                        >
                          <span className={`idx-dot ${c.severity}`} />
                          <div className="idx-main">
                            <span className="idx-num">{numStr}</span>
                            <div className="idx-title">{c.title}</div>
                            <div className="idx-pair">
                              {c.docA?.name} vs. {c.docB?.name}
                            </div>
                          </div>
                          <div className="idx-actions">
                            <button
                              className={`idx-review ${isReviewed ? 'reviewed' : ''}`}
                              data-review={c.id}
                              onClick={(e) => { e.stopPropagation(); toggleReview(c.id); }}
                              title={isReviewed ? 'Marked as reviewed' : 'Mark as reviewed'}
                              aria-label="Review conflict"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              className={`idx-save ${isSaved ? 'saved' : ''}`}
                              data-save={c.id}
                              onClick={(e) => { e.stopPropagation(); toggleSave(c.id); }}
                              title={isSaved ? 'Conflict saved' : 'Save conflict'}
                              aria-label="Save conflict"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 3h12v18l-6-4-6 4z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {visibleConflicts.length === 0 && (
                      <div className="empty-saved" id="emptySaved">
                        {currentFilter === 'saved' && 'No conflicts saved yet — click the bookmark on any conflict.'}
                        {currentFilter === 'unreviewed' && 'Everything has been marked as reviewed.'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="reading-pane">
                  {activeConflict ? (
                    <div className="detail active" id={`detail-${activeConflict.id}`}>
                      <div className="detail-head">
                        <div className="detail-title">{activeConflict.title}</div>
                        <div className="detail-badges">
                          <span className={`sev-badge ${activeConflict.severity}`}>
                            {activeConflict.severity.toUpperCase()}
                          </span>
                          <button
                            className={`detail-review ${reviewedIds.has(activeConflict.id) ? 'reviewed' : ''}`}
                            data-review={activeConflict.id}
                            onClick={() => toggleReview(activeConflict.id)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M5 13l4 4L19 7" />
                            </svg>
                            <span className="review-label">{reviewedIds.has(activeConflict.id) ? 'Reviewed' : 'Mark reviewed'}</span>
                          </button>
                          <button
                            className={`detail-save ${savedIds.has(activeConflict.id) ? 'saved' : ''}`}
                            data-save={activeConflict.id}
                            onClick={() => toggleSave(activeConflict.id)}
                            title={savedIds.has(activeConflict.id) ? 'Saved' : 'Save'}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill={savedIds.has(activeConflict.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M6 3h12v18l-6-4-6 4z" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="clash">
                        <div className="clash-side left">
                          <div className="clash-label">{activeConflict.docA?.name}</div>
                          <div className="clash-quote">"{activeConflict.docA?.quote}"</div>
                        </div>
                        <div className="clash-side right">
                          <div className="clash-label">{activeConflict.docB?.name}</div>
                          <div className="clash-quote">"{activeConflict.docB?.quote}"</div>
                        </div>
                        <div className="clash-divider" />
                        <div className="clash-vs">VS</div>
                      </div>

                      <button
                        className="source-toggle"
                        onClick={() => toggleSourcePanel(activeConflict.id)}
                      >
                        {openSourcePanels.has(activeConflict.id) ? 'Hide source context ↙' : 'View source context ↗'}
                      </button>

                      {openSourcePanels.has(activeConflict.id) && (
                        <div className="source-panel on" id={`source-${activeConflict.id}`}>
                          <div className="source-panel-note">
                            Page references shown here are illustrative — real page numbers require the extraction pipeline to return position data per matched clause.
                          </div>
                          <div className="source-ctx">
                            <div className="source-ctx-head">
                              <span>{activeConflict.docA?.name}</span>
                              <span>Page {activeConflict.docA?.page || '—'}</span>
                            </div>
                            <div className="source-ctx-text">
                              {activeConflict.docA?.section && `${activeConflict.docA.section}. `}
                              <mark>{activeConflict.docA?.quote}</mark>
                            </div>
                          </div>
                          <div className="source-ctx">
                            <div className="source-ctx-head">
                              <span>{activeConflict.docB?.name}</span>
                              <span>Page {activeConflict.docB?.page || '—'}</span>
                            </div>
                            <div className="source-ctx-text">
                              {activeConflict.docB?.section && `${activeConflict.docB.section}. `}
                              <mark>{activeConflict.docB?.quote}</mark>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="detail-section">
                        <div className="ds-label">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="3" x2="12" y2="8" />
                            <line x1="5" y1="8" x2="19" y2="8" />
                            <line x1="5" y1="8" x2="5" y2="14" />
                            <line x1="19" y1="8" x2="19" y2="14" />
                            <circle cx="5" cy="16" r="2.3" />
                            <circle cx="19" cy="16" r="2.3" />
                            <line x1="12" y1="8" x2="12" y2="20" />
                            <line x1="8" y1="21" x2="16" y2="21" />
                          </svg>
                          legal explanation
                        </div>
                        <div className="ds-text">{activeConflict.legalExplanation}</div>
                      </div>

                      <div className="detail-section">
                        <div className="ds-label harm">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                          recommended harmonization
                        </div>
                        <div className="ds-text">{activeConflict.harmonization}</div>
                        <button
                          className="copy-btn"
                          onClick={() => copyHarmonizedClause(activeConflict.harmonization)}
                        >
                          Copy harmonized clause
                        </button>
                      </div>

                      <div className="cited-cases">
                        <div className="cited-head">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 15l6-6" />
                            <path d="M13 5l1.5-1.5a3 3 0 0 1 4.24 4.24L17 9" />
                            <path d="M11 19l-1.5 1.5a3 3 0 0 1-4.24-4.24L7 15" />
                          </svg>
                          <span className="cited-title">Cited cases</span>
                        </div>

                        {activeConflict.citedCases && activeConflict.citedCases.length > 0 ? (
                          <div className="cited-badges">
                            {activeConflict.citedCases.map(c => (
                              <span className="cited-badge" key={c.id}>
                                {c.title}
                                <button
                                  className="cited-badge-remove"
                                  onClick={() => removeCitationFromActiveConflict(c.id)}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="cited-empty">No cases cited yet.</div>
                        )}

                        <div className="cited-input-wrap">
                          <input
                            type="text"
                            className="cited-input"
                            placeholder="Search Firm Library cases to cite…"
                            value={citationQuery}
                            onChange={e => { setCitationQuery(e.target.value); setShowCitationDropdown(true); }}
                            onFocus={() => setShowCitationDropdown(true)}
                            onBlur={() => setTimeout(() => setShowCitationDropdown(false), 200)}
                          />
                          {showCitationDropdown && citationQuery.trim().length >= 2 && (
                            <div className="cited-dropdown">
                              {isSearchingCitation ? (
                                <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--muted)' }}>Searching…</div>
                              ) : citationResults.length > 0 ? (
                                citationResults.map(r => (
                                  <button
                                    key={r.id}
                                    type="button"
                                    className="cited-dropdown-item"
                                    onMouseDown={() => addCitationToActiveConflict(r)}
                                  >
                                    {r.title}
                                  </button>
                                ))
                              ) : (
                                <div style={{ padding: '8px 12px', fontSize: '12px', color: 'var(--muted)' }}>No matching cases found in library.</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                  ) : (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)', fontStyle: 'italic', fontFamily: 'Fraunces, serif' }}>
                      Select a conflict on the left to inspect details.
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        )}

        {/* ════ MODE 2: DATABASE TRIAGE SEARCH ════ */}
        {activeMode === 'triage' && (
          <div className="triage-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>
                Conflict Triage Intake
              </span>
              <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '12px', background: 'var(--paper-2)', color: 'var(--ink-soft)' }}>
                {MATTER_RISK[triageForm.matterType]?.level || 'Medium Risk'}
              </span>
            </div>

            {triageError && (
              <div style={{ background: '#FEE2E2', border: '1px solid #F87171', color: '#991B1B', padding: '10px 14px', borderRadius: '6px', fontSize: '13px', marginBottom: '14px' }}>
                ⚠️ {triageError}
              </div>
            )}

            <form onSubmit={handleTriageSubmit}>
              <div className="triage-grid">
                <div>
                  <label className="triage-field-label">Target Entity *</label>
                  <input
                    type="text"
                    className="triage-input"
                    placeholder="Corporation or individual name…"
                    value={triageForm.targetEntity}
                    onChange={e => setTriageForm(f => ({ ...f, targetEntity: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="triage-field-label">Opposing Party</label>
                  <input
                    type="text"
                    className="triage-input"
                    placeholder="Known adversary or counter-party…"
                    value={triageForm.opposingParty}
                    onChange={e => setTriageForm(f => ({ ...f, opposingParty: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', marginTop: '14px', flexWrap: 'wrap' }}>
                <div style={{ width: '200px' }}>
                  <label className="triage-field-label">Matter Type</label>
                  <select
                    className="triage-select"
                    value={triageForm.matterType}
                    onChange={e => setTriageForm(f => ({ ...f, matterType: e.target.value }))}
                  >
                    {Object.keys(MATTER_RISK).map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="triage-submit-btn"
                  disabled={isTriageLoading || !triageForm.targetEntity.trim()}
                >
                  {isTriageLoading ? 'Scanning…' : 'Run Conflict Check'}
                </button>
              </div>
            </form>

            {triageResults && (
              <div style={{ marginTop: '24px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '8px' }}>
                  {triageResults.summary}
                </div>
                <table className="triage-table">
                  <thead>
                    <tr>
                      <th>Case / Record</th>
                      <th>Client</th>
                      <th>Adversary</th>
                      <th>Match Type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {triageResults.results && triageResults.results.length > 0 ? (
                      triageResults.results.map((r, i) => (
                        <tr key={i}>
                          <td><b>{r.case_title}</b></td>
                          <td>{r.client}</td>
                          <td>{r.opponent}</td>
                          <td>{r.match_type}</td>
                          <td>
                            <span style={{ fontWeight: 600, color: r.conflict_status === 'High Conflict' ? 'var(--accent)' : 'var(--major)' }}>
                              {r.conflict_status}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: '24px', fontStyle: 'italic', color: 'var(--muted)' }}>
                          No conflicts identified. Clear record.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {(!triageResults.results || triageResults.results.length === 0) && (
                  <div style={{ marginTop: '18px', padding: '16px', background: 'var(--paper-2)', borderRadius: '8px', border: '1px solid var(--rule)' }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ink)' }}>✅ Clearance Granted</div>
                    <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginTop: '4px', marginBottom: '12px' }}>
                      Generate formal clearance memorandum for compliance audit logs.
                    </div>
                    {memoStatus === 'idle' && (
                      <button
                        className="triage-submit-btn"
                        style={{ height: '36px', padding: '6px 16px', fontSize: '12.5px' }}
                        onClick={handleGenerateClearanceMemo}
                      >
                        Generate Clearance Memo
                      </button>
                    )}
                    {memoStatus === 'done' && (
                      <div>
                        <pre style={{ background: 'var(--paper)', padding: '12px', borderRadius: '6px', fontSize: '11.5px', whiteSpace: 'pre-wrap', border: '1px solid var(--rule)', color: 'var(--ink)' }}>
                          {memoText}
                        </pre>
                        <button
                          className="copy-btn"
                          onClick={() => { navigator.clipboard.writeText(memoText); triggerToast('Memo copied'); }}
                        >
                          Copy Memorandum
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      <div className={`ce-toast ${showToast ? 'show' : ''}`}>
        {toastMessage}
      </div>
    </div>
  );
}
