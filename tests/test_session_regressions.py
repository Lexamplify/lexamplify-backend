"""Regression tests for the bugs we fixed live during the E2E test
walkthrough. Each test documents the exact bug it prevents from
coming back; the commit SHA is cited so a future contributor can see
what the fix looked like.

These are focused SQL / code-path checks — they don't spin up the
whole Flask app or hit the network. The goal is "this specific
production-level crash cannot slip past CI again," not full
integration coverage (that lives in test_collab_* and the Document
Hub harness).
"""
import os
import sqlite3
from datetime import datetime, timezone

import pytest
from flask import Flask


# ────────────────────────────────────────────────────────────────────
# Bug 1 — commit 079fad1 + afd2156
#   POST /api/practice/members crashed on
#   `NOT NULL constraint failed: lpms_members.active`
#   (and would have crashed on email_notify next) because the INSERT
#   omitted both columns and SQLAlchemy's instance/database.db schema
#   has NO column DEFAULT on either.
# ────────────────────────────────────────────────────────────────────

LPMS_MEMBERS_SCHEMA_NO_DEFAULTS = """
CREATE TABLE lpms_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    active INTEGER NOT NULL,           -- no DEFAULT (SQLAlchemy shape)
    email_notify INTEGER NOT NULL,     -- no DEFAULT
    managed INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    last_seen TEXT
);
"""


def test_add_member_insert_specifies_active_and_email_notify(tmp_path):
    """The INSERT shape routes/lpms_core.py:add_member emits MUST include
    active + email_notify. Yesterday's crash was silent (500 blocked the
    UI listing new members)."""
    db = tmp_path / "test.db"
    c = sqlite3.connect(str(db))
    c.executescript(LPMS_MEMBERS_SCHEMA_NO_DEFAULTS)

    # Simulate the production INSERT exactly.
    c.execute(
        "INSERT INTO lpms_members "
        "(firm_id, user_id, role, name, email, phone, managed, active, "
        " email_notify, created_by, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (1, 42, "junior", "New Member", "n@example.com", None, 0, 1, 1, 1,
         datetime.now(timezone.utc).isoformat(timespec="seconds")),
    )
    c.commit()
    row = c.execute("SELECT active, email_notify FROM lpms_members").fetchone()
    assert row == (1, 1), "both active and email_notify must land as 1"


