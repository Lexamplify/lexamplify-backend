"""
utils/dms_store.py - content-addressed file store for the Document Hub.

Why not SQLite BLOBs (what /api/vault/documents/upload does today): a firm with
thousands of PDFs would put gigabytes inside lex_assistant.db, which is also the
database every other feature shares. Files live on disk instead, named after their
SHA-256, so the same bytes are only ever stored once no matter how many vault rows
point at them.

Layout:   <root>/ab/cd/<sha256>        plain file
          <root>/ab/cd/<sha256>.enc    same bytes, encrypted (only when DMS_ENCRYPTION_KEY is set)

Encryption at rest is optional and honest about what it is: the files on disk are
unreadable without DMS_ENCRYPTION_KEY, but the extracted text used for search lives in
the database (search cannot work over ciphertext), so this protects a stolen disk or
backup of the file store, not a stolen database. It is NOT end-to-end encryption.

Everything streams in 1 MiB chunks, so a 100 MB upload never sits in memory twice.
"""
import contextlib
import hashlib
import os
import shutil
import struct
import tempfile

CHUNK = 1024 * 1024
_MAGIC = b"LXE1"


class StoreError(Exception):
    """Raised with a message that is safe to show to the user."""


def storage_root():
    root = os.getenv("DMS_STORAGE_DIR")
    if not root:
        persistent = os.getenv("PERSISTENT_DATA_DIR")
        root = os.path.join(persistent, "dms_files") if persistent and os.path.isdir(persistent) \
            else os.path.join("instance", "dms_files")
    os.makedirs(root, exist_ok=True)
    return root


def storage_info():
    """Where files live and whether that place survives a redeploy. On a host with an ephemeral disk (Render
    without a Persistent Disk) every uploaded file would vanish at the next deploy - the screen warns loudly."""
    root = storage_root()
    explicit = bool(os.getenv("DMS_STORAGE_DIR"))
    pdd = os.getenv("PERSISTENT_DATA_DIR")
    on_disk = bool(pdd and os.path.isdir(pdd) and os.path.realpath(root).startswith(os.path.realpath(pdd)))
    hosted = bool(os.getenv("RENDER") or os.getenv("DYNO") or os.getenv("K_SERVICE") or os.getenv("FLY_APP_NAME"))
    persistent = explicit or on_disk
    try:
        free = shutil.disk_usage(root).free
    except OSError:
        free = None
    return {"persistent": persistent, "at_risk": hosted and not persistent, "free_bytes": free,
            "location": "custom" if explicit else ("persistent disk" if on_disk else "local disk")}


def _fernet():
    key = os.getenv("DMS_ENCRYPTION_KEY", "").strip()
    if not key:
        return None
    try:
        from cryptography.fernet import Fernet
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as exc:  # malformed key must fail loudly, never silently store plaintext
        raise StoreError("DMS_ENCRYPTION_KEY is set but is not a valid Fernet key. "
                         "Generate one with: python -c \"from cryptography.fernet import Fernet; "
                         "print(Fernet.generate_key().decode())\"") from exc


def encryption_enabled():
    try:
        return _fernet() is not None
    except StoreError:
        return False


def encryption_error():
    """None when the key is absent or valid, otherwise the message to show an admin."""
    try:
        _fernet()
        return None
    except StoreError as exc:
        return str(exc)


def key_for(sha):
    return f"{sha[:2]}/{sha[2:4]}/{sha}"


def path_for(key, enc=False):
    return os.path.join(storage_root(), key.replace("/", os.sep)) + (".enc" if enc else "")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def spool_upload(file_storage, max_bytes):
    """Stream a werkzeug FileStorage to a temp file while hashing it.
    Returns (tmp_path, sha256, size). Raises StoreError if it is empty or too big."""
    root = storage_root()
    tmp_dir = os.path.join(root, "_incoming")
    os.makedirs(tmp_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix="up_", dir=tmp_dir)
    h = hashlib.sha256()
    size = 0
    try:
        with os.fdopen(fd, "wb") as out:
            stream = file_storage.stream
            while True:
                block = stream.read(CHUNK)
                if not block:
                    break
                size += len(block)
                if size > max_bytes:
                    raise StoreError(f"File is larger than the {max_bytes // (1024 * 1024)} MB limit.")
                h.update(block)
                out.write(block)
        if size == 0:
            raise StoreError("File is empty (0 bytes).")
        return tmp_path, h.hexdigest(), size
    except Exception:
        with contextlib.suppress(OSError):
            os.remove(tmp_path)
        raise


