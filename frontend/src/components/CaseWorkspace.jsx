import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getSharedFiles, subscribeSharedFiles } from '../utils/sharedWorkspaceStore';
import { useChamberStore, getItemsInFolder, getFolderPath } from '../stores/useChamberStore';
import { useVaultTree } from '../hooks/useVaultTree';
import { useVaultProvenance } from '../hooks/useVaultProvenance';
import { useAuth } from '../context/AuthContext';
import { useContextMenu } from '../hooks/useContextMenu';
import ContextMenu from './vault/ContextMenu';
import ShareModal from './vault/ShareModal';
import MoveModal from './vault/MoveModal';
import ConfirmDeleteDialog from './vault/ConfirmDeleteDialog';
import SyncToast from './vault/SyncToast';
import VaultDocViewer from './vault/VaultDocViewer';
import { vaultApi } from './vault/vaultApi';
import { pr } from './practice/api';
import { Folder, FileText, MoreVertical, Users, Lock, Search, FileImage, FileSpreadsheet, FileCode, FileArchive } from 'lucide-react';

// File-type-aware icon for a document card, keyed off case_vault.file_format
// (the caller's own extension for real uploads; 'pdf'/'docx' for
// server-generated exports — see app.py's download route comment on why
// those two are special-cased there too).
const FILE_TYPE_ICONS = {
  png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage, webp: FileImage, svg: FileImage,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet,
  zip: FileArchive, rar: FileArchive, '7z': FileArchive,
  json: FileCode, js: FileCode, jsx: FileCode, ts: FileCode, py: FileCode, html: FileCode, css: FileCode,
};
function getVaultFileIcon(fileFormat) {
  return FILE_TYPE_ICONS[(fileFormat || '').toLowerCase()] || FileText;
}

