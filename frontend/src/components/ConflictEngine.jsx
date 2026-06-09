import React, { useState, useRef, useEffect } from 'react';
import { runConflictCheck, analyzeConflicts } from '../services/api';

const styles = `
  .conflict-container {
    font-family: var(--font-sans);
    color: var(--text-dark-primary);
    min-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
  }

  .conflict-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 12px;
  }

  .mode-tabs {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--border-dark-subtle);
    padding-bottom: 8px;
  }

  .mode-tab-btn {
    background: transparent;
    border: none;
    color: var(--text-dark-muted);
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.3s ease-in-out;
  }

  .mode-tab-btn:hover {
    color: white;
    background-color: rgba(255, 255, 255, 0.04);
  }

  .mode-tab-btn.active {
    color: var(--accent-primary);
    background-color: rgba(59, 130, 246, 0.08);
    font-weight: 600;
  }

  /* Control Panel */
  .control-panel {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 24px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  }

  /* Status Badges */
  .badge-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 4px 12px;
    border-radius: 20px;
    white-space: nowrap;
  }

  .badge-status.clear {
    background-color: rgba(16, 185, 129, 0.15);
    color: #10B981;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .badge-status.potential {
    background-color: rgba(245, 158, 11, 0.15);
    color: #F59E0B;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .badge-status.high {
    background-color: rgba(239, 68, 68, 0.15);
    color: #EF4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  /* Grid and Data Table */
  .data-grid-container {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  }

  .premium-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: 14px;
  }

  .premium-table th {
    background-color: var(--bg-dark-sidebar);
    color: var(--text-dark-muted);
    font-weight: 600;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border-dark-subtle);
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.05em;
  }

  .premium-table td {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-dark-subtle);
    color: var(--text-dark-primary);
  }

  .premium-table tbody tr {
    transition: background-color 0.2s ease-in-out;
  }

  .premium-table tbody tr:hover {
    background-color: rgba(255, 255, 255, 0.02);
  }

  /* Pulsing Skeleton Loader */
  .skeleton-pulse-wrapper {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 30px;
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
  }

  .skeleton-bar {
    background: linear-gradient(90deg, #1f2937 25%, #374151 50%, #1f2937 75%);
    background-size: 200% 100%;
    animation: shimmer-animation 1.5s infinite;
    border-radius: 6px;
    height: 16px;
    width: 100%;
  }

  @keyframes shimmer-animation {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Error Banner */
  .error-banner {
    background-color: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    padding: 16px 20px;
    color: #F87171;
    font-size: 14px;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* Custom inputs matching dark theme */
  .dark-input {
    background-color: #1f2937 !important;
    border: 1px solid #4b5563 !important;
    color: #ffffff !important;
    border-radius: 0.5rem !important;
    padding: 0.75rem !important;
    outline: none;
    transition: all 0.3s ease-in-out;
  }

  .dark-input:focus {
    border-color: #9ca3af !important;
    box-shadow: 0 0 0 2px #9ca3af !important;
  }

  .dark-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Upload Slots */
  .upload-slots {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
    margin-bottom: 24px;
  }

  .upload-slot {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    transition: all 0.3s ease-in-out;
  }

  .upload-slot:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  .drop-zone {
    border: 2px dashed var(--border-dark-subtle);
    background-color: var(--bg-dark-app);
    border-radius: 10px;
    min-height: 150px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    cursor: pointer;
    transition: all 0.2s ease-in-out;
    padding: 20px;
    text-align: center;
  }

  .drop-zone:hover, .drop-zone.dragover {
    border-color: var(--accent-primary);
    background-color: rgba(59, 130, 246, 0.03);
  }

  .drop-zone.has-file {
    border-color: var(--accent-success);
    background-color: rgba(16, 185, 129, 0.03);
  }

  .dz-filename {
    font-weight: 600;
    color: #10B981;
    word-break: break-all;
  }

  .slot-remove-btn {
    background: transparent;
    border: none;
    color: var(--accent-danger);
    font-size: 12.5px;
    cursor: pointer;
    align-self: flex-end;
    font-weight: 600;
    transition: opacity 0.2s;
  }

  .slot-remove-btn:hover {
    opacity: 0.8;
  }

  /* Cross Document results styles */
  .cross-results-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
    margin-top: 24px;
  }

  @media (min-width: 1024px) {
    .cross-results-grid {
      grid-template-columns: 0.35fr 0.65fr;
    }
  }

  .summary-card {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    padding: 24px;
    position: sticky;
    top: 24px;
  }

  .conflict-detail-card {
    background-color: var(--bg-dark-panel);
    border: 1px solid var(--border-dark-subtle);
    border-radius: 12px;
    margin-bottom: 16px;
    overflow: hidden;
    transition: transform 0.2s ease-in-out;
  }

  .conflict-detail-card:hover {
    transform: translateY(-2px);
  }

  .conflict-detail-card.critical { border-left: 4px solid var(--accent-danger); }
  .conflict-detail-card.major { border-left: 4px solid var(--accent-warning); }
  .conflict-detail-card.minor { border-left: 4px solid var(--accent-primary); }

  .conflict-card-header {
    background-color: var(--bg-dark-sidebar);
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border-dark-subtle);
  }

  .excerpts-container {
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    padding: 20px;
  }

  @media (min-width: 768px) {
    .excerpts-container {
      grid-template-columns: 1fr 1fr;
    }
  }

  .excerpt-box {
    border-radius: 8px;
    padding: 14px;
  }

  .excerpt-box.doc-a {
    background-color: rgba(239, 68, 68, 0.05);
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .excerpt-box.doc-b {
    background-color: rgba(245, 158, 11, 0.05);
    border: 1px solid rgba(245, 158, 11, 0.2);
  }

  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background-color: var(--bg-dark-sidebar);
    border: 1px solid var(--accent-success);
    color: var(--accent-success);
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 13.5px;
    font-weight: 600;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    z-index: 1000;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .toast.show {
    opacity: 1;
    transform: translateY(0);
  }
`;

