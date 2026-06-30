import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadDocument, fetchTrackedCases, saveTrackedCase, fetchCauselist } from '../services/api';
import { SEED_ENTRIES as FL_SEED } from './FirmLibrary';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

// Reconstruct full breadcrumb path from any folderId using the flat folder list
const buildPathFromId = (folderId, flat) => {
  const path = [];
  let id = folderId;
  const seen = new Set();
  while (id != null && !seen.has(id)) {
    seen.add(id);
    const f = flat.find(n => n.id === id);
    if (!f) break;
    path.unshift({ id: f.id, name: f.name });
    id = f.parent_id;
  }
  return path;
};

const vaultStyles = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes spin {
    0%   { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .animate-fade-in { animation: fadeIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards; }

  /* ── Folder Cards ── */
  .vault-folder-card {
    background: rgba(59,130,246,0.04);
    border: 1px solid rgba(59,130,246,0.15);
    border-radius: 9px; padding: 14px 16px;
    display: flex; align-items: center; gap: 12px;
    cursor: pointer; transition: all 0.18s; min-width: 0;
  }
  .vault-folder-card:hover {
    background: rgba(59,130,246,0.1);
    border-color: rgba(59,130,246,0.38);
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(59,130,246,0.12);
  }
  .vault-folder-icon { font-size: 22px; flex-shrink: 0; line-height: 1; }
  .vault-folder-name { font-size: 13px; font-weight: 600; color: white; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vault-folder-meta { font-size: 10.5px; color: var(--text-dark-muted, #8F9CAE); margin-top: 2px; }

  /* ── Folder 3-dots context menu ── */
  .vault-folder-dots {
    opacity: 0; background: none; border: none; cursor: pointer; line-height: 1;
    color: var(--text-dark-muted, #8F9CAE); font-size: 17px; letter-spacing: 1px;
    padding: 2px 6px; border-radius: 5px; transition: all .12s; flex-shrink: 0; font-family: inherit;
  }
  .vault-folder-card:hover .vault-folder-dots { opacity: 1; }
  .vault-folder-dots:hover { background: rgba(255,255,255,.1); color: white; }
  .vault-folder-menu {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 200;
    background: #1A2030; border: 1px solid rgba(255,255,255,.1);
    border-radius: 8px; padding: 4px; min-width: 156px;
    box-shadow: 0 10px 28px rgba(0,0,0,.55); animation: fadeIn .12s ease;
  }
  .vault-folder-menu-item {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    padding: 7px 10px; background: none; border: none; border-radius: 5px;
    cursor: pointer; font-size: 12.5px; color: #94A3B8; font-family: inherit; transition: all .1s;
  }
  .vault-folder-menu-item:hover { background: rgba(255,255,255,.07); color: white; }
  .vault-folder-menu-danger { color: #F87171; }
  .vault-folder-menu-danger:hover { background: rgba(239,68,68,.1); color: #EF4444; }
  .vault-folder-menu-sep { height: 1px; background: rgba(255,255,255,.07); margin: 4px 0; }
  .vault-rename-input {
    flex: 1; min-width: 0; background: rgba(255,255,255,.06); border: 1px solid rgba(59,130,246,.45);
    border-radius: 5px; padding: 4px 9px; color: white; font-size: 12.5px;
    outline: none; font-family: inherit;
  }
  /* Inline delete confirmation over the folder card */
  .vault-delete-overlay {
    position: absolute; inset: 0; z-index: 10; border-radius: 9px;
    background: rgba(10,12,22,.96); border: 1px solid rgba(239,68,68,.3);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; padding: 12px; text-align: center;
  }
  /* Move folder modal */
  .vault-move-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(3,6,14,.84); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
  }
  .vault-move-panel {
    background: #171c26; border: 1px solid rgba(59,130,246,.22);
    border-radius: 12px; width: 460px; max-width: 96vw; max-height: 72vh;
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 28px 60px rgba(0,0,0,.65);
  }
  .vault-move-header {
    padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,.06);
    display: flex; align-items: center; justify-content: space-between;
  }
  .vault-move-title { font-size: 13px; font-weight: 700; color: #E2E8F0; }
  .vault-move-body { flex: 1; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px; }
  .vault-move-footer { padding: 12px 18px; border-top: 1px solid rgba(255,255,255,.06); display: flex; justify-content: flex-end; gap: 8px; }
  .vault-move-root {
    display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    border-radius: 6px; border: 1px solid rgba(255,255,255,.08); cursor: pointer;
    font-size: 12.5px; color: #7EB3F5; transition: all .12s;
  }
  .vault-move-root:hover, .vault-move-root.selected { background: rgba(59,130,246,.1); border-color: rgba(59,130,246,.3); }
  .vault-move-tree-row {
    display: flex; align-items: center; padding: 6px 8px; border-radius: 5px;
    cursor: pointer; font-size: 12px; color: #64748B; gap: 6px; transition: all .12s;
  }
  .vault-move-tree-row:hover { background: rgba(255,255,255,.04); color: #94A3B8; }
  .vault-move-tree-row.selected { background: rgba(59,130,246,.1); color: #7EB3F5; }
  .vault-move-tree-row.disabled { opacity: .3; cursor: not-allowed; pointer-events: none; }

  /* ── Breadcrumb (always-visible, New Folder action on right) ────────── */
  .vault-breadcrumb {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px 8px 14px; margin-bottom: 16px;
    background: rgba(59,130,246,0.04); border: 1px solid rgba(59,130,246,0.12);
    border-radius: 7px; font-size: 12.5px; gap: 8px;
  }
  .vault-bc-left { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; flex: 1; min-width: 0; }
  .vault-bc-btn {
    background: none; border: none; cursor: pointer; padding: 0;
    color: var(--accent-primary, #3B82F6); font-size: 12.5px; font-family: inherit;
    font-weight: 500; transition: opacity 0.15s;
  }
  .vault-bc-btn:hover { opacity: 0.75; }
  .vault-bc-sep { color: var(--text-dark-muted, #8F9CAE); font-size: 11px; }
  .vault-bc-current { color: white; font-weight: 600; }
  .vault-bc-new-btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 10px; background: rgba(59,130,246,0.1);
    border: 1px solid rgba(59,130,246,0.25); border-radius: 6px;
    color: #93C5FD; font-size: 11.5px; font-weight: 600;
    cursor: pointer; font-family: var(--font-sans); flex-shrink: 0; transition: all 0.15s;
  }
  .vault-bc-new-btn:hover { background: rgba(59,130,246,0.18); border-color: rgba(59,130,246,0.45); color: #BFDBFE; }

  /* ── Folder nav micro-animations ─────────────────────────────────────── */
  @keyframes vault-drill-in {
    from { opacity: 0; transform: translateX(18px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes vault-drill-out {
    from { opacity: 0; transform: translateX(-18px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  .vault-nav-in  { animation: vault-drill-in  0.22s cubic-bezier(0.16,1,0.3,1); }
  .vault-nav-out { animation: vault-drill-out 0.22s cubic-bezier(0.16,1,0.3,1); }

  /* ── Inline folder creation row ──────────────────────────────────────── */
  .vault-new-folder-row {
    display: flex; align-items: center; gap: 8px; padding: 9px 14px;
    background: rgba(59,130,246,0.05); border: 1px solid rgba(59,130,246,0.28);
    border-radius: 8px; margin-bottom: 14px; animation: fadeIn 0.15s ease;
  }
  .vault-new-folder-input {
    flex: 1; background: transparent; border: none; outline: none;
    color: white; font-size: 13.5px; font-family: var(--font-sans);
  }
  .vault-new-folder-input::placeholder { color: rgba(255,255,255,0.22); }
  .vault-nf-ok {
    padding: 5px 12px; background: #3B82F6; border: none; border-radius: 5px;
    color: white; font-size: 12px; font-weight: 600; cursor: pointer;
    font-family: var(--font-sans); transition: background 0.15s; white-space: nowrap;
  }
  .vault-nf-ok:hover { background: #2563EB; }
  .vault-nf-ok:disabled { opacity: 0.45; cursor: not-allowed; }
  .vault-nf-cancel {
    padding: 5px 10px; background: transparent; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 5px; color: #64748B; font-size: 12px; cursor: pointer;
    font-family: var(--font-sans); transition: all 0.15s; white-space: nowrap;
  }
  .vault-nf-cancel:hover { color: #94A3B8; border-color: rgba(255,255,255,0.2); }

  /* ── Document Grid Card ── */
  .vault-grid-card {
    background-color: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 10px; padding: 16px;
    display: flex; flex-direction: column; gap: 12px;
    position: relative; overflow: hidden;
    transition: all 0.22s cubic-bezier(0.4,0,0.2,1);
  }
  .vault-grid-card:hover {
    transform: translateY(-3px);
    border-color: rgba(59,130,246,0.4);
    box-shadow: 0 8px 24px rgba(59,130,246,0.1);
  }
  .vault-card-preview {
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden; text-overflow: ellipsis;
    font-size: 11.5px; line-height: 1.55; color: var(--text-dark-muted, #8F9CAE);
    font-family: monospace; background: rgba(255,255,255,0.015);
    padding: 8px 10px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.04); flex: 1;
  }
  .vault-folder-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; color: #60A5FA;
    background: rgba(59,130,246,0.08); border: 1px solid rgba(59,130,246,0.15);
    padding: 1px 6px; border-radius: 4px; font-weight: 500;
  }

  /* ── Upload Zone ── */
  .drag-drop-zone {
    border: 2px dashed var(--border-dark-subtle, #2C3241);
    background-color: var(--bg-dark-app, #0f131a);
    border-radius: 10px; padding: 28px 20px; text-align: center;
    cursor: pointer; transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;
    margin-bottom: 24px;
  }
  .drag-drop-zone:hover, .drag-drop-zone.dragover {
    border-color: var(--accent-primary, #3B82F6);
    background-color: rgba(59,130,246,0.03);
    box-shadow: 0 0 20px rgba(59,130,246,0.08);
  }

  /* ── Tabs ── */
  .tabs-wrapper {
    display: flex; overflow-x: auto;
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
    margin-bottom: 24px; gap: 4px; padding-bottom: 0;
  }
  .tab-btn {
    background: transparent; border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-dark-muted, #8F9CAE);
    padding: 10px 16px; font-size: 13.5px; font-weight: 500;
    cursor: pointer; white-space: nowrap; transition: all 0.18s;
    margin-bottom: -1px; border-radius: 6px 6px 0 0;
  }
  .tab-btn:hover { color: var(--text-dark-primary, #fff); }
  .tab-btn.active { color: var(--accent-primary, #3B82F6); border-bottom-color: var(--accent-primary, #3B82F6); font-weight: 600; }

  /* ── Panels ── */
  .dashboard-panel { background-color: var(--bg-dark-panel, #171c26); border: 1px solid var(--border-dark-subtle, #2C3241); border-radius: 12px; padding: 24px; }
  .panel-header h2 { font-size: 18px; margin-bottom: 5px; color: white; }
  .panel-header p  { font-size: 13px; color: var(--text-dark-muted, #8F9CAE); margin: 0; }
  .control-row { display: flex; gap: 14px; margin-bottom: 20px; flex-wrap: wrap; align-items: flex-end; }
  .input-group { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 200px; }
  .input-label { font-size: 12px; color: var(--text-dark-muted, #8F9CAE); font-weight: 500; }
  .input-field {
    background-color: var(--bg-dark-app, #0f131a); border: 1px solid var(--border-dark-subtle, #2C3241);
    color: white; border-radius: 7px; padding: 9px 13px; font-family: var(--font-sans);
    font-size: 13.5px; outline: none; transition: border-color 0.2s;
  }
  .input-field:focus { border-color: var(--accent-primary, #3B82F6); }
  .btn-accent {
    background-color: var(--accent-primary, #3B82F6); color: white; border: none; border-radius: 7px;
    padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: background-color 0.2s, transform 0.1s; white-space: nowrap;
  }
  .btn-accent:hover { background-color: #2563EB; }
  .btn-secondary {
    background-color: transparent; color: var(--text-dark-primary, #fff);
    border: 1px solid var(--border-dark-subtle, #2C3241); border-radius: 7px;
    padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: background-color 0.2s; white-space: nowrap;
  }
  .btn-secondary:hover { background-color: rgba(255,255,255,0.05); }

  /* ── Search ── */
  .vault-search-bar {
    display: flex; align-items: center; gap: 10px;
    background: var(--bg-dark-app, #0f131a); border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 8px; padding: 8px 14px; margin-bottom: 18px; transition: border-color 0.2s;
  }
  .vault-search-bar:focus-within { border-color: var(--accent-primary, #3B82F6); }
  .vault-search-input { background: transparent; border: none; outline: none; color: white; font-size: 13.5px; font-family: var(--font-sans); flex: 1; width: 100%; }
  .vault-search-input::placeholder { color: var(--text-dark-muted); }

  /* ── Table ── */
  .responsive-table-container { overflow-x: auto; width: 100%; border-radius: 8px; border: 1px solid var(--border-dark-subtle, #2C3241); }
  .premium-table { width: 100%; border-collapse: collapse; font-size: 13.5px; text-align: left; }
  .premium-table th { background-color: var(--bg-dark-sidebar, #121620); padding: 12px 16px; font-weight: 600; color: var(--text-dark-muted, #8F9CAE); border-bottom: 1px solid var(--border-dark-subtle, #2C3241); }
  .premium-table td { padding: 14px 16px; border-bottom: 1px solid var(--border-dark-subtle, #2C3241); vertical-align: middle; color: white; }
  .premium-table tr:hover td { background-color: rgba(255,255,255,0.02); }

  /* ── Card action buttons ── */
  .vault-card-actions { display: flex; gap: 7px; margin-top: 8px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.04); }
  .vault-btn-view {
    flex: 1; padding: 7px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
    background: var(--accent-primary, #3B82F6); color: white; border: none; cursor: pointer;
    transition: background 0.15s; display: flex; align-items: center; justify-content: center; gap: 5px;
  }
  .vault-btn-view:hover { background: #2563EB; }
  .vault-btn-analyze {
    padding: 7px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
    background: transparent; color: var(--text-dark-muted, #8F9CAE);
    border: 1px solid var(--border-dark-subtle, #2C3241); cursor: pointer;
    transition: all 0.15s; display: flex; align-items: center; gap: 5px;
  }
  .vault-btn-analyze:hover { border-color: rgba(59,130,246,0.4); color: var(--accent-primary, #3B82F6); }
  .vault-card-quick-actions { display: flex; gap: 6px; padding: 0 0 2px; }
  .vault-btn-quick {
    flex: 1; padding: 6px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 600;
    background: rgba(59,130,246,0.06); color: #93C5FD;
    border: 1px solid rgba(59,130,246,0.18); cursor: pointer;
    transition: all 0.15s; display: flex; align-items: center; justify-content: center; gap: 4px;
    font-family: var(--font-sans);
  }
  .vault-btn-quick:hover { background: rgba(59,130,246,0.13); border-color: rgba(59,130,246,0.4); color: #BFDBFE; }

  /* ── Document Card 3-dots context menu ── */
  .vault-doc-dots {
    opacity: 0; background: none; border: none; cursor: pointer; line-height: 1;
    color: var(--text-dark-muted, #8F9CAE); font-size: 16px; letter-spacing: 1.5px;
    padding: 3px 7px; border-radius: 5px; transition: all .12s; flex-shrink: 0;
    font-family: inherit;
  }
  .vault-grid-card:hover .vault-doc-dots { opacity: 1; }
  .vault-doc-dots:hover { background: rgba(255,255,255,.1); color: white; }
  .vault-doc-menu {
    position: absolute; top: calc(100% + 4px); right: 0; z-index: 300;
    background: #1A2030; border: 1px solid rgba(255,255,255,.1);
    border-radius: 8px; padding: 4px; min-width: 175px;
    box-shadow: 0 10px 28px rgba(0,0,0,.55); animation: fadeIn .12s ease;
  }
  .vault-doc-menu-item {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    padding: 7px 10px; background: none; border: none; border-radius: 5px;
    cursor: pointer; font-size: 12.5px; color: #94A3B8; font-family: inherit; transition: all .1s;
  }
  .vault-doc-menu-item:hover { background: rgba(255,255,255,.07); color: white; }
  .vault-doc-menu-danger { color: #F87171; }
  .vault-doc-menu-danger:hover { background: rgba(239,68,68,.1) !important; color: #EF4444 !important; }
  .vault-doc-menu-sep { height: 1px; background: rgba(255,255,255,.07); margin: 4px 0; }

  /* ── Modal ── */
  .modal-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px); }
  .modal-card { background-color: var(--bg-dark-panel, #171c26); border: 1px solid var(--border-dark-subtle, #2C3241); border-radius: 12px; width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
  .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--border-dark-subtle, #2C3241); }
  .modal-body { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  .modal-footer { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--border-dark-subtle, #2C3241); }
  .form-row { display: flex; gap: 16px; }
  .form-row > * { flex: 1; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }

  /* ── Smart Case Intake Modal ────────────────────────────────────────────── */
  .si-modal { max-width: 740px !important; }
  .si-dropzone {
    position: relative; overflow: hidden;
    border: 2px dashed rgba(99,102,241,0.28);
    border-radius: 11px; padding: 22px 20px; text-align: center;
    cursor: pointer; transition: border-color 0.22s, background 0.22s;
    background: rgba(99,102,241,0.025); margin-bottom: 20px;
  }
  .si-dropzone:hover, .si-dropzone.si-dragover {
    border-color: rgba(99,102,241,0.52); background: rgba(99,102,241,0.06);
  }
  .si-dropzone.si-scanning {
    border-color: rgba(99,102,241,0.4); cursor: default; pointer-events: none;
  }
  .si-dropzone.si-done {
    border-color: rgba(16,185,129,0.45); background: rgba(16,185,129,0.04);
    border-style: solid;
  }
  @keyframes si-beam {
    0%   { transform: translateX(-120%); }
    100% { transform: translateX(220%); }
  }
  .si-scan-beam {
    position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(90deg,
      transparent 0%, rgba(99,102,241,0.1) 35%,
      rgba(129,140,248,0.28) 50%,
      rgba(99,102,241,0.1) 65%, transparent 100%
    );
    animation: si-beam 1.3s ease-in-out infinite;
  }
  @keyframes si-pulse-ring {
    0%,100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.4); }
    50%      { box-shadow: 0 0 0 8px rgba(99,102,241,0); }
  }
  .si-scan-icon {
    width: 40px; height: 40px; border-radius: 50%;
    background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.3);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto 10px; animation: si-pulse-ring 1.2s ease-in-out infinite;
  }
  @keyframes si-field-flash {
    0%   { background-color: rgba(245,158,11,0.18); border-color: rgba(245,158,11,0.5); }
    100% { background-color: rgba(245,158,11,0.055); border-color: rgba(245,158,11,0.28); }
  }
  .si-ai-field {
    background-color: rgba(245,158,11,0.055) !important;
    border-color: rgba(245,158,11,0.28) !important;
    animation: si-field-flash 0.55s ease-out;
  }
  .si-ai-badge {
    display: inline-flex; align-items: center; gap: 3px; margin-left: 6px;
    padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 700;
    letter-spacing: 0.4px; text-transform: uppercase;
    background: rgba(245,158,11,0.1); color: #F59E0B;
    border: 1px solid rgba(245,158,11,0.22); vertical-align: middle;
  }
  :root[data-theme="light"] .si-dropzone { background: rgba(99,102,241,0.03); border-color: rgba(99,102,241,0.22); }
  :root[data-theme="light"] .si-ai-field { background-color: rgba(245,158,11,0.05) !important; border-color: rgba(245,158,11,0.35) !important; }

  /* ── Library Injector Drawer ─────────────────────────────────────────────── */
  .lib-overlay {
    position: fixed; inset: 0; z-index: 1200;
    background: rgba(3,6,14,0.6); backdrop-filter: blur(3px);
    animation: fadeIn 0.2s ease;
  }
  .lib-drawer {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 1201;
    width: min(480px, 96vw);
    background: var(--bg-dark-panel, #171c26);
    border-left: 1px solid var(--border-dark-subtle, #2C3241);
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.38s cubic-bezier(0.16,1,0.3,1);
    box-shadow: -24px 0 64px rgba(0,0,0,0.6);
  }
  .lib-drawer.lib-open { transform: translateX(0); }
  .lib-drawer-head {
    padding: 18px 20px 14px; flex-shrink: 0;
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
    display: flex; align-items: flex-start; justify-content: space-between;
    background: rgba(255,255,255,0.015);
  }
  .lib-drawer-title { font-size: 15px; font-weight: 700; color: white; margin: 0 0 3px; }
  .lib-drawer-sub  { font-size: 11.5px; color: var(--text-dark-muted, #8F9CAE); }
  .lib-close-btn {
    background: rgba(255,255,255,0.05); border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 6px; color: var(--text-dark-muted, #8F9CAE); width: 28px; height: 28px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    font-size: 13px; flex-shrink: 0; transition: all 0.15s; font-family: inherit;
  }
  .lib-close-btn:hover { background: rgba(255,255,255,0.1); color: white; }
  .lib-search-row {
    padding: 14px 16px 10px; flex-shrink: 0;
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
  }
  .lib-search-wrap {
    display: flex; align-items: center; gap: 9px;
    background: var(--bg-dark-app, #0f131a);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 7px; padding: 8px 12px; transition: border-color 0.15s;
  }
  .lib-search-wrap:focus-within { border-color: var(--accent-primary, #3B82F6); }
  .lib-search-input {
    background: transparent; border: none; outline: none;
    color: white; font-size: 13px; font-family: var(--font-sans); flex: 1;
  }
  .lib-search-input::placeholder { color: var(--text-dark-muted, #8F9CAE); }
  .lib-list {
    flex: 1; overflow-y: auto; padding: 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .lib-list::-webkit-scrollbar { width: 4px; }
  .lib-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 2px; }
  .lib-item {
    background: var(--bg-dark-app, #0f131a);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 9px; padding: 13px 14px;
    display: flex; flex-direction: column; gap: 7px;
    transition: border-color 0.18s, background 0.18s;
  }
  .lib-item:hover { border-color: rgba(59,130,246,0.28); background: rgba(59,130,246,0.025); }
  .lib-item-top { display: flex; align-items: flex-start; gap: 8px; justify-content: space-between; }
  .lib-item-title { font-size: 13px; font-weight: 600; color: white; line-height: 1.4; flex: 1; min-width: 0; }
  .lib-cat-badge {
    font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px;
    padding: 2px 7px; border-radius: 4px; flex-shrink: 0; white-space: nowrap;
  }
  .lib-item-meta { font-size: 11px; color: var(--text-dark-muted, #8F9CAE); }
  .lib-item-tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .lib-tag {
    font-size: 10px; padding: 2px 6px; border-radius: 4px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
    color: var(--text-dark-muted, #8F9CAE);
  }
  .lib-inject-btn {
    align-self: flex-end; display: inline-flex; align-items: center; gap: 5px;
    padding: 6px 12px; border-radius: 6px; cursor: pointer;
    font-size: 11.5px; font-weight: 700; font-family: var(--font-sans);
    background: rgba(59,130,246,0.1); color: #93C5FD;
    border: 1px solid rgba(59,130,246,0.22); transition: all 0.15s;
  }
  .lib-inject-btn:hover { background: rgba(59,130,246,0.2); border-color: rgba(59,130,246,0.45); color: #BFDBFE; }
  .lib-inject-btn.lib-injected {
    background: rgba(16,185,129,0.1); color: #6EE7B7;
    border-color: rgba(16,185,129,0.28); cursor: default;
  }
  .lib-empty-state {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 10px; padding: 40px; text-align: center;
    color: var(--text-dark-muted, #8F9CAE);
  }
  .lib-inject-toast {
    position: fixed; bottom: 28px; right: 28px; z-index: 9999;
    padding: 13px 18px; border-radius: 10px; max-width: 360px;
    background: #0A1F15; border: 1px solid rgba(16,185,129,0.28); color: #6EE7B7;
    font-size: 12.5px; font-weight: 500; font-family: var(--font-sans);
    box-shadow: 0 10px 36px rgba(0,0,0,0.45); animation: fadeIn 0.22s ease;
    display: flex; align-items: flex-start; gap: 11px; line-height: 1.5;
  }
  .lib-browse-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px; border-radius: 7px; cursor: pointer;
    font-size: 13px; font-weight: 600; font-family: var(--font-sans);
    background: rgba(139,92,246,0.1); color: #C4B5FD;
    border: 1px solid rgba(139,92,246,0.25); transition: all 0.15s; white-space: nowrap;
  }
  .lib-browse-btn:hover { background: rgba(139,92,246,0.18); border-color: rgba(139,92,246,0.45); color: #DDD6FE; }

  /* ── Danger / destructive action button ─────────────────────────────────── */
  .btn-danger {
    background: transparent; color: #F87171;
    border: 1px solid rgba(239,68,68,0.22); border-radius: 7px;
    padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: all 0.2s; white-space: nowrap;
    display: flex; align-items: center; gap: 6px; font-family: var(--font-sans);
  }
  .btn-danger:hover:not(:disabled) { background: rgba(239,68,68,0.07); border-color: rgba(239,68,68,0.42); color: #EF4444; }
  .btn-danger:disabled { opacity: 0.38; cursor: not-allowed; }

  /* ── Matter Blueprint: empty-state hero ─────────────────────────────────── */
  @keyframes bp-glow {
    0%, 100% { opacity: 0.35; transform: scale(1); }
    50%       { opacity: 0.65; transform: scale(1.06); }
  }
  @keyframes bp-cta-pulse {
    0%, 100% { box-shadow: 0 4px 20px rgba(59,130,246,0.32); }
    60%       { box-shadow: 0 4px 32px rgba(59,130,246,0.6), 0 0 0 6px rgba(59,130,246,0.08); }
  }
  .vault-empty-hero {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 420px; border-radius: 14px; padding: 52px 32px 44px; text-align: center;
    background: radial-gradient(ellipse at 50% -10%, rgba(59,130,246,0.09) 0%, transparent 65%),
                linear-gradient(180deg, rgba(23,28,38,1) 0%, rgba(13,17,23,1) 100%);
    border: 1px solid rgba(59,130,246,0.13); position: relative; overflow: hidden;
  }
  .vault-empty-hero::before {
    content: ''; position: absolute; top: -60px; left: 50%; transform: translateX(-50%);
    width: 340px; height: 340px; border-radius: 50%; pointer-events: none;
    background: radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%);
    animation: bp-glow 5s ease-in-out infinite;
  }
  .vault-empty-icon-ring {
    width: 76px; height: 76px; border-radius: 50%; position: relative; z-index: 1;
    background: linear-gradient(135deg, rgba(59,130,246,0.14) 0%, rgba(29,78,216,0.06) 100%);
    border: 1px solid rgba(59,130,246,0.28);
    display: flex; align-items: center; justify-content: center; margin-bottom: 22px;
  }
  .vault-empty-title {
    font-size: 21px; font-weight: 700; color: white; margin-bottom: 9px;
    position: relative; z-index: 1; letter-spacing: -0.3px;
  }
  .vault-empty-sub {
    font-size: 13px; color: #64748B; max-width: 400px;
    line-height: 1.7; margin-bottom: 28px; position: relative; z-index: 1;
  }
  .vault-blueprint-tags {
    display: flex; flex-wrap: wrap; gap: 7px; justify-content: center;
    margin-bottom: 30px; position: relative; z-index: 1; max-width: 520px;
  }
  .vault-blueprint-tag {
    font-size: 11.5px; color: #475569;
    background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06);
    padding: 4px 11px; border-radius: 20px; font-weight: 500;
  }
  .vault-btn-blueprint-hero {
    position: relative; z-index: 1;
    display: inline-flex; align-items: center; gap: 9px;
    padding: 14px 30px; border-radius: 10px; border: none; cursor: pointer;
    font-size: 14px; font-weight: 700; color: white; font-family: var(--font-sans);
    background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%);
    animation: bp-cta-pulse 2.8s ease-in-out infinite; transition: all 0.2s;
  }
  .vault-btn-blueprint-hero:hover:not(:disabled) {
    transform: translateY(-2px);
    background: linear-gradient(135deg, #60A5FA 0%, #2563EB 100%);
    animation: none; box-shadow: 0 10px 32px rgba(59,130,246,0.55);
  }
  .vault-btn-blueprint-hero:disabled { opacity: 0.65; cursor: not-allowed; animation: none; }
  .vault-empty-secondary {
    display: flex; gap: 14px; margin-top: 18px; position: relative; z-index: 1; align-items: center;
  }
  .vault-empty-link {
    background: none; border: none; color: #334155; font-size: 12px; cursor: pointer;
    font-family: var(--font-sans); text-decoration: underline; text-underline-offset: 2px; transition: color 0.15s;
  }
  .vault-empty-link:hover { color: #64748B; }
  .vault-empty-sep { color: #1E293B; font-size: 11px; }

  /* ── Blueprint inline button (breadcrumb / header) ────────────────────── */
  .vault-btn-blueprint-inline {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 11px; border-radius: 6px; cursor: pointer;
    font-size: 11.5px; font-weight: 600; font-family: var(--font-sans);
    color: #7EB3F5; background: rgba(59,130,246,0.07);
    border: 1px solid rgba(59,130,246,0.18); transition: all 0.15s; white-space: nowrap;
  }
  .vault-btn-blueprint-inline:hover:not(:disabled) {
    background: rgba(59,130,246,0.14); border-color: rgba(59,130,246,0.38); color: #BAD6FF;
  }
  .vault-btn-blueprint-inline:disabled { opacity: 0.45; cursor: not-allowed; }

  /* ── Blueprint shimmer skeleton rows ──────────────────────────────────── */
  @keyframes shimmer {
    0%   { background-position: -600px 0; }
    100% { background-position:  600px 0; }
  }
  .vault-shimmer-row {
    height: 58px; border-radius: 9px; margin-bottom: 9px;
    background: linear-gradient(90deg,
      rgba(255,255,255,0.018) 25%,
      rgba(59,130,246,0.055) 50%,
      rgba(255,255,255,0.018) 75%);
    background-size: 1200px 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }

  /* ── Blueprint toast notification ─────────────────────────────────────── */
  .vault-toast {
    position: fixed; bottom: 28px; right: 28px; z-index: 9999;
    padding: 13px 18px; border-radius: 10px; max-width: 360px;
    font-size: 12.5px; font-weight: 500; font-family: var(--font-sans);
    box-shadow: 0 10px 36px rgba(0,0,0,0.45); animation: fadeIn 0.22s ease;
    display: flex; align-items: flex-start; gap: 11px; line-height: 1.5;
  }
  .vault-toast-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
  .vault-toast-success { background: #0A1F15; border: 1px solid rgba(16,185,129,0.28); color: #6EE7B7; }
  .vault-toast-partial { background: #1E1608; border: 1px solid rgba(245,158,11,0.28); color: #FCD34D; }
  .vault-toast-error   { background: #1A0A0A; border: 1px solid rgba(239,68,68,0.28);  color: #FCA5A5; }
  .vault-toast-title   { font-weight: 700; margin-bottom: 2px; }
  .vault-toast-body    { font-size: 11.5px; opacity: 0.8; }

  /* ── Slide-Over Document Canvas ─────────────────────────────────────────── */
  .soc-backdrop {
    position: fixed; inset: 0; z-index: 1500;
    background: rgba(3,6,14,0.72); backdrop-filter: blur(4px);
    opacity: 0; pointer-events: none;
    transition: opacity 0.3s cubic-bezier(0.16,1,0.3,1);
  }
  .soc-backdrop.soc-open { opacity: 1; pointer-events: auto; }
  .soc-panel {
    position: fixed; top: 0; right: 0; bottom: 0; z-index: 1501;
    width: min(700px, 96vw);
    background: #0E1420;
    border-left: 1px solid rgba(59,130,246,0.2);
    display: flex; flex-direction: column;
    transform: translateX(100%);
    transition: transform 0.38s cubic-bezier(0.16,1,0.3,1);
    box-shadow: -40px 0 96px rgba(0,0,0,0.75);
  }
  .soc-panel.soc-open { transform: translateX(0); }
  .soc-header {
    padding: 18px 22px 15px; flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.012);
    display: flex; flex-direction: column; gap: 11px;
  }
  .soc-header-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .soc-title {
    font-size: 15.5px; font-weight: 700; color: #F1F5F9; letter-spacing: -0.2px;
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .soc-close {
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
    border-radius: 7px; color: #64748B; width: 30px; height: 30px; flex-shrink: 0;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    font-size: 14px; transition: all 0.15s; font-family: inherit;
  }
  .soc-close:hover { background: rgba(255,255,255,0.1); color: #CBD5E1; border-color: rgba(255,255,255,0.18); }
  .soc-meta { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
  .soc-body {
    flex: 1; overflow-y: auto; padding: 28px 28px 24px;
  }
  .soc-body::-webkit-scrollbar { width: 5px; }
  .soc-body::-webkit-scrollbar-track { background: transparent; }
  .soc-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.07); border-radius: 3px; }
  .soc-content p {
    margin: 0 0 1.2em; font-size: 13.5px; line-height: 1.82;
    color: #94A3B8; font-family: var(--font-sans);
  }
  .soc-content p:first-child { margin-top: 0; }
  .soc-content p:empty { display: none; }
  .soc-footer-actions {
    padding: 13px 20px; border-top: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
    display: flex; gap: 8px; background: rgba(255,255,255,0.01);
  }

  /* ── Library drawer — search hint ──────────────────────────────────────── */
  .dc-search-hint {
    font-size: 11.5px; font-weight: 400; margin: 8px 2px 0;
    color: var(--text-secondary, #94A3B8);
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    line-height: 1.5;
  }

  /* ── Library drawer — RAG intelligence dossier ──────────────────────────── */
  @keyframes rag-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.42; } }
  .lib-rag-loading {
    display: flex; align-items: center; gap: 9px;
    padding: 13px 14px; border-radius: 9px;
    background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.18);
    font-size: 12px; color: #A78BFA;
    animation: rag-pulse 1.2s ease-in-out infinite;
    margin-bottom: 4px;
  }
  .lib-rag-dossier {
    background: rgba(99,102,241,0.055); border: 1px solid rgba(99,102,241,0.2);
    border-radius: 11px; padding: 15px; margin-bottom: 4px;
    display: flex; flex-direction: column; gap: 12px;
    animation: fadeIn 0.2s ease;
  }
  .lib-rag-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .lib-rag-brain-badge {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 3px 9px; border-radius: 4px;
    background: rgba(99,102,241,0.15); color: #A78BFA; border: 1px solid rgba(99,102,241,0.28);
  }
  .lib-rag-reliability { display: flex; align-items: center; gap: 7px; }
  .lib-rag-reliability-bar {
    width: 64px; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden;
  }
  .lib-rag-reliability-fill { height: 100%; border-radius: 2px; transition: width 0.7s cubic-bezier(0.16,1,0.3,1); }
  .lib-rag-reliability-label { font-size: 10.5px; font-weight: 700; }
  .lib-rag-synthesis {
    font-size: 12.5px; line-height: 1.72; color: var(--text-secondary, #E2E8F0); font-weight: 500;
    display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;
  }
  .lib-rag-section-label {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--text-muted, #94A3B8); margin-bottom: 6px;
  }
  .lib-rag-citations { display: flex; flex-direction: column; gap: 5px; }
  .lib-rag-citation {
    font-size: 11.5px; padding: 8px 10px; border-radius: 6px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09);
    color: var(--text-secondary, #E2E8F0);
  }
  .lib-rag-citation strong { color: #7EB3F5; display: block; margin-bottom: 2px; font-size: 12px; font-weight: 600; }
  .lib-rag-warnings { display: flex; flex-direction: column; gap: 5px; }
  .lib-rag-warning {
    font-size: 11px; color: #FBBF24; font-weight: 500; display: flex; align-items: flex-start; gap: 6px;
    padding: 6px 9px; border-radius: 5px;
    background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); line-height: 1.5;
  }
  .lib-rag-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 4px 0 8px; }
  .lib-rag-local-label {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--text-muted, #94A3B8); padding: 0 2px 6px;
  }
  .lib-rag-actions { display: flex; gap: 8px; padding-top: 4px; }
  .lib-rag-action-btn {
    flex: 1; padding: 8px 12px; border-radius: 7px; font-size: 11.5px; font-weight: 600;
    cursor: pointer; border: 1px solid; transition: all 0.15s; font-family: var(--font-sans);
    display: flex; align-items: center; justify-content: center; gap: 5px;
  }
  .lib-rag-action-btn.copy {
    background: rgba(59,130,246,0.08); color: #7EB3F5; border-color: rgba(59,130,246,0.25);
  }
  .lib-rag-action-btn.copy:hover { background: rgba(59,130,246,0.16); border-color: rgba(59,130,246,0.45); }
  .lib-rag-action-btn.inject {
    background: rgba(99,102,241,0.1); color: #A78BFA; border-color: rgba(99,102,241,0.28);
  }
  .lib-rag-action-btn.inject:hover { background: rgba(99,102,241,0.18); border-color: rgba(99,102,241,0.5); }
  .lib-rag-action-btn.done { color: #34D399; border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.07); }
`;

const DOC_TYPE_STYLES = {
  'Legal Document': { bg: 'rgba(59,130,246,0.1)', color: '#3B82F6' },
  'Contract': { bg: 'rgba(16,185,129,0.1)', color: '#10B981' },
  'FIR': { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' },
  'Petition': { bg: 'rgba(245,158,11,0.1)', color: '#F59E0B' },
  'Draft': { bg: 'rgba(139,92,246,0.1)', color: '#8B5CF6' },
  'Agreement': { bg: 'rgba(6,182,212,0.1)', color: '#06B6D4' },
  'Judgment': { bg: 'rgba(236,72,153,0.1)', color: '#EC4899' },
  'Non-Disclosure Agreement': { bg: 'rgba(99,102,241,0.1)', color: '#818CF8' },
  'Courtroom Simulation': { bg: 'rgba(239,68,68,0.07)', color: '#FCA5A5' },
};

function getDocTypeStyle(type) {
  if (!type) return DOC_TYPE_STYLES['Draft'];
  const key = Object.keys(DOC_TYPE_STYLES).find(k => type.toLowerCase().includes(k.toLowerCase()));
  return DOC_TYPE_STYLES[key] || { bg: 'rgba(59,130,246,0.08)', color: '#3B82F6' };
}

function formatDate(str) {
  if (!str) return '—';
  try { return new Date(str).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return str; }
}

// ─── Matter Blueprint Taxonomy ───────────────────────────────────────────────
// 5-folder court-ready litigation workspace with auto-injected Firm Library templates.
// templateIds map to SEED_ENTRIES ids in FirmLibrary.jsx.
const MATTER_BLUEPRINT_FOLDERS = [
  { name: '01 - Pleadings & Drafts',   icon: '📝', templateIds: [1, 3] },
  { name: '02 - Court Filings',         icon: '⚖️', templateIds: [2, 5] },
  { name: '03 - Evidence & Exhibits',   icon: '🗂️', templateIds: []     },
  { name: '04 - Correspondence',        icon: '✉️', templateIds: []     },
  { name: '05 - Research & Precedents', icon: '🔬', templateIds: [6, 8] },
];

// ─── Breadcrumb Component ────────────────────────────────────────────────────
function Breadcrumb({ folderPath, onNavigateToRoot, onNavigateTo, onNewFolder, onBlueprint, isInitializing, showBlueprintBtn }) {
  return (
    <div className="vault-breadcrumb">
      <div className="vault-bc-left">
        <button className="vault-bc-btn" onClick={onNavigateToRoot}>
          📂 Case Vault
        </button>
        {folderPath.map((crumb, i) => (
          <React.Fragment key={crumb.id}>
            <span className="vault-bc-sep">›</span>
            {i === folderPath.length - 1 ? (
              <span className="vault-bc-current">{crumb.name}</span>
            ) : (
              <button className="vault-bc-btn" onClick={() => onNavigateTo(i)}>
                {crumb.name}
              </button>
            )}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
        {showBlueprintBtn && (
          <button className="vault-btn-blueprint-inline" onClick={onBlueprint} disabled={isInitializing}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            {isInitializing ? 'Initializing…' : '⚡ Blueprint'}
          </button>
        )}
        <button className="vault-bc-new-btn" onClick={onNewFolder}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Folder
        </button>
      </div>
    </div>
  );
}

// ─── Folder Move Modal ───────────────────────────────────────────────────────
function FolderMoveModal({ movingFolder, allFolders, onConfirm, onClose }) {
  const [selectedParentId, setSelectedParentId] = useState(movingFolder.parent_id ?? null);

  // All descendants of movingFolder (can't move into self or child)
  const getDescendants = (id) => {
    const children = allFolders.filter(f => f.parent_id === id).map(f => f.id);
    return children.reduce((acc, cid) => [...acc, cid, ...getDescendants(cid)], []);
  };
  const forbidden = new Set([movingFolder.id, ...getDescendants(movingFolder.id)]);

  const renderTree = (parentId, depth) =>
    allFolders.filter(f => (parentId === null ? !f.parent_id : f.parent_id === parentId)).map(f => (
      <React.Fragment key={f.id}>
        <div
          className={`vault-move-tree-row${selectedParentId === f.id ? ' selected' : ''}${forbidden.has(f.id) ? ' disabled' : ''}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          onClick={() => !forbidden.has(f.id) && setSelectedParentId(f.id)}
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          {f.name}
        </div>
        {renderTree(f.id, depth + 1)}
      </React.Fragment>
    ));

  return (
    <div className="vault-move-overlay" onClick={onClose}>
      <div className="vault-move-panel" onClick={e => e.stopPropagation()}>
        <div className="vault-move-header">
          <span className="vault-move-title">Move "{movingFolder.name}" to…</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>×</button>
        </div>
        <div className="vault-move-body">
          <div
            className={`vault-move-root${selectedParentId === null ? ' selected' : ''}`}
            onClick={() => setSelectedParentId(null)}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Root (Case Vault)
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 260 }}>
            {renderTree(null, 0)}
          </div>
        </div>
        <div className="vault-move-footer">
          <button
            onClick={onClose}
            style={{ padding: '7px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,.1)', borderRadius: 6, color: '#475569', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
          >Cancel</button>
          <button
            onClick={() => onConfirm(selectedParentId)}
            style={{ padding: '7px 16px', background: '#3B82F6', border: 'none', borderRadius: 6, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >Move Here</button>
        </div>
      </div>
    </div>
  );
}

// ─── Folder Card Component ───────────────────────────────────────────────────
function FolderCard({ folder, docCount, subFolderCount, onClick, onRename, onDelete, onMove, isRenaming, renameValue, onRenameChange, onRenameSubmit, onRenameCancel, showDeleteConfirm, onDeleteConfirm, onDeleteCancel }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  if (showDeleteConfirm) {
    return (
      <div className="vault-folder-card" style={{ position: 'relative', minHeight: 72 }}>
        <div className="vault-delete-overlay">
          <div style={{ fontSize: 11.5, color: '#FCA5A5', fontWeight: 600 }}>Delete "{folder.name}"?</div>
          <div style={{ fontSize: 10.5, color: '#64748B', lineHeight: 1.4 }}>All files and sub-folders will be permanently removed.</div>
          <div style={{ display: 'flex', gap: 7 }}>
            <button onClick={onDeleteCancel} style={{ padding: '4px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,.12)', borderRadius: 5, color: '#64748B', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={onDeleteConfirm} style={{ padding: '4px 12px', background: '#EF4444', border: 'none', borderRadius: 5, color: 'white', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
          </div>
        </div>
      </div>
    );
  }

  if (isRenaming) {
    return (
      <div className="vault-folder-card" onClick={e => e.stopPropagation()} style={{ gap: 10 }}>
        <span className="vault-folder-icon">📁</span>
        <input
          className="vault-rename-input"
          value={renameValue}
          onChange={e => onRenameChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel(); }}
          onBlur={onRenameSubmit}
          autoFocus
          onClick={e => e.stopPropagation()}
        />
      </div>
    );
  }

  return (
    <div className="vault-folder-card" onClick={onClick} style={{ position: 'relative' }}>
      <span className="vault-folder-icon">📁</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="vault-folder-name">{folder.name}</div>
        <div className="vault-folder-meta">
          {docCount} doc{docCount !== 1 ? 's' : ''}
          {subFolderCount > 0 && ` · ${subFolderCount} folder${subFolderCount !== 1 ? 's' : ''}`}
        </div>
      </div>
      <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          className="vault-folder-dots"
          title="Folder options"
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
        >⋮</button>
        {menuOpen && (
          <div className="vault-folder-menu">
            <button className="vault-folder-menu-item" onClick={e => { e.stopPropagation(); setMenuOpen(false); onRename(); }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              Rename
            </button>
            <button className="vault-folder-menu-item" onClick={e => { e.stopPropagation(); setMenuOpen(false); onMove(); }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              Move to…
            </button>
            <div className="vault-folder-menu-sep" />
            <button className="vault-folder-menu-item vault-folder-menu-danger" onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function VaultView({ targetFolderId = null }) {
  const [activeTab, setActiveTab] = useState('vault');

  // Document Vault
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docError, setDocError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef(null);

  // Document card context menu
  const [openMenuDocId, setOpenMenuDocId] = useState(null);
  const docMenuRef = useRef(null);

  // Folder navigation
  const [folders, setFolders] = useState([]);   // flat list from API
  const [currentFolderId, setCurrentFolderId] = useState(null);  // null = root
  const [folderPath, setFolderPath] = useState([]);    // [{id, name}]

  // Folder creation (inline)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Nav animation (drill-in / drill-out)
  const [navKey, setNavKey] = useState(0);
  const [navDir, setNavDir] = useState(''); // 'in' | 'out' | ''

  // Folder management (rename / move / delete)
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingFolderId, setDeletingFolderId] = useState(null);
  const [movingFolder, setMovingFolder] = useState(null); // { id, name, parent_id }

  // Matter Blueprint engine
  const [isInitializing, setIsInitializing] = useState(false);
  const [blueprintToast, setBlueprintToast] = useState(null); // { type: 'success'|'partial'|'error', failed: string[] }

  // Case Tracker
  const [cases, setCases] = useState([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const [fetchCnr, setFetchCnr] = useState('');
  const [fetchingStatus, setFetchingStatus] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState('');

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [savingCase, setSavingCase] = useState(false);
  const [formData, setFormData] = useState({
    case_name: '', case_number: '', cnr_number: '', court: '', judge_name: '',
    case_type: '', petitioner_name: '', respondent_name: '',
    petitioner_counsel: '', respondent_counsel: '',
    client_name: '', filing_date: '', next_hearing: '', last_hearing: '',
    status: 'Active', summary: '', notes: '',
  });

  // Smart Intake extraction
  const [extractionState, setExtractionState] = useState('idle'); // idle | scanning | populating | done
  const [aiFilledFields, setAiFilledFields] = useState(new Set());
  const [modalDropOver, setModalDropOver] = useState(false);
  const intakeFileRef = useRef(null);

  // Library Injector Drawer
  const [isLibraryDrawerOpen, setIsLibraryDrawerOpen] = useState(false);
  const [libSearch, setLibSearch]                     = useState('');
  const [libEntries, setLibEntries]                   = useState([]);
  const [injectedIds, setInjectedIds]                 = useState(new Set());
  const [injectToast, setInjectToast]                 = useState(null);

  // Slide-Over Document Canvas
  const [canvasDoc, setCanvasDoc]                     = useState(null);

  // Library drawer — Dual-Brain RAG
  const [libRagResult, setLibRagResult]               = useState(null);
  const [libRagLoading, setLibRagLoading]             = useState(false);
  const [ragCopied, setRagCopied]                     = useState(false);

  const navigate = useNavigate();

  // ── Load documents ────────────────────────────────────────────────────────
  const loadDocuments = async () => {
    setLoadingDocs(true);
    setDocError(null);
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const res = await fetch(`${API_BASE}/api/vault/documents`, {
        headers: { ...(token && { Authorization: `Bearer ${token}` }) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch (err) {
      setDocError(err.message || 'Failed to fetch vault documents.');
    } finally {
      setLoadingDocs(false);
    }
  };

  // ── Load folders ──────────────────────────────────────────────────────────
  const loadFolders = async () => {
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('lexai_token');
      const res = await fetch(`${API_BASE}/api/vault/folders`, {
        headers: { ...(token && { Authorization: `Bearer ${token}` }) },
      });
      if (!res.ok) return;
      const data = await res.json();
      setFolders(data.flat || []);
    } catch (_) { }
  };

  // ── Folder management API calls ───────────────────────────────────────────
  const apiToken = () => localStorage.getItem('token') || localStorage.getItem('lexai_token');

  const handleRenameFolder = async (folderId, newName) => {
    const trimmed = (newName || '').trim();
    setRenamingFolderId(null);
    if (!trimmed) return;
    const token = apiToken();
    const res = await fetch(`${API_BASE}/api/vault/folders/${folderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: trimmed } : f));
    }
  };

  const handleDeleteFolder = async (folderId) => {
    setDeletingFolderId(null);
    const token = apiToken();
    const res = await fetch(`${API_BASE}/api/vault/folders/${folderId}`, {
      method: 'DELETE',
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    });
    if (res.ok) {
      const getAllDesc = (id) => {
        const kids = folders.filter(f => f.parent_id === id).map(f => f.id);
        return kids.reduce((acc, cid) => [...acc, cid, ...getAllDesc(cid)], []);
      };
      const gone = new Set([folderId, ...getAllDesc(folderId)]);
      setFolders(prev => prev.filter(f => !gone.has(f.id)));
      if (gone.has(currentFolderId)) { setCurrentFolderId(null); setFolderPath([]); }
      loadDocuments(); // some docs may have been deleted
    }
  };

  const handleMoveFolder = async (folderId, newParentId) => {
    setMovingFolder(null);
    if (newParentId === folderId) return; // sanity
    const token = apiToken();
    const res = await fetch(`${API_BASE}/api/vault/folders/${folderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ parent_id: newParentId }),
    });
    if (res.ok) {
      setFolders(prev => prev.map(f => f.id === folderId ? { ...f, parent_id: newParentId } : f));
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const token = apiToken();
      const res = await fetch(`${API_BASE}/api/vault/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ name: trimmed, parent_id: currentFolderId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.message || 'Failed to create folder.');
      setFolders(prev => [...prev, { id: data.id, name: data.name, parent_id: data.parent_id ?? null }]);
      setNewFolderName('');
      setIsCreatingFolder(false);
    } catch (err) {
      alert(err.message || 'Failed to create folder.');
    } finally {
      setCreatingFolder(false);
    }
  };

  // ── Combined refresh (documents + folders) ────────────────────────────────
  const loadCurrentView = () => Promise.all([loadDocuments(), loadFolders()]);

  // ── Matter Blueprint: create numbered litigation folders + auto-inject templates ──
  // Creates folders via API concurrently with a 1200ms minimum UX delay, then
  // injects relevant Firm Library templates as synthetic docs into each folder.
  // State updates are optimistic — no server refetch needed after success.
  const handleInitializeBlueprint = async () => {
    if (isInitializing) return;
    setIsInitializing(true);
    setBlueprintToast(null);
    const token = apiToken();

    // Load firm library entries (localStorage or seed fallback)
    const allLibEntries = (() => {
      try {
        const raw = localStorage.getItem('lexai_firm_library');
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : FL_SEED;
      } catch { return FL_SEED; }
    })();

    // Fire folder creation + 1200ms minimum delay in parallel
    const [results] = await Promise.all([
      Promise.allSettled(
        MATTER_BLUEPRINT_FOLDERS.map(folder =>
          fetch(`${API_BASE}/api/vault/folders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
            body: JSON.stringify({ name: folder.name, parent_id: currentFolderId }),
          }).then(async res => {
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.message || `Failed: ${folder.name}`);
            return { id: data.id, name: folder.name, parent_id: data.parent_id ?? null };
          })
        )
      ),
      new Promise(resolve => setTimeout(resolve, 1200)),
    ]);

    const succeeded = results
      .map((r, i) => r.status === 'fulfilled'
        ? { ...r.value, templateIds: MATTER_BLUEPRINT_FOLDERS[i].templateIds }
        : null)
      .filter(Boolean);
    const failed = results
      .map((r, i) => r.status === 'rejected' ? MATTER_BLUEPRINT_FOLDERS[i].name : null)
      .filter(Boolean);

    let totalTemplates = 0;

    if (succeeded.length > 0) {
      // Persist folders to state
      setFolders(prev => [...prev, ...succeeded.map(({ id, name, parent_id }) => ({ id, name, parent_id }))]);

      // Build synthetic template docs for each succeeded folder
      const syntheticDocs = [];
      const newInjectedIds = new Set(injectedIds);
      const now = new Date().toISOString();

      for (const folder of succeeded) {
        for (const tplId of (folder.templateIds || [])) {
          const entry = allLibEntries.find(e => e.id === tplId);
          if (!entry) continue;
          syntheticDocs.push({
            id: `bp_${folder.id}_${tplId}`,
            title: entry.title,
            smart_title: entry.title,
            doc_type: entry.category,
            content: `[FIRM LIBRARY — ${entry.category}]\n\nTitle: ${entry.title}\nAuthor: ${entry.author || 'Firm Library'}\nLast Updated: ${entry.updated || ''}\n\n${entry.description || ''}`,
            created_at: now,
            folder_id: folder.id,
            tags: entry.tags || [],
          });
          newInjectedIds.add(tplId);
        }
      }

      if (syntheticDocs.length > 0) {
        setDocuments(prev => [...syntheticDocs, ...prev]);
        setInjectedIds(newInjectedIds);
        totalTemplates = syntheticDocs.length;
      }
    }

    if (failed.length === 0) {
      setBlueprintToast({ type: 'success', failed: [], foldersCreated: succeeded.length, templatesInjected: totalTemplates });
    } else if (succeeded.length > 0) {
      setBlueprintToast({ type: 'partial', failed, foldersCreated: succeeded.length, templatesInjected: totalTemplates });
    } else {
      setBlueprintToast({ type: 'error', failed, foldersCreated: 0, templatesInjected: 0 });
    }

    setIsInitializing(false);
    setTimeout(() => setBlueprintToast(null), 7000);
  };

  // ── Clear Workspace: bulk-delete all folders in current directory ─────────
  // Strategy: Promise.allSettled() — existing backend recursive_delete handles
  // full subtree per folder. Partial failure is accepted: succeeded IDs are pruned
  // from local state, failed ones remain. loadCurrentView() then re-syncs from server.
  const handleClearWorkspace = async () => {
    if (currentSubFolders.length === 0) return;
    const count = currentSubFolders.length;
    const loc = folderPath.length > 0
      ? `"${folderPath[folderPath.length - 1].name}"`
      : 'this directory';
    if (!window.confirm(
      `Delete all ${count} folder${count !== 1 ? 's' : ''} in ${loc}?\n\n` +
      `All subfolders and documents inside them will be permanently removed.\n\nThis cannot be undone.`
    )) return;
    setIsInitializing(true);
    const token = apiToken();
    const results = await Promise.allSettled(
      currentSubFolders.map(f =>
        fetch(`${API_BASE}/api/vault/folders/${f.id}`, {
          method: 'DELETE',
          headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        })
      )
    );
    const deletedIds = new Set(
      results.map((r, i) => r.status === 'fulfilled' ? currentSubFolders[i].id : null).filter(Boolean)
    );
    const getAllDesc = (id) => {
      const kids = folders.filter(f => f.parent_id === id).map(f => f.id);
      return kids.reduce((acc, cid) => [...acc, cid, ...getAllDesc(cid)], []);
    };
    const allGone = new Set([...deletedIds, ...[...deletedIds].flatMap(id => getAllDesc(id))]);
    setFolders(prev => prev.filter(f => !allGone.has(f.id)));
    await loadCurrentView();
    setIsInitializing(false);
  };

  const loadCases = async () => {
    setLoadingCases(true);
    const res = await fetchTrackedCases();
    if (!res.error) setCases(res);
    setLoadingCases(false);
  };

  useEffect(() => {
    if (activeTab === 'vault') { loadDocuments(); loadFolders(); }
    if (activeTab === 'tracker') loadCases();
  }, [activeTab]);

  // ── Deep-link: navigate to a specific folder when targetFolderId is provided ──
  // Track by value so a new folderId triggers re-navigation, but the same one doesn't loop
  const appliedFolderRef = useRef(null);
  useEffect(() => {
    if (!targetFolderId || !folders.length) return;
    if (appliedFolderRef.current === targetFolderId) return;
    const path = buildPathFromId(targetFolderId, folders);
    if (path.length) {
      setCurrentFolderId(targetFolderId);
      setFolderPath(path);
      setActiveTab('vault');
      appliedFolderRef.current = targetFolderId;
    }
  }, [targetFolderId, folders]);

  // ── Library drawer: load entries from localStorage (or seed fallback) ────────
  useEffect(() => {
    if (!isLibraryDrawerOpen) return;
    try {
      const raw = localStorage.getItem('lexai_firm_library');
      const parsed = raw ? JSON.parse(raw) : null;
      setLibEntries(Array.isArray(parsed) && parsed.length > 0 ? parsed : FL_SEED);
    } catch {
      setLibEntries(FL_SEED);
    }
    setLibSearch('');
    setLibRagResult(null);
    setLibRagLoading(false);
  }, [isLibraryDrawerOpen]);

  // ── Library drawer: debounced Dual-Brain RAG query (400ms) ───────────────
  useEffect(() => {
    if (libSearch.trim().length < 3) {
      setLibRagResult(null);
      setLibRagLoading(false);
      return;
    }
    setLibRagLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('http://localhost:8001/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: libSearch.trim() }),
        });
        if (!res.ok) throw new Error('RAG unavailable');
        const data = await res.json();
        setLibRagResult(data);
      } catch {
        setLibRagResult(null);
      } finally {
        setLibRagLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [libSearch]);

  // ── Folder navigation ─────────────────────────────────────────────────────
  const navigateToFolder = (folder) => {
    setNavDir('in');
    setNavKey(k => k + 1);
    setCurrentFolderId(folder.id);
    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }]);
    setSearchTerm('');
    setIsCreatingFolder(false);
  };

  const navigateToRoot = () => {
    setNavDir('out');
    setNavKey(k => k + 1);
    setCurrentFolderId(null);
    setFolderPath([]);
    setSearchTerm('');
    setIsCreatingFolder(false);
  };

  const navigateToBreadcrumb = (index) => {
    const crumb = folderPath[index];
    setNavDir('out');
    setNavKey(k => k + 1);
    setCurrentFolderId(crumb.id);
    setFolderPath(prev => prev.slice(0, index + 1));
    setSearchTerm('');
    setIsCreatingFolder(false);
  };

  // ── Derived: current view ─────────────────────────────────────────────────
  const isSearching = searchTerm.trim().length > 0;

  const filteredDocs = useMemo(() => {
    if (!searchTerm.trim()) return documents;
    const term = searchTerm.toLowerCase();
    return documents.filter(d =>
      (d.title || '').toLowerCase().includes(term) ||
      (d.doc_type || '').toLowerCase().includes(term) ||
      (d.content || '').toLowerCase().includes(term)
    );
  }, [documents, searchTerm]);

  // Folders visible in current directory
  const currentSubFolders = useMemo(() => {
    if (isSearching) return [];
    return folders.filter(f =>
      currentFolderId === null ? !f.parent_id : f.parent_id === currentFolderId
    );
  }, [folders, currentFolderId, isSearching]);

  // Documents visible in current directory (or all when searching)
  const currentDocs = useMemo(() => {
    if (isSearching) return filteredDocs;
    return filteredDocs.filter(d =>
      currentFolderId === null
        ? !d.folder_id                    // root: docs without a folder
        : d.folder_id === currentFolderId // inside folder: matching docs
    );
  }, [filteredDocs, currentFolderId, isSearching]);

  // Per-folder doc & subfolder counts (for folder card display)
  const docCountByFolderId = useMemo(() => {
    const m = {};
    documents.forEach(d => {
      const key = d.folder_id ?? null;
      m[key] = (m[key] || 0) + 1;
    });
    return m;
  }, [documents]);

  const subFolderCountById = useMemo(() => {
    const m = {};
    folders.forEach(f => {
      if (f.parent_id != null) m[f.parent_id] = (m[f.parent_id] || 0) + 1;
    });
    return m;
  }, [folders]);

  // ── Library search filter ────────────────────────────────────────────────
  const filteredLibEntries = useMemo(() => {
    if (!libSearch.trim()) return libEntries;
    const term = libSearch.toLowerCase();
    return libEntries.filter(e =>
      (e.title || '').toLowerCase().includes(term) ||
      (e.category || '').toLowerCase().includes(term) ||
      (e.author || '').toLowerCase().includes(term) ||
      (e.tags || []).some(t => t.toLowerCase().includes(term))
    );
  }, [libEntries, libSearch]);

  // ── Inject library entry as a local document ─────────────────────────────
  const handleInjectEntry = (entry) => {
    const syntheticDoc = {
      id: `lib_${Date.now()}_${entry.id}`,
      title: entry.title,
      smart_title: entry.title,
      doc_type: entry.category,
      content: `[FIRM LIBRARY — ${entry.category}]\n\nTitle: ${entry.title}\nAuthor: ${entry.author || 'Firm Library'}\nLast Updated: ${entry.updated || ''}\n\n${entry.description || ''}`,
      created_at: new Date().toISOString(),
      folder_id: currentFolderId,
      tags: entry.tags || [],
    };
    setDocuments(prev => [syntheticDoc, ...prev]);
    setInjectedIds(prev => new Set([...prev, entry.id]));
    setInjectToast(entry.title);
    setTimeout(() => setInjectToast(null), 3200);
  };

  // Resolve folder name for document cards (when searching across folders)
  const getFolderName = (folderId) => {
    if (!folderId) return null;
    return (folders.find(f => f.id === folderId) || {}).name || null;
  };

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    let file = null;
    if (e.dataTransfer?.files?.length > 0) { file = e.dataTransfer.files[0]; e.dataTransfer.clearData(); }
    else if (e.target?.files?.length > 0) { file = e.target.files[0]; }
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) { alert('Invalid format. Upload PDF, DOCX, or TXT.'); return; }
    setUploading(true);
    const res = await uploadDocument(file, null, 'DMS Upload');
    setUploading(false);
    if (res.error) alert(res.message || 'Upload failed.');
    else loadDocuments();
  };

  // ── Document actions ──────────────────────────────────────────────────────
  const buildDocData = (doc) => ({
    id: doc.id,
    filename: doc.smart_title || doc.title || 'Vault Document',
    summary: doc.doc_type ? `${doc.doc_type} — saved from InzIQ` : 'Document from Case Vault',
    text: doc.content || '',
    tags: doc.tags || null,
    case_id: doc.case_id || null,
  });

  const handleViewDocument = (doc) => {
    setCanvasDoc(doc);
  };

  const handleAnalyzeDocument = (doc) => {
    navigate('/analyzer', {
      state: { documentData: { file_content: doc.content || '', document_reference: doc.smart_title || doc.title || 'Vault Document' } },
    });
  };

  const handleSummarize = (doc) => {
    navigate(`/case/vault/doc/${doc.id}`, {
      state: {
        fromVault: true, docData: buildDocData(doc),
        autoQuery: 'Provide a comprehensive legal summary of this document, covering all key legal points, obligations, parties involved, and important clauses.',
      },
    });
  };

  const handleExtractFacts = (doc) => {
    navigate(`/case/vault/doc/${doc.id}`, {
      state: {
        fromVault: true, docData: buildDocData(doc),
        autoQuery: 'Extract all key facts, dates, parties, legal citations, and obligations from this document. Present them in a structured numbered list.',
      },
    });
  };

  // ── Doc card menu close-on-outside-click ─────────────────────────────────
  useEffect(() => {
    if (!openMenuDocId) return;
    const close = (e) => { if (!docMenuRef.current?.contains(e.target)) setOpenMenuDocId(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenuDocId]);

  // ── SlideOverCanvas: Escape to close + body scroll lock ──────────────────
  useEffect(() => {
    document.body.style.overflow = canvasDoc ? 'hidden' : '';
    if (!canvasDoc) return;
    const handler = (e) => { if (e.key === 'Escape') setCanvasDoc(null); };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [canvasDoc]);

  // ── Document card actions ─────────────────────────────────────────────────
  const handleDeleteDocument = async (doc) => {
    setOpenMenuDocId(null);
    if (!window.confirm(`Permanently delete "${doc.smart_title || doc.title}"? This cannot be undone.`)) return;
    const token = apiToken();
    const res = await fetch(`${API_BASE}/api/vault/documents/${doc.id}`, {
      method: 'DELETE',
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    });
    if (res.ok) setDocuments(prev => prev.filter(d => d.id !== doc.id));
  };

  const handleDownloadDocument = (doc) => {
    setOpenMenuDocId(null);
    const content = doc.content || '';
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(doc.smart_title || doc.title || 'document').replace(/[^a-z0-9_\-. ]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── CNR fetch ─────────────────────────────────────────────────────────────
  const handleFetchStatus = async () => {
    if (!fetchCnr.trim()) return;
    setFetchingStatus(true);
    setFallbackUrl('');
    const res = await fetchCauselist(fetchCnr.trim());
    setFetchingStatus(false);
    if (res.error) { alert(res.message || 'Failed.'); }
    else if (res.source === 'fallback') { setFallbackUrl(res.fallback_url); }
    else {
      setFormData(p => ({
        ...p, case_name: res.case_title || '', case_number: res.case_number || '',
        cnr_number: fetchCnr.trim(), court: res.court || '',
        next_hearing: res.next_hearing || '', status: res.status || 'Active',
      }));
      setIsModalOpen(true);
    }
  };

  const EMPTY_FORM = {
    case_name: '', case_number: '', cnr_number: '', court: '', judge_name: '',
    case_type: '', petitioner_name: '', respondent_name: '',
    petitioner_counsel: '', respondent_counsel: '',
    client_name: '', filing_date: '', next_hearing: '', last_hearing: '',
    status: 'Active', summary: '', notes: '',
  };

  const handleModalSave = async (e) => {
    e.preventDefault();
    if (!formData.case_name.trim()) { alert('Case Name is required.'); return; }
    setSavingCase(true);
    const res = await saveTrackedCase(formData);
    setSavingCase(false);
    if (res.error) { alert(res.message || 'Failed to save.'); }
    else {
      setIsModalOpen(false);
      setFormData(EMPTY_FORM);
      setAiFilledFields(new Set());
      setExtractionState('idle');
      loadCases();
    }
  };

  // ── Stagger-fill form fields with extracted data ───────────────────────────
  const animateFill = (extracted) => {
    const fieldMap = [
      ['case_name',          extracted.case_name],
      ['case_number',        extracted.case_number],
      ['court',              extracted.court_name || extracted.court],
      ['judge_name',         extracted.judge_name],
      ['case_type',          extracted.case_type],
      ['petitioner_name',    extracted.petitioner_name],
      ['respondent_name',    extracted.respondent_name],
      ['petitioner_counsel', extracted.petitioner_counsel],
      ['respondent_counsel', extracted.respondent_counsel],
      ['filing_date',        extracted.filing_date],
      ['next_hearing',       extracted.next_hearing],
      ['summary',            extracted.summary],
    ].filter(([, v]) => v && String(v).trim());

    setExtractionState('populating');
    fieldMap.forEach(([key, value], idx) => {
      setTimeout(() => {
        setFormData(prev => ({ ...prev, [key]: value }));
        setAiFilledFields(prev => new Set([...prev, key]));
        if (idx === fieldMap.length - 1) {
          setTimeout(() => setExtractionState('done'), 250);
        }
      }, 200 + idx * 155);
    });
  };

  // ── Handle file drop on modal intake zone ─────────────────────────────────
  const handleIntakeFileDrop = async (file) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) {
      alert('Please drop a PDF, DOCX, or TXT legal document.');
      return;
    }
    setExtractionState('scanning');
    setAiFilledFields(new Set());
    try {
      // Upload file to backend to extract text
      const uploadRes = await uploadDocument(file, null, 'Case Intake');
      const docId = uploadRes?.document?.id;
      let docContent = uploadRes?.document?.content || '';

      // If content not in upload response, fetch the document
      if (!docContent && docId) {
        const token = apiToken();
        const fetchRes = await fetch(`${API_BASE}/api/vault/documents`, {
          headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        });
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          const doc = (data.documents || []).find(d => d.id === docId);
          docContent = doc?.content || '';
        }
      }

      if (!docContent) throw new Error('Could not extract document text.');

      // Ask AI to extract case metadata as JSON
      const token = apiToken();
      const aiRes = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({
          message: `You are a legal data extraction AI. Extract case metadata from the legal document below. Return ONLY a valid JSON object with exactly these keys (empty string if not found, no extra text, no markdown):\n{"case_name":"","case_number":"","court_name":"","judge_name":"","case_type":"","petitioner_name":"","respondent_name":"","petitioner_counsel":"","respondent_counsel":"","filing_date":"","next_hearing":"","summary":""}\n\nDocument text:\n${docContent.slice(0, 14000)}`,
        }),
      });
      const aiData = await aiRes.json();
      const raw = (aiData.response || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      const extracted = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      animateFill(extracted);
    } catch {
      setExtractionState('idle');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      <style>{vaultStyles}</style>

      {/* Header */}
      <div style={{ marginBottom: '22px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: '700', marginBottom: '5px' }}>Case Management</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13.5px', margin: 0 }}>
            Unified dashboard for your document vault and tracked caseload.
          </p>
        </div>
        {activeTab === 'vault' && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {currentSubFolders.length > 0 && !isInitializing && (
              <button
                className="btn-danger"
                onClick={handleClearWorkspace}
                title={`Delete all ${currentSubFolders.length} folder${currentSubFolders.length !== 1 ? 's' : ''} in current directory`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                Clear Workspace
              </button>
            )}
            <button
              className="btn-secondary"
              onClick={() => { setIsCreatingFolder(true); setNewFolderName(''); }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
              </svg>
              New Folder
            </button>
            <button className="lib-browse-btn" onClick={() => setIsLibraryDrawerOpen(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              Browse Firm Library
            </button>
            <button className="btn-accent" onClick={() => fileInputRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Upload Document
            </button>
          </div>
        )}
        {activeTab === 'tracker' && (
          <button className="btn-accent" onClick={() => setIsModalOpen(true)}>+ Add Case</button>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs-wrapper">
        <button className={`tab-btn ${activeTab === 'vault' ? 'active' : ''}`} onClick={() => setActiveTab('vault')}>
          🗄️ Document Vault
          {documents.length > 0 && (
            <span style={{ marginLeft: '6px', fontSize: '11px', background: 'rgba(59,130,246,0.15)', color: 'var(--accent-primary)', padding: '1px 6px', borderRadius: '8px' }}>
              {documents.length}
            </span>
          )}
        </button>
        <button className={`tab-btn ${activeTab === 'tracker' ? 'active' : ''}`} onClick={() => setActiveTab('tracker')}>
          📋 Case Tracker
          {cases.length > 0 && (
            <span style={{ marginLeft: '6px', fontSize: '11px', background: 'rgba(16,185,129,0.15)', color: '#10B981', padding: '1px 6px', borderRadius: '8px' }}>
              {cases.length}
            </span>
          )}
        </button>
      </div>

      {/* ── DOCUMENT VAULT TAB ──────────────────────────────────────────────── */}
      {activeTab === 'vault' && (
        <div className="animate-fade-in">
          {docError && (
            <div style={{ color: '#EF4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', padding: '14px 16px', borderRadius: '8px', fontSize: '13.5px', marginBottom: '20px' }}>
              ⚠️ <strong>Failed to load documents:</strong> {docError}
              <button onClick={loadDocuments} style={{ marginLeft: '12px', background: 'transparent', border: 'none', color: '#EF4444', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px' }}>Retry</button>
            </div>
          )}

          {/* Upload dropzone */}
          <div
            className={`drag-drop-zone ${isDragOver ? 'dragover' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFileUpload(e); }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            style={{ opacity: uploading ? 0.7 : 1, pointerEvents: uploading ? 'none' : 'auto' }}
          >
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".pdf,.docx,.txt" onChange={handleFileUpload} />
            {uploading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '26px', height: '26px', border: '3px solid var(--border-dark-subtle)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--accent-primary)' }}>Uploading &amp; indexing into vector space…</span>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '26px', marginBottom: '10px' }}>📤</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-dark-primary)', marginBottom: '5px' }}>Upload Document to Case Vault</div>
                <div style={{ fontSize: '13px', color: 'var(--text-dark-muted)' }}>Drag &amp; drop a PDF, DOCX, or TXT file here, or click to browse</div>
              </div>
            )}
          </div>

          {/* Breadcrumb — always visible, context-aware New Folder + Blueprint on right */}
          <Breadcrumb
            folderPath={folderPath}
            onNavigateToRoot={navigateToRoot}
            onNavigateTo={navigateToBreadcrumb}
            onNewFolder={() => { setIsCreatingFolder(true); setNewFolderName(''); }}
            onBlueprint={handleInitializeBlueprint}
            isInitializing={isInitializing}
            showBlueprintBtn={!isInitializing && (currentSubFolders.length > 0 || currentDocs.length > 0)}
          />

          {/* Search bar */}
          {!loadingDocs && documents.length > 0 && (
            <div className="vault-search-bar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dark-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                className="vault-search-input"
                type="text"
                placeholder={isSearching ? 'Searching all folders…' : `Search in ${folderPath.length > 0 ? folderPath[folderPath.length - 1].name : 'Case Vault'}…`}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1 }}>✕</button>
              )}
            </div>
          )}

          {/* ── Document + Folder Grid ─────────────────────────────────── */}
          {loadingDocs ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '250px', gap: '14px' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid var(--border-subtle)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading vault…</span>
            </div>
          ) : !docError && (
            <div key={navKey} className={navDir === 'in' ? 'vault-nav-in' : navDir === 'out' ? 'vault-nav-out' : ''}>
              {/* Inline folder creation row */}
              {isCreatingFolder && !isSearching && (
                <div className="vault-new-folder-row">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93C5FD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <input
                    className="vault-new-folder-input"
                    autoFocus
                    placeholder={currentFolderId
                      ? `New subfolder in "${folderPath[folderPath.length - 1]?.name}"…`
                      : 'New folder name…'}
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateFolder();
                      if (e.key === 'Escape') { setIsCreatingFolder(false); setNewFolderName(''); }
                    }}
                  />
                  <button
                    className="vault-nf-ok"
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || creatingFolder}
                  >
                    {creatingFolder ? 'Creating…' : 'Create'}
                  </button>
                  <button
                    className="vault-nf-cancel"
                    onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Folder cards row — hidden when searching */}
              {!isSearching && currentSubFolders.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-dark-muted)', marginBottom: '10px' }}>
                    Folders
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                    {currentSubFolders.map(folder => (
                      <FolderCard
                        key={folder.id}
                        folder={folder}
                        docCount={docCountByFolderId[folder.id] || 0}
                        subFolderCount={subFolderCountById[folder.id] || 0}
                        onClick={() => { if (renamingFolderId !== folder.id && deletingFolderId !== folder.id) navigateToFolder(folder); }}
                        isRenaming={renamingFolderId === folder.id}
                        renameValue={renameValue}
                        onRenameChange={setRenameValue}
                        onRenameSubmit={() => handleRenameFolder(folder.id, renameValue)}
                        onRenameCancel={() => setRenamingFolderId(null)}
                        showDeleteConfirm={deletingFolderId === folder.id}
                        onDeleteConfirm={() => handleDeleteFolder(folder.id)}
                        onDeleteCancel={() => setDeletingFolderId(null)}
                        onRename={() => { setRenameValue(folder.name); setRenamingFolderId(folder.id); }}
                        onDelete={() => setDeletingFolderId(folder.id)}
                        onMove={() => setMovingFolder({ id: folder.id, name: folder.name, parent_id: folder.parent_id })}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Section label for docs */}
              {!isSearching && (currentSubFolders.length > 0 || currentDocs.length > 0) && (
                <div style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-dark-muted)', marginBottom: '10px' }}>
                  {currentSubFolders.length > 0 ? 'Files' : 'Documents'}
                </div>
              )}

              {/* ── Blueprint shimmer: renders staggered rows during init ── */}
              {isInitializing && !isSearching && (
                <div style={{ marginTop: 4 }}>
                  {MATTER_BLUEPRINT_FOLDERS.map((f, i) => (
                    <div
                      key={f.name}
                      className="vault-shimmer-row"
                      style={{ animationDelay: `${i * 0.07}s` }}
                    />
                  ))}
                </div>
              )}

              {/* ── Empty: search no results ───────────────────────────────── */}
              {!isInitializing && isSearching && currentDocs.length === 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '180px', border: '1px dashed rgba(255,255,255,0.06)', borderRadius: '10px', padding: '32px', color: 'var(--text-dark-muted)', gap: '10px' }}>
                  <span style={{ fontSize: '24px' }}>🔍</span>
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-dark-primary)' }}>No results for "{searchTerm}"</span>
                  <span style={{ fontSize: '12px', opacity: 0.65 }}>Try a different search term or browse by folder.</span>
                </div>
              )}

              {/* ── Empty: premium matter hero (not searching, no content) ── */}
              {!isInitializing && !isSearching && currentSubFolders.length === 0 && currentDocs.length === 0 && (
                <div className="vault-empty-hero">
                  <div className="vault-empty-icon-ring">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      <line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                    </svg>
                  </div>
                  <div className="vault-empty-title">
                    {folderPath.length > 0
                      ? `"${folderPath[folderPath.length - 1].name}" is empty`
                      : 'Your Matter Workspace is Empty'}
                  </div>
                  <div className="vault-empty-sub">
                    {folderPath.length > 0
                      ? 'Upload documents or initialize this folder with a standard litigation structure in one click.'
                      : 'Initialize your matter with a court-ready folder taxonomy — seven folders covering the full litigation lifecycle — or start by uploading a document.'}
                  </div>
                  {!folderPath.length && (
                    <div className="vault-blueprint-tags">
                      {MATTER_BLUEPRINT_FOLDERS.map(f => (
                        <span key={f.name} className="vault-blueprint-tag">{f.icon} {f.name}</span>
                      ))}
                    </div>
                  )}
                  <button
                    className="vault-btn-blueprint-hero"
                    onClick={handleInitializeBlueprint}
                    disabled={isInitializing}
                  >
                    {isInitializing ? (
                      <>
                        <div style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
                        Initializing Structure…
                      </>
                    ) : (
                      <>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                        Initialize Standard Matter Blueprint
                      </>
                    )}
                  </button>
                  <div className="vault-empty-secondary">
                    <button className="vault-empty-link" onClick={() => fileInputRef.current?.click()}>
                      Upload a document instead
                    </button>
                    <span className="vault-empty-sep">·</span>
                    <button className="vault-empty-link" onClick={() => setIsLibraryDrawerOpen(true)}>
                      Browse Firm Library
                    </button>
                    {folderPath.length === 0 && (
                      <>
                        <span className="vault-empty-sep">·</span>
                        <button className="vault-empty-link" onClick={() => { setIsCreatingFolder(true); setNewFolderName(''); }}>
                          Create a custom folder
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ── Document grid (visible when not initializing and has docs) ── */}
              {!isInitializing && currentDocs.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(275px, 1fr))', gap: '16px' }}>
                  {currentDocs.map(doc => {
                    const typeStyle = getDocTypeStyle(doc.doc_type);
                    const folderName = isSearching ? getFolderName(doc.folder_id) : null;
                    return (
                      <div key={doc.id} className="vault-grid-card" style={{ position: 'relative' }}>
                        {/* Card header: type badge + folder badge + 3-dots menu */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                          <span style={{ fontSize: '10px', fontWeight: '700', color: typeStyle.color, background: typeStyle.bg, padding: '2px 7px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>
                            {doc.doc_type || 'Document'}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                            {folderName && <span className="vault-folder-badge">📁 {folderName}</span>}
                            {/* 3-dots context menu */}
                            <div
                              ref={openMenuDocId === doc.id ? docMenuRef : null}
                              style={{ position: 'relative' }}
                            >
                              <button
                                className="vault-doc-dots"
                                title="Document options"
                                onClick={e => { e.stopPropagation(); setOpenMenuDocId(openMenuDocId === doc.id ? null : doc.id); }}
                              >⋮</button>
                              {openMenuDocId === doc.id && (
                                <div className="vault-doc-menu">
                                  <button className="vault-doc-menu-item" onClick={() => { setOpenMenuDocId(null); handleAnalyzeDocument(doc); }}>
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                                    Analyze
                                  </button>
                                  <button className="vault-doc-menu-item" onClick={() => { setOpenMenuDocId(null); handleSummarize(doc); }}>
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                                    Summarize
                                  </button>
                                  <button className="vault-doc-menu-item" onClick={() => { setOpenMenuDocId(null); handleExtractFacts(doc); }}>
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                                    Extract Facts
                                  </button>
                                  <button className="vault-doc-menu-item" onClick={() => handleDownloadDocument(doc)}>
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                                    Download
                                  </button>
                                  <div className="vault-doc-menu-sep" />
                                  <button className="vault-doc-menu-item vault-doc-menu-danger" onClick={() => handleDeleteDocument(doc)}>
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Title */}
                        <h3 style={{ fontSize: '14.5px', fontWeight: '600', color: 'var(--text-dark-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.smart_title || doc.title}>
                          {doc.smart_title || doc.title}
                        </h3>

                        {/* Content preview */}
                        <div className="vault-card-preview">{doc.content || 'No preview available.'}</div>

                        {/* Date */}
                        <div style={{ fontSize: '10.5px', color: 'var(--text-dark-muted)', opacity: 0.55 }}>
                          {formatDate(doc.created_at)}
                        </div>

                        {/* Single primary CTA */}
                        <div className="vault-card-actions" style={{ marginTop: 'auto' }}>
                          <button className="vault-btn-view" onClick={() => handleViewDocument(doc)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                            </svg>
                            View Document
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Library Injector Drawer ────────────────────────────────────────── */}
      {isLibraryDrawerOpen && (
        <div className="lib-overlay" onClick={() => setIsLibraryDrawerOpen(false)} />
      )}
      <div className={`lib-drawer${isLibraryDrawerOpen ? ' lib-open' : ''}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="lib-drawer-head">
          <div>
            <div className="lib-drawer-title">📚 Firm Library</div>
            <div className="lib-drawer-sub">
              {libRagLoading
                ? 'Querying intelligence layer…'
                : libRagResult?.brain === 'EXTERNAL'
                  ? `External precedents retrieved · ${filteredLibEntries.length} local template${filteredLibEntries.length !== 1 ? 's' : ''}`
                  : `${filteredLibEntries.length} template${filteredLibEntries.length !== 1 ? 's' : ''}${libSearch ? ` matching "${libSearch}"` : ''}`
              }
            </div>
          </div>
          <button className="lib-close-btn" onClick={() => setIsLibraryDrawerOpen(false)} aria-label="Close">✕</button>
        </div>

        {/* Search */}
        <div className="lib-search-row">
          <div className="lib-search-wrap">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-dark-muted,#8F9CAE)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              className="lib-search-input"
              placeholder="Search templates, precedents, guides…"
              value={libSearch}
              onChange={e => setLibSearch(e.target.value)}
              autoComplete="off"
            />
            {libSearch && (
              <button onClick={() => setLibSearch('')} style={{ background: 'none', border: 'none', color: 'var(--text-dark-muted,#8F9CAE)', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>✕</button>
            )}
          </div>
          {libSearch.trim().length > 0 && libSearch.trim().length < 3 && (
            <p className="dc-search-hint">Type 3+ characters to search firm templates or query Case Law intelligence…</p>
          )}
        </div>

        {/* Entry list */}
        <div className="lib-list">
          {/* ── RAG loading indicator ── */}
          {libRagLoading && (
            <div className="lib-rag-loading">
              <div style={{ width: 14, height: 14, border: '2px solid rgba(139,92,246,0.3)', borderTopColor: '#A78BFA', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
              Dual-Brain RAG querying case law…
            </div>
          )}

          {/* ── EXTERNAL brain: Legal Intelligence Dossier ── */}
          {!libRagLoading && libRagResult?.brain === 'EXTERNAL' && libRagResult.synthesis && (
            <>
              <div className="lib-rag-dossier">
                <div className="lib-rag-header">
                  <span className="lib-rag-brain-badge">⚡ External Intelligence</span>
                  {libRagResult.reliability_index != null && (() => {
                    const pct = Math.round(libRagResult.reliability_index * 100);
                    const color = pct >= 75 ? '#34D399' : pct >= 50 ? '#FBBF24' : '#F87171';
                    return (
                      <div className="lib-rag-reliability">
                        <div className="lib-rag-reliability-bar">
                          <div className="lib-rag-reliability-fill" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <span className="lib-rag-reliability-label" style={{ color }}>{pct}%</span>
                      </div>
                    );
                  })()}
                </div>
                <div className="lib-rag-synthesis">{libRagResult.synthesis}</div>
                {libRagResult.citations?.length > 0 && (
                  <div>
                    <div className="lib-rag-section-label">Citations</div>
                    <div className="lib-rag-citations">
                      {libRagResult.citations.slice(0, 3).map((c, i) => (
                        <div key={i} className="lib-rag-citation">
                          <strong>{c.case_name} ({c.year})</strong>
                          {c.relevance_note}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {libRagResult.facts_vs_ruling?.ruling_summary && (
                  <div>
                    <div className="lib-rag-section-label">Ratio Decidendi</div>
                    <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-secondary, #E2E8F0)', lineHeight: 1.6, padding: '7px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.09)' }}>
                      {libRagResult.facts_vs_ruling.ruling_summary}
                    </div>
                  </div>
                )}
                {libRagResult.risk_warnings?.length > 0 && (
                  <div>
                    <div className="lib-rag-section-label">Risk Advisories</div>
                    <div className="lib-rag-warnings">
                      {libRagResult.risk_warnings.slice(0, 2).map((w, i) => (
                        <div key={i} className="lib-rag-warning">⚠ {w}</div>
                      ))}
                    </div>
                  </div>
                )}
                {/* ── Action buttons ── */}
                <div className="lib-rag-actions">
                  <button
                    className={`lib-rag-action-btn copy${ragCopied ? ' done' : ''}`}
                    onClick={() => {
                      const lines = [
                        ...(libRagResult.citations || []).map(c => `${c.case_name} (${c.year}) — ${c.relevance_note}`),
                      ].join('\n');
                      navigator.clipboard.writeText(lines || libRagResult.synthesis || '').then(() => {
                        setRagCopied(true);
                        setTimeout(() => setRagCopied(false), 2200);
                      });
                    }}
                  >
                    {ragCopied ? '✓ Copied' : '⎘ Copy Citation'}
                  </button>
                  <button
                    className="lib-rag-action-btn inject"
                    onClick={() => {
                      const query = libSearch.trim();
                      const syntheticDoc = {
                        id: `rag-brief-${Date.now()}`,
                        name: `Research Brief: ${query}`,
                        type: 'Research Memo',
                        content: [
                          `[DUAL-BRAIN INTELLIGENCE — External Case Law]`,
                          `Query: ${query}`,
                          ``,
                          `SYNTHESIS:`,
                          libRagResult.synthesis || '',
                          ``,
                          `CITATIONS:`,
                          ...(libRagResult.citations || []).map(c => `• ${c.case_name} (${c.year}) — ${c.relevance_note}`),
                          ``,
                          `RATIO DECIDENDI:`,
                          libRagResult.facts_vs_ruling?.ruling_summary || 'N/A',
                          ``,
                          `RISK ADVISORIES:`,
                          ...(libRagResult.risk_warnings || []).map(w => `⚠ ${w}`),
                        ].join('\n'),
                        created_at: new Date().toISOString(),
                        folder_id: currentFolderId,
                        tags: ['Research', 'AI-Generated', 'Case Law'],
                      };
                      setDocuments(prev => [syntheticDoc, ...prev]);
                      setInjectToast(`Research Brief: ${query}`);
                      setTimeout(() => setInjectToast(null), 3500);
                    }}
                  >
                    + Inject Brief as Memo
                  </button>
                </div>
              </div>
              {filteredLibEntries.length > 0 && (
                <>
                  <div className="lib-rag-divider" />
                  <div className="lib-rag-local-label">Firm Templates</div>
                </>
              )}
            </>
          )}

          {filteredLibEntries.length === 0 ? (
            <div className="lib-empty-state">
              <div style={{ fontSize: 28, marginBottom: 6 }}>🔍</div>
              <div style={{ fontWeight: 600, color: 'var(--text-dark-primary,#fff)', fontSize: 14 }}>No results</div>
              <div style={{ fontSize: 12 }}>Try a different search term.</div>
            </div>
          ) : (
            filteredLibEntries.map(entry => {
              const catStyle = (() => {
                const map = {
                  Template:         { bg: 'rgba(59,130,246,0.12)',  color: '#60A5FA' },
                  Precedent:        { bg: 'rgba(245,158,11,0.12)',  color: '#FBBF24' },
                  'Research Memo':  { bg: 'rgba(139,92,246,0.12)',  color: '#A78BFA' },
                  'Standard Form':  { bg: 'rgba(16,185,129,0.12)',  color: '#34D399' },
                  'Practice Guide': { bg: 'rgba(20,184,166,0.12)',  color: '#2DD4BF' },
                };
                return map[entry.category] || { bg: 'rgba(107,114,128,0.12)', color: '#9CA3AF' };
              })();
              const alreadyInjected = injectedIds.has(entry.id);
              return (
                <div key={entry.id} className="lib-item">
                  <div className="lib-item-top">
                    <div className="lib-item-title">{entry.title}</div>
                    <span className="lib-cat-badge" style={{ background: catStyle.bg, color: catStyle.color }}>{entry.category}</span>
                  </div>
                  <div className="lib-item-meta">
                    {entry.author && <span>{entry.author}</span>}
                    {entry.updated && <span style={{ marginLeft: 8, opacity: 0.6 }}>· {entry.updated}</span>}
                  </div>
                  {entry.tags?.length > 0 && (
                    <div className="lib-item-tags">
                      {entry.tags.slice(0, 4).map(t => <span key={t} className="lib-tag">{t}</span>)}
                    </div>
                  )}
                  <button
                    className={`lib-inject-btn${alreadyInjected ? ' lib-injected' : ''}`}
                    onClick={() => !alreadyInjected && handleInjectEntry(entry)}
                  >
                    {alreadyInjected ? (
                      <>✓ Injected into Vault</>
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14M5 12l7 7 7-7" />
                        </svg>
                        Inject into Vault
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Slide-Over Document Canvas ──────────────────────────────────────── */}
      <div
        className={`soc-backdrop${canvasDoc ? ' soc-open' : ''}`}
        onClick={() => setCanvasDoc(null)}
        aria-hidden="true"
      />
      <div
        className={`soc-panel${canvasDoc ? ' soc-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={canvasDoc ? (canvasDoc.smart_title || canvasDoc.title || 'Document') : undefined}
      >
        {canvasDoc && (
          <>
            {/* Canvas header */}
            <div className="soc-header">
              <div className="soc-header-top">
                <div className="soc-title" title={canvasDoc.smart_title || canvasDoc.title}>
                  {canvasDoc.smart_title || canvasDoc.title || 'Document'}
                </div>
                <button className="soc-close" onClick={() => setCanvasDoc(null)} aria-label="Close canvas">✕</button>
              </div>
              <div className="soc-meta">
                {canvasDoc.doc_type && (() => {
                  const s = getDocTypeStyle(canvasDoc.doc_type);
                  return (
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.45px', padding: '2px 8px', borderRadius: 4, background: s.bg, color: s.color }}>
                      {canvasDoc.doc_type}
                    </span>
                  );
                })()}
                {canvasDoc.created_at && (
                  <span style={{ fontSize: 11, color: '#334155' }}>{formatDate(canvasDoc.created_at)}</span>
                )}
                {canvasDoc.folder_id && getFolderName(canvasDoc.folder_id) && (
                  <span style={{ fontSize: 10.5, color: '#3B5172', display: 'flex', alignItems: 'center', gap: 4 }}>
                    📁 {getFolderName(canvasDoc.folder_id)}
                  </span>
                )}
              </div>
            </div>

            {/* Canvas body — scrollable document content */}
            <div className="soc-body">
              <div className="soc-content">
                {(canvasDoc.content || 'No content available.')
                  .split('\n\n')
                  .map((para, i) => (
                    <p key={i}>
                      {para.split('\n').map((line, j, arr) => (
                        <React.Fragment key={j}>
                          {line}
                          {j < arr.length - 1 && <br />}
                        </React.Fragment>
                      ))}
                    </p>
                  ))
                }
              </div>
            </div>

            {/* Canvas footer actions */}
            <div className="soc-footer-actions">
              <button
                className="vault-btn-analyze"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => { setCanvasDoc(null); handleAnalyzeDocument(canvasDoc); }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                Analyze with AI
              </button>
              <button
                className="vault-btn-quick"
                onClick={() => handleDownloadDocument(canvasDoc)}
                style={{ gap: 5 }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Inject success toast ────────────────────────────────────────────── */}
      {injectToast && (
        <div className="lib-inject-toast">
          <span style={{ fontSize: 16, flexShrink: 0 }}>✓</span>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Template Injected</div>
            <div style={{ fontSize: 11.5, opacity: 0.8 }}>"{injectToast}" added to your vault.</div>
          </div>
        </div>
      )}

      {/* ── Blueprint toast notification (portal-rendered fixed position) ── */}
      {blueprintToast && (
        <div className={`vault-toast vault-toast-${blueprintToast.type}`}>
          <span className="vault-toast-icon">
            {blueprintToast.type === 'success' ? '✓' : blueprintToast.type === 'partial' ? '⚠' : '✕'}
          </span>
          <div>
            <div className="vault-toast-title">
              {blueprintToast.type === 'success'
                ? `Litigation Blueprint Applied — ${blueprintToast.foldersCreated} folders, ${blueprintToast.templatesInjected} templates injected`
                : blueprintToast.type === 'partial'
                  ? `Partial Blueprint — ${blueprintToast.foldersCreated} of ${MATTER_BLUEPRINT_FOLDERS.length} folders created, ${blueprintToast.templatesInjected} templates injected`
                  : 'Blueprint initialization failed'}
            </div>
            {blueprintToast.failed.length > 0 && (
              <div className="vault-toast-body">
                Failed: {blueprintToast.failed.join(', ')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CASE TRACKER TAB ─────────────────────────────────────────────── */}
      {activeTab === 'tracker' && (
        <div className="dashboard-panel animate-fade-in">
          <div className="panel-header" style={{ marginBottom: '20px' }}>
            <h2>Tracked Caseload</h2>
            <p>Monitor your active matters and sync hearing dates via eCourts CNR.</p>
          </div>

          <div className="control-row">
            <div className="input-group" style={{ maxWidth: '340px' }}>
              <label className="input-label">Quick eCourts Lookup (CNR Number)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" className="input-field" placeholder="Enter 16-digit CNR…" style={{ flex: 1 }} value={fetchCnr} onChange={e => setFetchCnr(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleFetchStatus()} />
                <button className="btn-accent" onClick={handleFetchStatus} disabled={fetchingStatus}>
                  {fetchingStatus ? 'Fetching…' : 'Fetch Status'}
                </button>
              </div>
            </div>
          </div>

          {fallbackUrl && (
            <div style={{ padding: '14px 16px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', marginBottom: '20px' }}>
              <h4 style={{ color: '#F59E0B', marginBottom: '6px', fontSize: '13.5px', fontWeight: '600' }}>⚠️ eCourts Portal Busy</h4>
              <p style={{ color: 'var(--text-dark-muted)', fontSize: '13px', marginBottom: '10px' }}>The API is unresponsive. View the fallback URL directly.</p>
              <button className="btn-secondary" style={{ borderColor: '#F59E0B', color: '#F59E0B' }}
                onClick={() => window.open(`${API_BASE}/api/proxy?target_url=${encodeURIComponent(fallbackUrl)}`, '_blank')}>
                Open Fallback URL ↗
              </button>
            </div>
          )}

          {loadingCases ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dark-muted)' }}>Loading tracked cases…</div>
          ) : cases.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px', color: 'var(--text-dark-muted)' }}>
              <div style={{ fontSize: '22px', marginBottom: '8px' }}>📋</div>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>No Cases Tracked Yet</div>
              <div style={{ fontSize: '12px' }}>Fetch via CNR or click "Add Case" to add one manually.</div>
            </div>
          ) : (
            <div className="responsive-table-container">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Case Name</th><th>CNR / Case No.</th><th>Court</th><th>Client</th><th>Next Hearing</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: '500' }}>{c.case_name || c.title}</td>
                      <td>
                        <div style={{ fontSize: '12px', color: 'var(--text-dark-muted)', marginBottom: '2px' }}>{c.cnr_number || '—'}</div>
                        <div>{c.case_number || '—'}</div>
                      </td>
                      <td>{c.court || '—'}</td>
                      <td>{c.client_name || '—'}</td>
                      <td style={{ color: c.next_hearing_date ? '#F59E0B' : 'inherit' }}>{c.next_hearing_date || c.next_hearing || '—'}</td>
                      <td>
                        <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', background: c.status === 'Active' ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.05)', color: c.status === 'Active' ? '#10B981' : 'var(--text-dark-muted)' }}>
                          {c.status || 'Unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── FOLDER MOVE MODAL ────────────────────────────────────────────── */}
      {movingFolder && (
        <FolderMoveModal
          movingFolder={movingFolder}
          allFolders={folders}
          onConfirm={(newParentId) => handleMoveFolder(movingFolder.id, newParentId)}
          onClose={() => setMovingFolder(null)}
        />
      )}

      {/* ── ADD CASE MODAL ────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card si-modal animate-fade-in"
            onDragOver={e => { e.preventDefault(); setModalDropOver(true); }}
            onDragLeave={() => setModalDropOver(false)}
            onDrop={e => { e.preventDefault(); setModalDropOver(false); const f = e.dataTransfer.files[0]; if (f) handleIntakeFileDrop(f); }}
          >
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '17px', color: 'var(--text-dark-primary)' }}>Add Case</h3>
              <button onClick={() => { setIsModalOpen(false); setFormData(EMPTY_FORM); setAiFilledFields(new Set()); setExtractionState('idle'); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>&times;</button>
            </div>

            {/* ── AI DROPZONE ── */}
            {extractionState !== 'done' && (
              <div
                className={`si-dropzone${extractionState === 'scanning' || extractionState === 'populating' ? ' si-scanning' : ''}${modalDropOver ? ' si-dragover' : ''}`}
                onClick={() => extractionState === 'idle' && intakeFileRef.current?.click()}
                style={{ cursor: extractionState === 'idle' ? 'pointer' : 'default' }}
              >
                <input ref={intakeFileRef} type="file" accept=".pdf,.docx,.txt" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleIntakeFileDrop(f); e.target.value = ''; }}
                />
                {(extractionState === 'scanning' || extractionState === 'populating') && (
                  <div className="si-scan-beam" />
                )}
                <div className="si-scan-icon">
                  {extractionState === 'idle' ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/>
                      <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                  )}
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-dark-primary)', marginTop: 6 }}>
                  {extractionState === 'idle' && 'Drop a legal document for ML Triage'}
                  {extractionState === 'scanning' && 'Scanning document…'}
                  {extractionState === 'populating' && 'Extracting case metadata…'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-dark-muted)', marginTop: 3 }}>
                  {extractionState === 'idle' ? 'PDF · DOCX · TXT — or fill manually below' : 'AI is populating the form fields automatically'}
                </div>
              </div>
            )}

            {extractionState === 'done' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: 'rgba(16,185,129,0.08)', borderBottom: '1px solid rgba(16,185,129,0.25)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.2"><polyline points="20 6 9 17 4 12"/></svg>
                <span style={{ fontSize: '13px', color: '#10B981', fontWeight: 600 }}>ML Triage complete — review highlighted fields</span>
                <button onClick={() => setExtractionState('idle')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', fontSize: '11px', color: 'var(--text-dark-muted)', cursor: 'pointer' }}>Re-scan</button>
              </div>
            )}

            <form id="si-form" onSubmit={handleModalSave}>
              <div className="modal-body">
                {/* Row 1: Case Name + Case Number */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Case Name *{aiFilledFields.has('case_name') && <span className="si-ai-badge">AI</span>}</label>
                    <input required type="text" className={`input-field${aiFilledFields.has('case_name') ? ' si-ai-field' : ''}`} value={formData.case_name} onChange={e => setFormData(p => ({ ...p, case_name: e.target.value }))} placeholder="e.g., State vs. John Doe" />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Case Number{aiFilledFields.has('case_number') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="text" className={`input-field${aiFilledFields.has('case_number') ? ' si-ai-field' : ''}`} value={formData.case_number} onChange={e => setFormData(p => ({ ...p, case_number: e.target.value }))} placeholder="e.g., CRA/123/2026" />
                  </div>
                </div>

                {/* Row 2: Court + Judge */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Court Name{aiFilledFields.has('court') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="text" className={`input-field${aiFilledFields.has('court') ? ' si-ai-field' : ''}`} value={formData.court} onChange={e => setFormData(p => ({ ...p, court: e.target.value }))} placeholder="e.g., Delhi High Court" />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Judge Name{aiFilledFields.has('judge_name') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="text" className={`input-field${aiFilledFields.has('judge_name') ? ' si-ai-field' : ''}`} value={formData.judge_name} onChange={e => setFormData(p => ({ ...p, judge_name: e.target.value }))} placeholder="Hon. Justice…" />
                  </div>
                </div>

                {/* Row 3: Case Type + CNR */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Case Type{aiFilledFields.has('case_type') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="text" className={`input-field${aiFilledFields.has('case_type') ? ' si-ai-field' : ''}`} value={formData.case_type} onChange={e => setFormData(p => ({ ...p, case_type: e.target.value }))} placeholder="Civil / Criminal / IP…" />
                  </div>
                  <div className="form-group">
                    <label className="input-label">CNR Number</label>
                    <input type="text" className="input-field" value={formData.cnr_number} onChange={e => setFormData(p => ({ ...p, cnr_number: e.target.value }))} placeholder="16-digit official ID" />
                  </div>
                </div>

                {/* Row 4: Petitioner + Respondent */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Petitioner{aiFilledFields.has('petitioner_name') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="text" className={`input-field${aiFilledFields.has('petitioner_name') ? ' si-ai-field' : ''}`} value={formData.petitioner_name} onChange={e => setFormData(p => ({ ...p, petitioner_name: e.target.value }))} placeholder="Petitioner / Plaintiff" />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Respondent{aiFilledFields.has('respondent_name') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="text" className={`input-field${aiFilledFields.has('respondent_name') ? ' si-ai-field' : ''}`} value={formData.respondent_name} onChange={e => setFormData(p => ({ ...p, respondent_name: e.target.value }))} placeholder="Respondent / Defendant" />
                  </div>
                </div>

                {/* Row 5: Petitioner Counsel + Respondent Counsel */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Petitioner Counsel{aiFilledFields.has('petitioner_counsel') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="text" className={`input-field${aiFilledFields.has('petitioner_counsel') ? ' si-ai-field' : ''}`} value={formData.petitioner_counsel} onChange={e => setFormData(p => ({ ...p, petitioner_counsel: e.target.value }))} placeholder="Adv. Name" />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Respondent Counsel{aiFilledFields.has('respondent_counsel') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="text" className={`input-field${aiFilledFields.has('respondent_counsel') ? ' si-ai-field' : ''}`} value={formData.respondent_counsel} onChange={e => setFormData(p => ({ ...p, respondent_counsel: e.target.value }))} placeholder="Adv. Name" />
                  </div>
                </div>

                {/* Row 6: Client Name + Filing Date */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Client Name</label>
                    <input type="text" className="input-field" value={formData.client_name} onChange={e => setFormData(p => ({ ...p, client_name: e.target.value }))} placeholder="Internal reference" />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Filing Date{aiFilledFields.has('filing_date') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="date" className={`input-field${aiFilledFields.has('filing_date') ? ' si-ai-field' : ''}`} value={formData.filing_date} onChange={e => setFormData(p => ({ ...p, filing_date: e.target.value }))} />
                  </div>
                </div>

                {/* Row 7: Next Hearing + Last Hearing */}
                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Next Hearing{aiFilledFields.has('next_hearing') && <span className="si-ai-badge">AI</span>}</label>
                    <input type="date" className={`input-field${aiFilledFields.has('next_hearing') ? ' si-ai-field' : ''}`} value={formData.next_hearing} onChange={e => setFormData(p => ({ ...p, next_hearing: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Last Hearing</label>
                    <input type="date" className="input-field" value={formData.last_hearing} onChange={e => setFormData(p => ({ ...p, last_hearing: e.target.value }))} />
                  </div>
                </div>

                {/* Status */}
                <div className="form-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="input-label">Status</label>
                    <select className="input-field" value={formData.status} onChange={e => setFormData(p => ({ ...p, status: e.target.value }))}>
                      <option value="Active">Active</option>
                      <option value="Disposed">Disposed</option>
                      <option value="Pending Filing">Pending Filing</option>
                    </select>
                  </div>
                </div>

                {/* Summary */}
                <div className="form-group">
                  <label className="input-label">Summary{aiFilledFields.has('summary') && <span className="si-ai-badge">AI</span>}</label>
                  <textarea className={`input-field${aiFilledFields.has('summary') ? ' si-ai-field' : ''}`} rows="3" value={formData.summary} onChange={e => setFormData(p => ({ ...p, summary: e.target.value }))} placeholder="Brief case synopsis…" style={{ resize: 'none' }} />
                </div>

                {/* Notes */}
                <div className="form-group">
                  <label className="input-label">Notes</label>
                  <textarea className="input-field" rows="2" value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} placeholder="Strategy notes or updates…" style={{ resize: 'none' }} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => { setIsModalOpen(false); setFormData(EMPTY_FORM); setAiFilledFields(new Set()); setExtractionState('idle'); }}>Cancel</button>
                <button type="submit" form="si-form" className="btn-accent" disabled={savingCase}>{savingCase ? 'Saving…' : 'Save Case'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
