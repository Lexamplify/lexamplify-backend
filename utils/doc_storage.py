"""
utils/doc_storage.py - where the bytes of a Case Vault document live.

Today every vault document is a SQLite BLOB in ``case_vault.file_blob`` (lex_assistant.db). On Render that file is
wiped on redeploy unless it sits on an attached Persistent Disk, and nobody has yet confirmed that it does. This
module is the one place that decides where new bytes go, so the owner can switch without touching the routes:

    DOC_STORAGE=sqlite   (default)  the blob is returned unchanged and stays in the row - exactly today's behaviour.
    DOC_STORAGE=disk                the blob is written to DOC_STORAGE_DIR (default data/blobs, or
                                    $PERSISTENT_DATA_DIR/blobs when that is a directory) and a small text
                                    reference is stored in the row instead:
                                        @lexblob:v1:<size>:<sha256>:<yyyy>/<mm>/<uuid>.<ext>

Reads are backend-independent: ``resolve()`` hands back the row value when it is a real blob, and the file's bytes
when it is a reference, so rows written under either setting keep opening after the setting changes. A reference
whose file is gone resolves to None and the caller falls back to whatever else it has (the Document Hub copy,
or an honest "no file stored" answer) - nothing is invented.

If the disk write itself fails, ``store()`` logs it and returns the raw blob, so the document is still saved in the
row: durability first, the setting second.

``status()`` is what GET /api/status shows under "storage": the backend, the directory and whether it is writable,
so the owner can see from the outside whether the deployed disk really persists.
"""
import hashlib
import logging
import os
import tempfile
import uuid
from datetime import datetime

_log = logging.getLogger(__name__)

MARKER = b"@lexblob:v1:"
MAX_MARKER_LEN = 512
DEFAULT_DIR = os.path.join("data", "blobs")
BACKENDS = ("sqlite", "disk")


def backend():
    """'sqlite' or 'disk'. Anything unknown counts as 'sqlite' (the safe default) and is reported as such."""
    value = (os.getenv("DOC_STORAGE") or "sqlite").strip().lower()
    return value if value in BACKENDS else "sqlite"


def storage_dir():
    root = (os.getenv("DOC_STORAGE_DIR") or "").strip()
    if not root:
        persistent = (os.getenv("PERSISTENT_DATA_DIR") or "").strip()
        root = os.path.join(persistent, "blobs") if persistent and os.path.isdir(persistent) else DEFAULT_DIR
    return os.path.abspath(root)


def is_ref(raw):
    """True when a case_vault.file_blob value is a reference to a file, not the file itself."""
    if raw is None:
        return False
    try:
        head = bytes(raw[: len(MARKER)])
    except TypeError:
        return False
    return head == MARKER and len(raw) <= MAX_MARKER_LEN


def _parse(raw):
    """-> (size, sha256, relpath) or None when the marker is malformed."""
    try:
        body = bytes(raw)[len(MARKER):].decode("ascii")
        size, sha, rel = body.split(":", 2)
        size = int(size)
    except (ValueError, UnicodeDecodeError):
        return None
    if size < 0 or len(sha) != 64 or not rel:
        return None
    return size, sha, rel


def _path_for(rel):
    """Absolute path of a stored file, or None when the reference would escape the storage directory."""
    root = storage_dir()
    full = os.path.abspath(os.path.join(root, *rel.split("/")))
    try:
        inside = os.path.commonpath([root, full]) == root
    except ValueError:          # different drives on Windows
        inside = False
    if not inside or full == root:
        return None
    return full


def _clean_ext(ext):
    ext = "".join(ch for ch in (ext or "").lower().lstrip(".") if ch.isalnum())[:8]
    return ext or "bin"


def store(blob, ext="", log=None):
    """Returns the value to put in case_vault.file_blob for these bytes: the bytes themselves (sqlite backend, or a
    disk write that failed) or a reference marker (disk backend)."""
    if blob is None:
        return None
    blob = bytes(blob)
    if backend() != "disk":
        return blob
    now = datetime.utcnow()
    rel = f"{now:%Y}/{now:%m}/{uuid.uuid4().hex}.{_clean_ext(ext)}"
    full = _path_for(rel)
    try:
        os.makedirs(os.path.dirname(full), exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".part-", dir=os.path.dirname(full))
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(blob)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, full)
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise
    except OSError as exc:
        (log or _log.warning)(f"doc_storage: disk write failed ({exc.__class__.__name__}); keeping the document in the database row")
        return blob
    sha = hashlib.sha256(blob).hexdigest()
    return MARKER + f"{len(blob)}:{sha}:{rel}".encode("ascii")


def resolve(raw, log=None):
    """The document's bytes for a case_vault.file_blob value: the value itself when it is a blob, the file's bytes when
    it is a reference, None when the reference cannot be honoured (missing or corrupt file). None stays None."""
    if raw is None:
        return None
    if not is_ref(raw):
        return bytes(raw)
    parsed = _parse(raw)
    if parsed is None:
        (log or _log.warning)("doc_storage: malformed blob reference in case_vault")
        return None
    size, sha, rel = parsed
    path = _path_for(rel)
    if path is None:
        (log or _log.warning)("doc_storage: blob reference points outside the storage directory; refused")
        return None
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as exc:
        (log or _log.warning)(f"doc_storage: stored file missing or unreadable ({exc.__class__.__name__}): {rel}")
        return None
    if len(data) != size or hashlib.sha256(data).hexdigest() != sha:
        (log or _log.warning)(f"doc_storage: stored file does not match its reference (corrupt): {rel}")
        return None
    return data


def size_of(raw):
    """Byte size of the document behind a file_blob value without reading the file (None when there is none)."""
    if raw is None:
        return None
    if not is_ref(raw):
        return len(raw)
    parsed = _parse(raw)
    return parsed[0] if parsed else None


def discard(raw, log=None):
    """Removes the file behind a reference (after its row was overwritten). Best effort; a plain blob is left alone."""
    if not is_ref(raw):
        return False
    parsed = _parse(raw)
    path = _path_for(parsed[2]) if parsed else None
    if not path:
        return False
    try:
        os.remove(path)
        return True
    except OSError as exc:
        (log or _log.warning)(f"doc_storage: could not remove superseded file ({exc.__class__.__name__}): {parsed[2]}")
        return False


def status():
    """For GET /api/status. Never raises. 'writable' is a real probe: a temp file is created and removed in the
    directory (or in its nearest existing parent when the directory does not exist yet)."""
    root = storage_dir()
    out = {"backend": backend(), "dir": root, "exists": os.path.isdir(root), "writable": False}
    probe_dir = root
    while probe_dir and not os.path.isdir(probe_dir):
        parent = os.path.dirname(probe_dir)
        if parent == probe_dir:
            break
        probe_dir = parent
    try:
        fd, tmp = tempfile.mkstemp(prefix=".probe-", dir=probe_dir)
        os.close(fd)
        os.remove(tmp)
        out["writable"] = True
    except OSError as exc:
        out["error"] = exc.__class__.__name__
    if out["backend"] == "sqlite":
        out["note"] = ("Document bytes live in the SQLite row (case_vault.file_blob). "
                       "Set DOC_STORAGE=disk to write new documents to this directory instead.")
    else:
        out["note"] = "New document bytes are written to this directory; the row keeps a reference. Existing in-row blobs still open."
    return out
