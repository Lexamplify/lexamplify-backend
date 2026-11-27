"""
utils/scale_cache.py
--------------------
A tiny, dependency-light shared cache used for horizontal-scale hardening.

Why this exists
    The app's existing caches (lru_cache, module-level dicts, cachetools) all
    live *inside one process*. The moment you run more than one gunicorn worker
    — let alone more than one box behind a load balancer — those caches stop
    being shared: each process starts cold and re-does the same per-user work,
    and per-process counters (rate limits, revocation) diverge.

    This module gives one shared place to cache across every worker and box:
    Redis when it is reachable, and a bounded in-process dict when it is not,
    so nothing here is ever a hard dependency. If Redis is absent the app
    behaves exactly as before — just without the cross-process sharing.

    Redis is already run for Celery, so no new infrastructure is required; we
    reuse its URL. Everything degrades silently: a Redis hiccup never raises
    into a request path.

Configuration (all optional)
    REDIS_URL / RATELIMIT_STORAGE_URI / CELERY_BROKER_URL
        First one set is used as the Redis endpoint (checked in that order).
    SCALE_CACHE_DISABLED=1
        Force the in-memory fallback even when Redis is reachable (tests).
"""
from __future__ import annotations

import os
import time
import json
import threading
from typing import Any, Optional

_LOCK = threading.Lock()
_CLIENT = None            # the resolved redis client, or False once we've failed
_MEM: dict[str, tuple[float, str]] = {}   # key -> (expiry_epoch, json_value)
_MEM_MAX = 50_000


def _redis_url() -> Optional[str]:
    for var in ("REDIS_URL", "RATELIMIT_STORAGE_URI", "CELERY_BROKER_URL"):
        val = os.getenv(var)
        if val and val.startswith(("redis://", "rediss://")):
            return val
    return None


def _client():
    """Lazily resolve a redis client once. Returns the client, or None if Redis
    is unavailable (we then use the in-memory fallback)."""
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT or None
    if os.getenv("SCALE_CACHE_DISABLED") == "1":
        _CLIENT = False
        return None
    with _LOCK:
        if _CLIENT is not None:
            return _CLIENT or None
        url = _redis_url()
        if not url:
            _CLIENT = False
            return None
        try:
            import redis  # redis-py; already present via Celery
            c = redis.Redis.from_url(
                url, socket_timeout=0.25, socket_connect_timeout=0.25,
                retry_on_timeout=False, decode_responses=True,
            )
            c.ping()
            _CLIENT = c
            return c
        except Exception:
            _CLIENT = False
            return None


# ── in-memory fallback ────────────────────────────────────────────────────
def _mem_set(key: str, value: str, ttl: int) -> None:
    with _LOCK:
        if len(_MEM) >= _MEM_MAX:
            now = time.time()
            for k in [k for k, (exp, _) in _MEM.items() if exp < now][:10_000]:
                _MEM.pop(k, None)
            if len(_MEM) >= _MEM_MAX:            # still full → drop arbitrary oldest
                for k in list(_MEM.keys())[:10_000]:
                    _MEM.pop(k, None)
        _MEM[key] = (time.time() + ttl, value)


def _mem_get(key: str) -> Optional[str]:
    with _LOCK:
        hit = _MEM.get(key)
        if not hit:
            return None
        exp, val = hit
        if exp < time.time():
            _MEM.pop(key, None)
            return None
        return val


# ── public API ────────────────────────────────────────────────────────────
def cache_set(key: str, value: Any, ttl: int = 60) -> None:
    """Store a JSON-serializable value under `key` for `ttl` seconds."""
    try:
        payload = json.dumps(value)
    except (TypeError, ValueError):
        return
    c = _client()
    if c is not None:
        try:
            c.set(key, payload, ex=max(1, int(ttl)))
            return
        except Exception:
            pass
    _mem_set(key, payload, max(1, int(ttl)))


def cache_get(key: str, default: Any = None) -> Any:
    """Return the cached value for `key`, or `default` if missing/expired."""
    c = _client()
    raw = None
    if c is not None:
        try:
            raw = c.get(key)
        except Exception:
            raw = None
    if raw is None:
        raw = _mem_get(key)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def mark_revoked(jti: str, ttl: int) -> None:
    """Record a signed-out token's jti so every worker/box rejects it without a
    DB round-trip. TTL should be the token's remaining lifetime."""
    if not jti:
        return
    cache_set(f"revoked:{jti}", 1, ttl=max(1, int(ttl)))


def revocation_status(jti: str) -> Optional[bool]:
    """Three-valued revocation check against the cache only.
        True  -> known revoked (reject)
        False -> known NOT revoked within the negative-cache window (allow, skip DB)
        None  -> unknown; the caller must fall back to the database.
    """
    if not jti:
        return None
    if cache_get(f"revoked:{jti}") is not None:
        return True
    if cache_get(f"ok:{jti}") is not None:
        return False
    return None


def mark_not_revoked(jti: str, ttl: int = 45) -> None:
    """Negative-cache a 'not revoked' result briefly so the common path skips the
    DB. Kept short so a revocation that races this write is still caught within
    `ttl` seconds at worst."""
    if not jti:
        return
    cache_set(f"ok:{jti}", 1, ttl=max(1, int(ttl)))


def available() -> bool:
    """True if a real shared (Redis) cache is in use — for diagnostics/health."""
    return _client() is not None
