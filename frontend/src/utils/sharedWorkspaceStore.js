const STORAGE_KEY = 'lex_shared_workspace';
const EVENT_NAME = 'lex:sharedWorkspaceUpdate';

export function getSharedFiles() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addSharedFile(record) {
  try {
    const existing = getSharedFiles();
    existing.unshift(record);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(0, 50)));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: record }));
  } catch {
    // storage quota exceeded — silently skip
  }
}

export function removeSharedFile(id) {
  try {
    const updated = getSharedFiles().filter(f => f.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: null }));
  } catch {
    // ignore
  }
}

export function useSharedFiles(moduleId) {
  // Returns files that include moduleId in their modules array
  return getSharedFiles().filter(f =>
    !moduleId || (Array.isArray(f.modules) && f.modules.includes(moduleId))
  );
}

export function subscribeSharedFiles(callback) {
  const handler = () => callback(getSharedFiles());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