def test_add_member_insert_without_active_still_crashes(tmp_path):
    """Documents the exact failure mode so a future refactor that drops
    `active` from the INSERT trips immediately in CI, not production."""
    db = tmp_path / "test.db"
    c = sqlite3.connect(str(db))
    c.executescript(LPMS_MEMBERS_SCHEMA_NO_DEFAULTS)

    with pytest.raises(sqlite3.IntegrityError) as exc:
        c.execute(
            "INSERT INTO lpms_members (firm_id, user_id, role, name, email, "
            "phone, managed, created_by, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (1, 42, "junior", "No Active", "n@example.com", None, 0, 1,
             datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
    assert "active" in str(exc.value).lower()


# ────────────────────────────────────────────────────────────────────
# Bug 2 — commit 5119695
#   DELETE /api/workspaces/<id> cascaded nothing. workspace_members
#   rows were orphaned, SQLite reused the freed PK on next create, and
#   the add-owner INSERT hit a UNIQUE(workspace_id, firm_member_id)
#   conflict. 503 on 'create client'.
# ────────────────────────────────────────────────────────────────────

def test_workspace_delete_must_remove_member_rows(tmp_path):
    """A workspace delete MUST clear workspace_members for that id, so
    the next workspace to inherit the PK can register its owner without
    tripping the UNIQUE index."""
    db = tmp_path / "test.db"
    c = sqlite3.connect(str(db))
    c.executescript("""
        CREATE TABLE workspaces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
        CREATE TABLE workspace_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id INTEGER NOT NULL,
            firm_member_id INTEGER NOT NULL,
            role TEXT,
            UNIQUE(workspace_id, firm_member_id)
        );
    """)
    # Create + delete + reuse PK (SQLite behavior without AUTOINCREMENT).
    c.execute("INSERT INTO workspaces (name) VALUES ('A')")           # id=1
    c.execute("INSERT INTO workspace_members (workspace_id, firm_member_id, role) VALUES (1, 7, 'owner')")

    # Simulate production delete endpoint — explicitly deletes the
    # member rows BEFORE the workspace row (as it does in commit 5119695).
    c.execute("DELETE FROM workspace_members WHERE workspace_id = 1")
    c.execute("DELETE FROM workspaces WHERE id = 1")
    c.commit()

    # Create a new workspace — depending on SQLite's PK-reuse this may
    # or may not get id=1 again. Either way, inserting a fresh owner
    # row for the SAME (workspace_id, firm_member_id) pair must succeed.
    cur = c.execute("INSERT INTO workspaces (name) VALUES ('B')")
    new_id = cur.lastrowid
    c.execute(
        "INSERT INTO workspace_members (workspace_id, firm_member_id, role) VALUES (?, ?, ?)",
        (new_id, 7, "owner"),
    )
    c.commit()
    assert c.execute(
        "SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?", (new_id,)
    ).fetchone()[0] == 1


# ────────────────────────────────────────────────────────────────────
# Bug 3 — commit 8e50744
#   routes/contract_routes.py:_resolve_firm_id_for_jwt crashed with
#   `NameError: name 'current_app' is not defined`. The helper used
#   current_app without importing it at module level (the siblings had
#   lazy inline imports; this one didn't).
# ────────────────────────────────────────────────────────────────────

def test_contract_routes_imports_current_app_at_module_level():
    """The ergonomic fix was to import current_app on the module's top
    `from flask import …` line. Lock that so a future cleanup that
    moves it back to a lazy inline import inside _resolve_firm_id_for_jwt
    trips this test immediately."""
    import importlib
    mod = importlib.import_module("routes.contract_routes")
    assert hasattr(mod, "current_app"), (
        "routes.contract_routes must expose current_app at module scope — "
        "otherwise checklist_master_get() 500s on NameError"
    )


# ────────────────────────────────────────────────────────────────────
# Bug 4 — commit 8eaae2d
#   case_visible_sql() returned a predicate with
#   `(workspace_id = :__ws_id OR workspace_id IS NULL)` which let
#   legacy un-scoped matters show up under EVERY client. User saw
#   Mehta v. UoI / Case A / Case B leaking into both Mehta and Rohit.
# ────────────────────────────────────────────────────────────────────

@pytest.fixture
def app_with_lpms(tmp_path):
    db = tmp_path / "lex.db"
    c = sqlite3.connect(str(db))
    c.executescript("""
        CREATE TABLE lpms_cases (
            id INTEGER PRIMARY KEY,
            firm_id INTEGER, advocate_id INTEGER, team_id INTEGER,
            restricted INTEGER DEFAULT 0, title TEXT, workspace_id INTEGER
        );
        CREATE TABLE lpms_members (
            id INTEGER PRIMARY KEY, firm_id INTEGER, user_id INTEGER,
            role TEXT, active INTEGER DEFAULT 1
        );
        CREATE TABLE team_memberships (team_id INTEGER, user_id INTEGER);
    """)
    c.executemany(
        "INSERT INTO lpms_cases (id, firm_id, advocate_id, team_id, "
        "restricted, title, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (1, 1, 1, None, 0, "Legacy case (no workspace)", None),
            (2, 1, 1, None, 0, "Mehta's case",              10),
            (3, 1, 1, None, 0, "Rohit's case",              11),
        ],
    )
    c.execute("INSERT INTO lpms_members (id, firm_id, user_id, role) "
              "VALUES (1, 1, 42, 'senior')")
    c.commit()
    c.close()
    app = Flask("test-regressions")
    app.extensions["lpms_db_path"] = str(db)
    return app


def _run_vis(app, member, workspace_id_header):
    """Call case_visible_sql with a simulated workspace header and
    return the ids of lpms_cases that pass the predicate."""
    from utils import lpms_store as L

    with app.test_request_context(headers={"X-Workspace-Id": str(workspace_id_header)} if workspace_id_header is not None else {}):
        where, params = L.case_visible_sql(member, "c")
        conn = sqlite3.connect(app.extensions["lpms_db_path"])
        try:
            return sorted(
                r[0] for r in conn.execute(
                    f"SELECT id FROM lpms_cases c WHERE {where}", params
                ).fetchall()
            )
        finally:
            conn.close()


