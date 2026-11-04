import { useState, useEffect, useCallback } from 'react';
import { getSession, getVersion } from '../../services/draftApi.js';

function ago(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function VersionHistory({ docId, bridge }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getSession(docId);
      setVersions(data.versions || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [docId]);

  useEffect(() => { load(); }, [load]);

  async function openPreview(v) {
    setPreviewLoading(true);
    try {
      const data = await getVersion(docId, v.id);
      setPreview({ ...v, document: data.document });
    } catch {
      alert('Could not load this version.');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function restore() {
    if (!preview?.document?.html || !bridge) return;
    if (!window.confirm('Restore this version? Your current content will be replaced.')) return;
    setRestoring(true);
    try {
      bridge.loadHtml(preview.document.html);
      setPreview(null);
    } catch {
      alert('Could not restore this version.');
    } finally {
      setRestoring(false);
    }
  }

  if (loading) {
    return (
      <div className="ads-vh">
        <div className="ads-vh__empty">Loading versions...</div>
      </div>
    );
  }

  return (
    <div className="ads-vh">
      {preview && (
        <div className="ads-vh__preview-overlay" onClick={() => setPreview(null)}>
          <div className="ads-vh__preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ads-vh__preview-head">
              <div>
                <div className="ads-vh__preview-title">Version from {ago(preview.created_at)}</div>
                <div className="ads-vh__preview-date">
                  {preview.created_at ? new Date(preview.created_at).toLocaleString() : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="lx-btn lx-btn--primary lx-btn--sm" onClick={restore} disabled={restoring}>
                  {restoring ? 'Restoring...' : 'Restore this version'}
                </button>
                <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={() => setPreview(null)}>Close</button>
              </div>
            </div>
            <div className="ads-vh__preview-body"
              dangerouslySetInnerHTML={{ __html: preview.document?.html || '<p>No content</p>' }}
            />
          </div>
        </div>
      )}

      {versions.length === 0 ? (
        <div className="ads-vh__empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)', marginBottom: 8 }}>
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          <div>No versions saved yet</div>
          <div className="ads-vh__empty-sub">Versions are created automatically as you edit.</div>
        </div>
      ) : (
        <div className="ads-vh__list">
          {versions.map((v, i) => (
            <div key={v.id} className="ads-vh__item" onClick={() => openPreview(v)}>
              <div className="ads-vh__dot-line">
                <div className={`ads-vh__dot${i === 0 ? ' ads-vh__dot--latest' : ''}`} />
                {i < versions.length - 1 && <div className="ads-vh__line" />}
              </div>
              <div className="ads-vh__content">
                <div className="ads-vh__time">{ago(v.created_at)}</div>
                {v.note && <div className="ads-vh__note">{v.note}</div>}
                <div className="ads-vh__date">
                  {v.created_at ? new Date(v.created_at).toLocaleString() : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="ads-vh__refresh" onClick={load} title="Refresh versions">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        Refresh
      </button>
    </div>
  );
}

export default VersionHistory;
