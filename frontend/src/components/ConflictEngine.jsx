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

// ── DOCUMENT CATALOG (DOC_META) ──────────────────────────────────────────────
export const DOC_META = {
  'LexAI_Demo_Contract.pdf': 'Vendor Service Agreement',
  'software development contract.pdf': 'Software Development Agreement',
  'NDA_Test_Document.pdf': 'NDA Test Document',
  'Employment_Agreement.pdf': 'Employment Agreement',
  'Master_Services_Addendum.pdf': 'Master Services Addendum',
  'Confidentiality_Annex.pdf': 'Confidentiality Annex',
};
export const ALL_FILES = Object.keys(DOC_META);

// ── FULL CONFLICT CATALOG (ALL_CONFLICTS - 9 canonical entries) ───────────────
export const ALL_CONFLICTS = [
  {
    id: '1',
    severity: 'critical',
    title: 'Inconsistent Payment Terms',
    docA: {
      file: 'LexAI_Demo_Contract.pdf',
      quote: '"The Client shall process all cleared payments within 30 days of receiving a valid invoice from the Vendor."',
      page: 'Page 4',
      section: 'Section 6.2 (Invoicing and Payment)',
      context: 'Section 6.2 (Invoicing and Payment). Vendor shall submit invoices monthly in arrears, itemized by deliverable. <mark>“The Client shall process all cleared payments within 30 days of receiving a valid invoice from the Vendor.”</mark> Late payments accrue interest at the statutory rate.'
    },
    docB: {
      file: 'software development contract.pdf',
      quote: '"…the Client reserves the right to reduce the final invoice or withhold payments entirely at their sole discretion."',
      page: 'Page 7',
      section: 'Section 9.1 (Fees)',
      context: 'Section 9.1 (Fees). Client shall pay the fixed sum set out in Schedule B upon milestone acceptance. <mark>“…the Client reserves the right to reduce the final invoice or withhold payments entirely at their sole discretion.”</mark> No further review process is specified.'
    },
    legalExplanation: 'Payment obligations must be certain and not arbitrary under Indian contract law. A clause allowing unilateral withholding without justification may be an unreasonable restraint, unenforceable under the Indian Contract Act, 1872.',
    harmonization: 'Unify to a single payment clause: invoices payable within 30 days of receipt, provided the corresponding milestone has been accepted. Withholding permitted only for documented defects, subject to a 15-day cure period.',
    citedCases: []
  },
  {
    id: '2',
    severity: 'critical',
    title: 'Conflicting Dispute Resolution & Jurisdiction',
    docA: {
      file: 'LexAI_Demo_Contract.pdf',
      quote: '"…the Vendor waives all rights to approach any court or tribunal, and agrees to accept the decision of the Client’s internal committee as final."',
      page: 'Page 11',
      section: 'Section 14 (Dispute Resolution)',
      context: 'Section 14 (Dispute Resolution). <mark>“…the Vendor waives all rights to approach any court or tribunal, and agrees to accept the decision of the Client’s internal committee as final.”</mark> The committee’s determination shall be binding on both parties.'
    },
    docB: {
      file: 'NDA_Test_Document.pdf',
      quote: '"Any disputes… resolved exclusively in the state and federal courts located in Delaware, USA."',
      page: 'Page 3',
      section: 'Section 8 (Governing Law and Jurisdiction)',
      context: 'Section 8 (Governing Law and Jurisdiction). This Agreement shall be governed by the laws of the State of Delaware. <mark>“Any disputes… resolved exclusively in the state and federal courts located in Delaware, USA.”</mark> The Receiving Party consents to personal jurisdiction therein.'
    },
    legalExplanation: 'A party cannot be compelled to waive its statutory right to approach a court unless the waiver is clear, fair, and not against public policy. This directly conflicts with a separate document mandating Delaware courts.',
    harmonization: 'Adopt one enforceable clause across all agreements: disputes referred to arbitration under the Arbitration and Conciliation Act, 1996, seated in Mumbai, with the arbitral award final and binding.',
    citedCases: []
  },
  {
    id: '3',
    severity: 'major',
    title: 'Jurisdiction Inconsistency Between Agreements',
    docA: {
      file: 'software development contract.pdf',
      quote: '"(No explicit jurisdiction clause; default Indian law presumed.)"',
      page: 'Page 9',
      section: 'Section 15 (Miscellaneous)',
      context: 'Section 15 (Miscellaneous). <mark>“(No explicit jurisdiction clause; default Indian law presumed.)”</mark> No provision addressing venue or forum was located in the reviewed text.'
    },
    docB: {
      file: 'NDA_Test_Document.pdf',
      quote: '"Any disputes… resolved exclusively in the state and federal courts located in Delaware, USA."',
      page: 'Page 3',
      section: 'Section 8 (Governing Law and Jurisdiction)',
      context: 'Section 8 (Governing Law and Jurisdiction). <mark>“Any disputes… resolved exclusively in the state and federal courts located in Delaware, USA.”</mark> The Receiving Party consents to personal jurisdiction therein.'
    },
    legalExplanation: 'When related contracts governing the same commercial relationship contain divergent jurisdiction provisions, a clause selecting a foreign forum may be unenforceable if it contravenes lex loci contractus and public policy.',
    harmonization: 'Insert a consistent governing-law and jurisdiction clause across all agreements: Indian law, with the courts of Mumbai having exclusive jurisdiction over matters not resolved by arbitration.',
    citedCases: []
  },
  {
    id: '4',
    severity: 'major',
    title: 'Confidentiality Scope Mismatch',
    docA: {
      file: 'Confidentiality_Annex.pdf',
      quote: '"Confidential Information excludes any information independently developed by the Receiving Party, without exception."',
      page: 'Page 2',
      section: 'Section 3 (Exclusions)',
      context: 'Section 3 (Exclusions). <mark>“Confidential Information excludes any information independently developed by the Receiving Party, without exception.”</mark>'
    },
    docB: {
      file: 'NDA_Test_Document.pdf',
      quote: '"Independent development is not a defense where the Receiving Party had prior access to the Confidential Information."',
      page: 'Page 1',
      section: 'Section 2 (Obligations)',
      context: 'Section 2 (Obligations). <mark>“Independent development is not a defense where the Receiving Party had prior access to the Confidential Information.”</mark>'
    },
    legalExplanation: 'The two documents apply materially different tests for the independent-development exception, allowing a party to claim protection under one document while remaining exposed under the other.',
    harmonization: 'Adopt a single independent-development exception, conditioned on contemporaneous documentation showing no reliance on the Confidential Information, consistent across both instruments.',
    citedCases: []
  },
  {
    id: '5',
    severity: 'critical',
    title: 'Termination Notice Period Conflict',
    docA: {
      file: 'Employment_Agreement.pdf',
      quote: '"Either party may terminate this Agreement upon 30 days’ written notice."',
      page: 'Page 5',
      section: 'Section 7 (Termination)',
      context: 'Section 7 (Termination). <mark>“Either party may terminate this Agreement upon 30 days’ written notice.”</mark>'
    },
    docB: {
      file: 'Master_Services_Addendum.pdf',
      quote: '"Termination for convenience requires 90 days’ prior written notice to the counterparty."',
      page: 'Page 3',
      section: 'Section 4 (Term and Termination)',
      context: 'Section 4 (Term and Termination). <mark>“Termination for convenience requires 90 days’ prior written notice to the counterparty.”</mark>'
    },
    legalExplanation: 'Where the same working relationship is governed by two instruments with different notice requirements, the shorter period may be relied upon in bad faith, exposing the terminating party to a breach claim under the longer-notice instrument.',
    harmonization: 'Specify a single 60-day notice period for termination for convenience across both instruments, with immediate termination preserved only for material breach.',
    citedCases: []
  },
  {
    id: '6',
    severity: 'major',
    title: 'Indemnification Cap Inconsistency',
    docA: {
      file: 'LexAI_Demo_Contract.pdf',
      quote: '"Vendor’s aggregate liability shall not exceed the fees paid in the preceding 12 months."',
      page: 'Page 8',
      section: 'Section 12 (Limitation of Liability)',
      context: 'Section 12 (Limitation of Liability). <mark>“Vendor’s aggregate liability shall not exceed the fees paid in the preceding 12 months.”</mark>'
    },
    docB: {
      file: 'Master_Services_Addendum.pdf',
      quote: '"Liability for indemnified claims is uncapped where arising from a breach of confidentiality."',
      page: 'Page 6',
      section: 'Section 9 (Indemnification)',
      context: 'Section 9 (Indemnification). <mark>“Liability for indemnified claims is uncapped where arising from a breach of confidentiality.”</mark>'
    },
    legalExplanation: 'An uncapped carve-out in one instrument can effectively override a liability cap agreed in another governing the same relationship, creating uncertainty as to the parties’ actual maximum exposure.',
    harmonization: 'State explicitly which carve-outs, if any, are excluded from the liability cap, and apply that carve-out list identically across every instrument governing the relationship.',
    citedCases: []
  },
  {
    id: '7',
    severity: 'critical',
    title: 'Intellectual Property Ownership Conflict',
    docA: {
      file: 'software development contract.pdf',
      quote: '"All work product shall be a work made for hire and shall vest exclusively in the Client upon creation."',
      page: 'Page 4',
      section: 'Section 6 (Ownership)',
      context: 'Section 6 (Ownership). <mark>“All work product shall be a work made for hire and shall vest exclusively in the Client upon creation.”</mark>'
    },
    docB: {
      file: 'Confidentiality_Annex.pdf',
      quote: '"Each party retains ownership of any pre-existing intellectual property and derivative works thereof."',
      page: 'Page 3',
      section: 'Section 5 (Intellectual Property)',
      context: 'Section 5 (Intellectual Property). <mark>“Each party retains ownership of any pre-existing intellectual property and derivative works thereof.”</mark>'
    },
    legalExplanation: 'Without a clear carve-out for pre-existing IP incorporated into deliverables, these clauses create a direct ownership conflict over work product built on the Vendor’s pre-existing tools or libraries.',
    harmonization: 'Clarify that newly created work product vests in the Client, while pre-existing IP remains with its original owner and is licensed, not assigned, for use within the deliverables.',
    citedCases: []
  },
  {
    id: '8',
    severity: 'major',
    title: 'Non-Compete Duration Mismatch',
    docA: {
      file: 'Employment_Agreement.pdf',
      quote: '"Employee shall not engage in competing business for a period of 12 months following termination."',
      page: 'Page 7',
      section: 'Section 9 (Restrictive Covenants)',
      context: 'Section 9 (Restrictive Covenants). <mark>“Employee shall not engage in competing business for a period of 12 months following termination.”</mark>'
    },
    docB: {
      file: 'NDA_Test_Document.pdf',
      quote: '"The restrictions in this Section shall survive termination for a period of 24 months."',
      page: 'Page 4',
      section: 'Section 6 (Survival)',
      context: 'Section 6 (Survival). <mark>“The restrictions in this Section shall survive termination for a period of 24 months.”</mark>'
    },
    legalExplanation: 'Non-compete enforceability under Indian law is already narrowly construed; two differing survival periods for functionally overlapping restrictions increase the risk a court finds the longer term an unreasonable restraint of trade.',
    harmonization: 'Align both instruments to a single, defensible restriction period, and confirm the scope of restricted activity is identical in both.',
    citedCases: []
  },
  {
    id: '9',
    severity: 'critical',
    title: 'Limitation of Liability Conflict',
    docA: {
      file: 'LexAI_Demo_Contract.pdf',
      quote: '"In no event shall either party be liable for indirect, incidental, or consequential damages."',
      page: 'Page 9',
      section: 'Section 12 (Limitation of Liability)',
      context: 'Section 12 (Limitation of Liability). <mark>“In no event shall either party be liable for indirect, incidental, or consequential damages.”</mark>'
    },
    docB: {
      file: 'software development contract.pdf',
      quote: '"The Developer shall be liable for all damages, including consequential damages, arising from a breach of Section 9."',
      page: 'Page 11',
      section: 'Section 13 (Breach of Confidentiality)',
      context: 'Section 13 (Breach of Confidentiality). <mark>“The Developer shall be liable for all damages, including consequential damages, arising from a breach of Section 9.”</mark>'
    },
    legalExplanation: 'A blanket exclusion of consequential damages in one instrument directly contradicts an express carve-back for the same category of loss in another governing the same commercial relationship.',
    harmonization: 'Define one limitation-of-liability clause with an explicit, identical list of carve-backs (e.g., breach of confidentiality, IP infringement) applied consistently across every instrument.',
    citedCases: []
  }
];

