import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchDocuments, uploadDocument, deleteDocument } from '../services/api';
import { getSharedFiles, subscribeSharedFiles } from '../utils/sharedWorkspaceStore';

const styles = `
  .upload-zone {
    border: 2px dashed var(--border-dark-subtle);
    background-color: var(--bg-dark-panel);
    border-radius: 8px;
    padding: 30px;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
  }
  .upload-zone.dragover {
    border-color: var(--accent-primary);
    background-color: rgba(59, 130, 246, 0.05);
  }
  .doc-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 20px;
    font-size: 14px;
  }
  .doc-table th {
    text-align: left;
    padding: 12px 16px;
    border-bottom: 2px solid var(--border-dark-subtle);
    color: var(--text-dark-muted);
    font-weight: 600;
  }
  .doc-table td {
    padding: 16px;
    border-bottom: 1px solid var(--border-dark-subtle);
    vertical-align: middle;
  }
  .doc-row:hover {
    background-color: rgba(255, 255, 255, 0.02);
  }
  .doc-link {
    color: var(--text-dark-primary);
    text-decoration: none;
    font-weight: 500;
    transition: color 0.2s;
  }
  .doc-link:hover {
    color: var(--accent-primary);
  }
  .trash-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-dark-muted);
    padding: 6px;
    border-radius: 4px;
    transition: all 0.2s;
  }
  .trash-btn:hover {
    color: var(--accent-danger);
    background-color: rgba(239, 68, 68, 0.1);
  }
  .spinner-animation {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: white;
    animation: spin 0.8s linear infinite;
    margin-right: 8px;
    vertical-align: middle;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Dynamic Citation Manager ── */
  .lx-citation-row td {
    background: rgba(255,255,255,0.015);
    padding: 0;
    border-bottom: 1px solid var(--border-dark-subtle);
  }
  .lx-citation-manager { padding: 18px 20px; }
  .lx-citation-manager-title {
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-dark-primary); margin-bottom: 12px; display: flex; align-items: center; gap: 7px;
  }
  .lx-citation-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .lx-citation-badge {
    display: inline-flex; align-items: center; gap: 7px;
    background: rgba(59,130,246,0.1); border: 1px solid rgba(59,130,246,0.28);
    color: var(--text-dark-primary); font-size: 12.5px; font-weight: 500;
    padding: 6px 8px 6px 12px; border-radius: 20px;
  }
  .lx-citation-badge-remove {
    background: rgba(255,255,255,0.08); border: none; color: var(--text-dark-muted);
    width: 18px; height: 18px; border-radius: 50%; cursor: pointer;
    display: flex; align-items: center; justify-content: center; font-size: 13px; line-height: 1;
    transition: background 0.15s, color 0.15s;
  }
  .lx-citation-badge-remove:hover { background: var(--accent-danger); color: white; }
  .lx-citation-empty { font-size: 12.5px; color: var(--text-dark-muted); font-style: italic; margin-bottom: 12px; }
  .lx-citation-search-wrap { position: relative; max-width: 360px; }
  .lx-citation-search-input {
    width: 100%; box-sizing: border-box; padding: 9px 12px;
    background: var(--bg-dark-app); border: 1px solid var(--border-dark-subtle);
    border-radius: 7px; color: var(--text-dark-primary); font-size: 13px;
  }
  .lx-citation-search-input:focus { outline: none; border-color: var(--accent-primary); }
  .lx-citation-dropdown {
    position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 20;
    background: var(--bg-dark-panel); border: 1px solid var(--border-dark-subtle);
    border-radius: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.35);
    max-height: 200px; overflow-y: auto;
  }
  .lx-citation-dropdown-item {
    width: 100%; text-align: left; background: none; border: none; cursor: pointer;
    padding: 9px 12px; font-size: 13px; color: var(--text-dark-primary);
    border-bottom: 1px solid var(--border-dark-subtle);
  }
  .lx-citation-dropdown-item:last-child { border-bottom: none; }
  .lx-citation-dropdown-item:hover { background: rgba(59,130,246,0.1); }
  .lx-citation-dropdown-empty { padding: 10px 12px; font-size: 12.5px; color: var(--text-dark-muted); font-style: italic; }
  .lx-citation-toggle-btn {
    background: transparent; border: none; cursor: pointer;
    color: var(--text-dark-muted); padding: 6px; border-radius: 4px; transition: all 0.2s;
  }
  .lx-citation-toggle-btn:hover, .lx-citation-toggle-btn.active { color: var(--accent-primary); background: rgba(59,130,246,0.1); }
`;

