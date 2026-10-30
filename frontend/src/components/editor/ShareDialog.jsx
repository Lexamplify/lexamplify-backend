import { useState } from 'react';
import { createPortal } from 'react-dom';
import * as Ic from '../../icons.jsx';
import { useDocStore, ROLE_LABEL, can } from '../../collab/useDocStore.js';
import { initials } from '../../collab/identity.js';

const ASSIGNABLE = ['editor', 'commenter', 'viewer'];

export default function ShareDialog({ docId, myRole, onClose }) {
  const doc = useDocStore((s) => s.docs[docId]);
  const addMember = useDocStore((s) => s.addMember);
  const setMemberRole = useDocStore((s) => s.setMemberRole);
  const removeMember = useDocStore((s) => s.removeMember);
  const setLinkRole = useDocStore((s) => s.setLinkRole);
  const directory = useDocStore((s) => s.directory());

  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [copied, setCopied] = useState(false);
  const manage = can.manage(myRole);

  if (!doc) return null;

  const link = `${location.origin}${location.pathname}#/draft/${docId}`;
  const suggestions = directory.filter((d) => !doc.members.some((m) => m.email === d.email));

  function invite(e) {
    e?.preventDefault();
    const v = email.trim();
    if (!v) return;
    const match = directory.find((d) => d.email === v);
    addMember(docId, { email: v, name: match?.name, role });
    setEmail('');
  }

  function copy() {
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  }

  return createPortal(
    <div className="shm-overlay" onMouseDown={onClose}>
      <div className="shm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="shm-head">
          <div><h3>Share “{doc.title}”</h3><p>{doc.members.length} {doc.members.length === 1 ? 'person' : 'people'} with access</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Ic.X size={18} /></button>
        </div>

        {manage && (
          <form className="shm-invite" onSubmit={invite}>
            <div className="shm-invite-field">
              <Ic.Users size={15} />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Invite by email…" list="shm-dir" />
              <datalist id="shm-dir">{suggestions.map((d) => <option key={d.email} value={d.email}>{d.name}</option>)}</datalist>
            </div>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="shm-role">
              {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button type="submit" className="lx-btn lx-btn--primary lx-btn--sm" disabled={!email.trim()}>Invite</button>
          </form>
        )}

        <div className="shm-list">
          {doc.members.map((m) => (
            <div className="shm-row" key={m.id}>
              <span className="shm-av" style={{ background: roleColor(m.role) }}>{initials(m.name)}</span>
              <div className="shm-who"><b>{m.name}</b><span>{m.email}</span></div>
              {m.role === 'owner' ? (
                <span className="shm-owner">Owner</span>
              ) : manage ? (
                <div className="shm-actions">
                  <select value={m.role} onChange={(e) => setMemberRole(docId, m.id, e.target.value)} className="shm-role shm-role--sm">
                    {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <button className="icon-btn icon-btn--sm" title="Remove" onClick={() => removeMember(docId, m.id)}><Ic.Trash size={15} /></button>
                </div>
              ) : (
                <span className="shm-rolestatic">{ROLE_LABEL[m.role]}</span>
              )}
            </div>
          ))}
        </div>

        <div className="shm-link">
          <div className="shm-link-head">
            <span className="shm-link-ico"><Ic.Globe size={16} /></span>
            <div className="shm-who"><b>Anyone with the link</b><span>No sign-in needed</span></div>
            {manage ? (
              <select value={doc.linkRole} onChange={(e) => setLinkRole(docId, e.target.value)} className="shm-role shm-role--sm">
                {ASSIGNABLE.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            ) : <span className="shm-rolestatic">{ROLE_LABEL[doc.linkRole]}</span>}
          </div>
          <div className="shm-copy">
            <input readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="lx-btn lx-btn--ghost lx-btn--sm" onClick={copy}><Ic.Copy size={14} /> {copied ? 'Copied' : 'Copy link'}</button>
          </div>
          <p className="shm-note">Open this link in another browser or tab to co-edit live — changes and cursors sync peer-to-peer.</p>
        </div>
      </div>
    </div>,
    document.body
  );
}

function roleColor(role) {
  return { owner: '#2563C9', editor: '#0E7C66', commenter: '#B45309', viewer: '#64748b' }[role] || '#64748b';
}
