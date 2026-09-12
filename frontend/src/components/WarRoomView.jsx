import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { uploadDocument } from '../services/api';
import { renderMarkdown, MARKDOWN_CSS } from '../utils/markdownUtils';

// ── Helpers ─────────────────────────────────────────────────────────────────

const renderParagraphs = (text) => {
  if (!text) return null;
  return text.split('\n').map((line, i, arr) => (
    <React.Fragment key={i}>{line}{i < arr.length - 1 && <br />}</React.Fragment>
  ));
};

const parseIssues = (text) => {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const numbered = lines.filter(l => /^\d+[\.\):]/.test(l));
  if (numbered.length >= 2) return numbered.map(l => l.replace(/^\d+[\.\):]\s*/, ''));
  // Fallback: split bullet lines or return as single block
  const bullets = lines.filter(l => /^[-•*]/.test(l));
  if (bullets.length >= 2) return bullets.map(l => l.replace(/^[-•*]\s*/, ''));
  return lines.filter(l => l.length > 20);
};

// ── Parse the |||REBUTTALS||| delimiter that the backend appends ─────────────

const parseRobotResponse = (raw) => {
  const DELIM = '|||REBUTTALS|||';
  const idx = raw.indexOf(DELIM);
  if (idx === -1) return { mainText: raw, rebuttals: [] };

  const mainText = raw.slice(0, idx).trim();
  const rebuttalRaw = raw.slice(idx + DELIM.length).trim();

  let rebuttals = [];
  try {
    // Extract first JSON array found (handles any trailing whitespace/newlines)
    const arrayMatch = rebuttalRaw.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        rebuttals = parsed
          .map(r => (typeof r === 'string' ? r : r?.text || ''))
          .filter(s => s.length > 5);
      }
    }
  } catch {
    // Fallback: treat each non-empty line after the delimiter as a rebuttal
    rebuttals = rebuttalRaw
      .split('\n')
      .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(l => l.length > 10);
  }

  return { mainText, rebuttals };
};

// ── Pipeline stages ──────────────────────────────────────────────────────────

// ── Benchmark Indian Legal Scenarios ─────────────────────────────────────────

const BENCHMARK_SCENARIOS = [
  {
    title: 'Special Leave Petition (Civil)',
    tag: 'Commercial Dispute',
    court: 'Supreme Court of India',
    icon: '⚖️',
    clientSide: 'Appellant',
    summary: 'Arbitration clause survival post-unilateral termination and liquidated damages under ICA §§ 73–74.',
    content: `SPECIAL LEAVE PETITION (CIVIL) NO. 4102 OF 2024
IN THE SUPREME COURT OF INDIA
CIVIL APPELLATE JURISDICTION

BETWEEN:
TECHNOVA INDUSTRIAL CORP. ... PETITIONER
VERSUS
UNION OF INDIA & ORS. ... RESPONDENTS

QUESTIONS OF LAW & MATTERS OF RECORD:
1. Whether an arbitration clause under Section 11 of the Arbitration and Conciliation Act, 1996 survives the unilateral termination of a concession agreement without mandatory cure notice.
2. Whether statutory claims under the Insolvency and Bankruptcy Code, 2016 override contractual pre-deposit requirements in public infrastructure projects.
3. Proper interpretation of Section 73 and Section 74 of the Indian Contract Act, 1872 regarding invocation of performance bank guarantees and liquidated damages without proof of actual legal injury.`,
  },
  {
    title: 'Interim Injunction Application (Order XXXIX)',
    tag: 'IP & Patent Litigation',
    court: 'High Court of Delhi',
    icon: '🛡️',
    clientSide: 'Plaintiff',
    summary: 'Restraining generic drug manufacturing under Section 48 Patents Act vs Section 3(d) efficacy defense.',
    content: `IN THE HIGH COURT OF DELHI AT NEW DELHI
I.A. NO. 8920 OF 2024 IN CS(COMM) NO. 312 OF 2024

IN THE MATTER OF:
NEXUS BIOTECH PHARMA LTD. ... PLAINTIFF
VERSUS
APEX GENERICS INDIA PVT. LTD. ... DEFENDANT

APPLICATION UNDER ORDER XXXIX RULES 1 & 2 CPC FOR INTERIM INJUNCTION:
1. Plaintiff seeks interlocutory injunction restraining defendant from manufacturing, marketing, and selling pharmaceutical formulations infringing Indian Patent No. IN389201 under Section 48 of the Patents Act, 1970.
2. Establishing the tripartite test: prima facie validity of patent claims, balance of convenience, and irreparable harm to patentee.
3. Opposing defenses of anticipation, obviousness under Section 64, and Section 3(d) therapeutic efficacy standards.`,
  },
  {
    title: 'Anticipatory Bail Application (BNSS § 482)',
    tag: 'Criminal Procedure',
    court: 'High Court of Bombay',
    icon: '⚡',
    clientSide: 'Applicant',
    summary: 'Pre-arrest protection against criminalization of contractual disputes under BNS §§ 316, 318(4).',
    content: `IN THE HIGH COURT OF JUDICATURE AT BOMBAY
CRIMINAL ANTICIPATORY BAIL APPLICATION NO. 1104 OF 2024

IN THE MATTER OF:
RAJESHWAR PRASAD VERMA ... APPLICANT
VERSUS
STATE OF MAHARASHTRA & ANR. ... RESPONDENTS

APPLICATION UNDER SECTION 482 OF BHARATIYA NAGARIK SURAKSHA SANHITA, 2023 (BNSS):
1. Applicant seeks pre-arrest protection in connection with FIR registered under Sections 316, 318(4), and 61(2) of Bharatiya Nyaya Sanhita, 2023 (BNS).
2. Pure commercial breach of contract improperly cloaked with criminal conspiracy in direct violation of Supreme Court precedents in Lalita Kumari and Arnesh Kumar.
3. Custodial interrogation is unwarranted; applicant has deep roots in society, undertakes to cooperate fully with the investigating agency, and will furnish solvent local sureties.`,
  },
];

