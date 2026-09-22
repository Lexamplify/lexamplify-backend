import React from 'react';

// Crisp SVG Icons (Slate & Rust tokens)
const FolderOpen = ({ size }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
const PenLine = ({ size }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>;
const FolderInput = ({ size }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><path d="M9 14h6" /><path d="M12 11l3 3-3 3" /></svg>;
const Share2 = ({ size }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>;
const Trash2 = ({ size }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>;

export default function ContextMenu({ item, x, y, onClose, onOpen, onRename, onMove, onShare, onDelete }) {
  if (!item) return null;

  return (
    <div
      className="fixed z-[9999] bg-[var(--paper)] border border-[var(--rule)] rounded-lg shadow-xl py-1 w-44 flex flex-col"
      style={{ top: y, left: x, fontFamily: "'IBM Plex Sans', sans-serif" }}
      onMouseDown={(e) => e.stopPropagation()} // prevent clicks from bubbling to close handler immediately
    >
      {item.type === 'folder' && (
        <button
          className="w-full text-left px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--paper-2)] flex items-center gap-2"
          onClick={() => onOpen(item)}
        >
          <FolderOpen size={16} /> Open
        </button>
      )}
      <button
        className="w-full text-left px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--paper-2)] flex items-center gap-2"
        onClick={() => onRename(item)}
      >
        <PenLine size={16} /> Rename
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--paper-2)] flex items-center gap-2"
        onClick={() => onMove(item)}
      >
        <FolderInput size={16} /> Move to...
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-[var(--ink)] hover:bg-[var(--paper-2)] flex items-center gap-2"
        onClick={() => onShare(item)}
      >
        <Share2 size={16} /> Share
      </button>
      <div className="h-px bg-[var(--rule)] my-1 w-full" />
      <button
        className="w-full text-left px-3 py-2 text-sm text-[var(--accent)] hover:bg-[var(--paper-2)] flex items-center gap-2"
        onClick={() => onDelete(item)}
      >
        <Trash2 size={16} /> Delete
      </button>
    </div>
  );
}
