import { Icon } from './icons.jsx';
import { Chip } from './ui.jsx';
import { STATUS, fileBadge, fmtAgo, fmtBytes, fmtDate, fmtNum, splitHighlights } from './format.js';

export function Marked({ text }) {
  const parts = splitHighlights(text);
  return parts.map((p, i) => (p.hit ? <mark key={i} className="dh-mark">{p.text}</mark> : <span key={i}>{p.text}</span>));
}

function daysUntil(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  const then = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((then - today) / 86400000);
}

export function DocRow({ doc, selected, cursor, open, onSelect, onOpen, folderLabel, actions, extra, selectable = true }) {
  const st = STATUS[doc.status] || STATUS.ready;
  const needsReview = doc.review === 'needs_review';
  const hearing = doc.next_hearing ? daysUntil(doc.next_hearing) : null;
  const soon = hearing !== null && hearing >= 0 && hearing <= 7;
  const cases = (doc.case_numbers || []).slice(0, 2);
  const tags = (doc.tags || []).slice(0, 3);
  const folder = doc.folder_id ? folderLabel?.(doc.folder_id) : '';
  const hit = doc.hit;
  const busy = st.tone === 'busy';
  return (
    <div className={`dh-row${selected ? ' sel' : ''}${cursor ? ' cur' : ''}${open ? ' open' : ''}`} data-doc-id={doc.id} role="row">
      <div className="cbx">
        {selectable ? (
          <input type="checkbox" checked={!!selected} aria-label={`Select ${doc.title}`}
            onChange={() => {}} onClick={(e) => onSelect?.(doc.id, { shift: e.shiftKey })} />
        ) : null}
      </div>
      <div className="dh-badge" aria-hidden="true">{fileBadge(doc)}</div>
      <button type="button" className="main" onClick={() => onOpen?.(doc.id)} aria-label={`Open ${doc.title}`}>
        <div className="ttl">
          <span className="name">{doc.title}</span>
          {doc.legal_hold ? <Icon name="lock" title="Legal hold — cannot be deleted" /> : null}
        </div>
        <div className="meta">
          {cases.length ? <span><Icon name="hash" /><b>{cases.join(' · ')}</b></span> : null}
          {doc.parties ? <span title={doc.parties}>{doc.parties.length > 60 ? `${doc.parties.slice(0, 58)}…` : doc.parties}</span> : null}
          {doc.court ? <span title={doc.court}>{doc.court.length > 44 ? `${doc.court.slice(0, 42)}…` : doc.court}</span> : null}
          {doc.doc_date ? <span><Icon name="calendar" />{fmtDate(doc.doc_date)}</span> : null}
          {doc.next_hearing ? <span style={soon ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>Next hearing {fmtDate(doc.next_hearing)}{soon ? (hearing === 0 ? ' · today' : ` · in ${hearing} d`) : ''}</span> : null}
          {!cases.length && !doc.parties && !doc.court && !doc.doc_date && doc.original_name && doc.original_name !== doc.title ? <span>{doc.original_name}</span> : null}
        </div>
        {hit && hit.snippet ? (
          <div className="snip"><span className="pg">{hit.page ? `p.${hit.page}` : 'match'}</span><Marked text={hit.snippet} />
            {hit.pages_hit > 1 ? <span className="pg" style={{ marginLeft: 8 }}>+{hit.pages_hit - 1} more page{hit.pages_hit > 2 ? 's' : ''}</span> : null}
          </div>
        ) : null}
        <div className="chips">
          <Chip tone="class" className={doc.doc_class === 'Unclassified' ? 'tag' : ''} title={doc.class_conf != null && doc.class_src !== 'user' ? `${Math.round(doc.class_conf * 100)}% sure` : doc.class_src === 'user' ? 'Set by you' : ''}>{doc.doc_class}</Chip>
          {needsReview && !busy && st.tone !== 'bad' ? <Chip tone="warn" icon="alert" title="The hub is not sure about this one">Check type</Chip> : null}
          {st.tone !== 'ok' ? <Chip tone={st.tone} icon={st.tone === 'bad' ? 'alert' : undefined} title={doc.status_note || st.hint}>{st.label}</Chip> : null}
          {doc.suggested_matter ? <Chip tone="warn" icon="briefcase" title="A matching matter was found">Matter suggested</Chip> : null}
          {folder ? <Chip icon="folder" title="Folder">{folder}</Chip> : null}
          {doc.version > 1 ? <Chip title="Number of versions">v{doc.version}</Chip> : null}
          {doc.level === 'view' ? <Chip icon="eye" title="You can view but not change this">View only</Chip> : null}
          {tags.map((t) => <Chip key={t} tone="tag" icon="tag">{t}</Chip>)}
          {(doc.tags || []).length > 3 ? <Chip tone="tag">+{doc.tags.length - 3}</Chip> : null}
        </div>
        {extra}
      </button>
      <div className="side">
        <span title={doc.created_at}>{fmtAgo(doc.created_at)}</span>
        <span><b>{doc.page_count ? `${fmtNum(doc.page_count)} ${doc.page_kind === 'sheet' ? 'sheets' : doc.page_kind === 'slide' ? 'slides' : doc.page_count === 1 ? 'page' : 'pages'}` : '—'}</b> · {fmtBytes(doc.size)}</span>
        {actions ? <span className="acts">{actions}</span> : null}
      </div>
    </div>
  );
}

export function Skeleton({ rows = 8 }) {
  return (
    <div className="dh-list" aria-busy="true" aria-label="Loading documents">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="dh-skel" style={{ animationDelay: `${i * 80}ms` }}><i /></div>)}
    </div>
  );
}

export function Pager({ page, perPage, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (total <= perPage) return null;
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return (
    <nav className="dh-pager" aria-label="Pages">
      <span className="info">{fmtNum(from)}–{fmtNum(to)} of {fmtNum(total)}</span>
      <div className="btns">
        <button type="button" className="dh-btn ghost sm" onClick={() => onPage(1)} disabled={page <= 1}>First</button>
        <button type="button" className="dh-btn ghost sm" onClick={() => onPage(page - 1)} disabled={page <= 1}><Icon name="chevL" size={14} />Previous</button>
        <span className="pg">Page {fmtNum(page)} of {fmtNum(pages)}</span>
        <button type="button" className="dh-btn ghost sm" onClick={() => onPage(page + 1)} disabled={page >= pages}>Next<Icon name="chevR" size={14} /></button>
        <button type="button" className="dh-btn ghost sm" onClick={() => onPage(pages)} disabled={page >= pages}>Last</button>
      </div>
    </nav>
  );
}
