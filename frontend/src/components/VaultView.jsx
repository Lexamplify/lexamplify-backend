import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadDocument, fetchTrackedCases, saveTrackedCase, fetchCauselist } from '../services/api';

const vaultStyles = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes spin {
    0%   { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .animate-fade-in { animation: fadeIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards; }

  /* ── Document Grid Card ─── */
  .vault-grid-card {
    background-color: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 10px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
    overflow: hidden;
    transition: all 0.22s cubic-bezier(0.4,0,0.2,1);
  }
  .vault-grid-card:hover {
    transform: translateY(-3px);
    border-color: rgba(59,130,246,0.4);
    box-shadow: 0 8px 24px rgba(59,130,246,0.1);
  }
  .vault-card-preview {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--text-dark-muted, #8F9CAE);
    font-family: monospace;
    background: rgba(255,255,255,0.015);
    padding: 8px 10px;
    border-radius: 5px;
    border: 1px solid rgba(255,255,255,0.04);
    flex: 1;
  }

  /* ── Upload Zone ── */
  .drag-drop-zone {
    border: 2px dashed var(--border-dark-subtle, #2C3241);
    background-color: var(--bg-dark-app, #0f131a);
    border-radius: 10px;
    padding: 28px 20px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;
    margin-bottom: 24px;
  }
  .drag-drop-zone:hover, .drag-drop-zone.dragover {
    border-color: var(--accent-primary, #3B82F6);
    background-color: rgba(59,130,246,0.03);
    box-shadow: 0 0 20px rgba(59,130,246,0.08);
  }

  /* ── Tabs ── */
  .tabs-wrapper {
    display: flex;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
    margin-bottom: 24px;
    gap: 4px;
    padding-bottom: 0;
  }
  .tab-btn {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-dark-muted, #8F9CAE);
    padding: 10px 16px;
    font-size: 13.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.18s;
    margin-bottom: -1px;
    border-radius: 6px 6px 0 0;
  }
  .tab-btn:hover { color: var(--text-dark-primary, #fff); }
  .tab-btn.active {
    color: var(--accent-primary, #3B82F6);
    border-bottom-color: var(--accent-primary, #3B82F6);
    font-weight: 600;
  }

  /* ── Panels ── */
  .dashboard-panel {
    background-color: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 12px;
    padding: 24px;
  }
  .panel-header h2 { font-size: 18px; margin-bottom: 5px; color: white; }
  .panel-header p  { font-size: 13px; color: var(--text-dark-muted, #8F9CAE); margin: 0; }
  .control-row { display: flex; gap: 14px; margin-bottom: 20px; flex-wrap: wrap; align-items: flex-end; }
  .input-group { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 200px; }
  .input-label { font-size: 12px; color: var(--text-dark-muted, #8F9CAE); font-weight: 500; }
  .input-field {
    background-color: var(--bg-dark-app, #0f131a);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    color: white;
    border-radius: 7px;
    padding: 9px 13px;
    font-family: var(--font-sans);
    font-size: 13.5px;
    outline: none;
    transition: border-color 0.2s;
  }
  .input-field:focus { border-color: var(--accent-primary, #3B82F6); }
  .btn-accent {
    background-color: var(--accent-primary, #3B82F6);
    color: white; border: none; border-radius: 7px;
    padding: 9px 16px; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: background-color 0.2s, transform 0.1s;
    white-space: nowrap;
  }
  .btn-accent:hover { background-color: #2563EB; }
  .btn-secondary {
    background-color: transparent; color: var(--text-dark-primary, #fff);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 7px; padding: 9px 16px; font-size: 13px;
    font-weight: 600; cursor: pointer; transition: background-color 0.2s;
    white-space: nowrap;
  }
  .btn-secondary:hover { background-color: rgba(255,255,255,0.05); }

  /* ── Search ── */
  .vault-search-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-dark-app, #0f131a);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 8px;
    padding: 8px 14px;
    margin-bottom: 18px;
    transition: border-color 0.2s;
  }
  .vault-search-bar:focus-within { border-color: var(--accent-primary, #3B82F6); }
  .vault-search-input {
    background: transparent; border: none; outline: none;
    color: white; font-size: 13.5px; font-family: var(--font-sans); flex: 1;
    width: 100%;
  }
  .vault-search-input::placeholder { color: var(--text-dark-muted); }

  /* ── Table ── */
  .responsive-table-container { overflow-x: auto; width: 100%; border-radius: 8px; border: 1px solid var(--border-dark-subtle, #2C3241); }
  .premium-table { width: 100%; border-collapse: collapse; font-size: 13.5px; text-align: left; }
  .premium-table th { background-color: var(--bg-dark-sidebar, #121620); padding: 12px 16px; font-weight: 600; color: var(--text-dark-muted, #8F9CAE); border-bottom: 1px solid var(--border-dark-subtle, #2C3241); }
  .premium-table td { padding: 14px 16px; border-bottom: 1px solid var(--border-dark-subtle, #2C3241); vertical-align: middle; color: white; }
  .premium-table tr:hover td { background-color: rgba(255,255,255,0.02); }

  /* ── Card action buttons ── */
  .vault-card-actions { display: flex; gap: 7px; margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.04); }
  .vault-btn-view {
    flex: 1; padding: 7px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
    background: var(--accent-primary, #3B82F6); color: white; border: none; cursor: pointer;
    transition: background 0.15s; display: flex; align-items: center; justify-content: center; gap: 5px;
  }
  .vault-btn-view:hover { background: #2563EB; }
  .vault-btn-analyze {
    padding: 7px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
    background: transparent; color: var(--text-dark-muted, #8F9CAE);
    border: 1px solid var(--border-dark-subtle, #2C3241); cursor: pointer;
    transition: all 0.15s; display: flex; align-items: center; gap: 5px;
  }
  .vault-btn-analyze:hover { border-color: rgba(59,130,246,0.4); color: var(--accent-primary, #3B82F6); }

  /* ── Modal ── */
  .modal-overlay { position: fixed; inset: 0; background-color: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px); }
  .modal-card { background-color: var(--bg-dark-panel, #171c26); border: 1px solid var(--border-dark-subtle, #2C3241); border-radius: 12px; width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
  .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--border-dark-subtle, #2C3241); }
  .modal-body { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  .modal-footer { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--border-dark-subtle, #2C3241); }
  .form-row { display: flex; gap: 16px; }
  .form-row > * { flex: 1; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
`;

// Doc type → accent color
const DOC_TYPE_STYLES = {
  'Legal Document':   { bg: 'rgba(59,130,246,0.1)',  color: '#3B82F6' },
  'Contract':         { bg: 'rgba(16,185,129,0.1)',  color: '#10B981' },
  'FIR':              { bg: 'rgba(239,68,68,0.1)',   color: '#EF4444' },
  'Petition':         { bg: 'rgba(245,158,11,0.1)',  color: '#F59E0B' },
  'Draft':            { bg: 'rgba(139,92,246,0.1)',  color: '#8B5CF6' },
  'Agreement':        { bg: 'rgba(6,182,212,0.1)',   color: '#06B6D4' },
  'Judgment':         { bg: 'rgba(236,72,153,0.1)',  color: '#EC4899' },
};

function getDocTypeStyle(type) {
  if (!type) return DOC_TYPE_STYLES['Draft'];
  const key = Object.keys(DOC_TYPE_STYLES).find(k => type.toLowerCase().includes(k.toLowerCase()));
  return DOC_TYPE_STYLES[key] || { bg: 'rgba(59,130,246,0.08)', color: '#3B82F6' };
}

function formatDate(str) {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return str; }
}

export default function VaultView() {
  const [activeTab, setActiveTab] = useState('vault');

  // Document Vault
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docError, setDocError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const fileInputRef = useRef(null);

  // Case Tracker
  const [cases, setCases] = useState([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const [fetchCnr, setFetchCnr] = useState('');
  const [fetchingStatus, setFetchingStatus] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState('');

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [savingCase, setSavingCase] = useState(false);
  const [formData, setFormData] = useState({
    case_name: '', client_name: '', case_number: '', cnr_number: '',
    case_type: '', court: '', next_hearing: '', last_hearing: '', status: 'Active', notes: ''
  });

  const navigate = useNavigate();

  // ── Load docs ───────────────────────────────────────────────────────────────
  const loadDocuments = async () => {
    setLoadingDocs(true);
    setDocError(null);
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
      const response = await fetch(`${apiBase}/api/vault/documents`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err) {
      setDocError(err.message || 'Failed to fetch vault documents.');
    } finally {
      setLoadingDocs(false);
    }
  };

  const loadCases = async () => {
    setLoadingCases(true);
    const res = await fetchTrackedCases();
    if (!res.error) setCases(res);
    setLoadingCases(false);
  };

  useEffect(() => {
    if (activeTab === 'vault')   loadDocuments();
    if (activeTab === 'tracker') loadCases();
  }, [activeTab]);

  // ── File upload ─────────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    let file = null;
    if (e.dataTransfer?.files?.length > 0) { file = e.dataTransfer.files[0]; e.dataTransfer.clearData(); }
    else if (e.target?.files?.length > 0)   { file = e.target.files[0]; }
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) { alert('Invalid format. Upload PDF, DOCX, or TXT.'); return; }

    setUploading(true);
    const res = await uploadDocument(file, null, 'DMS Upload');
    setUploading(false);
    if (res.error) alert(res.message || 'Upload failed.');
    else loadDocuments();
  };

  // ── BUG FIX: navigate to DocumentViewer, not ContractAnalyzer ──────────────
  const handleViewDocument = (doc) => {
    // Case Vault docs live in the case_vault SQLite table (/api/vault/documents),
    // a separate store from the Document ORM model (/api/documents). Passing the full
    // doc payload as route state lets DocumentViewer render without hitting the wrong
    // API, which would return 404.
    navigate(`/case/vault/doc/${doc.id}`, {
      state: {
        fromVault: true,
        docData: {
          id: doc.id,
          filename: doc.title || doc.filename || 'Vault Document',
          summary: doc.doc_type
            ? `${doc.doc_type} — saved from Universal Agent`
            : 'Document saved from Universal Agent to Case Vault',
          text: doc.content || doc.text || '',
          tags: doc.tags || null,
          case_id: doc.case_id || null,
        },
      },
    });
  };

  const handleAnalyzeDocument = (doc) => {
    navigate('/analyzer', { state: { contractData: doc } });
  };

  // ── CNR fetch ───────────────────────────────────────────────────────────────
  const handleFetchStatus = async () => {
    if (!fetchCnr.trim()) return;
    setFetchingStatus(true);
    setFallbackUrl('');
    const res = await fetchCauselist(fetchCnr.trim());
    setFetchingStatus(false);
    if (res.error) { alert(res.message || 'Failed.'); }
    else if (res.source === 'fallback') { setFallbackUrl(res.fallback_url); }
    else {
      setFormData(p => ({ ...p, case_name: res.case_title || '', case_number: res.case_number || '', cnr_number: fetchCnr.trim(), court: res.court || '', next_hearing: res.next_hearing || '', status: res.status || 'Active' }));
      setIsModalOpen(true);
    }
  };

  const handleModalSave = async (e) => {
    e.preventDefault();
    if (!formData.case_name.trim()) { alert('Case Name is required.'); return; }
    setSavingCase(true);
    const res = await saveTrackedCase(formData);
    setSavingCase(false);
    if (res.error) { alert(res.message || 'Failed to save.'); }
    else {
      setIsModalOpen(false);
      setFormData({ case_name: '', client_name: '', case_number: '', cnr_number: '', case_type: '', court: '', next_hearing: '', last_hearing: '', status: 'Active', notes: '' });
      loadCases();
    }
  };

  // ── Filtered documents ──────────────────────────────────────────────────────
  const filteredDocs = documents.filter(doc => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (doc.title || '').toLowerCase().includes(term) ||
      (doc.doc_type || '').toLowerCase().includes(term) ||
      (doc.content || '').toLowerCase().includes(term)
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      <style>{vaultStyles}</style>

      {/* Header */}
      <div style={{ marginBottom: '22px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: '700', marginBottom: '5px' }}>Case Management</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13.5px', margin: 0 }}>
            Unified dashboard for your document vault and tracked caseload.
          </p>
        </div>
        {activeTab === 'vault' && (
          <button
            className="btn-accent"
            onClick={() => fileInputRef.current?.click()}
            style={{ display: 'flex', alignItems: 'center', gap: '7px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Upload Document
          </button>
        )}
        {activeTab === 'tracker' && (
          <button className="btn-accent" onClick={() => setIsModalOpen(true)}>+ Add Case</button>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs-wrapper">
        <button className={`tab-btn ${activeTab === 'vault' ? 'active' : ''}`} onClick={() => setActiveTab('vault')}>
          🗄️ Document Vault {documents.length > 0 && <span style={{ marginLeft: '6px', fontSize: '11px', background: 'rgba(59,130,246,0.15)', color: 'var(--accent-primary)', padding: '1px 6px', borderRadius: '8px' }}>{documents.length}</span>}
        </button>
        <button className={`tab-btn ${activeTab === 'tracker' ? 'active' : ''}`} onClick={() => setActiveTab('tracker')}>
          📋 Case Tracker {cases.length > 0 && <span style={{ marginLeft: '6px', fontSize: '11px', background: 'rgba(16,185,129,0.15)', color: '#10B981', padding: '1px 6px', borderRadius: '8px' }}>{cases.length}</span>}
        </button>
      </div>

      {/* ── DOCUMENT VAULT TAB ─────────────────────────────────────────────── */}
      {activeTab === 'vault' && (
        <div className="animate-fade-in">
          {docError && (
            <div style={{ color: '#EF4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', padding: '14px 16px', borderRadius: '8px', fontSize: '13.5px', marginBottom: '20px' }}>
              ⚠️ <strong>Failed to load documents:</strong> {docError}
              <button onClick={loadDocuments} style={{ marginLeft: '12px', background: 'transparent', border: 'none', color: '#EF4444', cursor: 'pointer', textDecoration: 'underline', fontSize: '13px' }}>Retry</button>
            </div>
          )}

          {/* Upload Dropzone */}
          <div
            className={`drag-drop-zone ${isDragOver ? 'dragover' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={e => { e.preventDefault(); setIsDragOver(false); handleFileUpload(e); }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            style={{ opacity: uploading ? 0.7 : 1, pointerEvents: uploading ? 'none' : 'auto' }}
          >
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".pdf,.docx,.txt" onChange={handleFileUpload} />
            {uploading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '26px', height: '26px', border: '3px solid var(--border-dark-subtle)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--accent-primary)' }}>Uploading & indexing into vector space...</span>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '26px', marginBottom: '10px' }}>📤</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: 'white', marginBottom: '5px' }}>Upload Document to Case Vault</div>
                <div style={{ fontSize: '13px', color: 'var(--text-dark-muted)' }}>Drag &amp; drop a PDF, DOCX, or TXT file here, or click to browse</div>
              </div>
            )}
          </div>

          {/* Search bar */}
          {!loadingDocs && documents.length > 0 && (
            <div className="vault-search-bar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dark-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                className="vault-search-input"
                type="text"
                placeholder="Search documents by name, type, or content…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1 }}>✕</button>
              )}
            </div>
          )}

          {/* Document Grid */}
          {loadingDocs ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '250px', gap: '14px' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid var(--border-subtle)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading vault documents…</span>
            </div>
          ) : !docError && (
            filteredDocs.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '180px', border: '1px dashed var(--border-dark-subtle)', borderRadius: '10px', padding: '32px', color: 'var(--text-dark-muted)', gap: '10px' }}>
                <span style={{ fontSize: '24px' }}>{searchTerm ? '🔍' : '🗄️'}</span>
                <span style={{ fontSize: '14px', fontWeight: '600', color: 'white' }}>
                  {searchTerm ? `No results for "${searchTerm}"` : 'No Documents in Vault'}
                </span>
                <span style={{ fontSize: '12px', opacity: 0.7 }}>
                  {searchTerm ? 'Try a different search term.' : 'Upload a document above to index it into the RAG database.'}
                </span>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(275px, 1fr))', gap: '16px' }}>
                {filteredDocs.map(doc => {
                  const typeStyle = getDocTypeStyle(doc.doc_type);
                  const caseName = doc.case_id ? `Case ${doc.case_id}` : 'General Vault';
                  return (
                    <div key={doc.id} className="vault-grid-card">
                      {/* Card header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <span style={{
                          fontSize: '10px', fontWeight: '700',
                          color: typeStyle.color,
                          background: typeStyle.bg,
                          padding: '2px 7px', borderRadius: '4px',
                          textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0,
                        }}>
                          {doc.doc_type || 'Document'}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {caseName}
                        </span>
                      </div>

                      {/* Title */}
                      <h3 style={{ fontSize: '14.5px', fontWeight: '600', color: 'white', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.title}>
                        {doc.title}
                      </h3>

                      {/* Content preview */}
                      <div className="vault-card-preview">{doc.content || 'No preview available.'}</div>

                      {/* Date */}
                      <div style={{ fontSize: '10.5px', color: 'var(--text-dark-muted)', opacity: 0.55 }}>
                        Created: {formatDate(doc.created_at)}
                      </div>

                      {/* Actions */}
                      <div className="vault-card-actions">
                        <button className="vault-btn-view" onClick={() => handleViewDocument(doc)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                          </svg>
                          View Document
                        </button>
                        <button className="vault-btn-analyze" onClick={() => handleAnalyzeDocument(doc)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                          </svg>
                          Analyze
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}

      {/* ── CASE TRACKER TAB ───────────────────────────────────────────────── */}
      {activeTab === 'tracker' && (
        <div className="dashboard-panel animate-fade-in">
          <div className="panel-header" style={{ marginBottom: '20px' }}>
            <h2>Tracked Caseload</h2>
            <p>Monitor your active matters and sync hearing dates via eCourts CNR.</p>
          </div>

          <div className="control-row">
            <div className="input-group" style={{ maxWidth: '340px' }}>
              <label className="input-label">Quick eCourts Lookup (CNR Number)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" className="input-field" placeholder="Enter 16-digit CNR…" style={{ flex: 1 }} value={fetchCnr} onChange={e => setFetchCnr(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleFetchStatus()} />
                <button className="btn-accent" onClick={handleFetchStatus} disabled={fetchingStatus}>
                  {fetchingStatus ? 'Fetching…' : 'Fetch Status'}
                </button>
              </div>
            </div>
          </div>

          {fallbackUrl && (
            <div style={{ padding: '14px 16px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', marginBottom: '20px' }}>
              <h4 style={{ color: '#F59E0B', marginBottom: '6px', fontSize: '13.5px', fontWeight: '600' }}>⚠️ eCourts Portal Busy</h4>
              <p style={{ color: 'var(--text-dark-muted)', fontSize: '13px', marginBottom: '10px' }}>The API is unresponsive. View the fallback URL directly.</p>
              <button className="btn-secondary" style={{ borderColor: '#F59E0B', color: '#F59E0B' }} onClick={() => { const b = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com'; window.open(`${b}/api/proxy?target_url=${encodeURIComponent(fallbackUrl)}`, '_blank'); }}>
                Open Fallback URL ↗
              </button>
            </div>
          )}

          {loadingCases ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dark-muted)' }}>Loading tracked cases…</div>
          ) : cases.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px', color: 'var(--text-dark-muted)' }}>
              <div style={{ fontSize: '22px', marginBottom: '8px' }}>📋</div>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>No Cases Tracked Yet</div>
              <div style={{ fontSize: '12px' }}>Fetch via CNR or click "Add Case" to add one manually.</div>
            </div>
          ) : (
            <div className="responsive-table-container">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Case Name</th>
                    <th>CNR / Case No.</th>
                    <th>Court</th>
                    <th>Client</th>
                    <th>Next Hearing</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: '500' }}>{c.case_name || c.title}</td>
                      <td>
                        <div style={{ fontSize: '12px', color: 'var(--text-dark-muted)', marginBottom: '2px' }}>{c.cnr_number || '—'}</div>
                        <div>{c.case_number || '—'}</div>
                      </td>
                      <td>{c.court || '—'}</td>
                      <td>{c.client_name || '—'}</td>
                      <td style={{ color: c.next_hearing_date ? '#F59E0B' : 'inherit' }}>{c.next_hearing_date || c.next_hearing || '—'}</td>
                      <td>
                        <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600', background: c.status === 'Active' ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.05)', color: c.status === 'Active' ? '#10B981' : 'var(--text-dark-muted)' }}>
                          {c.status || 'Unknown'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── ADD CASE MODAL ─────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card animate-fade-in">
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '17px', color: 'white' }}>Add / Edit Case</h3>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}>&times;</button>
            </div>
            <form onSubmit={handleModalSave}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group"><label className="input-label">Case Name *</label><input required type="text" className="input-field" value={formData.case_name} onChange={e => setFormData({...formData, case_name: e.target.value})} placeholder="e.g., State vs. John Doe" /></div>
                  <div className="form-group"><label className="input-label">Client Name</label><input type="text" className="input-field" value={formData.client_name} onChange={e => setFormData({...formData, client_name: e.target.value})} placeholder="Internal reference" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="input-label">Case Number</label><input type="text" className="input-field" value={formData.case_number} onChange={e => setFormData({...formData, case_number: e.target.value})} placeholder="e.g., CRA/123/2026" /></div>
                  <div className="form-group"><label className="input-label">CNR Number</label><input type="text" className="input-field" value={formData.cnr_number} onChange={e => setFormData({...formData, cnr_number: e.target.value})} placeholder="16-digit official ID" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="input-label">Case Type</label><input type="text" className="input-field" value={formData.case_type} onChange={e => setFormData({...formData, case_type: e.target.value})} placeholder="e.g., Civil, Criminal, IP" /></div>
                  <div className="form-group"><label className="input-label">Court</label><input type="text" className="input-field" value={formData.court} onChange={e => setFormData({...formData, court: e.target.value})} placeholder="e.g., Delhi High Court" /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="input-label">Next Hearing</label><input type="date" className="input-field" value={formData.next_hearing} onChange={e => setFormData({...formData, next_hearing: e.target.value})} /></div>
                  <div className="form-group"><label className="input-label">Last Hearing</label><input type="date" className="input-field" value={formData.last_hearing} onChange={e => setFormData({...formData, last_hearing: e.target.value})} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="input-label">Status</label>
                    <select className="input-field" value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})}>
                      <option value="Active">Active</option>
                      <option value="Disposed">Disposed</option>
                      <option value="Pending Filing">Pending Filing</option>
                    </select>
                  </div>
                </div>
                <div className="form-group"><label className="input-label">Notes</label><textarea className="input-field" rows="3" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Strategy notes or updates…" style={{ resize: 'none' }}></textarea></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn-accent" disabled={savingCase}>{savingCase ? 'Saving…' : 'Save Case'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
