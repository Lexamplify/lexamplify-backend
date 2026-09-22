import React, { useState } from 'react';

const MATER_MEMBERS = [
  { id: 'u1', name: 'Adv. Ramesh Rao', role: 'Lead Counsel - Petitioner' },
  { id: 'u2', name: 'Narendar V', role: 'Lead Associate' },
  { id: 'u3', name: 'Pooja K', role: 'Associate' },
];

const FIRM_DIRECTORY = [
  { id: 'u4', name: 'Dr. A. M. Singhvi', role: 'Sr. Adv. - Appellate' },
  { id: 'u5', name: 'Saurabh M', role: 'Partner - Arbitration' },
  { id: 'u6', name: 'Yogesh K', role: 'Partner - Commercial' },
  { id: 'u7', name: 'K. Parameshwar', role: 'AoR' },
  { id: 'u8', name: 'Ananya Sharma', role: 'Associate - Corporate' },
  { id: 'u9', name: 'Vikramaditya Sen', role: 'Senior Partner' },
];

export default function ShareModal({ isOpen, item, onClose }) {
  const [search, setSearch] = useState('');
  const [selectedAccess, setSelectedAccess] = useState({});

  if (!isOpen || !item) return null;

  const handleToggleAccess = (userId) => {
    setSelectedAccess(prev => {
      const next = { ...prev };
      if (next[userId]) delete next[userId];
      else next[userId] = 'Can View';
      return next;
    });
  };

  const handleChangeAccessLevel = (userId, level) => {
    setSelectedAccess(prev => ({ ...prev, [userId]: level }));
  };

  const isEthicalWallBreached = FIRM_DIRECTORY.some(user => selectedAccess[user.id]);

  const renderUserList = (users) => (
    <div className="flex flex-col gap-1 mt-2">
      {users.filter(u => u.name.toLowerCase().includes(search.toLowerCase())).map(user => (
        <div key={user.id} className="flex items-center justify-between p-2 hover:bg-[var(--paper-2)] rounded-lg transition-colors">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!selectedAccess[user.id]}
              onChange={() => handleToggleAccess(user.id)}
              className="w-4 h-4 rounded border-[var(--rule)] text-[var(--accent)] focus:ring-[var(--accent)]"
            />
            <div>
              <div className="text-sm font-medium text-[var(--ink)]">{user.name}</div>
              <div className="text-xs font-mono text-[var(--muted)]">{user.role}</div>
            </div>
          </label>
          {selectedAccess[user.id] && (
            <select
              value={selectedAccess[user.id]}
              onChange={(e) => handleChangeAccessLevel(user.id, e.target.value)}
              className="bg-[var(--paper-2)] border border-[var(--rule)] text-[var(--ink-soft)] text-xs rounded-md px-2 py-1 outline-none focus:border-[var(--accent)]"
            >
              <option value="Can View">Can View</option>
              <option value="Can Edit">Can Edit</option>
              <option value="Full Access">Full Access</option>
            </select>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--paper)] border border-[var(--rule)] rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">
        <div className="p-5 border-b border-[var(--rule)] flex justify-between items-center">
          <h2 className="text-lg font-semibold text-[var(--ink)] font-['Fraunces'] italic">Share "{item.name}"</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--ink)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        
        <div className="p-5 overflow-y-auto flex flex-col gap-4">
          <input
            type="text"
            placeholder="Search firm directory or matter team..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[var(--paper-2)] border border-[var(--rule)] rounded-lg px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)]"
          />

          <div>
            <div className="text-xs font-bold tracking-wider text-[var(--ink-soft)] uppercase mb-1">Current Matter Members</div>
            {renderUserList(MATER_MEMBERS)}
          </div>
          
          <div className="mt-2">
            <div className="text-xs font-bold tracking-wider text-[var(--ink-soft)] uppercase mb-1">Firm Directory</div>
            {renderUserList(FIRM_DIRECTORY)}
          </div>

          {isEthicalWallBreached && (
            <div className="mt-2 p-3 bg-[var(--major-soft)] border border-[var(--major)] rounded-lg flex items-start gap-3">
              <svg className="text-[var(--major)] shrink-0 mt-0.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              <div>
                <div className="text-sm font-bold text-[var(--major)]">Security Override Guard</div>
                <div className="text-xs text-[var(--major)] opacity-90 mt-0.5 leading-relaxed">
                  Adding this user will grant them access to this Matter and update the Ethical Wall.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-[var(--rule)] flex justify-end gap-3 bg-[var(--paper)]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--ink)] bg-transparent hover:bg-[var(--paper-2)] border border-[var(--rule)] rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={() => { alert('Permissions updated.'); onClose(); }} className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] hover:opacity-90 rounded-lg transition-opacity">
            Save Permissions
          </button>
        </div>
      </div>
    </div>
  );
}
