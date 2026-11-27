import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';

// Shared splash that stops staring blankly after 8 seconds and offers a
// retry — otherwise a backend-down local-dev scenario pins the UI on
// "Opening your chambers…" forever while AuthContext retries.
function OpeningSplash() {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStalled(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--muted)', fontFamily: 'var(--font-serif)', fontSize: 16, padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div>Opening your chambers…</div>
        {stalled && (
          <div style={{ marginTop: 22, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ color: 'var(--ink)', fontWeight: 500, marginBottom: 6 }}>
              This is taking longer than usual.
            </div>
            <div>
              The backend may not be running. Start it with{' '}
              <code style={{ background: 'var(--paper-2)', padding: '1px 6px', borderRadius: 4 }}>python app.py</code>
              {' '}in the backend folder, then click retry.
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: 14, padding: '8px 18px', border: '1px solid var(--rule)',
                borderRadius: 8, background: 'var(--accent)', color: 'var(--on-accent)',
                cursor: 'pointer', fontSize: 13,
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
import { lazy } from 'react';
// Eager: the layout, the hub (first logged-in paint), and the logged-out
// landing/auth pages — these must never flash a Suspense fallback.
import Shell from './shell/Shell.jsx';
import Home from './pages/Home.jsx';
import Today from './pages/Today.jsx';
import Login from './pages/Login.jsx';
import ClerkLogin from './pages/ClerkLogin.jsx';
import Soon from './pages/Soon.jsx';
import Landing from './pages/Landing.jsx';
import Signup from './pages/Signup.jsx';
import FeaturesPage from './pages/FeaturesPage.jsx';
import HowPage from './pages/HowPage.jsx';
import FaqPage from './pages/FaqPage.jsx';

// Lazy: heavy, behind-auth screens — each its own chunk, fetched on first
// navigation (Shell's <Suspense> shows a brief "Loading…"), so the initial
// bundle every visitor downloads is much smaller. DraftEditor pulls in the
// WordCraft WASM bridge — the biggest single win to split out.
const Assistant = lazy(() => import('./pages/Assistant.jsx'));
const Matters = lazy(() => import('./pages/Matters.jsx'));
const MatterDetail = lazy(() => import('./pages/MatterDetail.jsx'));
const Draft = lazy(() => import('./pages/Draft.jsx'));
const DraftEditor = lazy(() => import('./pages/DraftEditor.jsx'));
const StudioHome = lazy(() => import('./pages/StudioHome.jsx'));
const Research = lazy(() => import('./pages/Research.jsx'));
const Contracts = lazy(() => import('./pages/Contracts.jsx'));
const ContractDetail = lazy(() => import('./pages/ContractDetail.jsx'));
const Calendar = lazy(() => import('./pages/Calendar.jsx'));
const Library = lazy(() => import('./pages/Library.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const CourtResources = lazy(() => import('./pages/CourtResources.jsx'));
const ConflictEngine = lazy(() => import('./pages/ConflictEngine.jsx'));
const LegalForms = lazy(() => import('./pages/LegalForms.jsx'));
const CaseVault = lazy(() => import('./pages/CaseVault.jsx'));
const DocumentHub = lazy(() => import('./pages/DocumentHub.jsx'));
const Practice = lazy(() => import('./pages/Practice.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));
const Clients = lazy(() => import('./pages/Clients.jsx'));
const ClientDetail = lazy(() => import('./pages/ClientDetail.jsx'));
const WarRoom = lazy(() => import('./pages/WarRoom.jsx'));
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage.jsx'));
const TeamActivity = lazy(() => import('./pages/TeamActivity.jsx'));

// Gate the whole shell behind a real session. While the cookie is being verified
// (GET /api/auth/me) we show a calm splash; a verified-logged-out user goes to /login.
function Protected({ children }) {
  const { user, isInitializing } = useAuth();
  if (isInitializing) return <OpeningSplash />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Root route: signed-in users go to Today; signed-out visitors see the Landing page.
function Root() {
  const { user, isInitializing } = useAuth();
  if (isInitializing) return <OpeningSplash />;
  if (!user) return <Landing />;
  return <Navigate to="/start" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Root />} />
          <Route path="/login" element={<Login />} />
          <Route path="/clerk-login" element={<ClerkLogin />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/how" element={<HowPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route element={<Protected><Shell /></Protected>}>
            {/* Built from scratch in the luxury design */}
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/matters" element={<Matters />} />
            <Route path="/matters/:id" element={<MatterDetail />} />
            <Route path="/draft" element={<Draft />} />
            <Route path="/draft/:id" element={<DraftEditor />} />
            <Route path="/research" element={<Research />} />
            <Route path="/contracts" element={<Contracts />} />
            <Route path="/contracts/:id" element={<ContractDetail />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/library" element={<Library />} />
            <Route path="/settings" element={<Settings />} />
            {/* Nav aliases to the luxury equivalents */}
            <Route path="/start" element={<Home />} />
            <Route path="/today" element={<Today />} />
            <Route path="/auto-draft" element={<StudioHome />} />
            <Route path="/auto-draft/legacy" element={<Draft />} />
            <Route path="/contract-analyzer" element={<Contracts />} />
            <Route path="/firm-library" element={<Library />} />
            {/* All rebuilt from scratch in the luxury design */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/court-resources" element={<CourtResources />} />
            <Route path="/conflict-engine" element={<ConflictEngine />} />
            <Route path="/legal-forms" element={<LegalForms />} />
            <Route path="/war-room" element={<WarRoom />} />
            <Route path="/practice" element={<Practice />} />
            <Route path="/practice/audit" element={<Audit />} />
            <Route path="/practice/activity" element={<TeamActivity />} />
            <Route path="/practice/clients" element={<Clients />} />
            <Route path="/practice/clients/:id" element={<ClientDetail />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/practice/*" element={<Practice />} />
            <Route path="/vault" element={<CaseVault />} />
            <Route path="/document-hub" element={<DocumentHub />} />
            <Route path="/workspaces" element={<WorkspacesPage />} />
            <Route path="*" element={<Today />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
