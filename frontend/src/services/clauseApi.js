const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf(), ...(opts.headers || {}) };
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.json();
}

export const listClauses = () => request('/api/clauses');
export const createClause = (data) => request('/api/clauses', { method: 'POST', body: JSON.stringify(data) });
export const updateClause = (id, data) => request(`/api/clauses/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteClause = (id) => request(`/api/clauses/${id}`, { method: 'DELETE' });
