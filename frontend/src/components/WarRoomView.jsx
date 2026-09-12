import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  let citationTag = 'Supreme Court of India · Landmark Record';

  const kanoonMatch = rawTitle.match(/^(.*?)\s+on\s+(\d{1,2}\s+[A-Za-z]+,\s+\d{4})/i);
  if (kanoonMatch) {
    cleanTitle = kanoonMatch[1].replace(/\s+vs\s+/i, ' v. ').replace(/\s+versus\s+/i, ' v. ').trim();
    citationTag = `Supreme Court of India · ${kanoonMatch[2]}`;
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

// ── Pleading AST & Inline Blanks Engine ──────────────────────────────────────

const BLANK_REGEX = /(Rs\.\s*_{2,}|_{3,}|\[[A-Za-z0-9\s,./_'-]{2,80}\])/g;

// Splits a line into blank vs. plain-text runs first, then re-tokenizes each
// plain run for **bold**/*italic*/`code` markers while carrying the open
// style state (bold/italic/code) across blank boundaries. Legal pleadings
// routinely bold a whole phrase that contains a fillable blank — e.g.
// "**IN THE HIGH COURT OF ___________**" — and styling each side of the
// blank independently (the original approach) can never detect that as one
// bold run, since neither half contains a matching closing marker; the
// literal ** characters leaked into the rendered document as a result.
const parseInlineSegments = (text, blankCounterRef, blanksList) => {
  const rawParts = [];
  let lastIndex = 0;
  let match;
  const blankRe = new RegExp(BLANK_REGEX.source, 'g');
  while ((match = blankRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      rawParts.push({ kind: 'text', raw: text.slice(lastIndex, match.index) });
    }
    rawParts.push({ kind: 'blank', raw: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    rawParts.push({ kind: 'text', raw: text.slice(lastIndex) });
  }

  const segments = [];
  let bold = false, italic = false, code = false;

  rawParts.forEach((part) => {
    if (part.kind === 'blank') {
      const raw = part.raw;
      const id = `blank_${blankCounterRef.count++}`;
      let label;
      if (raw.startsWith('[') && raw.endsWith(']')) {
        label = raw.slice(1, -1).trim();
      } else if (/Rs\./i.test(raw)) {
        label = 'Rs. Amount';
      } else {
        label = 'Fill value';
      }
      const blankObj = { id, raw, label };
      blanksList.push(blankObj);
      segments.push({ type: 'blank', ...blankObj });
      return;
    }

    part.raw.split(/(\*\*|\*|`)/).forEach((tok) => {
      if (!tok) return;
      if (tok === '**') { bold = !bold; return; }
      if (tok === '*') { italic = !italic; return; }
      if (tok === '`') { code = !code; return; }
      segments.push({ type: 'text', content: tok, bold, italic, code });
    });
  });

  return segments;
};

const parsePleadingDocument = (rawText) => {
  if (!rawText) return { blocks: [], blanksList: [] };

  const lines = rawText.split('\n');
  const blocks = [];
  const blanksList = [];
  const blankCounter = { count: 0 };

  let currentParagraph = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const fullParaText = currentParagraph.join(' ').trim();
      if (fullParaText) {
        const segments = parseInlineSegments(fullParaText, blankCounter, blanksList);
        blocks.push({ type: 'p', segments });
      }
      currentParagraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    if (/^---$|^\*\*\*$|^___$/.test(line)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      continue;
    }

    const h4Match = line.match(/^####\s+(.+)$/);
    if (h4Match) {
      flushParagraph();
      blocks.push({ type: 'h4', segments: parseInlineSegments(h4Match[1], blankCounter, blanksList) });
      continue;
    }

    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      flushParagraph();
      blocks.push({ type: 'h3', segments: parseInlineSegments(h3Match[1], blankCounter, blanksList) });
      continue;
    }

    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      flushParagraph();
      blocks.push({ type: 'h2', segments: parseInlineSegments(h2Match[1], blankCounter, blanksList) });
      continue;
    }

    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      flushParagraph();
      blocks.push({ type: 'h1', segments: parseInlineSegments(h1Match[1], blankCounter, blanksList) });
      continue;
    }

    const quoteMatch = line.match(/^>\s*(.+)$/);
    if (quoteMatch) {
      flushParagraph();
      blocks.push({ type: 'quote', segments: parseInlineSegments(quoteMatch[1], blankCounter, blanksList) });
      continue;
    }

    const numMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (numMatch) {
      flushParagraph();
      blocks.push({
        type: 'num-item',
        num: numMatch[1],
        segments: parseInlineSegments(numMatch[2], blankCounter, blanksList),
      });
      continue;
    }

    const bulletMatch = line.match(/^[-•*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      blocks.push({
        type: 'bullet-item',
        segments: parseInlineSegments(bulletMatch[1], blankCounter, blanksList),
      });
      continue;
    }

    currentParagraph.push(line);
  }

  flushParagraph();

  return { blocks, blanksList };
};

const compilePleadingText = (rawText, formBlanks, blanksList) => {
  if (!rawText) return '';
  let compiled = rawText;
  if (!blanksList || blanksList.length === 0) return compiled;

  blanksList.forEach((b) => {
    const val = formBlanks[b.id]?.trim();
    if (val) {
      compiled = compiled.replace(b.raw, val);
    }
  });
  return compiled;
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

const WAR_ROOM_STYLES = `
${MARKDOWN_CSS}

  /* ── VIRTUAL COURTROOM INTAKE CARD ─────────────────────────────── */
  .wr-intake-wrap {
    min-height: calc(100vh - 64px);
    width: 100%;
    padding: 32px 16px 48px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow-y: auto;
  }
  .wr-intake-container {
    max-width: 672px;
    width: 100%;
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .wr-intake-card {
    width: 100%;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 16px;
    padding: 36px 40px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    transition: all 0.2s ease;
  }
  .wr-intake-badge {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: rgba(30, 58, 138, 0.6);
    border: 1px solid #1e40af;
    color: #60a5fa;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
  }
  .wr-intake-title {
    font-size: 24px;
    font-weight: 700;
    font-family: var(--font-serif, Georgia, serif);
    color: #ffffff;
    text-align: center;
    letter-spacing: -0.025em;
    margin: 0 0 6px;
  }
  .wr-intake-subtitle {
    font-size: 14px;
    color: #94a3b8;
    text-align: center;
    margin: 0 0 24px;
    line-height: 1.5;
  }
  .wr-intake-dropzone {
    border: 2px dashed #334155;
    background: rgba(2, 6, 23, 0.4);
    border-radius: 12px;
    padding: 30px 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .wr-intake-dropzone:hover {
    border-color: #60a5fa;
    background: rgba(30, 58, 138, 0.2);
  }
  .wr-intake-dropzone.drag-over {
    border-color: #3b82f6;
    background: rgba(30, 58, 138, 0.3);
    transform: scale(1.01);
  }
  .wr-intake-dropzone-icon {
    color: #3b82f6;
    margin-bottom: 2px;
  }
  .wr-intake-dropzone-primary {
    font-size: 14px;
    font-weight: 600;
    color: #f1f5f9;
  }
  .wr-intake-dropzone-secondary {
    font-size: 12px;
    color: #94a3b8;
    margin-top: 2px;
  }
  .wr-intake-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 22px 0 18px;
    color: #64748b;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .wr-intake-divider::before,
  .wr-intake-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #1e293b;
  }
  .wr-intake-steps {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
  }
  .wr-intake-step-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .wr-intake-step-num {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: rgba(30, 58, 138, 0.8);
    border: 1px solid #1e40af;
    color: #60a5fa;
    font-size: 11px;
    font-weight: 700;
    font-family: monospace;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .wr-intake-step-title {
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
  }
  .wr-intake-step-desc {
    font-size: 12px;
    color: #94a3b8;
    line-height: 1.4;
  }
  .wr-intake-chip {
    display: inline-block;
    background: #020617;
    border: 1px solid #1e293b;
    color: #93c5fd;
    font-family: monospace;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    margin-top: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .wr-intake-chip:hover {
    border-color: #3b82f6;
    color: #bfdbfe;
  }
  .wr-intake-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .wr-intake-btn-primary {
    flex: 1;
    min-width: 180px;
    background: #2563eb;
    color: #ffffff;
    font-size: 14px;
    font-weight: 500;
    padding: 10px 16px;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    transition: all 0.15s ease;
  }
  .wr-intake-btn-primary:hover {
    background: #3b82f6;
  }
  .wr-intake-btn-primary:active {
    transform: scale(0.98);
  }
  .wr-intake-btn-secondary {
    background: #1e293b;
    color: #e2e8f0;
    border: 1px solid #334155;
    font-size: 14px;
    font-weight: 500;
    padding: 10px 16px;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.15s ease;
  }
  .wr-intake-btn-secondary:hover {
    background: rgba(51, 65, 85, 0.8);
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
    0%,100% { transform: translateY(0); filter: drop-shadow(0 4px 16px rgba(59,130,246,0.3)); }
    50% { transform: translateY(-7px); filter: drop-shadow(0 12px 28px rgba(59,130,246,0.55)); }
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
  .wr-stage-dot.done { background: #10B981; box-shadow: 0 0 6px rgba(16,185,129,0.6); }
  .wr-stage-dot.active { background: #3B82F6; box-shadow: 0 0 9px rgba(59,130,246,0.7); animation: wr-dot-pulse 1.4s ease-in-out infinite; }
  .wr-stage-dot.pending { background: var(--border-subtle, #2C3241); }
  @keyframes wr-dot-pulse {
    0%,100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(0.75); }
  }
  .wr-stage-text { font-size: 12.5px; }
  .wr-stage-text.done { color: #10B981; }
  .wr-stage-text.active { color: white; font-weight: 600; }
  .wr-stage-text.pending { color: var(--text-muted, #8F9CAE); }

  /* ── ENTERPRISE WAR ROOM PAGE CONTAINER ────────────────────────── */
  .wr-results-page {
    min-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    font-family: var(--font-sans);
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 0.5s cubic-bezier(0.16,1,0.3,1), transform 0.5s cubic-bezier(0.16,1,0.3,1);
    background: var(--bg-app, #0b0f19);
  }
  .wr-results-page.wr-mounted { opacity: 1; transform: translateY(0); }

  /* ── DYNAMIC MATTER HEADER ─────────────────────────────────────── */
  .wr-matter-header {
    background: #0f172a;
    border-bottom: 1px solid #1e293b;
    padding: 16px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    flex-shrink: 0;
    position: relative;
    z-index: 25;
  }
  .wr-matter-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .wr-matter-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .wr-matter-title {
    font-size: 20px;
    font-weight: 700;
    font-family: var(--font-serif, Georgia, serif);
    color: #ffffff;
    margin: 0;
    letter-spacing: -0.015em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 540px;
  }
  .wr-matter-meta-pills {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .wr-meta-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .wr-meta-pill.strategy {
    background: rgba(37, 99, 235, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.3);
    color: #93c5fd;
    text-transform: uppercase;
    font-weight: 700;
  }
  .wr-meta-pill.forum {
    background: rgba(148, 163, 184, 0.1);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #cbd5e1;
  }
  .wr-meta-pill.law {
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.25);
    color: #fcd34d;
    font-family: monospace;
    font-size: 11px;
  }
  .wr-header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .wr-header-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 9px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    font-family: var(--font-sans);
    transition: all 0.15s ease;
  }
  .wr-header-btn.primary {
    background: #2563eb;
    color: #ffffff;
    border: 1px solid #3b82f6;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .wr-header-btn.primary:hover {
    background: #1d4ed8;
  }
  .wr-header-btn.secondary {
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
  }
  .wr-header-btn.secondary:hover {
    background: #334155;
    color: #ffffff;
  }
  .wr-header-btn.danger {
    background: transparent;
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .wr-header-btn.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: #ef4444;
    color: #fca5a5;
  }

  /* ── STICKY STAGE NAVIGATOR ────────────────────────────────────── */
  .wr-stage-navigator {
    position: sticky;
    top: 0;
    z-index: 20;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid #1e293b;
    padding: 8px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .wr-nav-track {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .wr-nav-track::-webkit-scrollbar { display: none; }
  .wr-nav-item {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    color: #94a3b8;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.18s ease;
    white-space: nowrap;
  }
  .wr-nav-item:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.04);
  }
  .wr-nav-item.active {
    color: #60a5fa;
    background: rgba(37, 99, 235, 0.14);
    border-color: rgba(59, 130, 246, 0.35);
  }
  .wr-nav-roman {
    font-size: 10.5px;
    font-weight: 800;
    opacity: 0.85;
  }
  .wr-nav-progress {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.25);
    color: #34d399;
    flex-shrink: 0;
  }
  .wr-nav-progress.complete {
    background: rgba(16, 185, 129, 0.2);
    border-color: #10b981;
    color: #6ee7b7;
  }

  /* ── SCROLLABLE RESULTS BODY ───────────────────────────────────── */
  .wr-results-body {
    flex: 1;
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 32px;
    max-width: 1400px;
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  /* ── SECTION SHELL ─────────────────────────────────────────────── */
  .wr-section-container {
    scroll-margin-top: 64px;
  }
  .wr-section-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .wr-section-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    border-radius: 8px;
    background: rgba(37, 99, 235, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.3);
    color: #60a5fa;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.05em;
  }
  .wr-section-title {
    font-size: 16px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.01em;
    margin: 0;
  }
  .wr-section-desc {
    font-size: 12.5px;
    color: #94a3b8;
    margin-left: auto;
  }

  /* ── STAGE I: EXTRACTED ISSUES ─────────────────────────────────── */
  .wr-issues-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .wr-issue-card {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 16px 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }
  .wr-issue-idx {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: rgba(37, 99, 235, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.3);
    color: #93c5fd;
    font-size: 11px;
    font-weight: 700;
    font-family: monospace;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }
  .wr-issue-content {
    font-size: 14px;
    color: #e2e8f0;
    line-height: 1.6;
    font-weight: 500;
  }

  /* ── STAGE II: LAW-REPORT PRECEDENT CARDS ───────────────────────── */
  .wr-precedents-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 16px;
  }
  .wr-precedent-card {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 14px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }
  .wr-precedent-card:hover {
    border-color: rgba(245, 158, 11, 0.4);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(245, 158, 11, 0.08);
  }
  .wr-precedent-head {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .wr-precedent-title {
    font-size: 15px;
    font-weight: 700;
    font-family: var(--font-serif, Georgia, serif);
    font-style: italic;
    color: #f1f5f9;
    line-height: 1.45;
  }
  .wr-precedent-auth-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.25);
    padding: 2px 8px;
    border-radius: 5px;
    width: fit-content;
  }
  .wr-precedent-ratio {
    font-size: 12.5px;
    color: #94a3b8;
    line-height: 1.6;
    background: rgba(2, 6, 23, 0.4);
    border-left: 3px solid #f59e0b;
    padding: 10px 12px;
    border-radius: 0 8px 8px 0;
    flex: 1;
  }
  .wr-precedent-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: #60a5fa;
    text-decoration: none;
    margin-top: 4px;
    width: fit-content;
    transition: color 0.15s ease;
  }
  .wr-precedent-link:hover {
    color: #93c5fd;
    text-decoration: underline;
  }

  /* ── STAGE III: LEGAL FOLIO PLEADING WORKBENCH ───────────────────── */
  .wr-folio-workbench {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .wr-folio-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 10px 18px;
  }
  .wr-folio-tools-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .wr-folio-badge {
    font-size: 11px;
    font-weight: 700;
    color: #93c5fd;
    background: rgba(37, 99, 235, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.3);
    padding: 3px 8px;
    border-radius: 6px;
    text-transform: uppercase;
  }
  .wr-folio-tools-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .wr-folio-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: var(--font-sans);
    transition: all 0.15s ease;
    border: 1px solid #334155;
    background: #1e293b;
    color: #e2e8f0;
  }
  .wr-folio-btn:hover {
    background: #334155;
    color: #ffffff;
  }
  .wr-folio-btn.copied {
    background: rgba(16, 185, 129, 0.2);
    border-color: #10b981;
    color: #34d399;
  }
  .wr-folio-sheet {
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 16px;
    padding: 48px 56px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    font-family: var(--font-serif, Georgia, serif);
    color: #f1f5f9;
    line-height: 1.85;
    font-size: 15px;
    box-sizing: border-box;
  }
  .wr-folio-h1 {
    font-size: 20px;
    font-weight: 700;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #ffffff;
    margin: 0 0 24px;
    padding-bottom: 12px;
    border-bottom: 2px double #334155;
  }
  .wr-folio-h2 {
    font-size: 16px;
    font-weight: 700;
    color: #ffffff;
    margin: 28px 0 12px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .wr-folio-h3 {
    font-size: 14.5px;
    font-weight: 700;
    color: #93c5fd;
    margin: 20px 0 8px;
  }
  .wr-folio-h4 {
    font-size: 13.5px;
    font-weight: 700;
    color: #cbd5e1;
    margin: 16px 0 6px;
  }
  .wr-folio-p {
    margin: 0 0 16px;
    text-align: justify;
  }
  .wr-folio-quote {
    margin: 18px 0;
    padding: 12px 20px;
    background: rgba(2, 6, 23, 0.5);
    border-left: 3px solid #3b82f6;
    font-style: italic;
    color: #cbd5e1;
    border-radius: 0 8px 8px 0;
  }
  .wr-folio-num {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 8px 0;
    text-align: justify;
  }
  .wr-folio-num-idx {
    font-weight: 700;
    color: #60a5fa;
    min-width: 24px;
    flex-shrink: 0;
  }
  .wr-folio-bullet {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 6px 0;
    text-align: justify;
  }
  .wr-folio-bullet-dot {
    color: #60a5fa;
    font-size: 12px;
    flex-shrink: 0;
    margin-top: 4px;
  }
  .wr-folio-hr {
    border: none;
    border-top: 1px solid #334155;
    margin: 32px 0;
  }
  .wr-folio-bold {
    font-weight: 700;
    color: #ffffff;
  }
  .wr-folio-italic {
    font-style: italic;
    color: #e2e8f0;
  }
  .wr-folio-code {
    font-family: monospace;
    font-size: 13px;
    background: rgba(2, 6, 23, 0.6);
    padding: 2px 6px;
    border-radius: 4px;
    color: #93c5fd;
  }
  .wr-inline-blank {
    display: inline-block;
    min-width: 90px;
    padding: 2px 8px;
    margin: 0 4px;
    border: none;
    border-bottom: 2px dashed #f59e0b;
    background: rgba(245, 158, 11, 0.12);
    color: #fef08a;
    font-size: 13.5px;
    font-family: var(--font-sans);
    border-radius: 4px 4px 0 0;
    outline: none;
    transition: all 0.15s ease;
    box-sizing: border-box;
  }
  .wr-inline-blank:focus {
    border-bottom: 2px solid #3b82f6;
    background: rgba(59, 130, 246, 0.2);
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
  }
  .wr-raw-editor {
    width: 100%;
    min-height: 480px;
    background: #020617;
    border: 1px solid #1e293b;
    border-radius: 12px;
    padding: 24px;
    color: #e2e8f0;
    font-family: monospace;
    font-size: 13.5px;
    line-height: 1.7;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }

  /* ── STAGE IV & V: MERGED SPLIT-PANE SIMULATION ROOM ────────────── */
  .wr-sim-split-room {
    display: grid;
    grid-template-columns: 5fr 7fr;
    gap: 24px;
    align-items: start;
  }
  .wr-opposition-pane {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .wr-threat-card {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-left: 4px solid #ef4444;
    border-radius: 12px;
    overflow: hidden;
    transition: all 0.18s ease;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  }
  .wr-threat-card:hover {
    border-color: #334155;
    border-left-color: #f87171;
  }
  .wr-threat-trigger {
    padding: 14px 16px;
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    background: rgba(239, 68, 68, 0.02);
  }
  .wr-threat-header-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .wr-threat-tag {
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #f87171;
  }
  .wr-threat-addressed-badge {
    font-size: 10px;
    font-weight: 700;
    color: #34d399;
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.3);
    padding: 1px 6px;
    border-radius: 4px;
  }
  .wr-threat-q {
    font-size: 13.5px;
    font-weight: 600;
    color: #f1f5f9;
    line-height: 1.5;
  }
  .wr-chevron {
    color: #94a3b8;
    flex-shrink: 0;
    margin-top: 3px;
    transition: transform 0.2s ease;
  }
  .wr-chevron.open { transform: rotate(180deg); }
  .wr-rebuttal-panel {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .wr-rebuttal-panel.open {
    max-height: 700px;
  }
  .wr-rebuttal-inner {
    padding: 12px 16px 16px;
    border-top: 1px solid #1e293b;
    background: rgba(16, 185, 129, 0.02);
  }
  .wr-rebuttal-label {
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #34d399;
    margin-bottom: 6px;
  }
  .wr-rebuttal-body {
    font-size: 13px;
    color: #e2e8f0;
    line-height: 1.6;
    background: rgba(16, 185, 129, 0.06);
    border-left: 2px solid #10b981;
    padding: 10px 12px;
    border-radius: 0 6px 6px 0;
  }
  .wr-use-rebuttal-action-btn {
    margin-top: 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    font-family: var(--font-sans);
    border: none;
    background: #059669;
    color: #ffffff;
    transition: all 0.15s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .wr-use-rebuttal-action-btn:hover {
    background: #10b981;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
  }

  /* ── STAGE V: CHAT WORKSTATION ──────────────────────────────────── */
  .wr-chat-pane {
    position: sticky;
    top: 64px;
    display: flex;
    flex-direction: column;
  }
  .wr-chat-outer {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  }
  .wr-tone-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 16px;
    background: #020617;
    border-bottom: 1px solid #1e293b;
    flex-wrap: wrap;
  }
  .wr-tone-toggle-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .wr-tone-btn {
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid #334155;
    background: transparent;
    color: #94a3b8;
    font-family: var(--font-sans);
  }
  .wr-tone-btn:hover { color: #ffffff; }
  .wr-tone-btn.tone-agg {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
    color: #fca5a5;
  }
  .wr-tone-btn.tone-def {
    background: rgba(16, 185, 129, 0.15);
    border-color: rgba(16, 185, 129, 0.4);
    color: #6ee7b7;
  }
  .wr-persona-status {
    font-size: 11px;
    color: #94a3b8;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .wr-persona-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #3b82f6;
    box-shadow: 0 0 6px #3b82f6;
  }
  .wr-chat-messages {
    height: 400px;
    overflow-y: auto;
    padding: 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: rgba(2, 6, 23, 0.3);
    scrollbar-width: thin;
    scrollbar-color: #334155 transparent;
  }
  .wr-chat-messages::-webkit-scrollbar { width: 5px; }
  .wr-chat-messages::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
  .wr-bubble {
    max-width: 88%;
    padding: 13px 17px;
    border-radius: 14px;
    font-size: 14px;
    line-height: 1.65;
  }
  .wr-bubble.user {
    align-self: flex-end;
    background: #2563eb;
    color: #ffffff;
    border-bottom-right-radius: 4px;
    box-shadow: 0 2px 12px rgba(37, 99, 235, 0.25);
  }
  .wr-bubble.bot {
    align-self: flex-start;
    background: #1e293b;
    border: 1px solid #334155;
    color: #e2e8f0;
    border-bottom-left-radius: 4px;
  }
  .wr-bubble.typing {
    align-self: flex-start;
    background: #1e293b;
    border: 1px solid #334155;
    color: #94a3b8;
    border-bottom-left-radius: 4px;
    font-style: italic;
    animation: wr-blink 1.1s ease-in-out infinite;
  }
  @keyframes wr-blink {
    0%,100% { opacity: 1; } 50% { opacity: 0.45; }
  }
  .wr-quick-replies {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-self: flex-start;
    max-width: 95%;
  }
  .wr-qr-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 13px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
    border: 1px solid rgba(59, 130, 246, 0.3);
    background: rgba(59, 130, 246, 0.08);
    color: #93c5fd;
    transition: all 0.15s ease;
    line-height: 1.4;
  }
  .wr-qr-pill:hover:not(:disabled) {
    background: rgba(59, 130, 246, 0.18);
    border-color: #3b82f6;
    color: #bfdbfe;
    transform: translateY(-1px);
  }
  .wr-chat-input-row {
    display: flex;
    border-top: 1px solid #1e293b;
    background: #0f172a;
  }
  .wr-chat-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 13.5px;
    font-family: var(--font-sans);
    padding: 14px 16px;
  }
  .wr-chat-input::placeholder { color: #64748b; }
  .wr-send-btn {
    background: #2563eb;
    border: none;
    padding: 0 20px;
    cursor: pointer;
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font-sans);
    transition: background 0.15s ease;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .wr-send-btn:hover:not(:disabled) { background: #1d4ed8; }
  .wr-send-btn:disabled { background: rgba(37, 99, 235, 0.35); cursor: not-allowed; }
  .wr-save-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 18px;
    border-top: 1px solid #1e293b;
    background: #020617;
  }
  .wr-save-hint {
    font-size: 12px;
    color: #94a3b8;
  }
  .wr-save-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 15px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: 1px solid rgba(16, 185, 129, 0.3);
    background: rgba(16, 185, 129, 0.1);
    color: #34d399;
    font-family: var(--font-sans);
    transition: all 0.15s ease;
  }
  .wr-save-btn:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.2);
    box-shadow: 0 2px 8px rgba(16, 185, 129, 0.2);
  }
  .wr-save-btn.saved {
    background: rgba(16, 185, 129, 0.25);
    border-color: #10b981;
    color: #10b981;
  }

  /* ── LIGHT THEME COMPLETE HIGH-CONTRAST OVERRIDES ── */
  :root[data-theme="light"] .wr-results-page {
    background: #f8fafc !important;
  }
  :root[data-theme="light"] .wr-matter-header {
    background: #ffffff !important;
    border-bottom: 1px solid #e2e8f0 !important;
  }
  :root[data-theme="light"] .wr-matter-title {
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-meta-pill.strategy {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #1d4ed8 !important;
  }
  :root[data-theme="light"] .wr-meta-pill.forum {
    background: #f1f5f9 !important;
    border-color: #cbd5e1 !important;
    color: #475569 !important;
  }
  :root[data-theme="light"] .wr-meta-pill.law {
    background: #fffbeb !important;
    border-color: #fde68a !important;
    color: #b45309 !important;
  }
  :root[data-theme="light"] .wr-header-btn.secondary {
    background: #ffffff !important;
    color: #334155 !important;
    border-color: #cbd5e1 !important;
  }
  :root[data-theme="light"] .wr-header-btn.secondary:hover {
    background: #f1f5f9 !important;
  }
  :root[data-theme="light"] .wr-stage-navigator {
    background: rgba(255, 255, 255, 0.92) !important;
    border-bottom: 1px solid #e2e8f0 !important;
  }
  :root[data-theme="light"] .wr-nav-item {
    color: #64748b !important;
  }
  :root[data-theme="light"] .wr-nav-item:hover {
    color: #0f172a !important;
    background: #f1f5f9 !important;
  }
  :root[data-theme="light"] .wr-nav-item.active {
    color: #1d4ed8 !important;
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
  }
  :root[data-theme="light"] .wr-nav-progress {
    background: #ecfdf5 !important;
    border-color: #a7f3d0 !important;
    color: #059669 !important;
  }
  :root[data-theme="light"] .wr-section-title {
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-section-badge {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #1d4ed8 !important;
  }
  :root[data-theme="light"] .wr-section-desc {
    color: #64748b !important;
  }
  :root[data-theme="light"] .wr-issue-card {
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
    box-shadow: 0 1px 4px rgba(0,0,0,0.04) !important;
  }
  :root[data-theme="light"] .wr-issue-idx {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #1d4ed8 !important;
  }
  :root[data-theme="light"] .wr-issue-content {
    color: #1e293b !important;
  }
  :root[data-theme="light"] .wr-precedent-card {
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04) !important;
  }
  :root[data-theme="light"] .wr-precedent-title {
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-precedent-auth-tag {
    background: #fffbeb !important;
    border-color: #fde68a !important;
    color: #b45309 !important;
  }
  :root[data-theme="light"] .wr-precedent-ratio {
    background: #f8fafc !important;
    border-left: 3px solid #d97706 !important;
    color: #334155 !important;
  }
  :root[data-theme="light"] .wr-precedent-link {
    color: #2563eb !important;
  }
  :root[data-theme="light"] .wr-folio-toolbar {
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
  }
  :root[data-theme="light"] .wr-folio-badge {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #1d4ed8 !important;
  }
  :root[data-theme="light"] .wr-folio-btn {
    background: #ffffff !important;
    border-color: #cbd5e1 !important;
    color: #334155 !important;
  }
  :root[data-theme="light"] .wr-folio-btn:hover {
    background: #f1f5f9 !important;
  }
  :root[data-theme="light"] .wr-folio-sheet {
    background: #fcfbf8 !important;
    border: 1px solid #d6d3d1 !important;
    color: #1c1917 !important;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06) !important;
  }
  :root[data-theme="light"] .wr-folio-h1 {
    color: #0f172a !important;
    border-bottom: 2px double #cbd5e1 !important;
  }
  :root[data-theme="light"] .wr-folio-h2 {
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-folio-h3 {
    color: #1d4ed8 !important;
  }
  :root[data-theme="light"] .wr-folio-h4 {
    color: #334155 !important;
  }
  :root[data-theme="light"] .wr-folio-quote {
    background: #f1f5f9 !important;
    border-left: 3px solid #2563eb !important;
    color: #334155 !important;
  }
  :root[data-theme="light"] .wr-folio-bold {
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-folio-italic {
    color: #334155 !important;
  }
  :root[data-theme="light"] .wr-folio-code {
    background: #f1f5f9 !important;
    color: #1d4ed8 !important;
  }
  :root[data-theme="light"] .wr-inline-blank {
    background: rgba(245, 158, 11, 0.15) !important;
    border-bottom: 2px dashed #d97706 !important;
    color: #78350f !important;
  }
  :root[data-theme="light"] .wr-inline-blank:focus {
    background: #eff6ff !important;
    border-bottom: 2px solid #2563eb !important;
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-raw-editor {
    background: #ffffff !important;
    border: 1px solid #cbd5e1 !important;
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-threat-card {
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
    border-left: 4px solid #dc2626 !important;
    box-shadow: 0 1px 4px rgba(0,0,0,0.04) !important;
  }
  :root[data-theme="light"] .wr-threat-trigger {
    background: #fff5f5 !important;
  }
  :root[data-theme="light"] .wr-threat-tag {
    color: #b91c1c !important;
  }
  :root[data-theme="light"] .wr-threat-q {
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-rebuttal-inner {
    border-top: 1px solid #e2e8f0 !important;
    background: #ffffff !important;
  }
  :root[data-theme="light"] .wr-rebuttal-label {
    color: #059669 !important;
  }
  :root[data-theme="light"] .wr-rebuttal-body {
    background: #f0fdf4 !important;
    border-left: 2px solid #10b981 !important;
    color: #065f46 !important;
  }
  :root[data-theme="light"] .wr-chat-outer {
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
    box-shadow: 0 4px 20px rgba(0,0,0,0.06) !important;
  }
  :root[data-theme="light"] .wr-tone-bar {
    background: #f8fafc !important;
    border-bottom: 1px solid #e2e8f0 !important;
  }
  :root[data-theme="light"] .wr-tone-btn {
    border-color: #cbd5e1 !important;
    color: #64748b !important;
  }
  :root[data-theme="light"] .wr-tone-btn:hover {
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-tone-btn.tone-agg {
    background: #fee2e2 !important;
    border-color: #fca5a5 !important;
    color: #b91c1c !important;
  }
  :root[data-theme="light"] .wr-tone-btn.tone-def {
    background: #ecfdf5 !important;
    border-color: #a7f3d0 !important;
    color: #047857 !important;
  }
  :root[data-theme="light"] .wr-chat-messages {
    background: #f8fafc !important;
  }
  :root[data-theme="light"] .wr-bubble.bot {
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
    color: #1e293b !important;
  }
  :root[data-theme="light"] .wr-bubble.typing {
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
    color: #64748b !important;
  }
  :root[data-theme="light"] .wr-qr-pill {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #1d4ed8 !important;
  }
  :root[data-theme="light"] .wr-qr-pill:hover:not(:disabled) {
    background: #dbeafe !important;
    border-color: #3b82f6 !important;
    color: #1d4ed8 !important;
  }
  :root[data-theme="light"] .wr-chat-input-row {
    background: #ffffff !important;
    border-top: 1px solid #e2e8f0 !important;
  }
  :root[data-theme="light"] .wr-chat-input {
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-chat-input::placeholder {
    color: #94a3b8 !important;
  }
  :root[data-theme="light"] .wr-save-bar {
    background: #f8fafc !important;
    border-top: 1px solid #e2e8f0 !important;
  }
  :root[data-theme="light"] .wr-save-hint {
    color: #64748b !important;
  }
  :root[data-theme="light"] .wr-save-btn {
    background: #ecfdf5 !important;
    border-color: #a7f3d0 !important;
    color: #059669 !important;
  }
  :root[data-theme="light"] .wr-save-btn:hover:not(:disabled) {
    background: #d1fae5 !important;
  }

  /* ── LIGHT THEME INTAKE OVERRIDES ── */
  :root[data-theme="light"] .wr-intake-card {
    background: #ffffff !important;
    border: 1px solid #e2e8f0 !important;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05) !important;
  }
  :root[data-theme="light"] .wr-intake-badge {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #2563eb !important;
  }
  :root[data-theme="light"] .wr-intake-title {
    color: #0f172a !important;
  }
  :root[data-theme="light"] .wr-intake-subtitle {
    color: #64748b !important;
  }
  :root[data-theme="light"] .wr-intake-dropzone {
    border-color: #cbd5e1 !important;
    background: rgba(248, 250, 252, 0.8) !important;
  }
  :root[data-theme="light"] .wr-intake-dropzone:hover {
    border-color: #3b82f6 !important;
    background: rgba(239, 246, 255, 0.4) !important;
  }
  :root[data-theme="light"] .wr-intake-dropzone.drag-over {
    border-color: #2563eb !important;
    background: #dbeafe !important;
  }
  :root[data-theme="light"] .wr-intake-dropzone-primary {
    color: #1e293b !important;
  }
  :root[data-theme="light"] .wr-intake-dropzone-secondary {
    color: #64748b !important;
  }
  :root[data-theme="light"] .wr-intake-divider {
    color: #94a3b8 !important;
  }
  :root[data-theme="light"] .wr-intake-divider::before,
  :root[data-theme="light"] .wr-intake-divider::after {
    background: #e2e8f0 !important;
  }
  :root[data-theme="light"] .wr-intake-step-num {
    background: #eff6ff !important;
    border-color: #bfdbfe !important;
    color: #2563eb !important;
  }
  :root[data-theme="light"] .wr-intake-step-title {
    color: #1e293b !important;
  }
  :root[data-theme="light"] .wr-intake-step-desc {
    color: #64748b !important;
  }
  :root[data-theme="light"] .wr-intake-chip {
    background: #f1f5f9 !important;
    border-color: #e2e8f0 !important;
    color: #1d4ed8 !important;
  }
  :root[data-theme="light"] .wr-intake-btn-primary {
    background: #2563eb !important;
    color: #ffffff !important;
  }
  :root[data-theme="light"] .wr-intake-btn-secondary {
    background: #ffffff !important;
    color: #334155 !important;
    border-color: #cbd5e1 !important;
  }
  :root[data-theme="light"] .wr-intake-btn-secondary:hover {
    background: #f8fafc !important;
  }

  /* ── RESPONSIVE RULES ──────────────────────────────────────────── */
  @media (max-width: 1024px) {
    .wr-sim-split-room {
      grid-template-columns: 1fr;
    }
    .wr-chat-pane {
      position: static;
    }
    .wr-folio-sheet {
      padding: 32px 24px;
    }
  }

  @media (max-width: 768px) {
    .wr-matter-header {
      flex-direction: column;
      align-items: flex-start;
      padding: 14px 16px;
    }
    .wr-matter-title {
      max-width: 100%;
      font-size: 17px;
    }
    .wr-header-actions {
      width: 100%;
      justify-content: flex-start;
    }
    .wr-results-body {
      padding: 14px 12px;
    }
    .wr-precedents-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ── PRINT MEDIA OPTIMIZATIONS ─────────────────────────────────── */
  @media print {
    .sidebar,
    .topbar,
    .wr-stage-navigator,
    .wr-chat-pane,
    .wr-folio-toolbar,
    .wr-header-actions,
    .wr-intake-wrap,
    .wr-pipeline-wrap,
    .wr-opposition-pane,
    .wr-save-bar,
    button {
      display: none !important;
    }
    .app-container,
    .workspace-container,
    .main-content,
    .wr-results-page,
    .wr-results-body {
      height: auto !important;
      overflow: visible !important;
      padding: 0 !important;
      margin: 0 !important;
      background: #ffffff !important;
      color: #000000 !important;
    }
    .wr-folio-sheet {
      box-shadow: none !important;
      border: none !important;
      padding: 0 !important;
      max-width: 100% !important;
      color: #000000 !important;
      background: #ffffff !important;
    }
    .wr-inline-blank {
      border-bottom: 1px solid #000000 !important;
      background: transparent !important;
      color: #000000 !important;
    }
  }
`;

// ── Sub-component: Inline Blank Input ───────────────────────────────────────

function InlineBlankInput({ blank, value, onChange }) {
  const displayVal = value || '';
  const widthChars = Math.max(8, (displayVal || blank.label).length + 3);
  const widthPx = Math.min(260, Math.max(90, widthChars * 8.5));

  return (
    <input
      type="text"
      className="wr-inline-blank"
      placeholder={blank.label}
      value={displayVal}
      onChange={(e) => onChange(blank.id, e.target.value)}
      title={`Placeholder: ${blank.label}`}
      style={{ width: `${widthPx}px` }}
    />
  );
}

// ── Sub-component: Styled Text Renderer ─────────────────────────────────────
// Applies the bold/italic/code flags parseInlineSegments computed per
// segment — these already correctly span across inline blanks, so no
// re-parsing of ** / * / ` markers happens at render time.

function renderStyledText(content, { bold, italic, code }) {
  let node = content;
  if (code) node = <code className="wr-folio-code">{node}</code>;
  if (italic) node = <em className="wr-folio-italic">{node}</em>;
  if (bold) node = <strong className="wr-folio-bold">{node}</strong>;
  return node;
}

function renderSegments(segments, formBlanks, onBlankChange) {
  if (!segments) return null;
  return segments.map((seg, i) => {
    if (seg.type === 'blank') {
      return (
        <InlineBlankInput
          key={seg.id}
          blank={seg}
          value={formBlanks[seg.id]}
          onChange={onBlankChange}
        />
      );
    }
    return <React.Fragment key={i}>{renderStyledText(seg.content, seg)}</React.Fragment>;
  });
}

// ── Sub-component: PleadingFolio ────────────────────────────────────────────

function PleadingFolio({
  rawArgumentText,
  formBlanks,
  onBlankChange,
  onCopyComplete,
  copied,
  showRaw,
  onToggleRaw,
  onDownloadBrief,
  onPrintBrief,
}) {
  const { blocks, blanksList } = useMemo(() => {
    return parsePleadingDocument(rawArgumentText);
  }, [rawArgumentText]);

  return (
    <div className="wr-folio-workbench">
      <div className="wr-folio-toolbar">
        <div className="wr-folio-tools-left">
          <span className="wr-folio-badge">Legal Folio Workbench</span>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {blanksList.length} Fillable Placeholder{blanksList.length !== 1 ? 's' : ''} Active
          </span>
        </div>
        <div className="wr-folio-tools-right">
          <button className="wr-folio-btn" type="button" onClick={onToggleRaw} title="Toggle between formatted legal document and raw markdown text">
            {showRaw ? '📄 View Formatted Document' : '📝 Raw Markdown'}
          </button>
          <button className={`wr-folio-btn${copied ? ' copied' : ''}`} type="button" onClick={() => onCopyComplete(blanksList)} title="Copy compiled pleading with all filled blanks to clipboard">
            {copied ? '✓ Copied Pleading!' : '📋 Copy Complete Pleading'}
          </button>
          <button className="wr-folio-btn" type="button" onClick={() => onDownloadBrief(blanksList)} title="Download complete brief as Markdown file">
            ⬇ Export Brief
          </button>
          <button className="wr-folio-btn" type="button" onClick={onPrintBrief} title="Print structured legal brief">
            🖨 Print
          </button>
        </div>
      </div>

      {showRaw ? (
        <textarea
          className="wr-raw-editor"
          value={compilePleadingText(rawArgumentText, formBlanks, blanksList)}
          readOnly
        />
      ) : (
        <div className="wr-folio-sheet">
          <h1 className="wr-folio-h1">IN THE SUPREME COURT OF INDIA</h1>
          <div style={{ textAlign: 'center', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '24px' }}>
            APPELLATE JURISDICTION · SPECIAL LEAVE PETITION / CIVIL APPEAL
          </div>

          {blocks.map((b, idx) => {
            if (b.type === 'hr') return <hr key={idx} className="wr-folio-hr" />;
            if (b.type === 'h1') return <h2 key={idx} className="wr-folio-h1">{renderSegments(b.segments, formBlanks, onBlankChange)}</h2>;
            if (b.type === 'h2') return <h2 key={idx} className="wr-folio-h2">{renderSegments(b.segments, formBlanks, onBlankChange)}</h2>;
            if (b.type === 'h3') return <h3 key={idx} className="wr-folio-h3">{renderSegments(b.segments, formBlanks, onBlankChange)}</h3>;
            if (b.type === 'h4') return <h4 key={idx} className="wr-folio-h4">{renderSegments(b.segments, formBlanks, onBlankChange)}</h4>;
            if (b.type === 'quote') return <blockquote key={idx} className="wr-folio-quote">{renderSegments(b.segments, formBlanks, onBlankChange)}</blockquote>;
            if (b.type === 'num-item') {
              return (
                <div key={idx} className="wr-folio-num">
                  <span className="wr-folio-num-idx">{b.num}.</span>
                  <div>{renderSegments(b.segments, formBlanks, onBlankChange)}</div>
                </div>
              );
            }
            if (b.type === 'bullet-item') {
              return (
                <div key={idx} className="wr-folio-bullet">
                  <span className="wr-folio-bullet-dot">▪</span>
                  <div>{renderSegments(b.segments, formBlanks, onBlankChange)}</div>
                </div>
              );
            }
            return (
              <p key={idx} className="wr-folio-p">
                {renderSegments(b.segments, formBlanks, onBlankChange)}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sub-component: Precedent Report Card ────────────────────────────────────

function PrecedentReportCard({ citation, index }) {
  const { cleanTitle, citationTag, ratio, url } = useMemo(() => {
    return parsePrecedentData(citation, index);
  }, [citation, index]);

  return (
    <div className="wr-precedent-card">
      <div className="wr-precedent-head">
        <span className="wr-precedent-auth-tag">🏛 {citationTag}</span>
        <div className="wr-precedent-title">*{cleanTitle}*</div>
      </div>
      <div className="wr-precedent-ratio">
        "{ratio}"
      </div>
      <a className="wr-precedent-link" href={url} target="_blank" rel="noopener noreferrer">
        Source Record ↗
      </a>
    </div>
  );
}

// ── Sub-component: Opposition Challenge Card ────────────────────────────────

function OppositionChallengeCard({ threat, index, expanded, isAddressed, onToggle, onUseInChat }) {
  return (
    <div className="wr-threat-card">
      <div className="wr-threat-trigger" onClick={onToggle}>
        <div style={{ minWidth: 0 }}>
          <div className="wr-threat-header-row">
            <span className="wr-threat-tag">Opposition Challenge {String(index + 1).padStart(2, '0')}</span>
            {isAddressed && <span className="wr-threat-addressed-badge">✓ Addressed</span>}
          </div>
          <div className="wr-threat-q">{renderParagraphs(threat.question)}</div>
        </div>
        <svg className={`wr-chevron${expanded ? ' open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      <div className={`wr-rebuttal-panel${expanded ? ' open' : ''}`}>
        {threat.suggested_rebuttal && (
          <div className="wr-rebuttal-inner">
            <div className="wr-rebuttal-label">Strategic Rebuttal Argument</div>
            <div className="wr-rebuttal-body">{renderParagraphs(threat.suggested_rebuttal)}</div>
            <button
              className="wr-use-rebuttal-action-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUseInChat(threat.suggested_rebuttal, index);
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Use in Chat →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-component: Sticky Stage Navigator ───────────────────────────────────

function StageNavigator({ activeStage, onSelectStage, addressedCount, totalChallenges }) {
  const STAGES = [
    { id: 'wr-stage-issues', roman: 'I', label: 'Facts & Issues' },
    { id: 'wr-stage-precedents', roman: 'II', label: 'Precedents' },
    { id: 'wr-stage-pleading', roman: 'III', label: 'Pleading Draft' },
    { id: 'wr-stage-simulation', roman: 'IV & V', label: 'Simulation Room' },
  ];

  const isAllComplete = totalChallenges > 0 && addressedCount >= totalChallenges;

  return (
    <div className="wr-stage-navigator">
      <div className="wr-nav-track">
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`wr-nav-item${activeStage === s.id ? ' active' : ''}`}
            onClick={() => onSelectStage(s.id)}
          >
            <span className="wr-nav-roman">{s.roman}.</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div className={`wr-nav-progress${isAllComplete ? ' complete' : ''}`}>
        {isAllComplete ? (
          <>✓ All {totalChallenges} Rebuttals Addressed</>
        ) : (
          <>🛡️ {addressedCount}/{totalChallenges} Rebuttals Addressed</>
        )}
      </div>
    </div>
  );
}

// ── Sub-component: Dynamic Matter Header ─────────────────────────────────────

function DynamicMatterHeader({ simulationData, docSource, onResetSimulation, onPrintBrief }) {
  const matterTitle = useMemo(() => parseMatterTitle(simulationData, docSource), [simulationData, docSource]);
  const governingLaw = useMemo(() => parseGoverningLaw(simulationData?.extracted_issues, simulationData?.opening_argument), [simulationData]);

  return (
    <div className="wr-matter-header">
      <div className="wr-matter-info">
        <div className="wr-matter-title-row">
          <h1 className="wr-matter-title" title={matterTitle}>{matterTitle}</h1>
        </div>
        <div className="wr-matter-meta-pills">
          <span className="wr-meta-pill strategy">
            {simulationData?.client_side || 'Appellant'} Strategy
          </span>
          <span className="wr-meta-pill forum">
            🏛 Supreme Court of India · Civil Appellate
          </span>
          <span className="wr-meta-pill law" title="Governing Legal Regime">
            ⚖ {governingLaw}
          </span>
        </div>
      </div>

      <div className="wr-header-actions">
        <button className="wr-header-btn secondary" type="button" onClick={onPrintBrief} title="Print structured legal brief">
          🖨 Print Brief
        </button>
        <button className="wr-header-btn danger" type="button" onClick={onResetSimulation} title="Clear current simulation and start new matter">
          ↺ Reset Matter
        </button>
      </div>
    </div>
  );
}

// ── Main Component: WarRoomView ─────────────────────────────────────────────

export default function WarRoomView() {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const location = useLocation();
  const navigate = useNavigate();

  // Lifecycle & Animation
  const [isMounted, setIsMounted] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [simError, setSimError] = useState(null);
  const [simulationData, setSimulationData] = useState(null);
  const [docSource, setDocSource] = useState('');

  // Interactive State
  const [activeStageId, setActiveStageId] = useState('wr-stage-issues');
  const [expandedThreats, setExpandedThreats] = useState(new Set([0]));
  const [addressedChallenges, setAddressedChallenges] = useState(new Set());
  const [formBlanks, setFormBlanks] = useState({});
  const [showRawMarkdown, setShowRawMarkdown] = useState(false);
  const [copiedPleading, setCopiedPleading] = useState(false);

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

  // ── Stage III Actions ─────────────────────────────────────────────────────

  const handleBlankChange = useCallback((blankId, value) => {
    setFormBlanks(prev => ({ ...prev, [blankId]: value }));
  }, []);

  const handleCopyCompletePleading = (blanksList) => {
    const raw = simulationData?.opening_argument || '';
    const compiled = compilePleadingText(raw, formBlanks, blanksList);
    if (compiled) {
      navigator.clipboard.writeText(compiled);
      setCopiedPleading(true);
      setTimeout(() => setCopiedPleading(false), 2500);
    }
  };

  const handleDownloadBrief = (blanksList) => {
    const raw = simulationData?.opening_argument || '';
    const compiled = compilePleadingText(raw, formBlanks, blanksList);
    const blob = new Blob([compiled], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Litigation_Pleading_${(docSource || 'Matter').replace(/[^a-zA-Z0-9]/g, '_')}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintBrief = () => {
    window.print();
  };

  const handleResetSimulation = () => {
    if (window.confirm('Reset the current simulation session and return to matter intake?')) {
      sessionStorage.removeItem('wr_active_session');
      clearStageTimers();
      setSimulationData(null);
      setIsSimulating(false);
      setSimError(null);
      setChatMessages([]);
      setFormBlanks({});
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
    setFormBlanks({});
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
    const raf = requestAnimationFrame(() => setIsMounted(true));

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

    return () => { cancelAnimationFrame(raf); clearStageTimers(); };
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
    const ids = ['wr-stage-issues', 'wr-stage-precedents', 'wr-stage-pleading', 'wr-stage-simulation'];
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

  const toggleThreat = (i) => {
    setExpandedThreats(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
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

  // ── RENDER: Error Fallback ────────────────────────────────────────────────

  if (simError) {
    return (
      <>
        <style>{WAR_ROOM_STYLES}</style>
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
      </>
    );
  }

  // ── RENDER: Ingestion / Intake Card ───────────────────────────────────────

  if (!simulationData) {
    return (
      <>
        <style>{WAR_ROOM_STYLES}</style>
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
      </>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ── RENDER: ENTERPRISE LITIGATION WAR ROOM WORKBENCH ─────────────────────────
  // ────────────────────────────────────────────────────────────────────────────

  const issues = parseIssues(simulationData.extracted_issues);
  const citations = simulationData.live_citations ?? [];
  const questions = simulationData.red_team?.opposing_counter_questions ?? [];

  return (
    <>
      <style>{WAR_ROOM_STYLES}</style>

      <div className={`wr-results-page${isMounted ? ' wr-mounted' : ''}`}>

        {/* ── 1. DYNAMIC MATTER HEADER (No Badge Theater) ── */}
        <DynamicMatterHeader
          simulationData={simulationData}
          docSource={docSource}
          onResetSimulation={handleResetSimulation}
          onPrintBrief={handlePrintBrief}
        />

        {/* ── 2. STICKY STAGE NAVIGATOR ── */}
        <StageNavigator
          activeStage={activeStageId}
          onSelectStage={scrollToStage}
          addressedCount={addressedChallenges.size}
          totalChallenges={questions.length}
        />

        {/* ── 3. MAIN WORKBENCH BODY ── */}
        <div className="wr-results-body">

          {/* ───────── STAGE I: FACTS & CORE LEGAL ISSUES ───────── */}
          <section id="wr-stage-issues" className="wr-section-container">
            <div className="wr-section-head">
              <span className="wr-section-badge">I</span>
              <h2 className="wr-section-title">Extracted Legal Issues &amp; Core Facts</h2>
              <span className="wr-section-desc">{issues.length} Key Legal Questions Identified</span>
            </div>

            <div className="wr-issues-grid">
              {issues.length > 0 ? (
                issues.map((issue, i) => (
                  <div key={i} className="wr-issue-card">
                    <span className="wr-issue-idx">{String(i + 1).padStart(2, '0')}</span>
                    <div className="wr-issue-content">{issue}</div>
                  </div>
                ))
              ) : (
                <div className="wr-issue-card">
                  <div className="wr-issue-content">
                    {simulationData.extracted_issues || 'No specific legal issues extracted.'}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ───────── STAGE II: REFINED PRECEDENT CITATION CARDS ───────── */}
          <section id="wr-stage-precedents" className="wr-section-container">
            <div className="wr-section-head">
              <span className="wr-section-badge">II</span>
              <h2 className="wr-section-title">Precedents &amp; Authority Reports</h2>
              <span className="wr-section-desc">{citations.length} Authorities Cited</span>
            </div>

            {citations.length > 0 ? (
              <div className="wr-precedents-grid">
                {citations.map((c, i) => (
                  <PrecedentReportCard key={i} citation={c} index={i} />
                ))}
              </div>
            ) : (
              <div className="wr-issue-card" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                No live citations retrieved for this matter query.
              </div>
            )}
          </section>

          {/* ───────── STAGE III: PLEADING WORKBENCH & INLINE EDITING ───────── */}
          <section id="wr-stage-pleading" className="wr-section-container">
            <div className="wr-section-head">
              <span className="wr-section-badge">III</span>
              <h2 className="wr-section-title">Drafted Opening Argument &amp; Legal Pleading</h2>
              <span className="wr-section-desc">Interactive Legal Folio</span>
            </div>

            <PleadingFolio
              rawArgumentText={simulationData.opening_argument}
              formBlanks={formBlanks}
              onBlankChange={handleBlankChange}
              onCopyComplete={handleCopyCompletePleading}
              copied={copiedPleading}
              showRaw={showRawMarkdown}
              onToggleRaw={() => setShowRawMarkdown(prev => !prev)}
              onDownloadBrief={handleDownloadBrief}
              onPrintBrief={handlePrintBrief}
            />
          </section>

          {/* ───────── STAGE IV & V: MERGED SPLIT-PANE SIMULATION ROOM ───────── */}
          <section id="wr-stage-simulation" className="wr-section-container">
            <div className="wr-section-head">
              <span className="wr-section-badge">IV &amp; V</span>
              <h2 className="wr-section-title">Litigation Simulation Room</h2>
              <span className="wr-section-desc">Split-Pane Adversarial Interrogation &amp; Live Trial</span>
            </div>

            <div className="wr-sim-split-room">

              {/* LEFT PANE: Opposition Attack Queue (Stage IV) */}
              <div className="wr-opposition-pane">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#f87171' }}>
                    Opposition Counsel Attack Queue ({questions.length})
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Click "Use in Chat →" to counter
                  </span>
                </div>

                {questions.length > 0 ? (
                  questions.map((threat, i) => (
                    <OppositionChallengeCard
                      key={i}
                      threat={threat}
                      index={i}
                      expanded={expandedThreats.has(i)}
                      isAddressed={addressedChallenges.has(i)}
                      onToggle={() => toggleThreat(i)}
                      onUseInChat={handleUseInChat}
                    />
                  ))
                ) : (
                  <div className="wr-threat-card" style={{ padding: '20px', textAlign: 'center', fontStyle: 'italic', color: 'var(--text-muted)' }}>
                    No opposition challenges detected.
                  </div>
                )}
              </div>

              {/* RIGHT PANE: Continuous Simulation Chat (Stage V) */}
              <div className="wr-chat-pane">
                <div className="wr-chat-outer">

                  {/* Top Strategy & Persona Bar */}
                  <div className="wr-tone-bar">
                    <div className="wr-tone-toggle-group">
                      <button
                        className={`wr-tone-btn${strategyTone === 'aggressive' ? ' tone-agg' : ''}`}
                        onClick={() => setStrategyTone('aggressive')}
                        type="button"
                      >
                        ⚔️ Aggressive (Counter-Attack)
                      </button>
                      <button
                        className={`wr-tone-btn${strategyTone === 'defensive' ? ' tone-def' : ''}`}
                        onClick={() => setStrategyTone('defensive')}
                        type="button"
                      >
                        🛡️ Defensive (Shield / Mitigate)
                      </button>
                    </div>

                    <div className="wr-persona-status">
                      <span className="wr-persona-dot" />
                      <span>Opposing Counsel Active</span>
                    </div>
                  </div>

                  {/* Messages Scroll Area */}
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
                                type="button"
                              >
                                <span>↳</span>
                                <span>{r}</span>
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

                  {/* Chat Input Bar */}
                  <form className="wr-chat-input-row" onSubmit={handleChatSubmit}>
                    <input
                      ref={chatInputRef}
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

                  {/* Save Session Footer */}
                  <div className="wr-save-bar">
                    <span className="wr-save-hint">
                      Save full simulation package to your Case Vault.
                    </span>
                    <button
                      className={`wr-save-btn${savedSession ? ' saved' : ''}`}
                      onClick={handleSaveSession}
                      disabled={savingSession || savedSession}
                      type="button"
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
                          Save to Case Vault
                        </>
                      )}
                    </button>
                  </div>

                </div>
              </div>

            </div>
          </section>

        </div>{/* end wr-results-body */}

      </div>{/* end wr-results-page */}
    </>
  );
}
