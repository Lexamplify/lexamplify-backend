import { HashRouter, Routes, Route } from 'react-router-dom';
import Shell from './shell/Shell.jsx';
import Today from './pages/Today.jsx';
import Matters from './pages/Matters.jsx';
import Draft from './pages/Draft.jsx';
import Research from './pages/Research.jsx';
import Contracts from './pages/Contracts.jsx';
import Calendar from './pages/Calendar.jsx';
import Library from './pages/Library.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Today />} />
          <Route path="/matters" element={<Matters />} />
          <Route path="/draft" element={<Draft />} />
          <Route path="/research" element={<Research />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/library" element={<Library />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Today />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
