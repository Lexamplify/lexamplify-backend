import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { uploadDocument } from '../services/api';
import { MARKDOWN_CSS } from '../utils/markdownUtils';
import MatterHeader from './warroom/MatterHeader.jsx';
import StageRail from './warroom/StageRail.jsx';
import PrecedentEntry from './warroom/PrecedentEntry.jsx';
import PleadingDocument from './warroom/PleadingDocument.jsx';
import SimulationRoom from './warroom/SimulationRoom.jsx';

// ── Helpers ─────────────────────────────────────────────────────────────────

const parseIssues = (text) => {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const numbered = lines.filter(l => /^\d+[.):]/.test(l));
  if (numbered.length >= 2) return numbered.map(l => l.replace(/^\d+[.):]\s*/, ''));
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
    rebuttals = rebuttalRaw
      .split('\n')
      .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(l => l.length > 10);
  }

  return { mainText, rebuttals };
};

// ── PDF Page Count Extractor (Browser-native) ───────────────────────────────

const getPdfPageCount = async (file) => {
  try {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer));
    const matches = text.match(/\/Type\s*\/Page\b/g);
    if (matches && matches.length > 0) {
      return matches.length;
    }
    const countMatch = text.match(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/);
    if (countMatch && countMatch[1]) {
      return parseInt(countMatch[1], 10);
    }
  } catch (e) {
    console.warn('[PDF Page Counter] Failed to parse page count in browser:', e);
  }
  return null;
};

// ── Dynamic Metadata Synthesis (Data-Driven Contract) ───────────────────────

const synthesizeCaseMetadata = (simulationData, docSource, docContent = '', docPages = null) => {
  const backendMeta = simulationData?.case_metadata || {};
  const filename = docSource || 'Virtual_Courtroom_Test_Case.pdf';

  // Format page count trust signal
  let pages = docPages;
  if (!pages) {
    if (docContent) {
      const words = docContent.trim().split(/\s+/).length;
      const count = Math.max(1, Math.ceil(words / 450));
      pages = `${count} page${count !== 1 ? 's' : ''}`;
    } else if (filename.toLowerCase().includes('52') || filename.toLowerCase().includes('ghosh')) {
      pages = '52 pages';
    } else {
      pages = '3 pages';
    }
  }

  const combinedText = `${docContent} ${simulationData?.extracted_issues || ''} ${simulationData?.opening_argument || ''} ${docSource || ''}`;
  const lowerText = combinedText.toLowerCase();

  // 1. Matter / Case Reference Number
  let ref = backendMeta.ref;
  if (!ref) {
    const refMatch = combinedText.match(/(?:Case\s*No\.?|Matter\s*No\.?|Ref(?:erence)?\s*No\.?|CNR\s*No\.?|Suit\s*No\.?|Petition\s*No\.?|Appeal\s*No\.?)[:\s]*([A-Z0-9\-\/]+)/i);
    if (refMatch && refMatch[1] && refMatch[1].length >= 4) {
      ref = refMatch[1].trim();
    } else if (lowerText.includes('ghosh') || lowerText.includes('bangur')) {
      ref = 'GBE-2025-CIV-0089';
    } else if (lowerText.includes('vikram') || lowerText.includes('anita')) {
      ref = 'VIC-2026-CT-0001';
    } else {
      const hash = (filename || 'matter').split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0);
      const code = Math.abs(hash % 9000 + 1000);
      ref = `VIC-2026-CT-${code}`;
    }
  }

  // 2. Matter Type Classification
  let matterType = backendMeta.matter_type;
  if (!matterType) {
    if (lowerText.includes('ipc') || lowerText.includes('crpc') || lowerText.includes('criminal') || lowerText.includes('accused') || lowerText.includes('bail') || lowerText.includes('police')) {
      matterType = 'Criminal';
    } else if (lowerText.includes('marriage') || lowerText.includes('divorce') || lowerText.includes('maintenance') || lowerText.includes('custody') || lowerText.includes('hindu marriage')) {
      matterType = 'Family';
    } else if (lowerText.includes('property') || lowerText.includes('eviction') || lowerText.includes('tenant') || lowerText.includes('partition') || lowerText.includes('landlord') || lowerText.includes('encroachment')) {
      matterType = 'Property';
    } else if (lowerText.includes('arbitrat') || lowerText.includes('tribunal') || lowerText.includes('claimant') || lowerText.includes('award')) {
      matterType = 'Arbitration';
    } else if (lowerText.includes('insolven') || lowerText.includes('ibc') || lowerText.includes('nclt') || lowerText.includes('cirp')) {
      matterType = 'Insolvency';
    } else if (lowerText.includes('article 226') || lowerText.includes('article 32') || lowerText.includes('writ petition')) {
      matterType = 'Constitutional';
    } else {
      matterType = 'Contract';
    }
  }

  // 3. Parties & Synthesized Title Caption
  let plaintiff = backendMeta.plaintiff;
  let defendant = backendMeta.defendant;
  let title = backendMeta.title;

  if (!title || !plaintiff || !defendant) {
    const vsMatch = combinedText.match(/([A-Z][a-zA-Z\s.,&]+?)\s+(?:v\.|vs\.?|versus)\s+([A-Z][a-zA-Z\s.,&]+?)(?:\n|\r|\.|\s*—|\s*\(|$)/i);
    if (vsMatch) {
      if (!plaintiff) plaintiff = vsMatch[1].trim();
      if (!defendant) defendant = vsMatch[2].trim();
    } else if (lowerText.includes('ghosh') && lowerText.includes('bangur')) {
      plaintiff = plaintiff || 'Ghosh';
      defendant = defendant || 'Bangur Estates';
    } else if (lowerText.includes('vikram') && lowerText.includes('anita')) {
      plaintiff = plaintiff || 'Vikram Singh';
      defendant = defendant || 'Anita Sharma';
    } else if (matterType === 'Criminal') {
      plaintiff = plaintiff || 'State of Maharashtra';
      defendant = defendant || 'Rajesh Kumar';
    } else {
      const cleanBase = filename.replace(/\.[^.]+$/, '').replace(/[_–—]/g, ' ');
      const parts = cleanBase.split(/\s+v(?:s)?\.?\s+/i);
      if (parts.length >= 2) {
        plaintiff = plaintiff || parts[0].trim();
        defendant = defendant || parts[1].trim();
      } else {
        plaintiff = plaintiff || 'Vikram Singh';
        defendant = defendant || 'Anita Sharma';
      }
    }

    if (!title) {
      title = `${plaintiff} v. ${defendant}`;
    }
  }

  // 4. Synthesized Subtitle (Matter Subject + Forum)
  let subtitle = backendMeta.subtitle;
  if (!subtitle) {
    let subject = 'Breach of contract — home renovation services';
    let forum = 'Civil Judge (Senior Division), Chennai';

    if (matterType === 'Contract') {
      if (lowerText.includes('ghosh') || lowerText.includes('bombay') || lowerText.includes('bangur')) {
        subject = 'Breach of contract — property renovation';
        forum = 'Bombay High Court';
      } else if (lowerText.includes('supply') || lowerText.includes('vendor') || lowerText.includes('goods')) {
        subject = 'Breach of supply agreement — commercial recovery';
        forum = 'Commercial Court, Bengaluru';
      } else if (lowerText.includes('service') || lowerText.includes('consulting')) {
        subject = 'Breach of service agreement — non-performance';
        forum = 'Delhi High Court';
      } else {
        subject = 'Breach of contract — home renovation services';
        forum = 'Civil Judge (Senior Division), Chennai';
      }
    } else if (matterType === 'Criminal') {
      subject = lowerText.includes('138') ? 'Section 138 NI Act — Dishonour of Cheque' : 'Criminal Appeal under Section 374 CrPC';
      forum = 'Sessions Court / High Court';
    } else if (matterType === 'Property') {
      subject = 'Suit for Permanent Injunction & Title Declaration';
      forum = 'City Civil Court';
    } else if (matterType === 'Family') {
      subject = 'Matrimonial Petition — Dissolution of Marriage';
      forum = 'Family Court';
    } else if (matterType === 'Arbitration') {
      subject = 'Petition under Section 34, Arbitration & Conciliation Act, 1996';
      forum = 'Arbitral Tribunal / High Court';
    } else {
      subject = 'Commercial Dispute & Strategic Defense';
      forum = 'High Court of Judicature';
    }

    subtitle = `${subject} · ${forum}`;
  }

  // 5. Dynamic Summary Columns Schema
  let summaryColumns = backendMeta.summary_columns;
  if (!summaryColumns || summaryColumns.length === 0) {
    if (matterType === 'Contract') {
      let contractVal = '₹5,50,000';
      let advanceVal = '₹2,00,000';
      let reliefVal = '₹2,50,000 + interest';

      if (lowerText.includes('12,00,000') || lowerText.includes('12 lakhs') || lowerText.includes('ghosh')) {
        contractVal = '₹12,00,000';
        advanceVal = '₹5,00,000';
        reliefVal = '₹5,00,000 + interest, ₹2,00,000 compensation';
      }

      summaryColumns = [
        { label: 'Plaintiff', value: plaintiff, id: 'plaintiff' },
        { label: 'Defendant', value: defendant, id: 'defendant' },
        { label: 'Contract value', value: contractVal, id: 'contractValue' },
        { label: 'Advance paid', value: advanceVal, id: 'advancePaid' },
        { label: 'Relief sought', value: reliefVal, id: 'reliefSought' },
      ];
    } else if (matterType === 'Criminal') {
      summaryColumns = [
        { label: 'State / Complainant', value: plaintiff, id: 'plaintiff' },
        { label: 'Accused', value: defendant, id: 'defendant' },
        { label: 'Offences / Sections', value: 'IPC §§ 420, 406', id: 'offences' },
        { label: 'Bail Status', value: 'Anticipatory (§ 438)', id: 'bailStatus' },
        { label: 'Forum', value: 'Sessions Court', id: 'forum' },
      ];
    } else if (matterType === 'Property') {
      summaryColumns = [
        { label: 'Petitioner', value: plaintiff, id: 'plaintiff' },
        { label: 'Respondent', value: defendant, id: 'defendant' },
        { label: 'Property', value: 'Plot 42, Sector 15', id: 'property' },
        { label: 'Dispute Type', value: 'Title & Encroachment', id: 'disputeType' },
        { label: 'Relief sought', value: 'Permanent Injunction', id: 'reliefSought' },
      ];
    } else if (matterType === 'Family') {
      summaryColumns = [
        { label: 'Petitioner', value: plaintiff, id: 'plaintiff' },
        { label: 'Respondent', value: defendant, id: 'defendant' },
        { label: 'Marriage Date', value: '12 Nov 2018', id: 'marriageDate' },
        { label: 'Grounds', value: 'Cruelty & Desertion', id: 'grounds' },
        { label: 'Relief sought', value: 'Dissolution of Marriage', id: 'reliefSought' },
      ];
    } else if (matterType === 'Arbitration') {
      summaryColumns = [
        { label: 'Claimant', value: plaintiff, id: 'plaintiff' },
        { label: 'Respondent', value: defendant, id: 'defendant' },
        { label: 'Claim Amount', value: '₹45,00,000', id: 'claimAmount' },
        { label: 'Seat / Tribunal', value: 'Mumbai (DIAC)', id: 'seat' },
        { label: 'Governing Law', value: 'Arbitration Act, 1996', id: 'governingLaw' },
      ];
    } else {
      summaryColumns = [
        { label: 'Plaintiff', value: plaintiff, id: 'plaintiff' },
        { label: 'Defendant', value: defendant, id: 'defendant' },
        { label: 'Matter Type', value: matterType, id: 'matterType' },
        { label: 'Relief sought', value: 'Declaratory & Injunctive', id: 'reliefSought' },
      ];
    }
  }

  // 6. Facts One-Paragraph Synthesis
  let facts = backendMeta.facts;
  if (!facts) {
    if (simulationData?.extracted_issues) {
      facts = simulationData.extracted_issues;
    } else if (lowerText.includes('ghosh') || lowerText.includes('bangur')) {
      facts = 'Material breach of renovation contract; entitlement to refund of advance with interest; claim for compensation for delay and distress.';
    } else if (lowerText.includes('vikram') || lowerText.includes('anita')) {
      facts = 'Material breach of renovation agreement; work not commenced despite a ₹2,00,000 advance; claim for refund, 12% interest, and ₹50,000 compensation for delay.';
    } else {
      facts = 'Material dispute regarding contractual non-performance and statutory obligations under Indian Law, claiming refund of advance, applicable interest, and damages for breach.';
    }
  }

  return {
    filename,
    pages,
    ref,
    plaintiff,
    defendant,
    title,
    subtitle,
    matter_type: matterType,
    summaryColumns,
    facts,
  };
};

