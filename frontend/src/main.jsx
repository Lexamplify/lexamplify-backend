import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './styles/themes.css';
import './styles/luxury-system.css';
import './styles/shell.css';
import './styles/studio.css';
import './styles/pages.css';
import './styles/editor.css';
import './styles/landing.css';
import './styles/feature-showcase.css';
import './styles/landing-polish.css';
import './styles/hero-film.css';
import './styles/showcase-rich.css';
import './styles/landing-motion.css';
import './styles/auth-motion.css';
import './styles/pagehero.css';
import './styles/workspace-switcher.css';
import './styles/workspaces-page.css';
import './store/useSettings.js'; // applies saved theme/layout on load
import App from './App.jsx';

// StrictMode intentionally omitted: its dev double-mount would init/destroy the Yjs
// WebRTC + IndexedDB providers twice per editor mount. Production is unaffected.
createRoot(document.getElementById('root')).render(<App />);
