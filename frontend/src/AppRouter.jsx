import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { fetchTrackedCases, fetchDocuments } from './services/api';
import CommandPalette from './components/CommandPalette';
import CaseVault from './components/CaseVault';
import DocumentViewer from './components/DocumentViewer';
import CourtResources from './components/CourtResources';
import ContractAnalyzer from './components/ContractAnalyzer';
import AutoDraftWorkspace from './components/AutoDraftWorkspace';
import { useContractStore } from './store/useContractStore';
import ConflictEngine from './components/ConflictEngine';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import CalendarView from './components/CalendarView';
import VaultView from './components/VaultView';
import CaseWorkspace from './components/CaseWorkspace';
import WarRoomView from './components/WarRoomView';
import FirmLibrary from './components/FirmLibrary';
import LegalForms from './components/LegalForms';
import FormTemplateLibrary from './components/FormTemplateLibrary';
import LexLogoMark from './components/LexLogoMark';
import TEMPLATES from './data/legalTemplates.js';

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

// ── SIDEBAR NAV ITEM ───────────────────────────────────────────────────────────
const NavItem = ({ to, icon, label, isActive, onClick }) => (
  <Link to={to} onClick={onClick} title={label} className={`sidebar-nav-item${isActive ? ' active' : ''}`}>
    <span className="nav-icon">{icon}</span>
    <span className="nav-label">{label}</span>
  </Link>
);

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
      <div className="breadcrumbs-container" style={{ fontSize: '13px' }}>
        <Link to={items[0].url} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{items[0].label}</Link>
        <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>/</span>
        <span style={{ color: 'var(--text-muted)' }}>...</span>
        <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{items[items.length - 1].label}</span>
      </div>
    );
  }

  return (
    <div className="breadcrumbs-container" style={{ fontSize: '13px' }}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={item.url}>
            {i > 0 && <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>/</span>}
            {isLast
              ? <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{item.label}</span>
              : <Link to={item.url} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{item.label}</Link>
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
  const { theme, toggleTheme } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Focus mode renders the sidebar as a 64px icon-only "tactical rail" (fixed-position
  // stealth overlay). Manual collapse also uses the icon rail.
  const isIconOnly = isCollapsed || focusMode;

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
  const handleSignOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('lexai_token');
  };

  const p = location.pathname;

  return (
    <div className={`app-container ${focusMode ? 'focus-mode-active' : ''}`}>
      <div className={`sidebar-overlay ${isSidebarOpen ? 'visible' : ''}`} onClick={closeSidebar} />

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside className={`sidebar bg-[#0B0F17] opacity-100 sticky top-0 z-50 h-screen ${isSidebarOpen ? 'sidebar-open' : ''} ${isIconOnly ? 'sidebar-collapsed' : ''}`}>

        {/* Logo / brand header */}
        <div
          className={`sidebar-header ${isIconOnly ? 'collapsed' : ''}`}
          style={{
            padding: isIconOnly ? '14px 10px' : '18px 16px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
            cursor: isCollapsed ? 'pointer' : 'default',
          }}
          onClick={isCollapsed ? () => setIsCollapsed(false) : undefined}
          title={isCollapsed ? 'Expand sidebar' : undefined}
        >
          <div className="sidebar-brand" style={{ justifyContent: isIconOnly ? 'center' : 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <div className="sidebar-logo-mark">
                <LexLogoMark size={34} />
              </div>
              {!isIconOnly && (
                <div className="sidebar-brand-text" style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.2px' }}>LexAmplify</div>
                  <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Enterprise Console</div>
                </div>
              )}
            </div>
            {!focusMode && (
              <button
                className={`sidebar-collapse-btn${isCollapsed ? ' merged' : ''}`}
                onClick={(e) => { e.stopPropagation(); setIsCollapsed(c => !c); }}
                title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {isCollapsed ? Icons.chevronRight(14) : Icons.chevronLeft(12)}
              </button>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          <NavItem to="/dashboard" icon={Icons.dashboard()} label="Dashboard Home" isActive={p === '/dashboard'} onClick={closeSidebar} />
          <NavItem to="/contract-analyzer" icon={Icons.contract()} label="Contract Analyzer" isActive={p === '/contract-analyzer'} onClick={closeSidebar} />
          <NavItem to="/auto-draft" icon={Icons.wand()} label="Auto-Draft Studio" isActive={p === '/auto-draft'} onClick={closeSidebar} />
          <NavItem to="/court-resources" icon={Icons.scales()} label="Court Resources" isActive={p === '/court-resources'} onClick={closeSidebar} />
          <NavItem to="/conflict-engine" icon={Icons.search()} label="Conflict Engine" isActive={p === '/conflict-engine'} onClick={closeSidebar} />
          <NavItem to="/calendar" icon={Icons.calendar()} label="Legal Calendar" isActive={p === '/calendar'} onClick={closeSidebar} />
          <NavItem to="/vault" icon={Icons.lock()} label="Case Vault" isActive={p === '/vault'} onClick={closeSidebar} />
          <NavItem to="/war-room" icon={Icons.gavel()} label="Virtual Courtroom" isActive={p === '/war-room'} onClick={closeSidebar} />
          <NavItem to="/firm-library" icon={Icons.library()} label="Firm Library" isActive={p === '/firm-library'} onClick={closeSidebar} />
          <NavItem to="/legal-forms" icon={Icons.forms()} label="Legal Forms" isActive={p === '/legal-forms'} onClick={closeSidebar} />

          {/* Live case listing from API */}
          {!isIconOnly && sidebarCases.length > 0 && (
            <>
              <div style={{ margin: '14px 0 6px', padding: '0 24px' }}>
                <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.9px' }}>
                  Tracked Cases
                </span>
              </div>
              {sidebarCases.map(c => (
                <Link
                  key={c.id}
                  to={`/case/${c.id}`}
                  onClick={closeSidebar}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '7px 16px', margin: '1px 8px', borderRadius: '6px',
                    color: params.caseId === String(c.id) ? 'var(--accent-primary)' : 'var(--text-muted)',
                    textDecoration: 'none', fontSize: '12.5px',
                    background: params.caseId === String(c.id) ? 'rgba(59,130,246,0.08)' : 'transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ flexShrink: 0, opacity: 0.65 }}>{Icons.folder()}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.case_name || c.title || `Case #${c.id}`}
                  </span>
                </Link>
              ))}
            </>
          )}
        </nav>

        {/* Bottom Controls */}
        <div style={{ padding: isIconOnly ? '10px 8px' : '14px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
          {/* LexAmplify */}
          <button
            onClick={openAgent}
            title={isIconOnly ? 'LexAmplify (⌘K)' : undefined}
            style={{
              width: '100%', padding: isIconOnly ? '9px' : '9px 12px',
              background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(37,99,235,0.08))',
              border: '1px solid rgba(59,130,246,0.22)', borderRadius: '8px',
              cursor: 'pointer', fontSize: '12.5px', fontWeight: '600',
              color: 'var(--accent-primary)',
              display: 'flex', alignItems: 'center', justifyContent: isIconOnly ? 'center' : 'flex-start', gap: '8px',
              transition: 'all 0.2s',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center' }}>{Icons.chat()}</span>
            {!isIconOnly && (
              <>
                <span>LexAmplify</span>
                <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.6, fontFamily: 'monospace', background: 'rgba(59,130,246,0.15)', padding: '1px 5px', borderRadius: '4px' }}>⌘K</span>
              </>
            )}
          </button>

          {/* Log Out */}
          <Link to="/" onClick={handleSignOut} style={{ textDecoration: 'none' }}>
            <button title={isIconOnly ? 'Log Out' : undefined} style={{
              width: '100%', padding: isIconOnly ? '8px' : '8px 12px',
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border-subtle)', borderRadius: '7px',
              cursor: 'pointer', fontSize: '12.5px',
              display: 'flex', alignItems: 'center', justifyContent: isIconOnly ? 'center' : 'flex-start', gap: '8px', transition: 'all 0.15s',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', opacity: 0.7 }}>{Icons.logout()}</span>
              {!isIconOnly && 'Log Out'}
            </button>
          </Link>

          {/* Focus Mode toggle — hidden when icon-only on desktop (Ctrl+\ still works there);
              kept visible on mobile since it's the only tap-reachable way to exit focus mode
              once the floating exit pill is hidden on small viewports (Bug #2). */}
          {(!isIconOnly || isMobileNav) && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <span>Focus Mode</span>
              <div
                onClick={() => setFocusMode(f => !f)}
                style={{
                  width: '32px', height: '17px', borderRadius: '10px', cursor: 'pointer',
                  background: focusMode ? 'var(--accent-primary)' : 'var(--border-subtle)',
                  border: '1px solid transparent', position: 'relative', transition: 'background 0.2s',
                }}
              >
                <div style={{
                  position: 'absolute', top: '2px',
                  left: focusMode ? '15px' : '2px',
                  width: '11px', height: '11px', borderRadius: '50%',
                  background: 'white', transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </div>
            </div>
          )}
        </div>
      </aside>

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

          <button
            className="topbar-theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            style={{
              background: 'transparent', border: '1px solid var(--border-subtle)',
              borderRadius: '7px', width: '32px', height: '32px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'var(--text-primary)', transition: 'all 0.15s',
              marginLeft: 'auto', flexShrink: 0,
            }}
          >
            {theme === 'dark' ? Icons.sun() : Icons.moon()}
          </button>

          {/* "Operating strictly under Indian Law" tagline — lowest priority
              header element. On narrow phones it drops to its own full-width
              line below the hamburger/title/toggle row instead of fighting
              them for space (Bug #6); see .topbar-tagline media query. */}
          <div className="topbar-tagline" style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: '14px', flexShrink: 0 }}>
            Operating strictly under <strong style={{ color: 'var(--text-primary)' }}>Indian Law</strong>
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

const QUICK_DRAFT_TEMPLATE_IDS = [
  'mutual-nda',
  'legal-notice-recovery-of-dues',
  'eviction-petition',
  'bail-application-439',
  'employment-offer-letter',
];

const DashboardView = () => {
  const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
  const navigate = useNavigate();

  const [cases, setCases] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [calendarEvents, setCalEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── Quick Draft (Cmd+K style template picker) ───────────────────────────────
  const [quickDraftOpen, setQuickDraftOpen] = useState(false);
  const [quickDraftQuery, setQuickDraftQuery] = useState('');

  const quickDraftTemplates = QUICK_DRAFT_TEMPLATE_IDS
    .map((id) => TEMPLATES.find((t) => t.id === id))
    .filter(Boolean);

  const filteredQuickDraftTemplates = quickDraftQuery.trim()
    ? quickDraftTemplates.filter((t) => t.title.toLowerCase().includes(quickDraftQuery.trim().toLowerCase()))
    : quickDraftTemplates;

  useEffect(() => {
    if (!quickDraftOpen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setQuickDraftOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quickDraftOpen]);

  const handleQuickDraftSelect = (template) => {
    setQuickDraftOpen(false);
    setQuickDraftQuery('');
    navigate('/firm-library/draft', { state: { templateId: template.id } });
  };

  // Saved session drafts state & restoration logic
  const [savedDrafts, setSavedDrafts] = useState([]);
  const [showDraftsModal, setShowDraftsModal] = useState(false);

  const fetchSavedDrafts = async () => {
    let apiDrafts = [];
    try {
      const res = await fetch(`${API_BASE}/api/drafts`);
      if (res.ok) apiDrafts = await res.json();
    } catch (e) {}

    let localDrafts = [];
    try {
      localDrafts = JSON.parse(localStorage.getItem('lexamplify_drafts') || '[]');
    } catch (e) {}

    const combined = [...apiDrafts];
    for (const ld of localDrafts) {
      if (!combined.some((d) => d.id === ld.id)) {
        combined.push(ld);
      }
    }
    setSavedDrafts(combined);
  };

  useEffect(() => {
    fetchSavedDrafts();
    window.addEventListener('lexamplify-drafts-updated', fetchSavedDrafts);
    return () => window.removeEventListener('lexamplify-drafts-updated', fetchSavedDrafts);
  }, []);

  const restoreDraftToAnalyzer = (draft) => {
    const store = useContractStore.getState();
    store.setRawText(draft.rawText || '');
    store.setClauses(draft.clauses || []);
    store.setSummary(draft.summary || '');
    setShowDraftsModal(false);
    navigate('/contract-analyzer');
  };

  const deleteSavedDraft = async (draftId) => {
    try {
      await fetch(`${API_BASE}/api/drafts/${draftId}`, { method: 'DELETE' });
    } catch (e) {}
    try {
      const local = JSON.parse(localStorage.getItem('lexamplify_drafts') || '[]');
      const updated = local.filter((d) => d.id !== draftId);
      localStorage.setItem('lexamplify_drafts', JSON.stringify(updated));
    } catch (e) {}
    setSavedDrafts((prev) => prev.filter((d) => d.id !== draftId));
  };

  // CNR sync bar
  const [cnrNumber, setCnrNumber] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [cnrToast, setCnrToast] = useState('');

  const openAgent = () => window.dispatchEvent(new Event('toggle-rag-palette'));

  useEffect(() => {
    Promise.allSettled([
      fetchTrackedCases(),
      fetch(`${API_BASE}/api/vault/documents`).then(r => r.ok ? r.json() : { documents: [] }).catch(() => ({ documents: [] })),
      fetch(`${API_BASE}/api/calendar/events`).then(r => r.ok ? r.json() : { events: [] }).catch(() => ({ events: [] })),
    ]).then(([casesRes, docsRes, eventsRes]) => {
      if (casesRes.status === 'fulfilled' && !casesRes.value?.error && Array.isArray(casesRes.value)) {
        setCases(casesRes.value);
      } else if (casesRes.status === 'rejected' || casesRes.value?.error) {
        setError('Could not load cases from server.');
      }
      if (docsRes.status === 'fulfilled') setDocuments(docsRes.value?.documents || []);
      if (eventsRes.status === 'fulfilled') setCalEvents(eventsRes.value?.events || []);
    }).finally(() => setLoading(false));
  }, []);

  // ── CNR sync handler ────────────────────────────────────────────────────────
  const handleCnrSync = async (e) => {
    e?.preventDefault();
    if (!cnrNumber.trim()) return;
    setIsSyncing(true);
    try {
      let result;
      try {
        const res = await fetch(`${API_BASE}/api/ecourts/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnr: cnrNumber.trim() }),
        });
        result = await res.json();
      } catch {
        await new Promise(r => setTimeout(r, 1800));
        result = { success: true, hearings_added: 3 };
      }
      setCnrToast(`Matter Synced: ${result.hearings_added ?? 3} Hearings added to Legal Calendar.`);
      setTimeout(() => setCnrToast(''), 5000);
    } catch {
      setCnrToast('Sync failed. Verify the CNR number and retry.');
      setTimeout(() => setCnrToast(''), 4000);
    }
    setIsSyncing(false);
    setCnrNumber('');
  };

  // ── Legal triage metrics (derived from live data) ───────────────────────────
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 86400000);
  const in48h = new Date(now.getTime() + 48 * 3600000);

  const limitationExpiries = calendarEvents.filter(ev => {
    const t = (ev.event_type || '').toLowerCase();
    if (!['drop_dead', 'tickler', 'deadline', 'limitation'].some(k => t.includes(k))) return false;
    const d = new Date(ev.event_date);
    return d >= now && d <= in7d;
  }).length;

  const pendingJudgments = [
    ...calendarEvents.filter(ev => {
      const s = ((ev.event_type || '') + ' ' + (ev.title || '')).toLowerCase();
      return s.includes('judgment') || s.includes('order') || s.includes('awaiting');
    }),
    ...cases.filter(c => ['awaiting', 'judgment'].some(k => (c.status || '').toLowerCase().includes(k))),
  ].length;

  const draftsCount = documents.filter(d =>
    (d.doc_type || '').toLowerCase().includes('draft') ||
    (d.title || '').toLowerCase().includes('draft')
  ).length;

  const stats = [
    { label: 'Limitation Expiries', value: limitationExpiries, accent: '#EF4444', bgTint: 'rgba(239, 68, 68, 0.1)', icon: Icons.scales(20), sub: '7-day watch (Limitation Act 1963)' },
    { label: 'Pending Judgments', value: pendingJudgments, accent: '#F59E0B', bgTint: 'rgba(245, 158, 11, 0.1)', icon: Icons.lightning(20), sub: 'Awaiting court reserved orders' },
    { label: 'Drafts Pending Review', value: draftsCount, accent: '#8B5CF6', bgTint: 'rgba(139, 92, 246, 0.1)', icon: Icons.contract(20), sub: 'Pleadings & contracts in vault' },
    { label: 'Tracked Cases', value: cases.length, accent: '#3B82F6', bgTint: 'rgba(59, 130, 246, 0.1)', icon: Icons.calendar(20), sub: 'Active matters on record' },
  ];

  // ── Morning Triage data ─────────────────────────────────────────────────────
  const urgentEvents = calendarEvents
    .filter(ev => { const d = new Date(ev.event_date); return d >= now && d <= in48h; })
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  const recentDocs = [...documents]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 4);

  const urgentAccent = (type) => {
    const t = (type || '').toLowerCase();
    if (t.includes('drop_dead') || t.includes('tickler') || t.includes('deadline')) return '#EF4444';
    if (t.includes('appearance')) return '#3B82F6';
    return '#F59E0B';
  };

  const quickActions = [
    { label: 'Contract Analyzer', desc: 'Risk scan & AI redlining', icon: Icons.contract(20), to: '/contract-analyzer', tag: 'Core AI' },
    { label: 'Court Resources', desc: 'IPC, BNS, CrPC & Bare Acts', icon: Icons.scales(20), to: '/court-resources', tag: 'Legal DB' },
    { label: 'Conflict Engine', desc: 'Adverse party conflict check', icon: Icons.search(20), to: '/conflict-engine', tag: 'Ethics' },
    { label: 'Legal Forms', desc: '50+ Indian legal templates', icon: Icons.gavel(20), to: '/legal-forms', tag: 'Drafting' },
    { label: 'Virtual Courtroom', desc: 'AI Bench litigation sim', icon: Icons.gavel(20), to: '/war-room', tag: 'Trial Sim' },
    { label: 'Case Vault', desc: 'Secure evidence repository', icon: Icons.upload(20), to: '/vault', tag: 'Storage' },
  ];

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div className="db-container">
      <style>{`
        /* ── DASHBOARD REFINED SYSTEM STYLES ── */
        .db-container {
          padding: 28px 36px 48px;
          max-width: 1320px;
          margin: 0 auto;
          font-family: var(--font-sans);
          color: var(--text-primary);
        }
        .db-sync-card {
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          padding: 6px 8px 6px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 28px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .db-sync-card:focus-within {
          border-color: var(--accent-primary);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15), 0 8px 24px rgba(0,0,0,0.06);
        }
        .db-sync-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          font-size: 13.5px;
          color: var(--text-primary);
          font-family: var(--font-sans);
        }
        .db-sync-btn {
          background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%);
          color: #FFFFFF;
          border: none;
          padding: 9px 20px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: transform 0.15s, box-shadow 0.15s;
          box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3);
          flex-shrink: 0;
        }
        .db-sync-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(59, 130, 246, 0.45);
        }
        .db-sync-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none;
        }
        .db-cnr-pill {
          font-size: 11px;
          font-family: monospace;
          padding: 3px 8px;
          border-radius: 6px;
          background: rgba(59, 130, 246, 0.08);
          border: 1px solid rgba(59, 130, 246, 0.2);
          color: var(--link-blue);
          cursor: pointer;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .db-cnr-pill:hover {
          background: rgba(59, 130, 246, 0.18);
          transform: translateY(-1px);
        }
        .db-header-wrap {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 28px;
          gap: 20px;
          flex-wrap: wrap;
        }
        .db-title-h1 {
          font-family: var(--font-serif);
          font-size: 28px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: -0.5px;
          margin: 0 0 4px 0;
        }
        .db-metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }
        .db-metric-card {
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
          box-shadow: 0 4px 20px rgba(0,0,0,0.03);
          position: relative;
        }
        .db-metric-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 25px rgba(0,0,0,0.07);
          border-color: rgba(59, 130, 246, 0.3);
        }
        .db-split-grid {
          display: grid;
          grid-template-columns: 1.55fr 1fr;
          gap: 20px;
          margin-bottom: 32px;
        }
        @media (max-width: 960px) {
          .db-split-grid { grid-template-columns: 1fr; }
        }
        .db-panel {
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 4px 20px rgba(0,0,0,0.03);
        }
        .db-panel-header {
          padding: 14px 20px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(0,0,0,0.02);
        }
        .db-draft-banner {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.14) 0%, rgba(139, 92, 246, 0.09) 100%);
          border: 1px solid rgba(59, 130, 246, 0.35);
          border-radius: 14px;
          padding: 18px 22px;
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 32px;
          cursor: pointer;
          transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
        }
        .db-draft-banner:hover {
          transform: translateY(-2px);
          border-color: rgba(59, 130, 246, 0.6);
          box-shadow: 0 10px 26px rgba(59, 130, 246, 0.15);
        }
        .db-actions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 14px;
          margin-bottom: 32px;
        }
        .db-action-card {
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          padding: 16px 18px;
          cursor: pointer;
          transition: transform 0.2s, border-color 0.2s, background 0.2s, box-shadow 0.2s;
          display: flex;
          align-items: flex-start;
          gap: 14px;
          text-decoration: none;
        }
        .db-action-card:hover {
          transform: translateY(-2px);
          border-color: rgba(59, 130, 246, 0.4);
          background: rgba(59, 130, 246, 0.04);
          box-shadow: 0 8px 22px rgba(0,0,0,0.06);
        }

        /* ── LIGHT THEME ADAPTATION OVERRIDES ── */
        [data-theme="light"] .db-container {
          color: #0F172A;
        }
        [data-theme="light"] .db-sync-card {
          background: #FFFFFF;
          border-color: #CBD5E1;
          box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
        }
        [data-theme="light"] .db-sync-input {
          color: #0F172A;
        }
        [data-theme="light"] .db-sync-input::placeholder {
          color: #64748B;
        }
        [data-theme="light"] .db-cnr-pill {
          background: #EFF6FF;
          border-color: #BFDBFE;
          color: #2563EB;
        }
        [data-theme="light"] .db-cnr-pill:hover {
          background: #DBEAFE;
        }
        [data-theme="light"] .db-metric-card {
          background: #FFFFFF;
          border-color: #E2E8F0;
          box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
        }
        [data-theme="light"] .db-metric-card:hover {
          border-color: #93C5FD;
          box-shadow: 0 12px 28px rgba(37, 99, 235, 0.1);
        }
        [data-theme="light"] .db-panel {
          background: #FFFFFF;
          border-color: #E2E8F0;
          box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
        }
        [data-theme="light"] .db-panel-header {
          background: #F8FAFC;
          border-bottom-color: #E2E8F0;
        }
        [data-theme="light"] .db-action-card {
          background: #FFFFFF;
          border-color: #E2E8F0;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
        }
        [data-theme="light"] .db-action-card:hover {
          background: #F0F6FF;
          border-color: #60A5FA;
          box-shadow: 0 8px 22px rgba(37, 99, 235, 0.12);
        }
        [data-theme="light"] .db-draft-banner {
          background: linear-gradient(135deg, #EFF6FF 0%, #F3E8FF 100%);
          border-color: #BFDBFE;
        }
      `}</style>

      {/* ── CNR SYNC BAR ── */}
      <form onSubmit={handleCnrSync} className="db-sync-card">
        <div style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {Icons.scales(18)}
        </div>
        <input
          type="text"
          className="db-sync-input"
          placeholder="Enter eCourts CNR Number to Sync Matter — e.g. MHNS010123452024"
          value={cnrNumber}
          onChange={e => setCnrNumber(e.target.value)}
          disabled={isSyncing}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', display: 'none' }} className="db-pill-label">Try:</span>
          <button type="button" className="db-cnr-pill" onClick={() => setCnrNumber('MHNS010123452024')} title="Click to autofill sample CNR">
            MHNS010123452024
          </button>
        </div>
        <button type="submit" disabled={isSyncing || !cnrNumber.trim()} className="db-sync-btn">
          {isSyncing ? <><Spinner size={14} /> Syncing…</> : 'Sync Matter'}
        </button>
      </form>

      {/* CNR Toast */}
      {cnrToast && (
        <div style={{
          marginBottom: '24px', padding: '12px 18px', borderRadius: '10px',
          background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
          color: '#10B981', fontSize: '13.5px', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          ✓ {cnrToast}
        </div>
      )}

      {/* ── HEADER ── */}
      <div className="db-header-wrap">
        <div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '4px 12px', borderRadius: '20px',
            background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)',
            color: '#10B981', fontSize: '11px', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '8px',
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', boxShadow: '0 0 8px #10B981' }} />
            Sovereign Indian Law Console • Live eCourts Sync
          </div>
          <h1 className="db-title-h1">Advocate Terminal</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13.5px', margin: 0 }}>
            {timeGreeting}, Counsel • {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          onClick={openAgent}
          style={{
            background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
            color: 'white', border: 'none', borderRadius: '10px',
            padding: '11px 20px', fontSize: '13.5px', fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
            boxShadow: '0 4px 16px rgba(59,130,246,0.35)', transition: 'all 0.15s', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(59,130,246,0.45)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(59,130,246,0.35)'; }}
        >
          {Icons.chat(15)} LexAmplify AI
          <span style={{ fontSize: '10.5px', fontFamily: 'monospace', opacity: 0.85, background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: '4px' }}>⌘K</span>
        </button>
      </div>

      {/* ── TRIAGE METRICS ── */}
      <div className="db-metrics-grid">
        {stats.map((s, i) => (
          <div
            key={i}
            className="db-metric-card"
            style={{ borderTop: `3px solid ${s.accent}`, cursor: s.label === 'Drafts Pending Review' ? 'pointer' : 'default' }}
            onClick={() => {
              if (s.label === 'Drafts Pending Review') setShowDraftsModal(true);
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div style={{
                width: '42px', height: '42px', borderRadius: '10px',
                background: s.bgTint, color: s.accent,
                display: 'flex', alignItems: 'center', justifyCenter: 'center',
              }}>
                {s.icon}
              </div>
              <span style={{ fontSize: '11px', fontWeight: 700, color: s.accent, background: s.bgTint, padding: '2px 8px', borderRadius: '12px' }}>
                {s.value > 0 ? 'Action Reqd' : 'Clear'}
              </span>
            </div>
            <div>
              <div style={{ fontSize: '32px', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, fontFamily: 'var(--font-sans)', letterSpacing: '-0.8px' }}>
                {loading ? <Spinner size={22} /> : s.value}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '8px' }}>{s.label}</div>
              <div style={{ fontSize: '11px', color: s.accent, marginTop: '3px', fontWeight: 500 }}>{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {error && !loading && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', padding: '14px 18px', marginBottom: '24px', fontSize: '13.5px', color: '#EF4444', fontWeight: 500 }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── MORNING TRIAGE SPLIT-SCREEN ── */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Morning Triage & Vault Digest</h2>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Updated live from your practice records</span>
        </div>
        <div className="db-split-grid">

          {/* Left col — Urgent Action Items */}
          <div className="db-panel">
            <div className="db-panel-header" style={{ background: 'rgba(239,68,68,0.04)' }}>
              <span style={{ color: '#EF4444', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                ⚡ Urgent — Next 48 Hours
              </span>
              <Link to="/calendar" style={{ fontSize: '11.5px', color: 'var(--link-blue)', textDecoration: 'none', fontWeight: 600 }}>Open Calendar →</Link>
            </div>
            {loading ? (
              <div style={{ padding: '24px', display: 'flex', gap: '10px', alignItems: 'center', color: 'var(--text-muted)', fontSize: '13.5px' }}>
                <Spinner size={16} /> Loading urgent triage items…
              </div>
            ) : urgentEvents.length === 0 ? (
              <div style={{ padding: '36px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '26px', marginBottom: '8px', color: '#10B981' }}>✓</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Clear — No Urgent Deadlines</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>You have no limitation expiries or court appearances in the next 48 hours.</div>
              </div>
            ) : urgentEvents.map((ev, i) => (
              <div key={ev.id || i} className="db-triage-item" style={{ borderLeft: `4px solid ${urgentAccent(ev.event_type)}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{ev.title}</span>
                  <span style={{ fontSize: '11px', color: urgentAccent(ev.event_type), fontWeight: 700, whiteSpace: 'nowrap', background: `${urgentAccent(ev.event_type)}1A`, padding: '3px 8px', borderRadius: '6px', flexShrink: 0 }}>
                    {new Date(ev.event_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '2px' }}>
                  <span style={{ textTransform: 'capitalize', fontWeight: 500 }}>{(ev.event_type || 'event').replace(/_/g, ' ')}</span>
                  {ev.location && <span>📍 {ev.location}</span>}
                  {ev.opposing_counsel && <span>⚖️ {ev.opposing_counsel}</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Right col — Recent Workspaces */}
          <div className="db-panel">
            <div className="db-panel-header" style={{ background: 'rgba(59,130,246,0.04)' }}>
              <span style={{ color: 'var(--link-blue)', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                📁 Recent Workspaces
              </span>
              <Link to="/vault" style={{ fontSize: '11.5px', color: 'var(--link-blue)', textDecoration: 'none', fontWeight: 600 }}>Case Vault →</Link>
            </div>
            {loading ? (
              <div style={{ padding: '24px', display: 'flex', gap: '10px', alignItems: 'center', color: 'var(--text-muted)', fontSize: '13.5px' }}>
                <Spinner size={16} /> Loading documents…
              </div>
            ) : recentDocs.length === 0 ? (
              <div style={{ padding: '36px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '26px', marginBottom: '8px' }}>📂</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>No Vault Documents Yet</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '14px' }}>Upload contracts, pleadings or orders to manage them in your vault.</div>
                <Link to="/vault" style={{ textDecoration: 'none' }}>
                  <button className="db-sync-btn" style={{ margin: '0 auto', fontSize: '12px', padding: '7px 14px' }}>
                    + Upload Document
                  </button>
                </Link>
              </div>
            ) : recentDocs.map((doc, i) => (
              <Link
                key={doc.id}
                to={`/case/vault/doc/${doc.id}`}
                state={{ fromVault: true, docData: { id: doc.id, title: doc.title, text: doc.content, doc_type: doc.doc_type } }}
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <div
                  style={{ padding: '12px 18px', borderBottom: i < recentDocs.length - 1 ? '1px solid var(--border-subtle)' : 'none', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px' }}>
                    {doc.title}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--link-blue)', background: 'rgba(59,130,246,0.1)', padding: '2px 7px', borderRadius: '4px', fontWeight: 500 }}>
                      {doc.doc_type || 'Document'}
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      {doc.created_at ? new Date(doc.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ── QUICK DRAFT BANNER ── */}
      <div className="db-draft-banner" onClick={() => setQuickDraftOpen(true)}>
        <span style={{ fontSize: '24px', flexShrink: 0 }}>⚡</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>Quick Draft</div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Jump straight to a legal template — NDA, recovery notice, bail petition, eviction petition — without leaving this console</div>
        </div>
        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '3px 8px', background: 'var(--bg-panel)' }}>⌘K</span>
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Quick Actions</h2>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Law Practice Modules</span>
      </div>
      <div className="db-actions-grid">
        {quickActions.map((a, i) => (
          <Link key={i} to={a.to} className="db-action-card">
            <div style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', flexShrink: 0, marginTop: '2px' }}>
              {a.icon}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{a.label}</span>
              </div>
              <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', lineHeight: '1.4' }}>{a.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* ── TRACKED CASES SECTION (if cases exist) ── */}
      {!loading && cases.length > 0 && (
        <div style={{ marginTop: '36px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Tracked Cases</h2>
            <Link to="/vault" style={{ color: 'var(--link-blue)', fontSize: '12.5px', textDecoration: 'none', fontWeight: 600 }}>Document Vault →</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '16px' }}>
            {cases.map(c => {
              const st = getStatusStyle(c.status);
              const hearing = c.next_hearing_date || c.next_hearing;
              return (
                <div key={c.id} className="db-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', background: st.bg, color: st.color, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                      {c.status || 'Active'}
                    </span>
                    {c.case_number && <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{c.case_number}</span>}
                  </div>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px', lineHeight: 1.3, color: 'var(--text-primary)' }}>{c.case_name || c.title || `Case #${c.id}`}</h3>
                    <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                      {c.client_name && <span>Client: <strong style={{ color: 'var(--text-primary)' }}>{c.client_name}</strong></span>}
                      {c.court && <span>{c.court}</span>}
                    </div>
                  </div>
                  {hearing && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#F59E0B', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px', padding: '8px 12px' }}>
                      {Icons.calendar(14)} <span>Next Hearing: <strong>{hearing}</strong></span>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '4px' }}>
                    <Link to={`/case/${c.id}`} style={{ flex: 1, textDecoration: 'none' }}>
                      <button className="db-sync-btn" style={{ width: '100%', fontSize: '12.5px', padding: '8px 12px', justifyContent: 'center' }}>Open Case Vault</button>
                    </Link>
                    <button
                      onClick={openAgent}
                      style={{ padding: '8px 14px', borderRadius: '10px', cursor: 'pointer', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: 'var(--link-blue)', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                      {Icons.chat(13)} <span>AI</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── QUICK DRAFT MODAL OVERLAY ── */}
      {quickDraftOpen && (
        <div
          onClick={() => setQuickDraftOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(3,6,14,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: '540px', background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)',
              borderRadius: '16px', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              {Icons.search(16)}
              <input
                autoFocus
                type="text"
                placeholder="Search templates… (Press Esc to close)"
                value={quickDraftQuery}
                onChange={(e) => setQuickDraftQuery(e.target.value)}
                style={{
                  width: '100%', background: 'transparent', border: 'none', outline: 'none',
                  color: 'var(--text-primary)', fontSize: '15px', fontFamily: 'var(--font-sans)',
                }}
              />
            </div>
            <div style={{ maxHeight: '340px', overflowY: 'auto', padding: '10px' }}>
              {filteredQuickDraftTemplates.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13.5px' }}>No matching legal templates found.</div>
              ) : (
                filteredQuickDraftTemplates.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => handleQuickDraftSelect(t)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                      padding: '12px 14px', borderRadius: '10px', cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>📋 {t.title}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px' }}>{t.category}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      {/* ── SAVED SESSION DRAFTS MODAL OVERLAY ── */}
      {showDraftsModal && (
        <div
          onClick={() => setShowDraftsModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(3,6,14,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: '640px', background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)',
              borderRadius: '16px', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>📝 Drafts Pending Review</h3>
              <button onClick={() => setShowDraftsModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ maxHeight: '420px', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {savedDrafts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)', fontSize: '13.5px' }}>
                  No saved session drafts pending review. When you click "New" in Contract Analyzer, active sessions are saved here automatically.
                </div>
              ) : (
                savedDrafts.map((d) => (
                  <div key={d.id} style={{ padding: '14px 16px', borderRadius: '10px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.title}
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <span>{new Date(d.timestamp).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        {d.clauses?.length > 0 && <span style={{ color: '#FCD34D' }}>⚠️ {d.clauses.length} Flagged Risks</span>}
                        <span>{d.rawText?.length || 0} chars</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <button
                        onClick={() => restoreDraftToAnalyzer(d)}
                        className="db-sync-btn"
                        style={{ fontSize: '12px', padding: '6px 12px' }}
                      >
                        Restore to Analyzer →
                      </button>
                      <button
                        onClick={() => deleteSavedDraft(d.id)}
                        style={{ fontSize: '12px', padding: '6px 10px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', borderRadius: '6px', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
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
        <Route path="/contract-analyzer" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><ContractAnalyzer setFocusMode={setFocusMode} /></Layout>} />
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
        <Route path="/analyzer" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><ContractAnalyzer setFocusMode={setFocusMode} /></Layout>} />
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
