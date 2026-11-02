import { useState, useEffect, useRef, useCallback } from 'react';
// NOTE on the popover click bug (fixed below): mousedown fires BEFORE
// click, and the earlier version's outside-click handler closed the
// menu on any mousedown that wasn't inside the TEXTAREA — including
// clicks on the popover itself (which is a sibling, not a child, so
// taRef.contains(e.target) was false). By the time React re-rendered
// without the menu, the <button> was unmounted and its onClick never
// fired. Fixes: (1) give the popover its own ref so the outside-
// click check skips it, and (2) prevent the default on the row's
// mousedown so focus doesn't leave the textarea mid-click.

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
  const menuRef = useRef(null); // the popover — so outside-click skips it

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
    // Open ABOVE the textarea by default — the composer sits at the
    // bottom of the Collaboration tab, so opening below would push the
    // picker off-screen (and the user has to scroll to read entries,
    // which they correctly flagged as a UX bug).
    // Height is capped at 240px in the menu style below, so top =
    // (textarea top) - 240 - 6px gap keeps it entirely in-viewport.
    const POPOVER_MAX_H = 240;
    const GAP = 6;
    setMenuAnchor({
      top: rect.top + window.scrollY - POPOVER_MAX_H - GAP,
      left: rect.left + window.scrollX,
      openUpward: true,
    });
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
    // Broadcast token keeps the message public; specific user token makes
    // it private (DM) in the backend's visibility logic.
    const token = r.user_id === '__all__' ? '@all ' : `@user:${r.user_id} `;
    const next = before.slice(0, lastAt) + token + after;
    onChange(next);
    // Don't push '__all__' into the mentions id array — it isn't a real
    // user id and the backend wouldn't resolve it. The '@all' body token
    // is what triggers the public broadcast on the server side.
    if (r.user_id !== '__all__') {
      const nextIds = Array.from(new Set([...(mentionedIds || []), r.user_id]));
      onMentionsChange?.(nextIds);
    }
    setShowMenu(false);
    // Return focus + caret to just after the inserted token.
    setTimeout(() => {
      ta.focus();
      const pos = lastAt + token.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  // Close popover on outside click / Escape — must EXCLUDE the popover
  // itself, otherwise clicking a row fires mousedown-close before the
  // button's onClick runs, and the mention never inserts (bug reported
  // by the user: 'As soon as I click on it, it is vanishing').
  useEffect(() => {
    if (!showMenu) return undefined;
    const onDown = (e) => {
      if (taRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setShowMenu(false);
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
  // Synthetic "@all" entry at the top of the picker — picking it inserts
  // '@all' into the body, which the backend reads as a broadcast flag
  // (message becomes public to the whole case room instead of private).
  const broadcastEntry = { user_id: '__all__', name: 'Everyone on this case', role: 'broadcast — public to all case members' };
  const recipientMatches = (recipients || []).filter((r) => {
    if (!q) return true;
    return (
      (r.name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q)
    );
  });
  const includeBroadcast = !q || 'all'.includes(q) || 'everyone'.includes(q);
  const filtered = (includeBroadcast ? [broadcastEntry, ...recipientMatches] : recipientMatches).slice(0, 8);

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
          ref={menuRef}
          role="listbox"
          // Prevent default on the popover's own mousedown as well, as a
          // belt-and-suspenders fix for the click-outside race (so even
          // if the ref-based skip above misses, focus doesn't leave the
          // textarea mid-click).
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'fixed',
            top: menuAnchor.top,
            left: menuAnchor.left,
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            borderRadius: 10,
            // Elevated shadow going DOWNWARD since the popover is now
            // above the textarea — the shadow should fall toward the input.
            boxShadow: '0 10px 28px rgba(0,0,0,0.18)',
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
