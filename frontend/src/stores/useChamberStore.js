import { create } from 'zustand';

// Generate random short hash for IDs
const generateId = (prefix) => {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
};

const DEFAULT_FOLDERS = [
  { id: 'f1', type: 'folder', parentId: 'root', name: '01 · Pleadings & Drafts', matterId: 'm1' },
  { id: 'f2', type: 'folder', parentId: 'root', name: '02 · Court Filings', matterId: 'm1' },
  { id: 'f3', type: 'folder', parentId: 'root', name: '03 · Evidence & Exhibits', matterId: 'm1' },
  { id: 'f4', type: 'folder', parentId: 'root', name: '04 · Correspondence', matterId: 'm1' },
  { id: 'f5', type: 'folder', parentId: 'root', name: '05 · Research & Precedents', matterId: 'm1' },
];

const DEFAULT_DOCS = [
  { id: 'd1', type: 'file', parentId: 'f1', name: 'Plaint_TN_HC_2026.pdf', matterId: 'm1', size: '842 KB', tag: 'AUTO-CLASSIFIED · PLEADING', tagSeverity: 'neutral', updated: '2d ago' },
  { id: 'd2', type: 'file', parentId: 'f1', name: 'Vakalatnama_Signed.pdf', matterId: 'm1', size: '210 KB', tag: 'SIGNED', tagSeverity: 'neutral', updated: '5d ago' },
  { id: 'd3', type: 'file', parentId: 'f2', name: 'Interim_Application.pdf', matterId: 'm1', size: '318 KB', tag: 'AUTO-CLASSIFIED · FILING', tagSeverity: 'neutral', updated: '1d ago' },
  { id: 'd4', type: 'file', parentId: 'f2', name: 'Counter_Affidavit_SBI.pdf', matterId: 'm1', size: '540 KB', tag: 'NEEDS REVIEW', tagSeverity: 'review', updated: '4d ago' },
  { id: 'd5', type: 'file', parentId: 'f3', name: 'Exhibit_A_Bank_Statement.pdf', matterId: 'm1', size: '1.1 MB', tag: 'EVIDENCE', tagSeverity: 'neutral', updated: '3d ago' },
  { id: 'd6', type: 'file', parentId: 'f3', name: 'Exhibit_B_Correspondence.pdf', matterId: 'm1', size: '640 KB', tag: 'EVIDENCE', tagSeverity: 'neutral', updated: '6d ago' },
  { id: 'd7', type: 'file', parentId: 'f4', name: 'Legal_Notice_Reply.pdf', matterId: 'm1', size: '190 KB', tag: 'CORRESPONDENCE', tagSeverity: 'neutral', updated: '6d ago' },
  { id: 'd8', type: 'file', parentId: 'f4', name: 'Client_Email_Thread.pdf', matterId: 'm1', size: '95 KB', tag: 'CORRESPONDENCE', tagSeverity: 'neutral', updated: '1w ago' },
];

export const useChamberStore = create((set, get) => ({
  vaultItems: [...DEFAULT_FOLDERS, ...DEFAULT_DOCS],
  activeFolderId: 'root',
  activeMatterId: 'm1',
  syncProgress: { isSyncing: false, current: 0, total: 0, currentName: '' },

  setActiveFolderId: (id) => set({ activeFolderId: id }),
  setActiveMatterId: (id) => set({ activeMatterId: id }),

  setSyncProgress: (progress) => set((state) => ({ syncProgress: { ...state.syncProgress, ...progress } })),

  addItem: (item) => set((state) => {
    const newItem = {
      id: item.id || generateId(item.type === 'folder' ? 'f' : 'd'),
      ...item
    };
    return { vaultItems: [...state.vaultItems, newItem] };
  }),

  addBatchItems: (items) => set((state) => {
    const newItems = items.map(item => ({
      id: item.id || generateId(item.type === 'folder' ? 'f' : 'd'),
      ...item
    }));
    return { vaultItems: [...state.vaultItems, ...newItems] };
  }),

  renameItem: (id, newName) => set((state) => ({
    vaultItems: state.vaultItems.map(item => item.id === id ? { ...item, name: newName } : item)
  })),

  moveItem: (id, newParentId) => set((state) => ({
    vaultItems: state.vaultItems.map(item => item.id === id ? { ...item, parentId: newParentId } : item)
  })),

  deleteItem: (id) => set((state) => {
    const getDescendantIds = (targetId, allItems) => {
      let ids = [targetId];
      const children = allItems.filter(i => i.parentId === targetId);
      for (const child of children) {
        ids = [...ids, ...getDescendantIds(child.id, allItems)];
      }
      return ids;
    };
    const idsToDelete = getDescendantIds(id, state.vaultItems);
    return {
      vaultItems: state.vaultItems.filter(item => !idsToDelete.includes(item.id))
    };
  }),

  initializeBlueprintFolders: (matterId) => set((state) => {
    const existingRootFolders = state.vaultItems.filter(i => i.parentId === 'root' && i.matterId === matterId && i.type === 'folder');
    if (existingRootFolders.length > 0) return state; // Already initialized

    const newFolders = [
      { id: generateId('f'), type: 'folder', parentId: 'root', name: '01 · Pleadings & Drafts', matterId },
      { id: generateId('f'), type: 'folder', parentId: 'root', name: '02 · Court Filings', matterId },
      { id: generateId('f'), type: 'folder', parentId: 'root', name: '03 · Evidence & Exhibits', matterId },
      { id: generateId('f'), type: 'folder', parentId: 'root', name: '04 · Correspondence', matterId },
      { id: generateId('f'), type: 'folder', parentId: 'root', name: '05 · Research & Precedents', matterId },
    ];
    return { vaultItems: [...state.vaultItems, ...newFolders] };
  }),

  // Selectors
  getItemsInFolder: (folderId, matterId) => {
    return get().vaultItems.filter(item => item.parentId === folderId && item.matterId === matterId);
  },

  getFolderPath: (folderId) => {
    const path = [];
    let currentId = folderId;
    while (currentId !== 'root') {
      const folder = get().vaultItems.find(i => i.id === currentId);
      if (folder) {
        path.unshift(folder);
        currentId = folder.parentId;
      } else {
        break;
      }
    }
    path.unshift({ id: 'root', name: 'Vault' });
    return path;
  },

  getAllFolders: (matterId) => {
    return get().vaultItems.filter(item => item.type === 'folder' && item.matterId === matterId);
  },
  
  getDescendantIds: (targetId) => {
    const allItems = get().vaultItems;
    const getDescendants = (tId) => {
      let ids = [tId];
      const children = allItems.filter(i => i.parentId === tId);
      for (const child of children) {
        ids = [...ids, ...getDescendants(child.id)];
      }
      return ids;
    };
    return getDescendants(targetId);
  }
}));