export default function CaseVault() {
  const { caseId } = useParams();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [notification, setNotification] = useState(null);

  const [sharedFiles, setSharedFiles] = useState(() => getSharedFiles().filter(f => f.modules?.includes('case-vault')));

  useEffect(() => {
    return subscribeSharedFiles(all => setSharedFiles(all.filter(f => f.modules?.includes('case-vault'))));
  }, []);

  const fileInputRef = useRef(null);

  // ── Dynamic Citation Manager (per-row expand) ───────────────────────────
  const [expandedCitationDocId, setExpandedCitationDocId] = useState(null);
  const [citationsByDoc, setCitationsByDoc] = useState({}); // docId -> [{id, title}]
  const [citationSearchQuery, setCitationSearchQuery] = useState('');
  const [citationSearchResults, setCitationSearchResults] = useState([]);
  const [citationSearchLoading, setCitationSearchLoading] = useState(false);
  const [citationDropdownOpen, setCitationDropdownOpen] = useState(false);

  const toggleCitationRow = (docId) => {
    setCitationSearchQuery('');
    setCitationSearchResults([]);
    setCitationDropdownOpen(false);
    setExpandedCitationDocId(prev => (prev === docId ? null : docId));
  };

  useEffect(() => {
    if (citationSearchQuery.trim().length < 2) { setCitationSearchResults([]); setCitationSearchLoading(false); return; }
    setCitationSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/cases/autocomplete?q=${encodeURIComponent(citationSearchQuery.trim())}`);
        const data = await res.json();
        setCitationSearchResults(Array.isArray(data) ? data : []);
      } catch { setCitationSearchResults([]); }
      finally { setCitationSearchLoading(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [citationSearchQuery]);

  const addCitation = async (docId, result) => {
    try {
      const res = await fetch(`http://localhost:5000/api/vault/documents/${docId}/citations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: String(result.id), title: result.title }),
      });
      const data = await res.json();
      if (data.citations) setCitationsByDoc(prev => ({ ...prev, [docId]: data.citations }));
    } catch { /* leave badges as-is on failure */ }
    setCitationSearchQuery('');
    setCitationSearchResults([]);
    setCitationDropdownOpen(false);
  };

  const removeCitation = async (docId, citationId) => {
    try {
      const res = await fetch(`http://localhost:5000/api/vault/documents/${docId}/citations/${encodeURIComponent(citationId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.citations) setCitationsByDoc(prev => ({ ...prev, [docId]: data.citations }));
    } catch { /* leave badges as-is on failure */ }
  };

  // ── 1. LOAD VAULT DOCUMENTS ───────────────────────────────────────────
  const loadVault = async () => {
    setLoading(true);
    const data = await fetchDocuments(caseId);
    if (data.error) {
      showNotice(data.message, 'danger');
      setDocuments([]);
    } else {
      setDocuments(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadVault();
  }, [caseId]);

  // ── 2. NOTIFICATION HELPER ───────────────────────────────────────────
  const showNotice = (msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => {
      setNotification(null);
    }, 4000);
  };

  // ── 3. UPLOAD & INGESTION HANDLERS ────────────────────────────────────
  const handleFileUpload = async (files) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    
    // Type limits
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    const extension = file.name.split('.').pop().toLowerCase();
    
    if (!allowed.includes(file.type) && !['pdf', 'docx', 'txt'].includes(extension)) {
      showNotice('Invalid format. Please upload PDF, DOCX, or plain text.', 'danger');
      return;
    }

    setUploading(true);
    setUploadStatus('Extracting text and generating AI vectors...');

    const response = await uploadDocument(file, caseId, 'case_vault');

    setUploading(false);
    setUploadStatus('');

    if (response.error) {
      showNotice(response.message, 'danger');
    } else {
      showNotice(`Successfully indexed "${file.name}" into ${response.document.chunks_indexed} RAG nodes.`);
      // Reload documents to display the new item
      loadVault();
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
    if (!uploading) setIsDragOver(true);
  };

  const onDragLeave = () => {
    setIsDragOver(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!uploading && e.dataTransfer.files) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // ── 4. DELETE CONTROLLER ──────────────────────────────────────────────
  const handleDelete = async (docId, filename) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${filename}"? All associated RAG vector chunks will be wiped.`)) {
       return;
    }

    const response = await deleteDocument(docId);
    if (response.error) {
      showNotice(response.message, 'danger');
    } else {
      showNotice(`Deleted "${filename}" successfully.`);
      setDocuments(prev => prev.filter(d => d.id !== docId));
    }
  };

  return (
    <>
      <style>{styles}</style>
      <div style={{ padding: '24px', position: 'relative' }}>
        
        {/* Notification Banner */}
        {notification && (
          <div style={{
            position: 'absolute',
            top: '20px',
            right: '24px',
            background: notification.type === 'danger' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(16, 185, 129, 0.95)',
            color: 'white',
            padding: '10px 18px',
            borderRadius: '6px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            fontSize: '13px',
            fontWeight: '500'
          }}>
            {notification.msg}
          </div>
        )}

        {/* Back Link */}
        <div style={{ marginBottom: '16px' }}>
          <Link to="/dashboard" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '13px' }}>
            ← Back to Advocate Terminal
          </Link>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '28px', margin: 0 }}>Case Vault Directory</h1>
          <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>Case Context ID: {caseId}</span>
        </div>

        {/* Upload Zone */}
        <div 
          className={`upload-zone ${isDragOver ? 'dragover' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
          style={{ opacity: uploading ? 0.7 : 1, pointerEvents: uploading ? 'none' : 'auto' }}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }}
            onChange={e => handleFileUpload(e.target.files)}
            accept=".pdf,.docx,.txt"
            disabled={uploading}
          />
          
          {uploading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div>
                <span className="spinner-animation"></span>
                <span style={{ fontSize: '15px', fontWeight: '500', color: 'white' }}>{uploadStatus}</span>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>This may take up to 10 seconds for dense files...</span>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>📤</div>
              <h3 style={{ fontSize: '16px', color: 'white', marginBottom: '4px' }}>Drag & Drop Case File Here</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-dark-muted)' }}>
                Supports <strong style={{ color: 'white' }}>PDF, DOCX, or TXT</strong>. File is processed instantly into vector space.
              </p>
            </div>
          )}
        </div>

        {/* Shared Workspace Files */}
        {sharedFiles.length > 0 && (
          <div style={{ marginTop: '20px', background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#A78BFA', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Shared from Platform — {sharedFiles.length} file{sharedFiles.length !== 1 ? 's' : ''}</span>
            </div>
            {sharedFiles.map(f => (
              <div key={f.id} style={{ padding: '12px 18px', borderBottom: '1px solid rgba(139,92,246,0.1)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dark-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span style={{ fontSize: '13px', color: 'var(--text-dark-primary)', fontWeight: 500, flex: 1 }}>{f.filename}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>{f.source}</span>
                <span style={{ fontSize: '10.5px', color: 'var(--text-dark-muted)' }}>{new Date(f.savedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* Documents Vault List */}
        <div style={{ marginTop: '30px', background: 'var(--bg-dark-panel)', borderRadius: '8px', border: '1px solid var(--border-dark-subtle)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-dark-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '16px', margin: 0 }}>Stored Vault Artifacts</h3>
            <button onClick={loadVault} style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '12px' }}>
              🔄 Refresh List
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '40px', textAlignment: 'center', color: 'var(--text-dark-muted)', fontSize: '14px', fontStyle: 'italic', textAlign: 'center' }}>
              Loading Case Vault files...
            </div>
          ) : documents.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dark-muted)', fontSize: '13px' }}>
              No document indices in this case yet. Drop or select a legal brief above to seed the RAG chatbot database.
            </div>
          ) : (
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Document Name</th>
                  <th>Format</th>
                  <th>Executive Summary</th>
                  <th style={{ width: '80px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                <React.Fragment key={doc.id}>
                  <tr className="doc-row">
                    <td>
                      <Link to={`/case/${caseId}/doc/${doc.id}`} className="doc-link">
                        📄 {doc.filename}
                      </Link>
                    </td>
                    <td>
                      <span style={{ fontSize: '11px', textTransform: 'uppercase', background: 'var(--bg-dark-app)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-dark-subtle)', color: 'white' }}>
                        {doc.filetype}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-dark-muted)', fontFamily: 'var(--font-sans)', lineHeight: '1.4', fontSize: '13px' }}>
                      {doc.summary || "Summary generation pending..."}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className={`lx-citation-toggle-btn${expandedCitationDocId === doc.id ? ' active' : ''}`}
                        onClick={() => toggleCitationRow(doc.id)}
                        title="Manage citations"
                      >
                        🔗
                      </button>
                      <button
                        className="trash-btn"
                        onClick={() => handleDelete(doc.id, doc.filename)}
                        title="Delete document and erase matching vector space"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                  {expandedCitationDocId === doc.id && (
                    <tr className="lx-citation-row">
                      <td colSpan={4}>
                        <div className="lx-citation-manager">
                          <div className="lx-citation-manager-title">🔗 Cited Cases — {doc.filename}</div>

                          {(citationsByDoc[doc.id] || []).length > 0 ? (
                            <div className="lx-citation-badges">
                              {citationsByDoc[doc.id].map(c => (
                                <span key={c.id} className="lx-citation-badge">
                                  {c.title}
                                  <button
                                    type="button"
                                    className="lx-citation-badge-remove"
                                    onClick={() => removeCitation(doc.id, c.id)}
                                    aria-label={`Remove citation ${c.title}`}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="lx-citation-empty">No cases cited yet.</div>
                          )}

                          <div className="lx-citation-search-wrap">
                            <input
                              type="text"
                              className="lx-citation-search-input"
                              placeholder="Search Firm Library cases to cite…"
                              value={citationSearchQuery}
                              onChange={e => { setCitationSearchQuery(e.target.value); setCitationDropdownOpen(true); }}
                              onFocus={() => setCitationDropdownOpen(true)}
                              onBlur={() => setTimeout(() => setCitationDropdownOpen(false), 150)}
                            />
                            {citationDropdownOpen && citationSearchQuery.trim().length >= 2 && (
                              <div className="lx-citation-dropdown">
                                {citationSearchLoading ? (
                                  <div className="lx-citation-dropdown-empty">Searching…</div>
                                ) : citationSearchResults.length > 0 ? (
                                  citationSearchResults.map(r => (
                                    <button
                                      key={r.id}
                                      type="button"
                                      className="lx-citation-dropdown-item"
                                      onMouseDown={() => addCitation(doc.id, r)}
                                    >
                                      {r.title}
                                    </button>
                                  ))
                                ) : (
                                  <div className="lx-citation-dropdown-empty">No matching cases found.</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
