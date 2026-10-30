import React, { useState } from 'react';
import DelhiJudgesDirectory from './DelhiJudgesDirectory';
import RohiniCourtDirectory from './RohiniCourtDirectory';
import RohiniNorthWestDirectory from './RohiniNorthWestDirectory'; // <-- Add Import
import styles from './JudgesDirectoryHub.module.css';

export default function JudgesDirectoryHub() {
  const [selectedCourt, setSelectedCourt] = useState('delhi_hc');

  return (
    <div className={styles.hubContainer}>
      <div className={styles.topSelectorBar}>
        <div className={styles.selectorLabel}>Select Court Complex:</div>
        <div className={styles.courtButtons}>
          <button
            className={`${styles.courtBtn} ${selectedCourt === 'delhi_hc' ? styles.activeCourtBtn : ''}`}
            onClick={() => setSelectedCourt('delhi_hc')}
          >
            🏛️ Delhi High Court
          </button>
          <button
            className={`${styles.courtBtn} ${selectedCourt === 'delhi_rohini' ? styles.activeCourtBtn : ''}`}
            onClick={() => setSelectedCourt('delhi_rohini')}
          >
            🏢 Rohini (North District)
          </button>
          {/* Add North-West Button */}
          <button
            className={`${styles.courtBtn} ${selectedCourt === 'delhi_rohini_nw' ? styles.activeCourtBtn : ''}`}
            onClick={() => setSelectedCourt('delhi_rohini_nw')}
          >
            🏢 Rohini (North-West)
          </button>
        </div>
      </div>

      <div className={styles.activeDirectoryCanvas}>
        {selectedCourt === 'delhi_hc' && <DelhiJudgesDirectory/>}
        {selectedCourt === 'delhi_rohini' && <RohiniCourtDirectory/>}
        {selectedCourt === 'delhi_rohini_nw' && <RohiniNorthWestDirectory/>} {/* <-- Render */}
      </div>
    </div>
  );
}
