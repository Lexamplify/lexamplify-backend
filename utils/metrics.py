"""Small in-process counters for /api/status. They reset when the server restarts, which is stated on the status page.

Not a replacement for a metrics service: it answers 'is it healthy right now and how has it behaved since it started'.
"""
import threading
import time

_lock = threading.Lock()
_started = time.time()
_counts = {}
_latency = {}


def count(name, n=1):
    with _lock:
        _counts[name] = _counts.get(name, 0) + n


def observe(name, seconds):
    with _lock:
        total, n, worst = _latency.get(name, (0.0, 0, 0.0))
        _latency[name] = (total + seconds, n + 1, max(worst, seconds))


def snapshot():
    with _lock:
        lat = {k: {"count": n, "average_seconds": round(t / n, 3) if n else 0, "slowest_seconds": round(w, 3)} for k, (t, n, w) in _latency.items()}
        return {"since": _started, "uptime_seconds": int(time.time() - _started), "counts": dict(_counts), "latency": lat}
