import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Link, useParams, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { fetchTrackedCases, fetchDocuments } from './services/api';
import CommandPalette from './components/CommandPalette';
import CaseVault from './components/CaseVault';
import DocumentViewer from './components/DocumentViewer';
import CourtResources from './components/CourtResources';
import ContractAnalyzer from './components/ContractAnalyzer';
import ErrorBoundary from './components/ErrorBoundary';
import AutoDraftWorkspace from './components/AutoDraftWorkspace';
import { useContractStore } from './store/useContractStore';
import DraftsModal from './components/DraftsModal.jsx';
import ConflictEngine from './components/ConflictEngine';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import CalendarView from './components/CalendarView';
import VaultView from './components/VaultView';
import CaseWorkspace from './components/CaseWorkspace';
import DashboardView from './components/DashboardView';
import WarRoomView from './components/WarRoomView';
import FirmLibrary from './components/FirmLibrary';
import LegalForms from './components/LegalForms';
import FormTemplateLibrary from './components/FormTemplateLibrary';
import TEMPLATES from './data/legalTemplates.js';
import MatterLauncher from './components/organization/MatterLauncher';
import MatterDashboard from './components/organization/MatterDashboard';
import TeamDashboard from './components/organization/TeamDashboard';
import OrgDashboard from './components/organization/OrgDashboard';
import ContextCapsule from './components/organization/ContextCapsule';
import ChamberRoster from './components/chamber/ChamberRoster';
import ChamberSwitcher from './components/chamber/ChamberSwitcher';

