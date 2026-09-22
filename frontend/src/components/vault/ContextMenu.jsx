import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { FolderOpen, FolderPlus, Upload, PenLine, FolderInput, Share2, Eye, Download, Trash2 } from 'lucide-react';

const styles = `
  .vlt-cm-menu { position: fixed; z-index: 9999; width: 200px; background: var(--paper); border: 1px solid var(--rule); border-radius: 11px; box-shadow: 0 20px 50px rgba(0,0,0,.35); padding: 6px; font-family: 'IBM Plex Sans', sans-serif; }
  .vlt-cm-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; background: transparent; color: var(--ink); font-size: 12.5px; font-weight: 500; text-align: left; border-radius: 7px; cursor: pointer; transition: background 0.12s ease, color 0.12s ease; }
  .vlt-cm-item:hover:not(:disabled) { background: var(--paper-2); }
  .vlt-cm-item svg { color: var(--muted); flex-shrink: 0; }
  .vlt-cm-item.accent svg { color: var(--accent); }
  .vlt-cm-item.danger { color: var(--accent); }
  .vlt-cm-item.danger:hover:not(:disabled) { background: var(--accent-soft); }
  .vlt-cm-item:disabled { color: var(--muted-2); cursor: not-allowed; }
  .vlt-cm-item:disabled svg { color: var(--muted-2); }
  .vlt-cm-sep { height: 1px; background: var(--rule); margin: 6px 4px; }
`;

export default function ContextMenu({
  item,
  x,
  y,
  isOpen,
  onClose,
  onOpen,
  onNewSubfolder,
  onUploadHere,
  onRename,
  onMove,
  onShare,
  onPreview,
  onDownload,
  onDelete,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  const isFolder = item.type === 'folder';
  const isProtected = !!item.protected;

  const items = isFolder
    ? [
        { key: 'open', label: 'Open Folder', Icon: FolderOpen, accent: true, onClick: () => onOpen(item) },
        { key: 'new-subfolder', label: 'New subfolder', Icon: FolderPlus, onClick: () => onNewSubfolder(item) },
        { key: 'upload-here', label: 'Upload here', Icon: Upload, onClick: () => onUploadHere(item) },
        {
          key: 'rename', label: 'Rename', Icon: PenLine, onClick: () => onRename(item),
          disabled: isProtected, title: isProtected ? 'Standard blueprint folders cannot be renamed.' : undefined,
        },
        { key: 'move', label: 'Move to...', Icon: FolderInput, onClick: () => onMove(item) },
        { key: 'share', label: 'Share...', Icon: Share2, accent: true, onClick: () => onShare(item) },
        { key: 'sep' },
        {
          key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onClick: () => onDelete(item),
          disabled: isProtected, title: isProtected ? 'Standard blueprint folders cannot be deleted.' : undefined,
        },
      ]
    : [
        { key: 'preview', label: 'Preview', Icon: Eye, accent: true, onClick: () => onPreview(item) },
        { key: 'rename', label: 'Rename', Icon: PenLine, onClick: () => onRename(item) },
        { key: 'move', label: 'Move to...', Icon: FolderInput, onClick: () => onMove(item) },
        { key: 'share', label: 'Share...', Icon: Share2, accent: true, onClick: () => onShare(item) },
        { key: 'download', label: 'Download', Icon: Download, onClick: () => onDownload(item) },
        { key: 'sep' },
        { key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onClick: () => onDelete(item) },
      ];

  const menuWidth = 200;
  const menuHeight = items.length * 34 + 20;
  const clampedX = Math.max(12, Math.min(x, window.innerWidth - menuWidth - 12));
  const clampedY = Math.max(12, Math.min(y, window.innerHeight - menuHeight - 12));

  return ReactDOM.createPortal(
    <>
      <style>{styles}</style>
      <div
        className="fixed-backdrop"
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div ref={menuRef} className="vlt-cm-menu" style={{ top: clampedY, left: clampedX }} onClick={(e) => e.stopPropagation()}>
        {items.map((it) =>
          it.key === 'sep' ? (
            <div key="sep" className="vlt-cm-sep" />
          ) : (
            <button
              key={it.key}
              type="button"
              disabled={it.disabled}
              title={it.title}
              onClick={() => { if (!it.disabled) { it.onClick(); onClose(); } }}
              className={`vlt-cm-item${it.accent ? ' accent' : ''}${it.danger ? ' danger' : ''}`}
            >
              <it.Icon size={14} />
              <span>{it.label}</span>
            </button>
          )
        )}
      </div>
    </>,
    document.body
  );
}