def commit(tmp_path, sha):
    """Move a spooled upload into the store. Returns (key, enc). Idempotent: if the same
    bytes are already stored in the current mode, the temp file is simply discarded."""
    f = _fernet()
    key = key_for(sha)
    enc = f is not None
    dest = path_for(key, enc)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest):
        with contextlib.suppress(OSError):
            os.remove(tmp_path)
        return key, enc
    part = dest + f".part{os.getpid()}"
    try:
        if not enc:
            shutil.move(tmp_path, part)
        else:
            with open(tmp_path, "rb") as src, open(part, "wb") as out:
                out.write(_MAGIC)
                for block in iter(lambda: src.read(CHUNK), b""):
                    token = f.encrypt(block)
                    out.write(struct.pack(">I", len(token)))
                    out.write(token)
            os.remove(tmp_path)
        os.replace(part, dest)
    except Exception:
        for p in (tmp_path, part):
            with contextlib.suppress(OSError):
                os.remove(p)
        raise
    return key, enc


def exists(key, enc=False):
    return bool(key) and os.path.exists(path_for(key, enc))


def _decrypt_to(path, out_path):
    f = _fernet()
    if f is None:
        raise StoreError("This file is encrypted and DMS_ENCRYPTION_KEY is not set on the server.")
    from cryptography.fernet import InvalidToken
    with open(path, "rb") as src, open(out_path, "wb") as out:
        if src.read(4) != _MAGIC:
            raise StoreError("Stored file is corrupted (bad header).")
        while True:
            head = src.read(4)
            if not head:
                break
            (n,) = struct.unpack(">I", head)
            try:
                out.write(f.decrypt(src.read(n)))
            except InvalidToken as exc:
                raise StoreError("Could not decrypt this file - DMS_ENCRYPTION_KEY does not match "
                                 "the key it was stored with.") from exc


@contextlib.contextmanager
def open_plain(key, enc=False):
    """Yield a real filesystem path holding the plaintext bytes (the stored file itself when
    unencrypted, a short-lived decrypted temp copy otherwise)."""
    if not exists(key, enc):
        raise StoreError("The stored file is missing from disk. Restore it from backup.")
    src = path_for(key, enc)
    if not enc:
        yield src
        return
    tmp_dir = os.path.join(storage_root(), "_incoming")
    os.makedirs(tmp_dir, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="dec_", dir=tmp_dir)
    os.close(fd)
    try:
        _decrypt_to(src, tmp)
        yield tmp
    finally:
        with contextlib.suppress(OSError):
            os.remove(tmp)


def remove(key, enc=False):
    with contextlib.suppress(OSError):
        os.remove(path_for(key, enc))


def disk_usage_bytes():
    total = 0
    for base, _dirs, files in os.walk(storage_root()):
        if os.path.basename(base) == "_incoming":
            continue
        for name in files:
            with contextlib.suppress(OSError):
                total += os.path.getsize(os.path.join(base, name))
    return total


def sweep_incoming(max_age_seconds=6 * 3600):
    """Delete abandoned spool files (crashed uploads / decrypt temps)."""
    import time
    tmp_dir = os.path.join(storage_root(), "_incoming")
    if not os.path.isdir(tmp_dir):
        return 0
    now, removed = time.time(), 0
    for name in os.listdir(tmp_dir):
        p = os.path.join(tmp_dir, name)
        with contextlib.suppress(OSError):
            if now - os.path.getmtime(p) > max_age_seconds:
                os.remove(p)
                removed += 1
    return removed
