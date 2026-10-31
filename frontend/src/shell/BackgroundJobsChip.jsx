import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJobsStore } from '../stores/useJobsStore.js';

/*
 * Topbar chip that shows how many background jobs (contract analyses)
 * are currently running. Click it to resume viewing the most recent
 * one. Hidden entirely when no job is in flight.
 */
export default function BackgroundJobsChip() {
  const jobs = useJobsStore((s) => s.jobs);
  const rehydrate = useJobsStore((s) => s.rehydrate);
  const navigate = useNavigate();

  // Resume polling for any jobs that were in flight before the reload.
  useEffect(() => { rehydrate(); }, [rehydrate]);

  const entries = Object.entries(jobs || {});
  if (entries.length === 0) return null;

  const [latestId, latest] = entries[entries.length - 1];
  const progress = Math.round(latest?.progress || 0);
  const label = entries.length === 1
    ? `Analysing contract — ${progress}%`
    : `${entries.length} jobs running — ${progress}%`;

  return (
    <button
      type="button"
      className="bgjobs-chip"
      onClick={() => latest?.kind === 'contract' && navigate('/contracts/' + latestId)}
      title="Click to open the most recent running job"
    >
      <span className="bgjobs-chip__dot" />
      <span className="bgjobs-chip__label">{label}</span>
    </button>
  );
}
