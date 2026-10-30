import React, { useEffect, useState } from 'react';

export default function SyncToast({ progress }) {
  const { isSyncing, current, total, currentName } = progress;
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (!isSyncing && total > 0 && current === total) {
      setShowSuccess(true);
      const t = setTimeout(() => setShowSuccess(false), 3500);
      return () => clearTimeout(t);
    }
  }, [isSyncing, current, total]);

  if (!isSyncing && !showSuccess) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="bg-[var(--paper)] border border-[var(--rule)] shadow-2xl rounded-xl p-4 min-w-[300px] flex items-center gap-4">
        {showSuccess ? (
          <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
        ) : (
          <div className="relative w-10 h-10 shrink-0">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" className="stroke-[var(--rule)]" strokeWidth="3" />
              <circle 
                cx="18" cy="18" r="16" fill="none" 
                className="stroke-[var(--accent)] transition-all duration-300 ease-out" 
                strokeWidth="3" 
                strokeDasharray="100" 
                strokeDashoffset={100 - (total > 0 ? (current / total) * 100 : 0)} 
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 bg-[var(--accent)] rounded-full animate-pulse" />
            </div>
          </div>
        )}
        
        <div className="flex-grow min-w-0">
          <div className="text-sm font-semibold text-[var(--ink)]">
            {showSuccess ? 'Folder tree synced successfully' : 'Syncing folder tree'}
          </div>
          <div className="text-xs text-[var(--muted)] font-mono truncate mt-0.5">
            {showSuccess ? `${total} files imported` : `${current} / ${total} files`}
          </div>
          {!showSuccess && currentName && (
            <div className="text-[10px] text-[var(--muted)] truncate mt-1">
              {currentName}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
