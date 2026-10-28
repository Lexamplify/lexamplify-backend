# LexAmplify backend: status

Written 2026-10-28 on `main` at `ebc8a7b`. Items under "Done" were checked in the code or in test runs, except where a line says "reported".

## Tests

| Suite | Result | How to run |
|---|---|---|
| Backend | 893 passed, 9 skipped, 0 failed (about 15 min) | `.\venv\Scripts\python.exe -m pytest tests -q --ignore=tests/e2e` |
| Browser (real backend, real Chromium) | 62 passed (about 5.5 min) | `$env:E2E_REBUILD="1"; .\venv\Scripts\python.exe -m pytest tests\e2e -q` |

- The route snapshot test and the gate matrix test fail if any route appears, disappears or becomes public by mistake.
- The full backend suite needs several GB of free memory. Low memory causes fake failures (`malloc failure`, `Unable to allocate`).
- The browser tests rewrite `docs/WALKTHROUGH.md` and `docs/screens/`. Restore them with `git restore docs/WALKTHROUGH.md docs/screens/`. Do not commit them.
- Live check on api.lexamplify.com: 15 of 15 passed (reported). It ran before the fixes listed below, none of which are deployed yet. It has not been repeated since.

## Done and merged to main

- Chat history is saved on a fresh server (`create_app()` now creates the table).
- Google and Microsoft sign-in users are saved in Neon (PR #6). Sign-in is refused if the provider says the email is not verified (reported, with new tests).
- Case Vault privacy (PR #7): rows with no owner are no longer visible to everyone. Each user sees only their own vault documents. Public judgments are readable by all, never editable or deletable. The AI chat, search, autocomplete, audit and provenance views follow the same rule.
- The last 9 inline handlers moved out of `create_app()` into `routes/vault_files_routes.py` and `routes/firm_library_routes.py` (PR #8). `app.py` has no inline routes left (only request hooks and error handlers).
- The dead duplicate `POST /api/vault/save` was removed (PR #9). Flask always sent that path to `vault_workspace.save_vault_document`.
- Two browser tests were updated for the new `/editor` route and now read the draft through the editor's own function (PR #10).
- Court Resources (Sharan) is in main.

## Not live yet

None of the above is deployed. Deploys on Render Free are manual and wipe the SQLite data. Sharan's Court Resources pages show errors until the backend is deployed. Waiting for a go-ahead on timing.

## Open items

| Item | Detail |
|---|---|
| Calendar reset when started with `python app.py` | `init_db()` runs `DROP TABLE IF EXISTS calendar_events`. It is called only from the `__main__` block, not by gunicorn on Render, so the live site does not run it. Anyone who starts the app with `python app.py` against a database that has calendar events loses them. Priyam has a fix in his local work (not pushed yet). The calendar routes already filter by `owner_user_id`. |
| Data lost on Render Free | Most user data lives in local SQLite files. Plan: Litestream with Cloudflare R2. Not tested. Unconfirmed: shutdown handling, memory on the free plan, installing the binary. It does not cover uploaded files or Chroma. Fine for a demo site, required before real users. |
| `app.py` is still large | 2,237 lines (schema, helpers, `create_app()`). Splitting `AutoDraftWorkspace.jsx` is not done, and it overlaps with the frontend redesign. |
| Dependencies | At the time of `docs/VULN_TRIAGE.md`: 36 npm and 30 pip advisories left. Open choices: editor stack (tiptap), pin the Python version on Render, replace PyPDF2 with pypdf, remove chromadb. |
| Contract Analyzer | From Priyam's audit of his local copy (not re-checked on main): results are not saved after refresh, export is `.txt` only, the citations tab is empty without a vector database. |
| Known security gaps | `rag_server` (port 8001) and the Pinecone endpoints have no sign-in. `vc_vault_data.json` is global and has no owner (`POST /api/vault/save` still writes to it when `case_facts` or `history` are sent; the frontend does not send them). |
| Red-team items from the brief | The "open red-team items" step (Step 7) was not reviewed here. Some older test files may read the real database. |
| Small clean-ups | Stale "364 routes" text at the top of `tests/test_route_snapshot.py`, old line numbers in two docs, unused `jwt_required` import in `app.py` (line 3), a stale comment in `upload_vault_document` (`routes/vault_files_routes.py`, about line 234), a leftover `AutoDraftWorkspace.jsx.bak`. |

## Next

1. Review Priyam's branch when it is pushed (calendar fix, new endpoints). Do not merge before the tests pass.
2. Agree the deploy time, then deploy and run the live check again.
3. Test Litestream on a throwaway server before touching the real service.
