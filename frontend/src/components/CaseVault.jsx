import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchDocuments, uploadDocument, deleteDocument } from '../services/api';

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
`;

export default function CaseVault() {
  const { caseId } = useParams();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [notification, setNotification] = useState(null);

  const fileInputRef = useRef(null);

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
                  <tr key={doc.id} className="doc-row">
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
                        className="trash-btn" 
                        onClick={() => handleDelete(doc.id, doc.filename)}
                        title="Delete document and erase matching vector space"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