function formatBreadcrumbs(path) {
  if (!path || path.length <= 4) return path;
  return [
    path[0],
    { id: '__ellipsis__', name: '...', isEllipsis: true },
    path[path.length - 2],
    path[path.length - 1],
  ];
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// ── Practice case -> Case Tracker card ───────────────────────────────────
// The Case Tracker has no data of its own: it shows the cases from Practice (the same rows, the same permissions),
// so a case created in Practice appears here and a case added here appears in Practice.
const MS_DAY = 86400000;
function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / MS_DAY);
}
function hearingNote(iso) {
  const n = daysUntil(iso);
  if (n === null || n < 0) return null;
  if (n === 0) return 'Hearing today';
  if (n === 1) return 'Hearing tomorrow';
  return n <= 14 ? `Hearing in ${n} days` : null;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function caseToMatter(c, docsByCase) {
  return {
    id: c.id,
    caseName: c.title,
    caseNumber: c.case_no,
    court: c.court,
    judge: c.judge,
    caseType: c.case_type,
    clientName: c.client_name,
    oppositeParty: c.opposite_party,
    advocate: c.advocate_name,
    filingDate: c.filing_date,
    nextHearing: c.next_hearing,
    lastHearing: c.last_hearing,
    status: c.status,
    priority: c.priority,
    closed: c.closed,
    urgent: c.closed ? null : hearingNote(c.next_hearing),
    docsLinked: (docsByCase || {})[String(c.id)] || 0,
  };
}
// Plain-language brief built only from what is really in the vault (used when the AI service does not answer).
function buildSynopsis(matters, docs, overview) {
  const paras = [];
  if (matters.length) {
    const open = matters.filter((m) => !m.closed);
    const upcoming = open.filter((m) => m.nextHearing && daysUntil(m.nextHearing) >= 0)
      .sort((a, b) => String(a.nextHearing).localeCompare(String(b.nextHearing)));
    let t = `You are tracking ${matters.length} matter${matters.length === 1 ? '' : 's'}, ${open.length} of them open.`;
    if (upcoming.length) {
      t += ' Next on the list: ' + upcoming.slice(0, 3).map((m) => `${m.caseName} (${m.caseNumber}) on ${fmtDate(m.nextHearing)}`).join('; ') + '.';
    } else if (open.length) {
      t += ' None of the open matters has an upcoming hearing listed.';
    }
    paras.push(t);
  }
  if (docs.length) {
    const classes = (overview?.category_names || []).slice(0, 5);
    paras.push(`The vault holds ${docs.length} document${docs.length === 1 ? '' : 's'}` + (classes.length ? `, including ${classes.join(', ')}.` : '.')
      + ((overview?.documents_this_week || 0) ? ` ${overview.documents_this_week} arrived in the last 7 days.` : ''));
  }
  return paras.join('\n\n');
}

// ── Provenance Trail formatting helpers ──────────────────────────────────
// The action strings here match app.py's _write_provenance call sites
// exactly (create/rename/move/delete/upload/share/unshare/link toggle,
// plus the blueprint-init and vault_audit "ai_generated" pseudo-action).
const PROVENANCE_ACTION_LABELS = {
  created: 'Created',
  renamed: 'Renamed',
  moved: 'Moved',
  deleted: 'Deleted',
  uploaded: 'Uploaded',
  shared: 'Shared',
  unshared: 'Access revoked',
  link_shared: 'Link sharing enabled',
  link_unshared: 'Link sharing disabled',
  blueprint_applied: 'Standard blueprint applied',
  ai_generated: 'Generated via AI',
};

function provenanceActionLabel(entry) {
  return PROVENANCE_ACTION_LABELS[entry.action] || entry.action;
}

function provenanceDetailSummary(entry) {
  const d = entry.detail || {};
  switch (entry.action) {
    case 'renamed':
      return d.old_name || d.old_title ? `"${d.old_name || d.old_title}" → "${d.new_name || d.new_title}"` : '';
    case 'moved':
      return 'parent_id' in d || 'old_parent_id' in d || 'old_folder_id' in d ? 'Relocated within the vault' : '';
    case 'shared':
      return `${d.member_name || d.member_email || 'A team member'} · ${d.permission === 'edit' ? 'can edit' : 'can view'}`;
    case 'unshared':
      return d.member_name || d.member_email ? `${d.member_name || d.member_email}` : '';
    case 'uploaded':
      return d.size_bytes ? `${Math.round(d.size_bytes / 1024)} KB` : '';
    case 'blueprint_applied':
      return Array.isArray(d.folders) ? `${d.folders.length} folders created` : '';
    case 'ai_generated':
      return d.session_title || '';
    default:
      return '';
  }
}

function provenanceActorLabel(entry, currentUser) {
  if (entry.source === 'audit') return 'LexAmplify AI';
  if (entry.actor_user_id == null) return 'System';
  if (currentUser && Number(entry.actor_user_id) === Number(currentUser.id)) return 'You';
  return 'Team member';
}

function provenanceRelativeTime(raw) {
  if (!raw) return '';
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return raw;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const styles = `
  .cv-root {
    --bg: #191C1D;
    --paper: #212527;
    --paper-2: #2A2F31;
    --ink: #D6D9D9;
    --ink-soft: #AAAEAE;
    --muted: #727776;
    --muted-2: #494E4D;
    --rule: #333939;
    --accent: #CC6B48;
    --accent-soft: #3B281F;
    --major: #D9AD5C;
    --major-soft: #35301C;
    --on-accent: #FBF7EE;
    --shadow: 0 20px 50px rgba(0,0,0,.45);
    --overlay: rgba(10,10,10,.65);
    font-family: 'IBM Plex Sans', sans-serif;
    color: var(--ink);
    background: var(--bg);
    min-height: calc(100vh - 60px);
    box-sizing: border-box;
    transition: background .2s ease, color .2s ease;
  }

  :root[data-theme="light"] .cv-root, .cv-root.theme-light {
    --bg: #DFE1E0;
    --paper: #EAEBE8;
    --paper-2: #E3E4E1;
    --ink: #181B1D;
    --ink-soft: #494E51;
    --muted: #868C8E;
    --muted-2: #B3B8B9;
    --rule: #D2D5D4;
    --accent: #B24A2E;
    --accent-soft: #EFDCD1;
    --major: #9C7A2E;
    --major-soft: #F1E6C9;
    --on-accent: #FBF7EE;
    --shadow: 0 20px 50px rgba(30,25,18,.14);
    --overlay: rgba(24,20,15,.45);
  }

  .cv-serif { font-family: 'Fraunces', Georgia, serif; font-style: italic; }
  .cv-mono { font-family: 'IBM Plex Mono', monospace; }

  .cv-topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 28px 36px 0; }
  .cv-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  .cv-page-title { font-size: 28px; margin: 6px 0 0; line-height: 1.2; }
  .cv-title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
  .cv-page-sub { font-size: 13px; color: var(--ink-soft); margin-top: 7px; max-width: 680px; line-height: 1.5; }

  .cv-badge {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px;
    border-radius: 999px; font-size: 11.5px; font-weight: 500;
    background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule);
  }
  .cv-badge svg { flex-shrink: 0; }

  .cv-topbar-actions { display: flex; align-items: center; gap: 10px; padding-top: 2px; }
  .cv-search {
    display: flex; align-items: center; gap: 8px; background: var(--paper);
    border: 1px solid var(--rule); border-radius: 10px; padding: 8px 12px; width: 260px; color: var(--muted);
  }
  .cv-search input { border: 0; background: transparent; outline: 0; color: var(--ink); font-size: 13px; width: 100%; font-family: inherit; }
  .cv-search input::placeholder { color: var(--muted); }
  .cv-kbd { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; color: var(--muted); border: 1px solid var(--rule); border-radius: 4px; padding: 1px 5px; }

  /* ── TABS ── */
  .cv-tabs { display: flex; gap: 4px; padding: 24px 36px 0; border-bottom: 1px solid var(--rule); overflow-x: auto; }
  .cv-tab {
    display: flex; align-items: center; gap: 8px; padding: 11px 14px; border: 0;
    background: transparent; color: var(--muted); font-size: 13.5px; font-weight: 500;
    cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; font-family: inherit;
    transition: color 0.15s, border-color 0.15s;
  }
  .cv-tab svg { color: var(--muted); transition: color 0.15s; }
  .cv-tab:hover { color: var(--ink-soft); }
  .cv-tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
  .cv-tab.active svg { color: var(--accent); }
  .cv-tab-count {
    font-family: 'IBM Plex Mono', monospace; font-size: 10px; background: var(--paper-2);
    color: var(--muted); border-radius: 999px; padding: 1px 6px;
  }
  .cv-tab.active .cv-tab-count { background: var(--accent-soft); color: var(--accent); }

  /* ── CONTENT PANELS ── */
  .cv-content { padding: 28px 36px 70px; display: flex; flex-direction: column; gap: 26px; }
  .cv-panel { display: flex; flex-direction: column; gap: 24px; animation: cv-fade-in 0.18s ease; }
  @keyframes cv-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  /* ── STATS GRID ── */
  .cv-stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 16px; }
  .cv-stat-tile { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
  .cv-stat-icon { width: 30px; height: 30px; border-radius: 8px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; }
  .cv-stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 500; }
  .cv-stat-value { font-family: 'IBM Plex Mono', monospace; font-size: 27px; font-weight: 600; color: var(--ink); }
  .cv-stat-sub { font-size: 11.5px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
  .cv-stat-sub.flag { color: var(--accent); font-weight: 600; }

  /* ── CARDS ── */
  .cv-card { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 22px; }
  .cv-card-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
  .cv-card-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  .cv-card-title { font-size: 17px; margin: 4px 0 0; }
  .cv-card-body-text { font-size: 13.5px; color: var(--ink-soft); line-height: 1.65; }
  .cv-card-body-text p { margin: 0 0 10px; }
  .cv-card-body-text p:last-child { margin-bottom: 0; }
  .cv-card-body-text b { color: var(--ink); font-weight: 600; }

  /* ── BUTTONS ── */
  .cv-btn {
    display: inline-flex; align-items: center; gap: 8px; padding: 9px 16px;
    border-radius: 9px; font-size: 13px; font-weight: 500; cursor: pointer;
    border: 1px solid var(--rule); background: var(--paper); color: var(--ink);
    font-family: inherit; transition: all 0.15s;
  }
  .cv-btn:hover { border-color: var(--accent); color: var(--accent); }
  .cv-btn svg { flex-shrink: 0; }
  .cv-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .cv-btn-primary:hover { filter: brightness(1.08); color: var(--on-accent); }
  .cv-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .cv-btn-sm { padding: 6px 12px; font-size: 12px; }
  .cv-link-toggle { background: none; border: 0; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; font-size: 12px; cursor: pointer; padding: 0; font-family: inherit; }
  .cv-link-toggle:hover { color: var(--accent); }

  /* ── QUICK ACTIONS ── */
  .cv-quick-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
  .cv-quick-btn {
    background: var(--paper); border: 1px solid var(--rule); border-radius: 12px;
    padding: 16px; display: flex; flex-direction: column; gap: 10px; cursor: pointer;
    color: var(--ink); text-align: left; font-family: inherit; transition: border-color 0.15s, transform 0.1s;
  }
  .cv-quick-btn:hover { border-color: var(--accent); transform: translateY(-1px); }
  .cv-quick-icon { width: 30px; height: 30px; border-radius: 9px; background: var(--paper-2); color: var(--accent); display: flex; align-items: center; justify-content: center; }
  .cv-quick-label { font-size: 13px; font-weight: 600; }

  /* ── CHIPS ── */
  .cv-chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 500; font-family: 'IBM Plex Mono', monospace; }
  .cv-chip-neutral { background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule); }
  .cv-chip-major { background: var(--major-soft); color: var(--major); font-weight: 600; }
  .cv-chip-accent { background: var(--accent-soft); color: var(--accent); font-weight: 600; }

  /* ── VAULT PANEL ── */
  .cv-section-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  .cv-section-title { font-size: 20px; margin: 0; }
  .cv-section-sub { font-size: 13px; color: var(--ink-soft); margin-top: 5px; max-width: 560px; line-height: 1.5; }

  .cv-dropzone {
    border: 1.5px dashed var(--rule); border-radius: 13px; padding: 24px;
    display: flex; align-items: center; gap: 16px; background: var(--paper);
    cursor: pointer; transition: border-color 0.15s, background-color 0.15s;
  }
  .cv-dropzone:hover, .cv-dropzone.dragover { border-color: var(--accent); background: var(--accent-soft); }
  .cv-dropzone-icon { width: 44px; height: 44px; border-radius: 12px; background: var(--paper-2); color: var(--accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cv-dropzone-title { font-size: 14px; font-weight: 600; color: var(--ink); }
  .cv-dropzone-sub { font-size: 12px; color: var(--muted); margin-top: 3px; }

  /* ---------- Document Vault tree grid (real recursive folders/documents) ---------- */
  .cv-vault-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-family: 'IBM Plex Mono', monospace; color: var(--muted); margin-bottom: 16px; overflow-x: auto; padding: 2px 0; }
  .cv-vault-breadcrumb-item { background: none; border: none; padding: 0; font-family: inherit; font-size: inherit; color: var(--muted); cursor: pointer; white-space: nowrap; }
  .cv-vault-breadcrumb-item:hover { color: var(--accent); }
  .cv-vault-breadcrumb-item.current { color: var(--ink); font-weight: 600; cursor: default; }
  .cv-vault-breadcrumb-item.current:hover { color: var(--ink); }
  .cv-vault-breadcrumb-sep { color: var(--rule); }
  .cv-vault-breadcrumb-ellipsis { color: var(--muted); padding: 0 2px; user-select: none; }

  .cv-vault-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
  .cv-vault-card {
    position: relative; background: var(--paper); border: 1px solid var(--rule); border-radius: 13px;
    padding: 16px; cursor: pointer; transition: border-color 0.15s ease; display: flex;
    flex-direction: column; justify-content: space-between; height: 128px; user-select: none;
  }
  .cv-vault-card:hover { border-color: var(--accent); }
  .cv-vault-card-top { display: flex; align-items: center; justify-content: space-between; width: 100%; }
  .cv-vault-card-top-left { display: flex; align-items: center; gap: 6px; }
  .cv-vault-card-icon { padding: 8px; border-radius: 8px; background: var(--paper-2); color: var(--accent); display: flex; align-items: center; justify-content: center; }
  .cv-vault-card-share-badge { width: 20px; height: 20px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; }
  .cv-vault-card-kebab { padding: 6px; border-radius: 6px; border: none; background: transparent; color: var(--muted); cursor: pointer; opacity: 0.7; transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease; }
  .cv-vault-card:hover .cv-vault-card-kebab { opacity: 1; }
  .cv-vault-card-kebab:hover { background: var(--paper-2); color: var(--ink); }
  .cv-vault-card-body { margin-top: 8px; min-width: 0; }
  .cv-vault-card-name { font-family: 'Fraunces', serif; font-style: italic; font-weight: 500; font-size: 13.5px; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cv-vault-card-meta { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
  .cv-vault-card-rename-input { width: 100%; background: var(--paper-2); border: 1px solid var(--accent); border-radius: 6px; padding: 4px 7px; font-size: 12.5px; color: var(--ink); font-family: inherit; outline: none; box-sizing: border-box; }
  .cv-vault-card-lock { width: 20px; height: 20px; border-radius: 6px; background: var(--major-soft); color: var(--major); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cv-vault-card.is-dragover { border-color: var(--accent); background: var(--accent-soft); }

  .cv-vault-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .cv-vault-toolbar-spacer { flex: 1 1 auto; }
  .cv-vault-search {
    display: flex; align-items: center; gap: 7px; background: var(--paper-2); border: 1px solid var(--rule);
    border-radius: 9px; padding: 7px 12px; min-width: 200px; color: var(--muted);
  }
  .cv-vault-search input { border: 0; background: transparent; outline: 0; color: var(--ink); font-size: 12.5px; width: 100%; font-family: inherit; }
  .cv-vault-search input::placeholder { color: var(--muted); }

  .cv-folder-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 14px; }
  .cv-folder-card {
    background: var(--paper); border: 1px solid var(--rule); border-radius: 13px;
    padding: 16px; cursor: pointer; text-align: left; color: var(--ink);
    font-family: inherit; transition: border-color 0.15s, background-color 0.15s; width: 100%;
  }
  .cv-folder-card:hover { border-color: var(--accent); }
  .cv-folder-card.open { border-color: var(--accent); background: var(--paper); }
  .cv-folder-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .cv-folder-icon { width: 34px; height: 34px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); display: flex; align-items: center; justify-content: center; }
  .cv-folder-card.open .cv-folder-icon { background: var(--accent); color: var(--on-accent); }
  .cv-chevron { color: var(--muted); transition: transform .15s ease; }
  .cv-folder-card.open .cv-chevron { transform: rotate(90deg); color: var(--accent); }
  .cv-folder-name { font-size: 14.5px; font-weight: 500; }
  .cv-folder-meta { font-size: 11px; color: var(--muted); margin-top: 3px; font-family: 'IBM Plex Mono', monospace; }

  .cv-doc-list { margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--rule); display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; }
  .cv-doc-row { display: flex; align-items: center; gap: 9px; padding: 7px 8px; border-radius: 8px; transition: background 0.12s; }
  .cv-doc-row:hover { background: var(--paper-2); }
  .cv-doc-icon { width: 26px; height: 26px; border-radius: 7px; background: var(--paper-2); color: var(--ink-soft); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cv-doc-name { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; color: var(--ink); }
  .cv-doc-tag { font-size: 10px; font-family: 'IBM Plex Mono', monospace; margin-top: 1px; }
  .cv-doc-tag.neutral { color: var(--muted); }
  .cv-doc-tag.review { color: var(--major); font-weight: 600; }
  .cv-doc-meta { font-size: 10.5px; color: var(--muted); margin-left: auto; text-align: right; font-family: 'IBM Plex Mono', monospace; white-space: nowrap; }

  .cv-empty { text-align: center; padding: 62px 30px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .cv-empty-icon { width: 52px; height: 52px; border-radius: 15px; background: var(--paper-2); color: var(--muted); display: flex; align-items: center; justify-content: center; margin-bottom: 6px; }
  .cv-empty-title { font-size: 16px; margin: 0; }
  .cv-empty-sub { font-size: 13px; color: var(--ink-soft); max-width: 420px; line-height: 1.55; margin: 0; }

  /* ── MATTERS / CASE TRACKER ── */
  .cv-cnr-row { display: flex; gap: 10px; }
  .cv-cnr-input {
    flex-grow: 1; background: var(--paper-2); border: 1px solid var(--rule);
    border-radius: 9px; padding: 10px 14px; font-family: 'IBM Plex Mono', monospace;
    font-size: 13px; color: var(--ink); outline: none; transition: border-color 0.15s;
  }
  .cv-cnr-input:focus { border-color: var(--accent); }
  .cv-cnr-input::placeholder { color: var(--muted); font-family: 'IBM Plex Sans', sans-serif; }
  .cv-cnr-result {
    margin-top: 14px; padding: 14px 16px; border-radius: 12px;
    background: var(--accent-soft); border: 1px solid var(--accent);
    display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  }
  .cv-cnr-result-title { font-size: 13.5px; font-weight: 600; color: var(--ink); }
  .cv-cnr-result-meta { font-size: 11.5px; color: var(--ink-soft); margin-top: 3px; font-family: 'IBM Plex Mono', monospace; }

  .cv-matter-list { display: flex; flex-direction: column; gap: 14px; }
  .cv-matter-card { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 20px 22px; }
  .cv-matter-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .cv-matter-name { font-size: 16.5px; margin: 0; color: var(--ink); font-weight: 600; }
  .cv-matter-num { font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--muted); margin-top: 5px; }
  .cv-matter-urgent { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--accent); font-family: 'IBM Plex Mono', monospace; margin-top: 6px; font-weight: 600; }
  .cv-matter-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; padding-top: 14px; margin-top: 14px; border-top: 1px solid var(--rule); }
  .cv-matter-field-label { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .cv-matter-field-value { font-size: 12.5px; font-weight: 500; margin-top: 3px; color: var(--ink); }
  .cv-link-chip { font-size: 11px; color: var(--accent); font-family: 'IBM Plex Mono', monospace; display: flex; align-items: center; gap: 5px; margin-top: 3px; font-weight: 600; }

  /* ── PROVENANCE TRAIL ── */
  .cv-trail-item { display: flex; gap: 14px; }
  .cv-trail-rail { display: flex; flex-direction: column; align-items: center; }
  .cv-trail-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); margin-top: 5px; flex-shrink: 0; }
  .cv-trail-line { width: 1px; flex-grow: 1; background: var(--rule); margin-top: 4px; }
  .cv-trail-body { padding-bottom: 22px; flex-grow: 1; }
  .cv-trail-item:last-child .cv-trail-body { padding-bottom: 0; }
  .cv-trail-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .cv-trail-action { font-size: 13.5px; font-weight: 600; color: var(--ink); }
  .cv-trail-time { font-size: 11px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; white-space: nowrap; }
  .cv-trail-meta { font-size: 11.5px; color: var(--ink-soft); margin-top: 3px; }
  .cv-trail-actor { color: var(--muted); }
  .cv-trail-hash {
    display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: 10.5px;
    color: var(--accent); background: var(--bg); border: 1px solid var(--rule);
    border-radius: 6px; padding: 2px 8px; margin-top: 7px;
  }
  .cv-verify-banner {
    font-size: 12.5px; padding: 11px 14px; border-radius: 9px; margin-bottom: 16px;
    border: 1px solid var(--rule); line-height: 1.5;
  }
  .cv-verify-banner.ok { background: var(--major-soft); color: var(--major); border-color: var(--major); }
  .cv-verify-banner.broken { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }

  /* ── TIMELINE ── */
  .cv-tl-item { display: flex; gap: 16px; }
  .cv-tl-date { width: 96px; flex-shrink: 0; text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--muted); padding-top: 2px; }
  .cv-tl-rail { display: flex; flex-direction: column; align-items: center; }
  .cv-tl-dot { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--accent); background: var(--paper); margin-top: 5px; flex-shrink: 0; }
  .cv-tl-line { width: 1px; flex-grow: 1; background: var(--rule); }
  .cv-tl-body { padding-bottom: 24px; }
  .cv-tl-item:last-child .cv-tl-body { padding-bottom: 0; }
  .cv-tl-label { font-size: 13.5px; font-weight: 500; color: var(--ink); }
  .cv-tl-source { font-size: 11px; color: var(--muted); margin-top: 3px; font-family: 'IBM Plex Mono', monospace; }

  /* ── ADD MATTER MODAL ── */
  .cv-modal-overlay {
    position: fixed; inset: 0; background: var(--overlay);
    display: flex; align-items: center; justify-content: center; padding: 30px; z-index: 2000;
    backdrop-filter: blur(2px);
  }
  .cv-modal {
    background: var(--paper); border: 1px solid var(--rule); border-radius: 16px;
    box-shadow: var(--shadow); width: 100%; max-width: 760px; max-height: 88vh;
    overflow-y: auto; display: flex; flex-direction: column;
  }
  .cv-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 24px; border-bottom: 1px solid var(--rule); position: sticky; top: 0;
    background: var(--paper); z-index: 10;
  }
  .cv-modal-title { font-size: 19px; margin: 4px 0 0; }
  .cv-modal-body { padding: 24px; display: flex; flex-direction: column; gap: 24px; }
  .cv-modal-footer {
    display: flex; justify-content: flex-end; gap: 10px; padding: 18px 24px;
    border-top: 1px solid var(--rule); position: sticky; bottom: 0; background: var(--paper); z-index: 10;
  }
  .cv-field-section-title { font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--accent); font-weight: 600; margin-bottom: 12px; }
  .cv-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 14px; }
  .cv-field { display: flex; flex-direction: column; gap: 6px; }
  .cv-field label { font-size: 12px; font-weight: 500; color: var(--ink-soft); }
  .cv-req { color: var(--accent); }
  .cv-field input, .cv-field select, .cv-field textarea {
    background: var(--paper-2); border: 1px solid var(--rule); border-radius: 8px;
    padding: 9px 11px; font-size: 13px; color: var(--ink); width: 100%; box-sizing: border-box;
    font-family: inherit; outline: none; transition: border-color 0.15s;
  }
  .cv-field input:focus, .cv-field select:focus, .cv-field textarea:focus { border-color: var(--accent); }
  .cv-field input::placeholder, .cv-field textarea::placeholder { color: var(--muted); }
  .cv-field textarea { resize: vertical; }
  .cv-modal-dropzone { border: 1.5px dashed var(--rule); border-radius: 12px; padding: 16px; display: flex; align-items: center; gap: 14px; background: var(--paper-2); }

  /* ── RESPONSIVE ── */
  @media (max-width: 880px) {
    .cv-stat-grid, .cv-quick-grid, .cv-folder-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .cv-matter-grid, .cv-field-grid { grid-template-columns: 1fr; }
    .cv-topbar { flex-direction: column; }
    .cv-topbar-actions { width: 100%; }
    .cv-search { width: 100%; }
  }
  @media (max-width: 560px) {
    .cv-stat-grid, .cv-quick-grid, .cv-folder-grid { grid-template-columns: 1fr; }
    .cv-content, .cv-topbar, .cv-tabs { padding-left: 18px; padding-right: 18px; }
  }
`;

export default function CaseWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    activeFolderId,
    setActiveFolderId,
    setSyncProgress,
    syncProgress,
  } = useChamberStore();

  // Real, backend-persisted folder/document tree — replaces the old
  // Zustand-only `vaultItems` array, which lost the entire vault on every
  // page refresh (see the Phase 1 plan).
  const vault = useVaultTree();
  const { user: currentUser } = useAuth();

  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  // Modal target states
  const [itemToShare, setItemToShare] = useState(null);
  const [itemToMove, setItemToMove] = useState(null);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [vaultSearch, setVaultSearch] = useState('');
  const [isVaultDragOver, setIsVaultDragOver] = useState(false);

  // Hidden file input refs
  const folderInputRef = useRef(null);
  // Set by the context menu's "Upload here" before programmatically
  // clicking the shared file input — lets one hidden <input> serve both the
  // toolbar's "Upload document" (into activeFolderId) and a specific
  // folder's "Upload here" (into that folder, regardless of which folder is
  // currently open) without duplicating the file-input/handler pair.
  const uploadHereFolderIdRef = useRef(null);

  // Tab State
  const [activeTab, setActiveTab] = useState('overview');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');

  // Matters State
  const [matters, setMatters] = useState([]);
  const [mattersState, setMattersState] = useState({ loading: true, error: null, noPractice: false });
  const [overview, setOverview] = useState(null);
  const [practiceMeta, setPracticeMeta] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [cnrError, setCnrError] = useState(null);
  const [matterSaving, setMatterSaving] = useState(false);
  const [matterError, setMatterError] = useState(null);
  const [addMatterOpen, setAddMatterOpen] = useState(false);
  const [cnrSearchInput, setCnrSearchInput] = useState('');
  const [cnrResult, setCnrResult] = useState(null);
  const [cnrLoading, setCnrLoading] = useState(false);

  // 16-Field Add Matter Form State
  const [matterForm, setMatterForm] = useState({
    caseName: '',
    caseNumber: '',
    caseType: 'Civil',
    cnr: '',
    court: '',
    judge: '',
    petitioner: '',
    respondent: '',
    petitionerCounsel: '',
    respondentCounsel: '',
    filingDate: '',
    nextHearing: '',
    lastHearing: '',
    status: 'Active',
    clientName: '',
    summary: '',
    notes: '',
  });

  // AI Synopsis State
  const [synopsis, setSynopsis] = useState('');
  const [synopsisLoading, setSynopsisLoading] = useState(false);

  // Provenance & Timeline State
  const provenance = useVaultProvenance();
  // Re-fetch whenever the tab is opened, not just on mount — vault
  // mutations happen from the Document Vault tab, so the trail would
  // otherwise show a stale snapshot from whenever CaseWorkspace first loaded.
  useEffect(() => {
    if (activeTab === 'trail') provenance.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [timelineState, setTimelineState] = useState({ loading: true, error: null, deep: false });
  const timelineSeq = useRef(0);
  const mattersSeq = useRef(0);

  // Upload State
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Shared platform files
  const [sharedFiles, setSharedFiles] = useState(() => getSharedFiles().filter(f => f.modules?.includes('case-vault')));
  useEffect(() => {
    return subscribeSharedFiles(all => setSharedFiles(all.filter(f => f.modules?.includes('case-vault'))));
  }, []);

  // Real vault documents (from useVaultTree, backed by GET /api/vault/meta)
  // mapped onto the display shape the Overview stats / Legal Drafts tab
  // already expect — replaces the old separate `folderDocs` fetch, which
  // populated a second, disconnected document list that the vault grid
  // itself never read from.
  const allDocs = useMemo(() => {
    return (vault.documents || []).map((d) => ({
      id: d.id,
      name: d.smart_title || d.title || 'Untitled document',
      tag: d.doc_type ? d.doc_type.toUpperCase() : 'DOCUMENT',
      tagSeverity: (d.doc_type || '').toLowerCase().includes('review') ? 'review' : 'neutral',
      size: d.size_bytes ? `${Math.round(d.size_bytes / 1024)} KB` : '—',
      updated: d.created_at ? new Date(d.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—',
      folderId: d.folder_id,
    }));
  }, [vault.documents]);

  const totalDocCount = allDocs.length;
  const activeMatterCount = matters.filter(m => (m.status || '').toLowerCase() === 'active').length;
  const draftCount = allDocs.filter(d => (d.name || '').toLowerCase().includes('draft') || (d.tag || '').toLowerCase().includes('draft')).length;

  // Handle Tab Switch
  const goTab = (tabName) => {
    setActiveTab(tabName);
  };

  // ── Live data ────────────────────────────────────────────────────────────
  const loadMatters = useCallback(async () => {
    const seq = ++mattersSeq.current;
    try {
      const [cases, ov] = await Promise.all([
        pr.get('/cases', { per_page: 100, sort: 'next_hearing' }),
        vaultApi.overview().catch(() => null),
      ]);
      if (seq !== mattersSeq.current) return;
      setMatters((cases.cases || []).map((c) => caseToMatter(c, ov?.case_docs)));
      setOverview(ov);
      setMattersState({ loading: false, error: null, noPractice: false });
    } catch (e) {
      if (seq !== mattersSeq.current) return;
      const noFirm = e?.extra?.code === 'NO_FIRM';
      vaultApi.overview().then((ov) => { if (seq === mattersSeq.current) setOverview(ov); }).catch(() => {});
      setMatters([]);
      setMattersState({ loading: false, error: noFirm ? null : (e?.message || 'Could not load your matters.'), noPractice: noFirm });
    }
  }, []);

  const loadTimeline = useCallback(async (deep = false) => {
    const seq = ++timelineSeq.current;
    setTimelineState((st) => ({ ...st, loading: true, error: null }));
    try {
      const r = await vaultApi.timeline(deep);
      if (seq !== timelineSeq.current) return;
      setTimelineEvents(r.events || []);
      setTimelineState({ loading: false, error: null, deep });
    } catch (e) {
      if (seq !== timelineSeq.current) return;
      setTimelineState((st) => ({ ...st, loading: false, error: e?.message || 'Could not build the timeline.' }));
    }
  }, []);

  const refreshAll = useCallback(() => {
    loadMatters();
    loadTimeline(timelineState.deep);
  }, [loadMatters, loadTimeline, timelineState.deep]);

  useEffect(() => { loadMatters(); loadTimeline(false); }, [loadMatters, loadTimeline]);
  // Practice case types / statuses for the Add-matter form
  useEffect(() => { pr.get('/me').then((me) => setPracticeMeta(me?.meta || null)).catch(() => {}); }, []);
  // Numbers and the timeline are re-read whenever you open those tabs, return to this window, or the document list changes.
  useEffect(() => {
    if (activeTab === 'overview' || activeTab === 'matters') loadMatters();
    if (activeTab === 'timeline') loadTimeline(timelineState.deep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refreshAll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshAll]);
  const docCountSeen = useRef(null);
  useEffect(() => {
    const n = (vault.documents || []).length;
    if (docCountSeen.current !== null && docCountSeen.current !== n) refreshAll();
    docCountSeen.current = n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.documents]);
  // The sidebar's "N tracked matters" reads the same number.
  useEffect(() => {
    if (mattersState.loading) return;
    window.dispatchEvent(new CustomEvent('lex:vault-matters', { detail: { count: matters.length } }));
  }, [matters, mattersState.loading]);

  const openViewer = (item) => setViewer({ id: item.id, name: item.name || item.title });
  const fail = (e, fallback) => setActionError((e && e.message) || fallback);

  // Quick CNR lookup — shows exactly what eCourts returned; nothing is filled in on its behalf.
  const handleFetchCnr = async () => {
    const cnr = cnrSearchInput.trim();
    if (!cnr) return;
    setCnrLoading(true); setCnrResult(null); setCnrError(null);
    try {
      const res = await fetch(`${API_BASE}/api/causelist/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cnr_number: cnr }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && (data.case_title || data.case_number)) {
        setCnrResult({
          cnr,
          title: data.case_title || data.case_number,
          meta: [data.case_number || cnr, data.next_hearing && `Next hearing ${data.next_hearing}`, data.court].filter(Boolean).join(' · '),
          raw: data,
        });
      } else {
        setCnrError((typeof data?.message === 'string' && data.message) || 'No case was found for that CNR. Check the number, or add the matter manually.');
      }
    } catch {
      setCnrError('Could not reach eCourts just now. Try again in a moment, or add the matter manually.');
    } finally {
      setCnrLoading(false);
    }
  };

  const openAddMatter = (prefill = {}) => {
    setMatterError(null);
    setMatterForm((f) => ({ ...f, ...prefill }));
    setAddMatterOpen(true);
  };

  const handleAddCnrToTracker = () => {
    if (!cnrResult) return;
    const d = cnrResult.raw || {};
    openAddMatter({
      caseName: d.case_title || '',
      caseNumber: d.case_number || '',
      court: d.court || '',
      cnr: cnrResult.cnr,
      nextHearing: /^\d{4}-\d{2}-\d{2}$/.test(String(d.next_hearing || '')) ? d.next_hearing : '',
    });
    setCnrResult(null);
    setCnrSearchInput('');
  };

  // AI synopsis — grounded in the real matters and documents; the fallback is built from the same data.
  const handleGenerateSynopsis = async () => {
    if (!matters.length && !allDocs.length) {
      setSynopsis('There is nothing to summarise yet. Add a matter in Case Tracker or upload a document, and this brief will be built from them.');
      return;
    }
    setSynopsisLoading(true);
    const fallback = buildSynopsis(matters, allDocs, overview);
    const matterLines = matters.map((m) => `- ${m.caseName} (${m.caseNumber}, ${m.court}); status ${m.status}; next hearing ${m.nextHearing || 'none listed'}; ${m.docsLinked} linked documents`).join('\n');
    const docLines = allDocs.slice(0, 60).map((d) => `- ${d.name} [${d.tag}]`).join('\n');
    try {
      const res = await fetch(`${API_BASE}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[Case Vault Analysis]\n\nMatters:\n${matterLines || '(none)'}\n\nDocuments:\n${docLines || '(none)'}\n\nSummarize the active status, upcoming hearings, and review requirements across this vault in 2 concise paragraphs. Use only the matters and documents listed above and do not invent anything else.`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setSynopsis(res.ok && data && typeof data.response === 'string' && data.response.trim() ? data.response : fallback);
    } catch {
      setSynopsis(fallback);
    } finally {
      setSynopsisLoading(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const dt = e.dataTransfer;
    // Collect everything NOW: the browser empties dataTransfer as soon as this handler first awaits.
    const entries = Array.from(dt?.items || []).map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
    const loose = entries.length ? [] : Array.from(dt?.files || []);
    if (!entries.length && !loose.length) return;
    setSyncProgress({ isSyncing: true, current: 0, total: entries.length || loose.length, currentName: '' });
    let count = 0;
    try {
      for (const entry of entries) count = await traverseFileTree(entry, activeFolderId, count);
      for (const file of loose) { await vault.uploadFile(file, activeFolderId); count += 1; setSyncProgress({ current: count }); }
    } catch (err) {
      fail(err, 'Some items could not be uploaded.');
    } finally {
      setSyncProgress({ isSyncing: false, current: count, total: count });
    }
  };

  // Recreates a dropped OS folder structure against the real backend —
  // each nested folder is a real POST (so its id is real and can parent the
  // next level down), each file a real multipart upload. Sequential, not
  // parallel: a subfolder's real id must exist before anything can be
  // uploaded into it.
  const traverseFileTree = async (entry, currentParentId, count) => {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve));
      setSyncProgress({ currentName: entry.name });
      await vault.uploadFile(file, currentParentId);
      count += 1;
      setSyncProgress({ current: count });
      return count;
    } else if (entry.isDirectory) {
      const created = await vault.createFolder(currentParentId, entry.name);
      const dirReader = entry.createReader();
      const entries = await readAllDirectoryEntries(dirReader);
      for (let i = 0; i < entries.length; i++) {
        count = await traverseFileTree(entries[i], created.id, count);
      }
      return count;
    }
    return count;
  };

  const readAllDirectoryEntries = async (dirReader) => {
    let entries = [];
    let readBatch = await new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
    while (readBatch.length > 0) {
      entries.push(...readBatch);
      readBatch = await new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));
    }
    return entries;
  };

  const handleFolderUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setSyncProgress({ isSyncing: true, current: 0, total: files.length, currentName: '' });
    // <input webkitdirectory> gives a flat file list with webkitRelativePath ("TopFolder/Sub/file.pdf") — real folders
    // are created on first sight of each path segment and cached by path so siblings share the same real parent id.
    const folderCache = {};
    let count = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const pathParts = (file.webkitRelativePath || file.name).split('/');
        let currentParentId = activeFolderId;
        let cacheKeyPrefix = '';
        for (let j = 0; j < pathParts.length - 1; j++) {
          cacheKeyPrefix += `/${pathParts[j]}`;
          if (!(cacheKeyPrefix in folderCache)) {
            const created = await vault.createFolder(currentParentId, pathParts[j]);
            folderCache[cacheKeyPrefix] = created.id;
          }
          currentParentId = folderCache[cacheKeyPrefix];
        }
        setSyncProgress({ current: i + 1, currentName: file.name });
        await vault.uploadFile(file, currentParentId);
        count += 1;
      }
    } catch (err) {
      fail(err, 'The folder could not be uploaded completely.');
    } finally {
      setSyncProgress({ isSyncing: false, current: count, total: count });
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target ? e.target.files : e || []);
    const targetFolderId = uploadHereFolderIdRef.current !== null ? uploadHereFolderIdRef.current : activeFolderId;
    uploadHereFolderIdRef.current = null;
    if (!files.length) return;
    setUploading(true);
    setSyncProgress({ isSyncing: true, current: 0, total: files.length, currentName: '' });
    let done = 0;
    try {
      for (const f of files) {
        setSyncProgress({ currentName: f.name });
        await vault.uploadFile(f, targetFolderId);
        done += 1;
        setSyncProgress({ current: done });
      }
    } catch (err) {
      fail(err, 'The upload did not finish.');
    } finally {
      setUploading(false);
      setSyncProgress({ isSyncing: false, current: done, total: done });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Add Matter: creates a real Practice case (so it shows in Practice, Calendar, reminders and reports as well).
  const resetMatterForm = () => setMatterForm({
    caseName: '', caseNumber: '', caseType: 'Civil', cnr: '', court: '', judge: '', petitioner: '', respondent: '',
    petitionerCounsel: '', respondentCounsel: '', filingDate: '', nextHearing: '', lastHearing: '', status: 'Active',
    clientName: '', summary: '', notes: '',
  });

  const handleSaveMatterModal = async (e, force = false) => {
    if (e && e.preventDefault) e.preventDefault();
    const f = matterForm;
    if (!f.caseName.trim() || !f.caseNumber.trim() || !f.court.trim()) {
      setMatterError('Case name, case number and court are required.');
      return;
    }
    const remarks = [
      f.summary.trim(), f.notes.trim(),
      f.petitioner.trim() && `Petitioner: ${f.petitioner.trim()}`,
      f.petitionerCounsel.trim() && `Petitioner counsel: ${f.petitionerCounsel.trim()}`,
      f.respondentCounsel.trim() && `Respondent counsel: ${f.respondentCounsel.trim()}`,
      f.cnr.trim() && `CNR: ${f.cnr.trim()}`,
    ].filter(Boolean).join('\n');
    const body = {
      case_no: f.caseNumber.trim(), court: f.court.trim(), title: f.caseName.trim(),
      case_type: f.caseType || 'Civil', status: f.status || 'Active',
    };
    if (f.judge.trim()) body.judge = f.judge.trim();
    if (f.respondent.trim()) body.opposite_party = f.respondent.trim();
    if (f.filingDate) body.filing_date = f.filingDate;
    if (remarks) body.remarks = remarks;
    const clientName = (f.clientName || f.petitioner).trim();
    if (clientName) body.client = { name: clientName };
    if (f.nextHearing) body.first_hearing = { date: f.nextHearing };
    if (force) body.force = true;
    setMatterSaving(true); setMatterError(null);
    try {
      await pr.post('/cases', body);
      setAddMatterOpen(false);
      resetMatterForm();
      await loadMatters();
      loadTimeline(timelineState.deep);
    } catch (err) {
      setMatterError({ text: err?.message || 'Could not save the matter.', duplicate: err?.extra?.code === 'DUPLICATE_CASE', noFirm: err?.extra?.code === 'NO_FIRM' });
    } finally {
      setMatterSaving(false);
    }
  };

  return (
    <div className="cv-root">
      <style>{styles}</style>

      {/* ── TOPBAR ── */}
      <header className="cv-topbar">
        <div style={{ flexGrow: 1 }}>
          <div className="cv-eyebrow">Practice &amp; Vault · Case Management</div>
          <div className="cv-title-row">
            <h1 className="cv-page-title cv-serif">Case Vault</h1>
            <span className="cv-badge">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" />
                <path d="M9.5 12l2 2 3.2-3.6" />
              </svg>
              Tamper-evident vault
            </span>
            <span className="cv-badge">Operating strictly under Indian Law</span>
          </div>
          <div className="cv-page-sub">
            Every document, matter and AI action here is logged to a hashed audit trail your firm can hand to a court.
          </div>
        </div>

        <div className="cv-topbar-actions">
          <div className="cv-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search matters, parties, documents…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search Case Vault"
            />
            <span className="cv-kbd">⌘K</span>
          </div>
        </div>
      </header>

      {/* ── 6 PERSISTENT TABS ── */}
      <nav className="cv-tabs" role="tablist">
        <button
          type="button"
          className={`cv-tab${activeTab === 'overview' ? ' active' : ''}`}
          onClick={() => goTab('overview')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.3" />
            <rect x="14" y="3" width="7" height="7" rx="1.3" />
            <rect x="3" y="14" width="7" height="7" rx="1.3" />
            <rect x="14" y="14" width="7" height="7" rx="1.3" />
          </svg>
          Overview
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'vault' ? ' active' : ''}`}
          onClick={() => goTab('vault')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          Document Vault <span className="cv-tab-count">{totalDocCount}</span>
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'matters' ? ' active' : ''}`}
          onClick={() => goTab('matters')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
            <path d="M9 12h6M9 16h6M9 8h2" />
          </svg>
          Case Tracker <span className="cv-tab-count">{matters.length}</span>
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'drafts' ? ' active' : ''}`}
          onClick={() => goTab('drafts')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
          Legal Drafts <span className="cv-tab-count">{draftCount}</span>
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'trail' ? ' active' : ''}`}
          onClick={() => goTab('trail')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="9" width="16" height="11" rx="2" />
            <path d="M8 9V6.5a4 4 0 0 1 8 0V9" />
          </svg>
          Provenance Trail
        </button>

        <button
          type="button"
          className={`cv-tab${activeTab === 'timeline' ? ' active' : ''}`}
          onClick={() => goTab('timeline')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </svg>
          Timeline
        </button>
      </nav>

      {/* ── CONTENT CONTAINER ── */}
      <main className="cv-content">
        {actionError && (
          <div className="cv-verify-banner broken" role="alert" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{actionError}</span>
            <button type="button" className="cv-link-toggle" onClick={() => setActionError(null)}>Dismiss</button>
          </div>
        )}

        {/* ── 1. OVERVIEW PANEL ── */}
        {activeTab === 'overview' && (
          <section className="cv-panel" id="panel-overview">
            <div className="cv-stat-grid">
              <div className="cv-stat-tile">
                <div className="cv-stat-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                    <path d="M14 3v5h5" />
                  </svg>
                </div>
                <div>
                  <div className="cv-stat-value">{totalDocCount}</div>
                  <div className="cv-stat-label">Documents in vault</div>
                </div>
                <div className="cv-stat-sub">{totalDocCount === 0 ? 'NO DOCUMENTS YET' : (overview?.documents_this_week ? `+${overview.documents_this_week} THIS WEEK` : 'NONE ADDED THIS WEEK')}</div>
              </div>

              <div className="cv-stat-tile">
                <div className="cv-stat-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
                  </svg>
                </div>
                <div>
                  <div className="cv-stat-value">{matters.length}</div>
                  <div className="cv-stat-label">Matters tracked</div>
                </div>
                <div className={`cv-stat-sub${overview?.hearings_this_week ? ' flag' : ''}`}>{mattersState.noPractice ? 'SET UP PRACTICE TO TRACK' : matters.length === 0 ? 'NO MATTERS YET' : overview?.hearings_this_week ? `${overview.hearings_this_week} HEARING${overview.hearings_this_week === 1 ? '' : 'S'} THIS WEEK` : 'NO HEARINGS THIS WEEK'}</div>
              </div>

              <div className="cv-stat-tile">
                <div className="cv-stat-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="3" y="3" width="7" height="7" rx="1.3" />
                    <rect x="14" y="3" width="7" height="7" rx="1.3" />
                    <rect x="3" y="14" width="7" height="7" rx="1.3" />
                    <rect x="14" y="14" width="7" height="7" rx="1.3" />
                  </svg>
                </div>
                <div>
                  <div className="cv-stat-value">{overview?.categories ?? 0}</div>
                  <div className="cv-stat-label">Document categories</div>
                </div>
                <div className="cv-stat-sub">{(overview?.category_names || []).slice(0, 2).join(' · ').toUpperCase() || 'NONE YET'}</div>
              </div>

              <div className="cv-stat-tile">
                <div className="cv-stat-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </div>
                <div>
                  <div className="cv-stat-value">{draftCount}</div>
                  <div className="cv-stat-label">Drafts in progress</div>
                </div>
                <div className="cv-stat-sub">{draftCount === 0 ? 'NO DRAFTS YET' : 'VIA AUTO-DRAFT STUDIO'}</div>
              </div>
            </div>

            {/* AI Case Synopsis Card */}
            <div className="cv-card">
              <div className="cv-card-head">
                <div>
                  <div className="cv-card-eyebrow">AI Case Synopsis</div>
                  <h2 className="cv-card-title cv-serif">What LexAmplify sees across this vault</h2>
                </div>
                <button
                  type="button"
                  className="cv-btn cv-btn-primary"
                  onClick={handleGenerateSynopsis}
                  disabled={synopsisLoading}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" />
                    <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
                  </svg>
                  <span>{synopsisLoading ? 'Generating…' : synopsis ? 'Regenerate synopsis' : 'Generate synopsis'}</span>
                </button>
              </div>

              {synopsis ? (
                <div className="cv-card-body-text">
                  {synopsis.split('\n\n').map((para, pIdx) => (
                    <p key={pIdx}>{para}</p>
                  ))}
                  <p className="cv-mono" style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '12px' }}>
                    Generated from {totalDocCount} documents · sourced and logged to the Provenance Trail
                  </p>
                </div>
              ) : (
                <div className="cv-card-body-text">
                  Once generated, LexAmplify reads every document and tracked matter in this vault and drafts a plain-language brief — open issues, upcoming hearings, and documents that still need review. Every sentence links back to its source document.
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div>
              <div className="cv-card-eyebrow" style={{ marginBottom: '12px' }}>Quick actions</div>
              <div className="cv-quick-grid">
                <button type="button" className="cv-quick-btn" onClick={() => goTab('vault')}>
                  <div className="cv-quick-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M12 16V4M7 9l5-5 5 5" />
                      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                    </svg>
                  </div>
                  <div className="cv-quick-label">Upload document</div>
                </button>

                <button type="button" className="cv-quick-btn" onClick={() => { goTab('matters'); openAddMatter(); }}>
                  <div className="cv-quick-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </div>
                  <div className="cv-quick-label">Track a new matter</div>
                </button>

                <button type="button" className="cv-quick-btn" onClick={() => goTab('timeline')}>
                  <div className="cv-quick-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <circle cx="12" cy="12" r="8.5" />
                      <path d="M12 7.5V12l3 2" />
                    </svg>
                  </div>
                  <div className="cv-quick-label">Extract case timeline</div>
                </button>

                <button type="button" className="cv-quick-btn" onClick={() => goTab('trail')}>
                  <div className="cv-quick-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="4" y="9" width="16" height="11" rx="2" />
                      <path d="M8 9V6.5a4 4 0 0 1 8 0V9" />
                    </svg>
                  </div>
                  <div className="cv-quick-label">Review audit trail</div>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── 2. DOCUMENT VAULT PANEL ── */}
        {activeTab === 'vault' && (() => {
          const currentItems = getItemsInFolder(vault.flatFolders, vault.documents, activeFolderId)
            .filter((item) => !vaultSearch.trim() || item.name.toLowerCase().includes(vaultSearch.trim().toLowerCase()))
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
          const breadcrumbs = formatBreadcrumbs(getFolderPath(vault.flatFolders, activeFolderId));
          const isRoot = activeFolderId === null;
          const isEmpty = currentItems.length === 0;

          return (
            <section className="cv-panel" id="panel-vault">
              {/* The file pickers every "Upload" control clicks. They were never rendered, which is why uploads did nothing. */}
              <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileUpload} aria-label="Choose documents to upload" />
              <input ref={folderInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFolderUpload} aria-label="Choose a folder to upload" {...{ webkitdirectory: '', directory: '' }} />
              <div className="cv-section-head">
                <div>
                  <h2 className="cv-section-title cv-serif">Document Vault</h2>
                  <div className="cv-section-sub">
                    Organized to the standard litigation taxonomy — every upload is hashed and logged to the Provenance Trail on arrival.
                  </div>
                </div>
                <div className="cv-vault-toolbar">
                  <button
                    type="button"
                    className="cv-btn"
                    onClick={async () => {
                      try {
                        const created = await vault.createFolder(activeFolderId, 'New folder');
                        setRenamingId(`folder-${created.id}`);
                        setRenameValue('New folder');
                      } catch (err) {
                        fail(err, 'The folder could not be created.');
                      }
                    }}
                  >
                    + New folder
                  </button>
                  <button type="button" className="cv-btn" onClick={() => folderInputRef.current?.click()}>
                    Upload folder
                  </button>
                  <button
                    type="button"
                    className="cv-btn cv-btn-primary"
                    onClick={() => { uploadHereFolderIdRef.current = activeFolderId; fileInputRef.current?.click(); }}
                    disabled={uploading}
                  >
                    {uploading ? 'Uploading…' : 'Upload document'}
                  </button>
                </div>
              </div>

              <div className="cv-vault-breadcrumb">
                {breadcrumbs.map((crumb, idx) => (
                  <React.Fragment key={crumb.id ?? 'root'}>
                    {idx > 0 && <span className="cv-vault-breadcrumb-sep">/</span>}
                    {crumb.isEllipsis ? (
                      <span className="cv-vault-breadcrumb-ellipsis">…</span>
                    ) : (
                      <button
                        type="button"
                        className={`cv-vault-breadcrumb-item${idx === breadcrumbs.length - 1 ? ' current' : ''}`}
                        onClick={() => idx !== breadcrumbs.length - 1 && setActiveFolderId(crumb.id)}
                      >
                        {crumb.name}
                      </button>
                    )}
                  </React.Fragment>
                ))}
                <div className="cv-vault-toolbar-spacer" />
                <div className="cv-vault-search">
                  <Search size={13} />
                  <input
                    type="text"
                    placeholder="Filter this folder…"
                    value={vaultSearch}
                    onChange={(e) => setVaultSearch(e.target.value)}
                  />
                </div>
              </div>

              <div
                className={`cv-dropzone${isVaultDragOver ? ' dragover' : ''}`}
                onClick={() => { uploadHereFolderIdRef.current = activeFolderId; fileInputRef.current?.click(); }}
                onDragOver={(e) => { handleDragOver(e); setIsVaultDragOver(true); }}
                onDragLeave={() => setIsVaultDragOver(false)}
                onDrop={(e) => { setIsVaultDragOver(false); handleDrop(e); }}
              >
                <div className="cv-dropzone-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 3v12m0-12l-4 4m4-4l4 4" />
                    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                  </svg>
                </div>
                <div>
                  <div className="cv-dropzone-title">Drag and drop folders or files, or click to browse</div>
                  <div className="cv-dropzone-sub">Filed into {isRoot ? 'the vault root' : `"${breadcrumbs[breadcrumbs.length - 1]?.name}"`} and hashed to the Provenance Trail.</div>
                </div>
              </div>

              {vault.loading && vault.documents.length === 0 && vault.flatFolders.length === 0 ? (
                <div className="cv-card cv-empty"><p className="cv-empty-sub">Loading your vault…</p></div>
              ) : vault.error ? (
                <div className="cv-card cv-empty">
                  <p className="cv-empty-sub">{vault.error}</p>
                  <button type="button" className="cv-btn" onClick={() => vault.refresh()}>Try again</button>
                </div>
              ) : isEmpty ? (
                <div className="cv-card cv-empty">
                  <div className="cv-empty-icon">
                    <Folder size={22} />
                  </div>
                  <h3 className="cv-empty-title cv-serif">
                    {vaultSearch.trim() ? 'No matches in this folder' : 'This folder is empty'}
                  </h3>
                  <p className="cv-empty-sub">
                    {vaultSearch.trim()
                      ? 'Try a different search, or clear it to see everything here.'
                      : 'Drag files in above, or create a folder to start organizing this matter.'}
                  </p>
                  {isRoot && !vaultSearch.trim() && (
                    <button type="button" className="cv-btn cv-btn-primary" style={{ marginTop: 4 }} onClick={() => vault.initBlueprint()}>
                      Initialize standard blueprint
                    </button>
                  )}
                </div>
              ) : (
                <div className="cv-vault-grid">
                  {currentItems.map((item) => {
                    const isFolder = item.type === 'folder';
                    const docCount = isFolder ? (vault.docCounts[String(item.id)] || 0) : 0;
                    const FileIcon = isFolder ? Folder : getVaultFileIcon(item.file_format);
                    return (
                      <div
                        key={`${item.type}-${item.id}`}
                        onClick={() => { if (renamingId !== `${item.type}-${item.id}`) { isFolder ? setActiveFolderId(item.id) : openViewer(item); } }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { isFolder ? setActiveFolderId(item.id) : openViewer(item); } }}
                        role="button"
                        tabIndex={0}
                        aria-label={isFolder ? `Open folder ${item.name}` : `Open document ${item.name}`}
                        onContextMenu={(e) => openContextMenu(e, item)}
                        className="cv-vault-card"
                        title={item.protected ? 'Standard blueprint folder' : undefined}
                      >
                        <div className="cv-vault-card-top">
                          <div className="cv-vault-card-top-left">
                            <div className="cv-vault-card-icon">
                              <FileIcon size={18} />
                            </div>
                            {item.protected && (
                              <div className="cv-vault-card-lock" title="Standard blueprint folder — cannot be renamed, moved, or deleted">
                                <Lock size={11} />
                              </div>
                            )}
                            {item.share_count > 0 && (
                              <div className="cv-vault-card-share-badge" title={`Shared with ${item.share_count} ${item.share_count === 1 ? 'person' : 'people'}`}>
                                <Users size={11} />
                              </div>
                            )}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              openContextMenu(e, item, { x: rect.right, y: rect.bottom });
                            }}
                            className="cv-vault-card-kebab"
                            title="Actions"
                          >
                            <MoreVertical size={16} />
                          </button>
                        </div>

                        <div className="cv-vault-card-body">
                          {/* Folders and documents live in separate backend
                              tables with independently auto-incrementing ids
                              (vault_folders vs case_vault), so a bare numeric
                              renamingId can collide — folder id 1 and
                              document id 1 would both match. The key is
                              type-qualified to keep them distinct. */}
                          {renamingId === `${item.type}-${item.id}` ? (
                            <input
                              type="text"
                              value={renameValue}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={async () => {
                                const val = renameValue.trim();
                                setRenamingId(null);
                                if (val && val !== item.name) {
                                  try {
                    isFolder ? await vault.renameFolder(item.id, val) : await vault.renameDocument(item.id, val);
                  } catch (err) {
                    fail(err, 'Could not rename it.');
                  }
                                }
                              }}
                              onKeyDown={async (e) => {
                                if (e.key === 'Enter') {
                                  e.currentTarget.blur();
                                } else if (e.key === 'Escape') {
                                  setRenamingId(null);
                                }
                              }}
                              className="cv-vault-card-rename-input"
                            />
                          ) : (
                            <div className="cv-vault-card-name" title={item.name}>
                              {item.name}
                            </div>
                          )}
                          <div className="cv-vault-card-meta">
                            {isFolder ? `${docCount} doc${docCount === 1 ? '' : 's'}` : (item.size_bytes ? `${Math.round(item.size_bytes / 1024)} KB` : 'Document')}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })()}

        {/* ── 3. CASE TRACKER PANEL ── */}
        {activeTab === 'matters' && (
          <section className="cv-panel" id="panel-matters">
            <div className="cv-section-head">
              <div>
                <h2 className="cv-section-title cv-serif">Case Tracker</h2>
                <div className="cv-section-sub">Your active caseload, synced to eCourts where a CNR is on file.</div>
              </div>
              <button
                type="button"
                className="cv-btn cv-btn-primary"
                onClick={() => openAddMatter()}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add matter
              </button>
            </div>

            {/* Quick eCourts lookup Card */}
            <div className="cv-card">
              <div className="cv-card-eyebrow" style={{ marginBottom: '6px' }}>Quick eCourts lookup</div>
              <div className="cv-card-body-text" style={{ marginBottom: '14px' }}>
                Paste a 16-digit CNR to pull hearing status directly into the tracker.
              </div>
              <div className="cv-cnr-row">
                <input
                  className="cv-cnr-input"
                  type="text"
                  placeholder="e.g. TNMD010012342026"
                  value={cnrSearchInput}
                  onChange={(e) => setCnrSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleFetchCnr()}
                  aria-label="CNR number"
                />
                <button
                  type="button"
                  className="cv-btn cv-btn-primary"
                  onClick={handleFetchCnr}
                  disabled={cnrLoading || !cnrSearchInput.trim()}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.3-4.3" />
                  </svg>
                  {cnrLoading ? 'Fetching…' : 'Fetch status'}
                </button>
              </div>

              {cnrError && <div className="cv-verify-banner broken" role="alert" style={{ marginTop: 12 }}>{cnrError}</div>}
              {cnrResult && (
                <div className="cv-cnr-result">
                  <div>
                    <div className="cv-cnr-result-title">{cnrResult.title}</div>
                    <div className="cv-cnr-result-meta">{cnrResult.meta}</div>
                  </div>
                  <button
                    type="button"
                    className="cv-btn cv-btn-sm"
                    onClick={handleAddCnrToTracker}
                  >
                    Review &amp; add to tracker
                  </button>
                </div>
              )}
            </div>

            {mattersState.loading && matters.length === 0 ? (
              <div className="cv-card cv-empty"><p className="cv-empty-sub">Loading your matters…</p></div>
            ) : mattersState.noPractice ? (
              <div className="cv-card cv-empty">
                <div className="cv-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
                  </svg>
                </div>
                <h3 className="cv-empty-title cv-serif">Set up your practice to track matters</h3>
                <p className="cv-empty-sub">Matters here are the cases in Practice. Create your practice once and every case you add — there or here — shows up in both places.</p>
                <button type="button" className="cv-btn cv-btn-primary" onClick={() => navigate('/practice')}>Open Practice</button>
              </div>
            ) : mattersState.error ? (
              <div className="cv-card cv-empty">
                <p className="cv-empty-sub">{mattersState.error}</p>
                <button type="button" className="cv-btn" onClick={loadMatters}>Try again</button>
              </div>
            ) : matters.length > 0 ? (
              <div className="cv-matter-list">
                {matters.map((m) => (
                  <div key={m.id} className="cv-matter-card">
                    <div className="cv-matter-head">
                      <div>
                        <h3 className="cv-matter-name cv-serif">{m.caseName}</h3>
                        <div className="cv-matter-num">{m.caseNumber} · {m.court}</div>
                        {m.urgent && (
                          <div className="cv-matter-urgent">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <circle cx="12" cy="12" r="8.5" />
                              <path d="M12 7.5V12l3 2" />
                            </svg>
                            {m.urgent}
                          </div>
                        )}
                      </div>
                      <span className="cv-chip cv-chip-neutral">
                        {(m.status || 'ACTIVE').toUpperCase()}
                      </span>
                    </div>

                    <div className="cv-matter-grid">
                      <div>
                        <div className="cv-matter-field-label">Client</div>
                        <div className="cv-matter-field-value">{m.clientName || '—'}</div>
                      </div>
                      <div>
                        <div className="cv-matter-field-label">Opposite party</div>
                        <div className="cv-matter-field-value">{m.oppositeParty || '—'}</div>
                      </div>
                      <div>
                        <div className="cv-matter-field-label">Next hearing</div>
                        <div className="cv-matter-field-value">{m.nextHearing ? fmtDate(m.nextHearing) : '—'}</div>
                      </div>
                      <div>
                        <div className="cv-matter-field-label">Linked documents</div>
                        <div className="cv-link-chip">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.5 1.5" />
                            <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.5-1.5" />
                          </svg>
                          {m.docsLinked || 0} in vault
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <button type="button" className="cv-link-toggle" onClick={() => navigate(`/practice/cases/${m.id}`)}>Open in Practice →</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cv-card cv-empty">
                <div className="cv-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
                  </svg>
                </div>
                <h3 className="cv-empty-title cv-serif">No matters tracked yet</h3>
                <p className="cv-empty-sub">
                  Add a matter here or create a case in Practice — it appears in both places. Documents you file to that case in the Document Hub are linked here automatically.
                </p>
                <button type="button" className="cv-btn cv-btn-primary" onClick={() => openAddMatter()}>Add your first matter</button>
              </div>
            )}
          </section>
        )}

        {/* ── 4. LEGAL DRAFTS PANEL ── */}
        {activeTab === 'drafts' && (
          <section className="cv-panel" id="panel-drafts">
            <div>
              <h2 className="cv-section-title cv-serif">Legal Drafts</h2>
              <div className="cv-section-sub">
                Anything saved from Auto-Draft Studio with "Draft" in its title or type lands here automatically.
              </div>
            </div>

            {draftCount > 0 ? (
              <div className="cv-matter-list">
                {allDocs
                  .filter(d => (d.name || '').toLowerCase().includes('draft') || (d.tag || '').toLowerCase().includes('draft'))
                  .map(draft => (
                    <div key={draft.id} className="cv-matter-card">
                      <div className="cv-matter-head">
                        <div>
                          <h3 className="cv-matter-name cv-serif">{draft.name}</h3>
                          <div className="cv-matter-num">{draft.size} · Updated {draft.updated}</div>
                        </div>
                        <span className="cv-chip cv-chip-neutral">DRAFT</span>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="cv-card cv-empty">
                <div className="cv-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </div>
                <h3 className="cv-empty-title cv-serif">No drafts here yet</h3>
                <p className="cv-empty-sub">
                  Generate a petition, notice or agreement in Auto-Draft Studio and save it to this matter — it appears here, versioned, with its full generation history in the Provenance Trail.
                </p>
                <button
                  type="button"
                  className="cv-btn cv-btn-primary"
                  style={{ marginTop: '6px' }}
                  onClick={() => navigate('/auto-draft')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                  Open Auto-Draft Studio
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── 5. PROVENANCE TRAIL PANEL ── */}
        {activeTab === 'trail' && (
          <section className="cv-panel" id="panel-trail">
            <div className="cv-section-head">
              <div>
                <h2 className="cv-section-title cv-serif">Provenance Trail</h2>
                <div className="cv-section-sub">
                  Every folder/document event in this vault, chained and hashed — a record you can hand to opposing counsel or the bench.
                </div>
              </div>
              <button
                type="button"
                className="cv-btn"
                onClick={() => provenance.verifyChain()}
                disabled={provenance.verifying}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" />
                  <path d="M9.5 12l2 2 3.2-3.6" />
                </svg>
                {provenance.verifying ? 'Verifying…' : 'Verify chain integrity'}
              </button>
            </div>

            {provenance.verifyResult && (
              <div className={`cv-verify-banner ${provenance.verifyResult.valid ? 'ok' : 'broken'}`}>
                {provenance.verifyResult.valid
                  ? `Chain integrity verified — all ${provenance.verifyResult.total_entries} entries check out against their recomputed SHA-256 hashes.`
                  : provenance.verifyResult.error
                    ? `Verification failed: ${provenance.verifyResult.error}`
                    : `Chain integrity check failed at entry #${provenance.verifyResult.broken_at_id} — a stored hash no longer matches its recomputed value. Something in this vault's history was altered outside the app.`}
              </div>
            )}

            {provenance.loading ? (
              <div className="cv-card cv-empty">
                <p className="cv-empty-sub">Loading the provenance trail…</p>
              </div>
            ) : provenance.error ? (
              <div className="cv-card cv-empty">
                <p className="cv-empty-sub">{provenance.error}</p>
              </div>
            ) : provenance.entries.length === 0 ? (
              <div className="cv-card cv-empty">
                <div className="cv-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 2.5l8 3.2v6c0 5-3.4 8.4-8 9.8-4.6-1.4-8-4.8-8-9.8v-6z" />
                  </svg>
                </div>
                <h3 className="cv-empty-title cv-serif">Nothing logged yet</h3>
                <p className="cv-empty-sub">
                  Every folder/document you create, rename, move, upload, delete, or share here gets its own hashed entry, chained to the one before it.
                </p>
              </div>
            ) : (
              <div className="cv-card">
                {provenance.entries.map((entry, idx) => {
                  const isLast = idx === provenance.entries.length - 1;
                  const detailSummary = provenanceDetailSummary(entry);
                  return (
                    <div key={entry.id} className="cv-trail-item">
                      <div className="cv-trail-rail">
                        <div className="cv-trail-dot" />
                        {!isLast && <div className="cv-trail-line" />}
                      </div>
                      <div className="cv-trail-body">
                        <div className="cv-trail-top">
                          <div className="cv-trail-action">{provenanceActionLabel(entry)}</div>
                          <div className="cv-trail-time">{provenanceRelativeTime(entry.created_at)}</div>
                        </div>
                        <div className="cv-trail-meta">
                          {entry.node_name}
                          {detailSummary && <> · {detailSummary}</>}
                          {' · '}
                          <span className="cv-trail-actor">{provenanceActorLabel(entry, currentUser)}</span>
                        </div>
                        {entry.content_hash && (
                          <div className="cv-trail-hash" title={entry.content_hash}>
                            0x{entry.content_hash.slice(0, 8)}…{entry.content_hash.slice(-4)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* ── 6. TIMELINE PANEL ── */}
        {activeTab === 'timeline' && (
          <section className="cv-panel" id="panel-timeline">
            <div className="cv-section-head">
              <div>
                <h2 className="cv-section-title cv-serif">Case Timeline</h2>
                <div className="cv-section-sub">
                  Built from your Practice matters (filing, hearings, daily proceedings) and the dates in your vault documents — nothing here is typed in by hand.
                </div>
              </div>
              <button
                type="button"
                className="cv-btn cv-btn-primary"
                onClick={() => loadTimeline(true)}
                disabled={timelineState.loading}
                title="Reads the text of your documents and adds the dated events it finds (orders, notices, next hearings…)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="4.5" width="18" height="16" rx="2" />
                  <path d="M3 9.5h18" />
                </svg>
                <span>{timelineState.loading ? 'Reading…' : timelineState.deep ? 'Re-scan documents' : 'Extract dates from documents'}</span>
              </button>
            </div>

            {timelineState.error ? (
              <div className="cv-card cv-empty">
                <p className="cv-empty-sub">{timelineState.error}</p>
                <button type="button" className="cv-btn" onClick={() => loadTimeline(timelineState.deep)}>Try again</button>
              </div>
            ) : timelineEvents.length > 0 ? (
              <div className="cv-card">
                {timelineEvents.map((ev, idx) => {
                  const isLast = idx === timelineEvents.length - 1;
                  const upcoming = daysUntil(ev.date) !== null && daysUntil(ev.date) >= 0 && (ev.kind === 'hearing' || ev.kind === 'deadline');
                  return (
                    <div key={ev.id || idx} className="cv-tl-item">
                      <div className="cv-tl-date">{fmtDate(ev.date)}</div>
                      <div className="cv-tl-rail">
                        <div className="cv-tl-dot" />
                        {!isLast && <div className="cv-tl-line" />}
                      </div>
                      <div className="cv-tl-body">
                        <div className="cv-tl-label">
                          {ev.label}
                          {upcoming && <span className="cv-chip cv-chip-neutral" style={{ marginLeft: 8 }}>UPCOMING</span>}
                          {ev.extracted && <span className="cv-chip cv-chip-neutral" style={{ marginLeft: 8 }}>FROM DOCUMENT TEXT</span>}
                        </div>
                        <div className="cv-tl-source">
                          SOURCE:{' '}
                          {ev.doc_id
                            ? <button type="button" className="cv-link-toggle" onClick={() => setViewer({ id: ev.doc_id, name: ev.source })}>{ev.source}</button>
                            : ev.source}
                          {ev.case_title && <> · {ev.case_title}</>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : timelineState.loading ? (
              <div className="cv-card cv-empty"><p className="cv-empty-sub">Building the timeline…</p></div>
            ) : (
              <div className="cv-card cv-empty">
                <div className="cv-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="8.5" />
                    <path d="M12 7.5V12l3 2" />
                  </svg>
                </div>
                <h3 className="cv-empty-title cv-serif">Nothing on the timeline yet</h3>
                <p className="cv-empty-sub">
                  Add a matter in Case Tracker or upload documents. Filing dates, hearings, proceedings and the dates found in your documents appear here on their own.
                </p>
              </div>
            )}
          </section>
        )}

      </main>

      {/* ── 16-FIELD ADD MATTER MODAL (5 SECTIONS) ── */}
      {addMatterOpen && (
        <div className="cv-modal-overlay" onClick={() => setAddMatterOpen(false)}>
          <div className="cv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cv-modal-header">
              <div>
                <div className="cv-card-eyebrow">Case Tracker · saved to Practice</div>
                <h3 className="cv-modal-title cv-serif">Add a matter</h3>
              </div>
              <button
                type="button"
                className="cv-btn"
                style={{ padding: '6px 10px' }}
                onClick={() => setAddMatterOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveMatterModal}>
              <div className="cv-modal-body">
                {/* Section 1: Case Identity */}
                <div>
                  <div className="cv-field-section-title">Case identity</div>
                  <div className="cv-field-grid">
                    <div className="cv-field">
                      <label htmlFor="mf-caseName">Case name <span className="cv-req">*</span></label>
                      <input
                        id="mf-caseName"
                        type="text"
                        placeholder="e.g., State vs. John Doe"
                        value={matterForm.caseName}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, caseName: e.target.value }))}
                        required
                        autoFocus
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-caseNumber">Case number <span className="cv-req">*</span></label>
                      <input
                        id="mf-caseNumber"
                        type="text"
                        placeholder="e.g., CRA/123/2026"
                        value={matterForm.caseNumber}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, caseNumber: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-caseType">Case type</label>
                      <select
                        id="mf-caseType"
                        value={matterForm.caseType}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, caseType: e.target.value }))}
                      >
                        {(practiceMeta?.case_types || ['Civil', 'Criminal', 'MCOP', 'RTI', 'Family', 'Corporate', 'Consumer', 'Other']).map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-cnr">CNR number</label>
                      <input
                        id="mf-cnr"
                        type="text"
                        className="cv-mono"
                        placeholder="16-digit official ID"
                        value={matterForm.cnr}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, cnr: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Court Details */}
                <div>
                  <div className="cv-field-section-title">Court details</div>
                  <div className="cv-field-grid">
                    <div className="cv-field">
                      <label htmlFor="mf-court">Court name <span className="cv-req">*</span></label>
                      <input
                        id="mf-court"
                        type="text"
                        placeholder="e.g., Delhi High Court"
                        value={matterForm.court}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, court: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-judge">Judge name</label>
                      <input
                        id="mf-judge"
                        type="text"
                        placeholder="Hon. Justice…"
                        value={matterForm.judge}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, judge: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Section 3: Parties & Counsel */}
                <div>
                  <div className="cv-field-section-title">Parties &amp; counsel</div>
                  <div className="cv-field-grid">
                    <div className="cv-field">
                      <label htmlFor="mf-petitioner">Petitioner</label>
                      <input
                        id="mf-petitioner"
                        type="text"
                        placeholder="Petitioner / Plaintiff"
                        value={matterForm.petitioner}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, petitioner: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-respondent">Respondent</label>
                      <input
                        id="mf-respondent"
                        type="text"
                        placeholder="Respondent / Defendant"
                        value={matterForm.respondent}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, respondent: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-petitionerCounsel">Petitioner counsel</label>
                      <input
                        id="mf-petitionerCounsel"
                        type="text"
                        placeholder="Adv. name"
                        value={matterForm.petitionerCounsel}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, petitionerCounsel: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-respondentCounsel">Respondent counsel</label>
                      <input
                        id="mf-respondentCounsel"
                        type="text"
                        placeholder="Adv. name"
                        value={matterForm.respondentCounsel}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, respondentCounsel: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                {/* Section 4: Dates & Status */}
                <div>
                  <div className="cv-field-section-title">Dates &amp; status</div>
                  <div className="cv-field-grid">
                    <div className="cv-field">
                      <label htmlFor="mf-filingDate">Filing date</label>
                      <input
                        id="mf-filingDate"
                        type="date"
                        value={matterForm.filingDate}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, filingDate: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-nextHearing">Next hearing</label>
                      <input
                        id="mf-nextHearing"
                        type="date"
                        value={matterForm.nextHearing}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, nextHearing: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-lastHearing">Last hearing</label>
                      <input
                        id="mf-lastHearing"
                        type="date"
                        value={matterForm.lastHearing}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, lastHearing: e.target.value }))}
                      />
                    </div>
                    <div className="cv-field">
                      <label htmlFor="mf-status">Status</label>
                      <select
                        id="mf-status"
                        value={matterForm.status}
                        onChange={(e) => setMatterForm(prev => ({ ...prev, status: e.target.value }))}
                      >
                        {(practiceMeta?.statuses || ['Active', 'Awaiting Orders', 'Stayed', 'Disposed', 'Withdrawn', 'Settled']).map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Section 5: Internal Notes */}
                <div>
                  <div className="cv-field-section-title">Internal notes</div>
                  <div className="cv-field" style={{ marginBottom: '14px' }}>
                    <label htmlFor="mf-clientName">Client name</label>
                    <input
                      id="mf-clientName"
                      type="text"
                      placeholder="Internal reference"
                      value={matterForm.clientName}
                      onChange={(e) => setMatterForm(prev => ({ ...prev, clientName: e.target.value }))}
                    />
                  </div>
                  <div className="cv-field" style={{ marginBottom: '14px' }}>
                    <label htmlFor="mf-summary">Summary</label>
                    <textarea
                      id="mf-summary"
                      rows={2}
                      placeholder="Brief case synopsis…"
                      value={matterForm.summary}
                      onChange={(e) => setMatterForm(prev => ({ ...prev, summary: e.target.value }))}
                    />
                  </div>
                  <div className="cv-field">
                    <label htmlFor="mf-notes">Notes</label>
                    <textarea
                      id="mf-notes"
                      rows={3}
                      placeholder="Strategy notes or updates…"
                      value={matterForm.notes}
                      onChange={(e) => setMatterForm(prev => ({ ...prev, notes: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              {matterError && (
                <div className="cv-verify-banner broken" role="alert" style={{ margin: '0 24px 12px' }}>
                  {typeof matterError === 'string' ? matterError : matterError.text}
                  {typeof matterError !== 'string' && matterError.duplicate && (
                    <> <button type="button" className="cv-link-toggle" onClick={() => handleSaveMatterModal(null, true)}>Save anyway</button></>
                  )}
                  {typeof matterError !== 'string' && matterError.noFirm && (
                    <> <button type="button" className="cv-link-toggle" onClick={() => navigate('/practice')}>Open Practice</button></>
                  )}
                </div>
              )}
              <div className="cv-modal-footer">
                <button
                  type="button"
                  className="cv-btn"
                  onClick={() => setAddMatterOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cv-btn cv-btn-primary"
                  disabled={matterSaving}
                >
                  {matterSaving ? 'Saving…' : 'Save matter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── VAULT MODALS ── */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        item={contextMenu.item}
        onClose={closeContextMenu}
        x={contextMenu.x}
        y={contextMenu.y}
        onOpen={(item) => setActiveFolderId(item.id)}
        onNewSubfolder={async (item) => {
          try {
            const created = await vault.createFolder(item.id, 'New folder');
            setActiveFolderId(item.id);
            setRenamingId(`folder-${created.id}`);
            setRenameValue('New folder');
          } catch (err) {
            fail(err, 'The folder could not be created.');
          }
        }}
        onUploadHere={(item) => {
          uploadHereFolderIdRef.current = item.id;
          fileInputRef.current?.click();
        }}
        onRename={(item) => {
          setRenamingId(`${item.type}-${item.id}`);
          setRenameValue(item.name);
        }}
        onMove={(item) => setItemToMove(item)}
        onShare={(item) => setItemToShare(item)}
        onPreview={(item) => openViewer(item)}
        onDownload={(item) => vaultApi.downloadOriginal(item.id, item.name).catch((err) => fail(err, 'Could not download the file.'))}
        onDelete={(item) => setItemToDelete(item)}
      />

      <ShareModal
        isOpen={!!itemToShare}
        item={itemToShare}
        onClose={() => setItemToShare(null)}
      />

      <MoveModal
        isOpen={!!itemToMove}
        item={itemToMove}
        folders={vault.flatFolders}
        onClose={() => setItemToMove(null)}
        onMove={async (newParentId) => {
          const item = itemToMove;
          setItemToMove(null);
          try {
            if (item.type === 'folder') {
              await vault.moveFolder(item.id, newParentId);
            } else {
              await vault.moveDocument(item.id, newParentId);
            }
          } catch (err) {
            fail(err, 'Could not move it.');
          }
        }}
      />

      <ConfirmDeleteDialog
        isOpen={!!itemToDelete}
        item={itemToDelete}
        onCancel={() => setItemToDelete(null)}
        onConfirm={async (item) => {
          try {
            if (item.type === 'folder') {
              await vault.deleteFolder(item.id);
            } else {
              await vault.deleteDocument(item.id);
            }
          } catch (err) {
            fail(err, 'Could not delete it.');
          }
          setItemToDelete(null);
        }}
      />

      <SyncToast progress={syncProgress} />

      {viewer && (
        <VaultDocViewer
          docId={viewer.id}
          fallbackName={viewer.name}
          onClose={() => setViewer(null)}
          onChanged={() => { vault.refresh(); refreshAll(); }}
        />
      )}
    </div>
  );
}
