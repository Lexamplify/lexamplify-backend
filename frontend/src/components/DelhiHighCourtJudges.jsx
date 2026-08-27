import React, { useMemo, useState } from 'react';
import styles from './DelhiHighCourtJudges.module.css';
import delhiJudges from '../data/delhi_judges.json';

// Defensive guard: strips a stray Markdown link `[text](url)` down to the
// URL portion alone before it ever reaches an href attribute. The source
// data is verified clean today, but a link value shaped like that would
// otherwise become part of a literal, broken href string rather than a
// working link — cheap to guard against permanently.
const MARKDOWN_LINK_RE = /^\[.*\]\((.+)\)$/;
const cleanUrl = (raw) => {
  if (!raw) return '';
  const match = MARKDOWN_LINK_RE.exec(raw.trim());
  return match ? match[1] : raw.trim();
};

// Meeting IDs are transcribed inconsistently in the official roster
// ("2512 399 8226" vs "25123998226"), sometimes with trailing notes
// ("... AND PASSWORD: 1234"). Stripping whitespace before comparing lets
// an advocate type the ID exactly as Webex displays it on their own
// screen — with or without spaces — and still find the bench.
const stripSpaces = (s) => (s || '').replace(/\s+/g, '');

const splitEmails = (raw) =>
  (raw || '')
    .split('/')
    .map((e) => e.trim())
    .filter(Boolean);

function JudgeCard({ judge }) {
  const [copied, setCopied] = useState(false);
  const vcLink = cleanUrl(judge.vc_link);
  const emails = splitEmails(judge.email_id);
  const hasMeetingId = Boolean(judge.vc_meeting_id && judge.vc_meeting_id.trim());

  const handleCopyMeetingId = () => {
    if (!hasMeetingId) return;
    navigator.clipboard.writeText(judge.vc_meeting_id.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.roomBadge}>Court Room {judge.court_room}</span>
        <span className={styles.benchType}>{judge.bench_type}</span>
      </div>

      <div className={styles.hmj}>{judge.hmj}</div>

      <hr className={styles.divider} />

      <div className={styles.row}>
        <span className={styles.rowLabel}>Virtual Court</span>
        {vcLink ? (
          <a
            className={styles.vcLink}
            href={vcLink}
            target="_blank"
            rel="noopener noreferrer"
            title={vcLink}
          >
            Join Webex ↗
          </a>
        ) : (
          <span className={styles.muted}>Not available</span>
        )}
      </div>

      <div className={styles.row}>
        <span className={styles.rowLabel}>Meeting ID</span>
        {hasMeetingId ? (
          <span className={styles.meetingId}>
            {judge.vc_meeting_id.trim()}
            <button
              type="button"
              className={styles.copyBtn}
              onClick={handleCopyMeetingId}
              title="Copy meeting ID"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </span>
        ) : (
          <span className={styles.muted}>Not available</span>
        )}
      </div>

      <div className={styles.row}>
        <span className={styles.rowLabel}>Court Master</span>
        {emails.length > 0 ? (
          <span className={styles.emailList}>
            {emails.map((email) => (
              <a key={email} className={styles.emailLink} href={`mailto:${email}`} title={email}>
                {email}
              </a>
            ))}
          </span>
        ) : (
          <span className={styles.muted}>Not available</span>
        )}
      </div>
    </div>
  );
}

function DelhiHighCourtJudges() {
  const [query, setQuery] = useState('');

  const filteredJudges = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return delhiJudges;
    const qDigits = stripSpaces(q);
    return delhiJudges.filter((j) => {
      const textMatch =
        j.hmj.toLowerCase().includes(q) ||
        j.court_room.toLowerCase().includes(q) ||
        j.bench_type.toLowerCase().includes(q) ||
        (j.email_id || '').toLowerCase().includes(q);
      // Meeting-ID matching ignores spaces on both sides — see stripSpaces.
      const meetingIdMatch =
        qDigits.length > 0 && stripSpaces(j.vc_meeting_id).toLowerCase().includes(qDigits);
      return textMatch || meetingIdMatch;
    });
  }, [query]);

  return (
    <div className={styles.panel}>
      <div className={styles.noticeBar}>
        ℹ️ Verified <strong>{delhiJudges.length}-bench</strong> official roster for the Delhi High
        Court's virtual courtrooms. Cross-check against the official cause list before relying on
        any single hearing link.
      </div>

      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search by judge name, court room, bench type, or Webex meeting ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className={styles.resultCount}>
          {filteredJudges.length} of {delhiJudges.length} benches
        </span>
      </div>

      {filteredJudges.length > 0 ? (
        <div className={styles.grid}>
          {filteredJudges.map((judge) => (
            <JudgeCard key={judge.id} judge={judge} />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>No bench matches your search.</div>
      )}
    </div>
  );
}

export default DelhiHighCourtJudges;