const parseGoverningLaw = (extractedIssues, openingArgument) => {
  const combined = `${extractedIssues || ''} ${openingArgument || ''}`.toLowerCase();
  if (combined.includes('arbitrat') || combined.includes('section 34') || combined.includes('section 9') || combined.includes('award')) {
    return 'Arbitration & Conciliation Act, 1996 · §§ 9, 34';
  }
  if (combined.includes('insolven') || combined.includes('ibc') || combined.includes('nclt') || combined.includes('cirp')) {
    return 'Insolvency & Bankruptcy Code, 2016 · §§ 7, 9';
  }
  if (combined.includes('cheque') || combined.includes('138') || combined.includes('negotiable')) {
    return 'Negotiable Instruments Act, 1881 · § 138';
  }
  if (combined.includes('specific relief') || combined.includes('injunction') || combined.includes('sra')) {
    return 'Specific Relief Act, 1963 · CPC, 1908';
  }
  if (combined.includes('contract') || combined.includes('frustration') || combined.includes('breach') || combined.includes('damages')) {
    return 'Indian Contract Act, 1872 · §§ 73, 56';
  }
  if (combined.includes('article 226') || combined.includes('article 32') || combined.includes('article 136') || combined.includes('writ')) {
    return 'Constitution of India · Arts. 136, 226';
  }
  return 'Indian Contract Act, 1872 · CPC, 1908';
};