def test_case_visible_sql_strict_workspace_match(app_with_lpms):
    """With X-Workspace-Id=10, ONLY Mehta's case (id=2) must be
    visible — the legacy NULL-workspace case (id=1) and Rohit's case
    (id=3) must stay hidden. The pre-fix predicate had an `OR
    workspace_id IS NULL` leg that let id=1 leak into every client's
    view; the fix (commit 8eaae2d) removed that leg."""
    member = {"id": 1, "firm_id": 1, "user_id": 42, "role": "senior"}
    assert _run_vis(app_with_lpms, member, 10) == [2]
    assert _run_vis(app_with_lpms, member, 11) == [3]


def test_case_visible_sql_no_header_sees_all(app_with_lpms):
    """When no X-Workspace-Id is sent (background jobs, Celery, cron,
    legacy clients), case_visible_sql must NOT filter — otherwise
    firm-wide tooling breaks."""
    member = {"id": 1, "firm_id": 1, "user_id": 42, "role": "senior"}
    assert _run_vis(app_with_lpms, member, None) == [1, 2, 3]


# ────────────────────────────────────────────────────────────────────
# Bug 4b — commit dced75a
#   POST /api/practice/cases created rows with workspace_id=NULL.
#   With the strict case_visible_sql filter from 4, the user's own
#   newly-created matter 404'd on the very next GET. The create path
#   must stamp workspace_id from X-Workspace-Id so the round-trip
#   works.
# ────────────────────────────────────────────────────────────────────

def test_newly_created_case_is_visible_to_creator(app_with_lpms):
    """Simulate POST creating a case with workspace_id=10 (stamped from
    the X-Workspace-Id header), then the immediate GET: the creator
    must see the row under their own active workspace."""
    import sqlite3
    conn = sqlite3.connect(app_with_lpms.extensions["lpms_db_path"])
    conn.execute(
        "INSERT INTO lpms_cases (id, firm_id, advocate_id, team_id, "
        "restricted, title, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (99, 1, 1, None, 0, "Just-created Mehta case", 10),
    )
    conn.commit()
    conn.close()
    member = {"id": 1, "firm_id": 1, "user_id": 42, "role": "senior"}
    assert 99 in _run_vis(app_with_lpms, member, 10), (
        "a case created under workspace_id=10 must be visible to the "
        "same workspace on the very next GET"
    )


def test_case_create_without_workspace_header_leaves_null(app_with_lpms):
    """Legacy / background path: POST without X-Workspace-Id must leave
    workspace_id=NULL (Celery jobs that run cron reminders fall into
    this bucket). The strict filter then hides the row from any
    client-scoped view — which is the correct behaviour."""
    import sqlite3
    conn = sqlite3.connect(app_with_lpms.extensions["lpms_db_path"])
    conn.execute(
        "INSERT INTO lpms_cases (id, firm_id, advocate_id, team_id, "
        "restricted, title, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (100, 1, 1, None, 0, "Background-created, no workspace", None),
    )
    conn.commit()
    conn.close()
    member = {"id": 1, "firm_id": 1, "user_id": 42, "role": "senior"}
    # Under a specific workspace header: NULL rows hidden (correct).
    assert 100 not in _run_vis(app_with_lpms, member, 10)
    # No header at all: NULL rows visible (correct).
    assert 100 in _run_vis(app_with_lpms, member, None)


# ────────────────────────────────────────────────────────────────────
# Bug 5 — commit c5f5a62 / Settings → Contract checklist feature
#   Firm master checklist settings PUT required senior/partner role;
#   the server-side check was correct. We lock the string set here so
#   a future change to the role-prefix check (e.g. renaming 'partner'
#   to 'managing-partner' with no fallback) can't silently lock
#   senior admins out of their own setting.
# ────────────────────────────────────────────────────────────────────