// ── STATUS BADGE STYLES (mapped from real API status values) ──────────────────
const STATUS_STYLES = {
  'Active': { bg: 'rgba(16,185,129,0.12)', color: '#10B981', dot: '#10B981' },
  'Active Sprint': { bg: 'rgba(16,185,129,0.12)', color: '#10B981', dot: '#10B981' },
  'Hearing scheduled': { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', dot: '#F59E0B' },
  'Hearing Scheduled': { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', dot: '#F59E0B' },
  'Pending Filing': { bg: 'rgba(239,68,68,0.12)', color: '#EF4444', dot: '#EF4444' },
  'Disposed': { bg: 'rgba(107,114,128,0.12)', color: '#9CA3AF', dot: '#6B7280' },
};
const getStatusStyle = (status) =>
  STATUS_STYLES[status] || { bg: 'rgba(107,114,128,0.12)', color: '#9CA3AF', dot: '#6B7280' };

// ── SVG ICON SET ───────────────────────────────────────────────────────────────
const Icons = {
  dashboard: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  contract: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  scales: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z" />
      <path d="M7 21h10M12 3v18M3 7h2c2 0 4-1 7-1s5 1 7 1h2" />
    </svg>
  ),
  search: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
    </svg>
  ),
  calendar: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  lock: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  forms: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  ),
  gavel: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m14.5 12.5-8 8a2.12 2.12 0 0 1-3-3l8-8" /><path d="m16 16 6-6" />
      <path d="m8 8 6-6" /><path d="m9 7 8 8" />
    </svg>
  ),
  folder: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  chat: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  logout: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  lightning: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  wand: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  upload: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  sun: (w = 16) => (
    <svg width={w} height={w} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
  moon: (w = 16) => (
    <svg width={w} height={w} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  chevronLeft: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  chevronRight: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  library: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
};

// ── SIDEBAR-ONLY ICON SET (Slate & Rust redesign) ──────────────────────────────
// Deliberately separate from `Icons` above: that object is also used by the
// dashboard's stat cards and quick-actions grid, and several of those calls
// share an icon between two different features (e.g. `Icons.gavel` covers
// both Legal Forms and Virtual Courtroom there). Mutating it to match the
// sidebar brief's exact paths would silently change those unrelated cards
// too. This set exists only to back NAVIGATION_GROUPS below.
const SidebarIcons = {
  dashboard: () => (
    <svg className="icon" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.4" /></svg>
  ),
  contract: () => (
    <svg className="icon" viewBox="0 0 24 24"><path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M13 3v5h5" /><line x1="8" y1="13" x2="15" y2="13" /><line x1="8" y1="16" x2="15" y2="16" /><line x1="8" y1="19" x2="12" y2="19" /></svg>
  ),
  pencil: () => (
    <svg className="icon" viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
  ),
  scales: () => (
    <svg className="icon" viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="8" /><line x1="5" y1="8" x2="19" y2="8" /><line x1="5" y1="8" x2="5" y2="14" /><line x1="19" y1="8" x2="19" y2="14" /><circle cx="5" cy="16" r="2.3" /><circle cx="19" cy="16" r="2.3" /><line x1="12" y1="8" x2="12" y2="20" /><line x1="8" y1="21" x2="16" y2="21" /></svg>
  ),
  calendar: () => (
    <svg className="icon" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><line x1="3.5" y1="9.5" x2="20.5" y2="9.5" /><line x1="8" y1="3" x2="8" y2="6.5" /><line x1="16" y1="3" x2="16" y2="6.5" /></svg>
  ),
  courthouse: () => (
    <svg className="icon" viewBox="0 0 24 24"><path d="M3 10l9-6 9 6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="5" y1="10" x2="5" y2="19" /><line x1="9" y1="10" x2="9" y2="19" /><line x1="15" y1="10" x2="15" y2="19" /><line x1="19" y1="10" x2="19" y2="19" /><line x1="3" y1="21" x2="21" y2="21" /></svg>
  ),
  lock: () => (
    <svg className="icon" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
  ),
  search: () => (
    <svg className="icon" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.3" y1="15.3" x2="20" y2="20" /></svg>
  ),
  library: () => (
    <svg className="icon" viewBox="0 0 24 24"><path d="M12 5.5C9.5 4.2 6.5 4.2 4 5.5V19C6.5 17.7 9.5 17.7 12 19Z" /><path d="M12 5.5C14.5 4.2 17.5 4.2 20 5.5V19C17.5 17.7 14.5 17.7 12 19Z" /></svg>
  ),
  forms: () => (
    <svg className="icon" viewBox="0 0 24 24"><path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M13 3v5h5" /><path d="M8.5 13.5l1.3 1.3L12.5 12" /><line x1="8.5" y1="17.5" x2="14" y2="17.5" /></svg>
  ),
  gateway: () => (
    <svg className="icon" viewBox="0 0 24 24"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  ),
};

const NAVIGATION_GROUPS = [
  {
    title: "Workspace",
    items: [
      { name: "Dashboard", path: "/dashboard", icon: SidebarIcons.dashboard() },
      { name: "Matters", path: "/workspace/matters", icon: SidebarIcons.gateway() },
      { name: "Contract Analyzer", path: "/contract-analyzer", icon: SidebarIcons.contract(), aiAssisted: true },
      { name: "Auto-Draft Studio", path: "/auto-draft", icon: SidebarIcons.pencil(), aiAssisted: true },
    ]
  },
  {
    title: "Litigation & disputes",
    items: [
      { name: "Court Resources", path: "/court-resources", icon: SidebarIcons.scales(), badge: { type: "live", label: "●" } },
      { name: "Legal Calendar", path: "/calendar", icon: SidebarIcons.calendar(), badgeKey: "urgentDeadlines" },
      { name: "Virtual Courtroom", path: "/war-room", icon: SidebarIcons.courthouse(), aiAssisted: true },
    ]
  },
  {
    title: "Practice & vault",
    items: [
      { name: "Case Vault", path: "/vault", icon: SidebarIcons.lock() },
      { name: "Conflict Engine", path: "/conflict-engine", icon: SidebarIcons.search() },
      { name: "Firm Library", path: "/firm-library", icon: SidebarIcons.library() },
      { name: "Legal Forms", path: "/legal-forms", icon: SidebarIcons.forms() },
    ]
  }
];

// ── SIDEBAR STYLES (Slate & Rust) ───────────────────────────────────────────────
// Scoped under .sb-root so nothing here leaks onto the rest of the app;
// dark-mode tokens key off html[data-theme="dark"], the same attribute
// ThemeContext already sets — no new theme mechanism introduced.
const SIDEBAR_STYLES = `
  .sb-root {
    --sb-bg:#DFE1E0; --sb-paper:#EAEBE8; --sb-paper-2:#E3E4E1;
    --sb-ink:#181B1D; --sb-ink-soft:#494E51; --sb-muted:#868C8E; --sb-muted-2:#B3B8B9; --sb-rule:#D2D5D4;
    --sb-accent:#B24A2E; --sb-accent-soft:#EFDCD1;
    --sb-capsule-bg:#3E4649; --sb-capsule-mono-bg:#4E585B;
    --sb-capsule-chip:#BEC4C5; --sb-capsule-chip-hover:#F0F2F1; --sb-capsule-mono-text:#F0F2F1;
    --sb-capsule-active-text:#FBF7EE;
    --sb-font-serif:'Fraunces', serif; --sb-font-sans:'IBM Plex Sans', sans-serif; --sb-font-mono:'IBM Plex Mono', monospace;
  }
  html[data-theme="dark"] .sb-root {
    --sb-bg:#191C1D; --sb-paper:#212527; --sb-paper-2:#2A2F31;
    --sb-ink:#D6D9D9; --sb-ink-soft:#AAAEAE; --sb-muted:#727776; --sb-muted-2:#494E4D; --sb-rule:#333939;
    --sb-accent:#CC6B48; --sb-accent-soft:#3B281F;
    --sb-capsule-bg:#C6CBCA; --sb-capsule-mono-bg:#B7BDBC;
    --sb-capsule-chip:#5D6362; --sb-capsule-chip-hover:#1D2021; --sb-capsule-mono-text:#1D2021;
  }

  .sb-wrap{
    width:278px;
    height:100%;
    flex-shrink:0;
    position:relative;
    overflow:hidden;
    transition:width 420ms cubic-bezier(.32, .72, 0, 1);
  }
  .sb-wrap *{ box-sizing:border-box; }
  .sb-wrap.collapsed{ width:96px; }
  .sb-icon.icon, .sb-icon svg{ width:18px; height:18px; flex-shrink:0; }
  .sb-icon svg path, .sb-icon svg line, .sb-icon svg rect, .sb-icon svg circle{ stroke:currentColor; fill:none; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }

  .sb-sidebar{
    width:278px;
    height:100%;
    position:absolute;
    top:0;
    left:0;
    background:var(--sb-paper);
    border-right:1px solid var(--sb-rule);
    display:flex;
    flex-direction:column;
    opacity:1;
    transform:translateX(0);
    pointer-events:auto;
    transition:opacity 260ms cubic-bezier(.32, .72, 0, 1) 120ms,
               transform 320ms cubic-bezier(.32, .72, 0, 1) 120ms,
               background .2s ease,
               border-color .2s ease;
  }
  .sb-wrap.collapsed .sb-sidebar{
    opacity:0;
    transform:translateX(-10px);
    pointer-events:none;
    transition:opacity 260ms cubic-bezier(.32, .72, 0, 1) 0ms,
               transform 320ms cubic-bezier(.32, .72, 0, 1) 0ms,
               background .2s ease,
               border-color .2s ease;
  }
  .sb-masthead{ padding:26px 24px 16px; border-bottom:1px solid var(--sb-rule); position:relative; }
  .sb-firm-name{ font-family:var(--sb-font-serif); font-style:italic; font-weight:600; font-size:20px; color:var(--sb-ink); line-height:1.15; }
  .sb-product-credit{ font-family:var(--sb-font-mono); font-size:10px; letter-spacing:.06em; color:var(--sb-muted); margin-top:5px; }
  .sb-collapse-toggle{ position:absolute; top:26px; right:22px; background:none; border:1px solid var(--sb-rule); width:22px; height:22px; border-radius:4px; color:var(--sb-muted); font-family:var(--sb-font-mono); font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
  .sb-collapse-toggle:hover{ border-color:var(--sb-accent); color:var(--sb-accent); }
  .sb-collapse-toggle:focus-visible, .sb-collapse-toggle:focus{ outline:2px solid var(--sb-accent); outline-offset:1px; }

  .sb-search-line{ width:100%; padding:14px 24px 12px; border-bottom:1px solid var(--sb-rule); display:flex; align-items:baseline; gap:6px; cursor:text; background:none; border-left:none; border-right:none; border-top:none; text-align:left; font-family:inherit; }
  .sb-search-prompt{ font-family:var(--sb-font-mono); font-size:13px; color:var(--sb-muted); }
  .sb-search-cursor{ display:inline-block; width:7px; height:14px; background:var(--sb-ink); animation:sb-blink 1.1s steps(1) infinite; vertical-align:-2px; }
  @keyframes sb-blink{ 50%{ opacity:0; } }
  .sb-search-kbd{ margin-left:auto; font-family:var(--sb-font-mono); font-size:10.5px; color:var(--sb-muted-2); flex-shrink:0; }
  .sb-search-line:focus-visible{ outline:2px solid var(--sb-accent); outline-offset:-2px; }

  .sb-index{ flex:1; overflow-y:auto; padding-bottom:8px; }
  .sb-group-label{ font-family:var(--sb-font-serif); font-style:italic; font-size:12.5px; color:var(--sb-ink-soft); padding:20px 24px 8px; }
  .sb-entry{ display:flex; align-items:center; gap:13px; padding:9px 24px; border-bottom:1px solid var(--sb-paper-2); cursor:pointer; text-decoration:none; color:inherit; }
  .sb-entry:hover{ background:var(--sb-paper-2); }
  .sb-entry:hover .sb-icon{ color:var(--sb-accent); }
  .sb-entry:hover .sb-label{ color:var(--sb-ink); }
  .sb-entry:focus-visible{ outline:2px solid var(--sb-accent); outline-offset:-2px; }
  .sb-entry .sb-icon{ color:var(--sb-muted-2); }
  .sb-label{ font-size:13.5px; color:var(--sb-ink-soft); flex:1; font-family:var(--sb-font-sans); }
  .sb-mark{ color:var(--sb-accent); font-size:12px; }
  .sb-live-dot{ width:6px; height:6px; border-radius:50%; background:var(--sb-accent); flex-shrink:0; }
  .sb-case-active{ background:var(--sb-paper-2); }
  .sb-case-active .sb-label{ color:var(--sb-ink); font-weight:600; }

  .sb-active{ flex-direction:column; align-items:flex-start; gap:6px; padding:16px 24px 18px 21px; border-left:3px solid var(--sb-accent); background:var(--sb-accent-soft); border-bottom:1px solid var(--sb-rule); cursor:default; }
  .sb-active:hover{ background:var(--sb-accent-soft); }
  .sb-active-top{ display:flex; align-items:center; gap:13px; }
  .sb-active .sb-icon{ color:var(--sb-accent); width:26px; height:26px; }
  .sb-active .sb-icon svg{ width:26px; height:26px; }
  .sb-active .sb-icon svg path, .sb-active .sb-icon svg line, .sb-active .sb-icon svg rect, .sb-active .sb-icon svg circle{ stroke-width:1.4; }
  .sb-active .sb-label{ font-family:var(--sb-font-serif); font-weight:600; font-size:17px; color:var(--sb-ink); flex:none; }
  .sb-active-status{ font-family:var(--sb-font-mono); font-size:11px; color:var(--sb-ink-soft); padding-left:39px; }
  .sb-footnote{ padding:10px 24px 4px; font-family:var(--sb-font-mono); font-style:italic; font-size:10.5px; color:var(--sb-muted); }

  .sb-footer{ border-top:1px solid var(--sb-rule); padding:14px 24px 18px; }
  .sb-focus-row{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
  .sb-focus-label{ font-family:var(--sb-font-serif); font-style:italic; font-size:13px; color:var(--sb-ink-soft); }
  .sb-toggle-track{ width:30px; height:15px; border:1px solid var(--sb-muted-2); border-radius:3px; position:relative; cursor:pointer; background:transparent; padding:0; }
  .sb-toggle-track::after{ content:""; position:absolute; top:2px; left:2px; width:9px; height:9px; background:var(--sb-muted-2); transition:transform .15s ease, background .15s ease; }
  .sb-toggle-track.on{ border-color:var(--sb-accent); }
  .sb-toggle-track.on::after{ transform:translateX(16px); background:var(--sb-accent); }
  .sb-toggle-track:focus-visible{ outline:2px solid var(--sb-accent); outline-offset:2px; }

  .sb-profile{ display:flex; flex-direction:column; padding-top:12px; border-top:1px solid var(--sb-rule); position:relative; }
  .sb-profile-click{ display:flex; align-items:center; gap:10px; cursor:pointer; }
  .sb-profile-name{ font-family:var(--sb-font-serif); font-size:13.5px; color:var(--sb-ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sb-profile-role{ font-family:var(--sb-font-mono); font-size:9.5px; letter-spacing:.03em; color:var(--sb-muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px; }
  .sb-profile-caret{ margin-left:auto; color:var(--sb-muted); font-size:11px; transition:transform .12s ease; flex-shrink:0; }
  .sb-profile.open .sb-profile-caret{ transform:rotate(180deg); }
  .sb-profile-menu{ position:absolute; bottom:calc(100% + 8px); left:0; right:0; background:var(--sb-paper); border:1px solid var(--sb-rule); box-shadow:0 10px 24px rgba(0,0,0,.18); display:none; z-index:5; }
  .sb-profile.open .sb-profile-menu{ display:block; }
  .sb-profile-menu button{ display:block; width:100%; text-align:left; background:none; border:none; border-bottom:1px solid var(--sb-paper-2); font-family:var(--sb-font-sans); font-size:12.5px; color:var(--sb-ink-soft); padding:10px 14px; cursor:pointer; }
  .sb-profile-menu button:last-child{ border-bottom:none; color:var(--sb-accent); }
  .sb-profile-menu button:hover:not(:disabled){ background:var(--sb-paper-2); }
  .sb-profile-menu button:disabled{ opacity:.5; cursor:not-allowed; }
  .sb-profile-menu button:focus-visible{ outline:2px solid var(--sb-accent); outline-offset:-2px; }

  .sb-capsule-outer{
    width:96px;
    height:100%;
    position:absolute;
    top:0;
    left:0;
    display:flex;
    align-items:stretch;
    justify-content:center;
    padding:20px 0 20px 20px;
    opacity:0;
    transform:translateX(10px);
    pointer-events:none;
    transition:opacity 260ms cubic-bezier(.32, .72, 0, 1) 0ms,
               transform 320ms cubic-bezier(.32, .72, 0, 1) 0ms;
  }
  .sb-wrap.collapsed .sb-capsule-outer{
    opacity:1;
    transform:translateX(0);
    pointer-events:auto;
    transition:opacity 260ms cubic-bezier(.32, .72, 0, 1) 120ms,
               transform 320ms cubic-bezier(.32, .72, 0, 1) 120ms;
  }
  .sb-capsule{ width:64px; background:var(--sb-capsule-bg); border-radius:32px; display:flex; flex-direction:column; align-items:center; padding:18px 0; transition:background .2s ease; }
  .sb-capsule-mono{ width:34px; height:34px; border-radius:10px; background:var(--sb-capsule-mono-bg); color:var(--sb-capsule-mono-text); display:flex; align-items:center; justify-content:center; font-family:var(--sb-font-serif); font-style:italic; font-weight:600; font-size:15px; margin-bottom:20px; flex-shrink:0; }
  .sb-capsule-expand{ background:none; border:none; color:var(--sb-capsule-chip); font-family:var(--sb-font-mono); font-size:12px; cursor:pointer; margin-bottom:16px; flex-shrink:0; }
  .sb-capsule-expand:hover{ color:var(--sb-capsule-chip-hover); }
  .sb-capsule-expand:focus-visible{ outline:2px solid var(--sb-capsule-chip-hover); }
  .sb-capsule-list{ display:flex; flex-direction:column; gap:6px; flex:1; overflow-y:auto; align-items:center; }
  .sb-capsule-gap{ height:10px; width:100%; flex-shrink:0; }
  .sb-chip{ width:38px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center; color:var(--sb-capsule-chip); cursor:pointer; position:relative; text-decoration:none; flex-shrink:0; }
  .sb-chip:hover{ color:var(--sb-capsule-chip-hover); }
  .sb-chip:focus-visible{ outline:2px solid var(--sb-capsule-chip-hover); }
  .sb-chip svg{ width:18px; height:18px; }
  .sb-chip svg path, .sb-chip svg line, .sb-chip svg rect, .sb-chip svg circle{ stroke:currentColor; fill:none; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
  .sb-chip.active{ background:var(--sb-accent); color:var(--sb-capsule-active-text); width:44px; height:42px; }
  .sb-chip.active svg{ width:21px; height:21px; }
  .sb-ai-flag{ position:absolute; top:4px; right:4px; width:5px; height:5px; border-radius:50%; background:var(--sb-accent); }
  .sb-capsule-avatar{ width:32px; height:32px; border-radius:50%; background:var(--sb-capsule-mono-bg); color:var(--sb-capsule-mono-text); display:flex; align-items:center; justify-content:center; font-family:var(--sb-font-mono); font-size:10.5px; font-weight:600; margin-top:16px; cursor:pointer; flex-shrink:0; }
  .sb-capsule-avatar:focus-visible{ outline:2px solid var(--sb-capsule-chip-hover); }

  @media (prefers-reduced-motion: reduce) {
    .sb-wrap,
    .sb-sidebar,
    .sb-capsule-outer {
      transition-duration: 1ms !important;
      transition-delay: 0ms !important;
    }
  }

  /* ── TOPBAR & BREADCRUMBS (Slate & Rust Theme Harmonization) ── */
  .topbar {
    height: 56px;
    background: var(--sb-paper) !important;
    border-bottom: 1px solid var(--sb-rule) !important;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 28px;
    font-family: var(--sb-font-sans);
    transition: background .15s ease, border-color .15s ease;
  }
  html[data-theme="dark"] .topbar,
  :root[data-theme="dark"] .topbar {
    background: var(--sb-paper) !important;
    border-bottom: 1px solid var(--sb-rule) !important;
  }

  .breadcrumbs-container {
    display: flex;
    align-items: center;
    font-family: var(--sb-font-sans);
    font-size: 13px;
    color: var(--sb-muted);
  }
  .crumb-item {
    display: inline-flex;
    align-items: center;
  }
  .crumb-link {
    color: var(--sb-muted) !important;
    text-decoration: none !important;
    font-weight: 500;
    transition: color .15s ease;
  }
  .crumb-link:hover {
    color: var(--sb-accent) !important;
  }
  .crumb-sep {
    color: var(--sb-muted-2) !important;
    margin: 0 8px;
    font-size: 11px;
  }
  .crumb-ellipsis {
    color: var(--sb-muted) !important;
  }
  .crumb-current {
    color: var(--sb-ink) !important;
    font-weight: 600;
  }
  html[data-theme="dark"] .crumb-current {
    color: var(--sb-ink) !important;
  }

  .topbar-theme-toggle {
    background: var(--sb-bg) !important;
    border: 1px solid var(--sb-rule) !important;
    color: var(--sb-muted) !important;
    border-radius: 6px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
    margin-left: auto;
    flex-shrink: 0;
  }
  .topbar-theme-toggle:hover {
    border-color: var(--sb-accent) !important;
    color: var(--sb-accent) !important;
    background: var(--sb-accent-soft) !important;
  }
  html[data-theme="dark"] .topbar-theme-toggle {
    background: var(--sb-bg) !important;
    border-color: var(--sb-rule) !important;
    color: var(--sb-muted) !important;
  }
  html[data-theme="dark"] .topbar-theme-toggle:hover {
    border-color: var(--sb-accent) !important;
    color: var(--sb-accent) !important;
    background: var(--sb-accent-soft) !important;
  }

  .topbar-tagline {
    font-family: var(--sb-font-sans);
    font-size: 12px;
    color: var(--sb-muted) !important;
    white-space: nowrap;
    margin-left: 14px;
    flex-shrink: 0;
  }
  .topbar-tagline strong {
    color: var(--sb-ink-soft) !important;
    font-weight: 600;
  }
  html[data-theme="dark"] .topbar-tagline {
    color: var(--sb-muted) !important;
  }
  html[data-theme="dark"] .topbar-tagline strong {
    color: var(--sb-ink) !important;
  }

  .hamburger-btn {
    color: var(--sb-muted) !important;
    background: transparent;
    border: none;
    cursor: pointer;
    margin-right: 12px;
    display: flex;
    align-items: center;
    padding: 0;
    transition: color .15s ease;
  }
  .hamburger-btn:hover {
    color: var(--sb-accent) !important;
  }
`;

// ── SIDEBAR NAV ITEM ───────────────────────────────────────────────────────────
// Slate & Rust nav row. The active item "breaks the row rhythm" entirely
// (larger icon, serif bold label, status line, left border, tinted
// background) rather than just getting a background tint — the one
// deliberately bold moment in an otherwise quiet index. `activeStatus` is
// only ever real, on-hand data (e.g. a live tracked-case count) — omitted
// rather than invented for items with nothing genuine to report.
const NavItem = ({ item, isActive, activeStatus, onClick }) => {
  if (isActive) {
    return (
      <Link to={item.path} onClick={onClick} className="sb-entry sb-active">
        <div className="sb-active-top">
          <span className="sb-icon">{item.icon}</span>
          <span className="sb-label">{item.name}{item.aiAssisted && <span className="sb-mark"> *</span>}</span>
        </div>
        {activeStatus && <div className="sb-active-status">{activeStatus}</div>}
      </Link>
    );
  }
  return (
    <Link to={item.path} onClick={onClick} className="sb-entry">
      <span className="sb-icon">{item.icon}</span>
      <span className="sb-label">{item.name}{item.aiAssisted && <span className="sb-mark"> *</span>}</span>
      {item.badge?.type === 'live' && <span className="sb-live-dot" title="Live" />}
    </Link>
  );
};

// ── SPINNER ────────────────────────────────────────────────────────────────────
const Spinner = ({ size = 20 }) => (
  <div style={{
    width: size, height: size,
    border: `2px solid rgba(255,255,255,0.08)`,
    borderTopColor: 'var(--accent-primary)',
    borderRadius: '50%',
    animation: 'spin 0.9s linear infinite',
    flexShrink: 0,
  }} />
);

// ── BREADCRUMBS ────────────────────────────────────────────────────────────────
const Breadcrumbs = () => {
  const params = useParams();
  const location = useLocation();
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  React.useEffect(() => {
    const h = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const isSmall = windowWidth < 768;

  // Build breadcrumb items from pathname — no hardcoded data lookups
  const items = [{ label: 'Dashboard', url: '/dashboard' }];
  const p = location.pathname;
  if (p === '/court-resources') items.push({ label: 'Court Resources', url: p });
  else if (p === '/workspace/matters' || p === '/chamber' || p === '/matters') items.push({ label: 'Matters', url: '/workspace/matters' });
  else if (p.startsWith('/workspace/matter/')) items.push({ label: 'Matter Workspace', url: p });
  else if (p.startsWith('/workspace/team/')) items.push({ label: 'Team Hub', url: p });
  else if (p === '/workspace/org') items.push({ label: 'Firm Executive Console', url: p });
  else if (p === '/contract-analyzer') items.push({ label: 'Contract Analyzer', url: p });
  else if (p === '/auto-draft') items.push({ label: 'Auto-Draft Studio', url: p });
  else if (p === '/conflict-engine') items.push({ label: 'Conflict Engine', url: p });
  else if (p === '/calendar') items.push({ label: 'Legal Calendar', url: p });
  else if (p === '/vault') items.push({ label: 'Case Vault', url: p });
  else if (p === '/war-room') items.push({ label: 'Virtual Courtroom', url: p });
  else if (p === '/firm-library') items.push({ label: 'Firm Library', url: p });
  else {
    if (params.caseId) {
      const label = params.caseId === 'vault' ? 'Document Vault' : `Case #${params.caseId}`;
      items.push({ label, url: `/case/${params.caseId}` });
    }
    if (params.docId) items.push({ label: `Document #${params.docId}`, url: p });
  }

  if (isSmall && items.length > 2) {
    return (
      <div className="breadcrumbs-container">
        <Link to={items[0].url} className="crumb-link">{items[0].label}</Link>
        <span className="crumb-sep">/</span>
        <span className="crumb-ellipsis">...</span>
        <span className="crumb-sep">/</span>
        <span className="crumb-current">{items[items.length - 1].label}</span>
      </div>
    );
  }

  return (
    <div className="breadcrumbs-container">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={item.url} className="crumb-item">
            {i > 0 && <span className="crumb-sep">/</span>}
            {isLast
              ? <span className="crumb-current">{item.label}</span>
              : <Link to={item.url} className="crumb-link">{item.label}</Link>
            }
          </span>
        );
      })}
    </div>
  );
};

