import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

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
`;

export default function VaultView() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const Maps = useNavigate();

  const loadDocuments = async () => {
    try {
      const response = await fetch('http://127.0.0.1:5000/api/vault/documents');
      if (!response.ok) {
        throw new Error(`HTTP error: status ${response.status}`);
      }
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to fetch vault documents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  const handleCardClick = (doc) => {
    Maps('/analyzer', { state: { contractData: doc } });
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)' }}>
      <style>{vaultStyles}</style>

      {/* Header section */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '6px' }}>Case Vault Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Browse generated drafts and click on any document card to push it directly to the Contract Analyzer.
          </p>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', border: '3px solid var(--border-subtle)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading vault documents...</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ color: 'var(--accent-danger)', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '16px', borderRadius: '8px', fontSize: '14px', marginBottom: '24px' }}>
          ⚠️ <strong>Failed to load Case Vault:</strong> {error}
        </div>
      )}

      {/* Vault Grid */}
      {!loading && !error && (
        <>
          {documents.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', border: '1px dashed var(--border-dark-subtle)', borderRadius: '8px', padding: '32px', color: 'var(--text-dark-muted, #8F9CAE)' }}>
              <span style={{ fontSize: '24px', marginBottom: '8px' }}>🗄️</span>
              <span style={{ fontSize: '14px', fontWeight: '600' }}>No Documents in Vault</span>
              <span style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>Use the Universal Agent chat console to draft legal documents first.</span>
            </div>
          ) : (
            <div 
              className="animate-fade-in"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '20px'
              }}
            >
              {documents.map((doc) => (
                <div 
                  key={doc.id}
                  className="vault-grid-card"
                  onClick={() => handleCardClick(doc)}
                >
                  {/* Card Header info */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span 
                      style={{ 
                        fontSize: '10px', 
                        fontWeight: '700', 
                        color: 'var(--accent-primary, #3B82F6)', 
                        background: 'rgba(59, 130, 246, 0.08)', 
                        padding: '2px 6px', 
                        borderRadius: '4px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}
                    >
                      {doc.doc_type || 'Draft'}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-dark-muted, #8F9CAE)', opacity: 0.65 }}>
                      Case: {doc.case_id}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 
                    style={{ 
                      fontSize: '15px', 
                      fontWeight: '600', 
                      color: 'white', 
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                    title={doc.title}
                  >
                    {doc.title}
                  </h3>

                  {/* 2-line truncated preview of content */}
                  <div className="vault-card-preview">
                    {doc.content}
                  </div>

                  {/* Footer Date info */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '8px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-dark-muted, #8F9CAE)', opacity: 0.5 }}>
                      Created: {new Date(doc.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--accent-primary, #3B82F6)', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px' }}>
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
  );
}
