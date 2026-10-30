# Phase 4 — Backend hardening plan (safe-to-execute)

This phase is written as a plan, not blind code, because the backend cannot be booted or tested
in the editor's working environment (deps not installed) and a prior untested refactor regressed
13 tests (see HANDOFF §10). Every step below is gated on **tests green**, per the handoff's rules
(real lawyers use this; don't rewrite working modules; verify before shipping).

Run the baseline first — nothing below starts until this is green:

```
python -m pip install -r requirements.txt
DATABASE_URL=sqlite:///:memory: JWT_SECRET_KEY=dev... python -c "import app; app.create_app()"   # boot smoke
python -m pytest tests -q --ignore=tests/e2e                                                      # ~12 min; expect 375 pass / 2 flaky
```

Do each step on its own commit; re-run the boot smoke + the touched module's tests after each.

## 1. Retire the dead/parallel RAG (lowest risk — nothing live imports it)
The live in-app RAG is SQLite `document_chunks` + Python cosine (`utils/rag_pipeline.py`). These are
NOT imported by `app.py`/`routes/` (verified by survey):
- `rag_server/` — ChromaDB FastAPI sidecar on :8001, 8 hardcoded seed cases.
- `ingest.py`, `mass_ingestion.py`, `loop_ingestion.py`, `test_pinecone.py` — Pinecone demo scripts.

Action: move them under `legacy/` (don't delete — they hold ingestion logic), drop the
"Pinecone + LLM" claim from `README.md`, and keep one honest sentence about the live RAG. Verify:
boot smoke + full suite unchanged (they aren't in the import graph, so this is near-zero risk).

## 2. Storage durability (highest-value correctness fix)
Documents are stored as SQLite BLOBs in `lex_assistant.db` (`case_vault.file_blob`); Render
persistent-disk durability is flagged "unconfirmed" in HANDOFF §7.8 — a data-loss risk.
- Short term: confirm/attach a Render persistent disk for the SQLite files and add a `/api/status`
  check that the disk is writable + the DB file is on it.
- Medium term: move blobs to object storage (GCS/S3), store only a key in the row. Do it behind a
  `DOC_STORAGE=disk|gcs` flag so the change is reversible and testable with both backends.

## 3. Slim `app.py` (biggest structural debt — do last, incrementally)
`app.py` is ~5k lines with ~46 inline handlers alongside 30+ blueprints. Per the repo's own
`docs/BACKEND_REFACTOR_PLAN.md`, extract the inline routes into blueprints **one domain at a time**,
each its own commit with the suite green:
- Vault (`/api/vault/*`) → `routes/vault_routes.py`
- Legal research + chat (`/api/legal-research`, `/api/chat`, `/api/ai/summarize-judgment`) → `routes/research_routes.py`
- Firm library (`/api/firm-library/*`) → fold into `library_routes.py`
- Calendar + districts (`/api/calendar/*`, `/api/districts`) → `routes/calendar_routes.py`

Rule from HANDOFF §10: the earlier `core/db` extraction regressed vault/DMS/LPMS tests via test
isolation — so move route code **only**, never the DB bootstrap / `init_sqlite_db` ordering, and
run `test_vault_authorization.py` + the DMS/LPMS suites after each extraction.

## 4. Migrations
No Alembic today (manual `CREATE TABLE IF NOT EXISTS`). Add Alembic for the SQLAlchemy models
(`users`, `documents`, `document_chunks`, `draft_sessions`, `draft_versions`, `cases`, …) without
touching the raw-sqlite `lex_assistant.db` schema (that stays additive). Baseline-stamp the current
prod schema so the first migration is a no-op.

## 5. Pin & audit deps
`requirements.txt` is largely unpinned; `npm audit` reports 47 vulns (10 high). Pin Python deps to
the versions prod runs, run `pip-audit`, and upgrade `@tiptap/*` in the frontend manually (its
peer-dep conflicts crash `npm audit fix`).

---

Nothing here ships without the backend test suite green and an owner sign-off, since it touches the
deployed API real advocates depend on.
