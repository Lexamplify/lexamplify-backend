import { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Real Matter/Team persistence (app.py's /api/matters* and /api/teams*
// routes) — replaces useOrganizationStore.js's old localStorage-only
// `teams`/`matters`/`activities` state. Same fetch-in-a-hook convention as
// useVaultTree.js: this hook owns all network calls; the Zustand store is
// trimmed to pure UI-only selection state (activeOrgId/activeTeamId/
// activeMatterId).
async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Request failed (${res.status}).`);
  }
  return data;
}

export function useOrganization() {
  const [teams, setTeams] = useState([]);
  const [matters, setMatters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsData, mattersData] = await Promise.all([
        request('/api/teams'),
        request('/api/matters'),
      ]);
      setTeams(teamsData.teams || []);
      setMatters(mattersData.matters || []);
    } catch (e) {
      setError(e.message || 'Failed to load teams/matters.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createTeam = useCallback(async (name, description = '') => {
    const data = await request('/api/teams', { method: 'POST', body: JSON.stringify({ name, description }) });
    await refresh();
    return data;
  }, [refresh]);

  const createMatter = useCallback(async (title, teamId = null, leadCounsel = null) => {
    const data = await request('/api/matters', {
      method: 'POST',
      body: JSON.stringify({ title, team_id: teamId, lead_counsel: leadCounsel }),
    });
    await refresh();
    return data.matter;
  }, [refresh]);

  const assignMatterToTeam = useCallback(async (matterId, teamId) => {
    const data = await request(`/api/matters/${matterId}/team`, {
      method: 'PATCH',
      body: JSON.stringify({ team_id: teamId }),
    });
    await refresh();
    return data.matter;
  }, [refresh]);

  const updateMatterStatus = useCallback(async (matterId, status) => {
    await request(`/api/matters/${matterId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await refresh();
  }, [refresh]);

  return {
    teams,
    matters,
    loading,
    error,
    refresh,
    createTeam,
    createMatter,
    assignMatterToTeam,
    updateMatterStatus,
  };
}

// ── Per-matter detail (deadlines/tasks/notes/documents/activity) ─────────
// Separate from useOrganization() above since most consumers (Home,
// filter tabs) only need the lightweight matters list, not a specific
// matter's full detail — mirrors how useVaultTree keeps folder/document
// listing separate from any one document's own content.
export function useMatterDetail(matterId) {
  const [matter, setMatter] = useState(null);
  const [deadlines, setDeadlines] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [notes, setNotes] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!matterId) return;
    setLoading(true);
    setError(null);
    try {
      const [m, d, t, n, doc, a] = await Promise.all([
        request(`/api/matters/${matterId}`),
        request(`/api/matters/${matterId}/deadlines`),
        request(`/api/matters/${matterId}/tasks`),
        request(`/api/matters/${matterId}/notes`),
        request(`/api/matters/${matterId}/documents`),
        request(`/api/matters/${matterId}/activity`),
      ]);
      setMatter(m.matter);
      setDeadlines(d.deadlines || []);
      setTasks(t.tasks || []);
      setNotes(n.notes || []);
      setDocuments(doc.documents || []);
      setActivity(a.activity || []);
    } catch (e) {
      setError(e.message || 'Failed to load this matter.');
    } finally {
      setLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addDeadline = useCallback(async (title, date, description = '') => {
    await request(`/api/matters/${matterId}/deadlines`, {
      method: 'POST',
      body: JSON.stringify({ title, date, description }),
    });
    await refresh();
  }, [matterId, refresh]);

  const addTask = useCallback(async (title) => {
    await request(`/api/matters/${matterId}/tasks`, { method: 'POST', body: JSON.stringify({ title }) });
    await refresh();
  }, [matterId, refresh]);

  const toggleTask = useCallback(async (taskId, done) => {
    await request(`/api/matters/${matterId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ done }),
    });
    await refresh();
  }, [matterId, refresh]);

  const addNote = useCallback(async (text) => {
    await request(`/api/matters/${matterId}/notes`, { method: 'POST', body: JSON.stringify({ text }) });
    await refresh();
  }, [matterId, refresh]);

  const assignTeam = useCallback(async (teamId) => {
    await request(`/api/matters/${matterId}/team`, { method: 'PATCH', body: JSON.stringify({ team_id: teamId }) });
    await refresh();
  }, [matterId, refresh]);

  // Reuses Case Vault's real upload route directly (case_id = 'matter:<id>')
  // rather than a parallel storage system — see the Home Gateway v4 plan's
  // rationale on this. Real file, real storage; the "finds a deadline"
  // part that follows is a simulated/templated extraction, same convention
  // as every other AI feature in this app (no real document-understanding
  // call here) — see the addDeadline call below with ai_extracted: true.
  const uploadDocument = useCallback(async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('case_id', `matter:${matterId}`);
    const res = await fetch(`${API_BASE}/api/vault/documents/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Upload failed.');

    // The vault upload route above has no concept of matters, so it can't
    // log its own activity entry the way the matter-native routes do —
    // logged explicitly here instead, via the generic activity endpoint.
    await request(`/api/matters/${matterId}/activity`, {
      method: 'POST',
      body: JSON.stringify({ text: `Uploaded ${file.name}` }),
    });

    const baseName = file.name.replace(/\.(pdf|docx|txt)$/i, '').replace(/_/g, ' ');
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14);
    await request(`/api/matters/${matterId}/deadlines`, {
      method: 'POST',
      body: JSON.stringify({
        title: `Response deadline — ${baseName}`,
        date: dueDate.toISOString().slice(0, 10),
        description: `Extracted from ${file.name} — LexAmplify found a response window in the uploaded document's text and filed it here for review.`,
        ai_extracted: true,
      }),
    });
    await refresh();
    return data;
  }, [matterId, refresh]);

  return {
    matter, deadlines, tasks, notes, documents, activity, loading, error, refresh,
    addDeadline, addTask, toggleTask, addNote, assignTeam, uploadDocument,
  };
}
