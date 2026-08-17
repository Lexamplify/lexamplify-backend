import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useContractStore } from '../store/useContractStore';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export default function DraftsModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const { isDraftsModalOpen, closeDraftsModal, setRawText, setClauses, setSummary } = useContractStore();

  const showModal = isOpen !== undefined ? isOpen : isDraftsModalOpen;
  const handleClose = onClose || closeDraftsModal;

  const [savedDrafts, setSavedDrafts] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchSavedDrafts = async () => {
    setLoading(true);
    let apiDrafts = [];
    try {
      const res = await fetch(`${API_BASE}/api/drafts`);
      if (res.ok) apiDrafts = await res.json();
    } catch (e) {}

    let localDrafts = [];
    try {
      localDrafts = JSON.parse(localStorage.getItem('lexamplify_drafts') || '[]');
    } catch (e) {}

    const combined = Array.isArray(apiDrafts) ? [...apiDrafts] : [];
    if (Array.isArray(localDrafts)) {
      for (const ld of localDrafts) {
        if (ld && !combined.some((d) => d.id === ld.id)) {
          combined.push(ld);
        }
      }
    }
    setSavedDrafts(combined);
    setLoading(false);
  };

  useEffect(() => {
    if (showModal) {
      fetchSavedDrafts();
    }
    const handleUpdate = () => fetchSavedDrafts();
    window.addEventListener('lexamplify-drafts-updated', handleUpdate);
    return () => window.removeEventListener('lexamplify-drafts-updated', handleUpdate);
  }, [showModal]);

  if (!showModal) return null;

  const restoreDraftToAnalyzer = (draft) => {
    setRawText(draft.rawText || '');
    setClauses(draft.clauses || []);
    setSummary(draft.summary || '');
    handleClose();
    navigate('/contract-analyzer');
  };

  const deleteSavedDraft = async (draftId) => {
    try {
      await fetch(`${API_BASE}/api/drafts/${draftId}`, { method: 'DELETE' });
    } catch (e) {}
    try {
      const local = JSON.parse(localStorage.getItem('lexamplify_drafts') || '[]');
      const updated = Array.isArray(local) ? local.filter((d) => d.id !== draftId) : [];
      localStorage.setItem('lexamplify_drafts', JSON.stringify(updated));
    } catch (e) {}
    setSavedDrafts((prev) => prev.filter((d) => d.id !== draftId));
    window.dispatchEvent(new CustomEvent('lexamplify-drafts-updated'));
  };

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(3,6,14,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '640px', background: 'var(--bg-panel, #0F172A)', border: '1px solid var(--border-subtle, #1E293B)',
          borderRadius: '16px', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', overflow: 'hidden', color: 'var(--text-primary, #F8FAFC)',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle, #1E293B)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>📝</span> Drafts Pending Review
          </h3>
          <button onClick={handleClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted, #94A3B8)', fontSize: '18px', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ maxHeight: '420px', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted, #94A3B8)', fontSize: '13.5px' }}>Loading saved drafts...</div>
          ) : savedDrafts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted, #94A3B8)', fontSize: '13.5px' }}>
              No saved session drafts pending review. When you click "New" in Contract Analyzer, active sessions are saved here automatically.
            </div>
          ) : (
            savedDrafts.map((d) => (
              <div key={d.id} style={{ padding: '14px 16px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle, #1E293B)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary, #F8FAFC)', marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.title}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted, #94A3B8)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <span>{new Date(d.timestamp).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    {d.clauses?.length > 0 && <span style={{ color: '#FCD34D' }}>⚠️ {d.clauses.length} Flagged Risks</span>}
                    <span>{d.rawText?.length || 0} chars</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => restoreDraftToAnalyzer(d)}
                    style={{ fontSize: '12px', padding: '6px 12px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Restore to Analyzer →
                  </button>
                  <button
                    onClick={() => deleteSavedDraft(d.id)}
                    style={{ fontSize: '12px', padding: '6px 10px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', borderRadius: '6px', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
