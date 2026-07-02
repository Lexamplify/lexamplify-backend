import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  extractContractText,
  analyzeContractWithGroq,
  rewriteContractClause,
  fetchContractSummary,
  fetchContractRecommendations,
  chatWithContract,
  exportContract,
  fetchDocuments
} from '../services/api';

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
  .rich-text-toolbar {
    background: var(--bg-dark-sidebar);
    border-bottom: 1px solid var(--border-dark-subtle);
    display: flex;
    gap: 2px;
    padding: 6px 12px;
    align-items: center;
    flex-wrap: wrap;
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

  /* ── EDITOR SCROLL ───────────────────────────────────────────────── */
  .editor-scroll-area {
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
    line-height: 1.8 !important;
    white-space: pre-wrap;
    color: var(--text-dark-primary);
    min-height: 65vh !important;
    padding: 40px 48px !important;
    background: var(--bg-dark-card);
    border-radius: 2px;
    box-shadow: 0 2px 20px rgba(0,0,0,0.15);
    box-sizing: border-box;
    border: 1px solid var(--border-dark-subtle);
    letter-spacing: 0.01em;
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
    box-shadow: 0 2px 20px rgba(0,0,0,0.08);
  }
  [data-theme="light"] .scanner-body p,
  [data-theme="light"] .scanner-body span,
  [data-theme="light"] .scanner-body div { color: #1a1a1a; }

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

  /* ── RISK MARK HIGHLIGHTS (document left pane) ───────────────────── */
  .risk-mark {
    display: inline;
    cursor: pointer;
    padding: 2px 0;
    padding-left: 7px;
    line-height: 1.5;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    border-radius: 3px;
    transition: background-color 0.2s ease-in-out;
  }
  .risk-mark.red-mark {
    background-color: rgba(239,68,68,0.12);
    color: #FCA5A5;
    border-left: 3px solid rgba(239,68,68,0.65);
  }
  .risk-mark.amber-mark {
    background-color: rgba(245,158,11,0.12);
    color: #FCD34D;
    border-left: 3px solid rgba(245,158,11,0.65);
  }
  .risk-mark.red-mark:hover   { background-color: rgba(239,68,68,0.22); }
  .risk-mark.amber-mark:hover { background-color: rgba(245,158,11,0.22); }

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

  /* ── DOCUMENT EXTRACTION SKELETON ────────────────────────────────── */
  .doc-skeleton {
    background: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 16px;
    padding: 32px 36px;
  }
  .doc-skeleton__head {
    display: flex; align-items: center; gap: 12px;
    padding-bottom: 20px; margin-bottom: 24px;
    border-bottom: 1px solid var(--border-dark-subtle);
  }
  .doc-skeleton__badge {
    width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
    background: linear-gradient(90deg, var(--bg-dark-card) 25%, var(--bg-dark-panel) 50%, var(--bg-dark-card) 75%);
    background-size: 200% 100%;
    animation: shimmer-animation 1.4s infinite;
  }
  .doc-skel-line {
    height: 12px; border-radius: 6px; margin-bottom: 14px;
    background: linear-gradient(90deg, var(--bg-dark-card) 25%, var(--bg-dark-panel) 50%, var(--bg-dark-card) 75%);
    background-size: 200% 100%;
    animation: shimmer-animation 1.4s infinite;
  }
  /* Staggered offsets make the sweep read like line-by-line document parsing */
  .doc-skel-line:nth-child(6n+1) { animation-delay: 0s;    }
  .doc-skel-line:nth-child(6n+2) { animation-delay: .12s;  }
  .doc-skel-line:nth-child(6n+3) { animation-delay: .24s;  }
  .doc-skel-line:nth-child(6n+4) { animation-delay: .36s;  }
  .doc-skel-line:nth-child(6n+5) { animation-delay: .48s;  }
  .doc-skel-line:nth-child(6n)   { animation-delay: .60s;  }

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
    border: 1px solid var(--border-dark-subtle) !important;
    border-radius: 8px !important;
    padding: 10px 12px !important;
    color: var(--text-dark-primary) !important;
    font-family: var(--font-sans);
    font-size: 13.5px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    transition: all 0.3s ease !important;
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
    color: #DC2626 !important; text-decoration: line-through !important;
    background: #FEE2E2 !important; padding: 1px 4px !important;
    border-radius: 3px !important; margin-right: 3px !important; display: inline !important;
  }
  .revised-ins {
    color: #16A34A !important; background: #D1FAE5 !important;
    padding: 1px 4px !important; border-radius: 3px !important;
    font-weight: 500 !important; display: inline !important;
  }
  .newly-revised-ins {
    color: #16A34A !important; padding: 1px 4px !important;
    border-radius: 3px !important; font-weight: 500 !important; display: inline !important;
    animation: fadeHighlightIns 1.5s ease-in-out forwards;
  }

  @keyframes fadeHighlightIns {
    0%   { background: #FEF08A !important; opacity: 0; }
    10%  { opacity: 1; }
    100% { background: #D1FAE5 !important; }
  }
  @keyframes fadeHighlightBlockquote {
    0%   { background: #FEF08A !important; opacity: 0; }
    10%  { opacity: 1; }
    100% { background: #F3F4F6 !important; }
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
  const [isAnalyzed, setIsAnalyzed] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scanStrategy, setScanStrategy] = useState('Defensive');
  const [rawText, setRawText] = useState('');
  const [clauses, setClauses] = useState([]);
  const [summary, setSummary] = useState('');

  // Tab states
  const [activeTab, setActiveTab] = useState('risks');
  const [leftTab, setLeftTab] = useState('scanner');

  // Tab opacity fade-in transition state
  const [tabOpacity, setTabOpacity] = useState('opacity-100');

  // Document editor states
  const [editorHtml, setEditorHtml] = useState('');
  const [activeClauseId, setActiveClauseId] = useState(null);

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
  const [selectedDocId, setSelectedDocId] = useState('');
  const [autoDraftPrompt, setAutoDraftPrompt] = useState('');
  const [autoDraftText, setAutoDraftText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');

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

  // Guards sessionStorage persistence until after initial rehydration
  const hydratedRef = useRef(false);

  const fileInputRef = useRef(null);
  const ruleBookFileInputRef = useRef(null);
  const editorRef = useRef(null);
  const suggestionsRef = useRef(null);
  const chatStreamRef = useRef(null);

  const location = useLocation();

  // Auto-ingest document piped from Case Vault (or InzIQ tool-routing)
  useEffect(() => {
    const incoming = location.state?.documentData;
    if (!incoming?.file_content) return;
    const content = cleanExtractedText(incoming.file_content);
    setRawText(content);
    (async () => {
      setIsAnalyzing(true);
      const res = await analyzeContractWithGroq(content, '', scanStrategy);
      setIsAnalyzing(false);
      if (!res.error) loadAnalysisResults(res);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SESSION PERSISTENCE ─────────────────────────────────────────────
  // Rehydrate an in-progress session on mount so navigating away and back
  // does not wipe the analysis. Skips when a document is being piped in.
  useEffect(() => {
    if (!(location.state?.documentData?.file_content)) {
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
    hydratedRef.current = true;
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
      if (!res.error) {
        setVaultDocs(res);
      }
    };
    loadVaultDocs();
  }, []);

  // Update highlighted editor HTML when rawText or clauses change
  useEffect(() => {
    if (isAnalyzed) {
      const html = renderDocumentScanner(rawText, clauses);
      setEditorHtml(html);
    }
  }, [rawText, clauses, isAnalyzed]);

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

  // formatting commands helper for ExecCommand
  const handleFormat = (command) => {
    document.execCommand(command, false, null);
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
    setContractFile(file);
    setContractUploadLoading(true);
    const extracted = await extractContractText(file);
    setContractUploadLoading(false);

    if (extracted.error) {
      alert(extracted.message || 'Failed to extract document text.');
      setContractFile(null);
      return;
    }
    // Populate the contract text and surface the "Ready to Analyze" state.
    setRawText(cleanExtractedText(extracted.text));
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

  const handleTextAnalyze = async (overrideText = null) => {
    const target = (typeof overrideText === 'string' ? overrideText : rawText).trim();
    if (!target) {
      alert('Please paste contract text or select a file to analyze.');
      return;
    }

    setIsAnalyzing(true);
    const res = await analyzeContractWithGroq(target, ruleBookText, scanStrategy);
    setIsAnalyzing(false);

    if (res.error) {
      alert(res.message || 'Analysis failed.');
    } else {
      loadAnalysisResults(res);
    }
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
    setIsAnalyzed(true);
    setActiveClauseId(null);
    setRewrittenText('');
    setIntent('');
    setAppendedClauses([]);
  };

  // Re-run analysis on strategy switch
  const handleStrategyChange = async (newStrategy) => {
    setScanStrategy(newStrategy);
    if (isAnalyzed && rawText) {
      setIsAnalyzing(true);
      const res = await analyzeContractWithGroq(rawText, ruleBookText, newStrategy);
      setIsAnalyzing(false);
      if (!res.error) {
        loadAnalysisResults(res);
      } else {
        alert('Failed to re-analyze contract: ' + res.message);
      }
    }
  };

  // ── 2. EDIT / INSPECT HANDLERS ──────────────────────────────────────
  const inspectRisk = (id) => {
    setActiveClauseId(id);
    switchTab('risks');
    setIntent('');
    const clause = clauses.find(c => c.id === id);
    setRewrittenText(clause?.suggestedRewrite || '');
  };

  const handleEditorClick = (e) => {
    const mark = e.target.closest('mark');
    if (mark && mark.dataset.id) {
      inspectRisk(mark.dataset.id);
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
    setRewriting(false);

    if (!res.error && res.rewritten) {
      const cleanText = res.rewritten.replace(/^"|"$/g, '').trim();
      setRewrittenText(cleanText);
    } else {
      alert(res.message || 'Failed to rewrite clause.');
    }
  };

  // Applies revision by updating clause state (which is then diffed dynamically with transient animation state)
  const applyRevision = () => {
    if (!activeClause || !rewrittenText.trim()) return;

    setClauses(prev => prev.map(c => {
      if (c.id === activeClause.id) {
        return {
          ...c,
          isRevised: true,
          isNewlyRevised: true,
          revisedText: rewrittenText.trim(),
          risk: 'GREEN',
          issue: 'Approved AI Revision.'
        };
      }
      return c;
    }));

    // Clear the visual fade animation class after 1.5s so it runs exactly once
    setTimeout(() => {
      setClauses(prev => prev.map(c => {
        if (c.id === activeClause.id) {
          return { ...c, isNewlyRevised: false };
        }
        return c;
      }));
    }, 1500);

    setActiveClauseId(null);
    setRewrittenText('');
    setIntent('');
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
      alert('Please provide instructions.');
      return;
    }
    if (!selectedDocId) {
      alert('Please select a reference context file.');
      return;
    }

    setDrafting(true);
    setDraftStatus('Synthesizing dynamic context node...');
    setAutoDraftText('');

    try {
      const response = await fetch('/api/documents/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: autoDraftPrompt.trim(), context: selectedDocId })
      });
      const data = await response.json();

      setDrafting(false);
      setDraftStatus('');

      if (response.ok && data.draft) {
        const clean = data.draft.replace(/^"|"$/g, '').trim();
        setAutoDraftText(clean);
        setLeftTab('autodraft');
      } else {
        alert(data.error || 'Failed to synthesize auto-draft clause.');
      }
    } catch (err) {
      setDrafting(false);
      setDraftStatus('');
      alert('Network timeout in AI reasoning engine.');
    }
  };

  // ── 6. RAG CHAT HANDLER ──────────────────────────────────────────────
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
      setExportError(err.message || 'Export request failed.');
    } finally {
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

  // contentEditable editor blur syncing
  const handleEditorBlur = (e) => {
    const editorEl = e.currentTarget;

    // 1. Read updates from del, mark, and ins tags to keep clauses state in sync
    const delElements = editorEl.querySelectorAll('del.revised-del');
    const insElements = editorEl.querySelectorAll('ins.revised-ins, ins.newly-revised-ins');
    const markElements = editorEl.querySelectorAll('mark.risk-mark');

    const delUpdates = {};
    delElements.forEach(del => {
      const id = del.getAttribute('data-id');
      if (id) {
        delUpdates[id] = del.innerText || del.textContent || '';
      }
    });

    const insUpdates = {};
    insElements.forEach(ins => {
      const id = ins.getAttribute('data-id');
      if (id) {
        insUpdates[id] = ins.innerText || ins.textContent || '';
      }
    });

    const markUpdates = {};
    markElements.forEach(mark => {
      const id = mark.getAttribute('data-id');
      if (id) {
        markUpdates[id] = mark.innerText || mark.textContent || '';
      }
    });

    if (Object.keys(delUpdates).length > 0 || Object.keys(insUpdates).length > 0 || Object.keys(markUpdates).length > 0) {
      setClauses(prev => prev.map(c => {
        const updatedClause = { ...c };
        if (delUpdates[c.id] !== undefined) {
          updatedClause.text = delUpdates[c.id];
        }
        if (markUpdates[c.id] !== undefined) {
          updatedClause.text = markUpdates[c.id];
        }
        if (insUpdates[c.id] !== undefined) {
          updatedClause.revisedText = insUpdates[c.id];
        }
        return updatedClause;
      }));
    }

    // 2. Reconstruct rawText and save it
    const rawTextValue = getRawTextFromNode(editorEl);
    setRawText(rawTextValue);
  };

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
                  onClick={() => { setIsAnalyzed(false); setRawText(''); setClauses([]); setSummary(''); setAppendedClauses([]); setActiveClauseId(null); setRewrittenText(''); setSummaryCollapsed(true); }}
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

        {/* ────────── INITIAL UPLOAD / INPUT SCREEN ────────── */}
        {!isAnalyzed ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px' }}>
            <div className="upload-layout-container">

              {isAnalyzing ? (
                /* ── SCANNING STATE ── */
                <div style={{ background: 'var(--bg-dark-panel)', border: '1px solid var(--border-dark-subtle)', borderRadius: '16px', padding: '48px 32px', textAlign: 'center' }}>
                  <div style={{ width: '56px', height: '56px', margin: '0 auto 24px', borderRadius: '50%', border: '3px solid rgba(59,130,246,0.2)', borderTopColor: 'var(--accent-primary)', animation: 'spin 0.9s linear infinite' }}></div>
                  <h3 style={{ fontSize: '16px', color: 'var(--text-dark-primary)', marginBottom: '8px' }}>Scanning contract under Indian Law…</h3>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)', marginBottom: '28px' }}>Compiling vector node · identifying liability clauses · matching precedents</p>
                  <div style={{ maxWidth: '400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div className="shimmer-bar"></div>
                    <div className="shimmer-bar" style={{ width: '80%' }}></div>
                    <div className="shimmer-bar" style={{ width: '60%' }}></div>
                  </div>
                  <p style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', marginTop: '20px', opacity: 0.6 }}>Dense PDFs can take up to 20 seconds</p>
                </div>
              ) : contractUploadLoading ? (
                /* ── TEXT EXTRACTION STATE — layout-wide document skeleton ── */
                <div className="doc-skeleton">
                  <div className="doc-skeleton__head">
                    <div className="doc-skeleton__badge" />
                    <div style={{ flex: 1 }}>
                      <div className="doc-skel-line" style={{ width: '45%', height: '15px', marginBottom: '9px' }} />
                      <div className="doc-skel-line" style={{ width: '28%', marginBottom: 0 }} />
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent-primary)', animation: 'branding-pulse 1s infinite alternate' }} />
                      Reading document…
                    </span>
                  </div>
                  {['96%', '88%', '92%', '70%', '84%', '90%', '60%', '94%', '78%', '86%', '52%', '91%'].map((w, i) => (
                    <div key={i} className="doc-skel-line" style={{ width: w }} />
                  ))}
                </div>
              ) : (
                <>
                  {/* ── HERO ── */}
                  <div className="upload-hero">
                    <div className="upload-icon-ring">⚖️</div>
                    <h2 style={{ fontSize: '20px', color: 'var(--text-dark-primary)', margin: '0 0 6px', fontFamily: 'var(--font-serif)' }}>Senior Counsel Workspace</h2>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)', margin: 0, lineHeight: 1.5 }}>
                      Upload or paste a contract on the left. Optionally define your firm's non-negotiable rules on the right to enforce them as absolute overrides during analysis.
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
                      {(
                        <div
                          className="drag-drop-zone transition-all duration-300 ease-in-out"
                          onClick={() => fileInputRef.current?.click()}
                          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                          onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); }}
                          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); handleFileUpload(e.dataTransfer.files); }}
                        >
                          <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={(e) => handleFileUpload(e.target.files)} accept=".pdf,.docx" />
                          {contractFile ? (
                            <>
                              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '10px' }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                              <h3 style={{ fontSize: '13px', color: '#34D399', marginBottom: '4px' }}>{contractFile.name}</h3>
                              <p style={{ fontSize: '11.5px', color: 'var(--text-dark-muted)', marginBottom: '8px' }}>Ready to analyze — click to replace</p>
                              <span style={{ fontSize: '11px', color: 'rgba(52,211,153,0.85)', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)', padding: '3px 10px', borderRadius: '10px' }}>Press “Start Contract Risk Scan” below</span>
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
                      )}

                      {/* Contract divider */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
                        <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-dark-subtle)' }} />
                        <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>or paste text</span>
                        <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-dark-subtle)' }} />
                      </div>

                      <textarea
                        className="input-textarea"
                        placeholder="Paste the raw text of your contract here…"
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        style={{ marginBottom: 0 }}
                      />
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

                  {/* ── ANALYZE BAR ── */}
                  <div className="upload-analyze-bar">
                    <button
                      className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg"
                      onClick={handleTextAnalyze}
                      style={{ width: '100%', padding: '13px', fontSize: '14px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                      Start Contract Risk Scan
                    </button>
                    {ruleBookText.trim() && (
                      <p style={{ margin: '10px 0 0', textAlign: 'center', fontSize: '11.5px', color: 'rgba(167,139,250,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#8B5CF6', display: 'inline-block' }} />
                        Rule Book active — {ruleBookText.trim().length} chars of directives will be enforced
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (

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
                    📝 Contract Text
                  </button>
                  <button
                    className={`editor-tab-btn transition-all duration-300 ease-in-out hover:bg-gray-700 ${leftTab === 'autodraft' ? 'active' : ''}`}
                    onClick={() => setLeftTab('autodraft')}
                  >
                    🤖 Auto-Draft
                  </button>
                </div>

                {leftTab === 'scanner' && (
                  <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>
                    Editable Workspace. Click highlights to inspect risks.
                  </span>
                )}
              </div>

              {/* Rich-Text Formatting Toolbar */}
              {leftTab === 'scanner' && (
                <div className="rich-text-toolbar">
                  {/* Undo */}
                  <button onMouseDown={e => e.preventDefault()} onClick={() => handleFormat('undo')} title="Undo" className="toolbar-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
                  </button>
                  {/* Redo */}
                  <button onMouseDown={e => e.preventDefault()} onClick={() => handleFormat('redo')} title="Redo" className="toolbar-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></svg>
                  </button>
                  <div className="toolbar-divider"></div>
                  {/* Bold */}
                  <button onMouseDown={e => e.preventDefault()} onClick={() => handleFormat('bold')} title="Bold" className="toolbar-btn" style={{ fontWeight: '800', fontSize: '14px' }}>B</button>
                  {/* Italic */}
                  <button onMouseDown={e => e.preventDefault()} onClick={() => handleFormat('italic')} title="Italic" className="toolbar-btn" style={{ fontStyle: 'italic', fontSize: '14px' }}>I</button>
                  {/* Underline */}
                  <button onMouseDown={e => e.preventDefault()} onClick={() => handleFormat('underline')} title="Underline" className="toolbar-btn" style={{ textDecoration: 'underline', fontSize: '14px' }}>U</button>
                  <div className="toolbar-divider"></div>
                  {/* Align Left */}
                  <button onMouseDown={e => e.preventDefault()} onClick={() => handleFormat('justifyLeft')} title="Align Left" className="toolbar-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" /></svg>
                  </button>
                  {/* Align Center */}
                  <button onMouseDown={e => e.preventDefault()} onClick={() => handleFormat('justifyCenter')} title="Align Center" className="toolbar-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="6" y1="12" x2="18" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>
                  </button>
                  {/* Align Right */}
                  <button onMouseDown={e => e.preventDefault()} onClick={() => handleFormat('justifyRight')} title="Align Right" className="toolbar-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="9" y1="12" x2="21" y2="12" /><line x1="6" y1="18" x2="21" y2="18" /></svg>
                  </button>
                  {/* Justify */}
                  <button onMouseDown={e => e.preventDefault()} onClick={() => handleFormat('justifyFull')} title="Justify" className="toolbar-btn">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                  </button>
                </div>
              )}

              <div className="editor-scroll-area">
                {leftTab === 'scanner' ? (
                  <>
                    <div
                      ref={editorRef}
                      className="scanner-body"
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={handleEditorBlur}
                      onClick={handleEditorClick}
                      dangerouslySetInnerHTML={{ __html: editorHtml }}
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
                ) : (
                  <div>
                    {autoDraftText ? (
                      <div
                        style={{ fontFamily: 'var(--font-serif)', fontSize: '18px', lineHeight: '1.625', whiteSpace: 'pre-wrap', color: '#1F2937', minHeight: '70vh', padding: '40px', backgroundColor: '#ffffff', borderRadius: '4px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => setAutoDraftText(e.target.innerText)}
                      >
                        {autoDraftText}
                      </div>
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
                  Citations {matchedPrecedents.length > 0 && <span style={{ marginLeft: '5px', background: 'rgba(15,15,20,0.7)', border: '1px solid rgba(255,255,255,0.08)', color: '#93C5FD', borderRadius: '6px', padding: '1px 6px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.02em' }}>{matchedPrecedents.length}</span>}
                </button>
              </div>

              <div className={`analysis-panel-body transition-opacity duration-300 ${tabOpacity}`}>

                {/* SUB TAB: Risks (Actions) */}
                {activeTab === 'risks' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>

                    {activeClause ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* Back to list */}
                        <button
                          onClick={() => { setActiveClauseId(null); setRewrittenText(''); setIntent(''); }}
                          style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '12px', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
                          All clauses
                        </button>
                        <div className="inspected-risk-card">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                            <span className={`risk-indicator-dot ${activeClause.risk === 'RED' ? 'red' : 'amber'}`}></span>
                            <h3 style={{ fontSize: '14px', color: 'white', margin: 0, fontWeight: '600' }}>
                              {activeClause.clauseTitle || (activeClause.risk === 'RED' ? 'High Risk Clause' : 'Medium Risk Clause')}
                            </h3>
                            {activeClause.isRuleBookViolation && (
                              <span className="rulebook-badge">⚡ Rule Book Override</span>
                            )}
                          </div>

                          <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>ORIGINAL TEXT:</span>
                          <div className="original-clause-box">{activeClause.text}</div>
                        </div>

                        <div style={{ padding: '12px 14px', background: 'rgba(239, 68, 68, 0.05)', borderLeft: '3px solid var(--accent-danger)', fontSize: '13px', color: 'white', lineHeight: '1.4', borderRadius: '4px' }}>
                          <strong>Indian Legal Issue:</strong> {activeClause.issue}
                        </div>

                        {/* Intent Input & Autocomplete */}
                        <div style={{ position: 'relative' }}>
                          <label className="input-label">Drafting Revision Intent</label>
                          <input
                            type="text"
                            placeholder="E.g., Make this notice mutual, cap penalty..."
                            className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            value={intent}
                            onChange={(e) => { setIntent(e.target.value); setShowSuggestions(true); }}
                            onFocus={() => setShowSuggestions(true)}
                          />

                          {showSuggestions && dynamicIntents.length > 0 && (
                            <div className="autocomplete-dropdown" ref={suggestionsRef}>
                              {dynamicIntents.map((item, idx) => (
                                <div
                                  key={idx}
                                  className="autocomplete-item"
                                  onClick={() => { setIntent(item); setShowSuggestions(false); }}
                                >
                                  💡 {item}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <button
                          className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg"
                          onClick={handleRewrite}
                          disabled={rewriting}
                          style={{ width: '100%', padding: '12px' }}
                        >
                          {rewriting ? 'Generating Revision...' : 'Rewrite Clause with AI'}
                        </button>

                        {/* Rule Book attribution — shows the exact rule that triggered the flag */}
                        {activeClause.isRuleBookViolation && activeClause.ruleBookReference && (
                          <div style={{ padding: '11px 14px', background: 'rgba(139, 92, 246, 0.08)', border: '1px solid rgba(139, 92, 246, 0.3)', borderLeft: '3px solid #8B5CF6', borderRadius: '6px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#A78BFA', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              ⚖️ Rule Enforced
                            </span>
                            <span style={{ fontSize: '12.5px', color: 'var(--text-dark-primary)', lineHeight: 1.5, fontStyle: 'italic' }}>
                              “{activeClause.ruleBookReference}”
                            </span>
                          </div>
                        )}

                        {/* Rewrite suggested container */}
                        {rewrittenText && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} style={{ display: 'flex', flexDirection: 'column' }}>
                            <div>
                              <label className="input-label">AI Suggested Revision</label>
                              <textarea
                                className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                                style={{ height: '100px', width: '100%', boxSizing: 'border-box', border: '1px solid var(--accent-success)', color: 'white', resize: 'none' }}
                                value={rewrittenText}
                                onChange={(e) => setRewrittenText(e.target.value)}
                              />
                            </div>
                            <button
                              className="btn-accent transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:shadow-lg"
                              onClick={applyRevision}
                              style={{ width: '100%', padding: '12px', background: 'var(--accent-success)' }}
                            >
                              Apply Rewrite to Document
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* ── CLAUSE LIST OVERVIEW ── */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {clauses.filter(c => c.risk === 'RED' || c.risk === 'AMBER').length === 0 ? (
                          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                            No flagged clauses found.
                          </div>
                        ) : (
                          <>
                            <div style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                              {clauses.filter(c => c.risk === 'RED' || c.risk === 'AMBER').length} flagged clauses — click to inspect & rewrite
                            </div>
                            {clauses.filter(c => c.risk === 'RED' || c.risk === 'AMBER').map((c, idx) => (
                              <div
                                key={c.id}
                                className={`clause-list-item ${c.risk === 'RED' ? 'red-item' : 'amber-item'}`}
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
                {activeTab === 'draft' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} style={{ display: 'flex', flexDirection: 'column' }}>
                    <form onSubmit={handleAutoDraft}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div className="input-group">
                          <label className="input-label">Reference Context File *</label>
                          <div className="custom-select-wrapper">
                            <select
                              className="bg-gray-800 border-gray-600 text-white rounded-lg p-3 focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all duration-300 ease-in-out"
                              style={{ width: '100%' }}
                              required
                              value={selectedDocId}
                              onChange={(e) => setSelectedDocId(e.target.value)}
                            >
                              <option value="">Select Reference File</option>
                              {vaultDocs.map(doc => (
                                <option key={doc.id} value={doc.id}>{doc.filename}</option>
                              ))}
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
                )}

                {/* SUB TAB: Chat */}
                {activeTab === 'chat' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} style={{ display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontSize: '15px', color: 'white', margin: 0 }}>Landmark Indian Contract Precedents</h3>

                    {matchedPrecedents.length === 0 ? (
                      <div style={{ padding: '20px', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px', color: 'var(--text-dark-muted)', fontStyle: 'italic', fontSize: '13px', textAlign: 'center' }}>
                        No keyword matches. Write or paste clauses regarding liability limits, notice, or IP to trigger citations.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} style={{ display: 'flex', flexDirection: 'column', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
                        {matchedPrecedents.map((prec, i) => (
                          <div key={i} className="precedent-card" style={{ marginBottom: 0 }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <span>⚖️</span>
                              <div>
                                <a href={prec.url} target="_blank" rel="noopener noreferrer" className="precedent-link">
                                  {prec.title}
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                </a>
                                <p style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)', marginTop: '4px', lineHeight: '1.4' }}>{prec.desc}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>

          </div>
        )}

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
    </>
  );
}

// ── UTILITIES ────────────────────────────────────────────────────────
const renderDocumentScanner = (rawText, clauses) => {
  if (!rawText) return '';
  const riskClauses = clauses.filter(c => c.risk === 'RED' || c.risk === 'AMBER' || c.isRevised);
  const sortedClauses = [...riskClauses].sort((a, b) => b.text.length - a.text.length);

  const ranges = [];
  sortedClauses.forEach(c => {
    const trimmed = c.text.trim();
    if (!trimmed) return;

    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flexible = escaped.replace(/\s+/g, '[\\s]+');
    try {
      const regex = new RegExp(flexible);
      const match = regex.exec(rawText);
      if (match) {
        const start = match.index;
        const end = match.index + match[0].length;
        if (!ranges.some(r => start < r.end && end > r.start)) {
          ranges.push({ start, end, clause: c });
        }
      }
    } catch (e) {
      // safe fallback
    }
  });

  ranges.sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;
  ranges.forEach(r => {
    const c = r.clause;

    html += escapeHtml(rawText.slice(cursor, r.start));

    if (c.isRevised) {
      const animationClass = c.isNewlyRevised ? 'newly-revised-ins' : 'revised-ins';
      html += `<del class="revised-del" data-id="${c.id}">${escapeHtml(rawText.slice(r.start, r.end))}</del><ins class="${animationClass}" data-id="${c.id}">${escapeHtml(c.revisedText)}</ins>`;
    } else {
      const markClass = c.risk === 'RED' ? 'red-mark' : 'amber-mark';
      html += `<mark id="clause-left-${c.id}" data-id="${c.id}" class="risk-mark ${markClass}">${escapeHtml(rawText.slice(r.start, r.end))}</mark>`;
    }

    cursor = r.end;
  });

  html += escapeHtml(rawText.slice(cursor));
  html = html.replace(/\n\n/g, '</p><p style="margin-bottom: 15px;">').replace(/\n/g, '<br>');
  return `<p style="margin-bottom: 15px;">${html}</p>`;
};

const escapeHtml = (str) => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const getRawTextFromNode = (node) => {
  if (!node) return '';
  let text = '';
  const traverse = (n) => {
    if (n.nodeType === 3) { // TEXT_NODE
      text += n.nodeValue;
    } else if (n.nodeType === 1) { // ELEMENT_NODE
      const tagName = n.tagName.toLowerCase();
      if (tagName === 'ins') {
        // Ignore inserted text in rawText
        return;
      }
      if (tagName === 'br') {
        text += '\n';
        return;
      }

      const isBlock = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName);

      n.childNodes.forEach(child => traverse(child));

      if (tagName === 'p') {
        text += '\n\n';
      } else if (isBlock && tagName !== 'div') {
        text += '\n';
      }
    }
  };
  node.childNodes.forEach(child => traverse(child));
  return text.replace(/\n\n+$/g, '\n\n').trim();
};

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
