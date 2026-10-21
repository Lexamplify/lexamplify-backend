// Dev-only preview mode — lets the app shell + screens render without a
// backend so the UI can be designed and reviewed. NEVER active in a
// production build (gated behind import.meta.env.DEV). Enable by visiting
// any route with ?preview=1 (persists for the tab); disable with ?preview=0.

export function isPreviewMode() {
  if (!import.meta.env.DEV) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('preview') === '1') sessionStorage.setItem('lex_preview', '1');
    if (params.get('preview') === '0') sessionStorage.removeItem('lex_preview');
    return sessionStorage.getItem('lex_preview') === '1';
  } catch {
    return false;
  }
}

export const PREVIEW_USER = {
  id: 'preview-user',
  name: 'A. Advocate',
  fullName: 'Aarav Advocate',
  email: 'preview@lexamplify.in',
  firmName: 'Advocate Chambers',
  role: 'owner',
};
