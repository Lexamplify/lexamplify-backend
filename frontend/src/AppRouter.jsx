import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useParams, useLocation } from 'react-router-dom';
import { ThemeProvider, useTheme } from './context/ThemeContext';
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
import WarRoomView from './components/WarRoomView';

// ── DUMMY DATA FOR DEMO FIDELITY ──────────────────────────────────────────
const DEMO_CASES = {
  "101": {
    id: "101",
    title: "Sharma vs. Tech Corp",
    client: "Rajesh Sharma",
    status: "Active Sprint",
    docs: {
      "201": {
        id: "201",
        title: "Bail_Application_Format.pdf",
        type: "pdf",
        text: "IN THE COURT OF THE METROPOLITAN MAGISTRATE AT NEW DELHI\n\nCRIMINAL MISC. BAIL APPLICATION NO. 456 OF 2026\n\nIN THE MATTER OF:\nRajesh Sharma ... APPLICANT\nVERSUS\nState of NCT Delhi ... RESPONDENT\n\nAPPLICATION UNDER SECTION 437 OF THE CODE OF CRIMINAL PROCEDURE, 1973 FOR GRANT OF BAIL\n\n1. The applicant is currently in custody since 12.05.2026 under alleged violations of Section 406/420 of the Indian Penal Code.\n2. The applicant is a law-abiding citizen and has fully cooperated with the investigation officers. There is no record of prior criminal behavior.\n3. There is no risk of the applicant tampering with evidence or absconding from justice.\n4. Hence, the applicant prays that bail be granted in the interest of natural justice.\n\nAND FOR THIS ACT OF KINDNESS THE APPLICANT SHALL AS IN DUTY BOUND EVER PRAY."
      },
      "202": {
        id: "202",
        title: "Master_Service_Agreement.docx",
        type: "docx",
        text: "MASTER SOFTWARE DEVELOPMENT & SERVICE AGREEMENT\n\nThis Agreement is entered into on 14th April 2026 by and between:\nTech Corp India Private Limited (Client)\n-AND-\nLexAmplify Software Solutions (Service Provider)\n\n1. DEFINITIONS AND KEY TERMS:\n1.1 'Deliverables' means all source code, software architectures, database schemas, and documentation synthesized under this sprint.\n1.2 'IP Rights' means all copyrights, patent filings, and proprietary trade secrets.\n\n2. DURATION & SUSPENSION:\nThis agreement remains in effect for a period of five (5) years. The Client reserves the absolute right to suspend all payments in its sole discretion without any prior notice to the Service Provider."
      }
    }
  },
  "102": {
    id: "102",
    title: "State of Maharashtra vs. K. Patel",
    client: "Karan Patel",
    status: "Hearing scheduled",
    docs: {
      "203": {
        id: "203",
        title: "FIR_Report_No_88.pdf",
        type: "pdf",
        text: "FIRST INFORMATION REPORT (FIR) - UNDER SECTION 154 CrPC\n\n1. District: Mumbai Suburban\n2. Police Station: Bandra West\n3. FIR No: 0088 / 2026\n4. Date of Occurrence: 18.05.2026\n\n5. Details of Offence:\nAccused Karan Patel allegedly entered the complainant's premises and caused damage to proprietary physical assets, violating Section 448 (House-trespass) and Section 379 (Theft) of the Indian Penal Code."
      }
    }
  }
};

// ── BREADCRUMBS COMPONENT (WITH DYNAMIC ELLIPSIS COLLAPSE) ─────────────
const Breadcrumbs = () => {
  const params = useParams();
  const location = useLocation();
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  React.useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isSmallScreen = windowWidth < 768;

  const caseTitle = params.caseId ? (DEMO_CASES[params.caseId]?.title || `Case #${params.caseId}`) : "";
  const docTitle = (params.caseId && params.docId) ? (DEMO_CASES[params.caseId]?.docs[params.docId]?.title || `Doc #${params.docId}`) : "";

  const items = [{ label: "Dashboard", url: "/dashboard" }];
  if (location.pathname === '/court-resources') {
    items.push({ label: "Court Resources", url: "/court-resources" });
  } else if (location.pathname === '/contract-analyzer') {
    items.push({ label: "Contract Analyzer", url: "/contract-analyzer" });
  } else if (location.pathname === '/conflict-engine') {
    items.push({ label: "Conflict Engine", url: "/conflict-engine" });
  } else if (location.pathname === '/calendar') {
    items.push({ label: "Legal Calendar", url: "/calendar" });
  } else if (location.pathname === '/vault') {
    items.push({ label: "Case Vault", url: "/vault" });
  } else {
    if (params.caseId) {
      items.push({ label: caseTitle, url: `/case/${params.caseId}` });
    }
    if (params.docId) {
      items.push({ label: docTitle, url: `/case/${params.caseId}/doc/${params.docId}` });
    }
  }

  if (isSmallScreen && items.length > 2) {
    return (
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--text-muted)' }}>
        <Link to={items[0].url} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{items[0].label}</Link>
        <span style={{ margin: '0 8px' }}>/</span>
        <span title={items[1].label} style={{ cursor: 'pointer' }}>...</span>
        <span style={{ margin: '0 8px' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{items[items.length - 1].label}</span>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--text-muted)' }}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={item.url}>
            {index > 0 && <span style={{ margin: '0 8px' }}>/</span>}
            {isLast ? (
              <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>{item.label}</span>
            ) : (
              <Link to={item.url} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{item.label}</Link>
            )}
          </span>
        );
      })}
    </div>
  );
};

