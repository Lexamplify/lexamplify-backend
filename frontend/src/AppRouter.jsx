import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useParams, useLocation } from 'react-router-dom';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { fetchTrackedCases, fetchDocuments } from './services/api';
import CommandPalette from './components/CommandPalette';
import CaseVault from './components/CaseVault';
import DocumentViewer from './components/DocumentViewer';
import CourtResources from './components/CourtResources';
import ContractAnalyzer from './components/ContractAnalyzer';
import ConflictEngine from './components/ConflictEngine';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import CalendarView from './components/CalendarView';
import VaultView from './components/VaultView';
import CaseWorkspace from './components/CaseWorkspace';
import WarRoomView from './components/WarRoomView';

// ── STATUS BADGE STYLES (mapped from real API status values) ──────────────────
const STATUS_STYLES = {
  'Active':            { bg: 'rgba(16,185,129,0.12)',  color: '#10B981', dot: '#10B981' },
  'Active Sprint':     { bg: 'rgba(16,185,129,0.12)',  color: '#10B981', dot: '#10B981' },
  'Hearing scheduled': { bg: 'rgba(245,158,11,0.12)',  color: '#F59E0B', dot: '#F59E0B' },
  'Hearing Scheduled': { bg: 'rgba(245,158,11,0.12)',  color: '#F59E0B', dot: '#F59E0B' },
  'Pending Filing':    { bg: 'rgba(239,68,68,0.12)',   color: '#EF4444', dot: '#EF4444' },
  'Disposed':          { bg: 'rgba(107,114,128,0.12)', color: '#9CA3AF', dot: '#6B7280' },
};
const getStatusStyle = (status) =>
  STATUS_STYLES[status] || { bg: 'rgba(107,114,128,0.12)', color: '#9CA3AF', dot: '#6B7280' };

