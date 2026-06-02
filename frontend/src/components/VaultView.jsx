import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadDocument, fetchTrackedCases, saveTrackedCase, fetchCauselist } from '../services/api';

const vaultStyles = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .animate-fade-in {
    animation: fadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .vault-grid-card {
    background-color: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 8px;
    padding: 16px;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: relative;
    overflow: hidden;
  }
  .vault-grid-card:hover {
    transform: translateY(-4px);
    border-color: var(--accent-primary, #3B82F6);
    box-shadow: 0 8px 24px rgba(59, 130, 246, 0.12), inset 0 0 0 1px rgba(59, 130, 246, 0.1);
    background-color: rgba(59, 130, 246, 0.01);
  }
  .vault-card-preview {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-dark-muted, #8F9CAE);
    opacity: 0.65;
    font-family: monospace;
    background: rgba(255, 255, 255, 0.01);
    padding: 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.03);
  }
  .drag-drop-zone {
    border: 2px dashed var(--border-dark-subtle, #2C3241);
    background-color: var(--bg-dark-app, #0f131a);
    border-radius: 10px;
    padding: 30px 20px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.2s, background-color 0.2s;
    margin-bottom: 24px;
  }
  .drag-drop-zone:hover, .drag-drop-zone.dragover {
    border-color: var(--accent-primary, #3B82F6);
    background-color: rgba(59, 130, 246, 0.03);
  }

  /* Tabs Navigation */
  .tabs-wrapper {
    display: flex;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
    margin-bottom: 24px;
    gap: 8px;
    padding-bottom: 4px;
  }
  .tab-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted, #8F9CAE);
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    white-space: nowrap;
    transition: all 0.2s;
  }
  .tab-btn:hover {
    color: var(--text-dark-primary, #ffffff);
    background-color: rgba(255, 255, 255, 0.04);
  }
  .tab-btn.active {
    color: var(--accent-primary, #3B82F6);
    background-color: rgba(59, 130, 246, 0.1);
    font-weight: 600;
  }

  /* Dashboard Panel */
  .dashboard-panel {
    background-color: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
  }
  .panel-header {
    margin-bottom: 20px;
  }
  .panel-header h2 {
    font-size: 20px;
    margin-bottom: 6px;
    color: white;
  }
  .panel-header p {
    font-size: 13px;
    color: var(--text-dark-muted, #8F9CAE);
  }

  /* Controls */
  .control-row {
    display: flex;
    gap: 16px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    align-items: flex-end;
  }
  .input-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex: 1;
    min-width: 200px;
  }
  .input-label {
    font-size: 12px;
    color: var(--text-dark-muted, #8F9CAE);
    font-weight: 500;
  }
  .input-field {
    background-color: var(--bg-dark-app, #0f131a);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    color: white;
    border-radius: 6px;
    padding: 10px 14px;
    font-family: var(--font-sans);
    font-size: 13.5px;
    outline: none;
    transition: border-color 0.2s;
  }
  .input-field:focus {
    border-color: var(--accent-primary, #3B82F6);
  }

  /* Buttons */
  .btn-accent {
    background-color: var(--accent-primary, #3B82F6);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.1s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s;
    white-space: nowrap;
  }
  .btn-accent:hover {
    background-color: #2563EB;
  }
  .btn-secondary {
    background-color: transparent;
    color: var(--text-dark-primary, #ffffff);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 6px;
    padding: 10px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  .btn-secondary:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }

  /* Table */
  .responsive-table-container {
    overflow-x: auto;
    width: 100%;
    border-radius: 8px;
    border: 1px solid var(--border-dark-subtle, #2C3241);
  }
  .premium-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
    text-align: left;
  }
  .premium-table th {
    background-color: var(--bg-dark-sidebar, #121620);
    padding: 12px 16px;
    font-weight: 600;
    color: var(--text-dark-muted, #8F9CAE);
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
  }
  .premium-table td {
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
    vertical-align: middle;
    color: white;
  }
  .premium-table tr:hover {
    background-color: rgba(255, 255, 255, 0.02);
  }

  /* Modal Overlay */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.7);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    backdrop-filter: blur(4px);
  }
  .modal-card {
    background-color: var(--bg-dark-panel, #171c26);
    border: 1px solid var(--border-dark-subtle, #2C3241);
    border-radius: 12px;
    width: 100%;
    max-width: 600px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-dark-subtle, #2C3241);
  }
  .modal-body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 24px;
    border-top: 1px solid var(--border-dark-subtle, #2C3241);
  }
  .form-row {
    display: flex;
    gap: 16px;
  }
  .form-row > * {
    flex: 1;
  }
`;

export default function VaultView() {
  const [activeTab, setActiveTab] = useState('vault');

  // Document Vault States
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docError, setDocError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Case Tracker States
  const [cases, setCases] = useState([]);
  const [loadingCases, setLoadingCases] = useState(false);
  const [fetchCnr, setFetchCnr] = useState('');
  const [fetchingStatus, setFetchingStatus] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState('');

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [savingCase, setSavingCase] = useState(false);
  const [formData, setFormData] = useState({
    case_name: '',
    client_name: '',
    case_number: '',
    cnr_number: '',
    case_type: '',
    court: '',
    next_hearing: '',
    last_hearing: '',
    status: 'Active',
    notes: ''
  });

  const Maps = useNavigate();

  // ─────────────────────────────────────────────────────────────────────────────
  // INIT & LOAD DATA
  // ─────────────────────────────────────────────────────────────────────────────
  const loadDocuments = async () => {
    try {
      const response = await fetch('https://lexamplify-backend.onrender.com/api/vault/documents');
      if (!response.ok) {
        throw new Error(`HTTP error: status ${response.status}`);
      }
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err) {
      console.error(err);
      setDocError(err.message || 'Failed to fetch vault documents.');
    } finally {
      setLoadingDocs(false);
    }
  };

  const loadCases = async () => {
    setLoadingCases(true);
    const res = await fetchTrackedCases();
    if (!res.error) {
      setCases(res);
    }
    setLoadingCases(false);
  };

  useEffect(() => {
    if (activeTab === 'vault') {
      loadDocuments();
    } else if (activeTab === 'tracker') {
      loadCases();
    }
  }, [activeTab]);

  // ─────────────────────────────────────────────────────────────────────────────
  // VAULT ACTIONS
  // ─────────────────────────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    let file = null;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      file = e.dataTransfer.files[0];
      e.dataTransfer.clearData();
    } else if (e.target.files && e.target.files.length > 0) {
      file = e.target.files[0];
    }
    if (!file) return;

    const extension = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(extension)) {
      alert('Invalid format. Please upload PDF, DOCX, or TXT.');
      return;
    }

    setUploading(true);
    const res = await uploadDocument(file, null, 'DMS Upload');
    setUploading(false);

    if (res.error) {
      alert(res.message || 'Upload failed.');
    } else {
      loadDocuments();
    }
  };

  const handleCardClick = (doc) => {
    Maps('/analyzer', { state: { contractData: doc } });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // CMS ACTIONS
  // ─────────────────────────────────────────────────────────────────────────────
  const handleFetchStatus = async () => {
    if (!fetchCnr.trim()) return;
    setFetchingStatus(true);
    setFallbackUrl('');
    const res = await fetchCauselist(fetchCnr.trim());
    setFetchingStatus(false);

    if (res.error) {
      alert(res.message || 'Failed to fetch case details.');
    } else if (res.source === 'fallback') {
      setFallbackUrl(res.fallback_url);
    } else {
      // Auto-populate the modal and open it so user can save the fetched case
      setFormData(prev => ({
        ...prev,
        case_name: res.case_title || '',
        case_number: res.case_number || '',
        cnr_number: fetchCnr.trim(),
        court: res.court || '',
        next_hearing: res.next_hearing || '',
        status: res.status || 'Active'
      }));
      setIsModalOpen(true);
    }
  };

  const handleModalSave = async (e) => {
    e.preventDefault();
    if (!formData.case_name.trim()) {
      alert("Case Name is required.");
      return;
    }
    setSavingCase(true);
    const res = await saveTrackedCase(formData);
    setSavingCase(false);
    
    if (res.error) {
      alert(res.message || "Failed to save case.");
    } else {
      setIsModalOpen(false);
      // Reset form
      setFormData({
        case_name: '', client_name: '', case_number: '', cnr_number: '',
        case_type: '', court: '', next_hearing: '', last_hearing: '',
        status: 'Active', notes: ''
      });
      loadCases(); // Refresh grid
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      <style>{vaultStyles}</style>

      {/* Header section */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '6px' }}>Case Management</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Unified dashboard for your document vault and tracked caseload.
          </p>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="tabs-wrapper">
        <button 
          className={`tab-btn ${activeTab === 'vault' ? 'active' : ''}`} 
          onClick={() => setActiveTab('vault')}
        >
          🗄️ Document Vault
        </button>
        <button 
          className={`tab-btn ${activeTab === 'tracker' ? 'active' : ''}`} 
          onClick={() => setActiveTab('tracker')}
        >
          📋 Case Tracker
        </button>
      </div>

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* TAB: DOCUMENT VAULT */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      {activeTab === 'vault' && (
        <div className="animate-fade-in">
          {docError && (
            <div style={{ color: 'var(--accent-danger)', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '16px', borderRadius: '8px', fontSize: '14px', marginBottom: '24px' }}>
              ⚠️ <strong>Failed to load Case Vault:</strong> {docError}
            </div>
          )}

          {/* Upload Dropzone */}
          <div 
            className={`drag-drop-zone ${isDragOver ? 'dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); handleFileUpload(e); }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              accept=".pdf,.docx,.txt"
              onChange={handleFileUpload} 
            />
            {uploading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '24px', height: '24px', border: '3px solid var(--border-dark-subtle)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '14px', color: 'var(--accent-primary)' }}>Uploading & Extracting...</span>
              </div>
            ) : (
              <div>
                <span style={{ fontSize: '28px', display: 'block', marginBottom: '12px' }}>📤</span>
                <span style={{ fontSize: '15px', fontWeight: '600', color: 'white', display: 'block' }}>Upload Document to Case Vault</span>
                <span style={{ fontSize: '13px', color: 'var(--text-dark-muted)', marginTop: '6px', display: 'block' }}>Drag & drop a PDF, DOCX, or TXT file here, or click to browse</span>
              </div>
            )}
          </div>

          {/* Vault Grid */}
          {loadingDocs ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px' }}>
              <div style={{ width: '32px', height: '32px', border: '3px solid var(--border-subtle)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading vault documents...</span>
            </div>
          ) : !docError && (
            <>
              {documents.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px', padding: '32px', color: 'var(--text-dark-muted)' }}>
                  <span style={{ fontSize: '24px', marginBottom: '8px' }}>🗄️</span>
                  <span style={{ fontSize: '14px', fontWeight: '600' }}>No Documents in Vault</span>
                  <span style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>Use the dropzone above to index documents securely.</span>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                  {documents.map((doc) => (
                    <div key={doc.id} className="vault-grid-card" onClick={() => handleCardClick(doc)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', color: 'var(--accent-primary)', background: 'rgba(59, 130, 246, 0.08)', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>
                          {doc.doc_type || 'Draft'}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', opacity: 0.65 }}>
                          Case: {doc.case_id || '—'}
                        </span>
                      </div>
                      <h3 style={{ fontSize: '15px', fontWeight: '600', color: 'white', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.title}>
                        {doc.title}
                      </h3>
                      <div className="vault-card-preview">{doc.content}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-dark-muted)', opacity: 0.5 }}>
                          Created: {new Date(doc.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--accent-primary)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          Analyze ➜
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* TAB: CASE TRACKER */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      {activeTab === 'tracker' && (
        <div className="dashboard-panel animate-fade-in">
          <div className="panel-header">
            <h2>Tracked Caseload</h2>
            <p>Monitor your active matters and sync hearing dates.</p>
          </div>

          <div className="control-row">
            <div className="input-group" style={{ maxWidth: '320px' }}>
              <label className="input-label">Quick eCourts Fetch (CNR)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="Enter 16-digit CNR..." 
                  style={{ flex: 1 }}
                  value={fetchCnr}
                  onChange={(e) => setFetchCnr(e.target.value)}
                />
                <button 
                  className="btn-accent" 
                  onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
                  onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onClick={handleFetchStatus}
                  disabled={fetchingStatus}
                >
                  {fetchingStatus ? 'Wait...' : 'Fetch Status'}
                </button>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <button 
              className="btn-secondary"
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onClick={() => setIsModalOpen(true)}
            >
              + Add Case Manually
            </button>
          </div>

          {fallbackUrl && (
            <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: 'rgba(239, 160, 68, 0.1)', border: '1px solid rgba(239, 160, 68, 0.3)', marginBottom: '20px' }}>
              <h4 style={{ color: 'var(--accent-warning)', marginBottom: '8px', fontSize: '14px' }}>⚠️ eCourts Portal Busy</h4>
              <p style={{ color: 'var(--text-dark-muted)', fontSize: '13px', marginBottom: '12px' }}>
                The official eCourts API is unresponsive. Click below to view the fallback URL directly.
              </p>
              <button 
                className="btn-accent" 
                style={{ backgroundColor: 'transparent', border: '1px solid var(--accent-warning)', color: 'var(--accent-warning)' }}
                onClick={() => {
                  const apiBase = import.meta.env.VITE_API_BASE_URL || 'https://lexamplify-backend.onrender.com';
                  window.open(`${apiBase}/api/proxy?target_url=${encodeURIComponent(fallbackUrl)}`, '_blank', 'width=1024,height=768');
                }}
              >
                Open Fallback URL ↗
              </button>
            </div>
          )}

          {loadingCases ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dark-muted)' }}>Loading cases...</div>
          ) : cases.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px', color: 'var(--text-dark-muted)' }}>
              No cases tracked yet. Fetch via CNR or add one manually.
            </div>
          ) : (
            <div className="responsive-table-container">
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Case Name</th>
                    <th>CNR / Case Number</th>
                    <th>Court</th>
                    <th>Client</th>
                    <th>Next Hearing</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: '500' }}>{c.case_name || c.title}</td>
                      <td>
                        <div style={{ fontSize: '12px', color: 'var(--text-dark-muted)', marginBottom: '4px' }}>{c.cnr_number || '—'}</div>
                        <div>{c.case_number || '—'}</div>
                      </td>
                      <td>{c.court || '—'}</td>
                      <td>{c.client_name || '—'}</td>
                      <td style={{ color: c.next_hearing_date ? 'var(--accent-warning)' : 'inherit' }}>
                        {c.next_hearing_date || c.next_hearing || '—'}
                      </td>
                      <td>
                        <span style={{ 
                          padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                          backgroundColor: c.status === 'Active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.05)',
                          color: c.status === 'Active' ? 'var(--accent-success)' : 'var(--text-dark-muted)'
                        }}>
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

      {/* ───────────────────────────────────────────────────────────────────── */}
      {/* MODAL: ADD CASE MANUALLY */}
      {/* ───────────────────────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card animate-fade-in">
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '18px', color: 'white' }}>Add / Edit Case</h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dark-muted)', cursor: 'pointer', fontSize: '20px' }}
              >
                &times;
              </button>
            </div>
            
            <form onSubmit={handleModalSave}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Case Name *</label>
                    <input required type="text" className="input-field" value={formData.case_name} onChange={(e) => setFormData({...formData, case_name: e.target.value})} placeholder="e.g., State vs. John Doe" />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Client Name</label>
                    <input type="text" className="input-field" value={formData.client_name} onChange={(e) => setFormData({...formData, client_name: e.target.value})} placeholder="Internal client reference" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Case Number</label>
                    <input type="text" className="input-field" value={formData.case_number} onChange={(e) => setFormData({...formData, case_number: e.target.value})} placeholder="e.g., CRA/123/2026" />
                  </div>
                  <div className="form-group">
                    <label className="input-label">CNR Number</label>
                    <input type="text" className="input-field" value={formData.cnr_number} onChange={(e) => setFormData({...formData, cnr_number: e.target.value})} placeholder="16-digit official ID" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Case Type</label>
                    <input type="text" className="input-field" value={formData.case_type} onChange={(e) => setFormData({...formData, case_type: e.target.value})} placeholder="e.g., Civil, Criminal, IP" />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Court</label>
                    <input type="text" className="input-field" value={formData.court} onChange={(e) => setFormData({...formData, court: e.target.value})} placeholder="e.g., Delhi High Court" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="input-label">Next Hearing</label>
                    <input type="date" className="input-field" value={formData.next_hearing} onChange={(e) => setFormData({...formData, next_hearing: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="input-label">Last Hearing</label>
                    <input type="date" className="input-field" value={formData.last_hearing} onChange={(e) => setFormData({...formData, last_hearing: e.target.value})} />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="input-label">Status</label>
                    <select className="input-field" value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})}>
                      <option value="Active">Active</option>
                      <option value="Disposed">Disposed</option>
                      <option value="Pending Filing">Pending Filing</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="input-label">Notes</label>
                  <textarea 
                    className="input-field" 
                    rows="3" 
                    value={formData.notes} 
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    placeholder="Strategy notes or updates..."
                    style={{ resize: 'none' }}
                  ></textarea>
                </div>
              </div>
              
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn-secondary" 
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-accent"
                  onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.98)'}
                  onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  disabled={savingCase}
                >
                  {savingCase ? 'Saving...' : 'Save Case'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
