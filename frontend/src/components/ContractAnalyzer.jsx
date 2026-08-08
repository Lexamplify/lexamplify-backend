import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  extractContractText,
  startContractAnalysisJob,
  draftRevision,
  rewriteContractClause,
  fetchContractSummary,
  fetchContractRecommendations,
  chatWithContract,
  exportContract,
  fetchDocuments
} from '../services/api';
import ContractTiptapEditor from './ContractTiptapEditor.jsx';
import { findClauseRange } from '../tiptap/positionMapping.js';
import { useCitationStore } from '../tiptap/citationStore.js';
import useContractJobStream from '../hooks/useContractJobStream.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''; // relative — same-origin via Vite proxy in dev

// Shared "external link" glyph for every "Open Official Record" link
// (parent citation + each nested related-citation) — one definition so the
// icon can't drift between the two usages.
function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// Some citation objects (both the primary RAG-pipeline results and the
// nested "related citations" search) carry a raw internal DB id as their
// "title" — e.g. "1234_5678" — instead of a resolved case name. That
// happens when the source metadata never had a title to begin with.
// Two problems follow: (1) showing "1234_5678" as a card header reads as
// a broken UI, and (2) searching Kanoon for that literal id returns
// generic boilerplate/hallucinated results, since Kanoon has no record
// indexed under an internal id. This derives a presentable title and a
// query that actually stands a chance of finding the real judgment.
// Matches a common-law case name: "Party A v. Party B" (also "vs"/"vs."/
// "versus"). Each side is one or more capitalized tokens, allowing a
// handful of lowercase connectors ("of", "the", "and", "&") so names like
// "Union of India" or "Chemicals & Pharma" match whole. Used to pull a
// real case name out of a related-citation's SNIPPET when its title
// field is useless — see resolveCitationDisplay below.
const NAME_SIDE = "[A-Z][\\w.&'-]*(?:\\s+(?:[A-Z][\\w.&'-]*|of|the|and|&))*";
const CASE_NAME_PATTERN = new RegExp(`\\b${NAME_SIDE}\\s+(?:[vV]\\.?[sS]?\\.?|[Vv]ersus)\\s+${NAME_SIDE}\\b`, 'g');
const HAS_CASE_NAME_MARKER = /\bv\.?s?\.?\b|\bversus\b/i;

// Pulls the longest "X v. Y" match out of free text — longest, not first,
// because a judgment's own body frequently cites OTHER cases as precedent
// before naming itself (see the multi-citation snippets in
// firm-library/external-search results), and a short/truncated match
// earlier in the string is usually a fragment, not the real party names.
function extractCaseName(text) {
  if (!text) return null;
  const matches = [...text.matchAll(CASE_NAME_PATTERN)];
  if (matches.length === 0) return null;
  const longest = matches.reduce((a, b) => (b[0].length > a[0].length ? b : a));
  return longest[0].replace(/\s+/g, ' ').trim();
}

function resolveCitationDisplay(citation) {
  const rawTitle = citation.title || citation.case_title || '';
  const isRawId = /^[0-9_]+$/.test(rawTitle);
  // The related-citations search (firm-library/external-search) sometimes
  // can't resolve a real name either and falls back to a synthetic
  // placeholder like "Supreme Court Judgment (2015) - 2015_12_276_284" —
  // structurally the same problem as a bare raw id (no real name, Kanoon
  // has no record literally titled that), just with cosmetic padding.
  // Detected as: no case-name marker anywhere in the title, AND the tail
  // after the last " - " is a bare alphanumeric/underscore id-shaped
  // token (a real subtitle like "Part 2" wouldn't contain a digit/underscore).
  const idTail = rawTitle.split(/\s+-\s+/).pop() || '';
  const isSyntheticPlaceholder =
    !isRawId && !HAS_CASE_NAME_MARKER.test(rawTitle) &&
    /^[a-zA-Z0-9_]+$/.test(idTail) && /[0-9_]/.test(idTail);

  if (!isRawId && !isSyntheticPlaceholder) {
    // Already a real, presentable name (the common case for primary
    // citations) — leave it exactly as-is.
    return { rawTitle, isRawId, displayTitle: rawTitle, kanoonQuery: rawTitle };
  }

  // Real name analysis: the id/placeholder itself is useless, but the
  // snippet is actual judgment text and often names the case in plain
  // language — extract it so the lawyer sees (and searches for) the same
  // kind of name the primary citations already show, not a raw record id.
  const extractedName = extractCaseName(citation.snippet);
  if (extractedName) {
    return { rawTitle, isRawId, displayTitle: extractedName, kanoonQuery: extractedName };
  }

  // No extractable name — fall back to a labeled id (raw ids only; a
  // synthetic placeholder is already human-readable text, just not a
  // useful search string) and a quoted mid-snippet excerpt for Kanoon.
  // Skips the first 50 chars (usually generic case-caption boilerplate
  // shared across many judgments, not a useful search anchor). Falls back
  // to rawTitle whenever there's nothing better — no snippet, or a
  // snippet too short to leave anything in the 50-130 window
  // (substring() clamps out-of-range indices to '', which would
  // otherwise become a literal empty '""' query — worse than the id itself).
  const displayTitle = isRawId ? `Judgment Record: ${rawTitle.replace(/_/g, '-')}` : rawTitle;
  const snippetExcerpt = citation.snippet ? citation.snippet.substring(50, 130).trim() : '';
  const kanoonQuery = snippetExcerpt ? `"${snippetExcerpt}"` : rawTitle;
  return { rawTitle, isRawId, displayTitle, kanoonQuery };
}

