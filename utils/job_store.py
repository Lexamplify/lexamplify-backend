import os
import json
import tempfile
import uuid
import logging

logger = logging.getLogger(__name__)
JOB_DIR = os.path.join(tempfile.gettempdir(), "lexamplify_jobs")
os.makedirs(JOB_DIR, exist_ok=True)


def save_local_job(job_id, data):
    """Atomically write job state to disk using unique temp file per write."""
    if not job_id:
        return False
    try:
        target = os.path.join(JOB_DIR, f"{job_id}.json")
        unique_id = uuid.uuid4().hex
        temp_file = f"{target}.tmp.{os.getpid()}.{unique_id}"
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(temp_file, target)
        return True
    except Exception as e:
        logger.error(f"Failed to save local job {job_id}: {e}", exc_info=True)
        return False


def get_local_job(job_id):
    """Read job state from atomic disk store."""
    if not job_id:
        return None
    target = os.path.join(JOB_DIR, f"{job_id}.json")
    if not os.path.exists(target):
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
    job = get_local_job(job_id) or {}
    job.update(kwargs)
    save_local_job(job_id, job)
    return job
