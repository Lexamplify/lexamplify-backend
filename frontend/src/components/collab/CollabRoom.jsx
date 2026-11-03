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
  // Prefer the hydrated name (contract analyses carry the real
  // document title; vault docs carry the stored filename). Only fall
  // back to a type label — NEVER expose raw UUIDs in the chat room,
  // which would show as 'contract_analysis:local_3692e882-...'.
  const _typeLabel = {
    contract_analysis: 'Contract analysis',
    vault_doc: 'Document',
    case_document: 'Case document',
    draft_session: 'Draft',
  }[r.resource_type] || r.resource_type;
  const displayName = r.name || r.filename || _typeLabel;
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
  // Files the user picked but hasn't sent yet. They stay staged in the
  // composer (previewed as chips) so the user can also type text and
  // @mention someone before pressing Send — same flow as WhatsApp /
  // Slack / Gmail. Only on Send do we upload + share.
  const [pendingFiles, setPendingFiles] = useState([]);
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

  // Picking files just STAGES them in the composer — no upload yet, so
  // the user can also type text + @mention someone first. Send does the
  // actual upload + share. This matches how WhatsApp / Slack / Gmail
  // handle attachments: pick, type, send.
  const stagePickedFiles = (files) => {
    if (!files || !files.length) return;
    setPendingFiles((prev) => [...prev, ...files]);
    // Reset the input so picking the SAME file twice still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const removePendingFile = (idx) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // The one Send path. Three shapes:
  //   (a) text only                      → POST /messages (unchanged).
  //   (b) text + file(s)                 → upload each file, share each
  //       as a vault_doc card; the TYPED text + current @mentions ride
  //       on the first card so one Send produces one card per file.
  //   (c) file(s) only                   → same as (b) with the typed
  //       body replaced by 'Attached <name>'.
  // Either way, @all makes the whole batch public; specific mentions
  // make it private DMs to those recipients.
  const send = async () => {
    const body = draft.trim();
    const files = pendingFiles;
    if (!body && files.length === 0) return;

    // No attachments → plain text message.
    if (files.length === 0) {
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
      return;
    }

    // Has attachments → upload + share each.
    setUploading(true); setSending(true); setError('');
    const broadcast = /(^|\s)@(all|everyone|channel)\b/i.test(body);
    const mentionsForShare = broadcast ? [] : mentionedIds;
    try {
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        setUploadNote(`Uploading ${f.name}… (${i + 1}/${files.length})`);
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

        // Only the first file carries the typed body; the rest get a
        // plain caption so the feed shows "<typed text>" on card 1 then
        // "Attached <file2>" / "Attached <file3>" on the rest.
        const cardBody = (i === 0 && body) ? body : `Attached ${f.name}`;
        const share = await fetch(`${API_BASE}/api/collab/share`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf() },
          body: JSON.stringify({
            case_id: Number(caseId),
            resource_type: 'vault_doc',
            resource_id: upJ.id,
            recipient_user_ids: mentionsForShare,
            body: cardBody,
          }),
        });
        const shareJ = await share.json().catch(() => ({}));
        if (!share.ok) throw new Error(shareJ.message || `Could not share ${f.name} into the room.`);

        const msg = shareJ.message || {};
        msg.resources = (msg.resources || []).map((rr) => ({
          ...rr,
          filename: upJ.filename || f.name,
          name: upJ.title || f.name,
        }));
        setMessages((prev) => [...prev, msg]);
      }
      // All files landed → clear the composer.
      setDraft(''); setMentionedIds([]); setPendingFiles([]);
    } catch (e) {
      // Partial failure: keep the composer intact so the user can retry
      // without re-typing or re-picking files.
      setError(e.message || 'Could not send attachment.');
    } finally {
      setUploading(false);
      setSending(false);
      setUploadNote('');
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
        {/* Pending-files strip — appears above the textarea so the user
            can see what they picked, type a caption, @mention someone,
            then press Send. Click × to remove a file before sending. */}
        {pendingFiles.length > 0 && (
          <div
            style={{
              display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8,
              padding: '8px 10px', border: '1px dashed var(--rule)',
              borderRadius: 10, background: 'var(--paper-2)',
            }}
          >
            {pendingFiles.map((f, idx) => {
              const ext = _extOf(f.name);
              const isImg = IMAGE_EXTS.has(ext);
              // Only build an object URL when it will actually render —
              // revoke in the chip's unmount hook below.
              return (
                <PendingFileChip
                  key={`${f.name}-${idx}`}
                  file={f}
                  isImg={isImg}
                  icon={_iconFor(ext)}
                  onRemove={() => removePendingFile(idx)}
                  disabled={uploading || sending}
                />
              );
            })}
          </div>
        )}
        <MentionInput
          caseId={caseId}
          value={draft}
          onChange={setDraft}
          mentionedIds={mentionedIds}
          onMentionsChange={setMentionedIds}
          disabled={sending || uploading}
          placeholder={pendingFiles.length > 0
            ? 'Add a message with your attachment… use @ to mention a colleague.'
            : 'Write a message… use @ to mention a colleague.'}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {(() => {
              // Live visibility preview — matches the backend's rule in
              // collab_routes.post_message. Lets the sender see at a
              // glance whether this will be a channel broadcast or a
              // private DM-style note before clicking Send.
              const broadcastInBody = /(^|\s)@(all|everyone|channel)\b/i.test(draft);
              const noun = pendingFiles.length > 0
                ? (pendingFiles.length === 1 ? 'this attachment' : `these ${pendingFiles.length} attachments`)
                : 'it';
              if (broadcastInBody) return `Public — everyone on this case will see ${noun}.`;
              if (mentionedIds.length > 0) return `Private — only you${mentionedIds.length === 1 ? ' and 1 mentioned user' : ` and ${mentionedIds.length} mentioned users`} (plus firm seniors) will see ${noun}.`;
              return (draft.trim() || pendingFiles.length > 0)
                ? `Public (open channel) — mention someone with @ to make ${noun} private, or type @all to broadcast.`
                : '';
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
              onChange={(e) => stagePickedFiles(Array.from(e.target.files || []))}
            />
            <button
              type="button"
              className="lx-btn lx-btn--ghost"
              disabled={uploading || sending}
              onClick={() => fileInputRef.current?.click()}
              title="Attach documents, images, or any files. They stage below the composer so you can type a message and @mention a colleague before sending."
            >
              📎 Attach
            </button>
            <button
              className="lx-btn lx-btn--primary"
              type="button"
              disabled={sending || uploading || (!draft.trim() && pendingFiles.length === 0)}
              onClick={send}
            >
              {uploading
                ? 'Sending…'
                : (pendingFiles.length > 0
                  ? `Send ${pendingFiles.length === 1 ? 'attachment' : `${pendingFiles.length} attachments`}`
                  : 'Send message')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Chip for a file the user picked but hasn't sent yet. Shows a thumbnail
// for images, an icon + extension for everything else, with a × button
// to drop it from the pending list.
function PendingFileChip({ file, isImg, icon, onRemove, disabled }) {
  const [thumb, setThumb] = useState(null);
  useEffect(() => {
    if (!isImg) return undefined;
    const url = URL.createObjectURL(file);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImg]);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px 4px 4px',
        background: 'var(--paper)', border: '1px solid var(--rule)',
        borderRadius: 8, maxWidth: 260,
      }}
      title={file.name}
    >
      {isImg && thumb ? (
        <img
          src={thumb}
          alt=""
          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--rule)' }}
        />
      ) : (
        <span style={{ fontSize: 20, width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          {icon}
        </span>
      )}
      <span
        style={{
          fontSize: 12, color: 'var(--ink)', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160,
        }}
      >
        {file.name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${file.name}`}
        style={{
          border: 'none', background: 'transparent', cursor: disabled ? 'default' : 'pointer',
          fontSize: 16, color: 'var(--muted)', padding: '0 4px', lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