// ── LAYOUT SHELL ───────────────────────────────────────────────────────────────
const Layout = ({ children, focusMode, setFocusMode }) => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('lexai_sidebar_collapsed') === '1');
  useEffect(() => {
    localStorage.setItem('lexai_sidebar_collapsed', isCollapsed ? '1' : '0');
  }, [isCollapsed]);
  // Focus mode and manual collapse both render the same compact capsule —
  // building two different collapsed treatments for a distinction the
  // brief never draws would just be extra complexity for no real gain.
  const isIconOnly = isCollapsed || focusMode;

  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e) => { if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [profileOpen]);

  // Mobile viewport tracking. On mobile the sidebar is already forced to a full-width
  // off-canvas drawer (see index.css), so the "Focus Mode" toggle — normally hidden
  // in icon-only mode — needs to stay reachable there; it's the only non-keyboard,
  // non-floating-pill way to turn focus mode back off (Bug #2).
  const [navViewportWidth, setNavViewportWidth] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setNavViewportWidth(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  const isMobileNav = navViewportWidth <= 768;

  // ── Sidebar case list — fetched live from the real API ──────────────────
  const [sidebarCases, setSidebarCases] = useState([]);
  useEffect(() => {
    fetchTrackedCases()
      .then(data => { if (Array.isArray(data)) setSidebarCases(data); })
      .catch(() => { });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setFocusMode(f => !f);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setFocusMode]);

  const closeSidebar = () => setIsSidebarOpen(false);
  // Sidebar LexAmplify button opens the AI in immersive full-screen "War Room" mode
  const openAgent = () => window.dispatchEvent(new CustomEvent('toggle-rag-palette', { detail: { mode: 'fullscreen' } }));
  // useAuth().logout() is the real session teardown (POSTs /api/auth/logout,
  // clearing the HttpOnly JWT cookie) — the old handler here only cleared
  // localStorage keys left over from a pre-cookie auth scheme and no longer
  // actually ended the session server-side.
  const handleSignOut = async () => {
    await logout();
    navigate('/');
  };

  const p = location.pathname;
  const monogram = (user?.name || 'L').trim().charAt(0).toUpperCase();
  const avatarInitials = user?.name
    ? user.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
    : (user?.email || 'L')[0].toUpperCase();

  return (
    <div className={`app-container ${focusMode ? 'focus-mode-active' : ''}`}>
      <div className={`sidebar-overlay ${isSidebarOpen ? 'visible' : ''}`} onClick={closeSidebar} />

      <style>{SIDEBAR_STYLES}</style>

      {/* ── SIDEBAR (Slate & Rust) ───────────────────────────────────────── */}
      <div className={`sb-wrap sb-root${isIconOnly ? ' collapsed' : ''}${isSidebarOpen ? ' sb-mobile-open' : ''}`}>

        <aside className="sb-sidebar">
          <div className="sb-masthead">
            <div style={{ flex: 1, minWidth: 0 }}>
              <ChamberSwitcher variant="sidebar" isCollapsed={isIconOnly} />
            </div>
            {!focusMode && (
              <button className="sb-collapse-toggle" onClick={() => setIsCollapsed(true)} aria-label="Collapse sidebar" title="Collapse sidebar">‹</button>
            )}
          </div>

          <button type="button" className="sb-search-line" onClick={openAgent}>
            <span className="sb-search-prompt">&gt; search or ask</span>
            <span className="sb-search-cursor" />
            <span className="sb-search-kbd">⌘K</span>
          </button>

          <div className="sb-index">
            {NAVIGATION_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="sb-group-label">{group.title}</div>
                {group.items.map(item => {
                  const isActive = item.path === '/dashboard' ? p === item.path : p.startsWith(item.path);
                  let activeStatus;
                  if (isActive && item.path === '/vault') {
                    activeStatus = `${sidebarCases.length} tracked matter${sidebarCases.length !== 1 ? 's' : ''}`;
                  } else if (isActive && item.badge?.type === 'live') {
                    activeStatus = 'Live';
                  }
                  return (
                    <NavItem key={item.path} item={item} isActive={isActive} activeStatus={activeStatus} onClick={closeSidebar} />
                  );
                })}
              </div>
            ))}

            {/* Live case listing from API — real functionality the mockup
                never anticipated, kept as a fourth dynamic group. */}
            {sidebarCases.length > 0 && (
              <div>
                <div className="sb-group-label">Tracked cases</div>
                {sidebarCases.map(c => {
                  const caseName = c.case_name || c.title || `Case #${c.id}`;
                  const isActive = params.caseId === String(c.id);
                  return (
                    <Link
                      key={c.id}
                      to={`/case/${c.id}`}
                      onClick={closeSidebar}
                      className={`sb-entry${isActive ? ' sb-case-active' : ''}`}
                    >
                      <span className="sb-icon">{Icons.folder(18)}</span>
                      <span className="sb-label">{caseName}</span>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="sb-footnote">* AI-assisted</div>
          </div>

          <div className="sb-footer">
            <div className="sb-focus-row">
              <span className="sb-focus-label">Focus mode</span>
              <button
                type="button"
                className={`sb-toggle-track${focusMode ? ' on' : ''}`}
                onClick={() => setFocusMode(f => !f)}
                aria-pressed={focusMode}
                aria-label="Toggle focus mode"
                title={focusMode ? 'Exit Focus Mode (Ctrl+\\)' : 'Focus Mode (Ctrl+\\)'}
              />
            </div>
            <div className={`sb-profile${profileOpen ? ' open' : ''}`} ref={profileRef}>
              <div className="sb-profile-click" onClick={() => setProfileOpen(o => !o)}>
                <div style={{ minWidth: 0 }}>
                  <div className="sb-profile-name">{user?.name || 'Guest'}</div>
                  <div className="sb-profile-role">{user?.email || ''}</div>
                </div>
                <span className="sb-profile-caret">⌄</span>
              </div>
              <div className="sb-profile-menu">
                <button type="button" disabled title="Not built yet — no account settings page exists">Account settings</button>
                <button type="button" onClick={handleSignOut}>Log out</button>
              </div>
            </div>
          </div>
        </aside>

        {/* ── COLLAPSED CAPSULE ────────────────────────────────────────────── */}
        <div className="sb-capsule-outer">
          <div className="sb-capsule">
            <div className="sb-capsule-mono">{monogram}</div>
            <button className="sb-capsule-expand" onClick={() => setIsCollapsed(false)} aria-label="Expand sidebar" title="Expand sidebar">›</button>
            <div className="sb-capsule-list">
              {NAVIGATION_GROUPS.map((group, gIdx) => (
                <React.Fragment key={group.title}>
                  {gIdx > 0 && <div className="sb-capsule-gap" />}
                  {group.items.map(item => {
                    const isActive = item.path === '/dashboard' ? p === item.path : p.startsWith(item.path);
                    return (
                      <Link key={item.path} to={item.path} className={`sb-chip${isActive ? ' active' : ''}`} title={item.name} onClick={closeSidebar}>
                        {item.icon}
                        {item.aiAssisted && !isActive && <span className="sb-ai-flag" />}
                      </Link>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
            <div className="sb-capsule-avatar" onClick={() => setIsCollapsed(false)} title={user?.name || 'Account'}>{avatarInitials}</div>
          </div>
        </div>
      </div>

      {/* ── FOCUS MODE ESCAPE HATCH — centered glassmorphic pill ─────────── */}
      {focusMode && (
        <button
          onClick={() => setFocusMode(false)}
          title="Exit Focus Mode (Ctrl+\)"
          className="focus-exit-pill"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
          Exit Focus Mode
          <span style={{ fontSize: '10px', opacity: 0.55, fontFamily: 'monospace', background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: '4px' }}>Ctrl+\</span>
        </button>
      )}

      {/* ── WORKSPACE ────────────────────────────────────────────────────── */}
      <div className="workspace-container relative z-0 min-w-0 flex-1 overflow-x-hidden">
        <header className="topbar">
          <button className="hamburger-btn" onClick={() => setIsSidebarOpen(v => !v)} aria-label="Toggle navigation">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <Breadcrumbs />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ChamberSwitcher variant="topbar" />
          </div>

          <ContextCapsule />

          <button
            className="topbar-theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
          >
            {theme === 'dark' ? Icons.sun() : Icons.moon()}
          </button>

          {/* "Operating strictly under Indian Law" tagline — lowest priority
              header element. On narrow phones it drops to its own full-width
              line below the hamburger/title/toggle row instead of fighting
              them for space (Bug #6); see .topbar-tagline media query. */}
          <div className="topbar-tagline">
            Operating strictly under <strong>Indian Law</strong>
          </div>
        </header>

        <main style={{ flex: 1, overflowY: 'auto' }}>
          <div key={location.pathname} className="page-enter">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};


// ── ROUTER ─────────────────────────────────────────────────────────────────────
function AppRouterContent() {
  const [focusMode, setFocusMode] = useState(false);

  return (
    <BrowserRouter>
      <CommandPalette />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><DashboardView /></Layout>} />
        <Route path="/workspace/matters" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><MatterLauncher /></Layout>} />
        <Route path="/workspace/matter/:matterId" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><MatterDashboard /></Layout>} />
        <Route path="/workspace/team/:teamId" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><TeamDashboard /></Layout>} />
        <Route path="/workspace/org" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><OrgDashboard /></Layout>} />
        <Route path="/chamber" element={<Navigate to="/workspace/matters" replace />} />
        <Route path="/matters" element={<Navigate to="/workspace/matters" replace />} />
        <Route path="/home" element={<Navigate to="/workspace/matters" replace />} />
        <Route path="/contract-analyzer" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><ErrorBoundary><ContractAnalyzer setFocusMode={setFocusMode} /></ErrorBoundary></Layout>} />
        <Route path="/auto-draft" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><AutoDraftWorkspace /></Layout>} />
        <Route path="/court-resources" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><CourtResources /></Layout>} />
        <Route path="/conflict-engine" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><ConflictEngine /></Layout>} />
        <Route path="/case/:caseId" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><CaseVault /></Layout>} />
        <Route path="/calendar" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><CalendarView /></Layout>} />
        <Route path="/vault" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><CaseWorkspace /></Layout>} />
        <Route path="/war-room" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><WarRoomView /></Layout>} />
        <Route path="/firm-library" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><FirmLibrary /></Layout>} />
        <Route path="/legal-forms" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><FormTemplateLibrary /></Layout>} />
        <Route path="/firm-library/draft" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><LegalForms showSaveBar /></Layout>} />
        <Route path="/analyzer" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><ErrorBoundary><ContractAnalyzer setFocusMode={setFocusMode} /></ErrorBoundary></Layout>} />
        <Route path="/case/:caseId/doc/:docId" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><DocumentViewer focusMode={focusMode} setFocusMode={setFocusMode} /></Layout>} />
      </Routes>
    </BrowserRouter>
  );
}

export default function AppRouter() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRouterContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
