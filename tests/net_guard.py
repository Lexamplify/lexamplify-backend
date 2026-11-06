"""No test may reach the real internet (Pinecone, Groq, Tavily, ...). Only loopback and unix sockets are allowed.

A blocked attempt raises OSError (so code under test behaves as if offline) and is recorded. A test marked `strict_network`
also fails at teardown if ITS OWN thread tried (so swallowing the error does not hide it); every other blocked attempt, from any
thread, is listed in the test summary so the offenders can be found. Set ALLOW_NETWORK_TESTS=1 to switch the guard off.
"""
import socket
import threading

ATTEMPTS: list = []          # (thread id, what) since the current test started
ALL_BLOCKED: dict = {}       # what -> count, for the whole session


def _is_local(host) -> bool:
    if host is None or isinstance(host, (bytes, bytearray)) and not host:
        return True
    h = host.decode() if isinstance(host, (bytes, bytearray)) else str(host)
    return h in ("", "localhost", "testserver", "::1", "0.0.0.0") or h.startswith("127.") or h.startswith("::ffff:127.") \
        or h.endswith(".localhost")


def _record(what: str) -> None:
    ATTEMPTS.append((threading.get_ident(), what))
    ALL_BLOCKED[what] = ALL_BLOCKED.get(what, 0) + 1


def own_attempts() -> list:
    me = threading.get_ident()
    return sorted({w for t, w in ATTEMPTS if t == me})


def install(monkeypatch) -> None:
    ATTEMPTS.clear()
    real_getaddrinfo = socket.getaddrinfo
    real_connect, real_connect_ex = socket.socket.connect, socket.socket.connect_ex

    def getaddrinfo(host, *a, **kw):
        if not _is_local(host):
            _record(f"dns:{host}")
            raise socket.gaierror(socket.EAI_NONAME, "network blocked in tests")
        return real_getaddrinfo(host, *a, **kw)

    def _check(address):
        if isinstance(address, tuple) and address and not _is_local(address[0]):
            _record(f"connect:{address[0]}")
            raise ConnectionRefusedError("network blocked in tests")

    def connect(self, address):
        _check(address)
        return real_connect(self, address)

    def connect_ex(self, address):
        _check(address)
        return real_connect_ex(self, address)

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket.socket, "connect_ex", connect_ex)
