"""
gunicorn.conf.py: read automatically by `gunicorn "app:create_app()"` when it starts in this folder (Render's start command needs no change).

Why this file exists: gunicorn's default worker handles one request at a time and is killed after 30 seconds without a
heartbeat. A single slow request (a live progress stream, a contract upload, an AI call that takes a minute) made the
arbiter kill the worker, and the contract analysis that was running in a background thread of that worker died with it:
the screen then waited for a result that could never come. Threaded workers keep their heartbeat while requests run, so
slow requests no longer take the whole server (and every running job) down with them.
"""
import os

# Worker class is env-selectable so the box can move the SSE/streaming endpoints
# onto an async worker (the real concurrency ceiling — see SCALE_READINESS.md)
# WITHOUT a code change, while keeping gthread as the safe default. 'gevent'
# needs `pip install gevent`; it serves thousands of long-lived connections per
# process instead of pinning one OS thread each. Default is unchanged.
worker_class = os.getenv("GUNICORN_WORKER_CLASS", "gthread")
workers = int(os.getenv("WEB_CONCURRENCY", "1"))     # one process: analysis jobs live inside it, and the free plan has little memory
threads = int(os.getenv("GUNICORN_THREADS", "6"))
# Only consulted by async workers (gevent/eventlet); ignored by gthread. Caps
# concurrent connections per worker so a flood of open SSE streams can't exhaust
# memory unbounded.
worker_connections = int(os.getenv("GUNICORN_WORKER_CONNECTIONS", "1000"))
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))
accesslog = None
