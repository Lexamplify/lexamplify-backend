import os
import json
import tempfile
import threading
import time
import uuid
import logging

logger = logging.getLogger(__name__)
JOB_DIR = os.path.join(tempfile.gettempdir(), "lexamplify_jobs")
os.makedirs(JOB_DIR, exist_ok=True)

_LOCK = threading.RLock()          # one read-modify-write at a time inside this process (the heartbeat and the job both write)
_SAFE = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")


def _path(job_id):
    """Job ids come from the URL: refuse anything that could leave the job folder."""
    jid = str(job_id or "")
    if not jid or len(jid) > 80 or any(ch not in _SAFE for ch in jid):
        return None
    return os.path.join(JOB_DIR, f"{jid}.json")


def save_local_job(job_id, data):
    """Atomically write job state to disk using unique temp file per write."""
    target = _path(job_id)
    if not target:
        return False
    try:
        temp_file = f"{target}.tmp.{os.getpid()}.{uuid.uuid4().hex}"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(temp_file, target)
        return True
    except Exception as e:
        logger.error(f"Failed to save local job {job_id}: {e}", exc_info=True)
        return False


def get_local_job(job_id):
    """Read job state from atomic disk store."""
    target = _path(job_id)
    if not target or not os.path.exists(target):
        return None
    try:
        with open(target, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


# Backward-compatible aliases
save_job = save_local_job
load_job = get_local_job


def update_job(job_id: str, **kwargs) -> dict:
    """Merge fields into a job and stamp `updated_at` (the heartbeat that tells a live job from an abandoned one).

    Honors two optional job-local fields set by the orchestrator:
      * `progress_min` — any incoming `progress` below this is lifted up
        to the floor. Lets a wrapper (e.g. /analyze-file after OCR
        finishes at 40%) keep the task's own 5–95% scale from LOOKING
        like a regression even though the task has no idea an OCR
        stage ran first.
      * `progress_scale` — a (lo, hi) tuple; the incoming 0–100 is
        re-mapped into [lo, hi]. Preferred over progress_min when the
        wrapper wants a smooth stretch instead of a floor.
    Both are read from the on-disk job state so a Celery worker in
    another process still obeys them.
    """
    with _LOCK:
        job = get_local_job(job_id) or {}
        if "progress" in kwargs and isinstance(kwargs["progress"], (int, float)):
            p = float(kwargs["progress"])
            scale = job.get("progress_scale")
            if isinstance(scale, (list, tuple)) and len(scale) == 2:
                lo, hi = float(scale[0]), float(scale[1])
                p = lo + (hi - lo) * max(0.0, min(100.0, p)) / 100.0
            floor = job.get("progress_min")
            if isinstance(floor, (int, float)) and p < float(floor):
                p = float(floor)
            kwargs["progress"] = int(round(p))
        job.update(kwargs)
        job["updated_at"] = time.time()
        save_local_job(job_id, job)
        return job


def delete_old_jobs(max_age_seconds=6 * 3600):
    """Housekeeping: finished or abandoned job files older than this are removed (they hold the contract text)."""
    cutoff = time.time() - max_age_seconds
    try:
        for name in os.listdir(JOB_DIR):
            p = os.path.join(JOB_DIR, name)
            try:
                if os.path.getmtime(p) < cutoff:
                    os.remove(p)
            except OSError:
                pass
    except OSError:
        pass
