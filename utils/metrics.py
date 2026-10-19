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


def rss_mb():
    """Memory this server process uses right now, in MB (0 when it cannot be read). The free Render plan stops the
    whole service at 512 MB, so the analyzer refuses new work before that and /api/status shows the number."""
    try:
        with open("/proc/self/statm") as f:                     # Linux (Render)
            pages = int(f.read().split()[1])
        return int(pages * 4096 / 1048576)
    except Exception:  # noqa: BLE001
        pass
    try:                                                         # Windows (local development)
        import ctypes
        from ctypes import wintypes

        class _PMC(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t),
                        ("WorkingSetSize", ctypes.c_size_t), ("a", ctypes.c_size_t), ("b", ctypes.c_size_t), ("c", ctypes.c_size_t),
                        ("d", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
        c = _PMC()
        c.cb = ctypes.sizeof(c)
        k = ctypes.WinDLL("kernel32")
        k.GetCurrentProcess.restype = ctypes.c_void_p
        p = ctypes.WinDLL("psapi")
        p.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(_PMC), wintypes.DWORD]
        p.GetProcessMemoryInfo(k.GetCurrentProcess(), ctypes.byref(c), c.cb)
        return int(c.WorkingSetSize / 1048576)
    except Exception:  # noqa: BLE001
        return 0