const SIMULATION_CAPABILITIES = [
  {
    title: 'Bench Scrutiny',
    desc: 'Tests claims against authoritative Supreme Court and High Court precedents with judicial rigor.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    title: 'Vulnerability Audit',
    desc: 'Surfaces evidentiary gaps, contradictory statements, statutory limitations, and procedural bars.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    title: 'Transcript & Strategy',
    desc: 'Generates real-time rebuttal options, cross-examination counters, and courtroom argument transcripts.',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
];

// ── Styles ───────────────────────────────────────────────────────────────────

const WAR_ROOM_STYLES = `
${MARKDOWN_CSS}
  /* ── LITIGATION WAR ROOM HUB (FULL-WIDTH 2-COLUMN HUB) ────────── */
  .wr-hub-wrapper {
    min-height: calc(100vh - 64px);
    width: 100%;
    padding: 32px 36px 64px;
    box-sizing: border-box;
    background: transparent;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow-y: auto;
  }
  .wr-hub-container {
    max-width: 1380px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  .wr-hub-header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .wr-hub-category {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: var(--accent-primary, #3B82F6);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wr-hub-title {
    font-size: 28px;
    font-weight: 800;
    color: var(--text-primary, #F8FAFC);
    font-family: var(--font-serif, Georgia, serif);
    margin: 0;
    line-height: 1.2;
    letter-spacing: -0.4px;
  }
  .wr-hub-subtitle {
    font-size: 14px;
    color: var(--text-muted, #94A3B8);
    margin: 0;
    line-height: 1.6;
    max-width: 820px;
  }

  /* 12-Column Responsive Grid */
  .wr-hub-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: 24px;
    align-items: start;
    width: 100%;
  }

  @media (max-width: 1024px) {
    .wr-hub-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Card Surfaces */
  .wr-hub-card {
    background: var(--bg-panel, #171c26);
    border: 1px solid var(--border-subtle, #2C3241);
    border-radius: 14px;
    padding: 26px 28px;
    box-shadow: 0 12px 36px rgba(0,0,0,0.35);
    display: flex;
    flex-direction: column;
    gap: 20px;
    position: relative;
    overflow: hidden;
  }

  .wr-hub-card-header {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .wr-hub-badge-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(59,130,246,0.1);
    border: 1px solid rgba(59,130,246,0.25);
    color: #60A5FA;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .wr-hub-card-title {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary, #F8FAFC);
    margin: 0;
  }

  .wr-hub-card-subtitle {
    font-size: 12.5px;
    color: var(--text-muted, #94A3B8);
    margin: 2px 0 0;
  }

  /* Ingestion Dropzone */
  .wr-hub-dropzone {
    border: 2px dashed rgba(59,130,246,0.3);
    border-radius: 12px;
    padding: 32px 24px;
    text-align: center;
    cursor: pointer;
    background: rgba(59,130,246,0.02);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  .wr-hub-dropzone:hover {
    border-color: #3B82F6;
    background: rgba(59,130,246,0.06);
    transform: translateY(-1px);
  }
  .wr-hub-dropzone.drag-over {
    border-color: #60A5FA;
    background: rgba(59,130,246,0.12);
    transform: scale(1.01);
    box-shadow: 0 0 0 4px rgba(59,130,246,0.15);
  }
  .wr-hub-dropzone-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(59,130,246,0.1);
    border: 1px solid rgba(59,130,246,0.25);
    color: #3B82F6;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 2px;
    transition: transform 0.2s ease;
  }
  .wr-hub-dropzone:hover .wr-hub-dropzone-icon {
    transform: scale(1.08);
  }
  .wr-hub-dropzone-primary {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary, #F8FAFC);
  }
  .wr-hub-dropzone-secondary {
    font-size: 12px;
    color: var(--text-muted, #94A3B8);
  }

  /* Command Assistant Steps */
  .wr-hub-cmd-steps {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .wr-hub-cmd-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background: rgba(255,255,255,0.015);
    border: 1px solid var(--border-subtle, #2C3241);
    border-radius: 9px;
    padding: 12px 14px;
  }
  .wr-hub-cmd-num {
    font-size: 10.5px;
    font-weight: 800;
    color: #3B82F6;
    background: rgba(59,130,246,0.1);
    border: 1px solid rgba(59,130,246,0.25);
    border-radius: 6px;
    padding: 3px 6px;
    flex-shrink: 0;
  }
  .wr-hub-cmd-text {
    font-size: 12.5px;
    color: var(--text-muted, #94A3B8);
    line-height: 1.5;
  }
  .wr-hub-cmd-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(59,130,246,0.08);
    border: 1px solid rgba(59,130,246,0.22);
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 12px;
    font-family: monospace;
    color: #60A5FA;
    margin-top: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .wr-hub-cmd-chip:hover {
    background: rgba(59,130,246,0.15);
    border-color: #3B82F6;
    color: #93C5FD;
  }

  /* Actions Row */
  .wr-hub-actions-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .wr-hub-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 11px 22px;
    border-radius: 8px;
    background: #2563EB;
    color: #FFFFFF;
    font-size: 13.5px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: 0 4px 14px rgba(37,99,235,0.25);
  }
  .wr-hub-btn-primary:hover {
    background: #1D4ED8;
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(37,99,235,0.35);
  }
  .wr-hub-btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    border-radius: 8px;
    background: rgba(255,255,255,0.04);
    color: var(--text-primary, #E2E8F0);
    font-size: 13.5px;
    font-weight: 550;
    border: 1px solid var(--border-subtle, #2C3241);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .wr-hub-btn-secondary:hover {
    background: rgba(255,255,255,0.08);
    border-color: rgba(59,130,246,0.4);
    color: #FFFFFF;
  }

  /* Benchmark Demos Card */
  .wr-benchmark-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .wr-benchmark-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 16px;
    border-radius: 10px;
    background: rgba(59,130,246,0.03);
    border: 1px solid var(--border-subtle, #2C3241);
    border-left: 3px solid #3B82F6;
    cursor: pointer;
    transition: all 0.18s ease;
    text-align: left;
    position: relative;
  }
  .wr-benchmark-card:hover {
    background: rgba(59,130,246,0.08);
    border-color: #3B82F6;
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(59,130,246,0.15);
  }
  .wr-benchmark-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .wr-benchmark-title {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--text-primary, #F8FAFC);
  }
  .wr-benchmark-tag {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 7px;
    border-radius: 10px;
    background: rgba(59,130,246,0.12);
    color: #93C5FD;
    border: 1px solid rgba(59,130,246,0.25);
    flex-shrink: 0;
  }
  .wr-benchmark-court {
    font-size: 11.5px;
    color: var(--text-muted, #94A3B8);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Capabilities Card */
  .wr-cap-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .wr-cap-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .wr-cap-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: rgba(16,185,129,0.1);
    border: 1px solid rgba(16,185,129,0.25);
    color: #10B981;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .wr-cap-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary, #F8FAFC);
    margin-bottom: 2px;
  }
  .wr-cap-desc {
    font-size: 12px;
    color: var(--text-muted, #94A3B8);
    line-height: 1.5;
  }

  /* ── PIPELINE LOADING ──────────────────────────────────────────── */
  .wr-pipeline-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    height: calc(100vh - 64px);
  }
  .wr-pipeline-card {
    background: var(--bg-panel, #171c26);
    border: 1px solid var(--border-subtle, #2C3241);
    border-radius: 16px;
    padding: 44px 48px;
    max-width: 500px;
    width: 100%;
    box-shadow: 0 24px 64px rgba(0,0,0,0.45);
  }
  .wr-pipeline-gavel {
    font-size: 46px;
    display: block;
    text-align: center;
    margin-bottom: 20px;
    animation: wr-float 2.6s ease-in-out infinite;
  }
  @keyframes wr-float {
    0%,100% { transform: translateY(0);    filter: drop-shadow(0 4px 16px rgba(59,130,246,0.3)); }
    50%      { transform: translateY(-7px); filter: drop-shadow(0 12px 28px rgba(59,130,246,0.55)); }
  }
  .wr-pipeline-h { font-size: 20px; font-weight: 700; color: white; text-align: center; margin: 0 0 6px; }
  .wr-pipeline-sub { font-size: 13px; color: var(--text-muted, #8F9CAE); text-align: center; margin: 0 0 28px; line-height: 1.5; }
  .wr-stage-row {
    display: flex; align-items: center; gap: 12px;
    padding: 9px 12px; border-radius: 8px;
    transition: background 0.3s;
  }
  .wr-stage-row.active-row { background: rgba(59,130,246,0.06); }
  .wr-stage-dot {
    width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
    transition: background 0.4s, box-shadow 0.4s;
  }
  .wr-stage-dot.done    { background: #10B981; box-shadow: 0 0 6px rgba(16,185,129,0.6); }
  .wr-stage-dot.active  { background: #3B82F6; box-shadow: 0 0 9px rgba(59,130,246,0.7); animation: wr-dot-pulse 1.4s ease-in-out infinite; }
  .wr-stage-dot.pending { background: var(--border-subtle, #2C3241); }
  @keyframes wr-dot-pulse {
    0%,100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.45; transform: scale(0.75); }
  }
  .wr-stage-text { font-size: 12.5px; }
  .wr-stage-text.done    { color: #10B981; }
  .wr-stage-text.active  { color: white; font-weight: 600; }
  .wr-stage-text.pending { color: var(--text-muted, #8F9CAE); }

  /* ── RESULTS PAGE ──────────────────────────────────────────────── */
  .wr-results-page {
    height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: var(--font-sans);
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.5s cubic-bezier(0.16,1,0.3,1),
                transform 0.5s cubic-bezier(0.16,1,0.3,1);
  }
  .wr-results-page.wr-mounted { opacity: 1; transform: translateY(0); }

  /* ── RESULTS HEADER ────────────────────────────────────────────── */
  .wr-results-header {
    flex-shrink: 0;
    background: var(--bg-panel, #171c26);
    border-bottom: 1px solid var(--border-subtle, #2C3241);
    padding: 14px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .wr-results-title {
    font-size: 18px; font-weight: 700; color: white; margin: 0 0 2px;
    font-family: var(--font-serif, Georgia, serif);
  }
  .wr-results-subtitle { font-size: 12px; color: var(--text-muted, #8F9CAE); margin: 0; }
  .wr-header-badges { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .wr-badge-strategy {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 11px; border-radius: 20px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
    background: rgba(59,130,246,0.1); color: #93C5FD;
    border: 1px solid rgba(59,130,246,0.25);
  }
  .wr-badge-done {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 4px 11px; border-radius: 20px; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
    background: rgba(16,185,129,0.1); color: #10B981;
    border: 1px solid rgba(16,185,129,0.25);
  }
  .wr-badge-dot { width: 5px; height: 5px; border-radius: 50%; background: #10B981; box-shadow: 0 0 5px rgba(16,185,129,0.8); }
  .wr-new-sim-btn {
    padding: 6px 14px; border-radius: 7px; font-size: 12px; font-weight: 600;
    background: transparent; color: var(--text-muted, #8F9CAE);
    border: 1px solid var(--border-subtle, #2C3241);
    cursor: pointer; transition: all 0.15s; font-family: var(--font-sans);
  }
  .wr-new-sim-btn:hover { border-color: rgba(59,130,246,0.35); color: white; }

  /* ── SCROLLABLE BODY ───────────────────────────────────────────── */
  .wr-results-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 24px 28px 36px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    scrollbar-width: thin;
    scrollbar-color: var(--border-subtle) transparent;
  }
  .wr-results-body::-webkit-scrollbar { width: 5px; }
  .wr-results-body::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 3px; }

  /* ── ANIMATED SECTION WRAPPER ──────────────────────────────────── */
  .wr-section {
    opacity: 0;
    transform: translateY(18px);
    pointer-events: none;
    transition: opacity 0.55s cubic-bezier(0.16,1,0.3,1),
                transform 0.55s cubic-bezier(0.16,1,0.3,1);
  }
  .wr-section.wr-revealed {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }

  /* ── SHARED SECTION CARD ───────────────────────────────────────── */
  .wr-card {
    background: var(--bg-panel, #171c26);
    border: 1px solid var(--border-subtle, #2C3241);
    border-radius: 12px;
    overflow: hidden;
  }
  .wr-card-head {
    display: flex; align-items: center; gap: 10px;
    padding: 13px 20px;
    border-bottom: 1px solid var(--border-subtle, #2C3241);
    background: rgba(255,255,255,0.015);
  }
  .wr-roman {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 26px; height: 26px; border-radius: 6px;
    background: rgba(59,130,246,0.1);
    border: 1px solid rgba(59,130,246,0.2);
    font-size: 10px; font-weight: 800; color: #3B82F6; flex-shrink: 0;
    letter-spacing: 0.3px;
  }
  .wr-card-title {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.9px; color: var(--text-muted, #8F9CAE); margin: 0;
  }
  .wr-card-body { padding: 20px; }

  /* ── SECTION I — ISSUES ────────────────────────────────────────── */
  .wr-issues-list { display: flex; flex-direction: column; gap: 10px; }
  .wr-issue-row {
    display: flex; align-items: flex-start; gap: 12px;
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--border-subtle, #2C3241);
    border-radius: 8px; padding: 12px 14px;
  }
  .wr-issue-num {
    min-width: 22px; height: 22px; border-radius: 50%;
    background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.2);
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 800; color: #3B82F6;
    flex-shrink: 0; margin-top: 1px;
  }
  .wr-issue-text { font-size: 13.5px; color: white; line-height: 1.6; }

  /* ── SECTION II — CITATIONS ────────────────────────────────────── */
  .wr-cit-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .wr-cit-card {
    display: block; text-decoration: none;
    background: rgba(59,130,246,0.03);
    border: 1px solid var(--border-subtle, #2C3241);
    border-left: 3px solid #3B82F6;
    border-radius: 8px; padding: 14px 16px;
    transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
  }
  .wr-cit-card:hover {
    background: rgba(59,130,246,0.08);
    box-shadow: 0 4px 20px rgba(59,130,246,0.14);
    border-color: #3B82F6;
  }
  .wr-cit-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .wr-kanoon-badge {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
    padding: 2px 7px; border-radius: 10px;
    background: rgba(245,158,11,0.12); color: #F59E0B;
    border: 1px solid rgba(245,158,11,0.25);
  }
  .wr-cit-index { font-size: 10px; color: var(--text-muted, #8F9CAE); font-weight: 700; }
  .wr-cit-title { font-size: 13px; font-weight: 600; color: #3B82F6; line-height: 1.4; margin-bottom: 6px; }
  .wr-cit-snippet {
    font-size: 11.5px; color: var(--text-muted, #8F9CAE); line-height: 1.55; margin-bottom: 10px;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .wr-cit-link { font-size: 11px; color: var(--text-muted); font-weight: 500; letter-spacing: 0.2px; }
  .wr-cit-link:hover { color: #3B82F6; }
  .wr-no-cit {
    font-size: 13px; color: var(--text-muted, #8F9CAE); font-style: italic; padding: 8px 0;
  }

  /* ── SECTION III — OPENING ARGUMENT ───────────────────────────── */
  .wr-argument-doc {
    background: rgba(255,255,255,0.015);
    border: 1px solid var(--border-subtle, #2C3241);
    border-radius: 8px; padding: 28px 32px;
  }
  .wr-argument-text {
    font-family: var(--font-serif, Georgia, 'Times New Roman', serif);
    font-size: 15px; line-height: 1.9;
    color: var(--text-primary, white);
    white-space: pre-wrap;
  }
  [data-theme="light"] .wr-argument-text { color: #1a1a2e; }

  /* ── SECTION IV — RED TEAM ─────────────────────────────────────── */
  .wr-threats-list { display: flex; flex-direction: column; gap: 12px; }
  .wr-threat-card {
    border: 1px solid var(--border-subtle, #2C3241);
    border-left: 3px solid rgba(239,68,68,0.75);
    border-radius: 9px; overflow: hidden;
  }
  .wr-threat-card:hover { border-left-color: #EF4444; }
  .wr-threat-trigger {
    display: flex; align-items: flex-start;
    justify-content: space-between; gap: 12px;
    padding: 14px 18px; cursor: pointer; user-select: none;
    background: rgba(239,68,68,0.025);
    transition: background 0.15s;
  }
  .wr-threat-trigger:hover { background: rgba(239,68,68,0.05); }
  .wr-threat-tag {
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.8px; color: rgba(239,68,68,0.9); margin-bottom: 5px;
  }
  .wr-threat-q { font-size: 14px; font-weight: 600; color: white; line-height: 1.5; }
  .wr-chevron {
    color: var(--text-muted, #8F9CAE); flex-shrink: 0; margin-top: 3px;
    transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
  }
  .wr-chevron.open { transform: rotate(180deg); }
  .wr-rebuttal-panel {
    max-height: 0; overflow: hidden;
    transition: max-height 0.35s cubic-bezier(0.4,0,0.2,1);
  }
  .wr-rebuttal-panel.open { max-height: 600px; }
  .wr-rebuttal-inner {
    padding: 0 18px 16px;
    border-top: 1px solid var(--border-subtle, #2C3241);
  }
  .wr-rebuttal-label {
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.8px; color: #10B981; margin: 14px 0 8px;
  }
  .wr-rebuttal-body {
    font-size: 13px; color: #D1D5DB; line-height: 1.65;
    background: rgba(16,185,129,0.04);
    border-left: 2px solid #10B981;
    padding: 10px 14px; border-radius: 0 6px 6px 0;
  }
  .wr-use-rebuttal-btn {
    margin-top: 12px; display: inline-flex; align-items: center; gap: 7px;
    padding: 8px 16px; border-radius: 8px; cursor: pointer;
    font-size: 12px; font-weight: 700; font-family: var(--font-sans);
    letter-spacing: 0.3px;
    border: 1px solid rgba(16,185,129,0.4);
    background: rgba(16,185,129,0.08); color: #6EE7B7;
    transition: all 0.18s ease;
  }
  .wr-use-rebuttal-btn:hover {
    background: rgba(16,185,129,0.18);
    border-color: #10B981;
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(16,185,129,0.15);
  }
  .wr-use-rebuttal-btn:active { transform: translateY(0); }

  /* ── SECTION V — CHAT ──────────────────────────────────────────── */
  .wr-chat-outer { border: 1px solid var(--border-subtle, #2C3241); border-radius: 12px; overflow: hidden; }
  .wr-tone-bar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 12px 16px;
    background: rgba(255,255,255,0.015);
    border-bottom: 1px solid var(--border-subtle, #2C3241);
  }
  .wr-tone-label {
    font-size: 10.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.6px; color: var(--text-muted, #8F9CAE); flex-shrink: 0;
  }
  .wr-tone-btn {
    padding: 5px 14px; border-radius: 20px; font-size: 11.5px; font-weight: 600;
    cursor: pointer; transition: all 0.15s;
    border: 1px solid var(--border-subtle, #2C3241);
    background: transparent; color: var(--text-muted, #8F9CAE);
    font-family: var(--font-sans);
  }
  .wr-tone-btn:hover { color: white; }
  .wr-tone-btn.tone-agg {
    background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.3); color: #FCA5A5;
  }
  .wr-tone-btn.tone-def {
    background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.3); color: #6EE7B7;
  }
  .wr-chat-messages {
    min-height: 320px; max-height: 540px; overflow-y: auto;
    padding: 18px 16px; display: flex; flex-direction: column; gap: 12px;
    background: rgba(255,255,255,0.01);
    scrollbar-width: thin; scrollbar-color: var(--border-subtle) transparent;
  }
  .wr-chat-messages::-webkit-scrollbar { width: 4px; }
  .wr-chat-messages::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 2px; }
  .wr-bubble {
    max-width: 86%; padding: 13px 17px; border-radius: 14px;
    font-size: 14.5px; line-height: 1.72; letter-spacing: 0.01em;
  }
  .wr-bubble.user {
    align-self: flex-end; background: #2563EB; color: #EFF6FF;
    border-bottom-right-radius: 4px;
    box-shadow: 0 2px 12px rgba(37,99,235,0.25);
  }
  .wr-bubble.bot {
    align-self: flex-start;
    background: rgba(255,255,255,0.045);
    border: 1px solid rgba(255,255,255,0.09);
    color: #CBD5E1; border-bottom-left-radius: 4px;
  }
  .wr-bubble.typing {
    align-self: flex-start;
    background: rgba(255,255,255,0.035);
    border: 1px solid rgba(255,255,255,0.07);
    color: var(--text-muted, #8F9CAE);
    border-bottom-left-radius: 4px; font-style: italic;
    animation: wr-blink 1.1s ease-in-out infinite;
  }
  @keyframes wr-blink {
    0%,100% { opacity: 1; } 50% { opacity: 0.45; }
  }

  /* ── Quick-Reply Rebuttal Pills ────────────────────────────────────── */
  .wr-quick-replies {
    display: flex; flex-wrap: wrap; gap: 8px;
    align-self: flex-start; max-width: 90%;
    padding: 2px 0 4px;
  }
  .wr-qr-pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 15px; border-radius: 22px;
    font-size: 12.5px; font-weight: 600; font-family: var(--font-sans);
    letter-spacing: 0.02em; cursor: pointer; text-align: left;
    border: 1px solid rgba(59,130,246,0.28);
    background: rgba(59,130,246,0.07); color: #93C5FD;
    transition: all 0.17s cubic-bezier(0.4,0,0.2,1);
    line-height: 1.45;
  }
  .wr-qr-pill:hover:not(:disabled) {
    background: rgba(59,130,246,0.16);
    border-color: rgba(59,130,246,0.55);
    color: #BFDBFE;
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(59,130,246,0.18);
  }
  .wr-qr-pill:active:not(:disabled) { transform: translateY(0); }
  .wr-qr-pill:disabled { opacity: 0.35; cursor: not-allowed; }
  .wr-qr-arrow { font-size: 10px; opacity: 0.7; }
  .wr-chat-input-row {
    display: flex; border-top: 1px solid var(--border-subtle, #2C3241);
    background: rgba(255,255,255,0.02);
  }
  .wr-chat-input {
    flex: 1; background: transparent; border: none; outline: none;
    color: white; font-size: 13.5px; font-family: var(--font-sans);
    padding: 13px 16px;
  }
  .wr-chat-input::placeholder { color: var(--text-muted, #8F9CAE); }
  .wr-send-btn {
    background: #3B82F6; border: none; padding: 0 20px;
    cursor: pointer; color: white; font-size: 13px; font-weight: 600;
    font-family: var(--font-sans); transition: background 0.15s;
    display: flex; align-items: center; gap: 6px; flex-shrink: 0;
  }
  .wr-send-btn:hover:not(:disabled) { background: #2563EB; }
  .wr-send-btn:disabled { background: rgba(59,130,246,0.3); cursor: not-allowed; }
  .wr-save-bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; flex-wrap: wrap;
    padding: 14px 20px;
    border-top: 1px solid var(--border-subtle, #2C3241);
    background: rgba(255,255,255,0.015);
  }
  .wr-save-hint { font-size: 12px; color: var(--text-muted, #8F9CAE); line-height: 1.5; }
  .wr-save-btn {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 18px; border-radius: 8px;
    font-size: 12.5px; font-weight: 700; cursor: pointer;
    transition: all 0.18s; flex-shrink: 0;
    border: 1px solid rgba(16,185,129,0.3);
    background: rgba(16,185,129,0.08); color: #6EE7B7;
    font-family: var(--font-sans);
  }
  .wr-save-btn:hover:not(:disabled) { background: rgba(16,185,129,0.15); box-shadow: 0 4px 16px rgba(16,185,129,0.15); }
  .wr-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .wr-save-btn.saved { background: rgba(16,185,129,0.18); border-color: #10B981; color: #10B981; }

  /* ── EMPTY STATE ───────────────────────────────────────────────── */
  .wr-fallback {
    display: flex; align-items: center; justify-content: center;
    height: calc(100vh - 64px);
  }
  .wr-fallback-card {
    background: var(--bg-panel, #171c26); border: 1px solid var(--border-subtle, #2C3241);
    border-radius: 12px; padding: 44px 48px; text-align: center;
    max-width: 520px; box-shadow: 0 12px 40px rgba(0,0,0,0.3);
  }
  .wr-fallback-icon { font-size: 44px; margin-bottom: 18px; display: block; }
  .wr-fallback-h { font-size: 20px; font-weight: 700; color: white; margin: 0 0 12px; }
  .wr-fallback-p { font-size: 13.5px; color: var(--text-muted, #8F9CAE); line-height: 1.65; margin: 0 0 24px; }
  .wr-setup-card {
    background: var(--bg-panel, #171c26); border: 1px solid var(--border-subtle, #2C3241);
    border-radius: 14px; padding: 40px 44px; max-width: 620px; width: 100%;
    box-shadow: 0 16px 48px rgba(0,0,0,0.35);
  }
  .wr-step-row {
    display: flex; gap: 16px; align-items: flex-start; padding: 14px 0;
    border-bottom: 1px solid var(--border-subtle, #2C3241);
  }
  .wr-step-row:last-child { border-bottom: none; }
  .wr-step-num {
    font-size: 11px; font-weight: 800; color: #3B82F6;
    background: rgba(59,130,246,0.1); border-radius: 6px; padding: 4px 7px;
    flex-shrink: 0; font-family: var(--font-sans); letter-spacing: 0.5px;
  }
  .wr-cmd-chip {
    display: inline-block; background: rgba(59,130,246,0.08);
    border: 1px solid rgba(59,130,246,0.2); border-radius: 5px;
    padding: 3px 9px; font-size: 12px; font-family: monospace;
    color: #3B82F6; margin-top: 6px;
  }

  /* ── MANUAL UPLOAD DROPZONE ────────────────────────────────────── */
  .wr-or-divider {
    display: flex; align-items: center; gap: 12px; margin: 18px 0 14px;
    color: rgba(139,148,162,0.55); font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.6px;
  }
  .wr-or-divider::before, .wr-or-divider::after {
    content: ''; flex: 1; height: 1px; background: rgba(44,50,65,0.8);
  }
  .wr-dropzone {
    border: 2px dashed rgba(59,130,246,0.28); border-radius: 12px;
    padding: 26px 20px; text-align: center; cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
    background: rgba(59,130,246,0.02);
  }
  .wr-dropzone:hover { border-color: rgba(59,130,246,0.55); background: rgba(59,130,246,0.06); }
  .wr-dropzone.drag-over {
    border-color: #3B82F6; background: rgba(59,130,246,0.1);
    transform: scale(1.015);
    box-shadow: 0 0 0 4px rgba(59,130,246,0.08);
  }
  .wr-dropzone-uploading { border-color: rgba(59,130,246,0.4); background: rgba(59,130,246,0.05); cursor: default; }
  .wr-dropzone-icon { font-size: 26px; margin-bottom: 8px; display: block; }
  .wr-dropzone-title { font-size: 13px; font-weight: 600; color: white; margin-bottom: 4px; }
  .wr-dropzone-hint  { font-size: 11.5px; color: rgba(139,148,162,0.65); }
  .wr-upload-error {
    background: rgba(239,68,68,0.07); border: 1px solid rgba(239,68,68,0.2);
    border-radius: 8px; padding: 9px 14px; font-size: 12px;
    color: #FCA5A5; margin-top: 10px; text-align: center;
  }
  .wr-upload-spinner {
    width: 22px; height: 22px;
    border: 2px solid rgba(59,130,246,0.2); border-top-color: #3B82F6;
    border-radius: 50%; animation: spin 0.75s linear infinite;
    margin: 0 auto 10px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* OVERRIDE FOR MOBILE OPTIMIZATIONS */
  @media (max-width: 768px) {
    /* 1. WORKSPACE SPLIT-PANE & GRID STACKING */
    .wr-results-page, .wr-results-body {
      display: flex !important;
      flex-direction: column !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
    }
    .wr-results-body {
      padding: 12px 14px 96px 14px !important;
    }
    
    /* 2. HEADER FLOW & STRATEGY BADGES SCROLL */
    .wr-results-header {
      position: relative !important;
      top: auto !important;
      width: 100% !important;
      margin-bottom: 14px !important;
      z-index: 10 !important;
      flex-direction: column !important;
      align-items: flex-start !important;
      padding: 12px 14px !important;
      box-sizing: border-box !important;
      height: auto !important;
    }
    .wr-header-badges {
      display: flex !important;
      flex-wrap: nowrap !important;
      overflow-x: auto !important;
      overflow-y: hidden !important;
      -webkit-overflow-scrolling: touch !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
      gap: 6px !important;
      width: 100% !important;
      padding: 2px 0 6px 0 !important;
      box-sizing: border-box !important;
    }
    .wr-header-badges::-webkit-scrollbar { display: none !important; }
    .wr-header-badges > * { flex-shrink: 0 !important; }

    /* 3. FULL-WIDTH ARGUMENT & CITATION CARDS */
    .wr-cit-grid {
      display: flex !important;
      flex-direction: column !important;
      gap: 12px !important;
    }
    .wr-issue-row, .wr-cit-card, .wr-threat-card, .wr-chat-msg, .wr-pipeline-card, .wr-setup-card {
      margin: 8px 0 !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
    .wr-card-body, .wr-cit-card, .wr-threat-card {
      padding: 12px 14px !important;
    }
    .wr-cit-title, .wr-cit-snippet, .wr-issue-text, .wr-chat-msg {
      font-size: 14px !important;
      line-height: 1.55 !important;
      overflow-wrap: break-word !important;
      word-break: break-word !important;
      white-space: normal !important;
    }

    /* 4. REBUTTAL ACCORDIONS & TOUCH-FRIENDLY SUGGESTION CHIPS */
    .wr-quick-replies button, .wr-qr-pill {
      display: block !important;
      width: 100% !important;
      text-align: left !important;
      padding: 12px 14px !important;
      margin-bottom: 8px !important;
      border-radius: 8px !important;
      font-size: 13px !important;
      line-height: 1.4 !important;
      box-sizing: border-box !important;
      min-height: 44px !important;
    }
    .wr-qr-arrow {
      display: none !important;
    }
    .wr-use-rebuttal-btn, .wr-chat-form input, .wr-chat-form button, .wr-chat-submit {
      min-height: 44px !important;
    }

    /* 5. EMPTY STATE TOUCH REFACTOR */
    .desktop-only-shortcut, .wr-shortcut-pill, .wr-kbd {
      display: none !important;
    }

  /* ── LIGHT THEME COMPLETE HIGH-CONTRAST OVERRIDES ── */
  :root[data-theme="light"] .wr-pipeline-card,
  :root[data-theme="light"] .wr-setup-card,
  :root[data-theme="light"] .wr-fallback-card {
    background: #FFFFFF !important;
    border: 1px solid #CBD5E1 !important;
    box-shadow: 0 16px 48px rgba(0,0,0,0.06) !important;
  }
  :root[data-theme="light"] .wr-pipeline-h,
  :root[data-theme="light"] .wr-fallback-h {
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-pipeline-sub,
  :root[data-theme="light"] .wr-fallback-p {
    color: #475569 !important;
  }
  :root[data-theme="light"] .wr-stage-row.active-row {
    background: #EFF6FF !important;
  }
  :root[data-theme="light"] .wr-stage-text.active {
    color: #0F172A !important;
    font-weight: 700 !important;
  }
  :root[data-theme="light"] .wr-stage-text.pending {
    color: #64748B !important;
  }
  :root[data-theme="light"] .wr-stage-dot.pending {
    background: #CBD5E1 !important;
  }
  :root[data-theme="light"] .wr-dropzone {
    background: #F8FAFC !important;
    border-color: #93C5FD !important;
  }
  :root[data-theme="light"] .wr-dropzone:hover {
    background: #EFF6FF !important;
    border-color: #3B82F6 !important;
  }
  :root[data-theme="light"] .wr-dropzone.drag-over {
    background: #DBEAFE !important;
    border-color: #2563EB !important;
  }
  :root[data-theme="light"] .wr-dropzone-title {
    color: #0F172A !important;
    font-weight: 700 !important;
  }
  :root[data-theme="light"] .wr-dropzone-hint {
    color: #475569 !important;
  }
  :root[data-theme="light"] .wr-or-divider {
    color: #64748B !important;
  }
  :root[data-theme="light"] .wr-or-divider::before,
  :root[data-theme="light"] .wr-or-divider::after {
    background: #E2E8F0 !important;
  }
  :root[data-theme="light"] .wr-step-row {
    border-bottom-color: #E2E8F0 !important;
  }
  :root[data-theme="light"] .wr-step-num {
    background: rgba(37,99,235,0.1) !important;
    color: #1D4ED8 !important;
    border: 1px solid rgba(37,99,235,0.25) !important;
    font-weight: 800 !important;
  }
  :root[data-theme="light"] .wr-cmd-chip {
    background: #EFF6FF !important;
    border: 1px solid #BFDBFE !important;
    color: #1D4ED8 !important;
    font-weight: 600 !important;
  }
  :root[data-theme="light"] .wr-results-header {
    background: #FFFFFF !important;
    border-bottom: 1px solid #CBD5E1 !important;
  }
  :root[data-theme="light"] .wr-results-title {
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-results-subtitle {
    color: #475569 !important;
  }
  :root[data-theme="light"] .wr-new-sim-btn {
    background: #F8FAFC !important;
    border-color: #CBD5E1 !important;
    color: #334155 !important;
  }
  :root[data-theme="light"] .wr-new-sim-btn:hover {
    background: #EFF6FF !important;
    border-color: #3B82F6 !important;
    color: #1D4ED8 !important;
  }
  :root[data-theme="light"] .wr-card {
    background: #FFFFFF !important;
    border: 1px solid #CBD5E1 !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.04) !important;
  }
  :root[data-theme="light"] .wr-card-head {
    background: #F8FAFC !important;
    border-bottom: 1px solid #E2E8F0 !important;
  }
  :root[data-theme="light"] .wr-card-title {
    color: #0F172A !important;
    font-weight: 800 !important;
  }
  :root[data-theme="light"] .wr-roman {
    background: rgba(37,99,235,0.1) !important;
    color: #1D4ED8 !important;
    border-color: rgba(37,99,235,0.25) !important;
  }
  :root[data-theme="light"] .wr-issue-row {
    background: #F8FAFC !important;
    border: 1px solid #E2E8F0 !important;
  }
  :root[data-theme="light"] .wr-issue-num {
    background: rgba(37,99,235,0.1) !important;
    color: #1D4ED8 !important;
    border-color: rgba(37,99,235,0.25) !important;
  }
  :root[data-theme="light"] .wr-issue-text {
    color: #1E293B !important;
    font-weight: 500 !important;
  }
  :root[data-theme="light"] .wr-cit-card {
    background: #F8FAFC !important;
    border: 1px solid #CBD5E1 !important;
    border-left: 3px solid #2563EB !important;
  }
  :root[data-theme="light"] .wr-cit-card:hover {
    background: #EFF6FF !important;
    border-color: #2563EB !important;
    box-shadow: 0 4px 16px rgba(37,99,235,0.1) !important;
  }
  :root[data-theme="light"] .wr-cit-title {
    color: #1D4ED8 !important;
    font-weight: 700 !important;
  }
  :root[data-theme="light"] .wr-cit-snippet {
    color: #334155 !important;
  }
  :root[data-theme="light"] .wr-cit-index {
    color: #64748B !important;
  }
  :root[data-theme="light"] .wr-argument-doc {
    background: #FFFFFF !important;
    border: 1px solid #CBD5E1 !important;
  }
  :root[data-theme="light"] .wr-argument-text {
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-threat-card {
    border: 1px solid #CBD5E1 !important;
    border-left: 3px solid #EF4444 !important;
    background: #FFFFFF !important;
  }
  :root[data-theme="light"] .wr-threat-trigger {
    background: #FFF5F5 !important;
  }
  :root[data-theme="light"] .wr-threat-trigger:hover {
    background: #FEE2E2 !important;
  }
  :root[data-theme="light"] .wr-threat-q {
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-threat-tag {
    color: #DC2626 !important;
    font-weight: 800 !important;
  }
  :root[data-theme="light"] .wr-rebuttal-inner {
    background: #FFFFFF !important;
    border-top: 1px solid #E2E8F0 !important;
  }
  :root[data-theme="light"] .wr-rebuttal-body {
    background: #F0FDF4 !important;
    border-left: 3px solid #10B981 !important;
    color: #065F46 !important;
    font-weight: 500 !important;
  }
  :root[data-theme="light"] .wr-use-rebuttal-btn {
    background: #ECFDF5 !important;
    border-color: #86EFAC !important;
    color: #059669 !important;
  }
  :root[data-theme="light"] .wr-use-rebuttal-btn:hover {
    background: #D1FAE5 !important;
    color: #047857 !important;
  }
  :root[data-theme="light"] .wr-chat-outer {
    border: 1px solid #CBD5E1 !important;
    background: #FFFFFF !important;
  }
  :root[data-theme="light"] .wr-tone-bar {
    background: #F8FAFC !important;
    border-bottom: 1px solid #E2E8F0 !important;
  }
  :root[data-theme="light"] .wr-tone-label {
    color: #475569 !important;
  }
  :root[data-theme="light"] .wr-tone-btn {
    color: #475569 !important;
    border-color: #CBD5E1 !important;
  }
  :root[data-theme="light"] .wr-tone-btn:hover {
    color: #0F172A !important;
    border-color: #94A3B8 !important;
  }
  :root[data-theme="light"] .wr-chat-messages {
    background: #F8FAFC !important;
  }
  :root[data-theme="light"] .wr-bubble.bot {
    background: #FFFFFF !important;
    border: 1px solid #CBD5E1 !important;
    color: #1E293B !important;
  }
  :root[data-theme="light"] .wr-bubble.user {
    background: #2563EB !important;
    color: #FFFFFF !important;
  }
  :root[data-theme="light"] .wr-bubble.typing {
    background: #FFFFFF !important;
    border: 1px solid #CBD5E1 !important;
    color: #64748B !important;
  }
  :root[data-theme="light"] .wr-qr-pill {
    background: #EFF6FF !important;
    border-color: #93C5FD !important;
    color: #1D4ED8 !important;
    font-weight: 600 !important;
  }
  :root[data-theme="light"] .wr-qr-pill:hover:not(:disabled) {
    background: #DBEAFE !important;
    border-color: #3B82F6 !important;
    color: #1D4ED8 !important;
  }
  :root[data-theme="light"] .wr-chat-input-row {
    background: #FFFFFF !important;
    border-top: 1px solid #E2E8F0 !important;
  }
  :root[data-theme="light"] .wr-chat-input {
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-chat-input::placeholder {
    color: #94A3B8 !important;
  }
  :root[data-theme="light"] .wr-save-bar {
    background: #F8FAFC !important;
    border-top: 1px solid #E2E8F0 !important;
  }
  :root[data-theme="light"] .wr-save-hint {
    color: #475569 !important;
  }

  /* ── LIGHT THEME HUB OVERRIDES ── */
  :root[data-theme="light"] .wr-hub-title {
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-hub-subtitle {
    color: #475569 !important;
  }
  :root[data-theme="light"] .wr-hub-category {
    color: #1D4ED8 !important;
  }
  :root[data-theme="light"] .wr-hub-card {
    background: #FFFFFF !important;
    border: 1px solid #CBD5E1 !important;
    box-shadow: 0 12px 36px rgba(0,0,0,0.05) !important;
  }
  :root[data-theme="light"] .wr-hub-badge-icon {
    background: #EFF6FF !important;
    border-color: #BFDBFE !important;
    color: #1D4ED8 !important;
  }
  :root[data-theme="light"] .wr-hub-card-title {
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-hub-card-subtitle {
    color: #475569 !important;
  }
  :root[data-theme="light"] .wr-hub-dropzone {
    background: #F8FAFC !important;
    border-color: #CBD5E1 !important;
  }
  :root[data-theme="light"] .wr-hub-dropzone:hover {
    background: #EFF6FF !important;
    border-color: #3B82F6 !important;
  }
  :root[data-theme="light"] .wr-hub-dropzone.drag-over {
    background: #DBEAFE !important;
    border-color: #2563EB !important;
  }
  :root[data-theme="light"] .wr-hub-dropzone-icon {
    background: #EFF6FF !important;
    border-color: #BFDBFE !important;
    color: #1D4ED8 !important;
  }
  :root[data-theme="light"] .wr-hub-dropzone-primary {
    color: #0F172A !important;
    font-weight: 700 !important;
  }
  :root[data-theme="light"] .wr-hub-dropzone-secondary {
    color: #64748B !important;
  }
  :root[data-theme="light"] .wr-hub-cmd-row {
    background: #F8FAFC !important;
    border-color: #E2E8F0 !important;
  }
  :root[data-theme="light"] .wr-hub-cmd-num {
    background: #EFF6FF !important;
    border-color: #BFDBFE !important;
    color: #1D4ED8 !important;
  }
  :root[data-theme="light"] .wr-hub-cmd-text {
    color: #475569 !important;
  }
  :root[data-theme="light"] .wr-hub-cmd-chip {
    background: #EFF6FF !important;
    border-color: #BFDBFE !important;
    color: #1D4ED8 !important;
    font-weight: 600 !important;
  }
  :root[data-theme="light"] .wr-hub-cmd-chip:hover {
    background: #DBEAFE !important;
    border-color: #3B82F6 !important;
  }
  :root[data-theme="light"] .wr-hub-btn-secondary {
    background: #FFFFFF !important;
    border-color: #CBD5E1 !important;
    color: #334155 !important;
  }
  :root[data-theme="light"] .wr-hub-btn-secondary:hover {
    background: #F8FAFC !important;
    border-color: #94A3B8 !important;
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-benchmark-card {
    background: #F8FAFC !important;
    border-color: #CBD5E1 !important;
    border-left: 3px solid #2563EB !important;
  }
  :root[data-theme="light"] .wr-benchmark-card:hover {
    background: #EFF6FF !important;
    border-color: #2563EB !important;
    box-shadow: 0 6px 18px rgba(37,99,235,0.12) !important;
  }
  :root[data-theme="light"] .wr-benchmark-title {
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-benchmark-tag {
    background: #EFF6FF !important;
    border-color: #BFDBFE !important;
    color: #1D4ED8 !important;
  }
  :root[data-theme="light"] .wr-benchmark-court {
    color: #475569 !important;
  }
  :root[data-theme="light"] .wr-cap-title {
    color: #0F172A !important;
  }
  :root[data-theme="light"] .wr-cap-desc {
    color: #475569 !important;
  }
  }
`;

// ── Sub-component: ThreatCard ────────────────────────────────────────────────

function ThreatCard({ threat, index, expanded, onToggle, onUseRebuttal }) {
  return (
    <div className="wr-threat-card">
      <div className="wr-threat-trigger" onClick={onToggle}>
        <div>
          <div className="wr-threat-tag">Opponent Q{index + 1}</div>
          <div className="wr-threat-q">{renderParagraphs(threat.question)}</div>
        </div>
        <svg className={`wr-chevron${expanded ? ' open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      <div className={`wr-rebuttal-panel${expanded ? ' open' : ''}`}>
        {threat.suggested_rebuttal && (
          <div className="wr-rebuttal-inner">
            <div className="wr-rebuttal-label">Your Rebuttal</div>
            <div className="wr-rebuttal-body">{renderParagraphs(threat.suggested_rebuttal)}</div>
            <button
              className="wr-use-rebuttal-btn"
              type="button"
              onClick={(e) => { e.stopPropagation(); onUseRebuttal?.(threat.suggested_rebuttal); }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Use this Rebuttal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function WarRoomView() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || ''; // relative — same-origin via Vite proxy in dev
  const location = useLocation();
  const navigate = useNavigate();

  // Mount fade-in
  const [isMounted, setIsMounted] = useState(false);

  // Pipeline lifecycle
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [simError, setSimError] = useState(null);
  const [simulationData, setSimulationData] = useState(null);

  // Section progressive reveal — Set of section numbers (1–5)
  const [revealedSections, setRevealedSections] = useState(new Set());

  // Section IV: collapsible threats (first open by default)
  const [expandedThreats, setExpandedThreats] = useState(new Set([0]));

  // Section V: chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [strategyTone, setStrategyTone] = useState('aggressive');
  const [savingSession, setSavingSession] = useState(false);
  const [savedSession, setSavedSession] = useState(false);
  const [docSource, setDocSource] = useState('');

  const chatEndRef = useRef(null);
  const chatSectionRef = useRef(null);
  const stageTimers = useRef([]);
  const fileInputRef = useRef(null);

  // Same StrictMode-fragile pattern as VaultView.jsx's DEFECT-03 — must
  // reassert `true` at the top of the effect body, or a dev-mode double-
  // invoke leaves this permanently false and every `if (!isMountedRef.current)
  // return;` guard below (including the one in handleManualUpload, right
  // after the upload succeeds) silently no-ops for good. Confirmed live: the
  // Virtual Courtroom upload POSTs a real 201 CREATED, but the simulation
  // never starts because that guard was eating the rest of the function.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Manual upload state (Task 3)
  const [uploadState, setUploadState] = useState('idle'); // 'idle' | 'uploading' | 'error'
  const [uploadError, setUploadError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const clearStageTimers = () => {
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];
  };

  const progressiveReveal = (data) => {
    // Seed Section V chat with an opening message
    const excerpt = (data.extracted_issues || '').split('\n')[0] || 'this matter';
    const qCount = data.red_team?.opposing_counter_questions?.length || 3;
    setChatMessages([{
      role: 'bot',
      text: `⚖️ Opposing counsel standing by. I have reviewed your opening argument on "${excerpt.substring(0, 100).trim()}…" I have ${qCount} primary challenges prepared. State your position.`,
    }]);

    // Reveal sections 1–5 at 480ms stagger
    [1, 2, 3, 4, 5].forEach((sec, i) => {
      const t = setTimeout(() => {
        if (!isMountedRef.current) return;
        setRevealedSections(prev => new Set([...prev, sec]));
      }, i * 480 + 120);
      stageTimers.current.push(t);
    });
  };

  const runSimulation = async (docContent, clientSide = 'Appellant', docRef = '') => {
    setDocSource(docRef);
    setIsSimulating(true);
    setCurrentStage(1);
    setSimulationData(null);
    setRevealedSections(new Set());
    setChatMessages([]);
    setSavedSession(false);
    setSimError(null);

    // Advance stage indicator while API runs (each stage ≈7s)
    PIPELINE_STAGES.slice(1).forEach((stage, i) => {
      const t = setTimeout(() => setCurrentStage(stage.num), (i + 1) * 7000);
      stageTimers.current.push(t);
    });

    try {
      const res = await fetch(`${API_BASE}/api/ai/simulate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          document_content: docContent,
          client_side: clientSide,
          document_reference: docRef,
        }),
      });
      const data = await res.json();
      if (!isMountedRef.current) return;
      clearStageTimers();

      if (data.error) {
        setSimError(data.error);
      } else {
        sessionStorage.setItem('wr_active_session', JSON.stringify(data.simulationData));
        setSimulationData(data.simulationData);
        setCurrentStage(5);
        progressiveReveal(data.simulationData);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      clearStageTimers();
      setSimError(err.message || 'Simulation failed. Check backend status.');
    } finally {
      if (!isMountedRef.current) return;
      setIsSimulating(false);
    }
  };

  // ── Mount effect ─────────────────────────────────────────────────────────

  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsMounted(true));

    const docData = location.state?.documentData;
    const pending = location.state?.pendingSimulation;
    const existing = location.state?.simulationData;

    const fileContent = docData?.file_content || '';
    const docRef = docData?.document_reference || '';

    if (fileContent || docRef) {
      // Immediately wipe the router state so a browser refresh doesn't re-fire the API
      window.history.replaceState({}, document.title);
      runSimulation(fileContent, 'Appellant', docRef);
    } else if (pending?.documentContext) {
      window.history.replaceState({}, document.title);
      runSimulation(pending.documentContext, pending.clientSide || 'Appellant');
    } else if (existing) {
      window.history.replaceState({}, document.title);
      setSimulationData(existing);
      progressiveReveal(existing);
    } else {
      // Restore from tab-scoped session cache — no animation, instant reveal
      const cached = sessionStorage.getItem('wr_active_session');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setSimulationData(parsed);
          setRevealedSections(new Set([1, 2, 3, 4, 5]));
          const excerpt = (parsed.extracted_issues || '').split('\n')[0] || 'this matter';
          const qCount = parsed.red_team?.opposing_counter_questions?.length || 3;
          setChatMessages([{
            role: 'bot',
            text: `⚖️ Session restored. I have reviewed your argument on "${excerpt.substring(0, 100).trim()}…" ${qCount} challenges remain active. State your position.`,
            rebuttals: [],
          }]);
        } catch {
          sessionStorage.removeItem('wr_active_session');
        }
      }
    }

    return () => { cancelAnimationFrame(raf); clearStageTimers(); };
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Shared chat submitter (used by manual input AND "Use this Rebuttal") ──

  const submitToChat = async (text) => {
    if (!text.trim() || chatLoading) return;

    const query = text.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: query }]);
    setChatLoading(true);

    const toneInstruction = strategyTone === 'aggressive'
      ? 'Act as aggressive opposing counsel. Attack every weakness. Be assertive and relentless.'
      : 'Act as defensive opposing counsel. Probe procedural gaps and technical deficiencies calmly.';

    const context = simulationData?.extracted_issues || '';

    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `[Virtual Courtroom — ${strategyTone === 'aggressive' ? 'Aggressive Counter-Attack' : 'Defensive Shield'} Mode]\n\nCase context:\n${context.substring(0, 1200)}\n\n${toneInstruction}\n\nAdvocate says: ${query}`,
        }),
      });
      const data = await res.json();
      if (!isMountedRef.current) return;
      const raw = data.response || '';
      const { mainText, rebuttals } = parseRobotResponse(raw);
      setChatMessages(prev => [...prev, { role: 'bot', text: mainText || 'No response.', rebuttals }]);
    } catch {
      if (!isMountedRef.current) return;
      setChatMessages(prev => [...prev, { role: 'bot', text: 'Connection error. Please retry.', rebuttals: [] }]);
    }
    setChatLoading(false);
  };

  // ── Section V: manual chat submit ────────────────────────────────────────

  const handleChatSubmit = async (e) => {
    e?.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const query = chatInput.trim();
    setChatInput('');
    await submitToChat(query);
  };

  // ── Section IV → V: fire rebuttal directly into the chat loop ────────────

  const handleUseRebuttal = (rebuttalText) => {
    if (!rebuttalText || chatLoading) return;
    chatSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    submitToChat(rebuttalText);
  };

  // ── Manual file upload → simulation (Task 3) ─────────────────────────────

  const handleManualUpload = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'txt', 'docx'].includes(ext)) {
      setUploadError('Unsupported file. Please upload a PDF, TXT, or DOCX file.');
      return;
    }
    setUploadState('uploading');
    setUploadError('');
    try {
      // Upload → index chunks into the RAG pipeline (same flow as Case Vault)
      await uploadDocument(file, null, 'War Room Upload');
      if (!isMountedRef.current) return;
      // Trigger simulation; backend Pass 2 vault lookup finds the chunks by filename
      const refName = file.name.replace(/\.[^.]+$/, '');
      setUploadState('idle');
      runSimulation('', 'Appellant', refName);
    } catch (err) {
      if (!isMountedRef.current) return;
      setUploadState('error');
      setUploadError(err?.message || 'Upload failed. Check your connection and try again.');
    }
  };

  const onDropzoneClick = () => {
    if (uploadState === 'uploading') return;
    fileInputRef.current?.click();
  };

  const onFileInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleManualUpload(file);
    e.target.value = '';
  };

  const onDragOver = (e) => { e.preventDefault(); setIsDragOver(true); };
  const onDragLeave = () => setIsDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleManualUpload(file);
  };

  // ── Save full session to vault ────────────────────────────────────────────

  const handleSaveSession = async () => {
    if (!simulationData) return;
    setSavingSession(true);

    const lines = [
      '════════════════════════════════════════',
      '   VIRTUAL COURTROOM SIMULATION SESSION',
      '════════════════════════════════════════',
      `Generated : ${new Date().toLocaleString('en-IN')}`,
      `Strategy  : ${simulationData.client_side || 'Appellant'}`,
      '',
      '## SECTION I — EXTRACTED ISSUES',
      simulationData.extracted_issues || '(none)',
      '',
      '## SECTION III — OPENING ARGUMENT',
      simulationData.opening_argument || '(none)',
      '',
    ];

    (simulationData.red_team?.opposing_counter_questions || []).forEach((q, i) => {
      lines.push(`## OPPOSING QUESTION ${i + 1}`);
      lines.push(q.question || '');
      lines.push('REBUTTAL:');
      lines.push(q.suggested_rebuttal || '');
      lines.push('');
    });

    if (chatMessages.length > 1) {
      lines.push('## SECTION V — CHAT TRANSCRIPT');
      chatMessages.forEach(m => {
        lines.push(`${m.role === 'user' ? 'ADVOCATE' : 'OPPOSITION'}: ${m.text}`);
      });
    }

    const sessionText = lines.join('\n');
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const smartTitle = `${docSource || 'Document'} — Simulation (${timeString})`;
    try {
      await fetch(`${API_BASE}/api/vault/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          case_id: 'WAR_ROOM',
          title: smartTitle,
          doc_type: 'Courtroom Simulation',
          content: sessionText,
        }),
      });
    } catch { /* silent — UI feedback via setSavedSession */ }
    if (!isMountedRef.current) return;
    setSavingSession(false);
    setSavedSession(true);
    setTimeout(() => {
      if (!isMountedRef.current) return;
      setSavedSession(false);
    }, 3500);
  };

  // ── Toggle threat card ────────────────────────────────────────────────────

  const toggleThreat = (i) => {
    setExpandedThreats(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // ────────────────────────────────────────────────────────────────────────────
  // ── RENDER: Loading ──────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────────────────

  if (isSimulating) {
    return (
      <>
        <style>{WAR_ROOM_STYLES}</style>
        <div className="wr-pipeline-wrap">
          <div className="wr-pipeline-card">
            <span className="wr-pipeline-gavel">⚖️</span>
            <h2 className="wr-pipeline-h">Initializing 5-Stage AI Pipeline</h2>
            <p className="wr-pipeline-sub">Processing under Indian Law — this takes 25–40 seconds for dense documents</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {PIPELINE_STAGES.map(stage => {
                const state = stage.num < currentStage ? 'done' : stage.num === currentStage ? 'active' : 'pending';
                return (
                  <div key={stage.num} className={`wr-stage-row${state === 'active' ? ' active-row' : ''}`}>
                    <div className={`wr-stage-dot ${state}`} />
                    <span className={`wr-stage-text ${state}`}>
                      {state === 'done' ? '✓ ' : ''}{stage.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── RENDER: Error ─────────────────────────────────────────────────────────

  if (simError) {
    return (
      <>
        <style>{WAR_ROOM_STYLES}</style>
        <div className="wr-fallback">
          <div className="wr-fallback-card">
            <span className="wr-fallback-icon">🚨</span>
            <h2 className="wr-fallback-h">Simulation Failed</h2>
            <p className="wr-fallback-p">{simError}</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn-accent" onClick={() => { setSimError(null); navigate('/war-room', { replace: true }); }} style={{ padding: '10px 22px' }}>
                Reset
              </button>
              <button className="btn-accent" onClick={() => navigate('/dashboard')} style={{ padding: '10px 22px', background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                Dashboard
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── RENDER: Empty / Standby ───────────────────────────────────────────────

  if (!simulationData) {
    return (
      <>
        <style>{WAR_ROOM_STYLES}</style>
        {/* Hidden file input — triggered by dropzone click */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.docx"
          style={{ display: 'none' }}
          onChange={onFileInputChange}
        />

        <div className="wr-hub-wrapper">
          <div className="wr-hub-container">

            {/* ── HEADER BLOCK ── */}
            <div className="wr-hub-header">
              <div className="wr-hub-category">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                  <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                  <path d="M7 21h10" />
                  <path d="M12 3v18" />
                  <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
                </svg>
                AI Trial Prep & Moot Court Engine
              </div>
              <h1 className="wr-hub-title">Virtual Courtroom War Room</h1>
              <p className="wr-hub-subtitle">
                High-fidelity litigation simulator with judicial bench interrogation, strategic rebuttal analysis, and live Indian precedent scrutiny.
              </p>
            </div>

            {/* ── 12-COLUMN RESPONSIVE GRID ── */}
            <div className="wr-hub-grid">

              {/* LEFT COLUMN (lg:col-span-7) — Case Ingestion & Direct Launch */}
              <div className="wr-hub-card">
                <div className="wr-hub-card-header">
                  <div className="wr-hub-badge-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="wr-hub-card-title">Initialize Case File</h2>
                    <p className="wr-hub-card-subtitle">Ingest primary petition, written statement, or contract</p>
                  </div>
                </div>

                {/* Interactive Dropzone */}
                <div
                  className={`wr-hub-dropzone${isDragOver ? ' drag-over' : ''}${uploadState === 'uploading' ? ' wr-dropzone-uploading' : ''}`}
                  onClick={onDropzoneClick}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                >
                  {uploadState === 'uploading' ? (
                    <>
                      <div className="wr-upload-spinner" />
                      <div className="wr-hub-dropzone-primary">Uploading & indexing document…</div>
                      <div className="wr-hub-dropzone-secondary">Pipeline will start automatically once processing completes</div>
                    </>
                  ) : (
                    <>
                      <div className="wr-hub-dropzone-icon">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                      </div>
                      <div className="wr-hub-dropzone-primary">
                        Drop your case document here or <span style={{ color: 'var(--accent-primary, #3B82F6)', textDecoration: 'underline' }}>browse files</span>
                      </div>
                      <div className="wr-hub-dropzone-secondary">
                        PDF, TXT, or DOCX · Max 25MB · Triggers 5-stage simulation instantly
                      </div>
                    </>
                  )}
                </div>

                {uploadState === 'error' && (
                  <div className="wr-upload-error">{uploadError}</div>
                )}

                {/* Subtle Divider */}
                <div className="wr-or-divider">Or activate via command palette</div>

                {/* Command Steps */}
                <div className="wr-hub-cmd-steps">
                  <div className="wr-hub-cmd-row">
                    <span className="wr-hub-cmd-num">01</span>
                    <div className="wr-hub-cmd-text">
                      Press <kbd style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', padding: '2px 5px', borderRadius: '4px', fontFamily: 'monospace', color: 'var(--text-primary)' }}>Ctrl+K</kbd> or click <strong>"LexAmplify"</strong> in the sidebar to open the Assistant.
                    </div>
                  </div>
                  <div className="wr-hub-cmd-row">
                    <span className="wr-hub-cmd-num">02</span>
                    <div style={{ flex: 1 }}>
                      <div className="wr-hub-cmd-text">
                        Type an argument simulation command directly:
                      </div>
                      <div
                        className="wr-hub-cmd-chip"
                        onClick={() => window.dispatchEvent(new Event('toggle-rag-palette'))}
                        title="Click to open command assistant"
                      >
                        <span>⚡</span> "Simulate defense arguments for [Case Name]"
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Actions Row */}
                <div className="wr-hub-actions-row">
                  <button
                    className="wr-hub-btn-primary"
                    type="button"
                    onClick={() => window.dispatchEvent(new Event('toggle-rag-palette'))}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    Open Command Assistant
                  </button>
                  <button
                    className="wr-hub-btn-secondary"
                    type="button"
                    onClick={() => navigate('/vault')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Go to Case Vault
                  </button>
                </div>
              </div>

              {/* RIGHT COLUMN (lg:col-span-5) — Benchmark Scenarios & Pipeline Overview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* Benchmark Demos Card */}
                <div className="wr-hub-card">
                  <div className="wr-hub-card-header">
                    <div className="wr-hub-badge-icon" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.25)', color: '#10B981' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="wr-hub-card-title">Benchmark Indian Law Scenarios</h3>
                      <p className="wr-hub-card-subtitle">Quick-launch litigation models with full judicial scrutiny</p>
                    </div>
                  </div>

                  <div className="wr-benchmark-list">
                    {BENCHMARK_SCENARIOS.map((scen) => (
                      <div
                        key={scen.title}
                        className="wr-benchmark-card"
                        onClick={() => runSimulation(scen.content, scen.clientSide, scen.title)}
                        title="Click to run this benchmark simulation"
                      >
                        <div className="wr-benchmark-header">
                          <span className="wr-benchmark-title">{scen.title}</span>
                          <span className="wr-benchmark-tag">{scen.tag}</span>
                        </div>
                        <div className="wr-benchmark-court">
                          <span>🏛️ {scen.court}</span>
                          <span>·</span>
                          <span style={{ color: 'var(--accent-primary, #3B82F6)', fontWeight: 600 }}>{scen.clientSide}</span>
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--text-muted, #94A3B8)', marginTop: '2px', lineHeight: 1.4 }}>
                          {scen.summary}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Simulation Capabilities Card */}
                <div className="wr-hub-card" style={{ background: 'rgba(255,255,255,0.015)' }}>
                  <div className="wr-hub-card-header" style={{ marginBottom: '-4px' }}>
                    <div className="wr-hub-badge-icon" style={{ background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.25)', color: '#A78BFA' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="wr-hub-card-title">Litigation Engine Architecture</h3>
                      <p className="wr-hub-card-subtitle">Autonomous 5-stage moot court simulation suite</p>
                    </div>
                  </div>

                  <div className="wr-cap-list">
                    {SIMULATION_CAPABILITIES.map((cap) => (
                      <div key={cap.title} className="wr-cap-item">
                        <div className="wr-cap-icon">{cap.icon}</div>
                        <div>
                          <div className="wr-cap-title">{cap.title}</div>
                          <div className="wr-cap-desc">{cap.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

            </div>

          </div>
        </div>
      </>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ── RENDER: Full 5-Section Results Dashboard ─────────────────────────────────
  // ────────────────────────────────────────────────────────────────────────────

  const issues = parseIssues(simulationData.extracted_issues);
  const citations = simulationData.live_citations ?? [];
  const questions = simulationData.red_team?.opposing_counter_questions ?? [];

  const sectionRevealed = (n) => revealedSections.has(n);

  return (
    <>
      <style>{WAR_ROOM_STYLES}</style>

      <div className={`wr-results-page${isMounted ? ' wr-mounted' : ''}`}>

        {/* ── HEADER ── */}
        <div className="wr-results-header">
          <div>
            <h1 className="wr-results-title">Litigation War Room</h1>
            <p className="wr-results-subtitle">5-Stage Agentic Pipeline · Indian Law · Active Session</p>
          </div>
          <div className="wr-header-badges">
            <span className="wr-badge-strategy">
              {simulationData.client_side || 'Appellant'} Strategy
            </span>
            <span className="wr-badge-done">
              <span className="wr-badge-dot" />
              Pipeline Complete
            </span>
            <button className="wr-new-sim-btn" onClick={() => {
              sessionStorage.removeItem('wr_active_session');
              clearStageTimers();
              setSimulationData(null);
              setIsSimulating(false);
              setSimError(null);
              setRevealedSections(new Set());
              setChatMessages([]);
              setSavedSession(false);
              setUploadState('idle');
              setUploadError('');
              navigate('/war-room', { replace: true });
            }}>
              New Simulation
            </button>
          </div>
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div className="wr-results-body">

          {/* ───────── SECTION I — Extracted Issues ───────── */}
          <div className={`wr-section${sectionRevealed(1) ? ' wr-revealed' : ''}`}>
            <div className="wr-card">
              <div className="wr-card-head">
                <span className="wr-roman">I</span>
                <h3 className="wr-card-title">Extracted Legal Issues &amp; Core Facts</h3>
              </div>
              <div className="wr-card-body">
                {issues.length > 0 ? (
                  <div className="wr-issues-list">
                    {issues.map((issue, i) => (
                      <div key={i} className="wr-issue-row">
                        <span className="wr-issue-num">{i + 1}</span>
                        <span className="wr-issue-text">{issue}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '13.5px', color: 'var(--text-primary)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                    {simulationData.extracted_issues || 'No issues extracted.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ───────── SECTION II — Live Citations ───────── */}
          <div className={`wr-section${sectionRevealed(2) ? ' wr-revealed' : ''}`}>
            <div className="wr-card">
              <div className="wr-card-head">
                <span className="wr-roman">II</span>
                <h3 className="wr-card-title">Live Supreme Court Citations &amp; Precedents</h3>
              </div>
              <div className="wr-card-body">
                {citations.length > 0 ? (
                  <div className="wr-cit-grid">
                    {citations.map((c, i) => (
                      <a
                        key={i}
                        className="wr-cit-card"
                        href={c.url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <div className="wr-cit-meta">
                          <span className="wr-kanoon-badge">Indian Kanoon</span>
                          <span className="wr-cit-index">Cite {i + 1}</span>
                        </div>
                        <div className="wr-cit-title">{c.title || 'Case Citation'}</div>
                        {c.snippet && <div className="wr-cit-snippet">{c.snippet}</div>}
                        <span className="wr-cit-link">Source Link →</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="wr-no-cit">No live citations retrieved — Tavily search returned no results for this matter.</p>
                )}
              </div>
            </div>
          </div>

          {/* ───────── SECTION III — Opening Argument ───────── */}
          <div className={`wr-section${sectionRevealed(3) ? ' wr-revealed' : ''}`}>
            <div className="wr-card" style={{ borderLeft: '3px solid var(--accent-primary, #3B82F6)' }}>
              <div className="wr-card-head">
                <span className="wr-roman">III</span>
                <h3 className="wr-card-title">Drafted Opening Argument</h3>
                <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
                  {simulationData.client_side || 'Appellant'} Position
                </span>
              </div>
              <div className="wr-card-body">
                <div className="wr-argument-doc">
                  <div className="wr-argument-text">
                    {simulationData.opening_argument || 'Argument drafting in progress…'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ───────── SECTION IV — Red Team / Opposing Counsel ───────── */}
          <div className={`wr-section${sectionRevealed(4) ? ' wr-revealed' : ''}`}>
            <div className="wr-card">
              <div className="wr-card-head">
                <span className="wr-roman" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.25)', color: '#FCA5A5' }}>IV</span>
                <h3 className="wr-card-title">Opposing Counsel Simulation — Red Team</h3>
                <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#FCA5A5', fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
                  {questions.length} Challenge{questions.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="wr-card-body">
                {questions.length > 0 ? (
                  <div className="wr-threats-list">
                    {questions.map((threat, i) => (
                      <ThreatCard
                        key={i}
                        threat={threat}
                        index={i}
                        expanded={expandedThreats.has(i)}
                        onToggle={() => toggleThreat(i)}
                        onUseRebuttal={handleUseRebuttal}
                      />
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    No opposing threats detected for this strategy.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ───────── SECTION V — Continuous Simulation Chat ───────── */}
          <div ref={chatSectionRef} className={`wr-section${sectionRevealed(5) ? ' wr-revealed' : ''}`}>
            <div className="wr-card">
              <div className="wr-card-head">
                <span className="wr-roman">V</span>
                <h3 className="wr-card-title">Continuous Simulation Chat</h3>
              </div>
              <div className="wr-chat-outer" style={{ border: 'none', borderRadius: 0 }}>

                {/* Tone switcher */}
                <div className="wr-tone-bar">
                  <span className="wr-tone-label">Legal Strategy Tone:</span>
                  <button
                    className={`wr-tone-btn${strategyTone === 'aggressive' ? ' tone-agg' : ''}`}
                    onClick={() => setStrategyTone('aggressive')}
                  >
                    ⚔️ Aggressive (Counter-Attack)
                  </button>
                  <button
                    className={`wr-tone-btn${strategyTone === 'defensive' ? ' tone-def' : ''}`}
                    onClick={() => setStrategyTone('defensive')}
                  >
                    🛡️ Defensive (Shield / Mitigate)
                  </button>
                </div>

                {/* Messages */}
                <div className="wr-chat-messages">
                  {chatMessages.map((m, i) => (
                    <React.Fragment key={i}>
                      <div className={`wr-bubble ${m.role}`}>
                        {m.role === 'bot' ? (
                          <div
                            className="md-body"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }}
                          />
                        ) : (
                          m.text
                        )}
                      </div>
                      {m.role === 'bot' && m.rebuttals?.length > 0 && (
                        <div className="wr-quick-replies">
                          {m.rebuttals.map((r, j) => (
                            <button
                              key={j}
                              className="wr-qr-pill"
                              disabled={chatLoading}
                              onClick={() => submitToChat(r)}
                            >
                              <span className="wr-qr-arrow">↳</span>
                              {r}
                            </button>
                          ))}
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                  {chatLoading && (
                    <div className="wr-bubble typing">Opposing counsel preparing cross-examination…</div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input bar */}
                <form className="wr-chat-input-row" onSubmit={handleChatSubmit}>
                  <input
                    className="wr-chat-input"
                    type="text"
                    placeholder="State your argument or respond to opposition…"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    disabled={chatLoading}
                  />
                  <button className="wr-send-btn" type="submit" disabled={chatLoading || !chatInput.trim()}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    Send
                  </button>
                </form>

                {/* Save session footer */}
                <div className="wr-save-bar">
                  <span className="wr-save-hint">
                    Save the complete simulation — issues, argument, red-team analysis, and chat — to your Case Vault.
                  </span>
                  <button
                    className={`wr-save-btn${savedSession ? ' saved' : ''}`}
                    onClick={handleSaveSession}
                    disabled={savingSession || savedSession}
                  >
                    {savingSession ? (
                      <>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 0.9s linear infinite' }}>
                          <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-.73-8.56" />
                        </svg>
                        Saving…
                      </>
                    ) : savedSession ? (
                      <>✓ Saved to Vault</>
                    ) : (
                      <>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                        </svg>
                        Save Full Session to Case Vault
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>{/* end wr-results-body */}
      </div>{/* end wr-results-page */}
    </>
  );
}
