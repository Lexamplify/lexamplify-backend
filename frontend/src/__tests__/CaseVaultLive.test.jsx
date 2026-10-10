import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, name: 'Asha Rao' } }),
  AuthContext: React.createContext(null),
}));

import CaseWorkspace from '../components/CaseWorkspace';
import { useChamberStore } from '../stores/useChamberStore';

// A tiny fake backend: every call the Case Vault makes is answered from `db`, so the tests prove what the screen shows
// comes from the server's data and nothing else.
let db;
let calls;

function res(data, status = 200, extra = {}) {
  return { ok: status < 200 || status >= 300 ? false : true, status, headers: new Headers(extra.headers || {}), json: async () => data, blob: async () => new Blob([extra.body || 'x'], { type: extra.type || 'application/pdf' }) };
}

function route(url, init = {}) {
  const u = new URL(url, 'http://localhost');
  const path = u.pathname;
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ method, path, body: init.body });
  if (path === '/api/vault/folders' && method === 'GET') return res({ folders: db.folders, flat: db.folders, doc_counts: {} });
  if (path === '/api/vault/folders' && method === 'POST') {
    const b = JSON.parse(init.body);
    const f = { id: db.folders.length + 1, name: b.name, parent_id: b.parent_id ?? null, protected: false };
    db.folders.push(f);
    return res(f, 201);
  }
  if (path === '/api/vault/meta') return res({ documents: db.docs });
  if (path === '/api/vault/documents/upload') {
    const id = 100 + db.docs.length;
    const name = init.body.get('file').name;
    db.docs.push({ id, title: name, smart_title: name.replace(/\.[^.]+$/, ''), doc_type: 'uploaded', folder_id: null, file_format: 'pdf', size_bytes: 2048, created_at: new Date().toISOString() });
    return res({ success: true, id }, 201);
  }
  if (path === '/api/vault/overview') return res(db.overview);
  if (path === '/api/vault/timeline') return res({ events: db.events, practice: db.practice });
  if (path === '/api/vault/provenance') return res({ entries: [] });
  if (path === '/api/practice/me') return res({ meta: { case_types: ['Civil', 'Criminal'], statuses: ['Active', 'Stayed'] } });
  if (path === '/api/practice/cases' && method === 'GET') {
    if (db.noFirm) return res({ error: true, message: 'Set up your practice first.', code: 'NO_FIRM' }, 403);
    return res({ cases: db.cases, total: db.cases.length });
  }
  if (path === '/api/practice/cases' && method === 'POST') {
    const b = JSON.parse(init.body);
    db.cases.push({ id: 50, case_no: b.case_no, court: b.court, title: b.title, case_type: b.case_type, status: b.status, client_name: b.client?.name, opposite_party: b.opposite_party, next_hearing: b.first_hearing?.date || null, closed: false });
    return res({ ok: true }, 201);
  }
  if (/^\/api\/vault\/documents\/\d+\/content$/.test(path)) {
    return res({ id: 1, title: 'Plaint OS 123 of 2025', ext: 'pdf', html: '<p>IN THE CITY CIVIL COURT, CHENNAI</p>', text: 'IN THE CITY CIVIL COURT, CHENNAI', previewable: true, info: { doc_class: 'Plaint', doc_date: '2025-06-21' }, case: { id: 3, case_no: 'OS 123/2025', title: 'Arun Kumar v. Sundaram' }, can_edit: true });
  }
  if (/^\/api\/vault\/documents\/\d+\/view$/.test(path)) return res({}, 200, { type: 'application/pdf', body: '%PDF-1.4' });
  if (/^\/api\/vault\/documents\/\d+\/save-edit$/.test(path)) return res({ success: true, id: 55, title: 'Plaint OS 123 of 2025 (edited)', created: true }, 201);
  if (/^\/api\/vault\/documents\/\d+\/assistant$/.test(path)) return res({ answer: 'It is a plaint for recovery of money.', ai: true });
  return res({ error: true, message: `unexpected ${method} ${path}` }, 404);
}

function emptyDb() {
  return {
    folders: [], docs: [], cases: [], events: [], practice: false, noFirm: false,
    overview: { documents: 0, documents_this_week: 0, drafts: 0, categories: 0, category_names: [], practice: false, matters: 0, open_matters: 0, hearings_this_week: 0, next_hearing: null, case_docs: {} },
  };
}

