import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import MentionInput from './MentionInput.jsx';
import { useCollabStore } from '../../stores/useCollabStore.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function csrf() {
  const m = document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function whenLabel(iso) {
  if (!iso) return '';
  const s = String(iso).includes('T') ? iso : String(iso).replace(' ', 'T');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// Render a message body — replaces @user:<id> tokens with colored chips
// using the recipients map so a mentioned user shows as their name.
function renderBody(body, recipientNames) {
  if (!body) return null;
  const parts = String(body).split(/(@user:\d+)/g);
  return parts.map((part, i) => {
    const m = part.match(/^@user:(\d+)$/);
    if (!m) return <span key={i}>{part}</span>;
    const uid = Number(m[1]);
    const name = recipientNames[uid] || `user ${uid}`;
    return (
      <span key={i} style={{
        color: 'var(--accent)', fontWeight: 500,
        background: 'rgba(178, 74, 46, 0.08)',
        padding: '0 4px', borderRadius: 4,
      }}>@{name}</span>
    );
  });
}

function ResourceCard({ r, navigate }) {
  const label = {
    contract_analysis: 'Contract analysis',
    vault_doc: 'Document',
    case_document: 'Case document',
    draft_session: 'Draft',
  }[r.resource_type] || r.resource_type;
  const link = {
    contract_analysis: `/contracts/${r.resource_id}`,
    draft_session: `/draft/${r.resource_id}`,
    vault_doc: `/vault#${r.resource_id}`,
    case_document: null,
  }[r.resource_type];
  return (
    <div
      role={link ? 'link' : undefined}
      tabIndex={link ? 0 : undefined}
      onClick={() => link && navigate(link)}
      onKeyDown={(e) => { if (link && (e.key === 'Enter' || e.key === ' ')) navigate(link); }}
      style={{
        border: '1px solid var(--rule)', borderRadius: 10, padding: '8px 12px',
        background: 'var(--paper-2)', marginTop: 6, cursor: link ? 'pointer' : 'default',
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </div>
      <div style={{ color: 'var(--ink)', marginTop: 2 }}>
        {r.resource_type}:{r.resource_id}
      </div>
    </div>
  );
}

/*
 * Case room — persistent chat + share feed per lpms_case.
 *
 * Reads: GET /api/collab/cases/:caseId/messages?limit=50
 * Writes: POST /api/collab/cases/:caseId/messages
 * Marks read: POST /api/collab/cases/:caseId/read
 * Lazy-loads once when the tab first opens (same pattern as the
 * Documents / Timeline / Notes tabs in MatterDetail).
 */
export default function CollabRoom({ caseId }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [mentionedIds, setMentionedIds] = useState([]);
  const [sending, setSending] = useState(false);
  const feedRef = useRef(null);
  const clearUnread = useCollabStore((s) => s.clear);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [m, r] = await Promise.all([
        fetch(`${API_BASE}/api/collab/cases/${caseId}/messages?limit=50`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/collab/cases/${caseId}/eligible-recipients`, { credentials: 'include' }),
      ]);
      const mj = await m.json().catch(() => ({ messages: [] }));
      const rj = await r.json().catch(() => ({ recipients: [] }));
      if (!m.ok) throw new Error(mj.message || `Could not load the room (HTTP ${m.status}).`);
      setMessages(Array.isArray(mj.messages) ? mj.messages : []);
      setRecipients(Array.isArray(rj.recipients) ? rj.recipients : []);
      // Mark everything through the newest message as read; clear the
      // client-side unread badge for this case.
      if (mj.messages && mj.messages.length) {
        const newest = mj.messages[mj.messages.length - 1].id;
        fetch(`${API_BASE}/api/collab/cases/${caseId}/read`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
          body: JSON.stringify({ last_read_message_id: newest }),
        }).catch(() => {});
      }
      clearUnread(caseId);
    } catch (e) {
      setError(e.message || 'Could not load the room.');
    } finally {
      setLoading(false);
    }
  }, [caseId, clearUnread]);

  useEffect(() => { load(); }, [load]);

  // Auto-scroll to newest on message count change (first load + after send).
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const recipientNames = Object.fromEntries(recipients.map((r) => [r.user_id, r.name || `User ${r.user_id}`]));

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true); setError('');
    try {
      const r = await fetch(`${API_BASE}/api/collab/cases/${caseId}/messages`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
        body: JSON.stringify({ body, mentions: mentionedIds }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || 'Could not send message.');
      setMessages((prev) => [...prev, j.message]);
      setDraft(''); setMentionedIds([]);
    } catch (e) {
      setError(e.message || 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 480 }}>
      {error && <div role="alert" style={{ color: 'var(--risk)', fontSize: 13, marginBottom: 10 }}>{error}</div>}

      <div
        ref={feedRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '12px 4px',
          display: 'flex', flexDirection: 'column', gap: 14,
          border: '1px solid var(--rule)', borderRadius: 12,
          background: 'var(--paper-2)',
        }}
      >
        {loading && <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 40 }}>Loading room…</div>}
        {!loading && messages.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 40, lineHeight: 1.6 }}>
            No messages yet. This room collects every message, mention and
            resource shared into this case.<br />
            Start a conversation or share a contract analysis to populate it.
          </div>
        )}
        {messages.map((m) => {
          const author = recipientNames[m.author_user_id] || `User ${m.author_user_id}`;
          const isShare = m.kind === 'share';
          return (
            <div
              key={m.id}
              id={`collab-${m.id}`}
              style={{
                padding: '10px 14px',
                background: isShare ? 'rgba(178, 74, 46, 0.04)' : 'var(--paper)',
                border: isShare ? '1px solid rgba(178, 74, 46, 0.2)' : '1px solid var(--rule)',
                borderRadius: 10,
                marginLeft: 8, marginRight: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                  {author}{isShare && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>shared</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{whenLabel(m.created_at)}</div>
              </div>
              {m.body && (
                <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {renderBody(m.body, recipientNames)}
                </div>
              )}
              {(m.resources || []).map((r, i) => <ResourceCard key={i} r={r} navigate={navigate} />)}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12 }}>
        <MentionInput
          caseId={caseId}
          value={draft}
          onChange={setDraft}
          mentionedIds={mentionedIds}
          onMentionsChange={setMentionedIds}
          disabled={sending}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {mentionedIds.length > 0 && `${mentionedIds.length} mention${mentionedIds.length === 1 ? '' : 's'} will be notified.`}
          </div>
          <button
            className="lx-btn lx-btn--primary"
            type="button"
            disabled={sending || !draft.trim()}
            onClick={send}
          >
            {sending ? 'Sending…' : 'Send message'}
          </button>
        </div>
      </div>
    </div>
  );
}
