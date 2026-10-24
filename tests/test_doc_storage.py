"""Document-blob storage durability: the default sqlite backend is behaviour-neutral, the opt-in
disk backend writes documents to a directory (so they survive a dyno restart) and reads them back."""
import sqlite3
from tests.helpers_app import make_app, register
from utils import doc_storage

DOCX = b"PK\x03\x04" + b"A document" * 600  # ~6 KB, starts like a real .docx (zip)


def test_sqlite_mode_is_behaviour_neutral(monkeypatch):
    monkeypatch.setenv("DOC_STORAGE", "sqlite")
    stored = doc_storage.store(DOCX, "docx")
    assert stored == DOCX                       # the row still holds the bytes themselves
    assert doc_storage.is_ref(stored) is False
    assert doc_storage.resolve(stored) == DOCX
    assert doc_storage.size_of(stored) == len(DOCX)
    assert doc_storage.store(None) is None
    assert doc_storage.resolve(None) is None


def test_disk_mode_round_trips_to_a_file(monkeypatch, tmp_path):
    d = tmp_path / "blobs"
    monkeypatch.setenv("DOC_STORAGE", "disk")
    monkeypatch.setenv("DOC_STORAGE_DIR", str(d))
    ref = doc_storage.store(DOCX, "docx")
    assert doc_storage.is_ref(ref) is True
    assert len(ref) < 200                        # the row holds a tiny reference, not the document
    assert any(p.is_file() for p in d.rglob("*"))  # the bytes are on disk
    assert doc_storage.resolve(ref) == DOCX      # read back, exactly
    assert doc_storage.size_of(ref) == len(DOCX)
    doc_storage.discard(ref)
    assert doc_storage.resolve(ref) is None      # cleaned up


def test_status_reports_disk_and_writability(monkeypatch, tmp_path):
    monkeypatch.setenv("DOC_STORAGE", "disk")
    monkeypatch.setenv("DOC_STORAGE_DIR", str(tmp_path / "b"))
    s = doc_storage.status()
    assert s["backend"] == "disk"
    assert s["writable"] is True


def test_vault_draft_save_lands_on_disk_in_disk_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("DOC_STORAGE", "disk")
    monkeypatch.setenv("DOC_STORAGE_DIR", str(tmp_path / "docblobs"))
    flask_app = make_app(tmp_path, monkeypatch)
    a = register(flask_app, "disk@example.com")
    r = a.post("/api/vault/documents/draft-save",
               json={"html": "<h1>Notice</h1><p>Section 138 of the NI Act.</p>",
                     "title": "Disk durability", "format": "docx", "destination": "vault"})
    assert r.status_code in (200, 201), r.get_json()
    # The document bytes must be a file on disk, and the SQLite row only a reference.
    con = sqlite3.connect(str(tmp_path / "lex_assistant.db"))
    row = con.execute("SELECT file_blob FROM case_vault ORDER BY id DESC LIMIT 1").fetchone()
    con.close()
    raw = row[0]
    assert doc_storage.is_ref(raw), "draft-save did not route the document to disk"
    served = doc_storage.resolve(raw)
    assert served[:2] == b"PK", "resolved document is not a valid .docx"