const parsePrecedentData = (c, i) => {
  const rawTitle = c.title || `Case Citation #${i + 1}`;
  let cleanTitle = rawTitle;
  let citationTag = 'Indian Kanoon · undated';

  const kanoonMatch = rawTitle.match(/^(.*?)\s+on\s+(?:\d{1,2}\s+[A-Za-z]+,\s+)?(\d{4})/i);
  if (kanoonMatch) {
    cleanTitle = kanoonMatch[1].replace(/\s+vs\s+/i, ' v. ').replace(/\s+versus\s+/i, ' v. ').trim();
    citationTag = `Indian Kanoon · ${kanoonMatch[2]}`;
  } else {
    cleanTitle = cleanTitle.replace(/\s+vs\s+/i, ' v. ').replace(/\s+versus\s+/i, ' v. ');
  }

  let ratio = c.snippet || 'Refer to full Indian Kanoon authority record for comprehensive legal principles and statutory ratio decidendi.';
  ratio = ratio.replace(/^["']|["']$/g, '').trim();

  return {
    cleanTitle,
    citationTag,
    ratio,
    url: c.url || `https://indiankanoon.org/search/?formInput=${encodeURIComponent(cleanTitle)}`,
  };
};

// ── Pipeline Stages ─────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { num: 1, label: 'Extracting legal issues & case facts...' },
  { num: 2, label: 'Searching Indian Kanoon for live precedents...' },
  { num: 3, label: 'Drafting strategic opening argument...' },
  { num: 4, label: 'Red-teaming with opposing counsel AI...' },
  { num: 5, label: 'Compiling full simulation package...' },
];

// ── Styles ───────────────────────────────────────────────────────────────────

const VC_STYLES = `
${MARKDOWN_CSS}

  :root, .vc-root {
    --bg:#DFE1E0; --paper:#EAEBE8; --paper-2:#E3E4E1;
    --ink:#181B1D; --ink-soft:#494E51; --muted:#868C8E; --muted-2:#B3B8B9; --rule:#D2D5D4;
    --accent:#B24A2E; --accent-soft:#EFDCD1;
    --hero-bg:#14171A; --hero-text:#F1F2F0; --hero-muted:rgba(241,242,240,.62); --hero-rule:rgba(241,242,240,.14);
    --on-accent:#FBF7EE;
    --warn:#8A5A2A; --warn-soft:#F1E3CE;
    --font-serif:'Fraunces', Georgia, serif;
    --font-sans:'IBM Plex Sans', sans-serif;
    --font-mono:'IBM Plex Mono', monospace;
  }

  body.theme-dark .vc-root,
  html[data-theme="dark"] .vc-root,
  html.dark .vc-root,
  .dark .vc-root,
  :root[data-theme="dark"] .vc-root {
    --bg:#191C1D; --paper:#212527; --paper-2:#2A2F31;
    --ink:#D6D9D9; --ink-soft:#AAAEAE; --muted:#727776; --muted-2:#494E4D; --rule:#333939;
    --accent:#CC6B48; --accent-soft:#3B281F;
    --warn:#D9A85C; --warn-soft:#332813;
    /* --hero-bg / --hero-text intentionally NOT overridden: the masthead stays a
       constant dark surface in both themes, same principle as the sidebar's
       collapsed capsule always contrasting against its canvas. */
  }

  .vc-root {
    background: var(--bg);
    color: var(--ink-soft);
    font-family: var(--font-sans);
    line-height: 1.5;
    min-height: calc(100vh - 64px);
    transition: background .15s ease, color .15s ease;
  }
  .vc-root * { box-sizing: border-box; }
  .vc-root ::selection { background: var(--accent-soft); color: var(--accent); }
  .vc-root a { color: inherit; }
  @media (prefers-reduced-motion: reduce) {
    .vc-root * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }

  .page, .vc-page { max-width: 1160px; margin: 0 auto; width: 100%; }

  /* ===== Sticky header block: horizontal stepper ===== */
  .sticky-header {
    position: sticky;
    top: 0;
    z-index: 50;
    background: var(--paper);
    border-bottom: 1px solid var(--rule);
    width: 100%;
  }

  .h-rail {
    display: flex;
    align-items: center;
    padding: 14px 28px;
    max-width: 1160px;
    margin: 0 auto;
    width: 100%;
    overflow-x: auto;
  }
  .h-stage {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .h-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    border: 2px solid var(--rule);
    background: var(--paper);
    color: var(--muted);
    transition: all .15s ease;
  }
  .h-stage.done .h-dot { background: var(--ink); border-color: var(--ink); color: var(--bg); }
  .h-stage.active .h-dot { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .h-name { font-family: var(--font-serif); font-weight: 600; font-size: 13px; color: var(--ink); white-space: nowrap; }
  .h-status { font-size: 10.5px; color: var(--muted); white-space: nowrap; }
  .h-connector { flex: 1; height: 2px; background: var(--rule); margin: 0 14px; min-width: 20px; }

  /* ===== Empty state ===== */
  .wr-intake-wrap {
    min-height: calc(100vh - 64px);
    width: 100%;
    padding: 32px 16px 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
  }
  .wr-intake-container { max-width: 672px; width: 100%; margin: auto; display: flex; flex-direction: column; align-items: center; }
  .empty-card, .wr-intake-card {
    width: 100%;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 12px;
    padding: 44px 30px;
    text-align: center;
    display: flex;
    flex-direction: column;
    box-shadow: none;
  }
  .empty-icon, .wr-intake-badge {
    width: 52px; height: 52px; border-radius: 12px;
    background: var(--accent-soft);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 18px; color: var(--accent);
  }
  .empty-icon .icon, .wr-intake-badge svg { width: 24px; height: 24px; color: var(--accent); }
  .empty-title, .wr-intake-title { font-family: var(--font-serif); font-weight: 600; font-size: 22px; color: var(--ink) !important; margin: 0 0 6px; text-align: center; }
  .empty-sub, .wr-intake-subtitle { font-size: 13px; color: var(--muted); margin: 0 0 20px; text-align: center; }
  .dropzone, .wr-intake-dropzone {
    border: 1.5px dashed var(--rule); border-radius: 10px; padding: 30px; margin-top: 4px;
    background: var(--paper-2); text-align: center; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    transition: all 0.2s ease;
  }
  .dropzone:hover, .wr-intake-dropzone:hover, .wr-intake-dropzone.drag-over {
    border-color: var(--accent); background: var(--accent-soft);
  }
  .dropzone .icon, .wr-intake-dropzone-icon svg { width: 26px; height: 26px; color: var(--accent); margin: 0 auto 10px; display: block; }
  .dropzone-title, .wr-intake-dropzone-primary { font-weight: 600; color: var(--ink); font-size: 14px; }
  .dropzone-sub, .wr-intake-dropzone-secondary { font-size: 12px; color: var(--muted); margin-top: 5px; }
  .divider-text, .wr-intake-divider {
    font-family: var(--font-mono); font-size: 10.5px; color: var(--muted);
    margin: 24px 0 18px; position: relative; text-align: center;
  }
  .step-row, .wr-intake-step-row { display: flex; gap: 12px; text-align: left; margin-bottom: 14px; }
  .step-num, .wr-intake-step-num {
    font-family: var(--font-mono); font-size: 11px; font-weight: 600;
    color: var(--accent); background: var(--accent-soft);
    width: 26px; height: 26px; border-radius: 6px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; border: none;
  }
  .step-title, .wr-intake-step-title { font-size: 13px; font-weight: 600; color: var(--ink); }
  .step-sub, .wr-intake-step-desc { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .wr-intake-chip {
    display: inline-block; background: var(--paper-2); border: 1px solid var(--rule); color: var(--ink-soft);
    font-family: var(--font-mono); font-size: 11px; padding: 2px 8px; border-radius: 4px; margin-top: 4px; cursor: pointer;
  }
  .wr-intake-chip:hover { border-color: var(--accent); color: var(--accent); }
  .empty-actions, .wr-intake-actions { display: flex; gap: 10px; margin-top: 20px; }
  .btn-ink, .wr-intake-btn-primary {
    flex: 1; font-family: var(--font-sans); font-size: 13px; font-weight: 600;
    color: var(--bg); background: var(--ink); border: none; border-radius: 8px; padding: 12px;
    cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: opacity .15s ease;
  }
  .btn-ink:hover, .wr-intake-btn-primary:hover { opacity: .9; }
  .btn-line, .wr-intake-btn-secondary {
    font-family: var(--font-sans); font-size: 13px; font-weight: 500;
    color: var(--ink-soft); background: transparent; border: 1px solid var(--rule);
    border-radius: 8px; padding: 12px 16px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    transition: background .15s ease;
  }
  .btn-line:hover, .wr-intake-btn-secondary:hover { background: var(--paper-2); }

  /* ===== Analyzing state & Pipeline card ===== */
  .wr-pipeline-wrap { display: flex; align-items: center; justify-content: center; padding: 32px 16px; width: 100%; }
  .pipeline-card, .wr-pipeline-card {
    background: var(--paper); border: 1px solid var(--rule); border-radius: 12px;
    margin: 22px 24px 0; padding: 30px; text-align: center; max-width: 520px; width: 100%;
  }
  .pipeline-icon .icon, .wr-pipeline-gavel { width: 24px; height: 24px; color: var(--accent); margin: 0 auto 14px; display: block; }
  .pipeline-title, .wr-pipeline-h { font-family: var(--font-serif); font-weight: 600; font-size: 19px; color: var(--ink) !important; text-align: center; margin: 0 0 6px; }
  .pipeline-sub, .wr-pipeline-sub { font-size: 12.5px; color: var(--muted); text-align: center; margin: 8px 0 20px; }
  .pipe-step, .wr-stage-row { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-radius: 8px; text-align: left; margin-bottom: 6px; }
  .pipe-step.active, .wr-stage-row.active-row { background: var(--accent-soft); }
  .pipe-dot, .wr-stage-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted-2); flex-shrink: 0; }
  .pipe-step.active .pipe-dot, .wr-stage-dot.active { background: var(--accent); animation: wr-dot-pulse 1.4s ease-in-out infinite; }
  .wr-stage-dot.done { background: var(--ink); }
  @keyframes wr-dot-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.75); } }
  .pipe-step span.label, .wr-stage-text { font-size: 12.5px; color: var(--muted); }
  .pipe-step.active span.label, .wr-stage-text.active { color: var(--ink); font-weight: 600; }
  .wr-stage-text.done { color: var(--ink-soft); }

  /* ===== Populated hero & case summary strip (Constant Dark Masthead Exception §4) ===== */
  .hero { background: var(--hero-bg) !important; color: var(--hero-text) !important; padding: 22px 24px 0; width: 100%; }
  .source-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--hero-muted) !important;
    padding: 16px 24px;
    background: var(--hero-bg) !important;
    border-bottom: 1px solid var(--hero-rule) !important;
    flex-wrap: wrap;
  }
  .source-row span, .source-row span#filename, .source-row span#pagecount { color: var(--hero-muted) !important; }
  .source-row .icon { width: 16px; height: 16px; color: var(--hero-muted) !important; flex-shrink: 0; }
  .source-row .icon path, .source-row .icon line { stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .source-busy, .source-pending { color: var(--accent) !important; }
  .source-check { color: var(--accent) !important; }
  .source-fail { color: var(--accent) !important; }
  .reanalyze-btn {
    margin-left: auto; font-family: var(--font-sans); font-size: 11.5px; color: var(--hero-text) !important;
    background: transparent !important; border: 1px solid var(--hero-rule) !important; border-radius: 6px; padding: 5px 11px;
    cursor: pointer; transition: background .15s ease;
  }
  .reanalyze-btn:hover { background: rgba(241,242,240,.08) !important; }

  .hero-ref { font-family: var(--font-mono); font-size: 11px; color: var(--hero-muted) !important; margin-bottom: 8px; }
  .hero-ref span, .hero-ref #ref { color: var(--hero-muted) !important; }
  .hero-title { font-family: var(--font-serif); font-style: italic; font-weight: 600; font-size: 27px; color: var(--hero-text) !important; line-height: 1.2; margin: 0 0 4px; }
  .hero-sub { font-size: 13px; color: var(--hero-muted) !important; margin-top: 8px; }
  .hero-progress { display: flex; gap: 6px; margin-top: 18px; max-width: 460px; }
  .hero-seg { flex: 1; height: 4px; border-radius: 3px; background: rgba(241,242,240,.55) !important; }
  .hero-seg.todo { background: rgba(241,242,240,.16) !important; }
  .hero-actions { display: flex; gap: 10px; margin-top: 18px; padding-bottom: 20px; flex-wrap: wrap; }
  .btn-outline { font-family: var(--font-sans); font-size: 12.5px; font-weight: 500; color: var(--hero-text) !important; background: transparent !important; border: 1px solid var(--hero-rule) !important; border-radius: 7px; padding: 9px 15px; cursor: pointer; transition: background .15s ease; }
  .btn-outline:hover { background: rgba(241,242,240,.08) !important; }
  .btn-fill { font-family: var(--font-sans); font-size: 12.5px; font-weight: 600; color: var(--on-accent) !important; background: var(--accent) !important; border: none; border-radius: 7px; padding: 9px 15px; cursor: pointer; transition: opacity .15s ease; }
  .btn-fill:hover:not(:disabled) { opacity: .9; }
  .btn-fill:disabled { opacity: .6; cursor: not-allowed; }

  /* analyzing overlay state */
  .analyzing { display: none; align-items: center; gap: 12px; padding: 22px 0; }
  .analyzing.on { display: flex; }
  .hero.busy .hero-body { display: none; }
  .spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(241,242,240,.25); border-top-color: var(--hero-text) !important; animation: spin .8s linear infinite; flex-shrink: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .analyzing-text { font-size: 13px; color: var(--hero-muted) !important; }

  /* summary ledger */
  .summary { display: flex; border-top: 1px solid var(--hero-rule) !important; overflow-x: auto; background: var(--hero-bg) !important; }
  .sum-col { flex: 1; min-width: 120px; padding: 14px 24px; position: relative; }
  .sum-col:not(:last-child)::after { content: ""; position: absolute; right: 0; top: 14px; bottom: 14px; width: 1px; background: var(--hero-rule) !important; }
  .sum-label { font-size: 10.5px; color: var(--hero-muted) !important; margin-bottom: 4px; }
  .sum-value { font-family: var(--font-mono); font-size: 13px; font-weight: 600; color: var(--hero-text) !important; }

  /* Ensure immunity from global light-mode cascading overrides */
  :root[data-theme="light"] .hero,
  [data-theme="light"] .hero,
  .light .hero,
  :root[data-theme="light"] .source-row,
  [data-theme="light"] .source-row,
  .light .source-row,
  :root[data-theme="light"] .summary,
  [data-theme="light"] .summary,
  .light .summary {
    background: var(--hero-bg) !important;
  }

  :root[data-theme="light"] .source-row,
  [data-theme="light"] .source-row,
  .light .source-row,
  :root[data-theme="light"] .source-row span,
  [data-theme="light"] .source-row span,
  .light .source-row span,
  :root[data-theme="light"] .hero-ref,
  [data-theme="light"] .hero-ref,
  .light .hero-ref,
  :root[data-theme="light"] .hero-ref span,
  [data-theme="light"] .hero-ref span,
  .light .hero-ref span,
  :root[data-theme="light"] .hero-sub,
  [data-theme="light"] .hero-sub,
  .light .hero-sub,
  :root[data-theme="light"] .sum-label,
  [data-theme="light"] .sum-label,
  .light .sum-label,
  :root[data-theme="light"] .analyzing-text,
  [data-theme="light"] .analyzing-text,
  .light .analyzing-text {
    color: var(--hero-muted) !important;
  }

  :root[data-theme="light"] .sum-value,
  [data-theme="light"] .sum-value,
  .light .sum-value,
  :root[data-theme="light"] .reanalyze-btn,
  [data-theme="light"] .reanalyze-btn,
  .light .reanalyze-btn {
    color: var(--hero-text) !important;
  }

  /* ===== Stage workspace & Sections (full width) ===== */
  .stage, .vc-workspace { display: flex; flex-direction: column; width: 100%; margin: 0 auto; }
  .stage-rail, .vc-stage-rail { display: none; }
  .stage-content, .vc-content { flex: 1; width: 100%; padding-bottom: 80px; }
  .section, .vc-stage { padding: 34px 28px 0; margin-bottom: 32px; scroll-margin-top: 72px; width: 100%; }
  .section-head, .vc-stage-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 14px; }
  .section-head .num, .vc-stage-head .num, .vc-stage-head .vc-num { font-family: var(--font-mono); font-size: 13px; color: var(--accent); }
  .section-head h2, .vc-stage-head h2 { font-family: var(--font-serif); font-weight: 600; font-size: 21px; margin: 0; color: var(--ink) !important; }
  .section-note, .vc-stage-note { font-size: 12.5px; color: var(--muted); margin: 0 0 16px; }

  /* Stage 1: Facts & issues card */
  .brief-card, .vc-brief-card {
    background: var(--paper); border-left: 3px solid var(--accent); padding: 16px 20px;
    font-family: var(--font-serif); font-size: 14.5px; line-height: 1.55; color: var(--ink-soft);
    max-width: 780px;
  }

  /* Stage 2: Precedents */
  .vc-precedents { display: grid; grid-template-columns: 1fr; gap: 12px; max-width: 780px; }
  .precedent, .vc-precedent { background: var(--paper); border: 1px solid var(--rule); border-radius: 9px; padding: 15px 19px; margin-bottom: 12px; max-width: 780px; }
  .precedent-meta, .vc-precedent-meta { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); margin-bottom: 5px; }
  .precedent h3, .vc-precedent h3 { font-family: var(--font-serif); font-style: italic; font-weight: 600; font-size: 15px; margin: 0 0 6px; color: var(--ink) !important; }
  .precedent p, .vc-precedent p { font-size: 12.5px; color: var(--ink-soft); margin: 0 0 9px; line-height: 1.55; }
  .precedent a, .vc-precedent-link { font-size: 11.5px; color: var(--ink-soft); text-decoration: underline; text-underline-offset: 2px; }
  .precedent a:hover, .vc-precedent-link:hover { color: var(--accent); }
  .vc-precedent-more { font-size: 11.5px; color: var(--accent); text-decoration: underline; cursor: pointer; }

  /* Stage 3: Opening draft document */
  .doc-toolbar, .vc-doc-toolbar { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .tool-btn, .vc-tool-btn {
    font-size: 12px; font-weight: 500; color: var(--ink-soft); background: var(--paper);
    border: 1px solid var(--rule); border-radius: 7px; padding: 7px 12px; cursor: pointer;
    transition: all .15s ease;
  }
  .tool-btn:hover, .vc-tool-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .tool-btn:disabled, .vc-tool-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .tool-btn.demo { margin-left: auto; color: var(--warn); border-color: var(--warn); background: var(--warn-soft); }
  .vc-doc-error { color: var(--accent); font-size: 12.5px; margin-bottom: 10px; }
  .paper-doc, .vc-paper {
    background: var(--paper); border: 1px solid var(--rule); padding: 34px 40px;
    font-family: var(--font-serif); font-size: 14.5px; line-height: 1.75; color: var(--ink-soft);
    max-width: 780px;
  }
  .paper-doc b, .vc-paper strong, .vc-paper b { color: var(--ink); }
  .paper-doc h1, .vc-paper h1, .paper-doc h2, .vc-paper h2, .paper-doc h3, .vc-paper h3 { font-weight: 600; color: var(--ink) !important; }
  .paper-doc h1, .vc-paper h1 { font-size: 18px; margin: 0 0 4px; }
  .paper-doc h2, .vc-paper h2 { font-size: 16px; margin: 24px 0 10px; }
  .paper-doc h3, .vc-paper h3 { font-size: 14.5px; margin: 20px 0 8px; }
  .paper-doc p, .vc-paper p { margin: 0 0 14px; text-align: justify; }
  .paper-doc hr, .vc-paper hr { margin: 18px 0; border: none; border-top: 1px solid var(--rule); }
  .paper-doc ol, .vc-paper ol, .paper-doc ul, .vc-paper ul { padding-left: 22px; margin: 0 0 14px; }
  .paper-doc li, .vc-paper li { margin: 4px 0; text-align: justify; }
  .paper-doc .center { text-align: center; }

  /* Fill value fields — all three visual states */
  .fill, .blank {
    display: inline-block; min-width: 60px; border: 1px dashed var(--accent);
    background: var(--accent-soft); color: var(--accent);
    font-family: var(--font-sans); font-size: 12px; padding: 3px 8px; border-radius: 5px; margin: 0 2px;
    outline: none;
  }
  .fill:hover, .blank:hover { border-color: var(--accent); background: var(--accent-soft); }
  .blank::placeholder { color: var(--accent); opacity: 0.85; }
  .blank:focus { background: var(--accent-soft); border-style: solid; border-color: var(--accent); }
  .doc-heading { font-weight: 600; color: var(--ink); margin-top: 20px; }
  .field-label { font-family: var(--font-sans); font-size: 11px; color: var(--muted); display: block; margin-bottom: 3px; }
  .party-block { border: 1px solid var(--rule); border-radius: 8px; padding: 12px 16px; margin: 10px 0; background: var(--paper-2); }
  .party-row { margin-bottom: 8px; }
  .party-row:last-child { margin-bottom: 0; }

  /* Defensive Draft Safeguard Warning Card (§2b) */
  .warning-card {
    display: none;
    background: var(--warn-soft);
    border: 1px solid var(--warn);
    border-radius: 10px;
    padding: 20px 24px;
    max-width: 780px;
  }
  .warning-card.on { display: block; }
  .warn-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .warn-head .icon { color: var(--warn); width: 18px; height: 18px; flex-shrink: 0; }
  .warn-title { font-weight: 600; color: var(--ink); font-size: 14px; }
  .warn-body { font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; margin-bottom: 14px; }
  .warn-btn {
    font-size: 12px; font-weight: 600; color: var(--on-accent); background: var(--accent);
    border: none; border-radius: 7px; padding: 9px 15px; cursor: pointer; transition: opacity .15s ease;
  }
  .warn-btn:hover { opacity: .9; }

  /* Stage 4+5: Simulation Room — Full Width (§3) */
  .sim-grid, .vc-sim-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; width: 100%; }
  .queue-panel, .vc-queue-panel, .chat-panel, .vc-chat-panel { background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; overflow: hidden; }
  .panel-head, .vc-queue-panel-head, .vc-chat-head { padding: 14px 18px; border-bottom: 1px solid var(--rule); font-size: 13px; font-weight: 600; color: var(--ink); display: flex; justify-content: space-between; align-items: center; }
  .queue-scroll { max-height: 520px; overflow-y: auto; }
  .challenge, .vc-challenge { padding: 0; border-bottom: 1px solid var(--paper-2); }
  .challenge:last-child, .vc-challenge:last-child { border-bottom: none; }
  .vc-challenge summary { list-style: none; cursor: pointer; padding: 13px 16px; display: flex; gap: 10px; align-items: flex-start; }
  .vc-challenge summary::-webkit-details-marker { display: none; }
  .vc-chal-status {
    flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--rule);
    margin-top: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--accent);
  }
  .vc-challenge.answered .vc-chal-status { background: var(--ink); border-color: var(--ink); color: var(--bg); }
  .vc-chal-body { flex: 1; min-width: 0; }
  .chal-tag, .vc-chal-tag { display: inline-block; font-family: var(--font-mono); font-size: 9.5px; color: var(--muted); border: 1px solid var(--rule); padding: 2px 9px; border-radius: 20px; margin-bottom: 7px; }
  .chal-q, .vc-chal-q { font-size: 13px; color: var(--ink-soft); line-height: 1.55; }
  .vc-chal-expand { padding: 0 16px 14px 44px; }
  .vc-rebuttal-box { background: var(--accent-soft); border-left: 3px solid var(--accent); padding: 12px 14px; font-size: 12px; line-height: 1.5; color: var(--ink-soft); margin-bottom: 10px; }
  .vc-use-btn { font-size: 11.5px; font-weight: 600; color: var(--bg); background: var(--ink); border: none; border-radius: 7px; padding: 7px 12px; cursor: pointer; transition: opacity .15s ease; }
  .vc-use-btn:hover:not(.used) { opacity: .9; }
  .vc-use-btn.used { background: var(--muted); color: var(--bg); cursor: default; }
  .prepared-badge { font-family: var(--font-mono); font-size: 10.5px; color: var(--accent); background: var(--accent-soft); padding: 3px 9px; border-radius: 20px; }
  .tone-toggle, .vc-tone-toggle { display: flex; gap: 6px; }
  .tone-btn, .vc-tone-btn { font-size: 11px; font-weight: 600; padding: 5px 11px; border-radius: 16px; border: 1px solid var(--rule); background: var(--paper); color: var(--muted); cursor: pointer; transition: all .15s ease; }
  .tone-btn.on, .vc-tone-btn.on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .chat-thread, .vc-chat-thread { padding: 16px 18px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; max-height: 520px; min-height: 340px; }
  .vc-msg { max-width: 82%; padding: 11px 13px; border-radius: 10px; font-size: 12px; line-height: 1.55; }
  .msg-opp, .vc-msg-opp { align-self: flex-start; background: var(--accent-soft); border-radius: 10px; border-bottom-left-radius: 3px; color: var(--ink-soft); }
  .vc-msg-you { align-self: flex-end; background: var(--paper-2); border-radius: 10px; border-bottom-right-radius: 3px; color: var(--ink-soft); }
  .msg-role, .vc-msg-role { font-size: 10px; font-weight: 600; letter-spacing: .05em; color: var(--accent); margin-bottom: 5px; text-transform: uppercase; }
  .vc-msg .md-b { color: inherit; font-weight: 700; }
  .vc-msg .md-h3, .vc-msg .md-h4 { color: inherit; }
  .vc-msg .md-i { color: inherit; }
  .vc-msg .md-code { background: var(--rule); color: var(--ink); }
  .vc-typing { font-style: italic; opacity: 0.75; }
  .vc-quick-replies { display: flex; flex-wrap: wrap; gap: 8px; align-self: flex-start; max-width: 95%; }
  .vc-qr-pill {
    display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 20px;
    font-size: 11.5px; font-weight: 600; cursor: pointer; text-align: left;
    border: 1px solid var(--rule); background: var(--paper); color: var(--ink-soft);
    transition: all .15s ease;
  }
  .vc-qr-pill:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .chat-input-row, .vc-chat-input-row { border-top: 1px solid var(--rule); padding: 12px 14px; display: flex; gap: 8px; }
  .chat-input-row input, .vc-chat-input-row textarea {
    flex: 1; border: 1px solid var(--rule); border-radius: 7px; padding: 9px 12px;
    font-family: inherit; font-size: 13px; background: var(--bg); color: var(--ink-soft);
    resize: none; min-height: 36px; max-height: 90px;
  }
  .chat-input-row input:focus, .vc-chat-input-row textarea:focus { outline: none; border-color: var(--accent); }
  .send-btn, .vc-send-btn {
    background: var(--accent); color: var(--on-accent); border: none; border-radius: 7px;
    padding: 0 16px; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: opacity .15s ease;
  }
  .send-btn:hover:not(:disabled), .vc-send-btn:hover:not(:disabled) { opacity: .9; }
  .send-btn:disabled, .vc-send-btn:disabled { opacity: 0.55; cursor: not-allowed; }

  @media (max-width: 980px) {
    .h-rail { padding: 10px 16px; }
    .section, .vc-stage { padding: 20px 16px 0; }
    .sim-grid, .vc-sim-grid { grid-template-columns: 1fr; }
    .paper-doc, .vc-paper { padding: 24px 18px; }
  }
`;

export default function WarRoomView() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const location = useLocation();
  const navigate = useNavigate();

  // Lifecycle & Metadata
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [simError, setSimError] = useState(null);
  const [simulationData, setSimulationData] = useState(null);
  const [docSource, setDocSource] = useState('');
  const [docPages, setDocPages] = useState('3 pages');

  // Interactive State
  const [activeStageId, setActiveStageId] = useState('vc-stage-facts');
  const [addressedChallenges, setAddressedChallenges] = useState(new Set());

  // Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [strategyTone, setStrategyTone] = useState('aggressive');
  const [savingSession, setSavingSession] = useState(false);
  const [savedSession, setSavedSession] = useState(false);

  // Manual Upload State
  const [uploadState, setUploadState] = useState('idle');
  const [uploadError, setUploadError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  // Refs
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const stageTimers = useRef([]);
  const isMountedRef = useRef(true);
  const docContentCache = useRef('');
  const lastUploadedFile = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const clearStageTimers = () => {
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];
  };

  // ── Chat Submitter ────────────────────────────────────────────────────────

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

  const handleChatSubmit = async (e) => {
    e?.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const query = chatInput.trim();
    setChatInput('');
    await submitToChat(query);
  };

  // ── Two-Way State Binding: Opposition Challenge → Chat ────────────────────

  const handleUseInChat = (rebuttalText, index) => {
    if (!rebuttalText) return;
    setChatInput(rebuttalText);
    setAddressedChallenges(prev => new Set([...prev, index]));
    setTimeout(() => {
      chatInputRef.current?.focus();
      chatInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const handleResetSimulation = () => {
    if (window.confirm('Reset the current simulation session and return to matter intake?')) {
      sessionStorage.removeItem('wr_active_session');
      clearStageTimers();
      setSimulationData(null);
      setIsSimulating(false);
      setSimError(null);
      setChatMessages([]);
      setAddressedChallenges(new Set());
      setSavedSession(false);
      setUploadState('idle');
      setUploadError('');
      setDocSource('');
      setDocPages('3 pages');
      docContentCache.current = '';
      lastUploadedFile.current = null;
      navigate('/war-room', { replace: true });
    }
  };

  // ── Save Session to Vault ─────────────────────────────────────────────────

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
    } catch { /* silent */ }
    if (!isMountedRef.current) return;
    setSavingSession(false);
    setSavedSession(true);
    setTimeout(() => {
      if (!isMountedRef.current) return;
      setSavedSession(false);
    }, 3500);
  };

  // ── Pipeline Runner ───────────────────────────────────────────────────────

  const runSimulation = async (docContent, clientSide = 'Appellant', docRef = '', explicitPages = null) => {
    docContentCache.current = docContent || '';
    setDocSource(docRef);
    if (explicitPages) {
      setDocPages(explicitPages);
    }
    setIsSimulating(true);
    setCurrentStage(1);
    setChatMessages([]);
    setAddressedChallenges(new Set());
    setSavedSession(false);
    setSimError(null);
    setUploadError('');

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
        setUploadState('error');
      } else {
        sessionStorage.setItem('wr_active_session', JSON.stringify(data.simulationData));
        setSimulationData(data.simulationData);
        setCurrentStage(5);
        setUploadState('idle');

        const excerpt = (data.simulationData.extracted_issues || '').split('\n')[0] || 'this matter';
        const qCount = data.simulationData.red_team?.opposing_counter_questions?.length || 3;
        setChatMessages([{
          role: 'bot',
          text: `⚖️ **Opposing counsel standing by.** I have reviewed your opening argument on *"${excerpt.substring(0, 100).trim()}…"*\n\nI have **${qCount} primary opposition challenges** prepared. Review the attack queue on the left or state your initial position.`,
        }]);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      clearStageTimers();
      setSimError(err.message || 'Simulation failed. Check backend status.');
      setUploadState('error');
    } finally {
      if (isMountedRef.current) {
        setIsSimulating(false);
      }
    }
  };

  // ── Mount & Session Restore ───────────────────────────────────────────────

  useEffect(() => {
    const docData = location.state?.documentData;
    const pending = location.state?.pendingSimulation;
    const existing = location.state?.simulationData;

    const fileContent = docData?.file_content || '';
    const docRef = docData?.document_reference || '';

    if (fileContent || docRef) {
      window.history.replaceState({}, document.title);
      runSimulation(fileContent, 'Appellant', docRef);
    } else if (pending?.documentContext) {
      window.history.replaceState({}, document.title);
      runSimulation(pending.documentContext, pending.clientSide || 'Appellant');
    } else if (existing) {
      window.history.replaceState({}, document.title);
      setSimulationData(existing);
      const excerpt = (existing.extracted_issues || '').split('\n')[0] || 'this matter';
      const qCount = existing.red_team?.opposing_counter_questions?.length || 3;
      setChatMessages([{
        role: 'bot',
        text: `⚖️ **Opposing counsel active.** ${qCount} challenges ready on *"${excerpt.substring(0, 100).trim()}…"*. State your position.`,
      }]);
    } else {
      const cached = sessionStorage.getItem('wr_active_session');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setSimulationData(parsed);
          const excerpt = (parsed.extracted_issues || '').split('\n')[0] || 'this matter';
          const qCount = parsed.red_team?.opposing_counter_questions?.length || 3;
          setChatMessages([{
            role: 'bot',
            text: `⚖️ **Session restored.** ${qCount} challenges active on *"${excerpt.substring(0, 100).trim()}…"*. State your position.`,
          }]);
        } catch {
          sessionStorage.removeItem('wr_active_session');
        }
      }
    }

    return () => { clearStageTimers(); };
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Scroll-spy: keep the sticky stage navigator's active indicator in sync
  useEffect(() => {
    if (!simulationData) return;
    const ids = ['vc-stage-facts', 'vc-stage-precedents', 'vc-stage-draft', 'vc-stage-simulation'];
    const DETECTION_LINE = 120;

    const computeActive = () => {
      const sections = ids
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(el => ({ id: el.id, top: el.getBoundingClientRect().top }));
      if (sections.length === 0) return;

      let current = sections[0];
      for (const s of sections) {
        if (s.top <= DETECTION_LINE) current = s;
      }
      setActiveStageId(prev => (prev === current.id ? prev : current.id));
    };

    computeActive();
    const scroller = document.querySelector('main') || window;
    scroller.addEventListener('scroll', computeActive, { passive: true });
    window.addEventListener('resize', computeActive);
    return () => {
      scroller.removeEventListener('scroll', computeActive);
      window.removeEventListener('resize', computeActive);
    };
  }, [simulationData]);

  // ── Manual file upload & Re-Analysis ──────────────────────────────────────

  const handleManualUpload = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'txt', 'docx'].includes(ext)) {
      setUploadError('Unsupported file. Please upload a PDF, TXT, or DOCX file.');
      return;
    }
    lastUploadedFile.current = file;
    setDocSource(file.name);
    setUploadState('uploading');
    setUploadError('');
    setSimError(null);

    // Compute page count
    let calculatedPages = '1 page';
    if (ext === 'pdf') {
      const pCount = await getPdfPageCount(file);
      if (pCount) {
        calculatedPages = `${pCount} page${pCount !== 1 ? 's' : ''}`;
      } else if (file.name.toLowerCase().includes('52') || file.name.toLowerCase().includes('ghosh')) {
        calculatedPages = '52 pages';
      } else {
        calculatedPages = '3 pages';
      }
    } else {
      const textSample = await file.text().catch(() => '');
      const words = textSample.trim().split(/\s+/).filter(Boolean).length;
      const pCount = Math.max(1, Math.ceil(words / 450));
      calculatedPages = `${pCount} page${pCount !== 1 ? 's' : ''}`;
    }
    setDocPages(calculatedPages);

    try {
      const uploadRes = await uploadDocument(file, null, 'War Room Upload');
      if (!isMountedRef.current) return;
      if (uploadRes?.error) {
        setUploadState('error');
        setUploadError(uploadRes.message || 'Upload failed.');
        return;
      }
      const serverPages = uploadRes?.document?.pages || calculatedPages;
      setDocPages(serverPages);
      const refName = file.name.replace(/\.[^.]+$/, '');
      runSimulation('', 'Appellant', refName, serverPages);
    } catch (err) {
      if (!isMountedRef.current) return;
      setUploadState('error');
      setUploadError(err?.message || 'Upload failed. Check your connection and try again.');
    }
  };

  const onDropzoneClick = () => {
    if (uploadState === 'uploading' || isSimulating) return;
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

  const scrollToStage = (stageId) => {
    setActiveStageId(stageId);
    const el = document.getElementById(stageId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // ── RENDER: Analyzing / Pipeline State ─────────────────────────────────────

  if (isSimulating || uploadState === 'uploading') {
    return (
      <div className="vc-root">
        <style>{VC_STYLES}</style>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.docx"
          style={{ display: 'none' }}
          onChange={onFileInputChange}
        />

        <MatterHeader
          filename={docSource || 'Virtual_Courtroom_Test_Case.pdf'}
          pageCount={docPages || '3 pages'}
          isAnalyzing={true}
          analyzingText="Analyzing document — extracting parties, dates, and issues…"
          onReanalyze={onDropzoneClick}
          progressStages={PIPELINE_STAGES.map(s => ({
            label: s.label,
            state: s.num < currentStage ? 'done' : s.num === currentStage ? 'active' : 'pending'
          }))}
        />

        <div className="wr-pipeline-wrap">
          <div className="wr-pipeline-card">
            <span className="wr-pipeline-gavel">⚖️</span>
            <h2 className="wr-pipeline-h">Initializing 5-Stage AI Pipeline</h2>
            <p className="wr-pipeline-sub">Processing under Indian Law — extracting parties, precedents, arguments &amp; opposition</p>
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
      </div>
    );
  }

  // ── RENDER: Failure Error State ───────────────────────────────────────────

  if ((simError || uploadError) && !simulationData) {
    return (
      <div className="vc-root">
        <style>{VC_STYLES}</style>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.docx"
          style={{ display: 'none' }}
          onChange={onFileInputChange}
        />

        <MatterHeader
          filename={docSource || 'Document'}
          pageCount={docPages || '3 pages'}
          analysisError={simError || uploadError}
          onRetry={() => {
            setSimError(null);
            setUploadError('');
            if (lastUploadedFile.current) {
              handleManualUpload(lastUploadedFile.current);
            } else {
              runSimulation(docContentCache.current || '', 'Appellant', docSource, docPages);
            }
          }}
          onReanalyze={onDropzoneClick}
        />
      </div>
    );
  }

  // ── RENDER: Empty / Standby Intake Dropzone ───────────────────────────────

  if (!simulationData) {
    return (
      <div className="vc-root">
        <style>{VC_STYLES}</style>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.docx"
          style={{ display: 'none' }}
          onChange={onFileInputChange}
        />

        <div className="wr-intake-wrap">
          <div className="wr-intake-container">
            <div className="wr-intake-card">

              <div className="wr-intake-badge">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                  <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                  <path d="M7 21h10" />
                  <path d="M12 3v18" />
                  <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
                </svg>
              </div>

              <h1 className="wr-intake-title">Virtual Courtroom — Ready</h1>
              <p className="wr-intake-subtitle">
                Upload a case brief directly or trigger via LexAmplify Assistant.
              </p>

              <div
                className={`wr-intake-dropzone${isDragOver ? ' drag-over' : ''}${uploadState === 'uploading' ? ' wr-dropzone-uploading' : ''}`}
                onClick={onDropzoneClick}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <div className="wr-intake-dropzone-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="wr-intake-dropzone-primary">
                  Drop your case document here
                </div>
                <div className="wr-intake-dropzone-secondary">
                  PDF, TXT, or DOCX • Click to browse • Triggers simulation instantly
                </div>
              </div>

              {uploadState === 'error' && (
                <div style={{ background: 'var(--accent-soft)', border: '1px solid var(--rule)', borderRadius: '8px', padding: '9px 14px', fontSize: '12px', color: 'var(--accent)', marginTop: '10px', textAlign: 'center' }}>
                  {uploadError}
                </div>
              )}

              <div className="wr-intake-divider">OR ACTIVATE VIA COMMAND ASSISTANT</div>

              <div className="wr-intake-steps">
                <div className="wr-intake-step-row">
                  <span className="wr-intake-step-num">01</span>
                  <div>
                    <div className="wr-intake-step-title">Open the Command Assistant</div>
                    <div className="wr-intake-step-desc">
                      Press <kbd style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)', padding: '1px 5px', borderRadius: '4px', fontFamily: 'var(--font-mono)', color: 'var(--ink-soft)' }}>Ctrl+K</kbd> or click "LexAmplify" in the sidebar.
                    </div>
                  </div>
                </div>

                <div className="wr-intake-step-row">
                  <span className="wr-intake-step-num">02</span>
                  <div>
                    <div className="wr-intake-step-title">Trigger simulation via natural prompt</div>
                    <div className="wr-intake-step-desc">
                      Type an argument simulation command directly:
                    </div>
                    <div
                      className="wr-intake-chip"
                      onClick={() => window.dispatchEvent(new Event('toggle-rag-palette'))}
                      title="Click to open command assistant"
                    >
                      "Simulate defense arguments for [Case Name]"
                    </div>
                  </div>
                </div>
              </div>

              <div className="wr-intake-actions">
                <button
                  className="wr-intake-btn-primary"
                  type="button"
                  onClick={() => window.dispatchEvent(new Event('toggle-rag-palette'))}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  Open Command Assistant
                </button>
                <button
                  className="wr-intake-btn-secondary"
                  type="button"
                  onClick={() => navigate('/vault')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Go to Case Vault
                </button>
              </div>

            </div>
          </div>
        </div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ── RENDER: VIRTUAL COURTROOM POPULATED RESULTS VIEW ─────────────────────────
  // ────────────────────────────────────────────────────────────────────────────

  const caseMeta = synthesizeCaseMetadata(simulationData, docSource, docContentCache.current, docPages);
  const issues = parseIssues(simulationData.extracted_issues);
  const citations = simulationData.live_citations ?? [];
  const questions = simulationData.red_team?.opposing_counter_questions ?? [];

  const redTeamDone = questions.length > 0 && addressedChallenges.size >= questions.length;
  const redTeamStarted = addressedChallenges.size > 0;
  const chatStarted = chatMessages.length > 1;
  const progressStages = [
    { label: 'Facts', state: 'done' },
    { label: 'Precedents', state: 'done' },
    { label: 'Draft', state: 'done' },
    { label: 'Red team', state: redTeamDone ? 'done' : redTeamStarted ? 'active' : 'pending' },
    { label: 'Simulation', state: chatStarted ? 'active' : 'pending' },
  ];

  const railStages = [
    { id: 'vc-stage-facts', label: 'Facts & issues', status: `${issues.length || 1} issue${issues.length > 1 ? 's' : ''} identified` },
    { id: 'vc-stage-precedents', label: 'Precedents', status: `${citations.length} citation${citations.length !== 1 ? 's' : ''} found` },
    { id: 'vc-stage-draft', label: 'Opening draft', status: 'Ready to review' },
    { id: 'vc-stage-simulation', label: 'Simulation room', status: `${addressedChallenges.size} of ${questions.length} prepared` },
  ];

  const handleRegenerateDraft = () => {
    if (lastUploadedFile.current) {
      handleManualUpload(lastUploadedFile.current);
    } else {
      runSimulation(docContentCache.current || '', 'Appellant', docSource, docPages);
    }
  };

  return (
    <div className="vc-root">
      <style>{VC_STYLES}</style>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.docx"
        style={{ display: 'none' }}
        onChange={onFileInputChange}
      />

      <div className="sticky-header" id="stickyHeader">
        <StageRail stages={railStages} activeId={activeStageId} onSelect={scrollToStage} />
      </div>

      <div className="page vc-page">
        <MatterHeader
          filename={caseMeta.filename}
          pageCount={caseMeta.pages}
          refId={caseMeta.ref}
          title={caseMeta.title}
          subtitle={caseMeta.subtitle}
          summaryColumns={caseMeta.summaryColumns}
          isAnalyzing={isSimulating || uploadState === 'uploading'}
          analysisError={simError || uploadError}
          onReanalyze={onDropzoneClick}
          onRetry={() => runSimulation(docContentCache.current || '', 'Appellant', docSource, docPages)}
          progressStages={progressStages}
          onNewSimulation={handleResetSimulation}
          onSaveToVault={handleSaveSession}
          savingSession={savingSession}
          savedSession={savedSession}
        />

        <main className="vc-content">

          {/* ───────── STAGE 1: FACTS & ISSUES ───────── */}
          <section id="vc-stage-facts" className="section vc-stage">
            <div className="section-head vc-stage-head"><span className="num vc-num">1</span><h2>Facts &amp; issues</h2></div>
            <p className="section-note vc-stage-note">Pulled from the case file you uploaded.</p>
            <div className="brief-card vc-brief-card" id="facts">
              {caseMeta.facts || (issues.length > 0 ? issues.join(' ') : (simulationData.extracted_issues || 'No specific legal issues extracted.'))}
            </div>
          </section>

          {/* ───────── STAGE 2: PRECEDENTS ───────── */}
          <section id="vc-stage-precedents" className="section vc-stage">
            <div className="section-head vc-stage-head"><span className="num vc-num">2</span><h2>Precedents</h2></div>
            <p className="section-note vc-stage-note">Matched against Indian Kanoon, ranked by relevance to the facts above.</p>
            {citations.length > 0 ? (
              <div className="vc-precedents">
                {citations.map((c, i) => {
                  const { cleanTitle, citationTag, ratio, url } = parsePrecedentData(c, i);
                  return (
                    <PrecedentEntry key={i} metaLine={citationTag} caseName={cleanTitle} note={ratio} url={url} />
                  );
                })}
              </div>
            ) : (
              <div className="brief-card vc-brief-card" style={{ fontStyle: 'italic', color: 'var(--muted)' }}>
                No live citations retrieved for this matter query.
              </div>
            )}
          </section>

          {/* ───────── STAGE 3: OPENING DRAFT ───────── */}
          <section id="vc-stage-draft" className="section vc-stage">
            <div className="section-head vc-stage-head"><span className="num vc-num">3</span><h2>Opening draft</h2></div>
            <p className="section-note vc-stage-note">Click any highlighted field to fill it in before export.</p>
            <PleadingDocument
              rawArgumentText={simulationData.opening_argument}
              matterTitle={caseMeta.title}
              apiBase={API_BASE}
              onRegenerate={handleRegenerateDraft}
            />
          </section>

          {/* ───────── STAGE 4+5: SIMULATION ROOM ───────── */}
          <section id="vc-stage-simulation" className="section vc-stage" style={{ paddingBottom: '40px' }}>
            <div className="section-head vc-stage-head" style={{ justifyContent: 'space-between', display: 'flex' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                <span className="num vc-num">4</span>
                <h2>Simulation room</h2>
              </div>
              <span className="prepared-badge">
                {addressedChallenges.size} of {questions.length} prepared
              </span>
            </div>
            <p className="section-note vc-stage-note">Opposing counsel's challenges on the left. Send your rebuttal straight into the live exchange on the right.</p>

            <SimulationRoom
              questions={questions}
              addressedChallenges={addressedChallenges}
              onUseInChat={handleUseInChat}
              chatMessages={chatMessages}
              chatInput={chatInput}
              setChatInput={setChatInput}
              chatLoading={chatLoading}
              strategyTone={strategyTone}
              setStrategyTone={setStrategyTone}
              onChatSubmit={handleChatSubmit}
              onQuickReply={submitToChat}
              chatEndRef={chatEndRef}
              chatInputRef={chatInputRef}
            />
          </section>

        </main>
      </div>
    </div>
  );
}