// ── SVG ICON SET ───────────────────────────────────────────────────────────────
const Icons = {
  dashboard: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  contract: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>
    </svg>
  ),
  scales: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/>
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/>
      <path d="M7 21h10M12 3v18M3 7h2c2 0 4-1 7-1s5 1 7 1h2"/>
    </svg>
  ),
  search: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
  ),
  calendar: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  lock: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
  gavel: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m14.5 12.5-8 8a2.12 2.12 0 0 1-3-3l8-8"/><path d="m16 16 6-6"/>
      <path d="m8 8 6-6"/><path d="m9 7 8 8"/>
    </svg>
  ),
  folder: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  chat: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  logout: (w = 14) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  lightning: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  upload: (w = 16) => (
    <svg width={w} height={w} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  sun: (w = 16) => (
    <svg width={w} height={w} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  ),
  moon: (w = 16) => (
    <svg width={w} height={w} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
};

// ── SIDEBAR NAV ITEM ───────────────────────────────────────────────────────────
const NavItem = ({ to, icon, label, isActive, onClick }) => (
  <Link to={to} onClick={onClick} className={`sidebar-nav-item${isActive ? ' active' : ''}`}>
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
  if (p === '/court-resources')    items.push({ label: 'Court Resources',    url: p });
  else if (p === '/contract-analyzer') items.push({ label: 'Contract Analyzer', url: p });
  else if (p === '/conflict-engine')   items.push({ label: 'Conflict Engine',   url: p });
  else if (p === '/calendar')          items.push({ label: 'Legal Calendar',    url: p });
  else if (p === '/vault')             items.push({ label: 'Case Vault',        url: p });
  else if (p === '/war-room')          items.push({ label: 'Virtual Courtroom', url: p });
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

  // ── Sidebar case list — fetched live from the real API ──────────────────
  const [sidebarCases, setSidebarCases] = useState([]);
  useEffect(() => {
    fetchTrackedCases()
      .then(data => { if (Array.isArray(data)) setSidebarCases(data); })
      .catch(() => {});
  }, []);

  const closeSidebar = () => setIsSidebarOpen(false);
  const openAgent = () => window.dispatchEvent(new Event('toggle-rag-palette'));
  const handleSignOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('lexai_token');
  };

  const p = location.pathname;

  return (
    <div className={`app-container ${focusMode ? 'focus-mode-active' : ''}`}>
      <div className={`sidebar-overlay ${isSidebarOpen ? 'visible' : ''}`} onClick={closeSidebar} />

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside className={`sidebar ${isSidebarOpen ? 'sidebar-open' : ''}`}>

        {/* Logo */}
        <div style={{ padding: '18px 16px 16px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px', height: '34px',
              background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
              borderRadius: '9px', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(59,130,246,0.35)',
            }}>
              {Icons.scales(18)}
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: 'white', letterSpacing: '-0.2px' }}>LexAmplify</div>
              <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Enterprise Console</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          <NavItem to="/dashboard"         icon={Icons.dashboard()} label="Dashboard Home"    isActive={p === '/dashboard'}         onClick={closeSidebar} />
          <NavItem to="/contract-analyzer" icon={Icons.contract()}  label="Contract Analyzer" isActive={p === '/contract-analyzer'} onClick={closeSidebar} />
          <NavItem to="/court-resources"   icon={Icons.scales()}    label="Court Resources"   isActive={p === '/court-resources'}  onClick={closeSidebar} />
          <NavItem to="/conflict-engine"   icon={Icons.search()}    label="Conflict Engine"   isActive={p === '/conflict-engine'}  onClick={closeSidebar} />
          <NavItem to="/calendar"          icon={Icons.calendar()}  label="Legal Calendar"    isActive={p === '/calendar'}         onClick={closeSidebar} />
          <NavItem to="/vault"             icon={Icons.lock()}      label="Case Vault"        isActive={p === '/vault'}            onClick={closeSidebar} />
          <NavItem to="/war-room"          icon={Icons.gavel()}     label="Virtual Courtroom" isActive={p === '/war-room'}         onClick={closeSidebar} />

          {/* Live case listing from API */}
          {sidebarCases.length > 0 && (
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
        <div style={{ padding: '14px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
          {/* Universal Agent */}
          <button
            onClick={openAgent}
            style={{
              width: '100%', padding: '9px 12px',
              background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(37,99,235,0.08))',
              border: '1px solid rgba(59,130,246,0.22)', borderRadius: '8px',
              cursor: 'pointer', fontSize: '12.5px', fontWeight: '600',
              color: 'var(--accent-primary)',
              display: 'flex', alignItems: 'center', gap: '8px',
              transition: 'all 0.2s',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center' }}>{Icons.chat()}</span>
            <span>Universal Agent</span>
            <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.6, fontFamily: 'monospace', background: 'rgba(59,130,246,0.15)', padding: '1px 5px', borderRadius: '4px' }}>⌘K</span>
          </button>

          {/* Log Out */}
          <Link to="/" onClick={handleSignOut} style={{ textDecoration: 'none' }}>
            <button style={{
              width: '100%', padding: '8px 12px',
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border-subtle)', borderRadius: '7px',
              cursor: 'pointer', fontSize: '12.5px',
              display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.15s',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', opacity: 0.7 }}>{Icons.logout()}</span>
              Log Out
            </button>
          </Link>

          {/* Focus Mode toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <span>Focus Mode</span>
            <div
              onClick={() => setFocusMode(f => !f)}
              style={{
                width: '32px', height: '17px', borderRadius: '10px', cursor: 'pointer',
                background: focusMode ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.1)', position: 'relative', transition: 'background 0.2s',
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
        </div>
      </aside>

      {/* ── WORKSPACE ────────────────────────────────────────────────────── */}
      <div className="workspace-container">
        <header className="topbar">
          <button className="hamburger-btn" onClick={() => setIsSidebarOpen(v => !v)} aria-label="Toggle navigation">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6"  x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <Breadcrumbs />

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginLeft: 'auto' }}>
            <button
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              style={{
                background: 'transparent', border: '1px solid var(--border-subtle)',
                borderRadius: '7px', width: '32px', height: '32px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--text-primary)', transition: 'all 0.15s',
              }}
            >
              {theme === 'dark' ? Icons.sun() : Icons.moon()}
            </button>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              Operating strictly under <strong style={{ color: 'var(--text-primary)' }}>Indian Law</strong>
            </div>
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

