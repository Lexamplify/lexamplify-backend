import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import './styles/themes.css';
import './styles/luxury-system.css';
import './styles/shell.css';
import './styles/studio.css';
import './store/useSettings.js'; // applies saved theme/layout on load
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
