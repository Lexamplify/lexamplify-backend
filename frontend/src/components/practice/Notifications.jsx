import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../dochub/ui.jsx';
import { fmtAgo } from '../dochub/format.js';
import { PIcon } from './icons.jsx';
import { doneWith, pr } from './api.js';
import { usePractice } from './ctx.js';
import { Card, ErrorBox, Loading, PageHead, Segment, useAsync } from './widgets.jsx';

export default function NotificationsPage() {
  const { setUnread, toast } = usePractice();
  const nav = useNavigate();
  const [only, setOnly] = useState('all');
  const [extra, setExtra] = useState([]);
  const [more, setMore] = useState(false);
  const q = useAsync(async (signal) => { setExtra([]); const d = await pr.get('/notifications', { limit: 30, unread: only === 'unread' }, signal); setUnread(d.unread); setMore(d.more); return d; }, [only]);
  const d = q.data;
  const items = d ? [...d.items, ...extra] : [];

  const open = async (n) => {
    if (!n.read_at) { pr.post(`/notifications/${n.id}/read`).catch(() => {}); setUnread((u) => Math.max(0, u - 1)); n.read_at = 'now'; }
    if (n.link) nav(n.link);
  };
  const readAll = async () => { try { await pr.post('/notifications/read-all'); setUnread(0); q.reload(); } catch (e) { toast(doneWith(e), { tone: 'bad' }); } };
  const loadMore = async () => {
    const last = items[items.length - 1];
    try { const r = await pr.get('/notifications', { limit: 30, before: last.id, unread: only === 'unread' }); setExtra((x) => [...x, ...r.items]); setMore(r.more); } catch (e) { toast(doneWith(e), { tone: 'bad' }); }
  };

  return (
    <>
      <PageHead title="Notifications" sub="Hearing reminders, assignments, case updates and new documents.">
        <Segment label="Show" value={only} onChange={setOnly} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} />
        <button type="button" className="dh-btn ghost" onClick={readAll} disabled={!d || !d.unread}><PIcon name="check" />Mark all read</button>
      </PageHead>
      {!d ? (q.error ? <ErrorBox error={q.error} retry={q.reload} /> : <Loading />) : !items.length ? (
        <EmptyState icon="bell" title={only === 'unread' ? 'Nothing unread' : 'No notifications yet'}>{only === 'unread' ? 'You are all caught up.' : 'Reminders and updates will appear here as things happen.'}</EmptyState>
      ) : (
        <Card flush>
          <div className="pr-list">
            {items.map((n) => (
              <button type="button" key={n.id} className={`pr-item ${n.read_at ? '' : 'unread'}`} onClick={() => open(n)}>
                <span style={{ minWidth: 0 }}><span className="ttl">{n.title}</span>{n.body ? <span className="meta"><span>{n.body}</span></span> : null}</span>
                <span className="side">{fmtAgo(n.created_at)}</span>
              </button>
            ))}
          </div>
          {more ? <button type="button" className="more" style={{ width: '100%', background: 'transparent', border: 0, borderTop: '1px solid var(--rule)', cursor: 'pointer' }} onClick={loadMore}>Show older</button> : null}
        </Card>
      )}
    </>
  );
}
