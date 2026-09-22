import { useState } from 'react';
import { createPortal } from 'react-dom';
import { buildFolderTree, getDescendantIds } from '../../stores/useChamberStore';

const styles = `
  .vlt-move-overlay { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(10,10,10,.55); backdrop-filter: blur(2px); }
  .vlt-move-modal { background: var(--paper); border: 1px solid var(--rule); border-radius: 13px; box-shadow: 0 20px 50px rgba(0,0,0,.35); width: 100%; max-width: 380px; display: flex; flex-direction: column; max-height: 80vh; }
  .vlt-move-head { padding: 16px; border-bottom: 1px solid var(--rule); }
  .vlt-move-title { font-family: 'Fraunces', serif; font-style: italic; font-size: 16px; font-weight: 600; color: var(--ink); }
  .vlt-move-sub { font-size: 11.5px; color: var(--muted); margin-top: 3px; }
  .vlt-move-body { padding: 10px; overflow-y: auto; flex-grow: 1; min-height: 200px; }
  .vlt-move-node { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 7px; cursor: pointer; color: var(--ink); font-size: 13px; transition: background 0.12s ease; }
  .vlt-move-node:hover:not(.disabled) { background: var(--paper-2); }
  .vlt-move-node.selected { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .vlt-move-node.disabled { opacity: 0.45; cursor: not-allowed; }
  .vlt-move-node svg { color: var(--muted); flex-shrink: 0; }
  .vlt-move-node.selected svg { color: var(--accent); }
  .vlt-move-foot { padding: 14px 16px; border-top: 1px solid var(--rule); display: flex; justify-content: flex-end; gap: 8px; }
  .vlt-move-btn { padding: 7px 14px; font-size: 12.5px; font-weight: 500; border-radius: 8px; cursor: pointer; border: 1px solid var(--rule); background: transparent; color: var(--ink); }
  .vlt-move-btn:hover { background: var(--paper-2); }
  .vlt-move-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .vlt-move-btn.primary:hover { filter: brightness(1.08); }
  .vlt-move-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

export default function MoveModal({ isOpen, item, folders, onClose, onMove }) {
  const [selectedFolderId, setSelectedFolderId] = useState(item?.parent_id ?? item?.folder_id ?? null);

  if (!isOpen || !item) return null;

  const flatFolders = folders || [];
  const descendantIds = item.type === 'folder' ? getDescendantIds(flatFolders, item.id) : [];
  const disabledIds = new Set([item.id, ...descendantIds]);
  const tree = buildFolderTree(flatFolders, null);

  const renderNode = (node, depth = 0) => {
    const isDisabled = disabledIds.has(node.id);
    const isSelected = selectedFolderId === node.id;
    return (
      <div key={node.id}>
        <div
          className={`vlt-move-node${isDisabled ? ' disabled' : ''}${isSelected && !isDisabled ? ' selected' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => !isDisabled && setSelectedFolderId(node.id)}
        >
          <FolderIcon />
          <span>{node.name}</span>
        </div>
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  const currentParent = item.parent_id ?? item.folder_id ?? null;
  const isMoveValid = selectedFolderId !== currentParent && !disabledIds.has(selectedFolderId);

  // Portaled to document.body — see ConfirmDeleteDialog.jsx for why
  // (AppRouter.jsx's .page-enter transform breaks position:fixed for
  // non-portaled descendants).
  return createPortal(
    <div className="vlt-move-overlay" onClick={onClose}>
      <style>{styles}</style>
      <div className="vlt-move-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vlt-move-head">
          <div className="vlt-move-title">Move "{item.name}"</div>
          <div className="vlt-move-sub">Select a destination folder</div>
        </div>

        <div className="vlt-move-body">
          <div
            className={`vlt-move-node${selectedFolderId === null ? ' selected' : ''}`}
            onClick={() => setSelectedFolderId(null)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2" ry="2" />
              <path d="M2 12h20" />
            </svg>
            <span>Vault (Root)</span>
          </div>
          <div style={{ marginTop: 4 }}>{tree.map((node) => renderNode(node, 1))}</div>
        </div>

        <div className="vlt-move-foot">
          <button className="vlt-move-btn" onClick={onClose}>Cancel</button>
          <button className="vlt-move-btn primary" onClick={() => onMove(selectedFolderId)} disabled={!isMoveValid}>
            Move here
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