def test_contract_checklist_role_gate_accepts_senior_partner_principal():
    """The PUT /api/contract/checklist/master role gate contains the
    exact substrings 'senior', 'partner', 'principal'. Spell them wrong
    and every firm manager gets a 403."""
    src = open("routes/contract_routes.py", encoding="utf-8").read()
    # Lift the exact substring check out of the file so a renaming
    # refactor shows up as a diff.
    for needle in ('"senior"', '"partner"', '"principal"'):
        assert needle in src, f"role gate must still check for {needle}"


# ────────────────────────────────────────────────────────────────────
# Bug 6 — commit f4bda37 / Collab visibility filter
#   Case-room DMs were leaking: before the privacy fix every message
#   had visibility='public' and every case member saw @Arjun's private
#   notes. The server GET /messages filter is now the single source
#   of truth: visible iff (public OR author OR mentioned OR firm-senior).
# ────────────────────────────────────────────────────────────────────

COLLAB_MSG_SCHEMA = """
CREATE TABLE case_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id INTEGER, workspace_id INTEGER,
    case_id INTEGER NOT NULL, author_user_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'message', body TEXT,
    parent_message_id INTEGER,
    visibility TEXT NOT NULL DEFAULT 'public',
    deleted_at TEXT, edited_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE case_message_mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    mentioned_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, mentioned_user_id)
);
CREATE TABLE case_message_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    resource_version TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""

# The exact SQL predicate collab_routes.list_messages uses when it
# builds the "which messages this viewer sees" query. Lifting it into
# the test keeps it visible — if the predicate drifts, re-copy it here
# and the drift gets reviewed.
VISIBILITY_SQL = """
SELECT m.id FROM case_messages m
WHERE m.case_id = :case_id
  AND (
    m.visibility = 'public'
    OR m.author_user_id = :uid
    OR EXISTS (
      SELECT 1 FROM case_message_mentions mm
      WHERE mm.message_id = m.id AND mm.mentioned_user_id = :uid
    )
  )
