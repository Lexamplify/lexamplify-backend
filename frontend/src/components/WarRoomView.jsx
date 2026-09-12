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

// ── Dynamic Metadata Parsers ────────────────────────────────────────────────

const parseMatterTitle = (simulationData, docSource) => {
  if (docSource) {
    const clean = docSource.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
    return clean.length > 65 ? clean.substring(0, 62) + '…' : clean;
  }
  const issues = (simulationData?.extracted_issues || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (issues.length > 0) {
    const first = issues[0].replace(/^(\d+[.):]|[-•*])\s*/, '');
    if (first.length > 5) {
      return first.length > 65 ? first.substring(0, 62) + '…' : first;
    }
  }
  return 'Appellate Dispute & Defense Strategy';
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

  /* ── DESIGN TOKENS (scoped — this page ignores the app's global light/dark
     toggle by design, since parchment/paper is a fixed physical-document
     metaphor with no natural dark twin) ─────────────────────────────── */
  .vc-root {
    --ink:#16213E; --ink-2:#2A3655;
    --parchment:#F5F0E4; --paper:#FFFDF8;
    --oxblood:#7B1E27; --oxblood-soft:#F4E5E3; --oxblood-line:#E3C6C2;
    --brass:#93672A; --brass-soft:#F1E7D3;
    --pine:#1F4D3D; --pine-soft:#E2EDE7;
    --text:#2A2723; --text-muted:#736C60;
    --line:#E1D8C4; --line-soft:#EDE6D6;
    --font-serif:'Source Serif 4', Georgia, serif;
    --font-sans:'IBM Plex Sans', sans-serif;
    --font-mono:'IBM Plex Mono', monospace;

    background: var(--parchment);
    color: var(--text);
    font-family: var(--font-sans);
    line-height: 1.5;
    min-height: calc(100vh - 64px);
  }
  .vc-root *{ box-sizing: border-box; }
  .vc-root ::selection{ background: var(--brass-soft); }
  .vc-root a{ color: inherit; }
  @media (prefers-reduced-motion: reduce) {
    .vc-root *{ animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }

  /* ── VIRTUAL COURTROOM INTAKE CARD (re-skinned, JSX/behavior untouched) ── */
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
  .wr-intake-card {
    width: 100%;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 36px 40px;
    box-shadow: 0 14px 30px -20px rgba(22,33,62,.25);
    display: flex; flex-direction: column;
  }
  .wr-intake-badge {
    width: 48px; height: 48px; border-radius: 10px;
    background: var(--brass-soft); border: 1px solid var(--line);
    color: var(--brass);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 16px;
  }
  .wr-intake-title { font-size: 24px; font-weight: 600; font-family: var(--font-serif); color: var(--ink) !important; text-align: center; margin: 0 0 6px; }
  .wr-intake-subtitle { font-size: 14px; color: var(--text-muted); text-align: center; margin: 0 0 24px; line-height: 1.5; }
  .wr-intake-dropzone {
    border: 2px dashed var(--line); background: var(--parchment);
    border-radius: 10px; padding: 30px 20px; text-align: center; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    transition: all 0.2s ease;
  }
  .wr-intake-dropzone:hover { border-color: var(--brass); background: var(--brass-soft); }
  .wr-intake-dropzone.drag-over { border-color: var(--brass); background: var(--brass-soft); transform: scale(1.01); }
  .wr-intake-dropzone-icon { color: var(--brass); margin-bottom: 2px; }
  .wr-intake-dropzone-primary { font-size: 14px; font-weight: 600; color: var(--ink); }
  .wr-intake-dropzone-secondary { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
  .wr-intake-divider {
    display: flex; align-items: center; gap: 12px; margin: 22px 0 18px;
    color: var(--text-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  }
  .wr-intake-divider::before, .wr-intake-divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .wr-intake-steps { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
  .wr-intake-step-row { display: flex; align-items: flex-start; gap: 12px; }
  .wr-intake-step-num {
    width: 24px; height: 24px; border-radius: 6px;
    background: var(--brass-soft); border: 1px solid var(--line); color: var(--brass);
    font-size: 11px; font-weight: 700; font-family: var(--font-mono);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;
  }
  .wr-intake-step-title { font-size: 12px; font-weight: 600; color: var(--ink); }
  .wr-intake-step-desc { font-size: 12px; color: var(--text-muted); line-height: 1.4; }
  .wr-intake-chip {
    display: inline-block; background: var(--parchment); border: 1px solid var(--line); color: var(--ink-2);
    font-family: var(--font-mono); font-size: 11px; padding: 2px 8px; border-radius: 4px; margin-top: 4px; cursor: pointer;
  }
  .wr-intake-chip:hover { border-color: var(--brass); color: var(--brass); }
  .wr-intake-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .wr-intake-btn-primary {
    flex: 1; min-width: 180px; background: var(--pine); color: #EAF3EE;
    font-size: 14px; font-weight: 500; padding: 10px 16px; border-radius: 8px; border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .wr-intake-btn-primary:hover { background: #25604C; }
  .wr-intake-btn-primary:active { transform: translateY(1px); }
  .wr-intake-btn-secondary {
    background: transparent; color: var(--ink); border: 1px solid var(--line);
    font-size: 14px; font-weight: 500; padding: 10px 16px; border-radius: 8px; cursor: pointer;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .wr-intake-btn-secondary:hover { background: var(--line-soft); }

  /* ── PIPELINE LOADING (re-skinned, JSX/behavior untouched) ── */
  .wr-pipeline-wrap { display: flex; align-items: center; justify-content: center; height: calc(100vh - 64px); }
  .wr-pipeline-card {
    background: var(--paper); border: 1px solid var(--line); border-radius: 4px;
    padding: 44px 48px; max-width: 500px; width: 100%;
    box-shadow: 0 14px 30px -20px rgba(22,33,62,.25);
  }
  .wr-pipeline-gavel { font-size: 46px; display: block; text-align: center; margin-bottom: 20px; animation: wr-float 2.6s ease-in-out infinite; }
  @keyframes wr-float {
    0%,100% { transform: translateY(0); filter: drop-shadow(0 4px 16px rgba(147,103,42,0.3)); }
    50% { transform: translateY(-7px); filter: drop-shadow(0 12px 28px rgba(147,103,42,0.4)); }
  }
  .wr-pipeline-h { font-size: 20px; font-weight: 600; font-family: var(--font-serif); color: var(--ink) !important; text-align: center; margin: 0 0 6px; }
  .wr-pipeline-sub { font-size: 13px; color: var(--text-muted); text-align: center; margin: 0 0 28px; line-height: 1.5; }
  .wr-stage-row { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 8px; transition: background 0.3s; }
  .wr-stage-row.active-row { background: var(--brass-soft); }
  .wr-stage-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; transition: background 0.4s; }
  .wr-stage-dot.done { background: var(--pine); }
  .wr-stage-dot.active { background: var(--brass); animation: wr-dot-pulse 1.4s ease-in-out infinite; }
  .wr-stage-dot.pending { background: var(--line); }
  @keyframes wr-dot-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.75); } }
  .wr-stage-text { font-size: 12.5px; color: var(--text); }
  .wr-stage-text.done { color: var(--pine); }
  .wr-stage-text.active { color: var(--ink); font-weight: 600; }
  .wr-stage-text.pending { color: var(--text-muted); }

  /* ── TOPBAR ─────────────────────────────────────────────────────── */
  .vc-topbar {
    background: var(--ink); color: #EFEAE0;
    padding: 20px 32px; display: flex; align-items: flex-start; justify-content: space-between;
    gap: 24px; flex-wrap: wrap;
  }
  .vc-case-id { font-family: var(--font-mono); font-size: 12px; letter-spacing: .02em; color: #B9AF9A; margin: 0 0 6px; }
  .vc-case-title { font-family: var(--font-serif); font-size: 26px; font-weight: 600; margin: 0 0 4px; color: #fff !important; }
  .vc-case-sub { font-size: 13px; color: #B9AF9A; margin: 0; }
  .vc-topbar-actions { display: flex; align-items: center; gap: 10px; padding-top: 2px; }
  .vc-btn {
    font-family: var(--font-sans); font-size: 13px; font-weight: 500; border-radius: 8px;
    padding: 9px 14px; border: 1px solid transparent; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px; transition: transform .08s ease, background .15s ease;
  }
  .vc-btn:active { transform: translateY(1px); }
  .vc-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .vc-btn-outline-light { background: transparent; border-color: #5B6690; color: #EFEAE0; }
  .vc-btn-outline-light:hover { background: #1F2C4F; }
  .vc-btn-pine { background: var(--pine); color: #EAF3EE; }
  .vc-btn-pine:hover { background: #25604C; }

  .vc-progress { display: flex; gap: 6px; margin-top: 14px; max-width: 520px; }
  .vc-progress-seg { flex: 1; height: 4px; border-radius: 3px; background: #2A3655; position: relative; overflow: hidden; }
  .vc-progress-seg.done { background: #B9AF9A; }
  .vc-progress-seg.active { background: #B9AF9A; opacity: 0.55; }
  .vc-progress-labels { display: flex; gap: 6px; max-width: 520px; margin-top: 6px; font-size: 10.5px; color: #8D8570; }
  .vc-progress-labels span { flex: 1; }

  /* ── WORKSPACE / STAGE RAIL ─────────────────────────────────────── */
  .vc-workspace { display: flex; align-items: flex-start; max-width: 1360px; margin: 0 auto; }
  .vc-stage-rail {
    position: sticky; top: 0; align-self: flex-start; width: 236px; flex-shrink: 0;
    padding: 36px 12px 40px 32px; height: calc(100vh - 64px); overflow-y: auto;
  }
  .vc-rail-item { display: flex; gap: 12px; padding: 12px 8px; border-radius: 8px; cursor: pointer; color: var(--text-muted); position: relative; }
  .vc-rail-item:hover { background: var(--line-soft); }
  .vc-rail-track { display: flex; flex-direction: column; align-items: center; width: 22px; flex-shrink: 0; }
  .vc-rail-dot {
    width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--line); background: var(--paper);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); flex-shrink: 0;
  }
  .vc-rail-connector { width: 2px; flex: 1; background: var(--line); margin: 2px 0; min-height: 22px; }
  .vc-rail-item.is-done .vc-rail-dot { background: var(--ink); border-color: var(--ink); color: #fff; }
  .vc-rail-item.is-done .vc-rail-connector { background: var(--ink-2); }
  .vc-rail-item.is-active .vc-rail-dot { background: var(--brass); border-color: var(--brass); color: #fff; }
  .vc-rail-item.is-active .vc-rail-label { color: var(--ink); }
  .vc-rail-item.is-active { background: var(--brass-soft); }
  .vc-rail-label { font-size: 13.5px; font-weight: 600; color: var(--text); margin-bottom: 2px; }
  .vc-rail-status { font-size: 11.5px; color: var(--text-muted); }

  /* ── MAIN CONTENT COLUMN ────────────────────────────────────────── */
  .vc-content { flex: 1; min-width: 0; padding: 40px 48px 120px 40px; }
  .vc-stage { max-width: 760px; margin-bottom: 64px; scroll-margin-top: 24px; }
  .vc-stage-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
  .vc-stage-head h2 { font-family: var(--font-serif); font-size: 22px; font-weight: 600; margin: 0; color: var(--ink) !important; }
  .vc-stage-head .vc-num { font-family: var(--font-mono); font-size: 14px; color: var(--brass); }
  .vc-stage-note { font-size: 13px; color: var(--text-muted); margin: 0 0 20px; }

  /* Stage 1: facts brief card */
  .vc-brief-card {
    background: var(--paper); border-left: 3px solid var(--brass); padding: 18px 22px;
    font-family: var(--font-serif); font-size: 16.5px; line-height: 1.6; color: var(--text);
  }

  /* Stage 2: precedent entries */
  .vc-precedents { display: grid; grid-template-columns: 1fr; gap: 14px; }
  .vc-precedent { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 16px 20px; }
  .vc-precedent-meta { font-size: 11.5px; color: var(--brass); font-weight: 600; margin-bottom: 6px; letter-spacing: .01em; }
  .vc-precedent h3 { font-family: var(--font-serif); font-style: italic; font-weight: 600; font-size: 16px; margin: 0 0 6px; color: var(--ink) !important; }
  .vc-precedent p { font-size: 13.5px; color: var(--text-muted); margin: 0 0 10px; line-height: 1.55; }
  .vc-precedent-link { font-size: 12.5px; font-weight: 500; color: var(--ink-2); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
  .vc-precedent-more { font-size: 12.5px; font-weight: 600; color: var(--brass); text-decoration: underline; cursor: pointer; }

  /* Stage 3: pleading document */
  .vc-doc-toolbar { display: flex; gap: 8px; margin-bottom: 14px; }
  .vc-tool-btn {
    font-size: 12.5px; font-weight: 500; color: var(--ink-2); background: var(--paper);
    border: 1px solid var(--line); border-radius: 7px; padding: 7px 12px; cursor: pointer;
  }
  .vc-tool-btn:hover:not(:disabled) { border-color: var(--brass); color: var(--brass); }
  .vc-tool-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .vc-doc-error { color: var(--oxblood); font-size: 12.5px; margin-bottom: 10px; }
  .vc-paper {
    background: var(--paper); border: 1px solid var(--line);
    box-shadow: 0 1px 0 var(--line-soft), 0 14px 30px -20px rgba(22,33,62,.25);
    padding: 44px 48px; font-family: var(--font-serif); font-size: 15.5px; line-height: 1.75; color: var(--text);
  }
  .vc-paper h1, .vc-paper h2, .vc-paper h3 { font-weight: 600; color: var(--ink) !important; }
  .vc-paper h1 { font-size: 18px; margin: 0 0 4px; }
  .vc-paper h2 { font-size: 16px; margin: 24px 0 10px; }
  .vc-paper h3 { font-size: 14.5px; margin: 20px 0 8px; }
  .vc-paper p { margin: 0 0 14px; text-align: justify; }
  .vc-paper strong { color: var(--ink); }
  .vc-paper hr { margin: 18px 0; border: none; border-top: 1px solid var(--line); }
  .vc-paper ol, .vc-paper ul { padding-left: 22px; margin: 0 0 14px; }
  .vc-paper li { margin: 4px 0; text-align: justify; }
  .blank {
    display: inline-block; min-width: 60px; border: none; border-bottom: 1.5px dashed var(--brass);
    color: var(--brass); background: var(--brass-soft); padding: 0 4px; border-radius: 2px;
    cursor: text; outline: none; font-family: var(--font-sans); font-size: 0.92em;
  }
  .blank::placeholder { color: var(--brass); opacity: .75; }
  .blank:focus { background: #fff; border-bottom-style: solid; }

  /* Stage 4+5: Simulation Room */
  .vc-sim-grid { display: grid; grid-template-columns: minmax(0,380px) minmax(0,1fr); gap: 22px; margin-top: 20px; align-items: start; }
  .vc-queue-panel { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .vc-queue-panel-head { padding: 14px 18px; border-bottom: 1px solid var(--line); font-size: 12.5px; font-weight: 600; color: var(--ink); display: flex; justify-content: space-between; }
  .vc-challenge { border-bottom: 1px solid var(--line-soft); }
  .vc-challenge:last-child { border-bottom: none; }
  .vc-challenge summary { list-style: none; cursor: pointer; padding: 14px 18px; display: flex; gap: 10px; align-items: flex-start; }
  .vc-challenge summary::-webkit-details-marker { display: none; }
  .vc-chal-status {
    flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--oxblood-line);
    margin-top: 2px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--oxblood);
  }
  .vc-challenge.answered .vc-chal-status { background: var(--pine); border-color: var(--pine); color: #fff; }
  .vc-chal-body { flex: 1; min-width: 0; }
  .vc-chal-tag { display: inline-block; font-size: 10px; font-weight: 600; color: var(--text-muted); border: 1px solid var(--line); padding: 1px 7px; border-radius: 10px; margin-bottom: 5px; }
  .vc-chal-q { font-size: 13.5px; color: var(--text); line-height: 1.45; }
  .vc-chal-expand { padding: 0 18px 16px 46px; }
  .vc-rebuttal-box { background: var(--pine-soft); border-left: 3px solid var(--pine); padding: 12px 14px; font-size: 13px; line-height: 1.5; color: #1B3F32; margin-bottom: 10px; }
  .vc-use-btn { font-size: 12px; font-weight: 600; color: #fff; background: var(--pine); border: none; border-radius: 7px; padding: 7px 12px; cursor: pointer; }
  .vc-use-btn:hover { background: #25604C; }
  .vc-use-btn.used { background: var(--text-muted); cursor: default; }

  .vc-chat-panel { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; display: flex; flex-direction: column; height: 640px; }
  .vc-chat-head { padding: 14px 18px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .vc-tone-toggle { display: flex; background: var(--line-soft); border-radius: 20px; padding: 3px; gap: 2px; }
  .vc-tone-btn { font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 16px; border: none; background: transparent; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; gap: 5px; }
  .vc-tone-btn.on.aggr { background: var(--oxblood); color: #fff; }
  .vc-tone-btn.on.def { background: var(--ink-2); color: #fff; }
  .vc-chat-thread { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
  .vc-msg { max-width: 78%; padding: 11px 14px; border-radius: 12px; font-size: 13.5px; line-height: 1.5; }
  .vc-msg-opp { align-self: flex-start; background: var(--oxblood-soft); color: #4A1116; border-bottom-left-radius: 3px; }
  .vc-msg-you { align-self: flex-end; background: var(--pine-soft); color: #173226; border-bottom-right-radius: 3px; }
  .vc-msg-role { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; opacity: .65; margin-bottom: 4px; }
  .vc-msg .md-b { color: inherit; font-weight: 700; }
  .vc-msg .md-h3, .vc-msg .md-h4 { color: inherit; }
  .vc-msg .md-i { color: inherit; }
  .vc-msg .md-code { background: rgba(0,0,0,0.08); color: inherit; }
  .vc-typing { font-style: italic; opacity: 0.75; }
  .vc-quick-replies { display: flex; flex-wrap: wrap; gap: 8px; align-self: flex-start; max-width: 95%; }
  .vc-qr-pill {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 20px;
    font-size: 12px; font-weight: 600; cursor: pointer; text-align: left;
    border: 1px solid var(--line); background: var(--paper); color: var(--ink-2);
  }
  .vc-qr-pill:hover:not(:disabled) { border-color: var(--brass); color: var(--brass); }
  .vc-chat-input-row { border-top: 1px solid var(--line); padding: 12px 14px; display: flex; gap: 8px; }
  .vc-chat-input-row textarea {
    flex: 1; resize: none; border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px;
    font-family: inherit; font-size: 13.5px; min-height: 38px; max-height: 90px;
  }
  .vc-chat-input-row textarea:focus { outline: none; border-color: var(--brass); }
  .vc-send-btn { background: var(--ink); color: #fff; border: none; border-radius: 8px; padding: 0 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .vc-send-btn:hover:not(:disabled) { background: var(--ink-2); }
  .vc-send-btn:disabled { opacity: 0.55; cursor: not-allowed; }

  @media (max-width: 980px) {
    .vc-workspace { flex-direction: column; }
    .vc-stage-rail {
      position: static; width: 100%; height: auto; padding: 20px 20px 8px;
      display: flex; overflow-x: auto; gap: 4px;
    }
    .vc-rail-item { flex-direction: column; align-items: center; text-align: center; width: 110px; flex-shrink: 0; }
    .vc-rail-connector, .vc-rail-track { display: none; }
    .vc-content { padding: 24px 20px 100px; }
    .vc-sim-grid { grid-template-columns: 1fr; }
    .vc-chat-panel { height: 480px; }
    .vc-paper { padding: 28px 22px; }
  }
`;

export default function WarRoomView() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const location = useLocation();
  const navigate = useNavigate();

  // Lifecycle
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [simError, setSimError] = useState(null);
  const [simulationData, setSimulationData] = useState(null);
  const [docSource, setDocSource] = useState('');

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

  const runSimulation = async (docContent, clientSide = 'Appellant', docRef = '') => {
    setDocSource(docRef);
    setIsSimulating(true);
    setCurrentStage(1);
    setSimulationData(null);
    setChatMessages([]);
    setAddressedChallenges(new Set());
    setSavedSession(false);
    setSimError(null);

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
  // with manual scrolling too, not just explicit nav clicks. Recomputes
  // directly from each section's current position on every scroll tick,
  // rather than relying on IntersectionObserver's changed-entries model —
  // that approach only fires for sections whose intersection status just
  // flipped, so a large instant scroll (or the app's actual scroll owner
  // being an inner <main>, not the window) can skip re-evaluating a
  // section that should now be active, leaving the indicator stuck.
  useEffect(() => {
    if (!simulationData) return;
    const ids = ['vc-stage-facts', 'vc-stage-precedents', 'vc-stage-draft', 'vc-stage-simulation'];
    const DETECTION_LINE = 120; // px from viewport top, just under the sticky nav

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

  // Manual file upload
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
      await uploadDocument(file, null, 'War Room Upload');
      if (!isMountedRef.current) return;
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

  const scrollToStage = (stageId) => {
    setActiveStageId(stageId);
    const el = document.getElementById(stageId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // ── RENDER: Loading Pipeline ──────────────────────────────────────────────

  if (isSimulating) {
    return (
      <div className="vc-root">
        <style>{VC_STYLES}</style>
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
      </div>
    );
  }

  // ── RENDER: Error Fallback ────────────────────────────────────────────────

  if (simError) {
    return (
      <div className="vc-root">
        <style>{VC_STYLES}</style>
        <div className="wr-intake-wrap">
          <div className="wr-intake-card" style={{ maxWidth: '540px', textAlign: 'center' }}>
            <span style={{ fontSize: '42px', display: 'block', marginBottom: '16px' }}>🚨</span>
            <h2 className="wr-intake-title">Simulation Encountered an Error</h2>
            <p className="wr-intake-subtitle">{simError}</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button className="wr-intake-btn-primary" onClick={() => { setSimError(null); navigate('/war-room', { replace: true }); }}>
                Try Again
              </button>
              <button className="wr-intake-btn-secondary" onClick={() => navigate('/dashboard')}>
                Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: Ingestion / Intake Card ───────────────────────────────────────

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
                {uploadState === 'uploading' ? (
                  <>
                    <div style={{ width: '22px', height: '22px', border: '2px solid rgba(59,130,246,0.2)', borderTopColor: '#3B82F6', borderRadius: '50%', animation: 'spin 0.75s linear infinite', margin: '0 auto 10px' }} />
                    <div className="wr-intake-dropzone-primary">Uploading & indexing document…</div>
                    <div className="wr-intake-dropzone-secondary">Pipeline will start automatically once processing completes</div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              {uploadState === 'error' && (
                <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '9px 14px', fontSize: '12px', color: '#FCA5A5', marginTop: '10px', textAlign: 'center' }}>
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
                      Press <kbd style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.25)', padding: '1px 5px', borderRadius: '4px', fontFamily: 'monospace' }}>Ctrl+K</kbd> or click "LexAmplify" in the sidebar.
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
  // ── RENDER: VIRTUAL COURTROOM RESULTS VIEW ───────────────────────────────────
  // ────────────────────────────────────────────────────────────────────────────

  const issues = parseIssues(simulationData.extracted_issues);
  const citations = simulationData.live_citations ?? [];
  const questions = simulationData.red_team?.opposing_counter_questions ?? [];

  const matterTitle = parseMatterTitle(simulationData, docSource);
  const governingLaw = parseGoverningLaw(simulationData.extracted_issues, simulationData.opening_argument);
  const matterLabel = docSource ? `Ref: ${docSource}` : 'Virtual Courtroom Session';
  const subLine = `${simulationData.client_side || 'Appellant'} strategy · governed by ${governingLaw}`;

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
    { id: 'vc-stage-facts', label: 'Facts & issues', status: `${issues.length} issue${issues.length !== 1 ? 's' : ''} identified` },
    { id: 'vc-stage-precedents', label: 'Precedents', status: `${citations.length} citation${citations.length !== 1 ? 's' : ''} found` },
    { id: 'vc-stage-draft', label: 'Opening draft', status: 'Ready to review' },
    { id: 'vc-stage-simulation', label: 'Simulation room', status: `${addressedChallenges.size} of ${questions.length} prepared` },
  ];

  return (
    <div className="vc-root">
      <style>{VC_STYLES}</style>

      <MatterHeader
        matterLabel={matterLabel}
        title={matterTitle}
        subLine={subLine}
        progressStages={progressStages}
        onNewSimulation={handleResetSimulation}
        onSaveToVault={handleSaveSession}
        savingSession={savingSession}
        savedSession={savedSession}
      />

      <div className="vc-workspace">
        <StageRail stages={railStages} activeId={activeStageId} onSelect={scrollToStage} />

        <main className="vc-content">

          {/* ───────── STAGE 1: FACTS & ISSUES ───────── */}
          <section id="vc-stage-facts" className="vc-stage">
            <div className="vc-stage-head"><span className="vc-num">1</span><h2>Facts &amp; issues</h2></div>
            <p className="vc-stage-note">Pulled from the case file you uploaded.</p>
            <div className="vc-brief-card">
              {issues.length > 0 ? issues.join(' ') : (simulationData.extracted_issues || 'No specific legal issues extracted.')}
            </div>
          </section>

          {/* ───────── STAGE 2: PRECEDENTS ───────── */}
          <section id="vc-stage-precedents" className="vc-stage">
            <div className="vc-stage-head"><span className="vc-num">2</span><h2>Precedents</h2></div>
            <p className="vc-stage-note">Matched against Indian Kanoon, ranked by relevance to the facts above.</p>
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
              <div className="vc-brief-card" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                No live citations retrieved for this matter query.
              </div>
            )}
          </section>

          {/* ───────── STAGE 3: OPENING DRAFT ───────── */}
          <section id="vc-stage-draft" className="vc-stage">
            <div className="vc-stage-head"><span className="vc-num">3</span><h2>Opening draft</h2></div>
            <p className="vc-stage-note">Click any highlighted field to fill it in before export.</p>
            <PleadingDocument
              rawArgumentText={simulationData.opening_argument}
              matterTitle={matterTitle}
              apiBase={API_BASE}
            />
          </section>

          {/* ───────── STAGE 4+5: SIMULATION ROOM ───────── */}
          <section id="vc-stage-simulation" className="vc-stage" style={{ maxWidth: '100%' }}>
            <div className="vc-sim-head-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: '760px' }}>
              <div className="vc-stage-head" style={{ marginBottom: 0 }}><span className="vc-num">4</span><h2>Simulation room</h2></div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--oxblood)', background: 'var(--oxblood-soft)', padding: '4px 10px', borderRadius: '20px' }}>
                {addressedChallenges.size} of {questions.length} prepared
              </span>
            </div>
            <p className="vc-stage-note">Opposing counsel's challenges on the left. Send your rebuttal straight into the live exchange on the right.</p>

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