// ── LAYOUT SHELL ──────────────────────────────────────────────────────────
const Layout = ({ children, focusMode, setFocusMode }) => {
  const params = useParams();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  // Mobile sidebar drawer state — has no visual effect on desktop (CSS controls that)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const closeSidebar = () => setIsSidebarOpen(false);

  const handleOpenSearch = () => {
    window.dispatchEvent(new Event('toggle-rag-palette'));
  };

  const handleSignOut = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('lexai_token');
  };

  return (
    <div className={`app-container ${focusMode ? 'focus-mode-active' : ''}`}>

      {/* Mobile overlay — sits behind the open sidebar, closes it on tap */}
      <div
        className={`sidebar-overlay ${isSidebarOpen ? 'visible' : ''}`}
        onClick={closeSidebar}
      />

      {/* Sidebar — off-canvas drawer on mobile, fixed panel on desktop */}
      <aside className={`sidebar ${isSidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-logo" style={{ padding: '20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 style={{ fontSize: '20px', letterSpacing: '0.5px', color: 'var(--text-primary)' }}>LexAmplify</h2>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Enterprise Console</span>
        </div>

        <nav className="sidebar-nav" style={{ flex: 1, padding: '20px 0' }}>
          <Link
            to="/dashboard"
            onClick={closeSidebar}
            style={{ display: 'block', padding: '12px 24px', color: location.pathname === '/dashboard' ? 'var(--accent-primary)' : 'var(--text-primary)', textDecoration: 'none', fontSize: '14px' }}
          >
            📊 Dashboard Home
          </Link>

          <Link
            to="/contract-analyzer"
            onClick={closeSidebar}
            style={{ display: 'block', padding: '12px 24px', color: location.pathname === '/contract-analyzer' ? 'var(--accent-primary)' : 'var(--text-primary)', textDecoration: 'none', fontSize: '14px' }}
          >
            📄 Contract Analyzer
          </Link>

          <Link
            to="/court-resources"
            onClick={closeSidebar}
            style={{ display: 'block', padding: '12px 24px', color: location.pathname === '/court-resources' ? 'var(--accent-primary)' : 'var(--text-primary)', textDecoration: 'none', fontSize: '14px' }}
          >
            ⚖️ Court Resources
          </Link>

          <Link
            to="/conflict-engine"
            onClick={closeSidebar}
            style={{ display: 'block', padding: '12px 24px', color: location.pathname === '/conflict-engine' ? 'var(--accent-primary)' : 'var(--text-primary)', textDecoration: 'none', fontSize: '14px' }}
          >
            🔍 Conflict Engine
          </Link>

          <Link
            to="/calendar"
            onClick={closeSidebar}
            style={{ display: 'block', padding: '12px 24px', color: location.pathname === '/calendar' ? 'var(--accent-primary)' : 'var(--text-primary)', textDecoration: 'none', fontSize: '14px' }}
          >
            📅 Legal Calendar
          </Link>

          <Link
            to="/vault"
            onClick={closeSidebar}
            style={{ display: 'block', padding: '12px 24px', color: location.pathname === '/vault' ? 'var(--accent-primary)' : 'var(--text-primary)', textDecoration: 'none', fontSize: '14px' }}
          >
            🗄️ Case Vault
          </Link>

          <Link
            to="/war-room"
            onClick={closeSidebar}
            style={{ display: 'block', padding: '12px 24px', color: location.pathname === '/war-room' ? 'var(--accent-primary)' : 'var(--text-primary)', textDecoration: 'none', fontSize: '14px' }}
          >
            🏛️ Virtual Courtroom
          </Link>

          <div style={{ padding: '16px 24px 8px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.8px' }}>
            Case Vault
          </div>
          {Object.values(DEMO_CASES).map(c => (
            <Link
              key={c.id}
              to={`/case/${c.id}`}
              onClick={closeSidebar}
              style={{ display: 'block', padding: '8px 24px', color: params.caseId === c.id ? 'var(--accent-primary)' : 'var(--text-muted)', textDecoration: 'none', fontSize: '13px' }}
            >
              📁 {c.title}
            </Link>
          ))}
        </nav>

        <div style={{ padding: '20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={handleOpenSearch}
            style={{ width: '100%', padding: '8px', background: 'var(--bg-panel)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}
          >
            🔍 RAG Chat (Ctrl+K)
          </button>

          <Link to="/" onClick={handleSignOut} style={{ textDecoration: 'none' }}>
            <button style={{ width: '100%', padding: '8px', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', transition: 'color 0.2s' }}>
              🚪 Log Out
            </button>
          </Link>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Focus Mode</span>
            <input
              type="checkbox"
              checked={focusMode}
              onChange={e => setFocusMode(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <div className="workspace-container">
        <header className="topbar">
          {/* Hamburger — visible only on mobile via CSS */}
          <button
            className="hamburger-btn"
            onClick={() => setIsSidebarOpen(prev => !prev)}
            aria-label="Toggle navigation"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6"  x2="21" y2="6"  />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <Breadcrumbs />

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-primary)',
                padding: 0,
                transition: 'background-color 0.2s ease, transform 0.12s ease',
              }}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Operating strictly under <strong style={{ color: 'var(--text-primary)' }}>Indian Law</strong>
            </div>
          </div>
        </header>

        {/* Page content — keyed to pathname so it re-mounts on every route change,
            triggering the .page-enter CSS animation each time */}
        <main style={{ flex: 1, overflowY: 'auto' }}>
          <div key={location.pathname} className="page-enter">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

// ── VIEW 1: DASHBOARD HOME ────────────────────────────────────────────────
const DashboardView = () => {
  return (
    <div style={{ padding: '24px' }}>
      <h1 style={{ marginBottom: '8px', fontSize: '28px' }}>Advocate Terminal</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '14px' }}>Welcome back. Review ongoing client cases and trigger Universal RAG context analysis.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
        {Object.values(DEMO_CASES).map(c => (
          <div key={c.id} style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '20px' }}>
            <h3 style={{ marginBottom: '8px' }}>{c.title}</h3>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Client: <strong>{c.client}</strong> | Status: <strong>{c.status}</strong>
            </div>
            <Link to={`/case/${c.id}`}>
              <button className="btn-accent" style={{ fontSize: '12px', padding: '6px 12px' }}>Open Case Vault</button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── ROOT APP INITIALIZATION & ROUTER WIRING ────────────────────────────
function AppRouterContent() {
  const [focusMode, setFocusMode] = useState(false);

  return (
    <BrowserRouter>
      {/* Decoupled Flagship Command Palette component with global shortcut listeners */}
      <CommandPalette />

      <Routes>
        {/* Public Face: Landing Page */}
        <Route path="/" element={<LandingPage />} />

        {/* Public Face: Login Page */}
        <Route path="/login" element={<LoginPage />} />

        {/* Console / Advocate Terminal views */}
        <Route
          path="/dashboard"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <DashboardView />
            </Layout>
          }
        />

        <Route
          path="/contract-analyzer"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <ContractAnalyzer setFocusMode={setFocusMode} />
            </Layout>
          }
        />

        <Route
          path="/court-resources"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <CourtResources />
            </Layout>
          }
        />

        <Route
          path="/conflict-engine"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <ConflictEngine />
            </Layout>
          }
        />

        <Route
          path="/case/:caseId"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <CaseVault />
            </Layout>
          }
        />

        <Route
          path="/calendar"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <CalendarView />
            </Layout>
          }
        />

        <Route
          path="/vault"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <VaultView />
            </Layout>
          }
        />

        <Route
          path="/war-room"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <WarRoomView />
            </Layout>
          }
        />

        <Route
          path="/analyzer"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <ContractAnalyzer setFocusMode={setFocusMode} />
            </Layout>
          }
        />

        <Route
          path="/case/:caseId/doc/:docId"
          element={
            <Layout focusMode={focusMode} setFocusMode={setFocusMode}>
              <DocumentViewer focusMode={focusMode} setFocusMode={setFocusMode} />
            </Layout>
          }
        />
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