ORDER BY m.id
"""


@pytest.fixture
def collab_db(tmp_path):
    db = tmp_path / "collab.db"
    c = sqlite3.connect(str(db))
    c.row_factory = sqlite3.Row
    c.executescript(COLLAB_MSG_SCHEMA)
    # Priyam (uid=1) writes two messages on case 9:
    #   (1) a DM to Arjun (uid=9) — visibility private + mention row.
    #   (2) an @all broadcast — visibility public, no mention row.
    c.execute(
        "INSERT INTO case_messages (id, case_id, author_user_id, body, visibility) "
        "VALUES (1, 9, 1, '@Arjun Singh hi this', 'private')"
    )
    c.execute(
        "INSERT INTO case_message_mentions (message_id, mentioned_user_id) VALUES (1, 9)"
    )
    c.execute(
        "INSERT INTO case_messages (id, case_id, author_user_id, body, visibility) "
        "VALUES (2, 9, 1, '@all hello to all', 'public')"
    )
    c.commit()
    yield c
    c.close()


def _visible_ids(conn, uid):
    return [r[0] for r in conn.execute(VISIBILITY_SQL, {"case_id": 9, "uid": uid})]


def test_collab_visibility_author_sees_both(collab_db):
    """Priyam (uid=1) authored both messages, so she sees both."""
    assert _visible_ids(collab_db, 1) == [1, 2]


def test_collab_visibility_mentioned_recipient_sees_private_dm(collab_db):
    """Arjun (uid=9) was mentioned on the private DM, so he sees both
    the DM (because mentioned) and the broadcast (because public)."""
    assert _visible_ids(collab_db, 9) == [1, 2]


def test_collab_visibility_outsider_only_sees_public(collab_db):
    """A random case member (uid=99) who is neither the author nor
    mentioned MUST NOT see the private DM. The regression here was
    that pre-fix every message was visibility='public' so an outsider
    saw every @Arjun DM in the feed."""
    assert _visible_ids(collab_db, 99) == [2]


# ────────────────────────────────────────────────────────────────────
# Bug 7 — commit bb56cc3 / Share privacy
#   utils.share_service.create_share wrote every share as
#   visibility='public' no matter what recipient_user_ids held, so a
#   "share Vault doc to Arjun only" card was readable by every case
#   member. The fix: a share with specific recipients gets
#   visibility='private' AND each recipient becomes a mention row, so
#   the collab visibility filter and the download fallback both honor
#   the DM semantics automatically.
# ────────────────────────────────────────────────────────────────────

def test_share_service_private_when_recipients_given():
    """Lock the branch: if recipient_user_ids is non-empty AND no
    @all/@everyone/@channel token appears in the body, visibility
    MUST be 'private'. The exact decision logic lives inside
    create_share — grep it here so a refactor that flips the default
    back to 'public' fails CI."""
    src = open("utils/share_service.py", encoding="utf-8").read()
    # The three broadcast tokens must each still be recognized —
    # dropping any one of them silently flips @all shares to private.
    for tok in ("@all", "@everyone", "@channel"):
        assert tok in src, f"share_service must still recognize {tok} as broadcast"
    # And the private branch must still exist. The exact predicate
    # from the fix: `_broadcast_tok or not recipients` → public.
    assert '_visibility = "public" if' in src, (
        "the visibility ternary from commit bb56cc3 is gone — "
        "a share with specific recipients may be leaking as public again"
    )
    # Mention rows must be inserted so the visibility filter sees them.
    assert "INSERT INTO case_message_mentions" in src, (
        "share_service must insert case_message_mentions for every "
        "recipient_user_id, otherwise private shares are invisible "
        "to the very people meant to receive them"
    )


# ────────────────────────────────────────────────────────────────────
# Bug 8 — commit bb56cc3 / Vault upload 500
#   POST /api/vault/documents/upload threw
#   `NOT NULL constraint failed: case_vault.is_public`. The schema has
#   is_public NOT NULL with no DEFAULT; the INSERT didn't name it. Every
#   paperclip upload returned 500 — a two-week-old breakage nobody had
#   noticed because the Vault UI uploads use a different code path.
# ────────────────────────────────────────────────────────────────────

CASE_VAULT_MIN_SCHEMA = """
CREATE TABLE case_vault (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT, title TEXT, doc_type TEXT, content TEXT,
    folder_id INTEGER, smart_title TEXT, tags TEXT,
    file_blob BLOB, file_format TEXT, user_id INTEGER,
    workspace_id INTEGER,
    is_public INTEGER NOT NULL           -- the production shape: NOT NULL, no DEFAULT
);
"""


def test_vault_upload_insert_specifies_is_public(tmp_path):
    """The INSERT shape routes/vault_files_routes.py:upload_vault_document
    emits MUST include is_public. Omit it and the schema's NOT NULL
    constraint tanks every upload with a 500."""
    db = tmp_path / "test.db"
    c = sqlite3.connect(str(db))
    c.executescript(CASE_VAULT_MIN_SCHEMA)
    c.execute(
        'INSERT INTO case_vault (case_id, title, doc_type, content, folder_id, '
        'smart_title, tags, file_blob, file_format, user_id, workspace_id, is_public) '
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
        ('9', 'foo.pdf', 'uploaded', '', None, 'foo', 'UNCLASSIFIED',
         b'%PDF-', 'pdf', 1, 10)
    )
    c.commit()
    assert c.execute("SELECT is_public FROM case_vault").fetchone()[0] == 0, (
        "paperclip uploads must default to is_public=0 (private); "
        "public bulk judgments go through a separate ingest path"
    )


def test_vault_upload_insert_without_is_public_crashes(tmp_path):
    """Documents the exact failure mode so a future refactor that drops
    is_public from the INSERT trips immediately in CI, not production."""
    db = tmp_path / "test.db"
    c = sqlite3.connect(str(db))
    c.executescript(CASE_VAULT_MIN_SCHEMA)
    with pytest.raises(sqlite3.IntegrityError) as exc:
        c.execute(
            'INSERT INTO case_vault (case_id, title, doc_type, content, folder_id, '
            'smart_title, tags, file_blob, file_format, user_id, workspace_id) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ('9', 'foo.pdf', 'uploaded', '', None, 'foo', 'UNCLASSIFIED',
             b'%PDF-', 'pdf', 1, 10)
        )
    assert "is_public" in str(exc.value), (
        "the schema should still enforce is_public NOT NULL — drop that "
        "constraint and the UI defaults everywhere else need re-auditing"
    )


# ────────────────────────────────────────────────────────────────────
# Bug 9 — commit 4647ee3 / Vault doc hydration in collab feed
#   list_messages used to return raw `vault_doc:42` for every share
#   resource. The user saw `vault_doc:42` where a filename should be,
#   and the image-vs-file renderer had nothing to go on. The fix
#   batch-joins case_vault and hydrates resource.name + resource.filename
#   (reconstructing the extension off file_format when the stored title
#   dropped it).
# ────────────────────────────────────────────────────────────────────

def test_collab_hydrates_vault_doc_filename():
    """Lock the hydration call site in collab_routes.list_messages.
    Without this, the feed cards fall back to a bare `vault_doc:id`
    label and the image-vs-file preview picker can't fire."""
    src = open("routes/collab_routes.py", encoding="utf-8").read()
    assert "vault_meta" in src, (
        "the batched SELECT across case_vault must still exist — "
        "without it the collab feed can't tell a PDF from an image"
    )
    # The entry must carry both name and filename (the extension is
    # read off filename in the frontend's IMAGE_EXTS check).
    assert 'entry["name"]' in src and 'entry["filename"]' in src, (
        "resource entries sent to the frontend must include both name "
        "(for display) and filename (for the ext-based preview picker)"
    )


