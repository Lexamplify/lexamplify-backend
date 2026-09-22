import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { FolderOpen, PenLine, FolderInput, Share2, Trash2 } from 'lucide-react';

export default function ContextMenu({ 
  item, 
  x, 
  y, 
  isOpen, 
  onClose, 
  onOpen, 
  onRename, 
  onMove, 
  onShare, 
  onDelete 
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
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

  // Viewport clamping (12px minimum margin on all edges)
  const menuWidth = 190;
  const menuHeight = item.type === 'folder' ? 190 : 155;
  const clampedX = Math.max(12, Math.min(x, window.innerWidth - menuWidth - 12));
  const clampedY = Math.max(12, Math.min(y, window.innerHeight - menuHeight - 12));

  return ReactDOM.createPortal(
    <>
      {/* Invisible backdrop to dismiss menu on click or right-click */}
      <div 
        className="fixed inset-0 z-[9998]" 
        onClick={onClose} 
        onContextMenu={(e) => { e.preventDefault(); onClose(); }} 
      />
      <div
        ref={menuRef}
        style={{ top: `${clampedY}px`, left: `${clampedX}px` }}
        className="fixed z-[9999] w-48 bg-[var(--paper)] border border-[var(--rule)] rounded-xl shadow-2xl py-1.5 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 font-sans select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {item.type === 'folder' && (
          <button
            onClick={() => { onOpen(item); onClose(); }}
            className="w-full px-3 py-2 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper-2)] hover:text-[var(--accent)] flex items-center gap-2.5 transition-colors text-left"
          >
            <FolderOpen className="text-[var(--accent)]" size={14}/>
            <span>Open Folder</span>
          </button>
        )}
        <button
          onClick={() => { onRename(item); onClose(); }}
          className="w-full px-3 py-2 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper-2)] hover:text-[var(--accent)] flex items-center gap-2.5 transition-colors text-left"
        >
          <PenLine className="text-[var(--muted)]" size={14}/>
          <span>Rename</span>
        </button>
        <button
          onClick={() => { onMove(item); onClose(); }}
          className="w-full px-3 py-2 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper-2)] hover:text-[var(--accent)] flex items-center gap-2.5 transition-colors text-left"
        >
          <FolderInput className="text-[var(--muted)]" size={14}/>
          <span>Move to...</span>
        </button>
        <button
          onClick={() => { onShare(item); onClose(); }}
          className="w-full px-3 py-2 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper-2)] hover:text-[var(--accent)] flex items-center gap-2.5 transition-colors text-left"
        >
          <Share2 className="text-[var(--accent)]" size={14}/>
          <span>Share with Team...</span>
        </button>
        <div className="my-1 border-t border-[var(--rule)]" />
        <button
          onClick={() => { onDelete(item); onClose(); }}
          className="w-full px-3 py-2 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] flex items-center gap-2.5 transition-colors text-left"
        >
          <Trash2 size={14}/>
          <span>Delete</span>
        </button>
      </div>
    </>,
    document.body
  );
}
