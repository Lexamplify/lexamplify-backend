import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ContractTiptapEditor from './ContractTiptapEditor.jsx';
import { useContractStore } from '../store/useContractStore.js';
import { fetchDocuments } from '../services/api.js';

const API_BASE = 'http://localhost:5000';

export default function AutoDraftWorkspace() {
  const navigate = useNavigate();
  const isMountedRef = useRef(true);

  // Shared contract state lifted from store
  const {
    rawText,
    setRawText,
    autoDraftText,
    setAutoDraftText,
    autoDraftPrompt,
    setAutoDraftPrompt,
    autoDraftVersion,
    setAutoDraftVersion,
  } = useContractStore();

  // Local synthesis studio state
  const [drafting, setDrafting] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const [draftError, setDraftError] = useState('');
  const [vaultDocs, setVaultDocs] = useState([]);
  const [selectedContextMode, setSelectedContextMode] = useState('active_contract');
  const [copied, setCopied] = useState(false);
  const [appended, setAppended] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    const loadVault = async () => {
      const res = await fetchDocuments();
      if (!isMountedRef.current) return;
      if (Array.isArray(res)) {
        setVaultDocs(res);
      }
    };
    loadVault();
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Cycling in-flight status messages during AI reasoning
  useEffect(() => {
    if (!drafting) return;
    const phases = [
      'Interpreting drafting instructions…',
      'Cross-referencing Indian statutes…',
      'Synthesizing clause language…',
      'Refining for enforceability…',
    ];
    let i = 0;
    setDraftStatus(phases[0]);
    const id = setInterval(() => {
      i = (i + 1) % phases.length;
      setDraftStatus(phases[i]);
    }, 1700);
    return () => clearInterval(id);
  }, [drafting]);

  const handleSynthesize = async (e) => {
    if (e) e.preventDefault();
    if (!autoDraftPrompt.trim()) {
      setDraftError('Please provide drafting instructions before synthesizing.');
      return;
    }

    setDrafting(true);
    setDraftError('');
    setDraftStatus('Synthesizing dynamic context node…');

    try {
      let contextValue = null;
      if (selectedContextMode === 'active_contract' && rawText.trim()) {
        contextValue = rawText.trim();
      } else if (selectedContextMode !== 'none' && selectedContextMode !== 'active_contract') {
        contextValue = selectedContextMode;
      }

      const response = await fetch(`${API_BASE}/api/documents/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: autoDraftPrompt.trim(), context: contextValue }),
      });
      const data = await response.json();

      if (!isMountedRef.current) return;
      setDrafting(false);
      setDraftStatus('');

      if (response.ok && data.draft) {
        const clean = data.draft.replace(/^"|"$/g, '').trim();
        setAutoDraftText(clean);
        setAutoDraftVersion((v) => v + 1);
      } else {
        setDraftError(data.message || 'Failed to synthesize auto-draft clause.');
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setDrafting(false);
      setDraftStatus('');
      setDraftError('Network timeout in the AI reasoning engine. Please retry.');
    }
  };

  const handleAppendToContract = () => {
    if (!autoDraftText.trim()) return;
    const separator = rawText.trim() ? '\n\n' : '';
    setRawText(rawText + separator + autoDraftText);
    setAppended(true);
    setTimeout(() => setAppended(false), 2500);
  };

  const handleCopyDraft = () => {
    if (!autoDraftText.trim()) return;
    navigator.clipboard.writeText(autoDraftText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const PRECEDENTS = [
    {
      label: 'Dispute Escalation',
      act: 'Arbitration & Conciliation Act, 1996',
      prompt: 'Draft a dispute resolution clause using a three-tier escalation mechanism: (1) senior management negotiation within 15 days, (2) mediation under the Indian Mediation Centre rules within 30 days, and (3) binding arbitration under the Arbitration and Conciliation Act, 1996 before a sole arbitrator seated in New Delhi. All proceedings shall be in English. The arbitral award shall be final and binding.',
    },
    {
      label: 'IP Assignment',
      act: 'Copyright Act, 1957 · Patents Act, 1970',
      prompt: 'Draft a comprehensive intellectual property assignment clause. All work product, inventions, developments, software, and derivative works created by the Vendor under this Agreement shall be "works made for hire" as defined under the Copyright Act, 1957, vesting exclusively in the Client. To the extent any rights do not vest automatically, the Vendor hereby assigns all rights in perpetuity worldwide to the Client. Vendor retains no residual license.',
    },
    {
      label: 'Severability Provision',
      act: 'Indian Contract Act, 1872 — s.24',
      prompt: 'Draft a severability clause: If any provision of this Agreement is held invalid, illegal, or unenforceable by a court of competent jurisdiction under the Indian Contract Act, 1872, such provision shall be modified to the minimum extent necessary to make it enforceable, or severed if modification is not possible, without affecting the validity and enforceability of the remaining provisions which shall continue in full force.',
    },
    {
      label: 'Mutual Notice Terms',
      act: 'General Clauses Act, 1897',
      prompt: 'Draft a mutual notice clause: All notices, demands, or communications under this Agreement shall be in writing and deemed duly served when delivered by: (a) hand delivery with signed acknowledgement, (b) registered post with acknowledgement due to the address on the cover page, or (c) email to the designated contact with read-receipt confirmation. Notices take effect on the date of receipt. Either party may update its notice details with 7 days written notice to the other party.',
    },
    {
      label: 'Indemnification & Defense',
      act: 'Indian Contract Act, 1872 — s.124',
      prompt: 'Draft a mutual indemnification clause under Section 124 of the Indian Contract Act, 1872. Each party agrees to defend, indemnify, and hold harmless the other party against any third-party claims, losses, or liabilities arising directly out of gross negligence, willful misconduct, or breach of confidentiality obligations.',
    },
  ];

  return (
    <div className="autodraft-page-container" style={{ padding: '24px', maxWidth: '1440px', margin: '0 auto', color: 'var(--text-primary)' }}>
      {/* ── HEADER & NAVIGATION ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: 'var(--bg-panel)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-subtle)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>⚡</span>
            <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Auto-Draft Studio</h1>
            <span style={{ fontSize: '11px', fontWeight: 600, background: 'rgba(59,130,246,0.12)', color: 'var(--accent-primary)', padding: '3px 9px', borderRadius: '12px', border: '1px solid rgba(59,130,246,0.25)' }}>
              Standalone Route
            </span>
          </div>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Synthesize enforceable Indian legal clauses &amp; contract provisions using precedent AI reasoning
          </p>
        </div>

        {/* Active Contract Status Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ padding: '8px 14px', background: rawText.trim() ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)', border: rawText.trim() ? '1px solid rgba(16,185,129,0.25)' : '1px solid var(--border-subtle)', borderRadius: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: rawText.trim() ? '#10B981' : '#94A3B8' }} />
            <span>
              {rawText.trim() ? (
                <>Active Contract Loaded: <strong style={{ color: 'var(--text-primary)' }}>{rawText.length.toLocaleString()} chars</strong></>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>No Contract Active (Drafting from Scratch)</span>
              )}
            </span>
          </div>

          <Link to="/contract-analyzer" style={{ textDecoration: 'none' }}>
            <button className="db-sync-btn" style={{ fontSize: '12.5px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🔍 Open Analyzer</span>
            </button>
          </Link>
        </div>
      </div>

      {/* ── MAIN WORKSPACE GRID ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)', gap: '20px', alignItems: 'start' }}>
        {/* LEFT COLUMN — Live Editor View */}
        <div style={{ background: 'var(--bg-panel)', borderRadius: '12px', border: '1px solid var(--border-subtle)', padding: '20px', minHeight: '620px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>Synthesized Draft Workspace</span>
              {autoDraftText && (
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px' }}>
                  {autoDraftText.length.toLocaleString()} chars
                </span>
              )}
            </div>

            {/* Quick Actions for Draft */}
            {autoDraftText && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={handleCopyDraft}
                  style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', cursor: 'pointer' }}
                >
                  {copied ? '✓ Copied!' : '📋 Copy Draft'}
                </button>
                {rawText.trim() && (
                  <button
                    type="button"
                    onClick={handleAppendToContract}
                    style={{ padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', color: 'var(--accent-primary)', cursor: 'pointer' }}
                  >
                    {appended ? '✓ Appended to Contract!' : '➕ Append to Contract'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAutoDraftText('')}
                  style={{ padding: '6px 10px', borderRadius: '6px', fontSize: '12px', background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444', cursor: 'pointer' }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Editor / In-flight Status / Standby state */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {drafting ? (
              <div style={{ padding: '40px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', flex: 1 }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', border: '3px solid var(--accent-primary)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--accent-primary)' }}>{draftStatus || 'Synthesizing clause…'}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Analyzing precedent law &amp; Indian Contract Act statutory bounds…</div>
              </div>
            ) : draftError ? (
              <div style={{ padding: '20px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#EF4444', marginBottom: '16px' }}>
                <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>Synthesis Failed</div>
                <div style={{ fontSize: '12.5px', lineHeight: 1.5 }}>{draftError}</div>
                <button onClick={() => setDraftError('')} style={{ marginTop: '10px', padding: '4px 10px', borderRadius: '4px', background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#EF4444', fontSize: '11px', cursor: 'pointer' }}>Dismiss</button>
              </div>
            ) : autoDraftText ? (
              <ContractTiptapEditor
                documentKey={autoDraftVersion}
                initialRawText={autoDraftText}
                onTextChange={setAutoDraftText}
                clauses={[]}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '12px', opacity: 0.4 }}>
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>Auto-Draft Studio Ready</div>
                <div style={{ fontSize: '12.5px', maxWidth: '380px', lineHeight: 1.5 }}>
                  Select a precedent from the right panel or enter custom drafting instructions to synthesize dynamic legal clauses.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — Synthesis Studio Controls */}
        <div style={{ background: 'var(--bg-panel)', borderRadius: '12px', border: '1px solid var(--border-subtle)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Playbook Precedents */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ⚡ Playbook Precedent Inserts
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {PRECEDENTS.map(({ label, act, prompt }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setAutoDraftPrompt(prompt)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left',
                    padding: '10px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)',
                    border: '1px solid var(--border-subtle)', cursor: 'pointer', transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(59,130,246,0.08)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>{act}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Reference Context Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              Reference Context
            </label>
            <select
              className="toolbar-select"
              value={selectedContextMode}
              onChange={(e) => setSelectedContextMode(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: '13px' }}
            >
              <option value="active_contract">Active Loaded Contract ({rawText.length} chars)</option>
              <option value="none">No Context (Draft from Scratch)</option>
              {vaultDocs.length > 0 && (
                <optgroup label="Vault Documents">
                  {vaultDocs.map((doc) => (
                    <option key={doc.id} value={doc.id}>{doc.filename}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Synthesis Form */}
          <form onSubmit={handleSynthesize} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                Drafting Instructions *
              </label>
              <textarea
                required
                rows={5}
                placeholder="e.g. Synthesize a non-compete clause limited to 2 years within India under Section 27 of the Indian Contract Act..."
                value={autoDraftPrompt}
                onChange={(e) => setAutoDraftPrompt(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '8px',
                  background: 'var(--bg-main)', border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={drafting}
              style={{
                width: '100%', padding: '12px', borderRadius: '8px', fontWeight: 600, fontSize: '14px',
                background: 'var(--accent-primary)', color: 'white', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                opacity: drafting ? 0.7 : 1, transition: 'all 0.2s',
              }}
            >
              {drafting ? 'Synthesizing Clause…' : '⚡ Synthesize Clause'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
