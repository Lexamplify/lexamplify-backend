import { useState, useEffect, useRef, useCallback } from 'react';

/*
 * Plain textarea + "@" popover for case-room messages. Chose a textarea
 * over a Tiptap editor on purpose — the backend only needs the resolved
 * user_ids (which we post explicitly in the `mentions` array) and the
 * free text. Rich formatting is out of v1 scope.
 *
 * When the user types "@", we fetch /api/collab/cases/<caseId>/eligible-
 * recipients ONCE and show the popover. On pick, we insert `@user:<id>`
 * at the caret and push the id into `mentionedIds`. The caller submits
 * both `body` (the final text with @user:<id> tokens) and `mentions`
 * (the deduped id array) — the server's utils.mentions.resolve_mentions
 * re-validates both.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export default function MentionInput({
  caseId,
  value,
  onChange,
  mentionedIds,
  onMentionsChange,
  placeholder = 'Write a message… use @ to mention a colleague.',
  rows = 3,
  disabled = false,
}) {
  const [recipients, setRecipients] = useState(null); // null = not fetched yet
  const [showMenu, setShowMenu] = useState(false);
  const [menuQuery, setMenuQuery] = useState('');
  const [menuAnchor, setMenuAnchor] = useState({ top: 0, left: 0 });
  const taRef = useRef(null);

  // Lazily fetch the eligible-recipients list the first time the user
  // types "@" — avoids a round-trip for every opened case detail that
  // never gets a message sent.
  const ensureRecipients = useCallback(async () => {
    if (recipients !== null) return;
    try {
      const r = await fetch(`${API_BASE}/api/collab/cases/${caseId}/eligible-recipients`, {
        credentials: 'include',
      });
      const j = await r.json().catch(() => ({ recipients: [] }));
      setRecipients(Array.isArray(j.recipients) ? j.recipients : []);
    } catch { setRecipients([]); }
  }, [caseId, recipients]);

  const openMenuAtCaret = () => {
    const ta = taRef.current;
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    setMenuAnchor({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX });
    setShowMenu(true);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart;
    // Find the last "@" before the caret that isn't part of an already-
    // resolved token like @user:12 (digits after it).
    const before = next.slice(0, caret);
    const lastAt = before.lastIndexOf('@');
    if (lastAt === -1) { setShowMenu(false); return; }
    const after = before.slice(lastAt + 1);
    if (/\s/.test(after)) { setShowMenu(false); return; }
    if (after.startsWith('user:')) { setShowMenu(false); return; }  // already a resolved token
    setMenuQuery(after);
    ensureRecipients();
    openMenuAtCaret();
  };

  const insertMention = (r) => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const lastAt = before.lastIndexOf('@');
    if (lastAt === -1) return;
    const token = `@user:${r.user_id} `;
    const next = before.slice(0, lastAt) + token + after;
    onChange(next);
    const nextIds = Array.from(new Set([...(mentionedIds || []), r.user_id]));
    onMentionsChange?.(nextIds);
    setShowMenu(false);
    // Return focus + caret to just after the inserted token.
    setTimeout(() => {
      ta.focus();
      const pos = lastAt + token.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!showMenu) return undefined;
    const onDown = (e) => {
      if (!taRef.current?.contains(e.target)) setShowMenu(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setShowMenu(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showMenu]);

  const q = (menuQuery || '').toLowerCase();
  const filtered = (recipients || []).filter((r) => {
    if (!q) return true;
    return (
      (r.name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q)
    );
  }).slice(0, 8);

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        className="inp"
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={handleChange}
        disabled={disabled}
        style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, width: '100%' }}
      />
      {showMenu && filtered.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'fixed',
            top: menuAnchor.top + 4,
            left: menuAnchor.left,
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            minWidth: 240,
            maxHeight: 240,
            overflowY: 'auto',
            zIndex: 1500,
            padding: 4,
          }}
        >
          {filtered.map((r) => (
            <button
              key={r.user_id}
              type="button"
              onClick={() => insertMention(r)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 10px', border: 'none', background: 'transparent',
                borderRadius: 6, cursor: 'pointer',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'var(--paper-2)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{r.name || `User ${r.user_id}`}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.email || r.role || ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
