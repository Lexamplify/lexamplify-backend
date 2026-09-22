import React, { useState } from 'react';
import { useChamberStore } from '../../stores/useChamberStore';

export default function MoveModal({ isOpen, item, onClose, onMove }) {
  const { getAllFolders, getDescendantIds, activeMatterId } = useChamberStore();
  const [selectedFolderId, setSelectedFolderId] = useState(item?.parentId || 'root');

  if (!isOpen || !item) return null;

  const allFolders = getAllFolders(activeMatterId);
  const descendantIds = item.type === 'folder' ? getDescendantIds(item.id) : [];
  
  // Can't move into itself, its descendants, or its current parent
  const disabledIds = new Set([item.id, ...descendantIds]);

  // Build recursive tree
  const buildTree = (parentId) => {
    return allFolders
      .filter(f => f.parentId === parentId)
      .map(f => ({ ...f, children: buildTree(f.id) }));
  };
  const tree = buildTree('root');

  const renderNode = (node, depth = 0) => {
    const isDisabled = disabledIds.has(node.id);
    const isSelected = selectedFolderId === node.id;
    
    return (
      <div key={node.id}>
        <div 
          className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors ${
            isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--paper-2)]'
          } ${isSelected && !isDisabled ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium' : 'text-[var(--ink)]'}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => !isDisabled && setSelectedFolderId(node.id)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isSelected && !isDisabled ? "text-[var(--accent)]" : "text-[var(--muted)]"}>
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-sm">{node.name}</span>
        </div>
        {node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  const isMoveValid = selectedFolderId !== item.parentId && !disabledIds.has(selectedFolderId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--paper)] border border-[var(--rule)] rounded-xl shadow-2xl w-full max-w-sm flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-[var(--rule)]">
          <h2 className="text-lg font-semibold text-[var(--ink)] font-['Fraunces'] italic">Move "{item.name}"</h2>
          <div className="text-xs text-[var(--muted)] mt-1">Select a destination folder</div>
        </div>
        
        <div className="p-3 overflow-y-auto flex-grow min-h-[250px]">
          <div 
            className={`flex items-center gap-2 py-1.5 px-2 rounded-md cursor-pointer transition-colors hover:bg-[var(--paper-2)] ${selectedFolderId === 'root' ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium' : 'text-[var(--ink)]'}`}
            onClick={() => setSelectedFolderId('root')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={selectedFolderId === 'root' ? "text-[var(--accent)]" : "text-[var(--muted)]"}>
              <rect x="2" y="2" width="20" height="20" rx="2" ry="2" />
              <path d="M2 12h20" />
            </svg>
            <span className="text-sm">Vault (Root)</span>
          </div>
          
          <div className="mt-1">
            {tree.map(node => renderNode(node, 1))}
          </div>
        </div>

        <div className="p-4 border-t border-[var(--rule)] flex justify-end gap-2 bg-[var(--paper)]">
          <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-[var(--ink)] bg-transparent hover:bg-[var(--paper-2)] border border-[var(--rule)] rounded-lg transition-colors">
            Cancel
          </button>
          <button 
            onClick={() => onMove(selectedFolderId)} 
            disabled={!isMoveValid}
            className="px-3 py-1.5 text-sm font-medium text-white bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-opacity"
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  );
}