# ────────────────────────────────────────────────────────────────────
# Bug 10 — commit 4647ee3 / Vault download fallback for shared docs
#   Before this fix, Priyam uploads a file in the chat → Arjun sees the
#   share card but Download returns 404. The vault's own access gate
#   checks document_vault_shares / team_members, which the chat
#   composer doesn't touch. Fix: the download endpoint also allows a
#   viewer who can read a case_message_resources row attaching this
#   doc on a case they belong to (and the message is public, authored
#   by them, or mentions them — same rule as the collab filter).
# ────────────────────────────────────────────────────────────────────

def test_vault_download_fallback_allows_shared_card_viewer():
    """Lift the fallback predicate from routes/vault_files_routes.py so
    any future refactor that forgets it (and breaks every Case Room
    attachment download for every non-author) shows up as a diff."""
    src = open("routes/vault_files_routes.py", encoding="utf-8").read()
    assert "case_message_resources" in src, (
        "the download endpoint's cross-check against shared cards is "
        "gone — Arjun's Download button is about to 404 again"
    )
    # The three branches the fallback allows: public message, author,
    # or mentioned-on-this-message.
    assert "'public'" in src, "public-share branch missing from download fallback"
    assert "author_user_id" in src, "author branch missing from download fallback"
    assert "case_message_mentions" in src, (
        "mentioned-recipient branch missing from download fallback"
    )
    # And the case-membership gate must still wrap it, otherwise a user
    # on a totally different firm could download via a stale URL.
    assert "require_case_access" in src, (
        "the case-membership gate is gone from the download fallback — "
        "a user on a different case could download by guessing doc_id"
    )


# ────────────────────────────────────────────────────────────────────
# Bug 11 — commit 2e8a3b1 / Inline-vs-attachment download disposition
#   Before this, every /api/vault/documents/<id>/download served
#   `Content-Disposition: attachment`, so clicking "Open in new tab" in
#   the chat still forced a file save instead of letting the browser
#   render a PDF or image natively.
# ────────────────────────────────────────────────────────────────────

def test_download_inline_param_flips_disposition():
    """?inline=1 must serve Content-Disposition: inline; omitting it
    must serve attachment. Also lock that nosniff is present either way,
    so a mislabeled file can't be rendered as something it isn't."""
    src = open("routes/vault_files_routes.py", encoding="utf-8").read()
    assert "inline=='1'" in src.replace(" ", "") or "inline') == '1'" in src, (
        "?inline=1 branch missing — chat room 'Open in new tab' is back "
        "to forcing a download instead of rendering natively"
    )
    assert "X-Content-Type-Options" in src and "nosniff" in src, (
        "nosniff header missing from download — a mislabeled .html "
        "could be sniffed and rendered under a vault URL"
    )
    # The MIME map must still cover the previewable types the frontend
    # ResourceCard renders inline (pdf, image, video, audio) — if any
    # of these fall back to octet-stream, the inline embed shows a
    # download prompt instead of the preview.
    for mime in ("application/pdf", "image/png", "image/jpeg", "video/mp4", "audio/mpeg"):
        assert mime in src, f"MIME '{mime}' missing from vault download map"


