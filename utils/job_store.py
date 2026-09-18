import json
import os
import tempfile

JOB_DIR = os.path.join(tempfile.gettempdir(), "lexamplify_jobs")
os.makedirs(JOB_DIR, exist_ok=True)


def save_job(job_id: str, data: dict) -> bool:
    """
    Atomically writes job state to disk.
    Safe across multiple Gunicorn workers / processes on Render or local.
    """
    if not job_id:
        return False
    try:
        target_path = os.path.join(JOB_DIR, f"{job_id}.json")
        temp_path = f"{target_path}.tmp.{os.getpid()}"
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(temp_path, target_path)
        return True
    except Exception as e:
        print(f"[job_store] Failed to save job {job_id}: {e}")
        return False


def load_job(job_id: str) -> dict:
    """
    Reads job state from disk.
    Returns None if the job file does not exist or cannot be parsed.
    """
    if not job_id:
        return None
    target_path = os.path.join(JOB_DIR, f"{job_id}.json")
    if not os.path.exists(target_path):
        return None
    try:
        with open(target_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError, Exception) as e:
        print(f"[job_store] Failed to load job {job_id}: {e}")
        return None


def update_job(job_id: str, **kwargs) -> dict:
    """
    Convenience method to load, update, and atomically save a job.
    """
    job = load_job(job_id) or {}
    job.update(kwargs)
    save_job(job_id, job)
    return job
