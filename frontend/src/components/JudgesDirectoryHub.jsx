import React, { useState } from 'react';
import DelhiJudgesDirectory from './DelhiJudgesDirectory';
import RohiniCourtDirectory from './RohiniCourtDirectory';
import styles from './JudgesDirectoryHub.module.css';

export default function JudgesDirectoryHub() {
  const [selectedCourt, setSelectedCourt] = useState('delhi_hc');

  return (
    <div className={styles.hubContainer}>
      {/* Top Directory Selection Switcher */}
      <div className={styles.topSelectorBar}>
        <div className={styles.selectorLabel}>Select Court Complex:</div>
        <div className={styles.courtButtons}>
          <button
            className={`${styles.courtBtn} ${selectedCourt === 'delhi_hc' ? styles.activeCourtBtn : ''}`}
            onClick={() => setSelectedCourt('delhi_hc')}
          >
            🏛️ Delhi High Court (30 Benches)
          </button>
          <button
            className={`${styles.courtBtn} ${selectedCourt === 'delhi_rohini' ? styles.activeCourtBtn : ''}`}
            onClick={() => setSelectedCourt('delhi_rohini')}
          >
            🏢 Rohini District Court — North District
          </button>
        </div>
      </div>

      {/* Directory Router */}
      <div className={styles.activeDirectoryCanvas}>
        {selectedCourt === 'delhi_hc' && <DelhiJudgesDirectory/>}
        {selectedCourt === 'delhi_rohini' && <RohiniCourtDirectory/>}
      </div>
    </div>
  );
}