function mount() {
  return render(<MemoryRouter><CaseWorkspace /></MemoryRouter>);
}

beforeEach(() => {
  db = emptyDb();
  calls = [];
  useChamberStore.setState({ activeFolderId: null });
  global.fetch = vi.fn(async (url, init) => route(String(url), init));
  window.URL.createObjectURL = vi.fn(() => 'blob:fake');
  window.URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); });

const tile = (label) => screen.getByText(label).closest('.cv-stat-tile');

describe('Case Vault shows only real data', () => {
  it('a brand-new account sees zeros, empty states and no sample matters', async () => {
    mount();
    await waitFor(() => expect(within(tile('Matters tracked')).getByText('0')).toBeInTheDocument());
    expect(within(tile('Documents in vault')).getByText('0')).toBeInTheDocument();
    expect(within(tile('Document categories')).getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/\+3 THIS WEEK/i)).toBeNull();
    expect(screen.getByText('NO MATTERS YET')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Sharma|Rajan Kumar|Vetrivel/);
    fireEvent.click(screen.getByRole('button', { name: /Case Tracker/ }));
    expect(await screen.findByText('No matters tracked yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Timeline/ }));
    expect(await screen.findByText('Nothing on the timeline yet')).toBeInTheDocument();
  });

  it('Practice cases appear in the tracker and the counts come from the server', async () => {
    db.cases = [{ id: 3, case_no: 'OS 123/2025', court: 'City Civil Court, Chennai', title: 'Arun Kumar v. Sundaram Agencies', status: 'Active', client_name: 'Arun Kumar', opposite_party: 'M/s Sundaram', next_hearing: null, closed: false }];
    db.overview = { ...db.overview, matters: 1, hearings_this_week: 0, case_docs: { 3: 4 }, documents: 1, categories: 2, category_names: ['Plaint', 'Summons'] };
    db.docs = [{ id: 1, title: 'plaint.pdf', smart_title: 'Plaint OS 123 of 2025', doc_type: 'Plaint', folder_id: null, file_format: 'pdf', size_bytes: 4096, created_at: new Date().toISOString() }];
    mount();
    await waitFor(() => expect(within(tile('Matters tracked')).getByText('1')).toBeInTheDocument());
    expect(within(tile('Document categories')).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('PLAINT · SUMMONS')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Case Tracker/ }));
    expect(await screen.findByText('Arun Kumar v. Sundaram Agencies')).toBeInTheDocument();
    expect(screen.getByText('4 in vault')).toBeInTheDocument();
    expect(screen.getByText('Arun Kumar')).toBeInTheDocument();
  });

  it('without a practice the tracker explains how to set one up instead of inventing matters', async () => {
    db.noFirm = true;
    mount();
    expect(await screen.findByText('SET UP PRACTICE TO TRACK')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Case Tracker/ }));
    expect(await screen.findByText('Set up your practice to track matters')).toBeInTheDocument();
  });

  it('the timeline is the server\'s events, not typed-in ones', async () => {
    db.practice = true;
    db.events = [
      { id: 'e0', date: '2025-06-21', label: 'Case filed — Arun Kumar v. Sundaram', source: 'Practice · OS 123/2025', kind: 'filing', case_id: 3, case_title: 'Arun Kumar v. Sundaram' },
      { id: 'e1', date: '2025-09-15', label: 'Written statement dated', source: 'written_statement.pdf', kind: 'document', doc_id: 9 },
    ];
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Timeline/ }));
    expect(await screen.findByText('Case filed — Arun Kumar v. Sundaram')).toBeInTheDocument();
    expect(screen.getByText('21 Jun 2025')).toBeInTheDocument();
    expect(screen.getByText('written_statement.pdf')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Plaint_TN_HC_2026|Counter_Affidavit_SBI/);
  });

  it('Add matter creates a real Practice case and it shows up', async () => {
    db.overview = { ...db.overview, practice: true };
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Case Tracker/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add your first matter' }));
    fireEvent.change(screen.getByLabelText(/Case name/), { target: { value: 'Mohan v. Rao' } });
    fireEvent.change(screen.getByLabelText(/Case number/), { target: { value: 'OS 7/2026' } });
    fireEvent.change(screen.getByLabelText(/Court name/), { target: { value: 'Madras High Court' } });
    fireEvent.change(screen.getByLabelText('Respondent'), { target: { value: 'Rao' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save matter' }));
    expect(await screen.findByText('Mohan v. Rao')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/practice/cases');
    expect(JSON.parse(post.body)).toMatchObject({ case_no: 'OS 7/2026', court: 'Madras High Court', title: 'Mohan v. Rao', opposite_party: 'Rao', case_type: 'Civil' });
  });
});

describe('Document Vault controls work', () => {
  const openVault = async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Document Vault/ }));
    await screen.findByText('Drag and drop folders or files, or click to browse');
  };

  it('New folder creates a folder on the server and shows it', async () => {
    await openVault();
    fireEvent.click(screen.getByRole('button', { name: '+ New folder' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/api/vault/folders')).toBe(true));
    expect(await screen.findByDisplayValue('New folder')).toBeInTheDocument();
  });

  it('Upload document opens a real file picker and uploads what is chosen', async () => {
    await openVault();
    const picker = screen.getByLabelText('Choose documents to upload');
    const click = vi.spyOn(picker, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));
    expect(click).toHaveBeenCalled();
    const file = new File(['%PDF-1.4 test'], 'Summons.pdf', { type: 'application/pdf' });
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() => expect(calls.some((c) => c.path === '/api/vault/documents/upload')).toBe(true));
    expect(await screen.findByText('Summons')).toBeInTheDocument();
  });

  it('Upload folder has its own folder picker', async () => {
    await openVault();
    const picker = screen.getByLabelText('Choose a folder to upload');
    expect(picker).toHaveAttribute('webkitdirectory');
    const click = vi.spyOn(picker, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Upload folder' }));
    expect(click).toHaveBeenCalled();
  });

  it('dropping several files uploads every one of them', async () => {
    await openVault();
    const zone = screen.getByText('Drag and drop folders or files, or click to browse').closest('.cv-dropzone');
    const files = ['a.pdf', 'b.pdf', 'c.pdf'].map((n) => new File(['x'], n, { type: 'application/pdf' }));
    fireEvent.drop(zone, { dataTransfer: { items: [], files } });
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/vault/documents/upload')).toHaveLength(3));
  });

  it('clicking a document opens it inside the app (no download) with Preview, Edit and the AI assistant', async () => {
    db.docs = [{ id: 1, title: 'plaint.pdf', smart_title: 'Plaint OS 123 of 2025', doc_type: 'Plaint', folder_id: null, file_format: 'pdf', size_bytes: 4096, created_at: new Date().toISOString() }];
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await openVault();
    fireEvent.click(await screen.findByLabelText('Open document Plaint OS 123 of 2025'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('tab', { name: 'Preview' })).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: 'Edit' })).toBeInTheDocument();
    expect(await within(dialog).findByText('Document assistant')).toBeInTheDocument();
    await waitFor(() => expect(dialog.querySelector('iframe')).not.toBeNull());     // the PDF itself, shown in the page
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Summarise' }));
    expect(await within(dialog).findByText('It is a plaint for recovery of money.')).toBeInTheDocument();
    const ask = calls.find((c) => c.path.endsWith('/assistant'));
    expect(JSON.parse(ask.body).message).toMatch(/Summarise/);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Edit opens the same document editor as Auto-Draft Studio and saves a DOCX copy', async () => {
    db.docs = [{ id: 1, title: 'plaint.pdf', smart_title: 'Plaint OS 123 of 2025', doc_type: 'Plaint', folder_id: null, file_format: 'pdf', size_bytes: 4096, created_at: new Date().toISOString() }];
    await openVault();
    fireEvent.click(await screen.findByLabelText('Open document Plaint OS 123 of 2025'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('tab', { name: 'Edit' }));
    await waitFor(() => expect(dialog.querySelector('.ProseMirror')).not.toBeNull());
    expect(dialog.querySelector('.ProseMirror').textContent).toContain('IN THE CITY CIVIL COURT, CHENNAI');
    expect(within(dialog).getByText(/original file stays exactly as it is/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as DOCX' }));
    expect(await within(dialog).findByText(/Saved as a new DOCX in your vault/)).toBeInTheDocument();
    const save = calls.find((c) => c.path.endsWith('/save-edit'));
    expect(JSON.parse(save.body).html).toContain('IN THE CITY CIVIL COURT, CHENNAI');
  });
});