const styles = `
  /* ── ANALYZER CONTAINER ──────────────────────────────────────────── */
  .analyzer-container {
    font-family: var(--font-sans);
    color: var(--text-dark-primary);
    height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-dark-app);
  }

  /* ── HEADER BAR (single compact row) ────────────────────────────── */
  .analyzer-header {
    display: flex;
    align-items: center;
    padding: 0 20px;
    height: 52px;
    background: var(--bg-dark-sidebar);
    border-bottom: 1px solid var(--border-dark-subtle);
    flex-shrink: 0;
    gap: 10px;
    overflow: hidden;
  }

  .analyzer-title-block { display: flex; align-items: baseline; gap: 8px; flex-shrink: 0; }
  .analyzer-title { font-size: 14px; font-weight: 700; color: var(--text-dark-primary, #fff); font-family: var(--font-serif); margin: 0; line-height: 1; white-space: nowrap; }
  .analyzer-subtitle { font-size: 10.5px; color: var(--text-dark-muted); margin: 0; white-space: nowrap; display: none; }
  @media (min-width: 1280px) { .analyzer-subtitle { display: block; } }

  /* Divider pip between sections */
  .header-sep { width: 1px; height: 22px; background: var(--border-dark-subtle); flex-shrink: 0; }

  /* Risk pills inline in header */
  .risk-metric-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 11.5px;
    font-weight: 600;
    border: 1px solid;
    cursor: default;
    white-space: nowrap;
  }
  .risk-metric-pill.high  { background: rgba(239,68,68,0.12); color: #FCA5A5; border-color: rgba(239,68,68,0.3); }
  .risk-metric-pill.amber { background: rgba(245,158,11,0.12); color: #FCD34D; border-color: rgba(245,158,11,0.3); }
  .risk-metric-pill.green { background: rgba(16,185,129,0.12); color: #6EE7B7; border-color: rgba(16,185,129,0.3); }
  .risk-metric-dot { width: 6px; height: 6px; border-radius: 50%; }
  .risk-metric-dot.red   { background: #EF4444; box-shadow: 0 0 4px #EF4444; }
  .risk-metric-dot.amber { background: #F59E0B; box-shadow: 0 0 4px #F59E0B; }
  .risk-metric-dot.green { background: #10B981; box-shadow: 0 0 4px #10B981; }

  .analyzer-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-shrink: 0; }

  /* Bug #8: the header is a single fixed-height, overflow:hidden row with
     every child flex-shrink:0 — on a narrow viewport the Mode selector has
     nowhere to go and gets clipped at the right edge. Let the row wrap and
     drop the actions (Mode selector + buttons) onto their own full-width
     line instead of hiding them. */
  @media (max-width: 767px) {
    .analyzer-header {
      height: auto;
      min-height: 52px;
      flex-wrap: wrap;
      overflow: visible;
      padding: 10px 16px;
      row-gap: 8px;
    }
    .analyzer-actions {
      flex-basis: 100%;
      margin-left: 0;
      justify-content: flex-start;
      flex-wrap: wrap;
    }
  }

  /* ── SUMMARY BANNER (collapsible) ───────────────────────────────── */
  .summary-banner {
    background: linear-gradient(135deg, rgba(59,130,246,0.07), rgba(99,102,241,0.05));
    border-bottom: 1px solid rgba(59,130,246,0.15);
    border-left: 3px solid var(--accent-primary);
    padding: 9px 20px 9px 16px;
    font-size: 12.5px;
    line-height: 1.55;
    flex-shrink: 0;
    color: var(--text-dark-muted);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    overflow: hidden;
    transition: all 0.3s ease;
  }
  .summary-toggle-btn {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid rgba(59,130,246,0.2);
    color: var(--accent-primary);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 10px;
    cursor: pointer;
    margin-top: 1px;
    white-space: nowrap;
  }

  /* ── SPLIT PANE ──────────────────────────────────────────────────── */
  .workspace-pane {
    flex: 1;
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 0;
    overflow: hidden;
    height: 100%;
  }

  @media (max-width: 1024px) {
    .workspace-pane {
      grid-template-columns: 1fr;
      grid-template-rows: 1fr 1fr;
      overflow-y: auto;
    }
  }

  /* ── EDITOR COLUMN ───────────────────────────────────────────────── */
  .editor-column {
    background: var(--bg-dark-panel);
    border-right: 1px solid var(--border-dark-subtle);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-header-bar {
    background: var(--bg-dark-sidebar);
    padding: 10px 16px;
    border-bottom: 1px solid var(--border-dark-subtle);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }

  .editor-tabs { display: flex; gap: 4px; }

  .editor-tab-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted);
    padding: 6px 14px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 5px;
    transition: all 0.18s;
    border-bottom: 2px solid transparent;
  }
  .editor-tab-btn:hover { color: white; background: rgba(255,255,255,0.04); }
  .editor-tab-btn.active { color: var(--accent-primary); background: rgba(59,130,246,0.08); font-weight: 600; border-bottom-color: var(--accent-primary); border-radius: 5px 5px 0 0; }

  /* ── RICH TEXT TOOLBAR ───────────────────────────────────────────── */
  /* Two different homes for the same toolbar:
     - Auto-Draft's editor renders it inline, as the first child inside its
       own .editor-scroll-area (the scrolling element) — without
       position:sticky it would just scroll away with the document like any
       other in-flow content. The negative margins cancel
       .editor-scroll-area's own 24px/28px padding so the stuck toolbar
       spans edge-to-edge; matching positive padding keeps its content
       aligned exactly where it always was.
     - The scanner editor's toolbar is portaled OUT of its scroll area
       entirely, into the always-visible .scan-meta-bar header row (see
       toolbarSlotEl/toolbarPortalTarget) — the override block right below
       neutralizes the sticky/negative-margin rules for that case, since a
       toolbar that's never inside a scrolling container has nothing to
       stick to and no padding to cancel. */
  .rich-text-toolbar {
    position: sticky;
    top: 0;
    z-index: 6;
    background: var(--bg-dark-sidebar);
    border-bottom: 1px solid var(--border-dark-subtle);
    box-shadow: 0 6px 14px -4px rgba(0,0,0,0.28);
    display: flex;
    gap: 2px;
    padding: 8px 28px;
    align-items: center;
    flex-wrap: wrap;
    margin: -24px -28px 20px;
  }
  [data-theme="light"] .rich-text-toolbar {
    box-shadow: 0 6px 14px -4px rgba(0,0,0,0.1);
  }
  .scan-meta-bar .rich-text-toolbar {
    position: static;
    margin: 0;
    padding: 6px 12px;
    box-shadow: none;
    border-bottom: none;
  }

  .toolbar-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted);
    padding: 4px 7px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 26px;
    transition: all 0.15s;
  }
  .toolbar-btn:hover { background: rgba(255,255,255,0.06); color: var(--text-dark-primary); }
  .toolbar-btn svg { pointer-events: none; }

  .toolbar-divider { width: 1px; height: 16px; background: var(--border-dark-subtle); margin: 0 4px; }

  /* Font family / size dropdowns — a purpose-built class rather than
     Tailwind-named utilities (bg-gray-800, text-sm, etc.): this project has
     no Tailwind build step, so those class names would compile to nothing
     and the dropdowns would render as unstyled native <select> elements. */
  .toolbar-select {
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-primary);
    font-size: 11.5px;
    border-radius: 5px;
    padding: 3px 6px;
    height: 26px;
    max-width: 128px;
    cursor: pointer;
    font-family: inherit;
  }
  .toolbar-select-size { max-width: 68px; }
  .toolbar-select:hover { background: rgba(255,255,255,0.08); }
  .toolbar-select:focus { outline: none; border-color: var(--accent-primary); }

  /* ── SCAN META-BAR — scanner mode: toolbar portal target. Auto-Draft
     mode: its own plain "Auto-Draft Workspace" label row. ───────────── */
  .scan-meta-bar {
    background: var(--bg-dark-sidebar);
    border-bottom: 1px solid var(--border-dark-subtle);
    display: flex;
    align-items: center;
    gap: 0;
    padding: 0;
    flex-shrink: 0;
    overflow: hidden;
    /* Matches the toolbar's own height (26px buttons + 8px top/bottom
       padding) so this row doesn't visibly grow the instant the toolbar
       portals in on mount — it reserves the space up front instead. */
    min-height: 43px;
  }
  .scan-meta-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 16px;
    border-right: 1px solid var(--border-dark-subtle);
    min-width: 0;
  }
  .scan-meta-item:last-child { border-right: none; }
  .scan-meta-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-dark-muted);
  }
  .scan-meta-value {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-dark-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── RISK INSPECTOR TWO-COLUMN GRID ──────────────────────────────── */
  .risk-inspector-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(195px, 1fr));
    gap: 12px;
    align-items: start;
  }
  .audit-col, .playbook-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .revision-glass-card {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: border-color 0.2s;
  }
  .revision-glass-card:focus-within { border-color: rgba(79,110,247,0.3); }

  /* ── PROVISION MATRIX (Auto-Draft macro pills) ───────────────────── */
  .provision-matrix-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .provision-pill {
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 11px;
    color: var(--text-dark-secondary);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
    line-height: 1.35;
    font-weight: 500;
  }
  .provision-pill:hover {
    background: rgba(79,110,247,0.09);
    border-color: rgba(79,110,247,0.28);
    color: var(--text-dark-primary);
  }
  .provision-pill-act {
    font-size: 9.5px;
    color: var(--text-dark-muted);
    margin-top: 3px;
    display: block;
    font-weight: 400;
  }

  /* ── RAG MACRO QUICK-FIRE BUTTONS ────────────────────────────────── */
  .rag-macros-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-dark-subtle);
    margin-bottom: 2px;
  }
  .rag-macro-btn {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 14px;
    padding: 4px 11px;
    font-size: 11px;
    color: var(--text-dark-secondary);
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    line-height: 1.6;
  }
  .rag-macro-btn:hover:not(:disabled) {
    background: rgba(79,110,247,0.1);
    border-color: rgba(79,110,247,0.3);
    color: var(--text-dark-primary);
  }
  .rag-macro-btn:disabled { opacity: 0.35; cursor: default; }

  /* ── EDITOR SCROLL ───────────────────────────────────────────────── */
  .editor-scroll-area {
    position: relative;
    flex: 1;
    overflow-y: auto;
    padding: 24px 28px;
    background: var(--bg-dark-app);
    color: var(--text-dark-primary);
  }
  [data-theme="light"] .editor-scroll-area {
    background: #F0F2F8;
    color: #1F2937;
  }

  .scanner-body {
    outline: none;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 15px !important;
    line-height: 1.85 !important;
    word-break: break-word;
    color: var(--text-dark-primary);
    min-height: 65vh !important;
    padding: 44px 52px !important;
    background: var(--bg-dark-card);
    border-radius: 3px;
    box-shadow: 0 4px 32px rgba(0,0,0,0.22), 0 1px 4px rgba(0,0,0,0.12);
    box-sizing: border-box;
    border: 1px solid var(--border-dark-subtle);
    letter-spacing: 0.01em;
    max-width: 800px;
    margin: 0 auto;
  }
  /* Paragraph blocks inside the document scanner */
  .scanner-body .doc-para {
    margin: 0 0 1.1em;
    text-align: justify;
    color: inherit;
  }
  /* Defeat global p/span { color } rule for scanner content */
  .scanner-body p,
  .scanner-body span,
  .scanner-body div { color: var(--text-dark-primary); }
  /* Light theme: white document look */
  [data-theme="light"] .scanner-body {
    background: #ffffff;
    color: #1a1a1a;
    border-color: #e8e4de;
    box-shadow: 0 4px 32px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.06);
  }
  [data-theme="light"] .scanner-body p,
  [data-theme="light"] .scanner-body span,
  [data-theme="light"] .scanner-body div { color: #1a1a1a; }
  [data-theme="light"] .scanner-body .doc-para { color: #1a1a1a; }

  /* ── ANALYSIS COLUMN ─────────────────────────────────────────────── */
  .analysis-column {
    background: var(--bg-dark-panel);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .analysis-tabs-bar {
    background: var(--bg-dark-sidebar);
    border-bottom: 1px solid var(--border-dark-subtle);
    display: flex;
    overflow-x: auto;
    flex-shrink: 0;
  }

  .analysis-tab-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted);
    padding: 13px 14px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }
  .analysis-tab-btn:hover { color: white; }
  .analysis-tab-btn.active { color: #A78BFA; border-bottom-color: #8B5CF6; font-weight: 600; }

  .analysis-panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  /* ── UPLOAD / LANDING SCREEN ────────────────────────────────────── */
  .upload-layout-container {
    max-width: 1120px;
    margin: 28px auto;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .upload-hero {
    background: linear-gradient(135deg, var(--bg-dark-panel) 0%, #0F172A 100%);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 16px 16px 0 0;
    padding: 28px 32px 22px;
    text-align: center;
  }

  .upload-icon-ring {
    width: 56px; height: 56px; border-radius: 50%;
    background: rgba(59,130,246,0.1); border: 2px solid rgba(59,130,246,0.25);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 14px;
    font-size: 24px;
  }

  /* ── Split grid ────────────────────────────────────────────── */
  .upload-split-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border: 1px solid var(--border-dark-subtle);
    border-top: none;
  }

  .upload-col-card {
    background: var(--bg-dark-panel);
    padding: 24px 28px;
  }
  .upload-col-card:first-child {
    border-right: 1px solid var(--border-dark-subtle);
  }

  .upload-col-label {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--text-dark-muted);
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .upload-col-label--rulebook { color: rgba(167,139,250,0.7); }

  .upload-analyze-bar {
    background: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-top: none;
    border-radius: 0 0 16px 16px;
    padding: 18px 28px 24px;
  }

  /* ── Drop zones ────────────────────────────────────────────── */
  .drag-drop-zone {
    border: 2px dashed rgba(59,130,246,0.3);
    background: rgba(59,130,246,0.02);
    border-radius: 12px;
    padding: 28px 20px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    margin-bottom: 0;
  }
  .drag-drop-zone:hover, .drag-drop-zone.dragover {
    border-color: var(--accent-primary);
    background: rgba(59,130,246,0.05);
  }
  .drag-drop-zone--rulebook {
    border-color: rgba(139,92,246,0.3);
    background: rgba(139,92,246,0.02);
  }
  .drag-drop-zone--rulebook:hover, .drag-drop-zone--rulebook.dragover {
    border-color: rgba(139,92,246,0.65);
    background: rgba(139,92,246,0.05);
  }
  .drag-drop-zone--loading {
    pointer-events: none;
    opacity: 0.7;
  }

  /* Legacy single-col body kept for scanning-state overlay */
  .upload-body {
    background: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-top: none;
    border-radius: 0 0 16px 16px;
    padding: 24px 32px 32px;
  }

  @media (max-width: 720px) {
    .upload-split-grid { grid-template-columns: 1fr; }
    .upload-col-card:first-child { border-right: none; border-bottom: 1px solid var(--border-dark-subtle); }
  }

  .input-textarea {
    width: 100%;
    height: 140px;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-primary);
    border-radius: 10px;
    padding: 14px;
    font-family: var(--font-sans);
    font-size: 13.5px;
    resize: none;
    outline: none;
    transition: border-color 0.2s;
    box-sizing: border-box;
  }
  .input-textarea:focus { border-color: var(--accent-primary); }

  /* ── Scan-lock overlay (visually disables the doc/textarea while
     isAnalyzing is true — used both on the upload-screen textarea and the
     results-view TipTap editor during a re-scan). Tailwind isn't configured
     in this project — utility-class strings like "absolute inset-0
     bg-blue-900/10 animate-pulse" compile to nothing and render
     invisible/unpositioned. Real classes here. */
  .ca-textarea-wrap { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .ca-scan-overlay {
    position: absolute; inset: 0;
    background: rgba(30, 64, 175, 0.1);
    pointer-events: none;
    animation: ca-scan-pulse 1.6s ease-in-out infinite;
  }
  .ca-textarea-wrap .ca-scan-overlay { border-radius: 10px; }
  @keyframes ca-scan-pulse {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }

  /* ── Staggered fade-in for mapped risk/citation cards ───────────────── */
  .animate-fade-in {
    opacity: 0;
    animation: ca-fade-in 0.35s ease forwards;
  }
  @keyframes ca-fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── RISK MARK HIGHLIGHTS (document left pane) ───────────────────── */
  .risk-mark {
    display: inline;
    cursor: pointer;
    padding: 2px 5px 2px 7px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    border-radius: 2px;
    transition: background-color 0.2s ease-in-out;
  }
  .risk-mark.red-mark {
    background-color: rgba(239,68,68,0.16);
    border-left: 3px solid rgba(239,68,68,0.75);
    color: #FCA5A5 !important;
  }
  .risk-mark.amber-mark {
    background-color: rgba(245,158,11,0.16);
    border-left: 3px solid rgba(245,158,11,0.75);
    color: #FCD34D !important;
  }
  .risk-mark.red-mark:hover   { background-color: rgba(239,68,68,0.26); }
  .risk-mark.amber-mark:hover { background-color: rgba(245,158,11,0.26); }
  /* Light theme: dark readable text on tinted background */
  [data-theme="light"] .risk-mark.red-mark   { background-color: rgba(239,68,68,0.11); border-left-color: #EF4444; color: #991B1B !important; }
  [data-theme="light"] .risk-mark.amber-mark { background-color: rgba(245,158,11,0.11); border-left-color: #D97706; color: #78350F !important; }
  [data-theme="light"] .risk-mark.red-mark:hover   { background-color: rgba(239,68,68,0.2); }
  [data-theme="light"] .risk-mark.amber-mark:hover { background-color: rgba(245,158,11,0.2); }

  /* ── TIPTAP EDITOR INTEGRATION ───────────────────────────────────── */
  /* .scanner-body is now the OUTER wrapper EditorContent renders — the
     actual contenteditable lives one level deeper as .ProseMirror, so the
     browser's default focus ring has to be suppressed there specifically. */
  .scanner-body .ProseMirror { outline: none; }
  .scanner-body .ProseMirror p {
    margin: 0 0 1.1em;
    text-align: justify;
    color: inherit;
  }
  .scanner-body .ProseMirror p:last-child { margin-bottom: 0; }

  /* Track Changes marks — real inline document content, not decorations */
  .ai-insertion {
    text-decoration: underline;
    text-decoration-color: #10B981;
    text-decoration-thickness: 2px;
    color: #6EE7B7 !important;
    background: rgba(16,185,129,0.08);
    border-radius: 2px;
    padding: 0 1px;
  }
  .ai-deletion {
    text-decoration: line-through;
    text-decoration-color: #EF4444;
    color: rgba(252,165,165,0.75) !important;
    background: rgba(239,68,68,0.06);
    border-radius: 2px;
    padding: 0 1px;
  }
  [data-theme="light"] .ai-insertion { color: #166534 !important; background: rgba(16,185,129,0.1); }
  [data-theme="light"] .ai-deletion  { color: #991B1B !important; background: rgba(239,68,68,0.08); }

  /* Comment highlight spans — rendered by CommentHighlight (extends
     TipTap's own Highlight mark); background color comes from the mark's
     own inline style (setHighlight({color})), this just adds the
     click affordance and a stable marker for the currently-open comment. */
  mark[data-comment-id] { cursor: pointer; border-radius: 2px; padding: 0 1px; }
  mark[data-comment-id].ca-highlight-active { outline: 2px solid #F59E0B; outline-offset: 1px; }

  /* High-contrast text on TipTap highlight marks — in dark mode the
     editor's own light/near-white text color (inherited from
     --text-dark-primary) is nearly invisible against a yellow highlight
     background. Scoped to .ProseMirror specifically so this can never
     bleed into some unrelated <mark>/[data-comment-id] element elsewhere
     in the app that isn't inside this editor. */
  .ProseMirror mark,
  .ProseMirror [data-comment-id] {
    color: #0f172a !important; /* Slate-900 */
    font-weight: 600 !important;
    text-shadow: none !important;
  }

  /* ── BubbleMenu: Comment / Draft Revision ─────────────────────────── */
  .ca-bubble-menu {
    display: flex; gap: 4px; padding: 4px;
    background: #171c26; border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px; box-shadow: 0 10px 28px rgba(0,0,0,0.45);
  }
  .ca-bubble-menu-btn {
    background: transparent; border: none; color: #E2E8F0;
    font-size: 12px; font-weight: 600; padding: 6px 10px; border-radius: 6px;
    cursor: pointer; white-space: nowrap; font-family: inherit; transition: background 0.15s;
  }
  .ca-bubble-menu-btn:hover { background: rgba(59,130,246,0.18); }

  /* ── AI Auto-Resolution: Original vs. Revised diff block ────────────── */
  .ca-diff-block { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .ca-diff-row {
    padding: 8px 10px; border-radius: 7px; font-size: 12px; line-height: 1.5;
    border: 1px solid transparent;
  }
  .ca-diff-original { background: rgba(239,68,68,0.08); border-color: rgba(239,68,68,0.25); color: #FCA5A5; text-decoration: line-through; text-decoration-color: rgba(252,165,165,0.5); }
  .ca-diff-revised { background: rgba(16,185,129,0.08); border-color: rgba(16,185,129,0.25); color: #6EE7B7; }
  .ca-diff-label { display: block; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; opacity: 0.85; }

  /* ── RISK CLAUSE LIST (overview when no clause selected) ────────── */
  .clause-list-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-dark-subtle);
    cursor: pointer;
    transition: all 0.3s ease;
    background: rgba(255,255,255,0.01);
  }
  .clause-list-item:hover { background: rgba(255,255,255,0.04); border-color: rgba(139,92,246,0.25); box-shadow: 0 2px 12px rgba(0,0,0,0.15); }
  .clause-list-item.red-item   { border-left: 4px solid var(--accent-danger); }
  .clause-list-item.amber-item { border-left: 4px solid var(--accent-warning); }
  .clause-number { font-size: 10px; font-weight: 700; color: var(--text-dark-muted); min-width: 18px; margin-top: 2px; }
  .clause-text-preview { font-size: 12.5px; color: var(--text-dark-secondary); line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .clause-risk-badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px; white-space: nowrap; margin-left: auto; flex-shrink: 0; }
  .clause-risk-badge.red   { background: rgba(239,68,68,0.15);  color: #FCA5A5; }
  .clause-risk-badge.amber { background: rgba(245,158,11,0.15); color: #FCD34D; }

  /* ── INSPECTED RISK CARD ─────────────────────────────────────────── */
  .inspected-risk-card {
    background: var(--bg-dark-card);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 10px;
    padding: 14px;
    transition: all 0.3s ease;
  }

  .original-clause-box {
    background: var(--bg-dark-app);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 6px;
    padding: 10px 12px;
    font-family: Georgia, serif;
    font-size: 13px;
    line-height: 1.5;
    margin-top: 8px;
    max-height: 120px;
    overflow-y: auto;
    color: var(--text-dark-secondary);
    transition: all 0.3s ease;
  }

  /* ── AUTOCOMPLETE ────────────────────────────────────────────────── */
  .autocomplete-dropdown {
    position: absolute;
    background: var(--bg-dark-card);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 8px;
    box-shadow: 0 12px 24px rgba(0,0,0,0.5);
    z-index: 100;
    max-height: 200px;
    overflow-y: auto;
    width: 100%;
    margin-top: 4px;
  }
  .autocomplete-item {
    padding: 10px 14px;
    cursor: pointer;
    font-size: 12.5px;
    border-bottom: 1px solid var(--border-dark-subtle);
    transition: all 0.15s ease;
    color: var(--text-dark-muted);
  }
  .autocomplete-item:hover { background: rgba(59,130,246,0.1); color: white; }

  /* ── CHAT ────────────────────────────────────────────────────────── */
  .chat-bubble-stream {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 12px;
    overflow-y: auto;
  }
  .chat-message-bubble {
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.5;
    max-width: 88%;
  }
  .chat-message-bubble.user {
    background: var(--accent-primary);
    color: white;
    align-self: flex-end;
    border-top-right-radius: 3px;
  }
  .chat-message-bubble.bot {
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-secondary);
    align-self: flex-start;
    border-top-left-radius: 3px;
    transition: all 0.3s ease;
  }

  /* ── PRECEDENTS ──────────────────────────────────────────────────── */
  .precedent-card {
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
    border-radius: 10px;
    padding: 14px 16px;
    transition: all 0.2s ease-in-out;
    transform: translateY(0);
  }
  .precedent-card:hover {
    background: rgba(255,255,255,0.05);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    border-color: rgba(255,255,255,0.12);
  }
  .precedent-link { color: var(--link-blue); text-decoration: none; font-weight: 600; font-size: 13.5px; display: inline-flex; align-items: center; gap: 5px; transition: color 0.2s ease; }

  /* ── Dual-Brain citation card: split-action footer ─────────────────── */
  .citation-action-footer { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .citation-btn-vault {
    background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.4); color: #93C5FD;
    font-size: 11px; font-weight: 600; padding: 5px 12px; border-radius: 6px; cursor: pointer;
    display: inline-flex; align-items: center; gap: 5px; transition: all 0.15s; font-family: inherit;
  }
  .citation-btn-vault:hover { background: rgba(59,130,246,0.25); border-color: rgba(59,130,246,0.6); }
  .citation-btn-kanoon {
    background: rgba(255,255,255,0.04); border: 1px solid var(--border-dark-subtle); color: #CBD5E1;
    font-size: 11px; font-weight: 600; padding: 5px 12px; border-radius: 6px; cursor: pointer;
    text-decoration: none; display: inline-flex; align-items: center; gap: 5px; transition: all 0.15s; font-family: inherit;
  }
  .citation-btn-kanoon:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); }
  .citation-not-in-vault-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 10px;
    font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    background: rgba(239,68,68,0.12); color: #F87171;
    border: 1px solid rgba(239,68,68,0.35); flex-shrink: 0; white-space: nowrap;
  }
  .precedent-link:hover { color: var(--link-blue-hover); text-decoration: underline; }

  /* ── RECOMMENDATIONS ─────────────────────────────────────────────── */
  .rec-protection-card {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 10px;
    padding: 14px;
    backdrop-filter: blur(8px);
    transition: all 0.3s ease;
  }

  /* Custom checkbox */
  .custom-checkbox {
    appearance: none;
    -webkit-appearance: none;
    width: 17px;
    height: 17px;
    min-width: 17px;
    border: 1.5px solid rgba(255,255,255,0.18);
    border-radius: 5px;
    background: rgba(255,255,255,0.04);
    cursor: pointer;
    position: relative;
    transition: all 0.18s;
  }
  .custom-checkbox:checked {
    background: #8B5CF6;
    border-color: #8B5CF6;
  }
  .custom-checkbox:checked::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 1px;
    width: 5px;
    height: 9px;
    border: 2px solid #fff;
    border-top: none;
    border-left: none;
    transform: rotate(45deg);
  }

  /* Custom select wrapper */
  .custom-select-wrapper {
    position: relative;
    width: 100%;
  }
  .custom-select-wrapper select {
    appearance: none !important;
    -webkit-appearance: none !important;
    padding-right: 36px !important;
    cursor: pointer;
  }
  .custom-select-chevron {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--text-dark-muted);
    display: flex;
    align-items: center;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── SCAN PROGRESS BAR — futuristic scan-in-progress visual ─────────
     Three layered effects standing in for "this is genuinely active work,
     not a frozen number": a dual-tone spinner, a moving shimmer gradient
     inside the filled portion (energy flowing through it), a pulsing
     glow "head" at the fill's leading edge, and a faint light sweep
     crossing the empty track — the same visual grammar sci-fi scanning
     UIs use, kept subtle enough not to read as gimmicky in a legal tool. */
  .scan-progress-spinner {
    width: 56px;
    height: 56px;
    margin: 0 auto 24px;
    border-radius: 50%;
    border: 3px solid rgba(59,130,246,0.15);
    border-top-color: var(--accent-primary);
    border-right-color: rgba(96,165,250,0.6);
    animation: spin 0.9s cubic-bezier(0.5, 0.1, 0.5, 0.9) infinite;
  }
  .scan-progress-track {
    position: relative;
    height: 8px;
    background-color: rgba(31, 41, 55, 0.5);
    border-radius: 8px;
    border: 1px solid #374151;
    overflow: hidden;
  }
  .scan-progress-track::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, transparent 40%, rgba(96,165,250,0.22) 50%, transparent 60%);
    background-size: 250% 100%;
    animation: scan-track-sweep 2.4s linear infinite;
    pointer-events: none;
  }
  .scan-progress-fill {
    position: relative;
    height: 100%;
    border-radius: 8px;
    background: linear-gradient(90deg, #2563EB, #3B82F6, #60A5FA, #3B82F6, #2563EB);
    background-size: 200% 100%;
    animation: scan-bar-shimmer 1.8s linear infinite;
    box-shadow: 0 0 15px rgba(59,130,246,0.6), 0 0 4px rgba(96,165,250,0.8);
    transition: width 0.25s ease-out;
  }
  .scan-progress-fill::after {
    content: '';
    position: absolute;
    right: -1px;
    top: 50%;
    transform: translateY(-50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #93C5FD;
    box-shadow: 0 0 10px 3px rgba(147,197,253,0.9);
    animation: scan-bar-pulse 1s ease-in-out infinite;
  }
  @keyframes scan-track-sweep {
    0% { background-position: 130% 0; }
    100% { background-position: -30% 0; }
  }
  @keyframes scan-bar-shimmer {
    0% { background-position: 0% 0; }
    100% { background-position: 200% 0; }
  }
  @keyframes scan-bar-pulse {
    0%, 100% { opacity: 0.6; transform: translateY(-50%) scale(0.85); }
    50% { opacity: 1; transform: translateY(-50%) scale(1.15); }
  }

  /* ── SHIMMER LOADER ──────────────────────────────────────────────── */
  .shimmer-bar {
    background: linear-gradient(90deg, var(--bg-dark-card) 25%, var(--bg-dark-panel) 50%, var(--bg-dark-card) 75%);
    background-size: 200% 100%;
    animation: shimmer-animation 1.4s infinite;
    border-radius: 6px;
    height: 13px;
    margin-bottom: 10px;
  }
  @keyframes shimmer-animation {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* ── AUTO-DRAFT LOADING STATE ────────────────────────────────────── */
  @keyframes ca-pulse-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(79,110,247,0); border-color: rgba(79,110,247,0.16); }
    50% { box-shadow: 0 0 26px 3px rgba(79,110,247,0.16); border-color: rgba(79,110,247,0.4); }
  }
  .auto-draft-loading-card {
    padding: 28px 26px;
    border: 1px solid rgba(79,110,247,0.16);
    border-radius: 10px;
    background: rgba(79,110,247,0.02);
    animation: ca-pulse-glow 2.6s ease-in-out infinite;
  }
  @keyframes ca-status-fade-in {
    from { opacity: 0; transform: translateY(3px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .ca-status-fade { animation: ca-status-fade-in 0.35s ease both; }
  @keyframes ca-shimmer-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .shimmer-bar-in { animation: ca-shimmer-in 0.35s ease both, shimmer-animation 1.4s infinite; }

  /* ── MODALS ──────────────────────────────────────────────────────── */
  .modal-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.8);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; padding: 20px;
    backdrop-filter: blur(8px);
  }
  .export-modal-card {
    background: rgba(var(--modal-bg-rgb), 0.88);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    width: 100%; max-width: 540px;
    box-shadow: var(--shadow-xl);
    overflow: hidden;
    transition: all 0.3s ease;
  }

  /* Format tiles */
  .format-tile {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 16px 14px;
    display: flex; flex-direction: column; gap: 10px;
    cursor: pointer; transition: all 0.2s ease;
    background: rgba(255,255,255,0.02);
    position: relative;
  }
  .format-tile:hover {
    border-color: rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.04);
    transform: translateY(-1px);
  }
  .format-tile.selected {
    border-color: var(--accent-primary);
    background: rgba(59,130,246,0.08);
    box-shadow: 0 0 0 1px rgba(59,130,246,0.25), 0 4px 16px rgba(59,130,246,0.1);
  }
  .format-tile-icon-wrap {
    width: 38px; height: 38px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
    transition: all 0.2s ease;
  }
  .format-tile.selected .format-tile-icon-wrap {
    background: rgba(59,130,246,0.12);
    border-color: rgba(59,130,246,0.3);
  }
  .format-tile-check {
    position: absolute; top: 10px; right: 10px;
    width: 18px; height: 18px; border-radius: 50%;
    border: 1.5px solid rgba(255,255,255,0.2);
    display: flex; align-items: center; justify-content: center;
    transition: all 0.18s ease;
  }
  .format-tile.selected .format-tile-check {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  /* Module pills for cross-save */
  .module-pill {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 8px 14px; border-radius: 100px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.03);
    cursor: pointer; font-size: 12px; font-weight: 500;
    color: var(--text-dark-muted);
    transition: all 0.2s ease;
    white-space: nowrap; user-select: none;
  }
  .module-pill:hover {
    border-color: rgba(167,139,250,0.35);
    background: rgba(124,58,237,0.06);
    color: var(--text-dark-primary);
  }
  .module-pill.active {
    border-color: rgba(139,92,246,0.6);
    background: rgba(139,92,246,0.14);
    color: #C4B5FD;
    box-shadow: 0 0 0 1px rgba(139,92,246,0.2);
  }
  .module-pill-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: rgba(255,255,255,0.2);
    transition: all 0.2s ease;
  }
  .module-pill.active .module-pill-dot { background: #A78BFA; box-shadow: 0 0 4px #A78BFA; }

  /* ── FORM INPUTS (analysis column) ──────────────────────────────── */
  .analysis-column select,
  .analysis-column input[type="text"],
  .analysis-column textarea,
  .input-textarea {
    background: rgba(255,255,255,0.04) !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-radius: 8px !important;
    padding: 10px 12px !important;
    color: #E5E7EB !important;
    font-family: var(--font-sans);
    font-size: 13.5px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.2s !important;
  }
  .analysis-column select:focus,
  .analysis-column input[type="text"]:focus,
  .analysis-column textarea:focus,
  .input-textarea:focus {
    border-color: var(--accent-primary) !important;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.12) !important;
  }

  /* ── STRATEGY SELECTOR ───────────────────────────────────────────── */
  .strategy-select-container {
    display: flex; align-items: center; gap: 8px;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--border-dark-subtle);
    padding: 7px 14px; border-radius: 8px;
  }
  .strategy-dropdown {
    background: transparent; border: none; color: var(--text-dark-primary, white);
    font-weight: 600; font-size: 13px; outline: none; cursor: pointer;
  }
  .strategy-dropdown option { background: #1F2937; color: white; }

  /* ── REVISION DIFF ───────────────────────────────────────────────── */
  .revised-del {
    position: relative;
    display: inline !important;
    text-decoration: none !important;
    color: rgba(252, 165, 165, 0.85) !important;
    background: transparent !important;
    padding: 0 2px !important;
  }
  .revised-del::after {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    height: 2px;
    width: 100%;
    background: #EF4444;
    transform-origin: left;
    animation: strikeThrough 0.5s ease-out forwards;
  }
  .revised-ins {
    display: block !important;
    margin: 8px 0 !important;
    padding: 10px 14px 10px 24px !important;
    border-left: 2px solid rgba(16, 185, 129, 0.4) !important;
    background: rgba(16, 185, 129, 0.06) !important;
    border-radius: 0 6px 6px 0 !important;
    color: #6EE7B7 !important;
    font-style: normal !important;
    font-weight: 500 !important;
    font-size: inherit !important;
    text-decoration: none !important;
  }
  .newly-revised-ins {
    display: block !important;
    margin: 8px 0 !important;
    padding: 10px 14px 10px 24px !important;
    border-left: 2px solid rgba(16, 185, 129, 0.4) !important;
    background: rgba(16, 185, 129, 0.06) !important;
    border-radius: 0 6px 6px 0 !important;
    color: #6EE7B7 !important;
    font-style: normal !important;
    font-weight: 500 !important;
    font-size: inherit !important;
    text-decoration: none !important;
    animation: slideDownFade 0.35s ease-out forwards;
  }
  /* Light theme overrides for revised diff */
  [data-theme="light"] .revised-del { color: #B91C1C !important; }
  [data-theme="light"] .revised-del::after { background: #DC2626; }
  [data-theme="light"] .revised-ins,
  [data-theme="light"] .newly-revised-ins {
    background: rgba(16, 185, 129, 0.08) !important;
    color: #166534 !important;
    border-left-color: rgba(16, 185, 129, 0.5) !important;
  }

  /* ── STRUCK-THROUGH TOGGLE CLASS (JS-controlled) ─────────────────── */
  .clause-struck-through {
    position: relative;
    color: rgba(252, 165, 165, 0.75) !important;
  }
  .clause-struck-through::after {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    height: 2px;
    width: 100%;
    background: #EF4444;
    transform-origin: left;
    transform: scaleX(0);
    transition: transform 0.5s ease-out;
  }
  .clause-struck-through.active::after { transform: scaleX(1); }

  @keyframes strikeThrough {
    from { transform: scaleX(0); }
    to   { transform: scaleX(1); }
  }
  @keyframes slideDownFade {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeHighlightIns {
    0%   { background: rgba(253,224,71,0.2) !important; opacity: 0; }
    10%  { opacity: 1; }
    100% { background: rgba(16,185,129,0.06) !important; }
  }
  @keyframes fadeHighlightBlockquote {
    0%   { background: rgba(253,224,71,0.2) !important; opacity: 0; }
    10%  { opacity: 1; }
    100% { background: rgba(255,255,255,0.03) !important; }
  }

  /* ── EXTENSIONS ──────────────────────────────────────────────────── */
  .extension-divider { border: 0; height: 1px; background: #E5E7EB; margin: 20px 0; }
  .extension-blockquote {
    border-left: 4px solid #3B82F6 !important; background: #F3F4F6 !important;
    padding: 14px 18px !important; margin: 0 0 16px 0 !important;
    border-radius: 0 8px 8px 0; color: #1F2937 !important;
    font-family: Georgia, serif; font-size: 14px; line-height: 1.6;
  }
  .newly-appended-blockquote {
    border-left: 4px solid #3B82F6 !important; padding: 14px 18px !important;
    margin: 0 0 16px 0 !important; border-radius: 0 8px 8px 0;
    color: #1F2937 !important; font-family: Georgia, serif;
    font-size: 14px; line-height: 1.6;
    animation: fadeHighlightBlockquote 1.5s ease-in-out forwards;
  }
  .extension-title { display: block; margin-bottom: 6px; color: #1E3A8A; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  .extension-body { white-space: pre-wrap; outline: none; }

  /* ── SHARED HELPERS ──────────────────────────────────────────────── */
  .input-label {
    display: block; margin-bottom: 6px; color: var(--text-dark-muted);
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
  }

  .p-4 { padding: 1rem !important; }
  @media (min-width: 768px) { .md\\:p-8 { padding: 2rem !important; } }
  .transition-all { transition-property: all !important; }
  .duration-300  { transition-duration: 300ms !important; }
  .ease-in-out   { transition-timing-function: cubic-bezier(0.4,0,0.2,1) !important; }
  .transition-opacity { transition-property: opacity !important; }
  .opacity-0  { opacity: 0 !important; }
  .opacity-100 { opacity: 1 !important; }
  .hover\\:-translate-y-0\\.5:hover { transform: translateY(-2px) !important; }
  .hover\\:shadow-lg:hover { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3),0 4px 6px -2px rgba(0,0,0,0.15) !important; }
  .leading-relaxed { line-height: 1.625 !important; }
  .text-lg { font-size: 1.125rem !important; }

  /* Form-input utilities — used across every text input/select/textarea in
     this file (Auto-Draft, RAG Chat, revision boxes) but never previously
     defined, so every one of those controls has been rendering with zero
     background/border/radius/focus styling this whole time, relying on
     unstyled browser defaults against this app's dark theme. */
  .bg-gray-800 { background-color: #1F2937 !important; }
  .border-gray-600 { border: 1px solid #4B5563 !important; }
  .text-white { color: #F9FAFB !important; }
  .rounded-lg { border-radius: 10px !important; }
  .p-3 { padding: 0.75rem !important; }
  .focus\\:outline-none:focus { outline: none !important; }
  .focus\\:ring-2:focus, .focus\\:ring-gray-400:focus {
    border-color: #60A5FA !important;
    box-shadow: 0 0 0 3px rgba(96,165,250,0.25) !important;
  }

  /* ── RISK STAT BAR (legacy, kept for clause-list fallback) ───────── */
  .risk-stat-bar { display: flex; gap: 10px; margin-bottom: 14px; font-size: 12px; }
  .risk-stat-item {
    display: flex; align-items: center; gap: 6px;
    background: rgba(255,255,255,0.03);
    padding: 4px 10px; border-radius: 20px;
    border: 1px solid var(--border-dark-subtle);
  }
  .risk-indicator-dot { width: 7px; height: 7px; border-radius: 50%; }
  .risk-indicator-dot.red   { background: var(--accent-danger);   box-shadow: 0 0 5px var(--accent-danger); }
  .risk-indicator-dot.amber { background: var(--accent-warning);  box-shadow: 0 0 5px var(--accent-warning); }
  .risk-indicator-dot.green { background: var(--accent-success);  box-shadow: 0 0 5px var(--accent-success); }

  /* ── RULE BOOK VIOLATION BADGE ────────────────────────────── */
  .rulebook-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 7px; border-radius: 10px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    background: rgba(139,92,246,0.15); color: #A78BFA;
    border: 1px solid rgba(139,92,246,0.35); flex-shrink: 0; white-space: nowrap;
  }
`;

