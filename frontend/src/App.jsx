import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Shell from './shell/Shell.jsx';
import Today from './pages/Today.jsx';
import Matters from './pages/Matters.jsx';
import MatterDetail from './pages/MatterDetail.jsx';
import Draft from './pages/Draft.jsx';
import DraftEditor from './pages/DraftEditor.jsx';
import Research from './pages/Research.jsx';
import Contracts from './pages/Contracts.jsx';
import ContractDetail from './pages/ContractDetail.jsx';
import Calendar from './pages/Calendar.jsx';
import Library from './pages/Library.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Soon from './pages/Soon.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CourtResources from './pages/CourtResources.jsx';
import ConflictEngine from './pages/ConflictEngine.jsx';
import LegalForms from './pages/LegalForms.jsx';
import CaseVault from './pages/CaseVault.jsx';
import DocumentHub from './pages/DocumentHub.jsx';
import Practice from './pages/Practice.jsx';
import Audit from './pages/Audit.jsx';
import Clients from './pages/Clients.jsx';
import ClientDetail from './pages/ClientDetail.jsx';
import WarRoom from './pages/WarRoom.jsx';
import Landing from './pages/Landing.jsx';
import Signup from './pages/Signup.jsx';
import FeaturesPage from './pages/FeaturesPage.jsx';
import HowPage from './pages/HowPage.jsx';
import FaqPage from './pages/FaqPage.jsx';

// Gate the whole shell behind a real session. While the cookie is being verified
// (GET /api/auth/me) we show a calm splash; a verified-logged-out user goes to /login.
function Protected({ children }) {
  const { user, isInitializing } = useAuth();
  if (isInitializing) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--muted)', fontFamily: 'var(--font-serif)', fontSize: 16 }}>
        Opening your chambers…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Root route: signed-in users go to Today; signed-out visitors see the Landing page.
function Root() {
  const { user, isInitializing } = useAuth();
  if (isInitializing) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--muted)', fontFamily: 'var(--font-serif)', fontSize: 16 }}>
        Opening your chambers…
      </div>
    );
  }
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
          <Route path="/signup" element={<Signup />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/how" element={<HowPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route element={<Protected><Shell /></Protected>}>
            {/* Built from scratch in the luxury design */}
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
            <Route path="/start" element={<Today />} />
            <Route path="/auto-draft" element={<Draft />} />
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
            <Route path="/practice/clients" element={<Clients />} />
            <Route path="/practice/clients/:id" element={<ClientDetail />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/practice/*" element={<Practice />} />
            <Route path="/vault" element={<CaseVault />} />
            <Route path="/document-hub" element={<DocumentHub />} />
            <Route path="*" element={<Today />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
