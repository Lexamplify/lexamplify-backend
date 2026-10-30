import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const userScopedStorage = {
  getItem: (name) => {
    const userId = localStorage.getItem('active_lex_user') || 'guest';
    return localStorage.getItem(`${userId}_${name}`);
  },
  setItem: (name, value) => {
    const userId = localStorage.getItem('active_lex_user') || 'guest';
    localStorage.setItem(`${userId}_${name}`, value);
  },
  removeItem: (name) => {
    const userId = localStorage.getItem('active_lex_user') || 'guest';
    localStorage.removeItem(`${userId}_${name}`);
  },
};

// Client-only UI state with no backend equivalent — folder/document CRUD
// itself now lives in useVaultTree.js (real /api/vault/* persistence), not
// here. This store used to also own a flat `vaultItems` array as the vault's
// only source of truth, entirely in memory — the whole tree was lost on
// every page refresh. That's gone; this store now only tracks which folder
// is currently open, which (still-unused/unfiltered) matter scope is active,
// and the folder-sync progress toast state, none of which the backend needs
// to know about.
export const useChamberStore = create(
  persist(
    (set) => ({
      activeFolderId: null, // null = root, matching the backend's parent_id/folder_id convention
      activeMatterId: 'm1', // retained for prop-compatibility with matter-aware UI elsewhere; the real vault_folders/case_vault schema has no per-matter scoping, so this no longer filters anything here
      syncProgress: { isSyncing: false, current: 0, total: 0, currentName: '' },

      setActiveFolderId: (id) => set({ activeFolderId: id }),
      setActiveMatterId: (id) => set({ activeMatterId: id }),
      setSyncProgress: (progress) => set((state) => ({ syncProgress: { ...state.syncProgress, ...progress } })),
      clearStore: () => set({ activeFolderId: null, activeMatterId: 'm1', syncProgress: { isSyncing: false, current: 0, total: 0, currentName: '' } }),
    }),
    {
      name: 'chamber-store',
      storage: createJSONStorage(() => userScopedStorage),
    }
  )
);

// ── Pure helpers over a real (backend-shaped) folder tree ──────────────────
// These take the tree/flat-folder data explicitly instead of reading from
// internal store state, since that data now lives in useVaultTree()'s React
// state, not in this Zustand store.

// items: array of {id, type:'folder'|'doc', name, folder_id/parent_id, ...}
// already combined (folders + documents) for the folder currently being
// viewed. Folders carry `parent_id`, documents carry `folder_id` — both
// normalized to `parentId` by the caller before being passed in here.
export function getItemsInFolder(folders, documents, folderId) {
  const folderItems = folders
    .filter((f) => (f.parent_id ?? null) === (folderId ?? null))
    .map((f) => ({ ...f, type: 'folder' }));
  const docItems = documents
    .filter((d) => (d.folder_id ?? null) === (folderId ?? null))
    .map((d) => ({ ...d, type: 'doc', name: d.smart_title || d.title || 'Untitled document' }));
  return [...folderItems, ...docItems];
}

export function getFolderPath(flatFolders, folderId) {
  const path = [];
  let currentId = folderId;
  const byId = Object.fromEntries(flatFolders.map((f) => [f.id, f]));
  while (currentId !== null && currentId !== undefined) {
    const folder = byId[currentId];
    if (!folder) break;
    path.unshift(folder);
    currentId = folder.parent_id ?? null;
  }
  path.unshift({ id: null, name: 'Vault' });
  return path;
}

export function getDescendantIds(flatFolders, targetId) {
  const ids = [targetId];
  const children = flatFolders.filter((f) => f.parent_id === targetId);
  for (const child of children) {
    ids.push(...getDescendantIds(flatFolders, child.id));
  }
  return ids;
}

export function buildFolderTree(flatFolders, parentId = null) {
  return flatFolders
    .filter((f) => (f.parent_id ?? null) === parentId)
    .map((f) => ({ ...f, children: buildFolderTree(flatFolders, f.id) }));
}
