import React, { useState, useMemo } from 'react';
import bailData from '../data/delhi_rohini_north_west_bail_roster.json';
import leaveData from '../data/delhi_rohini_north_west_leave.json';
import { useJudgesDirectory } from '../hooks/useJudgesDirectory';
import styles from './RohiniNorthWestDirectory.module.css';

export default function RohiniNorthWestDirectory() {
  const { judges: judgesData, isLoading, error, refetch } = useJudgesDirectory('delhi_rohini_nw');
  const [activeFolder, setActiveFolder] = useState('judges');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const copyText = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredJudges = useMemo(() => {
    const q = searchTerm.toLowerCase().replace(/\s+/g, '');
    return judgesData.filter((j) => {
      const matchName = j.hmj?.toLowerCase().includes(searchTerm.toLowerCase()) || false;
      const matchRoom = j.court_room?.toLowerCase().includes(searchTerm.toLowerCase()) || false;
      const matchDesig = j.designation?.toLowerCase().includes(searchTerm.toLowerCase()) || false;
      const rawMeeting = j.vc_meeting_id ? j.vc_meeting_id.replace(/\s+/g, '').toLowerCase() : '';
      return matchName || matchRoom || matchDesig || rawMeeting.includes(q);
    });
  }, [searchTerm, judgesData]);

  const filteredBail = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return bailData.filter((b) => {
      const matchPS = b.police_stations?.some((ps) => ps.toLowerCase().includes(q)) || false;
      const matchJudge = b.presiding_officer?.toLowerCase().includes(q) || false;
      return matchPS || matchJudge;
    });
  }, [searchTerm]);

  const dutyMagistratePdfUrl = "https://lawyers4lawyers.org.in/admin/images/blog/1777697509media.pdf";

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <div className={styles.badgeRow}>
            <span className={styles.districtBadge}>North-West District</span>
            <span className={styles.complexBadge}>Rohini Court Complex</span>
          </div>
          <h2 className={styles.title}>Rohini North-West — Judicial Roster & Directories</h2>
          <p className={styles.subtitle}>
            Regular Courts, Link Judge Bail Rosters, Leave Status, and Duty Magistrate Orders
          </p>
        </div>
      </header>

      <nav className={styles.folderNav}>
        <button
          className={`${styles.folderTab} ${activeFolder === 'judges' ? styles.activeFolderTab : ''}`}
          onClick={() => { setActiveFolder('judges'); setSearchTerm(''); }}
        >
          👨‍⚖️ Judges List ({isLoading ? '...' : judgesData.length})
        </button>
        <button
          className={`${styles.folderTab} ${activeFolder === 'bail' ? styles.activeFolderTab : ''}`}
          onClick={() => { setActiveFolder('bail'); setSearchTerm(''); }}
        >
          ⚖️ Bail Roster ({bailData.length} Benches)
        </button>
        <button
          className={`${styles.folderTab} ${activeFolder === 'leave' ? styles.activeFolderTab : ''}`}
          onClick={() => { setActiveFolder('leave'); setSearchTerm(''); }}
        >
          🏖️ Judges on Leave ({leaveData.length})
        </button>
        <button
          className={`${styles.folderTab} ${activeFolder === 'duty' ? styles.activeFolderTab : ''}`}
          onClick={() => { setActiveFolder('duty'); setSearchTerm(''); }}
        >
          📑 Duty Magistrate Roster (PDF)
        </button>
      </nav>

      {activeFolder !== 'duty' && activeFolder !== 'leave' && (
        <div className={styles.searchWrapper}>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" strokeWidth="2" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" strokeWidth="2" />
          </svg>
          <input
            type="text"
            className={`${styles.searchInput} lx-input`}
            placeholder={
              activeFolder === 'bail'
                ? "Search by Police Station or Judge..."
                : "Search by Judge name, Designation, Court Room, or Meeting ID..."
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      )}

      {activeFolder === 'judges' && (
        <div className={styles.grid}>
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={`skel-${i}`} className={styles.skeletonCard}>
                <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
                <div className={`${styles.skeletonLine} ${styles.skeletonLineFull}`} />
                <div className={`${styles.skeletonLine} ${styles.skeletonLineFull}`} />
                <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
              </div>
            ))
          ) : error && judgesData.length === 0 ? (
            <div className={styles.errorBanner}>
              Couldn't load the judges list ({error}).{' '}
              <button className={styles.miniCopy} onClick={refetch}>Retry</button>
            </div>
          ) : (
            filteredJudges.map((j) => (
            <div key={j.id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.courtBadge}>Court Room {j.court_room}</span>
                <span className={styles.desigTag}>{j.designation}</span>
              </div>
              <h3 className={styles.judgeName}>{j.hmj}</h3>
              <div className={styles.metaBox}>
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>VC Meeting ID:</span>
                  <span className={styles.metaVal}><code>{j.vc_meeting_id}</code></span>
                  <button className={styles.miniCopy} onClick={() => copyText(j.vc_meeting_id, `${j.id}-id`)}>
                    {copiedId === `${j.id}-id` ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Reader / CM:</span>
                  <a href={`mailto:${j.email_id}`} className={styles.emailLink}>{j.email_id}</a>
                </div>
              </div>
              <div className={styles.cardActions}>
                <a href={j.vc_link} target="_blank" rel="noreferrer" className={styles.joinBtn}>Join Virtual Court</a>
                <button className={styles.copyBtn} onClick={() => copyText(j.vc_link, `${j.id}-link`)}>
                  {copiedId === `${j.id}-link` ? '✓ Copied' : 'Copy VC Link'}
                </button>
              </div>
            </div>
            ))
          )}
        </div>
      )}

      {activeFolder === 'bail' && (
        <div className={styles.bailList}>
          {filteredBail.map((b) => (
            <div key={b.id} className={styles.bailCard}>
              <div className={styles.bailHeader}>
                <div>
                  <span className={styles.courtBadge}>Court Room {b.court_room}</span>
                  <h3 className={styles.bailJudge}>{b.presiding_officer}</h3>
                  <span className={styles.desigTag}>{b.designation}</span>
                </div>
                <div className={styles.psBox}>
                  <div className={styles.psLabel}>Jurisdiction / Police Stations:</div>
                  <div className={styles.psTags}>
                    {b.police_stations.map((ps) => (
                      <span key={ps} className={styles.psBadge}>📍 {ps}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className={styles.linkJudgesContainer}>
                <div className={styles.linkBox}>
                  <span className={styles.linkTitle}>1st Link Judge:</span>
                  <span className={styles.linkName}>{b.first_link}</span>
                </div>
                <div className={styles.linkBox}>
                  <span className={styles.linkTitle}>2nd Link Judge:</span>
                  <span className={styles.linkName}>{b.second_link}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeFolder === 'leave' && (
        <div className={styles.leaveList}>
          {leaveData.map((l) => (
            <div key={l.id} className={styles.leaveCard}>
              <div className={styles.leaveHeader}>
                <div className={styles.leaveStatusPill}>🔴 {l.status} ({l.leave_date})</div>
                <span className={styles.courtBadge}>Court Room {l.court_room}</span>
              </div>
              <h3 className={styles.leaveJudgeName}>{l.judge_name}</h3>
              <div className={styles.desigTag}>{l.designation}</div>
              <div className={styles.transferBox}>
                <div className={styles.transferArrow}>↳ Matters Assigned to Link Judge:</div>
                <div className={styles.assignedLinkName}>{l.link_judge}</div>
                <p className={styles.leaveInstructions}>{l.instructions}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeFolder === 'duty' && (
        <div className={styles.pdfContainer}>
          <div className={styles.pdfHeaderActions}>
            <div>
              <h3 className={styles.pdfTitle}>Official Duty Magistrate Monthly Order — North-West</h3>
            </div>
            <a href={dutyMagistratePdfUrl} target="_blank" rel="noreferrer" className={styles.downloadPdfBtn}>
              📥 Open / Download Official PDF
            </a>
          </div>
          <iframe src={`${dutyMagistratePdfUrl}#toolbar=0`} title="Duty Magistrate Roster" className={styles.pdfIframe} />
        </div>
      )}
    </div>
  );
}
