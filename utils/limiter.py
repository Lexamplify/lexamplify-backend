"""
utils/limiter.py
Shared Flask-Limiter instance — separate module so both app.py and route
blueprints can import it without a circular import through create_app().

Storage: in-memory by default (single process). To make rate limits hold
across every gunicorn worker and box, point the limiter at the shared Redis
you already run for Celery by setting RATELIMIT_STORAGE_URI (or REDIS_URL /
CELERY_BROKER_URL) to a redis:// URL. Without it, behaviour is unchanged —
per-process in-memory counters, as before.
"""
import os
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address


def _storage_uri():
    for var in ("RATELIMIT_STORAGE_URI", "REDIS_URL", "CELERY_BROKER_URL"):
        val = os.getenv(var)
        if val and val.startswith(("redis://", "rediss://")):
            return val
    return None


# `storage_uri=None` keeps Flask-Limiter's in-memory default; a redis:// URL
# switches it to shared storage with no other code change.
limiter = Limiter(key_func=get_remote_address, default_limits=[], storage_uri=_storage_uri())