// ── DASHBOARD VIEW — fully dynamic, zero hardcoded data ───────────────────────
const DashboardView = () => {
  const [cases, setCases]       = useState([]);
  const [docCount, setDocCount] = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const openAgent = () => window.dispatchEvent(new Event('toggle-rag-palette'));

  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';

    Promise.allSettled([
      fetchTrackedCases(),
      fetch(`${apiBase}/api/vault/documents`).then(r => r.ok ? r.json() : { documents: [] }).catch(() => ({ documents: [] })),
    ]).then(([casesRes, docsRes]) => {
      if (casesRes.status === 'fulfilled' && !casesRes.value?.error && Array.isArray(casesRes.value)) {
        setCases(casesRes.value);
      } else if (casesRes.status === 'rejected' || casesRes.value?.error) {
        setError('Could not load cases from server.');
      }
      if (docsRes.status === 'fulfilled') {
        setDocCount((docsRes.value?.documents || []).length);
      }
    }).finally(() => setLoading(false));
  }, []);

  // Derived stats from real data only
  const activeCases = cases.filter(c => ['Active', 'Active Sprint'].includes(c.status)).length;
  const hearingCases = cases.filter(c => c.next_hearing_date || c.next_hearing).length;

  const stats = [
    { label: 'Tracked Cases',      value: loading ? '—' : cases.length,  accent: '#3B82F6', icon: Icons.scales(22) },
    { label: 'Documents Indexed',  value: loading ? '—' : docCount,       accent: '#10B981', icon: Icons.contract(22) },
    { label: 'Active Matters',     value: loading ? '—' : activeCases,    accent: '#F59E0B', icon: Icons.lightning(22) },
    { label: 'Upcoming Hearings',  value: loading ? '—' : hearingCases,   accent: '#8B5CF6', icon: Icons.calendar(22) },
  ];

  const quickActions = [
    { label: 'Upload Document',   desc: 'Add to case vault',     icon: Icons.upload(18),   to: '/vault' },
    { label: 'Contract Analyzer', desc: 'Risk scan & drafting',  icon: Icons.contract(18), to: '/contract-analyzer' },
    { label: 'Court Resources',   desc: 'IPC, BNS, CrPC & more',icon: Icons.scales(18),   to: '/court-resources' },
    { label: 'Legal Calendar',    desc: 'Manage hearing dates',  icon: Icons.calendar(18), to: '/calendar' },
    { label: 'Conflict Engine',   desc: 'Check matter conflicts',icon: Icons.search(18),   to: '/conflict-engine' },
    { label: 'Virtual Courtroom', desc: 'Run litigation sim',    icon: Icons.gavel(18),    to: '/war-room' },
  ];

  return (
    <div style={{ padding: '28px 32px', maxWidth: '1200px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '26px', marginBottom: '5px' }}>Advocate Terminal</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13.5px' }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <button
          onClick={openAgent}
          style={{
            background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
            color: 'white', border: 'none', borderRadius: '9px',
            padding: '10px 18px', fontSize: '13px', fontWeight: '600',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
            boxShadow: '0 4px 14px rgba(59,130,246,0.35)', transition: 'transform 0.15s, box-shadow 0.15s', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(59,130,246,0.45)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.boxShadow='0 4px 14px rgba(59,130,246,0.35)'; }}
        >
          {Icons.chat(14)}
          Universal Agent
          <span style={{ fontSize: '10px', fontFamily: 'monospace', opacity: 0.75, background: 'rgba(255,255,255,0.15)', padding: '1px 5px', borderRadius: '4px' }}>⌘K</span>
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: '14px', marginBottom: '36px' }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)',
            borderTop: `3px solid ${s.accent}`, borderRadius: '10px', padding: '18px 20px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            <div style={{ color: s.accent, display: 'flex', alignItems: 'center' }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: '30px', fontWeight: '800', color: 'white', lineHeight: 1, fontFamily: 'var(--font-sans)' }}>
                {loading ? <Spinner size={22} /> : s.value}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '5px', fontFamily: 'var(--font-sans)' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* API error banner */}
      {error && !loading && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#EF4444' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Active Matters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '700' }}>Tracked Cases</h2>
        <Link to="/vault" style={{ color: 'var(--accent-primary)', fontSize: '12.5px', textDecoration: 'none' }}>
          Document Vault →
        </Link>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '32px 0', color: 'var(--text-muted)', fontSize: '13.5px' }}>
          <Spinner /> Loading your cases…
        </div>
      ) : cases.length === 0 ? (
        <div style={{
          border: '1px dashed var(--border-subtle)', borderRadius: '12px', padding: '40px',
          textAlign: 'center', marginBottom: '36px', color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: '28px', marginBottom: '10px' }}>📋</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'white', marginBottom: '6px' }}>No Cases Yet</div>
          <div style={{ fontSize: '13px', marginBottom: '18px' }}>
            Add your first case via the Case Vault, or use eCourts CNR lookup to import one automatically.
          </div>
          <Link to="/vault">
            <button className="btn-accent" style={{ padding: '9px 20px' }}>Go to Case Vault</button>
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginBottom: '36px' }}>
          {cases.map(c => {
            const st = getStatusStyle(c.status);
            const hearing = c.next_hearing_date || c.next_hearing;
            return (
              <div key={c.id}
                style={{
                  background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)',
                  borderRadius: '12px', padding: '20px',
                  display: 'flex', flexDirection: 'column', gap: '14px',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(59,130,246,0.35)'; e.currentTarget.style.boxShadow='0 4px 20px rgba(59,130,246,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border-subtle)'; e.currentTarget.style.boxShadow='none'; }}
              >
                {/* Status badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: '700', padding: '3px 9px', borderRadius: '20px', background: st.bg, color: st.color, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: st.dot, flexShrink: 0 }} />
                    {c.status || 'Unknown'}
                  </span>
                  {c.case_number && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {c.case_number}
                    </span>
                  )}
                </div>

                {/* Case name + client */}
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '5px', lineHeight: 1.3 }}>
                    {c.case_name || c.title || `Case #${c.id}`}
                  </h3>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                    {c.client_name && (
                      <span>Client: <strong style={{ color: 'var(--text-primary)' }}>{c.client_name}</strong></span>
                    )}
                    {c.court && (
                      <span>{c.court}</span>
                    )}
                  </div>
                </div>

                {/* Next hearing (only shown if real data exists) */}
                {hearing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#F59E0B', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: '6px', padding: '6px 10px' }}>
                    {Icons.calendar(12)}
                    <span>Next Hearing: <strong>{hearing}</strong></span>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                  <Link to={`/case/${c.id}`} style={{ flex: 1, textDecoration: 'none' }}>
                    <button className="btn-accent" style={{ width: '100%', fontSize: '12.5px', padding: '8px 12px', borderRadius: '7px' }}>
                      Open Case Vault
                    </button>
                  </Link>
                  <button
                    onClick={openAgent}
                    title="Open Universal Agent for this case"
                    style={{
                      padding: '8px 12px', borderRadius: '7px', cursor: 'pointer',
                      background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.18)',
                      color: 'var(--accent-primary)', fontSize: '12px', fontWeight: '500',
                      display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(59,130,246,0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background='rgba(59,130,246,0.06)'}
                  >
                    {Icons.chat()}
                    <span>AI</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Actions */}
      <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '14px' }}>Quick Actions</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px' }}>
        {quickActions.map((a, i) => (
          <Link key={i} to={a.to} style={{ textDecoration: 'none' }}>
            <div
              style={{
                padding: '14px 16px', background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)', borderRadius: '10px',
                cursor: 'pointer', transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: '12px',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(59,130,246,0.4)'; e.currentTarget.style.background='rgba(59,130,246,0.04)'; e.currentTarget.style.transform='translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border-subtle)'; e.currentTarget.style.background='var(--bg-panel)'; e.currentTarget.style.transform='translateY(0)'; }}
            >
              <span style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>{a.icon}</span>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: 'white', marginBottom: '2px' }}>{a.label}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{a.desc}</div>
              </div>
            </div>
          </Link>
        ))}
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
        <Route path="/"                       element={<LandingPage />} />
        <Route path="/login"                  element={<LoginPage />} />
        <Route path="/dashboard"              element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><DashboardView /></Layout>} />
        <Route path="/contract-analyzer"      element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><ContractAnalyzer setFocusMode={setFocusMode} /></Layout>} />
        <Route path="/court-resources"        element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><CourtResources /></Layout>} />
        <Route path="/conflict-engine"        element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><ConflictEngine /></Layout>} />
        <Route path="/case/:caseId"           element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><CaseVault /></Layout>} />
        <Route path="/calendar"               element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><CalendarView /></Layout>} />
        <Route path="/vault"                  element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><CaseWorkspace /></Layout>} />
        <Route path="/war-room"               element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><WarRoomView /></Layout>} />
        <Route path="/analyzer"               element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><ContractAnalyzer setFocusMode={setFocusMode} /></Layout>} />
        <Route path="/case/:caseId/doc/:docId" element={<Layout focusMode={focusMode} setFocusMode={setFocusMode}><DocumentViewer focusMode={focusMode} setFocusMode={setFocusMode} /></Layout>} />
      </Routes>
    </BrowserRouter>
  );
}

export default function AppRouter() {
  return (
    <ThemeProvider>
      <AppRouterContent />
    </ThemeProvider>
  );
}
