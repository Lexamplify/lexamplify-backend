import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadDocument, fetchTrackedCases, saveTrackedCase, fetchCauselist } from '../services/api';

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
`;

const DOC_TYPE_STYLES = {
  'Legal Document':       { bg: 'rgba(59,130,246,0.1)',  color: '#3B82F6' },
  'Contract':             { bg: 'rgba(16,185,129,0.1)',  color: '#10B981' },
  'FIR':                  { bg: 'rgba(239,68,68,0.1)',   color: '#EF4444' },
  'Petition':             { bg: 'rgba(245,158,11,0.1)',  color: '#F59E0B' },
  'Draft':                { bg: 'rgba(139,92,246,0.1)',  color: '#8B5CF6' },
  'Agreement':            { bg: 'rgba(6,182,212,0.1)',   color: '#06B6D4' },
  'Judgment':             { bg: 'rgba(236,72,153,0.1)',  color: '#EC4899' },
  'Non-Disclosure Agreement': { bg: 'rgba(99,102,241,0.1)', color: '#818CF8' },
  'Courtroom Simulation': { bg: 'rgba(239,68,68,0.07)',  color: '#FCA5A5' },
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
// 7-folder structure covering the full lifecycle of complex Indian litigation:
// Court Filings (stamped record) → Pleadings & Drafts (pre-filing) →
// Interlocutory Applications (IA/stay track) → Evidence & Exhibits (factual matrix) →
// Correspondence (notice trail) → Research & Precedents (legal backbone) →
// Fee & Billing (matter admin) — mirrors how senior advocates physically organise case bundles.
const MATTER_BLUEPRINT_FOLDERS = [
  { name: 'Court Filings',              icon: '⚖️' },
  { name: 'Pleadings & Drafts',         icon: '📝' },
  { name: 'Interlocutory Applications', icon: '📌' },
  { name: 'Evidence & Exhibits',        icon: '🗂️' },
  { name: 'Correspondence',             icon: '✉️' },
  { name: 'Research & Precedents',      icon: '🔬' },
  { name: 'Fee & Billing',              icon: '💼' },
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
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            {isInitializing ? 'Initializing…' : '⚡ Blueprint'}
          </button>
        )}
        <button className="vault-bc-new-btn" onClick={onNewFolder}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
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
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
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
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
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
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Rename
            </button>
            <button className="vault-folder-menu-item" onClick={e => { e.stopPropagation(); setMenuOpen(false); onMove(); }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              Move to…
            </button>
            <div className="vault-folder-menu-sep"/>
            <button className="vault-folder-menu-item vault-folder-menu-danger" onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}>
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
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
  const [documents, setDocuments]     = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docError, setDocError]       = useState(null);
  const [uploading, setUploading]     = useState(false);
  const [isDragOver, setIsDragOver]   = useState(false);
  const [searchTerm, setSearchTerm]   = useState('');
  const fileInputRef                  = useRef(null);

  // Document card context menu
  const [openMenuDocId, setOpenMenuDocId] = useState(null);
  const docMenuRef = useRef(null);

  // Folder navigation
  const [folders, setFolders]             = useState([]);   // flat list from API
  const [currentFolderId, setCurrentFolderId] = useState(null);  // null = root
  const [folderPath, setFolderPath]           = useState([]);    // [{id, name}]

  // Folder creation (inline)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName,    setNewFolderName]    = useState('');
  const [creatingFolder,   setCreatingFolder]   = useState(false);

  // Nav animation (drill-in / drill-out)
  const [navKey, setNavKey] = useState(0);
  const [navDir, setNavDir] = useState(''); // 'in' | 'out' | ''

  // Folder management (rename / move / delete)
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [renameValue,       setRenameValue]      = useState('');
  const [deletingFolderId,  setDeletingFolderId] = useState(null);
  const [movingFolder,      setMovingFolder]     = useState(null); // { id, name, parent_id }

  // Matter Blueprint engine
  const [isInitializing,  setIsInitializing]  = useState(false);
  const [blueprintToast,  setBlueprintToast]  = useState(null); // { type: 'success'|'partial'|'error', failed: string[] }

  // Case Tracker
  const [cases, setCases]               = useState([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const [fetchCnr, setFetchCnr]         = useState('');
  const [fetchingStatus, setFetchingStatus] = useState(false);
  const [fallbackUrl, setFallbackUrl]   = useState('');

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [savingCase, setSavingCase]   = useState(false);
  const [formData, setFormData] = useState({
    case_name: '', client_name: '', case_number: '', cnr_number: '',
    case_type: '', court: '', next_hearing: '', last_hearing: '', status: 'Active', notes: ''
  });

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
    } catch (_) {}
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

  // ── Matter Blueprint: batch-create standard litigation folders ─────────────
  // Strategy: Promise.allSettled() — all 7 POSTs fire concurrently; no short-circuit
  // on failure. Partial success is preserved (optimistic local update) and surfaced
  // via a toast listing the failed names. No rollback — a partial structure is better
  // than nothing; the lawyer can re-click Blueprint to fill gaps idempotently.
  const handleInitializeBlueprint = async () => {
    if (isInitializing) return;
    setIsInitializing(true);
    setBlueprintToast(null);
    const token = apiToken();

    const results = await Promise.allSettled(
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
    );

    const succeeded = results
      .map((r, i) => r.status === 'fulfilled' ? r.value : null)
      .filter(Boolean);
    const failed = results
      .map((r, i) => r.status === 'rejected' ? MATTER_BLUEPRINT_FOLDERS[i].name : null)
      .filter(Boolean);

    if (succeeded.length > 0) {
      setFolders(prev => [...prev, ...succeeded]);
    }

    if (failed.length === 0) {
      setBlueprintToast({ type: 'success', failed: [] });
    } else if (succeeded.length > 0) {
      setBlueprintToast({ type: 'partial', failed });
    } else {
      setBlueprintToast({ type: 'error', failed });
    }

    await loadCurrentView();
    setIsInitializing(false);
    setTimeout(() => setBlueprintToast(null), 6500);
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

  // Resolve folder name for document cards (when searching across folders)
  const getFolderName = (folderId) => {
    if (!folderId) return null;
    return (folders.find(f => f.id === folderId) || {}).name || null;
  };

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    let file = null;
    if (e.dataTransfer?.files?.length > 0) { file = e.dataTransfer.files[0]; e.dataTransfer.clearData(); }
    else if (e.target?.files?.length > 0)  { file = e.target.files[0]; }
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
    summary: doc.doc_type ? `${doc.doc_type} — saved from Universal Agent` : 'Document from Case Vault',
    text: doc.content || '',
    tags: doc.tags || null,
    case_id: doc.case_id || null,
  });

  const handleViewDocument = (doc) => {
    navigate(`/case/vault/doc/${doc.id}`, {
      state: { fromVault: true, docData: buildDocData(doc) },
    });
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

  const handleModalSave = async (e) => {
    e.preventDefault();
    if (!formData.case_name.trim()) { alert('Case Name is required.'); return; }
    setSavingCase(true);
    const res = await saveTrackedCase(formData);
    setSavingCase(false);
    if (res.error) { alert(res.message || 'Failed to save.'); }
    else {
      setIsModalOpen(false);
      setFormData({ case_name: '', client_name: '', case_number: '', cnr_number: '', case_type: '', court: '', next_hearing: '', last_hearing: '', status: 'Active', notes: '' });
      loadCases();
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
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
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
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
              New Folder
            </button>
            <button className="btn-accent" onClick={() => fileInputRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
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
                <div style={{ fontSize: '15px', fontWeight: '600', color: 'white', marginBottom: '5px' }}>Upload Document to Case Vault</div>
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
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                className="vault-search-input"
                type="text"
                placeholder={isSearching ? 'Searching all folders…' : `Search in ${folderPath.length > 0 ? folderPath[folderPath.length-1].name : 'Case Vault'}…`}
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
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
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
                  <span style={{ fontSize: '14px', fontWeight: '600', color: 'white' }}>No results for "{searchTerm}"</span>
                  <span style={{ fontSize: '12px', opacity: 0.65 }}>Try a different search term or browse by folder.</span>
                </div>
              )}

              {/* ── Empty: premium matter hero (not searching, no content) ── */}
              {!isInitializing && !isSearching && currentSubFolders.length === 0 && currentDocs.length === 0 && (
                <div className="vault-empty-hero">
                  <div className="vault-empty-icon-ring">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
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
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </svg>
                        Initialize Standard Matter Blueprint
                      </>
                    )}
                  </button>
                  <div className="vault-empty-secondary">
                    <button className="vault-empty-link" onClick={() => fileInputRef.current?.click()}>
                      Upload a document instead
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
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                                    Analyze
                                  </button>
                                  <button className="vault-doc-menu-item" onClick={() => { setOpenMenuDocId(null); handleSummarize(doc); }}>
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                                    Summarize
                                  </button>
                                  <button className="vault-doc-menu-item" onClick={() => { setOpenMenuDocId(null); handleExtractFacts(doc); }}>
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                                    Extract Facts
                                  </button>
                                  <button className="vault-doc-menu-item" onClick={() => handleDownloadDocument(doc)}>
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                    Download
                                  </button>
                                  <div className="vault-doc-menu-sep"/>
                                  <button className="vault-doc-menu-item vault-doc-menu-danger" onClick={() => handleDeleteDocument(doc)}>
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Title */}
                        <h3 style={{ fontSize: '14.5px', fontWeight: '600', color: 'white', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.smart_title || doc.title}>
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
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
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

      {/* ── Blueprint toast notification (portal-rendered fixed position) ── */}
      {blueprintToast && (
        <div className={`vault-toast vault-toast-${blueprintToast.type}`}>
          <span className="vault-toast-icon">
            {blueprintToast.type === 'success' ? '✓' : blueprintToast.type === 'partial' ? '⚠' : '✕'}
          </span>
          <div>
            <div className="vault-toast-title">
              {blueprintToast.type === 'success'
                ? `Matter Blueprint initialized — ${MATTER_BLUEPRINT_FOLDERS.length} folders created`
                : blueprintToast.type === 'partial'
                  ? `Partial success — ${MATTER_BLUEPRINT_FOLDERS.length - blueprintToast.failed.length} of ${MATTER_BLUEPRINT_FOLDERS.length} folders created`
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
          <div className="modal-card animate-fade-in">
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '17px', color: 'white' }}>Add / Edit Case</h3>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>&times;</button>
            </div>
            <form onSubmit={handleModalSave}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label className="input-label">Case Name *</label><input required type="text" className="input-field" value={formData.case_name} onChange={e => setFormData({...formData, case_name: e.target.value})} placeholder="e.g., State vs. John Doe" /></div>
                  <div className="form-group"><label className="input-label">Client Name</label><input type="text" className="input-field" value={formData.client_name} onChange={e => setFormData({...formData, client_name: e.target.value})} placeholder="Internal reference" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="input-label">Case Number</label><input type="text" className="input-field" value={formData.case_number} onChange={e => setFormData({...formData, case_number: e.target.value})} placeholder="e.g., CRA/123/2026" /></div>
                  <div className="form-group"><label className="input-label">CNR Number</label><input type="text" className="input-field" value={formData.cnr_number} onChange={e => setFormData({...formData, cnr_number: e.target.value})} placeholder="16-digit official ID" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="input-label">Case Type</label><input type="text" className="input-field" value={formData.case_type} onChange={e => setFormData({...formData, case_type: e.target.value})} placeholder="e.g., Civil, Criminal, IP" /></div>
                  <div className="form-group"><label className="input-label">Court</label><input type="text" className="input-field" value={formData.court} onChange={e => setFormData({...formData, court: e.target.value})} placeholder="e.g., Delhi High Court" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="input-label">Next Hearing</label><input type="date" className="input-field" value={formData.next_hearing} onChange={e => setFormData({...formData, next_hearing: e.target.value})} /></div>
                  <div className="form-group"><label className="input-label">Last Hearing</label><input type="date" className="input-field" value={formData.last_hearing} onChange={e => setFormData({...formData, last_hearing: e.target.value})} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="input-label">Status</label>
                    <select className="input-field" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                      <option value="Active">Active</option>
                      <option value="Disposed">Disposed</option>
                      <option value="Pending Filing">Pending Filing</option>
                    </select>
                  </div>
                </div>
                <div className="form-group"><label className="input-label">Notes</label><textarea className="input-field" rows="3" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Strategy notes or updates…" style={{ resize: 'none' }}></textarea></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn-accent" disabled={savingCase}>{savingCase ? 'Saving…' : 'Save Case'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