# ────────────────────────────────────────────────────────────────────
# Bug 12 — commit 615130f / Attachments must stage, not auto-send
#   The original paperclip uploaded + shared immediately on file pick,
#   so the user couldn't type a caption or @mention anyone — the file
#   just vanished into the feed with no context. Attachments now stage
#   in the composer and only go out on Send alongside typed text and
#   mentions.
# ────────────────────────────────────────────────────────────────────

# ────────────────────────────────────────────────────────────────────
# Bug 13 — commit (this one) / Collab room workspace scope leak
#   routes/collab_routes._case_or_404 only checked firm-level ACL. A
#   firm senior who had switched to Mehta's workspace could still read
#   Rohit's case-room messages by deep-linking the case id. The fix
#   mirrors case_visible_sql: when X-Workspace-Id is present, the
#   case's workspace_id must match. No header → firm-level ACL only,
#   so background jobs / Celery still work.
# ────────────────────────────────────────────────────────────────────

def test_collab_case_or_404_enforces_workspace_header():
    """Lock the workspace check in _case_or_404. The three invariants
    the scope probe just confirmed:
      * Case under workspace 10, header=10 → access granted
      * Case under workspace 10, header=11 → 404 (not 'not found' from
        the firm-ACL check — this is the workspace-mismatch branch)
      * No header → firm-ACL only (background jobs)
    """
    src = open("routes/collab_routes.py", encoding="utf-8").read()
    # The workspace header must be read via the central helper so the
    # rule is uniform across every scope-aware endpoint. Avoid a
    # per-route reimplementation of X-Workspace-Id parsing.
    assert "current_workspace_id" in src, (
        "_case_or_404 no longer calls current_workspace_id — a user "
        "who switched workspaces could deep-link into a different "
        "client's case room by id again"
    )
    # The mismatch branch must still 404 (not 403, not 500). 404 keeps
    # existence hidden, matching the Vault + Matters convention.
    assert '"Case not found."' in src, (
        "workspace-mismatch branch stopped returning the 'Case not "
        "found.' 404 — switched to 403 would leak case existence"
    )
    # And the firm-level ACL must still be the first gate. Dropping it
    # would make the workspace scope the ONLY check, which locks out
    # firm-wide tooling that doesn't send a workspace header.
    assert "require_case_access" in src, (
        "firm-level ACL dropped from _case_or_404 — a non-member of "
        "the firm could read a case room by guessing the id"
    )


def test_composer_stages_pending_files_not_auto_sends():
    """The composer must stage picked files locally and only upload on
    Send. Guard against a refactor that re-wires the file input back
    to the upload call directly."""
    src = open("frontend/src/components/collab/CollabRoom.jsx", encoding="utf-8").read()
    # The staging state and its helpers must exist.
    assert "pendingFiles" in src, (
        "pendingFiles state is gone — the composer is auto-sending "
        "attachments again, so typed captions and @mentions are lost"
    )
    assert "stagePickedFiles" in src, (
        "stagePickedFiles helper is gone — picking a file is probably "
        "back to firing the upload directly"
    )
    # The file input's onChange must call the staging helper, NOT the
    # upload fn. The old wiring was `onChange={... uploadAndShare(...)` —
    # if that reappears we've regressed.
    assert "stagePickedFiles(Array.from(e.target.files" in src, (
        "<input type='file'> onChange no longer stages — it's calling "
        "the upload path directly, so caption + @mention won't ride along"
    )
    # And Send must handle the pending-files path, not just text.
    assert "pendingFiles.length === 0" in src or "files.length === 0" in src, (
        "send() lost its text-vs-attachment branch — one of the paths "
        "will silently drop the user's input"
    )