export default function ContractAnalyzer({ setFocusMode }) {
  // Guards every async continuation's setState calls below against firing
  // after unmount (e.g. the user navigates away mid file-upload/mid AI-scan).
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Fast-track path — bypasses the AI risk scan entirely and opens the
  // split-pane editor directly on a blank/empty document. Reachable from
  // the upload screen's "Quick Draft Studio" button and from the Cmd/Ctrl+K
  // command palette (navigate('/contract-analyzer', { state: { openTab:
  // 'quickdraft' } })).
  const [quickDraftMode, setQuickDraftMode] = useState(false);
  const [scanStrategy, setScanStrategy] = useState('Defensive');
  const [rawText, setRawText] = useState('');
  const rawTextDebounceRef = useRef(null);
  const [clauses, setClauses] = useState([]);
  const [summary, setSummary] = useState('');
  const [citations, setCitations] = useState([]);
  const [loadingText, setLoadingText] = useState("Extracting clauses...");
  const [scanProgress, setScanProgress] = useState(0);
  // Keyed by array index, NOT citation.id — the backend's citation objects
  // (see rag_server/main.py's analyze-contract RAG pass) only ever carry
  // {title, snippet, in_vault, vault_id, kanoon_query}, no id field. Keying
  // on a nonexistent citation.id would make every citation collide on the
  // same `undefined` key, so opening one card's related-citations accordion
  // would toggle EVERY card's accordion identically. The index is already
  // used as the list's own React key below and is stable for one scan's
  // static citations array, so it doubles safely as the per-card identity.
  const [relatedCitations, setRelatedCitations] = useState({});
  const [loadingRelated, setLoadingRelated] = useState(null);

  // Real Celery job progress over SSE — replaces the old asymptotic-decay
  // simulation (which faked a curve toward 95% with no idea how much work
  // was actually left) with the task's genuine self.update_state() status
  // text and progress percentage, e.g. "Scanning Liability... (3/7
  // sections)". jobId is null whenever no scan is in flight, which the
  // hook treats as IDLE — no stream opened, nothing to clean up.
  const [jobId, setJobId] = useState(null);
  const jobStream = useContractJobStream(jobId);

  useEffect(() => {
    if (!isAnalyzing) return;
    if (jobStream.status) setLoadingText(jobStream.status);
    if (typeof jobStream.progress === 'number') setScanProgress(jobStream.progress);
  }, [isAnalyzing, jobStream.status, jobStream.progress]);

  useEffect(() => {
    if (!jobId) return;
    if (jobStream.state === 'SUCCESS') {
      setJobId(null);
      if (!isMountedRef.current) return;
      setIsAnalyzing(false);
      loadAnalysisResults(jobStream.result || {});
    } else if (jobStream.state === 'FAILURE') {
      setJobId(null);
      if (!isMountedRef.current) return;
      setIsAnalyzing(false);
      alert(jobStream.error || 'Analysis failed.');
    }
    // loadAnalysisResults is a stable function declared in this same
    // component body, not a changing dependency the job-completion effect
    // needs to re-run for — including it would refire this on every
    // unrelated re-render that happens to redefine it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobStream.state, jobStream.result, jobStream.error]);

  // Snaps the bar to a real 100% the instant the real scan finishes — the
  // SSE-driven progress above only ever reports what the Celery task
  // itself last posted, which may trail slightly behind the job actually
  // reaching SUCCESS.
  useEffect(() => {
    if (!isAnalyzing) setScanProgress(100);
  }, [isAnalyzing]);

  // Tab states
  const [activeTab, setActiveTab] = useState('risks');
  const [leftTab, setLeftTab] = useState('scanner');

  // Tab opacity fade-in transition state
  const [tabOpacity, setTabOpacity] = useState('opacity-100');

  // Document editor states
  const [activeClauseId, setActiveClauseId] = useState(null);
  // Bumped only when a genuinely NEW document is loaded (upload, piped-in
  // doc, session restore, voice command) — NOT on every rawText tick from
  // the editor's own live-typing echo, and NOT on a scanStrategy switch.
  // ContractTiptapEditor only reloads its content when this changes, so a
  // mode switch (which re-runs analysis and calls setRawText again) never
  // tears down the live editor/cursor/undo history.
  const [documentVersion, setDocumentVersion] = useState(0);
  const editorApiRef = useRef(null);
  // Portal target for the scanner editor's toolbar (see ContractTiptapEditor's
  // toolbarPortalTarget prop below) — a callback ref via useState, not a
  // plain useRef, because the slot <div> doesn't exist in the DOM on the
  // first render; this state update fires once React actually mounts it,
  // triggering the one extra re-render needed for the portal to have a
  // real target to render into.
  const [toolbarSlotEl, setToolbarSlotEl] = useState(null);
  const inspectedCardRef = useRef(null);
  const analysisPanelBodyRef = useRef(null);
  const [comments, setComments] = useState([]);
  const [activeCommentDraft, setActiveCommentDraft] = useState(null);

  // Interactive Rewrite states
  const [intent, setIntent] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [rewrittenText, setRewrittenText] = useState('');
  const [rewriting, setRewriting] = useState(false);

  // Recommendations states
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(false);

  // Appended clause extensions
  const [appendedClauses, setAppendedClauses] = useState([]);

  // Auto-Drafting states
  const [vaultDocs, setVaultDocs] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState('none');
  const [sharedFiles, setSharedFiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lex_shared_workspace') || '[]'); } catch { return []; }
  });
  const [autoDraftPrompt, setAutoDraftPrompt] = useState('');
  const [autoDraftText, setAutoDraftText] = useState('');
  // Mirrors documentVersion's role for the scanner's own editor, scoped to
  // Auto-Draft specifically: ContractTiptapEditor only re-reads its content
  // prop when documentKey changes, so without bumping this on every fresh
  // synthesis, a second "Synthesize Clause" click would generate new text
  // that the already-mounted editor instance would just silently ignore,
  // still showing the first draft.
  const [autoDraftVersion, setAutoDraftVersion] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const [draftError, setDraftError] = useState('');

  // Chat RAG states
  const [chatHistory, setChatHistory] = useState([
    { sender: 'bot', text: 'Hello. I have loaded this contract. You can ask grounded queries about notice periods, indemnities, or governing law, and I will search the text strictly.' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  const [summaryCollapsed, setSummaryCollapsed] = useState(true);

  // Export Modal states
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState('pdf');
  const [includeDoc, setIncludeDoc] = useState(true);
  const [includeDraft, setIncludeDraft] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [crossSaveTargets, setCrossSaveTargets] = useState([]);
  const [crossSaveStatus, setCrossSaveStatus] = useState('');

  // Rule Book states
  const [ruleBookText, setRuleBookText] = useState('');
  const [ruleBookFile, setRuleBookFile] = useState(null);
  const [ruleBookUploadLoading, setRuleBookUploadLoading] = useState(false);

  // Contract upload (decoupled from analysis — see handleFileUpload)
  const [contractFile, setContractFile] = useState(null);
  const [contractUploadLoading, setContractUploadLoading] = useState(false);
  const [uploadToast, setUploadToast] = useState(null); // { message } | null

  useEffect(() => {
    if (!uploadToast) return;
    const t = setTimeout(() => setUploadToast(null), 6000);
    return () => clearTimeout(t);
  }, [uploadToast]);

  // Guards sessionStorage persistence until after initial rehydration
  const hydratedRef = useRef(false);

  const fileInputRef = useRef(null);
  const ruleBookFileInputRef = useRef(null);
  const suggestionsRef = useRef(null);
  const chatStreamRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();

  // Auto-ingest document piped from Case Vault (or InzIQ tool-routing).
  // pipedDocDispatchedRef guards against React 18 StrictMode's dev-only
  // double-invoke of effects on mount — without it, two identical Celery
  // jobs would fire for the same piped document (wasted LLM calls, and
  // jobId would end up pointing at whichever response lands second).
  const pipedDocDispatchedRef = useRef(false);
  useEffect(() => {
    const incoming = location.state?.documentData;
    if (!incoming?.file_content) return;
    if (pipedDocDispatchedRef.current) return;
    pipedDocDispatchedRef.current = true;

    const content = cleanExtractedText(incoming.file_content);
    setRawText(content);
    (async () => {
      setClauses([]);
      setSummary('');
      setCitations([]);
      setScanProgress(0);
      setLoadingText('Queuing scan...');
      setIsAnalyzing(true);

      const res = await startContractAnalysisJob(content, '', scanStrategy);
      if (!isMountedRef.current) return;

      if (res.error || !res.job_id) {
        setIsAnalyzing(false);
        alert('Failed to start analysis: ' + (res.message || 'Unknown error'));
        return;
      }
      setJobId(res.job_id);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Legal Forms Library hand-off: navigate('/contract-analyzer', { state:
  // { importedDocument: populatedHtml } }). Unlike the Case Vault path
  // above, this only initializes the editor with the populated form text —
  // it deliberately does NOT auto-trigger a risk scan, since a freshly
  // drafted form isn't something the user necessarily wants AI-audited the
  // instant they land here.
  useEffect(() => {
    const importedHtml = location.state?.importedDocument;
    if (!importedHtml) return;
    const container = document.createElement('div');
    container.innerHTML = importedHtml;
    // Convert block-level breaks to newlines BEFORE reading textContent —
    // otherwise "<p>A</p><p>B</p>" collapses to "AB" with no separator.
    container.querySelectorAll('p, div, li, br').forEach((el) => {
      el.insertAdjacentText('afterend', '\n');
    });
    const plainText = cleanExtractedText(container.textContent.replace(/\n{3,}/g, '\n\n').trim());
    setRawText(plainText);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Quick Draft Studio fast-track: land straight in the split-pane editor
  // with no scan, no upload screen. ContractTiptapEditor already handles
  // clauses=[] / empty initialRawText gracefully (same as the Auto-Draft
  // tab below), so no null-state guard is needed here beyond passing those
  // safe empty defaults.
  useEffect(() => {
    if (location.state?.openTab === 'quickdraft') setQuickDraftMode(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SESSION PERSISTENCE ─────────────────────────────────────────────
  // Rehydrate an in-progress session on mount so navigating away and back
  // does not wipe the analysis. Skips when a document is being piped in
  // (Case Vault/InzIQ, the Legal Forms Library, or a Quick Draft Studio
  // launch) — otherwise the restored stale session would immediately
  // overwrite the freshly-imported/blank state.
  useEffect(() => {
    if (
      !(location.state?.documentData?.file_content) &&
      !location.state?.importedDocument &&
      location.state?.openTab !== 'quickdraft'
    ) {
      try {
        const saved = sessionStorage.getItem('lexapp_contract_session');
        if (saved) {
          const s = JSON.parse(saved);
          if (typeof s.rawText === 'string') setRawText(s.rawText);
          if (typeof s.ruleBookText === 'string') setRuleBookText(s.ruleBookText);
          if (Array.isArray(s.clauses) && s.clauses.length > 0) {
            setClauses(s.clauses);
            setSummary(s.summary || '');
            setIsAnalyzed(true);
          }
        }
      } catch (_) { /* corrupt session — ignore */ }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist key state to sessionStorage on every change (post-hydration).
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      sessionStorage.setItem('lexapp_contract_session', JSON.stringify({
        rawText, ruleBookText, clauses, summary, isAnalyzed,
      }));
    } catch (_) { /* quota / serialization — ignore */ }
  }, [rawText, ruleBookText, clauses, summary, isAnalyzed]);

  // Flips AFTER the rehydration effect above on the very first commit, and
  // only takes effect (for the persistence effect's guard) on the NEXT
  // commit — the one where rawText/clauses have actually caught up to the
  // just-hydrated values. Setting this flag inside the rehydration effect
  // itself was a real bug: that effect's setRawText/setClauses calls don't
  // update those variables until a later render, but the flag flipped
  // synchronously in the SAME commit — so the persistence effect above,
  // also running on that first commit, saw hydratedRef already true but
  // rawText/clauses still at their pre-hydration (empty) values, and
  // immediately overwrote sessionStorage with blanks. Declaring this as
  // its own later effect exploits React's guarantee that same-commit
  // effects run in declaration order.
  useEffect(() => {
    hydratedRef.current = true;
  }, []);

  // Auto-Collapse Sidebar on Mount (Focus Mode)
  useEffect(() => {
    if (setFocusMode) {
      setFocusMode(true);
    }
    return () => {
      if (setFocusMode) {
        setFocusMode(false);
      }
    };
  }, [setFocusMode]);

  // Load vault documents on mount for auto-draft context
  useEffect(() => {
    const loadVaultDocs = async () => {
      const res = await fetchDocuments();
      if (!isMountedRef.current) return;
      if (!res.error) {
        setVaultDocs(res);
      }
    };
    loadVaultDocs();
  }, []);

  // Sync shared workspace files in real-time
  useEffect(() => {
    const handler = (e) => {
      setSharedFiles(prev => {
        const filtered = prev.filter(f => f.id !== e.detail.id);
        return [e.detail, ...filtered].slice(0, 50);
      });
    };
    window.addEventListener('lex:sharedWorkspaceUpdate', handler);
    return () => window.removeEventListener('lex:sharedWorkspaceUpdate', handler);
  }, []);

  // Scroll the inspected risk card into view whenever a new one is opened
  // (from a sidebar list click OR a document decoration click) — the panel
  // may still be scrolled from a previous, longer clause's detail view.
  useEffect(() => {
    if (activeClauseId && inspectedCardRef.current) {
      inspectedCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (analysisPanelBodyRef.current && typeof analysisPanelBodyRef.current.scrollTo === 'function') {
      // The workspace (and this ref) now mounts unconditionally instead of
      // behind the old rawText-gated screen switch, so this effect's first
      // run happens on initial mount too, not just on a real
      // activeClauseId transition — scrollTo(0) is a harmless no-op there
      // in a real browser (already at the top), but jsdom's test
      // environment doesn't implement Element.scrollTo at all, so the
      // typeof guard is load-bearing for tests, not just decorative.
      analysisPanelBodyRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeClauseId]);

  // Autocomplete Suggestions based on inspected clause
  const activeClause = clauses.find(c => c.id === activeClauseId);
  const dynamicIntents = activeClause ? getDynamicIntents(activeClause.text, activeClause.risk) : [];

  // Tab switch helper with fade animations
  const switchTab = (tabId) => {
    setTabOpacity('opacity-0');
    setTimeout(() => {
      setActiveTab(tabId);
      setTabOpacity('opacity-100');
    }, 150);
  };

  // BubbleMenu → sidebar: opens a draft box for whatever span the editor's
  // "Comment"/"Draft Revision" action just highlighted. from/to were
  // captured by ContractTiptapEditor at click time (before any focus loss),
  // so they're passed straight through here rather than re-derived.
  const handleCommentRequest = ({ commentId, text, from, to, mode }) => {
    setActiveCommentDraft({ commentId, text, from, to, draft: '', mode, revision: null });
    switchTab('comments');
    if (mode === 'draft-revision') {
      requestDraftRevision(commentId, text, from, to, '');
    }
  };

  // Bidirectional scroll, editor → card: clicking inside a highlighted span
  // scrolls the matching sidebar comment card into view.
  const handleHighlightClick = (commentId) => {
    document.querySelector(`[data-comment-card-id="${commentId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Bidirectional scroll, card → editor: clicking a sidebar card scrolls to
  // (and briefly outlines) the matching highlighted span in the document.
  const handleCommentCardClick = (commentId) => {
    const el = document.querySelector(`.scanner-body [data-comment-id="${commentId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ca-highlight-active');
    setTimeout(() => el.classList.remove('ca-highlight-active'), 1500);
  };

  // Grabs the text immediately around a selection from the live editor doc —
  // the payload the /api/draft-revision endpoint requires, since revising a
  // clause with zero surrounding context routinely makes the LLM invent
  // facts or break a defined term established elsewhere in the document.
  const getSurroundingContext = (from, to) => {
    const editor = editorApiRef.current;
    if (!editor) return '';
    const docSize = editor.state.doc.content.size;
    const start = Math.max(0, from - 400);
    const end = Math.min(docSize, to + 400);
    return editor.state.doc.textBetween(start, end, ' ');
  };

  const requestDraftRevision = async (commentId, text, from, to, userComment) => {
    setActiveCommentDraft(prev => (prev?.commentId === commentId ? { ...prev, revision: { status: 'loading' } } : prev));
    const context = getSurroundingContext(from, to);
    const res = await draftRevision(text, context, userComment);
    if (!isMountedRef.current) return;
    setActiveCommentDraft(prev => {
      if (!prev || prev.commentId !== commentId) return prev; // user moved on/closed the draft
      if (res.error) return { ...prev, revision: { status: 'error', message: res.message } };
      return { ...prev, revision: { status: 'done', revisedText: res.revised_text } };
    });
  };

  const handleAcceptRevision = () => {
    const editor = editorApiRef.current;
    if (!editor || !activeCommentDraft?.revision?.revisedText) return;
    const { from, to, commentId } = activeCommentDraft;

    // CHAIN ORDER matters: unsetHighlight() must run BEFORE insertContent()
    // in the same chain. Unsetting the mark first and then inserting into
    // the still-current selection keeps from/to consistent throughout —
    // doing these as two separate commands (or inserting first) risks the
    // second step operating on stale range coordinates after the first
    // step has already changed the document.
    editor.chain()
      .setTextSelection({ from, to })
      .unsetHighlight()
      .insertContent(activeCommentDraft.revision.revisedText)
      .run();

    setActiveCommentDraft(null);
    // Defensive: if this comment had already been saved to the sidebar list
    // (re-opening a saved comment to draft a revision), drop it so the card
    // unmounts instead of sitting there stale, pointing at text that no
    // longer exists.
    setComments(prev => prev.filter(c => c.id !== commentId));
  };

  const handleRejectRevision = () => {
    setActiveCommentDraft(prev => (prev ? { ...prev, revision: null } : prev));
  };

  // Preprocessing: extraction fuses section labels ("word.2.") to surrounding
  // words, which shifts character indices and breaks highlight alignment.
  // Re-insert the missing space so index tracking matches the rendered text.
  const cleanExtractedText = (text) => (text || '').replace(/(\w+)\.(\d+)\./g, '$1. $2.');

  // ── 1. FILE UPLOAD & ANALYZE HANDLERS ────────────────────────────────
  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx'].includes(extension)) {
      alert('Invalid format. Please upload PDF or DOCX.');
      return;
    }
    if (file.size > 104857600) {
      alert('File exceeds 100MB. Please compress the PDF or split it into smaller parts.');
      return;
    }

    // Extract text ONLY. Analysis is no longer triggered on upload — the user
    // must explicitly click "Start Contract Risk Scan" to fire the API.
    //
    // try/catch/finally is load-bearing here, not decorative: extractContractText
    // itself never throws (its own try/catch inside services/api.js always
    // resolves to {error, message}), but a backend that hangs past its own
    // 10s extraction timeout — or any other network failure — must still
    // guarantee contractUploadLoading gets reset. Without the finally, an
    // unexpected throw here would leave the extraction indicator spinning
    // forever with no way for the user to recover except a reload.
    setContractFile(file);
    setContractUploadLoading(true);
    try {
      // Backend contract (routes/contract_routes.py's extract_text): 200 ->
      // {"text": "..."} ; 4xx/5xx -> {"error": true, "message": "...", "code": "..."}.
      // services/api.js's extractContractText() already normalizes both
      // into the same {error, message} | {text} shape, so `extracted.text`
      // is the correct key here — this was never actually mismatched.
      const extracted = await extractContractText(file);
      if (!isMountedRef.current) return;

      // Force re-upload on any failure (timeout, OCR-required blank scan,
      // corrupt file, backend 4xx/5xx, or a 200 with an empty/whitespace-only
      // payload) — a stale contractFile referencing text that was never
      // actually populated is worse than making the user re-select, since
      // "Start Contract Risk Scan" would otherwise run against empty/missing
      // rawText. Routing every invalid case through one throw keeps the
      // recovery logic (toast + clear file + reset input) in a single place.
      if (extracted.error) {
        throw new Error(extracted.message || 'Failed to extract document text.');
      }
      const extractedText = extracted.text;
      if (typeof extractedText !== 'string' || !extractedText.trim()) {
        throw new Error('Invalid or empty text payload');
      }

      // This was the actual cause of the earlier "stuck on extraction"
      // report: the loading indicator only renders inside the !isAnalyzed
      // branch (see the INITIAL UPLOAD / INPUT SCREEN condition below). A
      // 200 OK here was landing correctly, but if isAnalyzed/jobId/clauses
      // were still set from a PRIOR document, the UI stayed on the old
      // analysis workspace with no visible change — indistinguishable
      // from a hang even though extraction had already succeeded. A fresh
      // upload must clear all of that stale state, not just set rawText.
      setJobId(null);
      setIsAnalyzed(false);
      setClauses([]);
      setSummary('');
      setCitations([]);
      setRawText(cleanExtractedText(extractedText));
    } catch (err) {
      if (!isMountedRef.current) return;
      const message = err?.message === 'Invalid or empty text payload'
        ? 'No readable text found in document.'
        : (err?.message || 'Failed to extract document text.');
      setUploadToast({ message });
      setContractFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      if (isMountedRef.current) setContractUploadLoading(false);
    }
  };

  const RULE_BOOK_SEPARATOR = '\n\n--- [Next Document] ---\n\n';

  const handleRuleBookFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);

    // Validate every file up front before any network call.
    for (const f of fileArr) {
      const extension = f.name.split('.').pop().toLowerCase();
      if (!['pdf', 'docx'].includes(extension)) {
        alert(`Invalid format: ${f.name}. Please upload PDF or DOCX.`);
        return;
      }
      if (f.size > 104857600) {
        alert(`${f.name} exceeds 100MB. Please compress it or split it into smaller parts.`);
        return;
      }
    }

    setRuleBookUploadLoading(true);
    // Extract text from ALL files concurrently.
    const results = await Promise.all(fileArr.map(f => extractContractText(f)));
    if (!isMountedRef.current) return;
    setRuleBookUploadLoading(false);

    const extractedTexts = results
      .filter(r => !r.error && r.text)
      .map(r => r.text.trim())
      .filter(Boolean);
    const failedCount = results.length - extractedTexts.length;

    if (extractedTexts.length === 0) {
      alert('Failed to extract text from the selected Rule Book file(s).');
      return;
    }

    const combined = extractedTexts.join(RULE_BOOK_SEPARATOR);
    // Append to any existing rule book text (typed or from a previous upload).
    setRuleBookText(prev =>
      prev.trim() ? prev + RULE_BOOK_SEPARATOR + combined : combined
    );

    const label = fileArr.length === 1
      ? fileArr[0].name
      : `${extractedTexts.length} documents loaded`;
    setRuleBookFile({ name: label });

    if (failedCount > 0) {
      alert(`${failedCount} file(s) could not be extracted and were skipped.`);
    }
  };

  // "Deep Scan" — dispatches the Celery job and returns almost instantly
  // with a job_id; useContractJobStream (wired above) then tracks it live
  // over SSE and calls loadAnalysisResults once the job reaches SUCCESS.
  // This function itself no longer waits ~5 minutes for the scan to finish.
  const handleTextAnalyze = async (overrideText = null) => {
    const target = (typeof overrideText === 'string' ? overrideText : rawText).trim();
    if (!target) {
      alert('Please paste contract text or select a file to analyze.');
      return;
    }

    setScanProgress(0);
    setLoadingText('Queuing scan...');
    setIsAnalyzing(true);
    const res = await startContractAnalysisJob(target, ruleBookText, scanStrategy);
    if (!isMountedRef.current) return;

    if (res.error || !res.job_id) {
      setIsAnalyzing(false);
      alert(res.message || 'Failed to start analysis job.');
      return;
    }
    setJobId(res.job_id);
  };

  // Contextual voice hook: when InzIQ resolves an "analyze this contract" command
  // while the user is already on /contract-analyzer, run the local analysis
  // instead of re-navigating (which would remount and wipe the loaded document).
  useEffect(() => {
    const onPageCommand = (e) => {
      if (e.detail?.destination !== '/contract-analyzer') return;
      const incoming = e.detail?.data?.file_content;
      if (incoming && incoming.trim()) {
        const cleaned = cleanExtractedText(incoming);
        setRawText(cleaned);
        handleTextAnalyze(cleaned);
      } else {
        handleTextAnalyze();
      }
    };
    window.addEventListener('inziq-page-command', onPageCommand);
    return () => window.removeEventListener('inziq-page-command', onPageCommand);
  }, [rawText, ruleBookText, scanStrategy]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAnalysisResults = (data) => {
    // Only a fresh (not-yet-analyzed) load should force the TipTap editor
    // to remount with new content. A mode-switch re-analysis (isAnalyzed
    // already true) reaches this same function but must NOT bump the
    // version — the live editor/cursor/undo history has to survive it.
    if (!isAnalyzed) setDocumentVersion((v) => v + 1);

    const rawClauses = data.flagged_clauses || data.clauses || [];
    const mapped = rawClauses.map((c, idx) => ({
      id: c.id != null ? String(c.id) : `auto-${idx}`,
      text: c.text || c.original_text || '',
      risk: c.risk || (
        c.risk_level === 'Red'    ? 'RED'   :
        c.risk_level === 'Amber'  ? 'AMBER' :
        c.risk_level === 'Green'  ? 'GREEN' :
        c.risk_level === 'High'   ? 'RED'   :
        c.risk_level === 'Medium' ? 'AMBER' : 'GREEN'
      ),
      issue: c.issue || c.explanation || 'Risk identified.',
      suggestedRewrite: c.suggested_rewrite || '',
      isRuleBookViolation: c.is_rule_book_violation || false,
      ruleBookReference: c.rule_book_reference || '',
      clauseTitle: c.clause_title || '',
    }));

    setClauses(mapped);
    if (data.raw_text) setRawText(data.raw_text);
    setSummary(data.summary || 'Summary generated successfully.');
    setCitations(data.citations || []);
    setIsAnalyzed(true);
    setActiveClauseId(null);
    setRewrittenText('');
    setIntent('');
    setAppendedClauses([]);
  };

  // Re-run analysis on strategy switch — dispatches the SAME Celery job
  // pipeline as the Deep Scan button. Does NOT call useContractJobStream
  // here (that would violate the Rules of Hooks); it only sets jobId, and
  // the single top-level useContractJobStream(jobId) call above picks up
  // the new job automatically, exactly like the Deep Scan path does.
  const handleStrategyChange = async (newStrategy) => {
    setScanStrategy(newStrategy);
    if (isAnalyzed && rawText) {
      // Clear stale results immediately — otherwise the risk panel keeps
      // showing the PREVIOUS strategy's flagged clauses while the new scan
      // is still in flight, which reads as "already re-scanned" when it
      // hasn't even started (UI ghosting).
      setClauses([]);
      setSummary('');
      setCitations([]);
      setScanProgress(0);
      setLoadingText('Queuing re-scan...');
      setIsAnalyzing(true);

      const res = await startContractAnalysisJob(rawText, ruleBookText, newStrategy);
      if (!isMountedRef.current) return;

      if (res.error || !res.job_id) {
        setIsAnalyzing(false);
        alert('Failed to start re-analysis: ' + (res.message || 'Unknown error'));
        return;
      }
      setJobId(res.job_id);
    }
  };

  // ── 2. EDIT / INSPECT HANDLERS ──────────────────────────────────────
  const inspectRisk = (id) => {
    setActiveClauseId(id);
    switchTab('risks');
    setIntent('');
    const clause = clauses.find(c => c.id === id);
    setRewrittenText(clause?.suggestedRewrite || '');

    // Point the cursor at the clause's exact text in the live editor —
    // clicking a risk card in the sidebar shouldn't leave a lawyer hunting
    // for the matching text by hand-scrolling the whole document. Reuses
    // findClauseRange, the same live-position lookup applyRevision already
    // relies on, so this stays correct even after edits have shifted the
    // clause's position from wherever it was at scan time.
    const editor = editorApiRef.current;
    if (editor && clause?.text) {
      const range = findClauseRange(editor.state.doc, clause.text);
      if (range) {
        editor.chain().focus().setTextSelection({ from: range.from, to: range.to }).scrollIntoView().run();
      }
    }
  };

  // ── 3. REWRITE HANDLER ──────────────────────────────────────────────
  const handleRewrite = async () => {
    if (!activeClause) return;
    if (!intent.trim()) {
      alert('Please enter rewrite instructions.');
      return;
    }

    setRewriting(true);
    const res = await rewriteContractClause(activeClause.text, activeClause.issue, intent.trim());
    if (!isMountedRef.current) return;
    setRewriting(false);

    if (!res.error && res.rewritten) {
      const cleanText = res.rewritten.replace(/^"|"$/g, '').trim();
      setRewrittenText(cleanText);
    } else {
      alert(res.message || 'Failed to rewrite clause.');
    }
  };

  // Applies the AI-suggested rewrite as a live Track Changes suggestion in
  // the document — the original text gets an ai-deletion mark, the new
  // text an ai-insertion mark right after it, both sharing the clause's id
  // as the suggestionId. Nothing is finalized yet; the user still has to
  // accept or reject it (see below) before it affects rawText/export.
  const applyRevision = () => {
    if (!activeClause || !rewrittenText.trim()) return;
    const editor = editorApiRef.current;
    if (!editor) return;

    const range = findClauseRange(editor.state.doc, activeClause.text);
    if (!range) {
      alert('Could not locate this clause in the live document — it may already have been edited. Re-select it from the list and try again.');
      return;
    }

    const ok = editor.commands.insertSuggestion(range.from, range.to, rewrittenText.trim(), activeClause.id);
    if (!ok) return;

    setClauses(prev => prev.map(c => (c.id === activeClause.id ? { ...c, isPendingSuggestion: true } : c)));
  };

  // Accept: the ai-deletion-marked original text is removed, the
  // ai-insertion-marked new text becomes permanent, unmarked content.
  const acceptActiveSuggestion = () => {
    if (!activeClause) return;
    const editor = editorApiRef.current;
    if (!editor || !editor.commands.acceptSuggestion(activeClause.id)) return;

    const finalText = rewrittenText.trim();
    setClauses(prev => prev.map(c => (c.id === activeClause.id ? {
      ...c,
      isRevised: true,
      isNewlyRevised: true,
      isPendingSuggestion: false,
      revisedText: finalText,
      text: finalText,
      risk: 'GREEN',
      issue: 'Approved AI Revision.',
    } : c)));

    // Clear the visual fade animation class after 1.5s so it runs exactly once
    setTimeout(() => {
      setClauses(prev => prev.map(c => (c.id === activeClause.id ? { ...c, isNewlyRevised: false } : c)));
    }, 1500);

    setActiveClauseId(null);
    setRewrittenText('');
    setIntent('');
  };

  // Reject: the ai-insertion-marked new text is discarded, the
  // ai-deletion-marked original text is restored to plain, unmarked
  // content — the clause stays open so the user can try another rewrite.
  const rejectActiveSuggestion = () => {
    if (!activeClause) return;
    const editor = editorApiRef.current;
    if (!editor || !editor.commands.rejectSuggestion(activeClause.id)) return;

    setClauses(prev => prev.map(c => (c.id === activeClause.id ? { ...c, isPendingSuggestion: false } : c)));
    setRewrittenText('');
  };

  // Registers the precedent's metadata in the citation Zustand store (read
  // by CitationBadge via its own citationId-scoped selector, never through
  // editor state) and inserts an atom inlineCitation node at the current
  // cursor position.
  const insertCitationIntoDocument = (prec) => {
    const editor = editorApiRef.current;
    if (!editor) {
      alert('Open the document editor before inserting a citation.');
      return;
    }
    // This line only ever runs inside an onClick handler (never during
    // render); the linter can't statically prove that for a plain
    // component-scoped function.
    // eslint-disable-next-line react-hooks/purity
    const citationId = `cite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { displayTitle, kanoonQuery } = resolveCitationDisplay(prec);
    useCitationStore.getState().registerCitation(citationId, {
      caseName: displayTitle,
      summary: prec.snippet,
      shortLabel: displayTitle.length > 28 ? `${displayTitle.slice(0, 28)}…` : displayTitle,
      url: prec.in_vault ? null : `/api/kanoon-redirect?query=${encodeURIComponent(kanoonQuery)}`,
    });
    editor.chain().focus().insertContent({ type: 'inlineCitation', attrs: { citationId } }).run();
  };

  // citationKey is the citation's array index (see relatedCitations'
  // declaration for why — no real citation.id exists to key on).
  const handleSearchRelated = async (citation, citationKey) => {
    // Toggle: collapse an already-open accordion instead of re-fetching.
    if (relatedCitations[citationKey]) {
      setRelatedCitations(prev => {
        const next = { ...prev };
        delete next[citationKey];
        return next;
      });
      return;
    }

    const query = (citation.title || citation.kanoon_query || '').trim();
    if (!query) return;

    setLoadingRelated(citationKey);
    try {
      const res = await fetch(`${API_BASE}/api/firm-library/external-search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!isMountedRef.current) return;
      // Backend's failure shape is {"status":"error",...} with HTTP 200 (a
      // Pinecone outage is an expected failure mode, not a server bug) — a
      // bare !res.ok check would miss it and store an empty [] as if the
      // search genuinely found nothing.
      if (!res.ok || data.status === 'error') throw new Error(data.message || 'Related search failed');
      setRelatedCitations(prev => ({ ...prev, [citationKey]: (data.results || []).slice(0, 3) }));
    } catch (err) {
      console.error('[Related Citations] search failed:', err);
    } finally {
      if (!isMountedRef.current) return;
      setLoadingRelated(null);
    }
  };

  // ── 4. EXTENSIONS (RECOMMENDATIONS) HANDLERS ─────────────────────────
  const fetchMissingProtections = async () => {
    setLoadingRecs(true);
    let compiledText = rawText;
    clauses.forEach(c => {
      if (c.isRevised && c.revisedText) {
        compiledText = compiledText.replace(c.text, c.revisedText);
      }
    });
    const res = await fetchContractRecommendations(compiledText);
    if (!isMountedRef.current) return;
    setLoadingRecs(false);

    if (!res.error && res.recommendations) {
      let parsed = [];
      if (typeof res.recommendations === 'string') {
        try {
          const text = res.recommendations.replace(/```json/g, '').replace(/```/g, '');
          const idxStart = text.indexOf('[');
          const idxEnd = text.lastIndexOf(']');
          parsed = JSON.parse(text.substring(idxStart, idxEnd + 1));
        } catch (e) {
          parsed = [];
        }
      } else {
        parsed = res.recommendations;
      }

      const normalized = parsed.map((item, idx) => ({
        title: item.title || `Missing Clause ${idx + 1}`,
        clause: item.clause || '',
        selected: true
      }));
      setRecommendations(normalized);
    } else {
      alert('Failed to analyze missing protections.');
    }
  };

  const handleRecommendationCheck = (idx) => {
    setRecommendations(prev => prev.map((item, i) => {
      if (i === idx) return { ...item, selected: !item.selected };
      return item;
    }));
  };

  const handleRecommendationChange = (idx, newText) => {
    setRecommendations(prev => prev.map((item, i) => {
      if (i === idx) return { ...item, clause: newText };
      return item;
    }));
  };

  const addSelectedRecommendations = () => {
    const selected = recommendations.filter(r => r.selected && r.clause.trim());
    if (selected.length === 0) {
      alert('Please check at least one missing clause.');
      return;
    }

    const newAppended = selected.map(r => ({
      title: r.title,
      clause: r.clause,
      isNewlyAppended: true
    }));

    setAppendedClauses(prev => [...prev, ...newAppended]);
    setRecommendations(prev => prev.filter(r => !r.selected));
    alert(`${selected.length} missing clauses appended successfully.`);

    // Clear animation class for appended clauses after 1.5s so it runs exactly once
    setTimeout(() => {
      setAppendedClauses(prev => prev.map(item => {
        if (newAppended.some(na => na.title === item.title)) {
          return { ...item, isNewlyAppended: false };
        }
        return item;
      }));
    }, 1500);
  };

  // ── 5. AUTO-DRAFT (SYNTHESIS) HANDLERS ───────────────────────────────
  const handleAutoDraft = async (e) => {
    e.preventDefault();
    if (!autoDraftPrompt.trim()) {
      setDraftError('Please provide drafting instructions before synthesizing.');
      return;
    }
    // Bridge the panes immediately — user watches the draft resolve on the left
    setLeftTab('autodraft');
    setDrafting(true);
    setDraftError('');
    setDraftStatus('Synthesizing dynamic context node...');
    setAutoDraftText('');

    try {
      const contextValue = selectedDocId === 'none' ? null : selectedDocId;
      const response = await fetch(`${API_BASE}/api/documents/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: autoDraftPrompt.trim(), context: contextValue })
      });
      const data = await response.json();

      if (!isMountedRef.current) return;
      setDrafting(false);
      setDraftStatus('');

      if (response.ok && data.draft) {
        const clean = data.draft.replace(/^"|"$/g, '').trim();
        setAutoDraftText(clean);
        setAutoDraftVersion((v) => v + 1);
      } else {
        // Backend's error shape is {"error": true, "message": "..."} —
        // "error" is a boolean, not the message text. data.error was
        // truthy-but-useless here, producing a blank error banner.
        setDraftError(data.message || 'Failed to synthesize auto-draft clause.');
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setDrafting(false);
      setDraftStatus('');
      setDraftError('Network timeout in the AI reasoning engine. Please retry.');
    }
  };

  // Cycles draftStatus through a few plausible-sounding phases while the
  // request is in flight — real progress isn't observable mid-generation,
  // but a static "Synthesizing…" reads as stalled after a couple seconds,
  // and this signals the request is actively moving through real work.
  useEffect(() => {
    if (!drafting) return;
    const phases = [
      'Interpreting drafting instructions…',
      'Cross-referencing Indian statutes…',
      'Synthesizing clause language…',
      'Refining for enforceability…',
    ];
    let i = 0;
    setDraftStatus(phases[0]);
    const id = setInterval(() => {
      i = (i + 1) % phases.length;
      setDraftStatus(phases[i]);
    }, 1700);
    return () => clearInterval(id);
  }, [drafting]);

  // Studio controls (Playbook precedents, reference context, drafting
  // instructions, generation progress) — a plain function returning JSX
  // rather than its own component: it closes over this component's own
  // state/handlers directly (autoDraftPrompt, handleAutoDraft, etc.), so
  // splitting it out as a separate component would just mean threading
  // every one of those through as props for no isolation benefit. Lives in
  // the right analysis-column's own "Auto-Draft" tab (not squeezed inside
  // the editor column) — that column is the full width dedicated to
  // secondary panels, so the Studio isn't fighting the editor for space.
  const renderAutoDraftStudio = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── PROVISION MATRIX ── */}
      <div>
        <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--text-dark-muted)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '7px' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Playbook Precedent Inserts
        </div>
        <div className="provision-matrix-grid">
          {[
            {
              label: 'Dispute Escalation',
              act: 'Arbitration & Conciliation Act, 1996',
              prompt: 'Draft a dispute resolution clause using a three-tier escalation mechanism: (1) senior management negotiation within 15 days, (2) mediation under the Indian Mediation Centre rules within 30 days, and (3) binding arbitration under the Arbitration and Conciliation Act, 1996 before a sole arbitrator seated in New Delhi. All proceedings shall be in English. The arbitral award shall be final and binding.'
            },
            {
              label: 'IP Assignment',
              act: 'Copyright Act, 1957 · Patents Act, 1970',
              prompt: 'Draft a comprehensive intellectual property assignment clause. All work product, inventions, developments, software, and derivative works created by the Vendor under this Agreement shall be "works made for hire" as defined under the Copyright Act, 1957, vesting exclusively in the Client. To the extent any rights do not vest automatically, the Vendor hereby assigns all rights in perpetuity worldwide to the Client. Vendor retains no residual license.'
            },
            {
              label: 'Severability Provision',
              act: 'Indian Contract Act, 1872 — s.24',
              prompt: 'Draft a severability clause: If any provision of this Agreement is held invalid, illegal, or unenforceable by a court of competent jurisdiction under the Indian Contract Act, 1872, such provision shall be modified to the minimum extent necessary to make it enforceable, or severed if modification is not possible, without affecting the validity and enforceability of the remaining provisions which shall continue in full force.'
            },
            {
              label: 'Mutual Notice Terms',
              act: 'General Clauses Act, 1897',
              prompt: 'Draft a mutual notice clause: All notices, demands, or communications under this Agreement shall be in writing and deemed duly served when delivered by: (a) hand delivery with signed acknowledgement, (b) registered post with acknowledgement due to the address on the cover page, or (c) email to the designated contact with read-receipt confirmation. Notices take effect on the date of receipt. Either party may update its notice details with 7 days written notice to the other party.'
            },
          ].map(({ label, act, prompt }) => (
            <button
              key={label}
              type="button"
              className="provision-pill"
              onClick={() => setAutoDraftPrompt(prompt)}
            >
              {label}
              <span className="provision-pill-act">{act}</span>
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleAutoDraft}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="input-group">
            <label className="input-label">Reference Context <span style={{ fontWeight: 400, opacity: 0.55, fontSize: '10px' }}>(Optional)</span></label>
            <div className="custom-select-wrapper">
              <select
                className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                style={{ width: '100%' }}
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
              >
                <option value="none">No Reference Context (Draft from Scratch)</option>
                {vaultDocs.length > 0 && (
                  <optgroup label="Vault Documents">
                    {vaultDocs.map(doc => (
                      <option key={doc.id} value={doc.id}>{doc.filename}</option>
                    ))}
                  </optgroup>
                )}
                {sharedFiles.length > 0 && (
                  <optgroup label="Shared Workspace">
                    {sharedFiles.map(f => (
                      <option key={f.id} value={`shared:${f.id}`}>{f.name || f.filename || 'Untitled'}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span className="custom-select-chevron">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Drafting Instructions *</label>
            <input
              type="text"
              placeholder="e.g. Synthesize a non-disclosure agreement clause..."
              className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
              style={{ width: '100%', boxSizing: 'border-box' }}
              required
              value={autoDraftPrompt}
              onChange={(e) => setAutoDraftPrompt(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" style={{ alignSelf: 'flex-start', padding: '10px 20px' }} disabled={drafting}>
            {drafting ? 'Synthesizing...' : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px', verticalAlign: 'middle' }}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Synthesize Clause
              </>
            )}
          </button>
        </div>
      </form>

      {draftStatus && (
        <div style={{ color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px' }}>
          {draftStatus}
        </div>
      )}
    </div>
  );

  // ── 6. RAG CHAT HANDLER ──────────────────────────────────────────────
  const submitRagQuery = async (query) => {
    if (!query.trim() || sendingChat) return;
    setChatHistory(prev => [...prev, { sender: 'user', text: query }]);
    setSendingChat(true);
    setTimeout(() => { if (chatStreamRef.current) chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight; }, 50);
    let compiledText = rawText;
    clauses.forEach(c => { if (c.isRevised && c.revisedText) compiledText = compiledText.replace(c.text, c.revisedText); });
    appendedClauses.forEach(ac => { compiledText += `\n\nADDED MISSING CLAUSE: ${ac.title}\n${ac.clause}`; });
    const res = await chatWithContract(compiledText, query);
    if (!isMountedRef.current) return;
    setSendingChat(false);
    setChatHistory(prev => [...prev, { sender: 'bot', text: (!res.error && res.response) ? res.response : (res.message || 'Error contacting chatbot.') }]);
    setTimeout(() => { if (chatStreamRef.current) chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight; }, 50);
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || sendingChat) return;

    const query = chatInput.trim();
    setChatInput('');
    setChatHistory(prev => [...prev, { sender: 'user', text: query }]);
    setSendingChat(true);

    setTimeout(() => {
      if (chatStreamRef.current) chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
    }, 50);

    // Build latest compiled text for chat context
    let compiledText = rawText;
    clauses.forEach(c => {
      if (c.isRevised && c.revisedText) {
        compiledText = compiledText.replace(c.text, c.revisedText);
      }
    });
    if (appendedClauses.length > 0) {
      appendedClauses.forEach(ac => {
        compiledText += `\n\nADDED MISSING CLAUSE: ${ac.title}\n${ac.clause}`;
      });
    }

    const res = await chatWithContract(compiledText, query);
    if (!isMountedRef.current) return;
    setSendingChat(false);

    if (!res.error && res.response) {
      setChatHistory(prev => [...prev, { sender: 'bot', text: res.response }]);
    } else {
      setChatHistory(prev => [...prev, { sender: 'bot', text: res.message || 'Error occurred while contacting chatbot.' }]);
    }

    setTimeout(() => {
      if (chatStreamRef.current) chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
    }, 50);
  };

  // ── 7. EXPORT & EXPORTER MODAL ───────────────────────────────────────
  const executeExport = async () => {
    if (!includeDoc && !includeDraft) {
      alert('Please check at least one section to export.');
      return;
    }

    let documentText = '';
    let draftText = '';

    if (includeDoc) {
      // Reconstruct rawText with revisions applied
      let compiledText = rawText;
      clauses.forEach(c => {
        if (c.isRevised && c.revisedText) {
          compiledText = compiledText.replace(c.text, c.revisedText);
        }
      });
      // Append missing clauses
      if (appendedClauses.length > 0) {
        compiledText += '\n\n';
        appendedClauses.forEach(ac => {
          compiledText += `\n----------------------------------------\nADDED MISSING CLAUSE: ${ac.title}\n${ac.clause}\n`;
        });
      }
      documentText = compiledText;
    }
    if (includeDraft) {
      draftText = autoDraftText;
      if (!draftText.trim()) {
        alert('Auto-Draft workspace is empty. Synthesize a clause first.');
        return;
      }
    }

    setExporting(true);
    setExportError('');

    try {
      const defaultFilename = `LexAI_Export.${exportFormat === 'docx' ? 'docx' : 'pdf'}`;
      const mimeType = exportFormat === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf';

      let fileHandle;
      if (window.showSaveFilePicker) {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: defaultFilename,
            types: [{
              description: exportFormat === 'docx' ? 'Word Document' : 'PDF Document',
              accept: { [mimeType]: [`.${exportFormat}`] },
            }],
          });
        } catch (err) {
          if (err.name === 'AbortError') {
            if (!isMountedRef.current) return;
            setExporting(false);
            return;
          }
        }
      }

      const blob = await exportContract(documentText, draftText, exportFormat);

      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      if (!isMountedRef.current) return;

      // Cross-save: dispatch to selected platform modules via shared store
      if (crossSaveTargets.length > 0) {
        const fileRecord = {
          id: `export_${Date.now()}`,
          filename: defaultFilename,
          format: exportFormat,
          content: documentText || draftText,
          savedAt: new Date().toISOString(),
          modules: crossSaveTargets,
          source: 'Contract Analyzer',
        };
        try {
          const existing = JSON.parse(localStorage.getItem('lex_shared_workspace') || '[]');
          existing.unshift(fileRecord);
          localStorage.setItem('lex_shared_workspace', JSON.stringify(existing.slice(0, 50)));
          window.dispatchEvent(new CustomEvent('lex:sharedWorkspaceUpdate', { detail: fileRecord }));
          setCrossSaveStatus(`Saved to: ${crossSaveTargets.join(', ')}`);
        } catch (_) { /* storage quota — silently skip */ }
      }

      setShowExportModal(false);
    } catch (err) {
      if (!isMountedRef.current) return;
      setExportError(err.message || 'Export request failed.');
    } finally {
      if (!isMountedRef.current) return;
      setExporting(false);
    }
  };

  // Close autocomplete dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Citation matching Precedent items
  const matchedPrecedents = (() => {
    const text = rawText.toLowerCase();
    const precedents = [];
    if (/\b(liquidated damages|fixed penalty|actual damages|penalty of|reduce the final invoice|payments withheld|discretion of the client)\b/i.test(text)) {
      precedents.push({
        title: 'Kailash Nath Associates v. Delhi Development Authority',
        desc: 'Supreme Court landmark ruling on Section 74 of the Indian Contract Act. Established that penalties can only be awarded if actual loss is proved.',
        url: 'https://indiankanoon.org/doc/11624932/'
      });
    }
    if (/\b(terminate.*convenience|termination.*without cause|terminate this agreement at any time|without prior notice|reject any deliverables)\b/i.test(text)) {
      precedents.push({
        title: 'Indian Oil Corporation Ltd. v. Amritsar Gas Service',
        desc: 'Held that determinable contracts cannot be specifically enforced under the Specific Relief Act, limiting remedies for wrongful termination to notice period damages.',
        url: 'https://indiankanoon.org/doc/45790435/'
      });
    }
    if (/\b(exclusive jurisdiction|seat of arbitration|sole arbitrator|courts located in|inconvenient forum|internal committee|waives all rights to approach any court)\b/i.test(text)) {
      precedents.push({
        title: 'Bharat Aluminium Co. v. Kaiser Aluminium',
        desc: 'Clarified applicability of Part I of the Arbitration and Conciliation Act to foreign-seated arbitrations.',
        url: 'https://indiankanoon.org/doc/137226892/'
      });
    }
    if (/\b(confidential information|trade secret|non-disclosure|maintain secrecy|disclose to others|protect this confidential information)\b/i.test(text)) {
      precedents.push({
        title: 'Zee Telefilms Ltd. v. Sundial Communications Pvt. Ltd.',
        desc: 'Established protection for trade secrets and confidential templates under the breach of confidence framework.',
        url: 'https://indiankanoon.org/doc/84589699/'
      });
    }
    if (/\b(intellectual property|work made for hire|exclusive property|transfer.*ip|no ip rights|moral rights)\b/i.test(text)) {
      precedents.push({
        title: 'Indian Performing Right Society Ltd. v. Eastern Indian Motion Pictures',
        desc: 'Supreme Court copyright ownership rules for works made for hire and rights of commissioning parties.',
        url: 'https://indiankanoon.org/doc/91660613/'
      });
    }
    return precedents;
  })();

  // Risk counts
  const redCount = clauses.filter(c => c.risk === 'RED').length;
  const amberCount = clauses.filter(c => c.risk === 'AMBER').length;
  const greenCount = clauses.filter(c => c.risk === 'GREEN').length;

  return (
    <>
      <style>{styles}</style>
      <div className="analyzer-container">

        {/* ── COMPACT HEADER BAR (single row) ── */}
        <div className="analyzer-header">
          {/* Title */}
          <div className="analyzer-title-block">
            <h1 className="analyzer-title">⚖️ Contract Risk Analyzer</h1>
            <span className="analyzer-subtitle">Liability audit · Indian Law</span>
          </div>

          {/* Risk pills — shown after analysis, inline in header */}
          {isAnalyzed && (
            <>
              <div className="header-sep" />
              <div className="risk-metric-pill high">
                <span className="risk-metric-dot red" />
                <strong>{redCount}</strong> High
              </div>
              <div className="risk-metric-pill amber">
                <span className="risk-metric-dot amber" />
                <strong>{amberCount}</strong> Med
              </div>
              <div className="risk-metric-pill green">
                <span className="risk-metric-dot green" />
                <strong>{greenCount}</strong> OK
              </div>
              <div className="header-sep" />
            </>
          )}

          {/* Mode selector + actions */}
          <div className="analyzer-actions">
            <div className="strategy-select-container" style={{ padding: '5px 10px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              <span style={{ fontSize: '10px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mode</span>
              <select
                className="strategy-dropdown"
                value={scanStrategy}
                onChange={(e) => handleStrategyChange(e.target.value)}
              >
                <option value="Defensive">Defensive Scan</option>
                <option value="Aggressive">Aggressive Scan</option>
              </select>
            </div>

            {isAnalyzed && (
              <>
                <button
                  className="btn-accent transition-all duration-300 ease-in-out"
                  onClick={() => setShowExportModal(true)}
                  style={{ fontSize: '12px', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '5px' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  Export
                </button>
                <button
                  onClick={() => { setIsAnalyzed(false); setRawText(''); setClauses([]); setSummary(''); setAppendedClauses([]); setActiveClauseId(null); setRewrittenText(''); setSummaryCollapsed(true); setComments([]); setActiveCommentDraft(null); }}
                  style={{ fontSize: '12px', background: 'transparent', border: '1px solid var(--border-dark-subtle)', color: '#9CA3AF', padding: '6px 12px', borderRadius: '7px', cursor: 'pointer', transition: 'all 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#9CA3AF'; e.currentTarget.style.borderColor = 'var(--border-dark-subtle)'; }}
                >
                  New
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── COLLAPSIBLE EXECUTIVE SUMMARY ── */}
        {isAnalyzed && summary && (
          <div className="summary-banner">
            <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent-primary)', flexShrink: 0, marginTop: '1px' }}>Summary</span>
            {!summaryCollapsed && (
              <span style={{ flex: 1, fontSize: '12.5px', color: '#94A3B8', lineHeight: 1.5 }}>{summary}</span>
            )}
            {summaryCollapsed && (
              <span style={{ flex: 1, fontSize: '12.5px', color: '#64748B', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {summary.slice(0, 90)}{summary.length > 90 ? '…' : ''}
              </span>
            )}
            <button className="summary-toggle-btn" onClick={() => setSummaryCollapsed(v => !v)}>
              {summaryCollapsed ? 'Expand' : 'Collapse'}
            </button>
          </div>
        )}

        {/* ────────── UNIFIED WORKSPACE ──────────
            No top-level ternary anymore: header, left panel, and right
            tabs render unconditionally. The dropzone/paste/rule-book UI
            that used to be a completely separate top-level screen (shown
            only pre-scan) now lives INSIDE the left panel itself, as the
            !rawText branch of the same inline ternary that renders
            <ContractTiptapEditor> once text exists (see the
            leftTab === 'scanner' branch below) — so quickDraftMode, a
            fresh page load, or any other "no text yet" state all land in
            this one workspace, never a separate blank-editor screen. */}
        {
          // ────────── INTERACTIVE SPLIT PANE WORKSPACE ──────────
          <div className="workspace-pane">

            {/* LEFT COLUMN: Document Editor */}
            <div className="editor-column">
              <div className="editor-header-bar">
                <div className="editor-tabs">
                  <button
                    className={`editor-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${leftTab === 'scanner' ? 'active' : ''}`}
                    onClick={() => setLeftTab('scanner')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5, verticalAlign: 'middle' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    Contract Text
                  </button>
                  <button
                    className={`editor-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${leftTab === 'autodraft' ? 'active' : ''}`}
                    onClick={() => setLeftTab('autodraft')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5, verticalAlign: 'middle' }}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    Auto-Draft
                  </button>
                </div>

                {quickDraftMode && !isAnalyzed && (
                  <button
                    onClick={() => { setQuickDraftMode(false); setRawText(''); }}
                    title="Exit Quick Draft Studio and return to upload"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: 'transparent', border: '1px solid var(--border-dark-subtle)',
                      borderRadius: '7px', padding: '6px 12px', fontSize: '11.5px', fontWeight: 600,
                      color: 'var(--text-dark-muted)', cursor: 'pointer',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/></svg>
                    Exit Quick Draft
                  </button>
                )}

                {/* The risk-count badges that used to live here duplicated the
                    exact same "N High / N Med" counters already shown at the
                    top of the page — replaced with the Mandate/Status pair
                    that used to occupy its own separate row below (see the
                    now-freed .scan-meta-bar row underneath, which hosts the
                    toolbar's portal target instead). One less redundant row,
                    one less duplicated stat. */}
                {leftTab !== 'scanner' ? (
                  <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>Auto-Draft Workspace</span>
                ) : !rawText && !quickDraftMode ? (
                  // No document yet at all, and not in Quick Draft either —
                  // nothing to scan, so no scan trigger here either. The
                  // left panel body below is showing the dropzone/paste UI,
                  // not the editor. (quickDraftMode is checked here too,
                  // not just below, so its own label branch further down
                  // is actually reachable — quickDraftMode's whole point is
                  // an instantly-available blank editor, not a redirect
                  // back to the dropzone just because rawText is empty.)
                  <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>Awaiting Document</span>
                ) : isAnalyzed ? (
                  (() => {
                    const flaggedCount = clauses.filter(c => c.risk === 'RED' || c.risk === 'AMBER').length;
                    const redCount2 = clauses.filter(c => c.risk === 'RED').length;
                    const statusColor = redCount2 > 0 ? '#FCA5A5' : flaggedCount > 0 ? '#FCD34D' : '#6EE7B7';
                    const statusLabel = flaggedCount > 0
                      ? `${flaggedCount} Flagged Provision${flaggedCount > 1 ? 's' : ''}`
                      : 'No Flags Detected';
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                        <div className="scan-meta-item" style={{ padding: 0, border: 'none' }}>
                          <span className="scan-meta-label">Mandate</span>
                          <span className="scan-meta-value">{scanStrategy} Scan · Indian Law</span>
                        </div>
                        <div className="scan-meta-item" style={{ padding: 0, border: 'none' }}>
                          <span className="scan-meta-label">Status</span>
                          <span className="scan-meta-value" style={{ color: statusColor }}>{statusLabel}</span>
                        </div>
                      </div>
                    );
                  })()
                ) : quickDraftMode ? (
                  <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>Quick Draft — no scan required</span>
                ) : (
                  // rawText exists (that's the only way this branch is
                  // reachable at all — see the outer !rawText && !quickDraftMode
                  // gate) but no scan has run yet: the editor is already
                  // showing the real extracted/pasted text, so the only
                  // thing missing is the trigger to actually analyze it.
                  <button
                    className="btn-accent transition-all duration-300 ease-in-out"
                    onClick={handleTextAnalyze}
                    disabled={isAnalyzing}
                    style={{ fontSize: '12px', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                    {isAnalyzing ? 'Scanning…' : 'Run Deep Scan'}
                  </button>
                )}
              </div>

              {/* Toolbar row — the scanner editor's own MS-Word-style toolbar
                  portals into this slot (see toolbarSlotEl/toolbarPortalTarget)
                  so it lives in normal document flow right below the header,
                  never inside the scrolling document area it used to fake-pin
                  itself into via sticky positioning + negative margins. Only
                  rendered in scanner mode — Auto-Draft's editor keeps its own
                  inline sticky toolbar, unaffected. */}
              {leftTab === 'scanner' && (rawText || quickDraftMode) && (
                <div className="scan-meta-bar" ref={setToolbarSlotEl} />
              )}

              <div className="editor-scroll-area" style={{ position: 'relative' }}>
                {isAnalyzing && <div className="ca-scan-overlay" />}
                {isAnalyzing && (
                  // Real SSE status/progress — visible for all 3 dispatch
                  // paths (Deep Scan, Strategy Toggle, Piped Document),
                  // since all three funnel through the same jobId state +
                  // top-level useContractJobStream hook.
                  <div style={{
                    position: 'sticky', top: '10px', zIndex: 5,
                    display: 'flex', alignItems: 'center', gap: '10px',
                    background: 'rgba(15,20,32,0.92)', border: '1px solid rgba(59,130,246,0.35)',
                    borderRadius: '10px', padding: '10px 14px', margin: '0 0 12px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.35)', width: 'fit-content', maxWidth: '100%',
                  }}>
                    <span style={{ width: '10px', height: '10px', border: '2px solid #3B82F6', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: '12.5px', color: 'var(--text-dark-primary)', fontWeight: 600 }}>{loadingText || 'Scanning...'}</span>
                    <span style={{ fontSize: '11.5px', color: '#93C5FD', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{Math.round(scanProgress)}%</span>
                  </div>
                )}
                {leftTab === 'scanner' ? (
                  !rawText && !quickDraftMode ? (
                    // No document yet, and the user hasn't explicitly opted
                    // into a blank drafting canvas either — show the
                    // dropzone/paste UI INSIDE this same left panel instead
                    // of behind a separate top-level screen. quickDraftMode
                    // skips straight past this to the (empty) editor below
                    // instead — its whole purpose is an INSTANT blank
                    // canvas, not another detour through the dropzone; that
                    // was the original "blank editor" complaint's actual
                    // fix (the editor was always reachable via
                    // quickDraftMode, it just had nothing in it and no
                    // visible way back to upload a real document, which is
                    // solved by this panel always having both paths live).
                    <div className="upload-layout-container" style={{ margin: '20px auto' }}>
                      {/* ── HERO ── */}
                      <div className="upload-hero">
                        <div className="upload-icon-ring">⚖️</div>
                        <h2 style={{ fontSize: '20px', color: 'var(--text-dark-primary)', margin: '0 0 6px', fontFamily: 'var(--font-serif)' }}>Senior Counsel Workspace</h2>
                        <p style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)', margin: 0, lineHeight: 1.5 }}>
                          Upload or paste a contract below. Optionally define your firm's non-negotiable rules to enforce them as absolute overrides during analysis.
                        </p>
                      </div>

                      {/* ── SPLIT GRID ── */}
                      <div className="upload-split-grid">

                        {/* LEFT COLUMN — Contract Subject */}
                        <div className="upload-col-card">
                          <div className="upload-col-label">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                            Contract Document
                          </div>

                          {/* Contract drop zone (extraction shows a layout-wide skeleton at panel level) */}
                          <div
                            className="drag-drop-zone transition-all duration-300 ease-in-out"
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                            onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); }}
                            onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); handleFileUpload(e.dataTransfer.files); }}
                          >
                            <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e.target.files)} accept=".pdf,.docx" />
                            {contractUploadLoading ? (
                              <>
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(99,102,241,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '10px' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                                <h3 style={{ fontSize: '13px', color: 'var(--text-dark-primary)', marginBottom: '8px' }}>{contractFile?.name || 'Extracting text'}</h3>
                                <span className="uploading-pulse" style={{ fontSize: '11px', color: 'rgba(99,102,241,0.9)', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', padding: '3px 10px', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#818CF8', animation: 'branding-pulse 1s infinite alternate' }} />
                                  Extracting…
                                </span>
                              </>
                            ) : contractFile ? (
                              <>
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '10px' }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                                <h3 style={{ fontSize: '13px', color: '#34D399', marginBottom: '4px' }}>{contractFile.name}</h3>
                                <p style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', marginBottom: '8px' }}>Ready to analyze — text extracted below</p>
                              </>
                            ) : (
                              <>
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(99,102,241,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '10px' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
                                <h3 style={{ fontSize: '14px', color: 'var(--text-dark-primary)', marginBottom: '4px' }}>Drop your contract here</h3>
                                <p style={{ fontSize: '12px', color: 'var(--text-dark-muted)', marginBottom: '8px' }}>PDF or DOCX — or click to browse</p>
                                <span style={{ fontSize: '11px', color: 'rgba(99,102,241,0.8)', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', padding: '3px 10px', borderRadius: '10px' }}>Supports large scanned files (up to 100MB)</span>
                              </>
                            )}
                          </div>

                          {/* Contract divider */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
                            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-dark-subtle)' }} />
                            <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>or paste text</span>
                            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-dark-subtle)' }} />
                          </div>

                          <div className="ca-textarea-wrap">
                            <textarea
                              key={`contract-${contractFile?.name || (rawText ? 'loaded' : 'empty')}`}
                              className="input-textarea"
                              placeholder="Paste the raw text of your contract here…"
                              defaultValue={rawText}
                              readOnly={isAnalyzing}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (rawTextDebounceRef.current) clearTimeout(rawTextDebounceRef.current);
                                rawTextDebounceRef.current = setTimeout(() => {
                                  setRawText(val);
                                }, 800);
                              }}
                              style={{ marginBottom: 0 }}
                            />
                          </div>
                        </div>

                        {/* RIGHT COLUMN — Rule Book Strategy */}
                        <div className="upload-col-card">
                          <div className="upload-col-label upload-col-label--rulebook">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                            Custom Rule Book &amp; Directives
                            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: '10px', color: 'var(--text-dark-muted)' }}>(Optional)</span>
                            {ruleBookText.trim() && (
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8B5CF6', display: 'inline-block', marginLeft: 'auto', flexShrink: 0 }} />
                            )}
                          </div>

                          <p style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>
                            Upload or type your firm's non-negotiable rules. The AI will enforce these as{' '}
                            <strong style={{ color: '#A78BFA' }}>absolute overrides</strong>{' '}
                            and flag any violation with a <strong style={{ color: '#A78BFA' }}>Rule Book</strong> badge.
                          </p>

                          {/* Rule Book drop zone */}
                          {ruleBookUploadLoading ? (
                            <div className="drag-drop-zone drag-drop-zone--rulebook drag-drop-zone--loading" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                              <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: '2.5px solid rgba(139,92,246,0.2)', borderTopColor: '#8B5CF6', animation: 'spin 0.9s linear infinite' }} />
                              <span style={{ fontSize: '12.5px', color: 'rgba(139,92,246,0.8)' }}>Extracting text…</span>
                            </div>
                          ) : (
                            <div
                              className="drag-drop-zone drag-drop-zone--rulebook transition-all duration-300 ease-in-out"
                              onClick={() => ruleBookFileInputRef.current?.click()}
                              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); }}
                              onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); handleRuleBookFileUpload(e.dataTransfer.files); }}
                            >
                              <input type="file" ref={ruleBookFileInputRef} multiple style={{ display: 'none' }} onChange={(e) => handleRuleBookFileUpload(e.target.files)} accept=".pdf,.docx" />
                              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(139,92,246,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '10px' }}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                              {ruleBookFile ? (
                                <>
                                  <h3 style={{ fontSize: '13px', color: '#A78BFA', marginBottom: '4px' }}>{ruleBookFile.name}</h3>
                                  <p style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', marginBottom: '8px' }}>Text extracted — click to replace</p>
                                </>
                              ) : (
                                <>
                                  <h3 style={{ fontSize: '14px', color: 'var(--text-dark-primary)', marginBottom: '4px' }}>Drop Rule Books here</h3>
                                  <p style={{ fontSize: '12px', color: 'var(--text-dark-muted)', marginBottom: '8px' }}>PDF or DOCX — select multiple to combine</p>
                                </>
                              )}
                              <span style={{ fontSize: '11px', color: 'rgba(139,92,246,0.8)', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', padding: '3px 10px', borderRadius: '10px' }}>Extracts text automatically</span>
                            </div>
                          )}

                          {/* Rule Book divider */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
                            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-dark-subtle)' }} />
                            <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>or type directives</span>
                            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-dark-subtle)' }} />
                          </div>

                          <textarea
                            className="input-textarea"
                            placeholder={"Examples:\n• No arbitration clauses — all disputes must go to Delhi High Court.\n• Liability cap must not exceed 3× contract value.\n• Payment terms must not exceed Net-30.\n• Indemnification must always be mutual, never one-sided."}
                            value={ruleBookText}
                            onChange={(e) => setRuleBookText(e.target.value)}
                            style={{ marginBottom: 0, borderColor: ruleBookText.trim() ? 'rgba(139,92,246,0.35)' : undefined, fontSize: '12.5px', resize: 'vertical' }}
                          />
                        </div>
                      </div>

                      {/* ── FAST-TRACK BAR — two distinct visual paths ── */}
                      <div className="upload-analyze-bar">
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button
                            className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg"
                            onClick={handleTextAnalyze}
                            title="Full AI risk scan — runs as a background job, streams live progress"
                            style={{ flex: 1, padding: '13px', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                            Deep Scan
                          </button>
                          <button
                            onClick={() => setQuickDraftMode(true)}
                            title="Skip the AI scan — open a blank drafting workspace instantly"
                            style={{
                              flex: 1, padding: '13px', fontSize: '14px', fontWeight: '600',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                              background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.35)',
                              borderRadius: '8px', color: '#C4B5FD', cursor: 'pointer',
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.18)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.1)'; }}
                          >
                            ⚡ Quick Draft Studio
                          </button>
                        </div>
                        {ruleBookText.trim() && (
                          <p style={{ margin: '10px 0 0', textAlign: 'center', fontSize: '11.5px', color: 'rgba(167,139,250,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8B5CF6', display: 'inline-block' }} />
                            Rule Book active — {ruleBookText.trim().length} chars of directives will be enforced
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                  <>
                    <ContractTiptapEditor
                      documentKey={documentVersion}
                      initialRawText={rawText}
                      clauses={clauses}
                      scanStrategy={scanStrategy}
                      onRiskClick={inspectRisk}
                      onTextChange={setRawText}
                      onEditorReady={(ed) => { editorApiRef.current = ed; }}
                      editable={!isAnalyzing}
                      onCommentRequest={handleCommentRequest}
                      onHighlightClick={handleHighlightClick}
                      toolbarPortalTarget={toolbarSlotEl}
                    />
                    {appendedClauses.length > 0 && (
                      <div className="appended-clauses-container" style={{ marginTop: '24px' }}>
                        {appendedClauses.map((ac, idx) => (
                          <div key={idx} className="appended-clause-wrapper">
                            <hr className="extension-divider" />
                            <blockquote className={ac.isNewlyAppended ? "newly-appended-blockquote" : "extension-blockquote"}>
                              <strong className="extension-title" style={{ userSelect: 'none' }}>
                                Added Missing Clause: {ac.title}
                              </strong>
                              <div
                                className="extension-body"
                                contentEditable
                                suppressContentEditableWarning
                                onBlur={(e) => {
                                  const text = e.target.innerText || e.target.textContent || '';
                                  setAppendedClauses(prev => prev.map((item, i) => {
                                    if (i === idx) {
                                      return { ...item, clause: text.trim() };
                                    }
                                    return item;
                                  }));
                                }}
                              >
                                {ac.clause}
                              </div>
                            </blockquote>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                  )
                ) : (
                  <div>
                    {drafting ? (
                      <div className="auto-draft-loading-card">
                        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-primary)', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '10px', height: '10px', border: '2px solid var(--accent-primary)', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                          <span key={draftStatus} className="ca-status-fade">{draftStatus || 'Synthesizing clause…'}</span>
                        </div>
                        <div className="shimmer-bar shimmer-bar-in" style={{ width: '42%', height: '17px', marginBottom: '20px', animationDelay: '0ms' }} />
                        <div className="shimmer-bar shimmer-bar-in" style={{ width: '100%', animationDelay: '60ms' }} />
                        <div className="shimmer-bar shimmer-bar-in" style={{ width: '96%', animationDelay: '120ms' }} />
                        <div className="shimmer-bar shimmer-bar-in" style={{ width: '99%', animationDelay: '180ms' }} />
                        <div className="shimmer-bar shimmer-bar-in" style={{ width: '70%', marginBottom: '22px', animationDelay: '240ms' }} />
                        <div className="shimmer-bar shimmer-bar-in" style={{ width: '100%', animationDelay: '300ms' }} />
                        <div className="shimmer-bar shimmer-bar-in" style={{ width: '88%', animationDelay: '360ms' }} />
                        <div className="shimmer-bar shimmer-bar-in" style={{ width: '93%', animationDelay: '420ms' }} />
                        <div className="shimmer-bar shimmer-bar-in" style={{ width: '55%', animationDelay: '480ms' }} />
                      </div>
                    ) : draftError ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '12px', margin: '40px 4px', padding: '18px 20px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.28)', borderLeft: '3px solid var(--accent-danger, #EF4444)', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#FCA5A5', letterSpacing: '0.02em' }}>Synthesis Failed</span>
                        </div>
                        <span style={{ fontSize: '13px', color: 'var(--text-dark-primary)', lineHeight: 1.5 }}>{draftError}</span>
                        <button onClick={() => setDraftError('')} style={{ marginTop: '2px', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', color: 'var(--text-dark-muted)', fontSize: '11px', fontWeight: 600, padding: '5px 12px', borderRadius: '6px', cursor: 'pointer' }}>
                          Dismiss
                        </button>
                      </div>
                    ) : autoDraftText ? (
                      // Same rich editor the Contract Text tab uses (full MS
                      // Word-style toolbar: font family/size, bold/italic/
                      // underline, alignment) instead of a bare
                      // contentEditable div — "unify the editor across the
                      // app" per this feature's own goal. clauses/onRiskClick
                      // /onCommentRequest/onHighlightClick are all omitted:
                      // risk-decoration and comment/citation workflows are
                      // scanner-specific and don't apply to a freshly
                      // synthesized clause. onEditorReady is deliberately
                      // NOT wired to editorApiRef — that ref is read by
                      // scanner-only actions (insertCitationIntoDocument,
                      // handleAcceptRevision, etc.) that must keep targeting
                      // the Contract Text editor even while this tab is open,
                      // not silently redirect to whichever editor mounted
                      // most recently.
                      <ContractTiptapEditor
                        documentKey={autoDraftVersion}
                        initialRawText={autoDraftText}
                        onTextChange={setAutoDraftText}
                        clauses={[]}
                      />
                    ) : (
                      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                        No auto-drafted clause generated yet. Execute instructions in the "Auto-Draft" tab on the right to compile legal clauses.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Analysis Console */}
            <div className="analysis-column">
              <div className="analysis-tabs-bar">
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out ${activeTab === 'risks' ? 'active' : ''}`} onClick={() => switchTab('risks')}>
                  Risks {redCount + amberCount > 0 && <span style={{ marginLeft: '5px', background: 'rgba(15,15,20,0.7)', border: '1px solid rgba(255,255,255,0.08)', color: redCount > 0 ? '#FCA5A5' : '#FCD34D', borderRadius: '6px', padding: '1px 6px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.02em' }}>{redCount + amberCount}</span>}
                </button>
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out ${activeTab === 'recs' ? 'active' : ''}`} onClick={() => { switchTab('recs'); if (recommendations.length === 0) fetchMissingProtections(); }}>
                  Missing {recommendations.length > 0 && <span style={{ marginLeft: '5px', background: 'rgba(15,15,20,0.7)', border: '1px solid rgba(255,255,255,0.08)', color: '#FCD34D', borderRadius: '6px', padding: '1px 6px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.02em' }}>{recommendations.length}</span>}
                </button>
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out ${activeTab === 'draft' ? 'active' : ''}`} onClick={() => switchTab('draft')}>
                  Auto-Draft
                </button>
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out ${activeTab === 'chat' ? 'active' : ''}`} onClick={() => switchTab('chat')}>
                  RAG Chat
                </button>
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out ${activeTab === 'citations' ? 'active' : ''}`} onClick={() => switchTab('citations')}>
                  Citations {citations.length > 0 && <span style={{ marginLeft: '5px', background: 'rgba(15,15,20,0.7)', border: '1px solid rgba(255,255,255,0.08)', color: '#93C5FD', borderRadius: '6px', padding: '1px 6px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.02em' }}>{citations.length}</span>}
                </button>
                <button className={`analysis-tab-btn transition-all duration-300 ease-in-out ${activeTab === 'comments' ? 'active' : ''}`} onClick={() => switchTab('comments')}>
                  Comments {comments.length > 0 && <span style={{ marginLeft: '5px', background: 'rgba(15,15,20,0.7)', border: '1px solid rgba(255,255,255,0.08)', color: '#FCD34D', borderRadius: '6px', padding: '1px 6px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.02em' }}>{comments.length}</span>}
                </button>
              </div>

              <div ref={analysisPanelBodyRef} className={`analysis-panel-body transition-opacity duration-300 ${tabOpacity}`}>

                {/* SUB TAB: Risks (Actions) */}
                {activeTab === 'risks' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>

                    {activeClause ? (
                      <div ref={inspectedCardRef} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* Back to list */}
                        <button
                          onClick={() => { setActiveClauseId(null); setRewrittenText(''); setIntent(''); }}
                          style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '12px', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
                          All clauses
                        </button>
                        {/* ── TWO-COLUMN RISK INSPECTOR ── */}
                        <div className="risk-inspector-grid">

                          {/* Column A: Audit Profile */}
                          <div className="audit-col">
                            <div className="inspected-risk-card" style={{ padding: '11px 13px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '7px', flexWrap: 'wrap' }}>
                                <span className={`risk-indicator-dot ${activeClause.risk === 'RED' ? 'red' : 'amber'}`}></span>
                                <h3 style={{ fontSize: '13px', color: 'white', margin: 0, fontWeight: '700', flex: 1 }}>
                                  {activeClause.clauseTitle || (activeClause.risk === 'RED' ? 'High Risk Clause' : 'Medium Risk Clause')}
                                </h3>
                                {activeClause.isRuleBookViolation && (
                                  <span className="rulebook-badge" style={{ fontSize: '9.5px' }}>⚡ Rule Book Override</span>
                                )}
                              </div>
                              <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dark-muted)' }}>Original Text</span>
                              <div className="original-clause-box" style={{ fontSize: '12.5px', marginTop: '5px' }}>{activeClause.text}</div>
                            </div>

                            <div style={{ padding: '10px 12px', background: activeClause.risk === 'RED' ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)', borderLeft: `3px solid ${activeClause.risk === 'RED' ? 'var(--accent-danger)' : 'var(--accent-warning)'}`, fontSize: '12px', color: 'var(--text-dark-primary)', lineHeight: '1.5', borderRadius: '0 4px 4px 0' }}>
                              <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: activeClause.risk === 'RED' ? '#FCA5A5' : '#FCD34D', display: 'block', marginBottom: '4px' }}>Indian Legal Issue</span>
                              {activeClause.issue}
                            </div>
                          </div>

                          {/* Column B: Playbook Guardrail + Revision Workshop */}
                          <div className="playbook-col">
                            {/* Rule Enforced */}
                            <div style={{ padding: '10px 12px', background: activeClause.isRuleBookViolation ? 'rgba(139,92,246,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${activeClause.isRuleBookViolation ? 'rgba(139,92,246,0.28)' : 'rgba(255,255,255,0.05)'}`, borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '5px', minHeight: '60px' }}>
                              <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: activeClause.isRuleBookViolation ? '#A78BFA' : 'var(--text-dark-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 0 0 6.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 0 0 6.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"/></svg>
                                Playbook Guardrail
                              </span>
                              {activeClause.isRuleBookViolation && activeClause.ruleBookReference ? (
                                <span style={{ fontSize: '12px', color: 'var(--text-dark-primary)', lineHeight: 1.45, fontStyle: 'italic' }}>
                                  "{activeClause.ruleBookReference}"
                                </span>
                              ) : (
                                <span style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', fontStyle: 'italic' }}>No rule book override active for this clause.</span>
                              )}
                            </div>

                            {/* Revision Workshop — glass card */}
                            <div className="revision-glass-card">
                              <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dark-muted)' }}>Revision Workshop</span>

                              {activeClause.isPendingSuggestion ? (
                                <>
                                  <div style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', fontSize: '12px', color: 'var(--text-dark-muted)', lineHeight: 1.5 }}>
                                    A tracked change is live in the document — the original text is struck through
                                    in red, the suggestion is underlined in green. Review it there, then resolve it below.
                                  </div>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                      className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5"
                                      onClick={acceptActiveSuggestion}
                                      style={{ flex: 1, padding: '9px', fontSize: '12.5px', background: 'var(--accent-success)' }}
                                    >
                                      ✓ Accept into Document
                                    </button>
                                    <button
                                      onClick={rejectActiveSuggestion}
                                      style={{ flex: 1, padding: '9px', fontSize: '12.5px', background: 'transparent', border: '1px solid rgba(239,68,68,0.35)', color: '#FCA5A5', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                                    >
                                      ✗ Discard Suggestion
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div style={{ position: 'relative' }}>
                                    <input
                                      type="text"
                                      placeholder="E.g., Make notice mutual, cap penalty at 2×…"
                                      className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                                      style={{ width: '100%', boxSizing: 'border-box', fontSize: '12px' }}
                                      value={intent}
                                      onChange={(e) => { setIntent(e.target.value); setShowSuggestions(true); }}
                                      onFocus={() => setShowSuggestions(true)}
                                    />
                                    {showSuggestions && dynamicIntents.length > 0 && (
                                      <div className="autocomplete-dropdown" ref={suggestionsRef}>
                                        {dynamicIntents.map((item, idx) => (
                                          <div key={idx} className="autocomplete-item" onClick={() => { setIntent(item); setShowSuggestions(false); }}>
                                            💡 {item}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  <button
                                    className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5"
                                    onClick={handleRewrite}
                                    disabled={rewriting}
                                    style={{ width: '100%', padding: '9px', fontSize: '12.5px' }}
                                  >
                                    {rewriting ? (
                                      <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite', marginRight: 6, verticalAlign: 'middle' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Generating…</>
                                    ) : 'Rewrite Clause with AI'}
                                  </button>

                                  {rewrittenText && (
                                    <>
                                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
                                        <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent-success)', display: 'block', marginBottom: '6px' }}>AI Suggested Revision</span>
                                        <textarea
                                          className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                                          style={{ height: '90px', width: '100%', boxSizing: 'border-box', border: '1px solid rgba(16,185,129,0.3)', fontSize: '12px', resize: 'none' }}
                                          value={rewrittenText}
                                          onChange={(e) => setRewrittenText(e.target.value)}
                                        />
                                      </div>
                                      <button
                                        className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5"
                                        onClick={applyRevision}
                                        style={{ width: '100%', padding: '9px', fontSize: '12.5px', background: 'var(--accent-success)' }}
                                      >
                                        Apply Rewrite to Document
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* ── CLAUSE LIST OVERVIEW ── */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {isAnalyzing ? (
                          // A scan is in flight (Deep Scan / Strategy Toggle /
                          // Piped Document all land here identically) — an
                          // empty clauses array right now means "no results
                          // YET", not "scan complete, zero risks". Showing
                          // "No flagged clauses found" here would misreport
                          // an in-progress scan as an already-clean contract.
                          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dark-muted)', fontSize: '13px' }}>
                            <span style={{ width: '16px', height: '16px', border: '2px solid var(--accent-primary)', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite', marginBottom: '10px' }} />
                            <div style={{ marginTop: '10px' }}>{loadingText || 'Scanning...'}</div>
                          </div>
                        ) : clauses.filter(c => c.risk === 'RED' || c.risk === 'AMBER').length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                            No flagged clauses found.
                          </div>
                        ) : (
                          <>
                            <div style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                              {clauses.filter(c => c.risk === 'RED' || c.risk === 'AMBER').length} flagged clauses — click to inspect & rewrite
                            </div>
                            {clauses
                              .filter(c => c.risk === 'RED' || c.risk === 'AMBER')
                              // High risk first, then medium — Array.sort is
                              // stable (guaranteed since ES2019), so clauses
                              // within the same risk tier keep their original
                              // relative order instead of being reshuffled.
                              .sort((a, b) => (a.risk === b.risk ? 0 : a.risk === 'RED' ? -1 : 1))
                              .map((c, idx) => (
                              <div
                                key={c.id}
                                className={`clause-list-item animate-fade-in ${c.risk === 'RED' ? 'red-item' : 'amber-item'}`}
                                style={{ animationDelay: `${idx * 150}ms` }}
                                onClick={() => inspectRisk(c.id)}
                              >
                                <span className="clause-number">#{idx + 1}</span>
                                <span className="clause-text-preview">{c.text}</span>
                                <span className={`clause-risk-badge ${c.risk === 'RED' ? 'red' : 'amber'}`}>
                                  {c.risk === 'RED' ? 'HIGH' : 'MED'}
                                </span>
                                {c.isRuleBookViolation && (
                                  <span className="rulebook-badge">⚡ Rule Book</span>
                                )}
                              </div>
                            ))}
                            {greenCount > 0 && (
                              <div style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }}></span>
                                {greenCount} clause{greenCount > 1 ? 's' : ''} resolved
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* SUB TAB: Recommendations (Extensions) */}
                {activeTab === 'recs' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ fontSize: '15px', color: 'white', margin: 0 }}>Missing Indian Protections</h3>
                      <button
                        className="btn-accent transition-all duration-300 ease-in-out"
                        style={{ fontSize: '11px', padding: '4px 10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '7px' }}
                        onClick={fetchMissingProtections}
                        disabled={loadingRecs}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                        Re-Scan
                      </button>
                    </div>

                    {loadingRecs ? (
                      <div>
                        <div className="shimmer-bar"></div>
                        <div className="shimmer-bar" style={{ width: '80%' }}></div>
                        <div className="shimmer-bar" style={{ width: '60%' }}></div>
                      </div>
                    ) : recommendations.length === 0 ? (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                        No missing clauses identified yet.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} style={{ display: 'flex', flexDirection: 'column', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
                          {recommendations.map((item, idx) => (
                            <div key={idx} className="rec-protection-card" style={{ marginBottom: 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                <strong style={{ fontSize: '13px', color: '#F1F5F9', fontWeight: 600 }}>{item.title}</strong>
                                <input
                                  type="checkbox"
                                  className="custom-checkbox"
                                  checked={item.selected}
                                  onChange={() => handleRecommendationCheck(idx)}
                                />
                              </div>
                              <textarea
                                className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                                style={{ height: '80px', width: '100%', boxSizing: 'border-box', fontSize: '13px', resize: 'none' }}
                                value={item.clause}
                                onChange={(e) => handleRecommendationChange(idx, e.target.value)}
                              />
                            </div>
                          ))}
                        </div>

                        <button
                          className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg"
                          onClick={addSelectedRecommendations}
                          style={{ width: '100%', padding: '12px' }}
                        >
                          ➕ Add Selected Clauses to Contract
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* SUB TAB: Auto-Draft */}
                {activeTab === 'draft' && renderAutoDraftStudio()}

                {/* SUB TAB: Chat */}
                {activeTab === 'chat' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
                    <div className="chat-bubble-stream" ref={chatStreamRef}>
                      {chatHistory.map((msg, i) => (
                        <div key={i} className={`chat-message-bubble ${msg.sender}`}>
                          {msg.text}
                        </div>
                      ))}
                      {sendingChat && (
                        <div className="chat-message-bubble bot" style={{ fontStyle: 'italic', color: 'var(--text-dark-muted)' }}>
                          Searching document...
                        </div>
                      )}
                    </div>

                    {/* ── RAG MACRO QUICK-FIRE ── */}
                    <div className="rag-macros-row">
                      {[
                        { label: '🔍 Audit Liability Caps', query: 'What are the liability cap provisions in this contract? Identify any one-sided indemnification, unlimited liability exposure, or clauses that waive consequential damages to the detriment of the Vendor. Cite exact clause text.' },
                        { label: '🛡️ Force Majeure Alignment', query: 'Does this contract contain a force majeure clause? If yes, analyze whether it covers epidemic/pandemic events, government orders, and cyberattacks as required by contemporary Indian commercial practice. If absent, flag the gap.' },
                        { label: '📅 Verify Notice Periods', query: 'Extract and list all notice periods specified in this contract: termination notice, dispute notice, breach cure periods, and payment notice. Flag any notice period shorter than 15 days or absent entirely.' },
                      ].map(({ label, query }) => (
                        <button
                          key={label}
                          type="button"
                          className="rag-macro-btn"
                          disabled={sendingChat}
                          onClick={() => submitRagQuery(query)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-dark-subtle)', paddingTop: '10px' }}>
                      <input
                        type="text"
                        placeholder="Ask a grounded contract query..."
                        className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                        style={{ flex: 1 }}
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                      />
                      <button type="submit" className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg" style={{ padding: '0 20px' }} disabled={sendingChat}>
                        Send
                      </button>
                    </form>
                  </div>
                )}

                {/* SUB TAB: Citations */}
                {activeTab === 'citations' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h3 style={{ fontSize: '15px', color: 'white', margin: 0 }}>Landmark Indian Contract Precedents</h3>

                    {citations.length === 0 ? (
                      <div style={{ padding: '20px', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px', textAlign: 'center' }}>
                        No case law citations found for this document. Run a deep scan to generate semantic precedents.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
                        {citations.map((prec, i) => {
                          const { displayTitle, kanoonQuery } = resolveCitationDisplay(prec);
                          return (
                          <div key={i} className="precedent-card animate-fade-in" style={{ marginBottom: 0, animationDelay: `${i * 150}ms` }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <span>⚖️</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-dark-primary)' }}>
                                    {displayTitle}
                                  </span>
                                  {!prec.in_vault && (
                                    <span className="citation-not-in-vault-badge">Not in Firm Vault</span>
                                  )}
                                </div>
                                <p style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)', marginTop: '6px', lineHeight: '1.5' }}>
                                  "{prec.snippet}..."
                                </p>
                                <div className="citation-action-footer">
                                  <button
                                    onClick={() => insertCitationIntoDocument(prec)}
                                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-dark-subtle)', color: '#CBD5E1', fontSize: '11px', fontWeight: 600, padding: '5px 12px', borderRadius: '6px', cursor: 'pointer' }}
                                  >
                                    📖 Insert Citation
                                  </button>
                                  {prec.in_vault ? (
                                    <button
                                      className="citation-btn-vault"
                                      onClick={() => navigate(`/case/vault/doc/${prec.vault_id}`)}
                                    >
                                      📂 View in Vault
                                    </button>
                                  ) : (
                                    <a
                                      className="citation-btn-kanoon"
                                      href={`${API_BASE}/api/kanoon-redirect?query=${encodeURIComponent(kanoonQuery)}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <ExternalLinkIcon /> Open Official Record
                                    </a>
                                  )}
                                  <button
                                    onClick={() => handleSearchRelated(prec, i)}
                                    disabled={loadingRelated === i}
                                    style={{
                                      background: 'transparent', border: '1px solid #3b82f6', color: '#60a5fa',
                                      fontSize: '11px', fontWeight: 600, padding: '5px 12px', borderRadius: '6px',
                                      cursor: loadingRelated === i ? 'default' : 'pointer',
                                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                                      opacity: loadingRelated === i ? 0.7 : 1, transition: 'all 0.15s',
                                    }}
                                  >
                                    {loadingRelated === i ? (
                                      <>
                                        <span style={{ width: '10px', height: '10px', border: '2px solid rgba(96,165,250,0.3)', borderTopColor: '#60a5fa', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} />
                                        Searching…
                                      </>
                                    ) : relatedCitations[i] ? (
                                      '🔗 Hide Related Citations'
                                    ) : (
                                      '🔗 Search Related Citations'
                                    )}
                                  </button>
                                </div>

                                {relatedCitations[i] && (
                                  <div style={{ marginLeft: '1rem', borderLeft: '2px solid #374151', paddingLeft: '12px', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {relatedCitations[i].length === 0 ? (
                                      <p style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', fontStyle: 'italic', margin: 0 }}>No related citations found.</p>
                                    ) : (
                                      relatedCitations[i].map((related, j) => {
                                        const { displayTitle: relatedTitle, kanoonQuery: relatedKanoonQuery } = resolveCitationDisplay(related);
                                        return (
                                          <div key={related.id || j}>
                                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-dark-primary)', marginBottom: '4px' }}>
                                              {relatedTitle}
                                            </div>
                                            {related.snippet && (
                                              <p style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', margin: '0 0 6px', lineHeight: 1.5 }}>
                                                "{related.snippet.length > 140 ? `${related.snippet.slice(0, 140)}…` : related.snippet}"
                                              </p>
                                            )}
                                            <a
                                              className="citation-btn-kanoon"
                                              href={`${API_BASE}/api/kanoon-redirect?query=${encodeURIComponent(relatedKanoonQuery)}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              style={{ fontSize: '10.5px', padding: '4px 10px' }}
                                            >
                                              <ExternalLinkIcon /> Open Official Record
                                            </a>
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* SUB TAB: Comments */}
                {activeTab === 'comments' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h3 style={{ fontSize: '15px', color: 'white', margin: 0 }}>Comments</h3>

                    {activeCommentDraft && (
                      <div className="revision-glass-card" data-comment-card-id={activeCommentDraft.commentId}>
                        <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dark-muted)' }}>
                          Commenting on
                        </span>
                        <div className="original-clause-box" style={{ fontSize: '12px' }}>{activeCommentDraft.text}</div>
                        <textarea
                          className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                          style={{ height: '70px', width: '100%', boxSizing: 'border-box', fontSize: '12.5px', resize: 'none' }}
                          placeholder="Type your comment…"
                          value={activeCommentDraft.draft}
                          onChange={(e) => setActiveCommentDraft(prev => ({ ...prev, draft: e.target.value }))}
                          autoFocus
                        />

                        {/* AI Auto-Resolution: loading / diff / error states */}
                        {activeCommentDraft.revision?.status === 'loading' && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0', fontSize: '12px', color: '#A78BFA' }}>
                            <div style={{ width: 13, height: 13, border: '2px solid rgba(167,139,250,0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                            Drafting revision…
                          </div>
                        )}
                        {activeCommentDraft.revision?.status === 'error' && (
                          <div style={{ fontSize: '12px', color: '#FCA5A5', padding: '8px 0' }}>
                            Draft revision failed: {activeCommentDraft.revision.message || 'unknown error'}
                          </div>
                        )}
                        {activeCommentDraft.revision?.status === 'done' && (
                          <div className="ca-diff-block">
                            <div className="ca-diff-row ca-diff-original">
                              <span className="ca-diff-label">− Original</span>
                              <div>{activeCommentDraft.text}</div>
                            </div>
                            <div className="ca-diff-row ca-diff-revised">
                              <span className="ca-diff-label">+ Revised</span>
                              <div>{activeCommentDraft.revision.revisedText}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                              <button
                                className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5"
                                style={{ flex: 1, padding: '7px', fontSize: '12px' }}
                                onClick={handleAcceptRevision}
                              >
                                ✓ Accept &amp; Replace
                              </button>
                              <button
                                onClick={handleRejectRevision}
                                style={{ flex: 1, padding: '7px', fontSize: '12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-dark-muted)', borderRadius: '8px', cursor: 'pointer' }}
                              >
                                ✕ Reject
                              </button>
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                          <button
                            className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5"
                            style={{ flex: 1, padding: '8px', fontSize: '12px' }}
                            disabled={!activeCommentDraft.draft.trim()}
                            onClick={() => {
                              setComments(prev => [...prev, { id: activeCommentDraft.commentId, text: activeCommentDraft.text, comment: activeCommentDraft.draft.trim() }]);
                              setActiveCommentDraft(null);
                            }}
                          >
                            Save Comment
                          </button>
                          {activeCommentDraft.revision?.status !== 'loading' && (
                            <button
                              onClick={() => requestDraftRevision(
                                activeCommentDraft.commentId, activeCommentDraft.text,
                                activeCommentDraft.from, activeCommentDraft.to, activeCommentDraft.draft
                              )}
                              style={{ flex: 1, padding: '8px', fontSize: '12px', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.3)', color: '#C4B5FD', borderRadius: '8px', cursor: 'pointer' }}
                            >
                              🪄 Draft Revision
                            </button>
                          )}
                          <button
                            onClick={() => setActiveCommentDraft(null)}
                            style={{ flex: 1, padding: '8px', fontSize: '12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-dark-muted)', borderRadius: '8px', cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {comments.length === 0 && !activeCommentDraft ? (
                      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                        No comments yet. Select text in the document and use the "💬 Comment" bubble menu.
                      </div>
                    ) : (
                      comments.map((c) => (
                        <div
                          key={c.id}
                          className="revision-glass-card"
                          data-comment-card-id={c.id}
                          onClick={() => handleCommentCardClick(c.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-dark-muted)' }}>On</span>
                          <div className="original-clause-box" style={{ fontSize: '12px' }}>{c.text}</div>
                          <p style={{ fontSize: '13px', color: 'var(--text-dark-primary)', margin: 0 }}>{c.comment}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}

              </div>
            </div>

          </div>
        }

      </div>

      {/* ── EXPORT & DEPLOY MODAL ── */}
      {showExportModal && (
        <div className="modal-overlay" onClick={() => setShowExportModal(false)}>
          <div className="export-modal-card" onClick={(e) => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 0' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-dark-primary)', margin: 0, letterSpacing: '-0.01em' }}>Export &amp; Deploy</h2>
                <p style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', margin: '3px 0 0' }}>Download your document or push it to platform modules</p>
              </div>
              <button
                onClick={() => setShowExportModal(false)}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-dark-muted)', width: '30px', height: '30px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0 }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

              {/* Format tiles */}
              <div>
                <label className="input-label" style={{ marginBottom: '10px' }}>Export Format</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {/* PDF tile */}
                  <div className={`format-tile ${exportFormat === 'pdf' ? 'selected' : ''}`} onClick={() => setExportFormat('pdf')}>
                    <div className="format-tile-check">
                      {exportFormat === 'pdf' && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <div className="format-tile-icon-wrap">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={exportFormat === 'pdf' ? '#60A5FA' : 'var(--text-dark-muted)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-dark-primary)', marginBottom: '2px' }}>PDF Format</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>Print-ready layout</span>
                    </div>
                  </div>
                  {/* Word tile */}
                  <div className={`format-tile ${exportFormat === 'docx' ? 'selected' : ''}`} onClick={() => setExportFormat('docx')}>
                    <div className="format-tile-check">
                      {exportFormat === 'docx' && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    <div className="format-tile-icon-wrap">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={exportFormat === 'docx' ? '#60A5FA' : 'var(--text-dark-muted)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-dark-primary)', marginBottom: '2px' }}>Word Document</strong>
                      <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>Editable DOCX file</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Content sections */}
              <div>
                <label className="input-label" style={{ marginBottom: '10px' }}>Include Content Sections</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', color: 'var(--text-dark-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" className="custom-checkbox" checked={includeDoc} onChange={(e) => setIncludeDoc(e.target.checked)} />
                    <span>Contract Scanner Text</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '13px', color: 'var(--text-dark-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" className="custom-checkbox" checked={includeDraft} onChange={(e) => setIncludeDraft(e.target.checked)} />
                    <span>Auto-Draft Workspace Text</span>
                  </label>
                </div>
              </div>

              {/* Cross-Save Module Panel */}
              <div>
                <label className="input-label" style={{ marginBottom: '10px' }}>Cross-Save Target Workspace</label>
                <p style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', marginBottom: '12px', lineHeight: '1.45' }}>Select modules to make this document natively available inside those workspaces.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {[
                    { id: 'case-vault',         label: 'Case Vault',         icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> },
                    { id: 'conflict-engine',    label: 'Conflict Engine',    icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
                    { id: 'virtual-courtroom',  label: 'Virtual Courtroom',  icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> },
                    { id: 'firm-library',       label: 'Firm Library',       icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> },
                    { id: 'contract-analyzer',  label: 'Contract Analyzer',  icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
                  ].map(({ id, label, icon }) => {
                    const isActive = crossSaveTargets.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`module-pill ${isActive ? 'active' : ''}`}
                        onClick={() => setCrossSaveTargets(prev => isActive ? prev.filter(t => t !== id) : [...prev, id])}
                      >
                        <span className="module-pill-dot" />
                        {icon}
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {exportError && (
                <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.08)', color: 'var(--accent-danger)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', fontSize: '12.5px' }}>
                  {exportError}
                </div>
              )}
              {crossSaveStatus && !exporting && (
                <div style={{ padding: '10px 12px', background: 'rgba(16,185,129,0.08)', color: 'var(--accent-success)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '8px', fontSize: '12px' }}>
                  {crossSaveStatus}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', gap: '10px', padding: '14px 22px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-dark-muted)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, transition: 'all 0.15s' }}
                onClick={() => setShowExportModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-accent"
                style={{ flex: 2, padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}
                onClick={executeExport}
                disabled={exporting}
              >
                {exporting ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    Exporting...
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    {crossSaveTargets.length > 0 ? 'Export & Save to Platform' : 'Export & Download'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload/extraction failure toast — surfaces the specific backend
          message (timeout, OCR-required blank scan, corrupt file, etc.)
          instead of the old blocking alert(). */}
      {uploadToast && (
        <div
          style={{
            position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 3000, display: 'flex', alignItems: 'center', gap: '10px',
            padding: '13px 20px', borderRadius: '11px', fontSize: '13.5px', fontWeight: 500,
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5',
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)', maxWidth: '460px',
          }}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{uploadToast.message}</span>
          <button
            onClick={() => setUploadToast(null)}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 'auto', fontSize: '15px', lineHeight: 1, flexShrink: 0 }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

// ── UTILITIES ────────────────────────────────────────────────────────

const getDynamicIntents = (clauseText, riskLevel) => {
  const text = (clauseText || "").toLowerCase();
  const intents = [];

  if (text.includes('liability') || text.includes('penalty') || text.includes('damages') || text.includes('$') || text.includes('rs') || text.includes('inr')) {
    intents.push("Cap total liability to 12 months of fees paid");
    intents.push("Make the financial penalty mutual for both parties");
    intents.push("Exclude indirect, punitive, and consequential damages");
  }
  if (text.includes('terminate') || text.includes('termination') || text.includes('notice')) {
    intents.push("Add a 30-day written notice and cure period before termination");
    intents.push("Ensure termination rights are mutual for both parties");
  }
  if (text.includes('confidential') || text.includes('information')) {
    intents.push("Limit the survival of confidentiality obligations to 3 years");
    intents.push("Exclude publicly known information from confidentiality restrictions");
  }
  if (text.includes('jurisdiction') || text.includes('law') || text.includes('court') || text.includes('dispute') || text.includes('committee')) {
    intents.push("Change governing law to the laws of India");
    intents.push("Mandate neutral arbitration before approaching courts");
  }
  if (text.includes('intellectual') || text.includes('property') || text.includes('ip ')) {
    intents.push("Ensure the Vendor retains pre-existing Intellectual Property rights");
    intents.push("Grant a perpetual, royalty-free license instead of full IP transfer");
  }
  if (text.includes('discretion') || text.includes('withheld') || text.includes('reduce')) {
    intents.push("Require mutual written consent before altering payment terms");
    intents.push("Remove the unilateral right to withhold or reduce payments");
  }

  if (riskLevel === 'RED') {
    intents.push("Remove this clause entirely as it imposes severe disproportionate risk");
    intents.push("Make this clause perfectly mutual and balanced");
  } else {
    intents.push("Clarify the ambiguous terms to prevent future legal disputes");
    intents.push("Align this clause with standard Indian industry practices");
  }

  return [...new Set(intents)].slice(0, 5);
};
