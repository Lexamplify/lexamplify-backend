import React, { useState, useMemo } from 'react';
import delhiJudges from '../data/delhi_judges.json';
import styles from './DelhiJudgesDirectory.module.css';

export default function DelhiJudgesDirectory() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [copiedId, setCopiedId] = useState(null);

  const filteredJudges = useMemo(() => {
    return delhiJudges.filter((judge) => {
      const query = searchTerm.toLowerCase();
      // Remove spaces from meeting ID and search query to allow robust searching (e.g. "1234 56" matches "123456")
      const rawMeetingId = judge.vc_meeting_id ? judge.vc_meeting_id.replace(/\s+/g, '').toLowerCase() : '';
      const rawQuery = query.replace(/\s+/g, '');

      const matchesSearch =
        judge.hmj.toLowerCase().includes(query) ||
        judge.court_room.toLowerCase().includes(query) ||
        rawMeetingId.includes(rawQuery) ||
        (judge.email_id && judge.email_id.toLowerCase().includes(query));

      if (filterType === 'DB') return matchesSearch && judge.bench_type.includes('Division');
      if (filterType === 'SINGLE') return matchesSearch && judge.bench_type === 'Single Bench';
      return matchesSearch;
    });
  }, [searchTerm, filterType]);

  const copyToClipboard = (text, id, label) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(`${id}-${label}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Delhi High Court — Judicial Roster & VC Directory</h2>
          <p className={styles.subtitle}>
            Virtual Court Webex links, Meeting IDs, and Court Master channels for urgent listings & memos
          </p>
        </div>
        <div className={styles.statsBadge}>
          {filteredJudges.length} Active Benches
        </div>
      </header>

      {/* Filter and Search Bar */}
      <div className={styles.searchBarWrapper}>
        <div className={styles.searchInputContainer}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" strokeWidth="2" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" strokeWidth="2" />
          </svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by Judge name, Court Room, Meeting ID, or Court Master email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className={styles.clearBtn} onClick={() => setSearchTerm('')} title="Clear">✕</button>
          )}
        </div>

        <div className={styles.filterPills}>
          <button
            className={`${styles.pill} ${filterType === 'ALL' ? styles.activePill : ''}`}
            onClick={() => setFilterType('ALL')}
          >
            All Courts ({delhiJudges.length})
          </button>
          <button
            className={`${styles.pill} ${filterType === 'DB' ? styles.activePill : ''}`}
            onClick={() => setFilterType('DB')}
          >
            Division Benches (9)
          </button>
          <button
            className={`${styles.pill} ${filterType === 'SINGLE' ? styles.activePill : ''}`}
            onClick={() => setFilterType('SINGLE')}
          >
            Single Benches (21)
          </button>
        </div>
      </div>

      {/* Roster Cards Grid */}
      <div className={styles.grid}>
        {filteredJudges.map((judge) => (
          <div key={judge.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.courtBadge}>Court {judge.court_room}</span>
              <span className={styles.benchTag}>{judge.bench_type}</span>
            </div>

            <h3 className={styles.judgeName}>{judge.hmj}</h3>

            <div className={styles.detailsList}>
              {/* Meeting ID Row */}
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Meeting ID:</span>
                <span className={styles.detailValue}>
                  {judge.vc_meeting_id ? (
                    <code>{judge.vc_meeting_id}</code>
                  ) : (
                    <span className={styles.autoJoinText}>Direct Link / Browser Join</span>
                  )}
                </span>
                {judge.vc_meeting_id && (
                  <button
                    className={styles.inlineCopyBtn}
                    onClick={() => copyToClipboard(judge.vc_meeting_id, judge.id, 'id')}
                    title="Copy Meeting ID"
                  >
                    {copiedId === `${judge.id}-id` ? '✓ Copied' : 'Copy'}
                  </button>
                )}
              </div>

              {/* Email / Court Master Row */}
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Court Master:</span>
                {judge.email_id ? (
                  <a
                    href={`mailto:${judge.email_id.split('/')[0].trim()}?subject=Mentioning%20Memo%20/%20Urgent%20Listing`}
                    className={styles.emailLink}
                    title="Send Mentioning Memo"
                  >
                    {judge.email_id}
                  </a>
                ) : (
                  <span className={styles.autoJoinText}>Physical Registry</span>
                )}
              </div>
            </div>

            {/* Direct Action Buttons */}
            <div className={styles.cardActions}>
              <a
                href={judge.vc_link}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.joinBtn}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                </svg>
                Join Virtual Court
              </a>
              <button
                className={styles.copyLinkBtn}
                onClick={() => copyToClipboard(judge.vc_link, judge.id, 'link')}
              >
                {copiedId === `${judge.id}-link` ? '✓ Copied Link' : 'Copy VC Link'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
