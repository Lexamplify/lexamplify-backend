// Shown on every screen except the Document Hub itself: a big import keeps running when you move on to other work,
// and this small card is how you see it (and get back to it).
import { useLocation, useNavigate } from 'react-router-dom';
import './dochub.css';
import { Portal } from './ui.jsx';
import { UploadDock } from './ImportPanel.jsx';

export default function GlobalUploadDock() {
  const loc = useLocation();
  const nav = useNavigate();
  if (loc.pathname.startsWith('/document-hub')) return null;
  return (
    <Portal>
      <UploadDock onOpen={() => nav('/document-hub?import=1')} onView={(batch) => nav(`/document-hub?batch=${encodeURIComponent(batch)}`)} />
    </Portal>
  );
}