export default function ConflictEngine() {
  const [activeMode, setActiveMode] = useState('database'); // 'database' | 'cross-doc'
  const [entityName, setEntityName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [dbResults, setDbResults] = useState(null);

  // Cross Document State — dynamic, unlimited slots
  const [slots, setSlots] = useState([
    { id: 1, file: null, label: 'Document 1 (e.g. NDA)',           inputRef: React.createRef() },
    { id: 2, file: null, label: 'Document 2 (e.g. MSA)',           inputRef: React.createRef() },
    { id: 3, file: null, label: 'Document 3 (e.g. SOW/Annexure)', inputRef: React.createRef() },
  ]);
  const [crossResults, setCrossResults] = useState(null);
  const [showToast, setShowToast] = useState(false);

  // ── 1. DATABASE SEARCH CONFLICT CHECK ──────────────────────────────
  const handleDbSearchSubmit = async (e) => {
    e.preventDefault();
    if (!entityName.trim() || isLoading) return;

    setIsLoading(true);
    setError('');
    setDbResults(null);

    const res = await runConflictCheck(entityName.trim());
    setIsLoading(false);

    if (res.error) {
      setError(res.message || 'Analysis failed. Please check the backend connection.');
    } else {
      setDbResults(res);
    }
  };

  // ── 2. CROSS-DOCUMENT FILE MANAGEMENT (DYNAMIC SLOTS) ──────────────
  const handleFileChange = (slotId, file) => {
    if (!file) return;
    setSlots(prev => prev.map(s => s.id === slotId ? { ...s, file } : s));
  };

  const removeFile = (slotId, e) => {
    e.stopPropagation();
    setSlots(prev => prev.map(s => {
      if (s.id !== slotId) return s;
      if (s.inputRef.current) s.inputRef.current.value = '';
      return { ...s, file: null };
    }));
  };

  const removeSlot = (slotId, e) => {
    e.stopPropagation();
    setSlots(prev => prev.filter(s => s.id !== slotId));
  };

  const handleLabelChange = (slotId, value) => {
    setSlots(prev => prev.map(s => s.id === slotId ? { ...s, label: value } : s));
  };

  const addSlot = () => {
    const nextId = Date.now();
    const slotNum = slots.length + 1;
    setSlots(prev => [...prev, { id: nextId, file: null, label: `Document ${slotNum}`, inputRef: React.createRef() }]);
  };

  const handleCrossDocAnalyze = async () => {
    const loaded = slots.filter(s => s.file);
    if (loaded.length < 2) {
      alert('Please upload at least 2 documents to compare.');
      return;
    }

    setIsLoading(true);
    setError('');
    setCrossResults(null);

    const formData = new FormData();
    loaded.forEach((s, idx) => {
      formData.append(`doc${idx + 1}`, s.file);
      formData.append(`label${idx + 1}`, s.label || `Document ${idx + 1}`);
    });

    const res = await analyzeConflicts(formData);
    setIsLoading(false);

    if (res.error) {
      setError(res.message || 'AI Cross-Document conflict scanning failed.');
    } else {
      setCrossResults(res);
    }
  };

  const copyResolutionToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2800);
  };

  const resetCrossDoc = () => {
    setSlots([
      { id: 1, file: null, label: 'Document 1 (e.g. NDA)',           inputRef: React.createRef() },
      { id: 2, file: null, label: 'Document 2 (e.g. MSA)',           inputRef: React.createRef() },
      { id: 3, file: null, label: 'Document 3 (e.g. SOW/Annexure)', inputRef: React.createRef() },
    ]);
    setCrossResults(null);
    setError('');
  };

  const formatBytes = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <>
      <style>{styles}</style>
      <div className="conflict-container p-4 md:p-8">
        
        {/* Header */}
        <div className="conflict-header">
          <div>
            <h1 style={{ fontSize: '24px', margin: 0, fontFamily: 'var(--font-serif)' }}>Cross-Document Conflict Engine</h1>
            <span style={{ fontSize: '12.5px', color: 'var(--text-dark-muted)' }}>
              Scan legal databases for client-opponent matching conflicts, or compare annexures with AI.
            </span>
          </div>
          <span style={{ fontSize: '11px', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 12px', background: 'linear-gradient(135deg, var(--gold, #c9a84c), var(--gold2, #e6c97a))', color: 'var(--navy, #0d1b2a)', borderRadius: '20px' }}>
            Flagship RAG node
          </span>
        </div>

        {/* Tab mode selection */}
        <div className="mode-tabs">
          <button 
            className={`mode-tab-btn ${activeMode === 'database' ? 'active' : ''}`}
            onClick={() => { setActiveMode('database'); setError(''); }}
          >
            🔍 Database Search
          </button>
          <button 
            className={`mode-tab-btn ${activeMode === 'cross-doc' ? 'active' : ''}`}
            onClick={() => { setActiveMode('cross-doc'); setError(''); }}
          >
            📂 Cross-Document Uploader
          </button>
        </div>

        {/* Explicit Error Banner */}
        {error && (
          <div className="error-banner">
            <span>⚠️</span>
            <div>{error}</div>
          </div>
        )}

        {/* ── MODE 1: DATABASE CONFLICT SEARCH ───────────────────────────── */}
        {activeMode === 'database' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Top Search Panel */}
            <form onSubmit={handleDbSearchSubmit}>
              <div className="control-panel">
                <label className="input-label" style={{ margin: 0 }}>Onboard Entity Check (Client, Corporation, or Party Name)</label>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="Enter full name of corporation or individual to run audit check..."
                    className="dark-input"
                    style={{ flex: 1, minWidth: '260px' }}
                    value={entityName}
                    onChange={(e) => setEntityName(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                  <button 
                    type="submit" 
                    className="btn-accent"
                    style={{ padding: '0 28px', minWidth: '180px' }}
                    disabled={isLoading}
                  >
                    Run Conflict Check
                  </button>
                </div>
              </div>
            </form>

            {/* Scanning Database Pulsing Skeleton Loader */}
            {isLoading && (
              <div className="skeleton-pulse-wrapper">
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div className="loading-spinner" style={{ width: '20px', height: '20px' }}></div>
                  <strong style={{ color: 'var(--text-dark-muted)' }}>Scanning case files and vault documents...</strong>
                </div>
                <div className="skeleton-bar" style={{ width: '80%' }}></div>
                <div className="skeleton-bar" style={{ width: '90%' }}></div>
                <div className="skeleton-bar" style={{ width: '60%' }}></div>
              </div>
            )}

            {/* Results Grid Table */}
            {dbResults && !isLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                {/* Result header summary */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-dark-panel)', padding: '16px 20px', borderRadius: '8px', border: '1px solid var(--border-dark-subtle)' }}>
                  <div>
                    <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', display: 'block' }}>Search Target</span>
                    <strong style={{ fontSize: '18px', color: 'white' }}>{dbResults.entity_name}</strong>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Classification</span>
                    <span className={`badge-status ${dbResults.status === 'High Conflict' ? 'high' : dbResults.status === 'Potential' ? 'potential' : 'clear'}`}>
                      {dbResults.status === 'High Conflict' ? '🔴 High Conflict' : dbResults.status === 'Potential' ? '🟡 Potential' : '🟢 Clear'}
                    </span>
                  </div>
                </div>

                <div className="data-grid-container">
                  <div className="overflow-x-auto">
                    <table className="premium-table">
                      <thead>
                        <tr>
                          <th>Location / Case Name</th>
                          <th>Primary Client</th>
                          <th>Adversary Opponent</th>
                          <th>Match Type</th>
                          <th>Ingestion Excerpt context</th>
                          <th>Status Badge</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dbResults.results && dbResults.results.length > 0 ? (
                          dbResults.results.map((r, idx) => (
                            <tr key={idx}>
                              <td>
                                <strong style={{ color: 'white' }}>{r.case_title}</strong>
                                <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-dark-muted)' }}>ID: {r.case_id}</span>
                              </td>
                              <td>{r.client}</td>
                              <td>{r.opponent}</td>
                              <td>
                                <span style={{ fontSize: '12.5px', color: 'var(--accent-primary)', fontWeight: '600' }}>{r.match_type}</span>
                              </td>
                              <td style={{ maxWidth: '320px', fontSize: '13px', color: 'var(--text-dark-muted)', fontStyle: 'italic', wordBreak: 'break-word' }}>
                                {r.excerpt}
                              </td>
                              <td>
                                <span className={`badge-status ${r.conflict_status === 'High Conflict' ? 'high' : 'potential'}`}>
                                  {r.conflict_status === 'High Conflict' ? '🔴 High' : '🟡 Potential'}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="6" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dark-muted)', fontStyle: 'italic' }}>
                              No conflict nodes identified in client vault files. Clearance approved.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── MODE 2: CROSS-DOCUMENT UPLOADER COMPARISON ────────────────────── */}
        {activeMode === 'cross-doc' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {!crossResults ? (
              <>
                {/* ── DYNAMIC UPLOAD SLOTS ── */}
                <div className="upload-slots">
                  {slots.map((slot) => (
                    <div className="upload-slot" key={slot.id}>
                      {/* Label + remove-slot button */}
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          className="dark-input"
                          style={{ padding: '6px 10px', fontSize: '12px', flex: 1 }}
                          type="text"
                          value={slot.label}
                          onChange={(e) => handleLabelChange(slot.id, e.target.value)}
                        />
                        {slots.length > 2 && (
                          <button
                            className="slot-remove-btn"
                            onClick={(e) => removeSlot(slot.id, e)}
                            title="Remove this slot"
                            style={{ padding: '4px 8px', fontSize: '11px', opacity: 0.7 }}
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {/* Drop zone */}
                      <div
                        className={`drop-zone ${slot.file ? 'has-file' : ''}`}
                        onClick={() => slot.inputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); }}
                        onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); }}
                        onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('dragover'); handleFileChange(slot.id, e.dataTransfer.files[0]); }}
                      >
                        <input
                          type="file"
                          ref={slot.inputRef}
                          style={{ display: 'none' }}
                          accept=".pdf,.docx"
                          onChange={(e) => handleFileChange(slot.id, e.target.files[0])}
                        />
                        {slot.file ? (
                          <>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            <span className="dz-filename">{slot.file.name}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)' }}>{formatBytes(slot.file.size)}</span>
                          </>
                        ) : (
                          <>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(99,102,241,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                            <span style={{ fontSize: '13px', color: 'var(--text-dark-muted)' }}>Click or drag a file here</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', opacity: 0.6 }}>PDF or DOCX</span>
                          </>
                        )}
                      </div>

                      {slot.file && (
                        <button className="slot-remove-btn" onClick={(e) => removeFile(slot.id, e)}>✕ Remove file</button>
                      )}
                    </div>
                  ))}

                  {/* ── ADD DOCUMENT TILE ── */}
                  <div
                    className="upload-slot"
                    onClick={addSlot}
                    style={{ cursor: 'pointer', justifyContent: 'center', alignItems: 'center', border: '2px dashed rgba(59,130,246,0.25)', background: 'rgba(59,130,246,0.02)', minHeight: '180px' }}
                    title="Add another document"
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: 'var(--text-dark-muted)', pointerEvents: 'none' }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(99,102,241,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                      <span style={{ fontSize: '13px' }}>Add Document</span>
                      <span style={{ fontSize: '11px', opacity: 0.6 }}>Compare unlimited documents</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-dark-muted)' }}>
                    {slots.filter(s => s.file).length} / {slots.length} documents loaded
                  </span>
                  <button
                    className="btn-accent"
                    style={{ padding: '13px 44px', fontSize: '14px' }}
                    onClick={handleCrossDocAnalyze}
                    disabled={slots.filter(s => s.file).length < 2 || isLoading}
                  >
                    {isLoading ? 'Scanning…' : '⚡ Run Cross-Document Check'}
                  </button>
                </div>

                {isLoading && (
                  <div className="skeleton-pulse-wrapper" style={{ marginTop: '24px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <div className="loading-spinner" style={{ width: '20px', height: '20px' }}></div>
                      <strong style={{ color: 'var(--text-dark-muted)' }}>Extracting files and compiling RAG vectors...</strong>
                    </div>
                    <div className="skeleton-bar" style={{ width: '85%' }}></div>
                    <div className="skeleton-bar" style={{ width: '75%' }}></div>
                  </div>
                )}
              </>
            ) : (
              // Results Panel
              <div className="cross-results-grid">
                
                {/* Summary Card */}
                <div className="summary-col">
                  <div className="summary-card">
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: 'var(--accent-primary)', borderBottom: '1px solid var(--border-dark-subtle)', paddingBottom: '12px' }}>
                      📊 AI Summary
                    </h3>
                    
                    <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Documents Analyzed</span>
                    <ul style={{ paddingLeft: '20px', margin: '8px 0 20px 0', fontSize: '13px', color: 'var(--text-dark-primary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {slots.filter(s => s.file).map(s => (
                        <li key={s.id}>📂 {s.label} ({s.file.name})</li>
                      ))}
                    </ul>

                    <div style={{ textAlign: 'center', padding: '16px', backgroundColor: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-dark-subtle)', borderRadius: '8px', marginBottom: '20px' }}>
                      <div style={{ fontSize: '36px', fontWeight: '700', color: 'white' }}>{crossResults.conflicts ? crossResults.conflicts.length : 0}</div>
                      <span style={{ fontSize: '11px', color: 'var(--text-dark-muted)', textTransform: 'uppercase' }}>Conflicts Found</span>
                    </div>

                    <div style={{ fontSize: '13px', color: 'var(--text-dark-muted)', lineHeight: '1.6', background: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--border-dark-subtle)', padding: '14px', borderRadius: '8px', marginBottom: '20px' }}>
                      {crossResults.summary}
                    </div>

                    <button className="btn-reset" style={{ width: '100%', padding: '12px' }} onClick={resetCrossDoc}>
                      🔄 Analyze New Documents
                    </button>
                  </div>
                </div>

                {/* Details list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: 'white' }}>Conflict Audit Logs</h3>
                  {crossResults.conflicts && crossResults.conflicts.length > 0 ? (
                    crossResults.conflicts.map((c, idx) => {
                      const sev = (c.severity || 'minor').toLowerCase();
                      return (
                        <div key={idx} className={`conflict-detail-card ${sev}`}>
                          <div className="conflict-card-header">
                            <strong style={{ color: 'white', fontSize: '14.5px' }}>{c.title || `Conflict ${idx + 1}`}</strong>
                            <span className={`badge-status ${sev === 'critical' ? 'high' : sev === 'major' ? 'potential' : 'clear'}`}>
                              {c.severity}
                            </span>
                          </div>

                          <div className="excerpts-container">
                            <div className="excerpt-box doc-a">
                              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent-danger)', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                                📄 {c.doc_a_name || 'Document A'}
                              </span>
                              <div style={{ fontSize: '13px', color: 'var(--text-dark-primary)', fontStyle: 'italic' }}>
                                "{c.doc_a_excerpt}"
                              </div>
                            </div>

                            <div className="excerpt-box doc-b">
                              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent-warning)', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
                                📄 {c.doc_b_name || 'Document B'}
                              </span>
                              <div style={{ fontSize: '13px', color: 'var(--text-dark-primary)', fontStyle: 'italic' }}>
                                "{c.doc_b_excerpt}"
                              </div>
                            </div>
                          </div>

                          <div style={{ padding: '0 20px 20px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.15)', borderRadius: '8px', padding: '12px 14px' }}>
                              <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--accent-primary)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                                ⚖️ Legal Explanation
                              </span>
                              <div style={{ fontSize: '13px', color: 'var(--text-dark-muted)' }}>
                                {c.legal_explanation}
                              </div>
                            </div>

                            <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)', borderRadius: '8px', padding: '12px 14px' }}>
                              <span style={{ fontSize: '11px', fontWeight: '700', color: '#10B981', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>
                                ✅ Recommended Harmonization
                              </span>
                              <div style={{ fontSize: '13.5px', color: 'white', marginBottom: '8px' }}>
                                {c.recommended_resolution}
                              </div>
                              <button 
                                className="btn-copy" 
                                style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.25)', color: '#10B981', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', borderRadius: '4px' }}
                                onClick={() => copyResolutionToClipboard(c.recommended_resolution)}
                              >
                                Copy Harmonized Clause
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div style={{ padding: '40px', backgroundColor: 'var(--bg-dark-panel)', border: '1px solid var(--border-dark-subtle)', borderRadius: '12px', textAlign: 'center', fontStyle: 'italic', color: 'var(--text-dark-muted)' }}>
                      No conflicting statements found across compared files.
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        )}

      </div>

      {/* Copy Toast Alert */}
      <div className={`toast ${showToast ? 'show' : ''}`}>
        ✅ Harmonized resolution copied to clipboard
      </div>
    </>
  );
}
