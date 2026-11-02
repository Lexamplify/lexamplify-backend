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

// Escape text for safe inclusion in a RegExp.
const _reEscape = (s) => String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

// Render a message body with styled chips for:
//   * @all / @everyone / @channel  → green public pill
//   * @<Full Name of a mentioned user, e.g. "@Arjun Singh">  → orange
//     chip. Names come from the message's own `mentions` array of
//     user_ids resolved via the recipients map (so a stale body text
//     still highlights correctly if display names change later).
//   * Legacy @user:<id> tokens from older messages — still rendered.
function renderBody(body, mentionUserIds, recipientNames) {
  if (!body) return null;
  const text = String(body);
  // Build the alternation: broadcast, then every mentioned user's
  // name (longest first, so "Arjun Singh" matches before "Arjun"), then
  // the legacy user token. Falls back to just the broadcast + legacy
  // if there are no mentioned users on this message.
  const mentionedNames = (mentionUserIds || [])
    .map((uid) => recipientNames[uid])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const nameAlt = mentionedNames.length
    ? mentionedNames.map((n) => `@${_reEscape(n)}`).join('|') + '|'
    : '';
  const re = new RegExp(`(${nameAlt}@all|@everyone|@channel|@user:\\d+)`, 'gi');
  const parts = text.split(re);
  return parts.map((part, i) => {
    if (!part) return null;
    if (/^@(all|everyone|channel)$/i.test(part)) {
      return (
        <span key={i} style={{
          color: 'var(--ok, #177d5d)', fontWeight: 500,
          background: 'rgba(23, 125, 93, 0.1)',
          padding: '0 5px', borderRadius: 4,
        }}>@all</span>
      );
    }
    const legacy = part.match(/^@user:(\d+)$/);
    if (legacy) {
      const uid = Number(legacy[1]);
      const name = recipientNames[uid] || `user ${uid}`;
      return (
        <span key={i} style={{
          color: 'var(--accent)', fontWeight: 500,
          background: 'rgba(178, 74, 46, 0.08)',
          padding: '0 4px', borderRadius: 4,
        }}>@{name}</span>
      );
    }
    if (part.startsWith('@') && mentionedNames.some((n) => `@${n}` === part || `@${n}`.toLowerCase() === part.toLowerCase())) {
      return (
        <span key={i} style={{
          color: 'var(--accent)', fontWeight: 500,
          background: 'rgba(178, 74, 46, 0.08)',
          padding: '0 4px', borderRadius: 4,
        }}>{part}</span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// Classify an attachment by its file extension so the card can pick
// the right preview — a photo gets rendered inline, a PDF gets an
// embed, a video gets a <video controls>, everything else falls back
// to the file-row card. Driven off case_vault.file_format via the
// backend's hydration, so a .html file never pretends to be a .pdf.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const PDF_EXTS = new Set(['pdf']);
const _extOf = (name) => {
  if (!name || typeof name !== 'string') return '';
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
};
const _iconFor = (ext) => {
  if (IMAGE_EXTS.has(ext)) return '🖼️';
  if (VIDEO_EXTS.has(ext)) return '🎞️';
  if (AUDIO_EXTS.has(ext)) return '🎧';
  if (PDF_EXTS.has(ext)) return '📄';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'html'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return '📊';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return '📽️';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  return '📎';
};

function ResourceCard({ r, navigate }) {
  const label = {
    contract_analysis: 'Contract analysis',
    vault_doc: 'Document',
    case_document: 'Case document',
    draft_session: 'Draft',
  }[r.resource_type] || r.resource_type;
  const displayName = r.name || r.filename || `${r.resource_type}:${r.resource_id}`;
  const ext = _extOf(r.filename || r.name);
  const icon = _iconFor(ext);
  const [imgBroken, setImgBroken] = useState(false);

  // vault_doc gets a real file URL. Everything else (a shared contract
  // analysis, a draft) stays as an in-app link.
  const downloadUrl = r.resource_type === 'vault_doc'
    ? `${API_BASE}/api/vault/documents/${r.resource_id}/download`
    : null;
  // ?inline=1 asks the backend to serve with Content-Disposition: inline,
  // so clicking "Open in new tab" lets the browser render it natively
  // (PDF viewer / image / video) instead of forcing a download.
  const inlineUrl = downloadUrl ? `${downloadUrl}?inline=1` : null;
  const appLink = {
    contract_analysis: `/contracts/${r.resource_id}`,
    draft_session: `/draft/${r.resource_id}`,
  }[r.resource_type] || null;

  const isImage = r.resource_type === 'vault_doc' && IMAGE_EXTS.has(ext) && !imgBroken;
  const isPdf = r.resource_type === 'vault_doc' && PDF_EXTS.has(ext);
  const isVideo = r.resource_type === 'vault_doc' && VIDEO_EXTS.has(ext);
  const isAudio = r.resource_type === 'vault_doc' && AUDIO_EXTS.has(ext);

  return (
    <div
      style={{
        border: '1px solid var(--rule)', borderRadius: 10, padding: '8px 12px',
        background: 'var(--paper-2)', marginTop: 6, fontSize: 13,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}{ext ? ` · ${ext.toUpperCase()}` : ''}
      </div>
      {isImage && (
        <img
          src={inlineUrl}
          alt={displayName}
          onError={() => setImgBroken(true)}
          style={{ display: 'block', maxWidth: '100%', maxHeight: 320, marginTop: 8, borderRadius: 6, border: '1px solid var(--rule)' }}
        />
      )}
      {isVideo && (
        <video
          controls
          preload="metadata"
          style={{ display: 'block', maxWidth: '100%', maxHeight: 360, marginTop: 8, borderRadius: 6, border: '1px solid var(--rule)', background: '#000' }}
        >
          <source src={inlineUrl} />
          Your browser can't play this video. Use Download below.
        </video>
      )}
      {isAudio && (
        <audio controls preload="metadata" src={inlineUrl} style={{ display: 'block', width: '100%', marginTop: 8 }} />
      )}
      {isPdf && (
        // Inline PDF preview — browsers render it natively from an
        // <embed>; the fallback link covers browsers that disable the
        // built-in viewer.
        <embed
          src={inlineUrl}
          type="application/pdf"
          style={{ display: 'block', width: '100%', height: 420, marginTop: 8, border: '1px solid var(--rule)', borderRadius: 6 }}
        />
      )}
      <div style={{ color: 'var(--ink)', marginTop: (isImage || isPdf || isVideo || isAudio) ? 8 : 2, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ wordBreak: 'break-word', fontWeight: 500 }}>{icon} {displayName}</span>
        {inlineUrl && (
          <a
            href={inlineUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'underline' }}
          >
            Open in new tab
          </a>
        )}
        {downloadUrl && (
          <a
            href={downloadUrl}
            download={displayName}
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'underline' }}
          >
            Download
          </a>
        )}
        {appLink && (
          <button
            type="button"
            onClick={() => navigate(appLink)}
            style={{ fontSize: 12, color: 'var(--muted)', border: 'none', background: 'transparent', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
          >
            Open in {label.toLowerCase()}
          </button>
        )}
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
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState(''); // transient "Uploading foo.pdf…" line
  const feedRef = useRef(null);
  const fileInputRef = useRef(null);
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

  // Upload one or more files from the user's machine and drop each one
  // into the room as a share-kind message. Reuses the existing Vault
  // upload endpoint + /api/collab/share so privacy, notifications,
  // mentions and audit all flow through the single share service — no
  // new backend path, no bespoke rules to reconcile later.
  //
  // The composer draft (if any) rides along as the share body on the
  // FIRST uploaded file, so a user can type "see page 3" + attach the
  // PDF and have both land as one card. Subsequent files in the same
  // batch get a plain "Attached <filename>" caption. Current mentions
  // make all of them private DMs to those recipients; '@all' makes them
  // public broadcasts — same rule as regular text messages.
  const uploadAndShare = async (files) => {
    if (!files || !files.length) return;
    setUploading(true); setError('');
    const broadcast = /(^|\s)@(all|everyone|channel)\b/i.test(draft);
    const typedBody = draft.trim();
    const mentionsForShare = broadcast ? [] : mentionedIds;
    try {
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        setUploadNote(`Uploading ${f.name}… (${i + 1}/${files.length})`);
        // 1. POST to the Vault upload endpoint — gets a vault_doc id back.
        const fd = new FormData();
        fd.append('file', f);
        fd.append('case_id', String(caseId));
        const up = await fetch(`${API_BASE}/api/vault/documents/upload`, {
          method: 'POST', credentials: 'include',
          headers: { 'X-CSRF-TOKEN': csrf() },
          body: fd,
        });
        const upJ = await up.json().catch(() => ({}));
        if (!up.ok || !upJ.id) throw new Error(upJ.message || `Could not upload ${f.name}.`);

        // 2. Share the newly-uploaded vault_doc into the room. The first
        //    file carries the typed body (so "see page 3 📎 contract.pdf"
        //    is one message); the rest get a plain caption.
        const body = i === 0 && typedBody ? typedBody : `Attached ${f.name}`;
        const share = await fetch(`${API_BASE}/api/collab/share`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
          body: JSON.stringify({
            case_id: Number(caseId),
            resource_type: 'vault_doc',
            resource_id: upJ.id,
            recipient_user_ids: mentionsForShare,
            body,
          }),
        });
        const shareJ = await share.json().catch(() => ({}));
        if (!share.ok) throw new Error(shareJ.message || `Could not share ${f.name} into the room.`);

        // Hydrate the returned message with the filename we just uploaded
        // so the feed card can show "📎 contract.pdf" + an image preview
        // when it's a png/jpg/... instead of the raw "vault_doc:42" label.
        const msg = shareJ.message || {};
        msg.resources = (msg.resources || []).map((r) => ({
          ...r,
          filename: upJ.filename || f.name,
          name: upJ.title || f.name,
        }));
        setMessages((prev) => [...prev, msg]);
      }
      // Only clear the composer once the whole batch landed, so a mid-
      // batch failure leaves the typed draft + mentions in place for retry.
      setDraft(''); setMentionedIds([]);
    } catch (e) {
      setError(e.message || 'Could not attach file.');
    } finally {
      setUploading(false);
      setUploadNote('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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
          const isPrivate = m.visibility === 'private';
          return (
            <div
              key={m.id}
              id={`collab-${m.id}`}
              style={{
                padding: '10px 14px',
                background: isPrivate
                  ? 'rgba(70, 130, 180, 0.05)'
                  : isShare ? 'rgba(178, 74, 46, 0.04)' : 'var(--paper)',
                border: isPrivate
                  ? '1px dashed rgba(70, 130, 180, 0.45)'
                  : isShare ? '1px solid rgba(178, 74, 46, 0.2)' : '1px solid var(--rule)',
                borderRadius: 10,
                marginLeft: 8, marginRight: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {author}
                  {isShare && <span style={{ color: 'var(--accent)', marginLeft: 2 }}>shared</span>}
                  {isPrivate && (
                    <span
                      title="Private message — only you, the mentioned users, and firm seniors see this"
                      style={{
                        fontSize: 10, color: '#4682b4',
                        background: 'rgba(70, 130, 180, 0.14)',
                        padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                        letterSpacing: '.02em', display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}
                    >
                      🔒 Private
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{whenLabel(m.created_at)}</div>
              </div>
              {m.body && (
                <div style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {renderBody(m.body, m.mentions, recipientNames)}
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
            {(() => {
              // Live visibility preview — matches the backend's rule in
              // collab_routes.post_message. Lets the sender see at a
              // glance whether this will be a channel broadcast or a
              // private DM-style note before clicking Send.
              const broadcastInBody = /(^|\s)@(all|everyone|channel)\b/i.test(draft);
              if (broadcastInBody) return 'Public — everyone on this case will see it.';
              if (mentionedIds.length > 0) return `Private — only you${mentionedIds.length === 1 ? ' and 1 mentioned user' : ` and ${mentionedIds.length} mentioned users`} (plus firm seniors) will see it.`;
              return draft.trim() ? 'Public (open channel) — mention someone with @ to make it private, or type @all to broadcast.' : '';
            })()}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {uploadNote && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{uploadNote}</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => uploadAndShare(Array.from(e.target.files || []))}
            />
            <button
              type="button"
              className="lx-btn lx-btn--ghost"
              disabled={uploading || sending}
              onClick={() => fileInputRef.current?.click()}
              title="Attach a document, image, or any file. It uploads to this case's Vault and appears here as a shareable card."
            >
              {uploading ? 'Uploading…' : '📎 Attach'}
            </button>
            <button
              className="lx-btn lx-btn--primary"
              type="button"
              disabled={sending || uploading || !draft.trim()}
              onClick={send}
            >
              {sending ? 'Sending…' : 'Send message'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