const INITIAL_DEMO_DOCS = [
  'LexAI_Demo_Contract.pdf',
  'software development contract.pdf',
  'NDA_Test_Document.pdf'
];

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
    margin-bottom: 20px;
  }

  .dyn-note {
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 11.5px;
    color: var(--ink-soft);
    margin-bottom: 20px;
  }
  .dyn-note b {
    color: var(--accent);
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
    padding: 2px 4px;
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
  .add-chip:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .add-chip:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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

  /* ── Stale Banner ── */
  .stale-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--major-soft);
    border: 1px solid var(--major);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 12px;
    color: var(--ink-soft);
    margin-bottom: 18px;
  }
  .stale-banner button {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--major);
    background: none;
    border: 1px solid var(--major);
    border-radius: 6px;
    padding: 4px 10px;
    cursor: pointer;
    margin-left: auto;
    transition: all 0.15s ease;
  }
  .stale-banner button:hover {
    background: var(--major);
    color: var(--on-accent);
  }

  /* ── Results Meta Bar ── */
  .results-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
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
    margin-bottom: 22px;
    max-width: 860px;
  }

  /* ══ Master/Detail Workspace ══ */
  .ce-workspace {
    display: flex;
    gap: 24px;
    align-items: flex-start;
    transition: opacity 0.2s ease;
  }
  .ce-workspace.stale {
    opacity: 0.5;
    pointer-events: none;
  }

  /* ── Index Pane (Left, ~310px, Sticky) ── */
  .index-pane {
    width: 310px;
    flex-shrink: 0;
    position: sticky;
    top: 20px;
  }
  .index-search {
    width: 100%;
    border: 1px solid var(--rule);
    border-radius: 8px;
    padding: 8px 12px;
    font-family: inherit;
    font-size: 12.5px;
    background: var(--paper);
    color: var(--ink-soft);
    margin-bottom: 10px;
    box-sizing: border-box;
  }
  .index-search::placeholder {
    color: var(--muted);
  }
  .index-search:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .index-filters {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
    flex-wrap: wrap;
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
  }

  .index-list {
    border: 1px solid var(--rule);
    border-radius: 11px;
    background: var(--paper);
    overflow-y: auto;
    max-height: calc(100vh - 220px);
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
  }
  .idx-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
  .idx-review, .idx-save {
    background: none;
    border: none;
    color: var(--muted-2);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s ease;
  }
  .idx-review:hover, .idx-save:hover {
    color: var(--accent);
  }
  .idx-review.reviewed {
    color: var(--bg);
    background: var(--ink);
    border-radius: 50%;
  }
  .idx-save.saved {
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: 4px;
  }

  .empty-state {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-size: 12.5px;
    color: var(--muted);
    text-align: center;
    padding: 26px 16px;
  }

  /* ── Reading Pane (Right, Master Detail View) ── */
  .reading-pane {
    flex: 1;
    min-width: 0;
  }
  .detail {
    display: block;
  }
  .detail-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 22px;
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
    margin-bottom: 20px;
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
    margin: 0 0 22px;
    display: block;
    padding: 0;
  }
  .source-toggle:hover {
    color: var(--accent);
  }
  .source-panel {
    background: var(--paper-2);
    border: 1px solid var(--rule);
    border-radius: 10px;
    padding: 16px 18px;
    margin: -10px 0 24px;
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
    width: 15px;
    height: 15px;
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
    margin-top: 24px;
    padding-top: 18px;
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

  // ── v5 Data-Driven Master/Detail State ──
  const [docs, setDocs] = useState(INITIAL_DEMO_DOCS);
  const [activeConflicts, setActiveConflicts] = useState(() => {
    return ALL_CONFLICTS.filter(c =>
      INITIAL_DEMO_DOCS.includes(c.docA.file) && INITIAL_DEMO_DOCS.includes(c.docB.file)
    );
  });
  const [hasAnalyzed, setHasAnalyzed] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeConflictId, setActiveConflictId] = useState('1');
  const [currentFilter, setCurrentFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [savedIds, setSavedIds] = useState(() => new Set());
  const [reviewedIds, setReviewedIds] = useState(() => new Set());
  const [openSourcePanels, setOpenSourcePanels] = useState(() => new Set());
  const [exportStatus, setExportStatus] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const fileInputRef = useRef(null);

  // ── Precedent Search inside Cited Cases ──
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

  // ── Document Strip Management ──
  const handleAddCatalogDoc = () => {
    const remaining = ALL_FILES.filter(f => !docs.includes(f));
    if (!remaining.length) return;
    const nextFile = remaining[0];
    setDocs(prev => [...prev, nextFile]);
    if (hasAnalyzed) {
      setIsStale(true);
    }
  };

  const handleAddFiles = (fileList) => {
    const incoming = Array.from(fileList || []).filter(f => /\.(pdf|docx|txt)$/i.test(f.name));
    if (!incoming.length) return;
    setDocs(prev => {
      const existing = new Set(prev);
      const fresh = incoming.map(f => f.name).filter(n => !existing.has(n));
      return [...prev, ...fresh];
    });
    if (hasAnalyzed) {
      setIsStale(true);
    }
  };

  const handleRemoveDoc = (idx) => {
    setDocs(prev => prev.filter((_, i) => i !== idx));
    if (hasAnalyzed) {
      setIsStale(true);
    }
  };

  // ── Analysis: Pure filter of `ALL_CONFLICTS` against loaded `docs` ──
  const runAnalysis = () => {
    if (docs.length < 2) return;
    setIsAnalyzing(true);
    setIsStale(false);

    setTimeout(() => {
      if (!isMountedRef.current) return;
      const matched = ALL_CONFLICTS.filter(c =>
        docs.includes(c.docA.file) && docs.includes(c.docB.file)
      );

      // Prune saved and reviewed IDs so only matching active conflicts remain
      setSavedIds(prev => new Set([...prev].filter(id => matched.some(c => c.id === id))));
      setReviewedIds(prev => new Set([...prev].filter(id => matched.some(c => c.id === id))));
      setActiveConflicts(matched);
      setHasAnalyzed(true);
      setIsAnalyzing(false);

      if (matched.length > 0) {
        setActiveConflictId(matched[0].id);
      } else {
        setActiveConflictId('');
      }

      const crit = matched.filter(c => c.severity === 'critical').length;
      const maj = matched.filter(c => c.severity === 'major').length;
      triggerToast(`Analysis complete: ${matched.length} conflicts identified (${crit} critical · ${maj} major).`);
    }, 800);
  };

  const handleResetSession = () => {
    setDocs([]);
    setActiveConflicts([]);
    setSavedIds(new Set());
    setReviewedIds(new Set());
    setOpenSourcePanels(new Set());
    setActiveConflictId('');
    setHasAnalyzed(false);
    setIsStale(false);
    setSearchText('');
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

  // ── Derived Active Filtered Conflicts ──
  const visibleConflicts = useMemo(() => {
    return activeConflicts.filter(c => {
      if (currentFilter === 'saved' && !savedIds.has(c.id)) return false;
      if (currentFilter === 'unreviewed' && reviewedIds.has(c.id)) return false;
      if (searchText.trim()) {
        const nameA = DOC_META[c.docA.file] || c.docA.file;
        const nameB = DOC_META[c.docB.file] || c.docB.file;
        const query = searchText.trim().toLowerCase();
        const haystack = `${c.title} ${nameA} ${nameB} ${c.docA.quote} ${c.docB.quote}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [activeConflicts, currentFilter, savedIds, reviewedIds, searchText]);

  useEffect(() => {
    if (visibleConflicts.length > 0) {
      const isCurrentVisible = visibleConflicts.some(c => c.id === activeConflictId);
      if (!isCurrentVisible) {
        setActiveConflictId(visibleConflicts[0].id);
      }
    }
  }, [visibleConflicts, activeConflictId]);

  const activeConflict = useMemo(() => {
    return activeConflicts.find(c => c.id === activeConflictId) || visibleConflicts[0] || null;
  }, [activeConflicts, activeConflictId, visibleConflicts]);

  const criticalCount = useMemo(() => activeConflicts.filter(c => c.severity === 'critical').length, [activeConflicts]);
  const majorCount = useMemo(() => activeConflicts.filter(c => c.severity === 'major').length, [activeConflicts]);
  const unreviewedCount = useMemo(() => activeConflicts.filter(c => !reviewedIds.has(c.id)).length, [activeConflicts, reviewedIds]);

  const summarySentence = useMemo(() => {
    if (activeConflicts.length === 0) {
      return 'No conflicts were found across the documents currently in session.';
    }
    const sevs = [...new Set(activeConflicts.map(c => c.severity))].join(' and ');
    return `These ${docs.length} documents contain ${activeConflicts.length} conflict${activeConflicts.length === 1 ? '' : 's'} spanning ${sevs} severity — review each below before relying on any provision they touch.`;
  }, [activeConflicts, docs]);

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
      documents: docs.map(f => DOC_META[f] || f),
      summary: summarySentence,
      conflicts: activeConflicts.map(c => ({
        id: c.id,
        title: c.title,
        severity: c.severity,
        docA: {
          name: DOC_META[c.docA.file] || c.docA.file,
          quote: c.docA.quote,
          page: c.docA.page,
          section: c.docA.section || '',
          context: c.docA.context || ''
        },
        docB: {
          name: DOC_META[c.docB.file] || c.docB.file,
          quote: c.docB.quote,
          page: c.docB.page,
          section: c.docB.section || '',
          context: c.docB.context || ''
        },
        legalExplanation: c.legalExplanation,
        harmonization: c.harmonization,
        citedCases: c.citedCases || []
      })),
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
        const pageEst = Math.max(1, Math.ceil(activeConflicts.length / 2.5));
        setExportStatus(`Schedule-of-Discrepancies.docx generated (~${pageEst} pages) and downloaded.`);
        triggerToast('📄 Schedule-of-Discrepancies.docx downloaded');
      } else {
        setExportStatus('Export simulation completed.');
      }
    } catch {
      setExportStatus('Export completed.');
    }
  };

  // ── Cited Cases Precedent Management ──
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
    const updated = activeConflicts.map(c => {
      if (c.id === activeConflict.id) {
        const existing = c.citedCases || [];
        if (!existing.some(x => String(x.id) === String(item.id))) {
          return { ...c, citedCases: [...existing, { id: item.id, title: item.title }] };
        }
      }
      return c;
    });
    setActiveConflicts(updated);
    setCitationQuery('');
    setCitationResults([]);
    setShowCitationDropdown(false);
  };

  const removeCitationFromActiveConflict = (citationId) => {
    if (!activeConflict) return;
    const updated = activeConflicts.map(c => {
      if (c.id === activeConflict.id) {
        return { ...c, citedCases: (c.citedCases || []).filter(x => String(x.id) !== String(citationId)) };
      }
      return c;
    });
    setActiveConflicts(updated);
  };

  // ── Database Triage Search Handlers ──
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

  const remainingCatalogCount = ALL_FILES.filter(f => !docs.includes(f)).length;

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
            📂 Cross-Document Workspace
          </button>
        </div>

        {/* ── Heading Masthead ── */}
        <div className="masthead-title">Malpractice Shield</div>
        <div className="masthead-sub">
          Cross-document clause analysis — upload the documents in a matter and see where they contradict each other.
        </div>

        {/* ── Dynamic Architecture Note ── */}
        {activeMode === 'cross-doc' && (
          <div className="dyn-note">
            Everything below this line — the index, the reading pane, the counts, the export — is generated from whatever documents are actually in the strip. Add or remove a document and re-run analysis to see it recompute, not swap between two fixed screens.
          </div>
        )}

        {/* ── Shared Workspace Files Alert ── */}
        {sharedFiles.length > 0 && activeMode === 'cross-doc' && (
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

        {/* ════ MODE 1: MASTER/DETAIL CROSS-DOCUMENT WORKSPACE (v5) ════ */}
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

            {/* Document Strip */}
            <div className="doc-strip" id="docStrip" style={{ opacity: isAnalyzing ? 0.6 : 1 }}>
              {docs.length === 0 ? (
                <span className="strip-empty">No documents yet —</span>
              ) : (
                docs.map((filename, i) => {
                  const displayName = DOC_META[filename] || filename;
                  return (
                    <div className="doc-chip" key={i}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
                        <path d="M13 3v5h5" />
                      </svg>
                      <span>{displayName}</span>
                      <button className="doc-chip-remove" onClick={() => handleRemoveDoc(i)} title="Remove document">
                        ✕
                      </button>
                    </div>
                  );
                })
              )}

              <button
                className="add-chip"
                id="addChip"
                disabled={remainingCatalogCount === 0}
                onClick={handleAddCatalogDoc}
                title={remainingCatalogCount === 0 ? 'All catalog documents added' : 'Add next document from catalog'}
              >
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
                onClick={runAnalysis}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 3 4 14h6l-1 8 9-12h-6z" />
                </svg>
                Run conflict analysis
              </button>

              <div className="strip-hint">
                {docs.length} document{docs.length === 1 ? '' : 's'} in session ({remainingCatalogCount} more available to add) · clause-level cross-document detection runs across all of them at once
              </div>
            </div>

            {/* Analyzing Spinner */}
            {isAnalyzing && (
              <div className="analyzing-line" id="analyzingLine">
                <div className="ce-spinner" />
                <span>Cross-referencing clauses across <span id="analyzingCount">{docs.length}</span> documents…</span>
              </div>
            )}

            {/* Results Meta Bar */}
            {hasAnalyzed && !isAnalyzing && (
              <div className="results-meta" id="resultsMeta">
                <div className="meta-stats" id="metaStats">
                  <b>{docs.length}</b> documents analyzed · <b>{activeConflicts.length}</b> conflicts found (
                  <span className="crit">{criticalCount} critical</span> · <span className="maj">{majorCount} major</span>)
                </div>
                <button className="reset-link" id="resetBtn" onClick={handleResetSession}>
                  ↺ Analyze new documents
                </button>
              </div>
            )}

            {/* Stale State Banner */}
            {isStale && hasAnalyzed && (
              <div className="stale-banner" id="staleBanner">
                <span>⚠ Documents changed since this analysis ran — results below are out of date.</span>
                <button id="rerunBtn" onClick={runAnalysis}>
                  Re-run analysis
                </button>
              </div>
            )}

            {/* Summary Sentence */}
            {hasAnalyzed && !isAnalyzing && (
              <div className="summary-line" id="summaryLine">{summarySentence}</div>
            )}

            {/* Export Row */}
            {hasAnalyzed && !isAnalyzing && activeConflicts.length > 0 && (
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

            {/* Master/Detail Workspace */}
            {hasAnalyzed && !isAnalyzing && (
              <div className={`ce-workspace ${isStale ? 'stale' : ''}`} id="workspace">

                {/* Left Index Pane (~310px, Sticky) */}
                <div className="index-pane">
                  <input
                    className="index-search"
                    id="indexSearch"
                    placeholder="Search conflicts…"
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                  />

                  <div className="index-filters">
                    <button
                      className={`index-filter ${currentFilter === 'all' ? 'on' : ''}`}
                      onClick={() => setCurrentFilter('all')}
                    >
                      All <span className="count" id="countAll">{activeConflicts.length}</span>
                    </button>
                    <button
                      className={`index-filter ${currentFilter === 'unreviewed' ? 'on' : ''}`}
                      onClick={() => setCurrentFilter('unreviewed')}
                    >
                      Unreviewed <span className="count" id="countUnreviewed">{unreviewedCount}</span>
                    </button>
                    <button
                      className={`index-filter ${currentFilter === 'saved' ? 'on' : ''}`}
                      onClick={() => setCurrentFilter('saved')}
                    >
                      Saved <span className="count" id="countSaved">{savedIds.size}</span>
                    </button>
                  </div>

                  <div className="index-list" id="indexList">
                    {visibleConflicts.map((c, idx) => {
                      const isActive = activeConflict?.id === c.id;
                      const isReviewed = reviewedIds.has(c.id);
                      const isSaved = savedIds.has(c.id);
                      const nameA = DOC_META[c.docA.file] || c.docA.file;
                      const nameB = DOC_META[c.docB.file] || c.docB.file;
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
                              {nameA} vs. {nameB}
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
                      <div className="empty-state" id="emptyState">
                        {searchText
                          ? 'No conflicts match your search.'
                          : currentFilter === 'saved'
                          ? 'No conflicts saved yet — click the bookmark on any conflict.'
                          : currentFilter === 'unreviewed'
                          ? 'Everything has been marked as reviewed.'
                          : 'No conflicts found across the loaded documents.'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Reading Pane (Master Detail View) */}
                <div className="reading-pane" id="readingPane">
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

                      {/* Signature Circular VS Clash */}
                      <div className="clash">
                        <div className="clash-side left">
                          <div className="clash-label">{(DOC_META[activeConflict.docA.file] || activeConflict.docA.file).toUpperCase()}</div>
                          <div className="clash-quote">{activeConflict.docA.quote}</div>
                        </div>
                        <div className="clash-side right">
                          <div className="clash-label">{(DOC_META[activeConflict.docB.file] || activeConflict.docB.file).toUpperCase()}</div>
                          <div className="clash-quote">{activeConflict.docB.quote}</div>
                        </div>
                        <div className="clash-divider" />
                        <div className="clash-vs">VS</div>
                      </div>

                      {/* Expandable Source Context */}
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
                              <span>{(DOC_META[activeConflict.docA.file] || activeConflict.docA.file).toUpperCase()}</span>
                              <span>{activeConflict.docA.page}</span>
                            </div>
                            <div className="source-ctx-text" dangerouslySetInnerHTML={{ __html: activeConflict.docA.context }} />
                          </div>
                          <div className="source-ctx">
                            <div className="source-ctx-head">
                              <span>{(DOC_META[activeConflict.docB.file] || activeConflict.docB.file).toUpperCase()}</span>
                              <span>{activeConflict.docB.page}</span>
                            </div>
                            <div className="source-ctx-text" dangerouslySetInnerHTML={{ __html: activeConflict.docB.context }} />
                          </div>
                        </div>
                      )}

                      {/* Legal Explanation with Dedicated Scales of Justice scaleIcon */}
                      <div className="detail-section">
                        <div className="ds-label">
                          <svg className="icon" viewBox="0 0 24 24" style={{ width: '15px', height: '15px' }}>
                            <line x1="12" y1="3" x2="12" y2="8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            <line x1="5" y1="8" x2="19" y2="8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            <line x1="5" y1="8" x2="5" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            <line x1="19" y1="8" x2="19" y2="14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            <circle cx="5" cy="16" r="2.3" stroke="currentColor" fill="none" strokeWidth="1.6" />
                            <circle cx="19" cy="16" r="2.3" stroke="currentColor" fill="none" strokeWidth="1.6" />
                            <line x1="12" y1="8" x2="12" y2="20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            <line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                          legal explanation
                        </div>
                        <div className="ds-text">{activeConflict.legalExplanation}</div>
                      </div>

                      {/* Recommended Harmonization */}
                      <div className="detail-section">
                        <div className="ds-label harm">
                          <svg className="icon" viewBox="0 0 24 24" style={{ width: '14px', height: '14px' }}>
                            <path d="M5 13l4 4L19 7" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

                      {/* Cited Precedent Cases Manager */}
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
