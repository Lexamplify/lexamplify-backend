# Local database: "Local database is out of date"

If the backend log says `Local database is out of date (missing: draft_sessions.workspace_id, ...)`, your local SQLite file
was made by an older version of the app. The app does NOT change that file for you. Symptoms: Auto-Draft "Start drafting"
fails, Practice > Matters returns 500 (`no such column: c.workspace_id`).

## Safest fix: run on a NEW database file (the old file stays untouched)

1. In your own `.env`, set `DATABASE_URL` to a new name, for example `DATABASE_URL=sqlite:///fresh_local.db`.
   A relative path is created inside `instance/` (so `instance/fresh_local.db`).
2. Restart the backend: `.\.venv\Scripts\python.exe -m flask --app app:create_app run`.
3. Sign up again (a new file has no users), then create your workspace/client and, for Practice, the firm.
4. Optional: set `LEGACY_USER_MIGRATION=off` for a completely clean start (otherwise accounts found in the old
   `lex_assistant.db` may be copied across, read-only).

To go back to your old data, set `DATABASE_URL` back to the old value. Moving old data to the workspace schema is done by the
official migration (owned by the team lead), not by app start-up.

## What the app does and does not do

- On start-up it only LOOKS (read-only) and logs the warning. It never runs `ALTER`, `UPDATE` or `DELETE` on your file.
- A real "database is asleep" problem (hosted Postgres) still shows "database is not responding / waking up" (HTTP 503, code `DB_UNAVAILABLE`).
- A missing table or column is a different thing: HTTP 500, code `DB_SCHEMA_MISMATCH`, with a reference id to quote.
