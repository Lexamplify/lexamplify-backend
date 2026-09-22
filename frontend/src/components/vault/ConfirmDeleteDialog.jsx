import { useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

const styles = `
  .vlt-del-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(10,10,10,.55); backdrop-filter: blur(2px); }
  .vlt-del-modal { background: var(--paper); border: 1px solid var(--rule); border-radius: 13px; box-shadow: 0 20px 50px rgba(0,0,0,.35); width: 100%; max-width: 380px; }
  .vlt-del-body { padding: 20px; display: flex; gap: 14px; }
  .vlt-del-icon { width: 36px; height: 36px; border-radius: 10px; background: var(--major-soft); color: var(--major); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .vlt-del-title { font-family: 'Fraunces', serif; font-style: italic; font-size: 15.5px; font-weight: 600; color: var(--ink); }
  .vlt-del-sub { font-size: 12.5px; color: var(--ink-soft); margin-top: 6px; line-height: 1.5; }
  .vlt-del-error { font-size: 12px; color: var(--accent); margin-top: 10px; }
  .vlt-del-foot { padding: 14px 20px; border-top: 1px solid var(--rule); display: flex; justify-content: flex-end; gap: 8px; }
  .vlt-del-btn { padding: 7px 14px; font-size: 12.5px; font-weight: 500; border-radius: 8px; cursor: pointer; border: 1px solid var(--rule); background: transparent; color: var(--ink); }
  .vlt-del-btn:hover:not(:disabled) { background: var(--paper-2); }
  .vlt-del-btn.danger { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .vlt-del-btn.danger:hover:not(:disabled) { filter: brightness(1.08); }
  .vlt-del-btn:disabled { opacity: 0.6; cursor: not-allowed; }
`;

export default function ConfirmDeleteDialog({ isOpen, item, onCancel, onConfirm }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen || !item) return null;

  const isFolder = item.type === 'folder';

  const handleConfirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm(item);
    } catch (e) {
      // Backend is the real backstop (e.g. a protected folder somehow
      // reaching this dialog via stale UI state) — surface its message
      // rather than silently assuming the delete succeeded.
      setError(e.message || 'Delete failed.');
      setDeleting(false);
    }
  };

  // Portaled to document.body — AppRouter.jsx's page-transition wrapper
  // (.page-enter) applies a CSS transform to every route's root, and a
  // transformed ancestor becomes the containing block for any
  // position:fixed descendant, so without the portal this overlay would
  // resolve "fixed" relative to that in-flow page wrapper instead of the
  // viewport. Same bug/fix already applied elsewhere (AutoDraftWorkspace,
  // FirmLibrary's document viewer).
  return createPortal(
    <div className="vlt-del-overlay" onClick={onCancel}>
      <style>{styles}</style>
      <div className="vlt-del-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vlt-del-body">
          <div className="vlt-del-icon">
            <AlertTriangle size={18} />
          </div>
          <div>
            <div className="vlt-del-title">Delete "{item.name}"?</div>
            <div className="vlt-del-sub">
              {isFolder
                ? 'This folder and everything inside it — subfolders and documents — will be permanently deleted. This cannot be undone.'
                : 'This document will be permanently deleted. This cannot be undone.'}
            </div>
            {error && <div className="vlt-del-error">{error}</div>}
          </div>
        </div>
        <div className="vlt-del-foot">
          <button className="vlt-del-btn" onClick={onCancel} disabled={deleting}>Cancel</button>
          <button className="vlt-del-btn danger" onClick={handleConfirm} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
