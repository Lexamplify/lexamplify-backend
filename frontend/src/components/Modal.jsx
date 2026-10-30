import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as Ic from '../icons.jsx';

export default function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    // Lock page scroll while modal is open (prevents background jiggle on scroll)
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Portal to document.body so no ancestor transform/filter/backdrop-filter
  // (e.g. the shell's blurred topbar) traps our position:fixed overlay inside
  // the main content area. This keeps the modal centered to the real viewport.
  return createPortal(
    <div className="ov" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 680 } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Ic.X size={17} /></button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
