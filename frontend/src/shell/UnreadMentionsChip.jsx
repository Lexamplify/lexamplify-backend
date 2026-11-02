import { useNavigate } from 'react-router-dom';
import { useCollabStore } from '../stores/useCollabStore.js';

/*
 * Top-bar chip showing the total unread mentions / shares across every
 * case the user has access to. Clone of BackgroundJobsChip.jsx — same
 * visual contract, same mount point in Shell.jsx's topbar__right.
 *
 * Click behaviour: jumps straight to the most-recent mention's case
 * room, falling back to the case with the highest unread count. The
 * backend's /api/collab/cases/:id/read endpoint clears the counter on
 * arrival (CollabRoom calls it on load).
 */
export default function UnreadMentionsChip() {
  const unread = useCollabStore((s) => s.unreadByCase);
  const lastMention = useCollabStore((s) => s.lastMention);
  const navigate = useNavigate();

  const total = Object.values(unread || {}).reduce((a, n) => a + Number(n || 0), 0);
  if (total <= 0) return null;

  const click = () => {
    let caseId = lastMention?.caseId;
    if (!caseId) {
      // Fall back to the case with the biggest unread count.
      let best = 0; let bestId = null;
      for (const [cid, n] of Object.entries(unread || {})) {
        if (Number(n) > best) { best = Number(n); bestId = cid; }
      }
      caseId = bestId;
    }
    if (caseId) {
      const hash = lastMention?.messageId ? `#collab-${lastMention.messageId}` : '#tab-collab';
      navigate(`/matters/${caseId}${hash}`);
    }
  };

  return (
    <button
      type="button"
      className="bgjobs-chip"
      onClick={click}
      title="Click to open the most recent mention or share"
    >
      <span className="bgjobs-chip__dot" />
      <span className="bgjobs-chip__label">
        {total === 1 ? '1 new mention' : `${total} new mentions`}
      </span>
    </button>
  );
}
