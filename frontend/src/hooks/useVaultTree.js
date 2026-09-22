import { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// The real backend uses `null` for "root" (no parent_id / no folder_id) —
// callers of this hook should use `null`, not the old client-only 'root'
// string sentinel the Zustand-only model used before real persistence.
async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: isFormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Request failed (${res.status}).`);
  }
  return data;
}

// Owns real network calls for the Document Vault — folders and documents are
// both persisted server-side (see app.py's /api/vault/* routes) instead of
// the old useChamberStore's client-only `vaultItems` array, which lost the
// entire tree on every page refresh. Follows this codebase's existing
// convention (see CaseWorkspace.jsx's prior one-shot fetch) of doing network
// calls from a hook/component rather than inside a Zustand store.
export function useVaultTree() {
  const [folderTree, setFolderTree] = useState([]);
  const [flatFolders, setFlatFolders] = useState([]);
  const [docCounts, setDocCounts] = useState({});
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [folderData, docData] = await Promise.all([
        request('/api/vault/folders'),
        request('/api/vault/meta'),
      ]);
      setFolderTree(folderData.folders || []);
      setFlatFolders(folderData.flat || []);
      setDocCounts(folderData.doc_counts || {});
      setDocuments(docData.documents || []);
    } catch (e) {
      setError(e.message || 'Failed to load the vault.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createFolder = useCallback(async (parentId, name) => {
    const data = await request('/api/vault/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parent_id: parentId }),
    });
    await refresh();
    return data;
  }, [refresh]);

  const initBlueprint = useCallback(async () => {
    const data = await request('/api/vault/folders/init-blueprint', { method: 'POST' });
    await refresh();
    return data;
  }, [refresh]);

  const renameFolder = useCallback(async (id, name) => {
    await request(`/api/vault/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    await refresh();
  }, [refresh]);

  const moveFolder = useCallback(async (id, newParentId) => {
    await request(`/api/vault/folders/${id}`, { method: 'PATCH', body: JSON.stringify({ parent_id: newParentId }) });
    await refresh();
  }, [refresh]);

  const deleteFolder = useCallback(async (id) => {
    await request(`/api/vault/folders/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const renameDocument = useCallback(async (id, title) => {
    await request(`/api/vault/documents/${id}`, { method: 'PUT', body: JSON.stringify({ title }) });
    await refresh();
  }, [refresh]);

  const moveDocument = useCallback(async (id, newFolderId) => {
    await request(`/api/vault/documents/${id}`, { method: 'PUT', body: JSON.stringify({ folder_id: newFolderId }) });
    await refresh();
  }, [refresh]);

  const deleteDocument = useCallback(async (id) => {
    await request(`/api/vault/documents/${id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const uploadFile = useCallback(async (file, folderId, caseId = 'General') => {
    const formData = new FormData();
    formData.append('file', file);
    if (folderId !== null && folderId !== undefined) formData.append('folder_id', folderId);
    formData.append('case_id', caseId);
    const data = await request('/api/vault/documents/upload', { method: 'POST', body: formData });
    await refresh();
    return data;
  }, [refresh]);

  return {
    folderTree,
    flatFolders,
    docCounts,
    documents,
    loading,
    error,
    refresh,
    createFolder,
    initBlueprint,
    renameFolder,
    moveFolder,
    deleteFolder,
    renameDocument,
    moveDocument,
    deleteDocument,
    uploadFile,
  };
}
