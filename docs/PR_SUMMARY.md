# PR summary: `opencode-refactor`

Everything on this branch since `a7ddf70`, what it changed, what could go wrong, and how to undo it.

- **Branch:** `opencode-refactor`
- **Base:** `fac6a2b` ("Update repository") — the tip of the local `main`
- **Head:** `53059f1` ("step 5: the vulnerability triage")
- **17 commits**, all with the message format `step N: <what> (tests: <pass>/<total>)`
- **Nothing has been pushed, deployed or merged.** `git status` is clean; the only untracked files are the
  two brief documents (`OPENCODE_COMMAND.md`, `CLAUDE_CODE_PART2_COMMAND.md`), which were not mine to commit.

> **Before you merge:** `origin/main` is one commit ahead of this branch's base — `a7ddf70` ("HANDOFF.md").
> It is **not** an ancestor of this branch, so a plain merge brings the branch's work in *without* that
> commit. Pull `origin/main` first (or merge `a7ddf70` in), then merge this branch.

---

## 1. The commits, in order

### `2ed3482` — step 1: safety net before any refactor

**Changed.** `app.py` (the saved-draft save: an owner check and an id check), `routes/lpms_cases.py` (the
hearing time is validated before the duplicate-day check), and ten new test files (`tests/api_gate.py`,
`tests/route_snapshot.txt`, `tests/test_route_snapshot.py`, `tests/test_api_gate_matrix.py`,
`tests/test_cross_tenant_tables.py`, `tests/test_saved_drafts.py`, `tests/test_lpms_hearing_validation.py`),
plus `docs/OPENCODE_PROGRESS.md`.

**Risk: MEDIUM.** Two behaviour changes in the running app:
- `POST /api/drafts` now answers **404 "That draft is not yours."** when the browser-chosen id belongs to
  another advocate (before: it silently overwrote that advocate's draft — a real cross-tenant write hole).
  It also answers **400** for an id that is not a short piece of text (before: a 500).
- `POST /api/practice/cases/<id>/hearings` now answers **400** for a malformed time even when the day is
  already booked (before: 409, and the malformed time was never reported).

**Roll back.** `git revert 2ed3482` (or `git reset --hard 2ed3482^` if the branch is not shared). The
saved-draft hole comes back with it — do not roll this one back without a replacement.

---

### `5fab0ae` — step 1: record the browser-test result

**Changed.** `docs/OPENCODE_PROGRESS.md` only.

**Risk: NONE.** No code.

**Roll back.** `git revert 5fab0ae`.

---

### `e9f9c0a` — step 2: make the new version live-able

**Changed.** `app.py` (the start-up refusal now names every missing variable at once, in plain English),
`scripts/smoke.py` (two more checks: a detail that was not given stays a visible blank; the exported Word
file really carries the notice), `tests/test_ops.py` (two new tests), `docs/RENDER_ENV_CHECKLIST.md`,
`docs/GO_LIVE.md`, `docs/DEPLOY_STEPS.md` (two corrections), `docs/OPENCODE_PROGRESS.md`.

**Risk: LOW.** The start-up **check** is unchanged — the server still refuses to start in production without
a strong `JWT_SECRET_KEY` and a `DATABASE_URL`. Only the wording of the refusal changed, and it now lists
every problem at once. `scripts/smoke.py` is a script the manager runs by hand; it is not part of the
server. The documents are for people.

**Roll back.** `git revert e9f9c0a`.

---

### `aacd705` — step 6: the real-model evaluation harness, and the two bugs it found

**Changed.** `routes/document_routes.py` (the studio checks the material for instructions before it sends it,
and answers `ignored_instructions`), `routes/draft_engine_routes.py` (the extraction call has 3000 tokens and
a continuation; the extraction also checks the source), `utils/draft_engine/extract.py` (the prompt asks for
the shortest exact quote), `utils/injection_guard.py` (new), `frontend/src/components/AutoDraftWorkspace.jsx`
(the studio screen says when lines were left out), `scripts/eval_drafts.py` + `scripts/eval_matters.py`
(new), four new test files, `docs/EVAL_REPORT.md`, `docs/OPENCODE_PROGRESS.md`.

**Risk: MEDIUM — the highest of the branch.** Three behaviour changes:
1. The extraction call now asks for more room and may make a second call (the continuation). Measured: the
   fields the model read went from **all lost** to **all kept**. Cost: the call may take longer and use
   more of the shared token allowance.
2. A line in the material that looks like an instruction to the assistant is **not sent to the model** and
   is replaced by a marker. Measured: the model no longer obeys an injected instruction (before: it wrote
   the invented amount, the invented PAN and the invented party into the draft). The risk of a false
   positive is low (the patterns are narrow and tested against ordinary legal sentences), but a line that
   *is* flagged is left out of the draft.
3. The studio's answer has a new key, `ignored_instructions`; the screen shows it. Old screens ignore it.

**Roll back.** `git revert aacd705` (the harness and the report go with it).

---

### `21da4fd` — step 6: record the date-dependent hearing test

**Changed.** `docs/OPENCODE_PROGRESS.md` only.

**Risk: NONE.** No code.

**Roll back.** `git revert 21da4fd`.

---

### `406f6f5` — step 6: make the hearing test independent of the weekday

**Changed.** `tests/test_lpms_flow.py` — one line: the Sunday the test books a hearing on is now looked for
in the following fortnight and never on `iso(3)` or `iso(4)`. **No assertion was changed.**

**Risk: NONE to the running app** (it is a test file). The effect is that the suite stops failing on
Wednesdays and Thursdays.

**Roll back.** `git revert 406f6f5` — and the test starts failing again on those days.

---

### The ten dependency upgrades (Step 5)

Each one is its own commit; each was checked with the build and the tests before it was committed.

| Commit | Change | Risk | Roll back |
|---|---|---|---|
| `4c51874` | `python-dotenv` 1.2.1 → 1.2.4 | **LOW** — the app only reads `.env`; the advisory is about *writing* one | `git revert 4c51874` |
| `ee8b102` | `requests` 2.32.3 → 2.34.2 | **LOW** — a patch-level jump in a library the app uses for every API call (the AI provider, the court scraper, SMS). A regression would show up as a failing call | `git revert ee8b102` |
| `7642cd3` | `Werkzeug` 3.1.3 → 3.1.9 | **LOW–MEDIUM** — Werkzeug is Flask's base; a change in `safe_join` touches how files are served from the vault and the Document Hub | `git revert 7642cd3` |
| `546990a` | `Pillow` (unpinned) → `Pillow==12.3.0` | **LOW** — Pillow reads the images an advocate uploads (OCR, previews). The pin makes the build reproducible; 12.3.0 is the newest that installs on Python 3.10 | `git revert 546990a` |
| `ad5eb97` | `react-router-dom` 7.15.1 → 7.18.4 | **MEDIUM** — it routes every page of the app. A behaviour change would show as "the page does not open". The 74 unit and 62 browser tests pass | `git revert ad5eb97` |
| `632ae82` | `dompurify` 3.4.13 → 3.4.17 | **LOW** — it sanitises the contract and vault HTML. A regression would be unsafe HTML shown to the advocate | `git revert 632ae82` |
| `154de7d` | `vite` 8.0.14 → 8.3.5 | **LOW** — the build and dev-server tool; it is not in the deployed bundle | `git revert 154de7d` |
| `ad8a1dc` | `browserslist` 4.28.2 → 4.29.4 | **NONE** — a build-time tool (babel) | `git revert ad8a1dc` |
| `497d384` | `undici` 7.29.0 → 7.30.1 | **NONE** — comes in through jsdom (the test DOM) | `git revert 497d384` |
| `797441c` | `brace-expansion` 5.0.6 → 5.0.12 | **NONE** — comes in through minimatch (eslint) | `git revert 797441c` |

**Note.** Every `npm install` on this branch needed `--legacy-peer-deps`, because the `@tiptap/*` versions
in `package.json` contradict each other (`@tiptap/extension-text-style` 3.29.2 needs `@tiptap/core`
3.29.2; the project pins 3.29.1). That fault is **pre-existing** — it is why "npm audit fix crashes" in the
earlier handoff — and it is why the lock file changed a lot in `632ae82` and `154de7d`.

---

### `53059f1` — step 5: the vulnerability triage

**Changed.** `docs/VULN_TRIAGE.md` (new) and `docs/OPENCODE_PROGRESS.md`.

**Risk: NONE.** Documents only.

**Roll back.** `git revert 53059f1`.

---

## 2. The files that touch production behaviour

Nine files. Everything else in the 17 commits is a test, a document, a script for the manager to run, or a
lock file.

| File | What changed in it | What a user could notice | How to undo it alone |
|---|---|---|---|
| `app.py` | (a) The saved-draft save refuses a row that belongs to another advocate and refuses an id that is not a short piece of text. (b) The start-up refusal names every missing variable in plain English. (c) `is_prod` is now read once instead of twice (same value, no change). | (a) A save with a hand-made id is refused instead of overwriting someone else's draft. (b) A misconfigured deployment says exactly what is missing. | `git revert 2ed3482` (a) / `git revert e9f9c0a` (b) |
| `routes/lpms_cases.py` | The hearing time is validated before the duplicate-day check. | A malformed time is a 400 instead of a 409 when the day is already booked. | `git revert 2ed3482` |
| `routes/document_routes.py` | The studio checks the material for instructions aimed at the assistant and does not send such lines; the answer gains `ignored_instructions`. | A file that tells the assistant to invent facts is no longer obeyed; the screen says how many lines were left out. | `git revert aacd705` |
| `routes/draft_engine_routes.py` | The extraction call has 3000 tokens and a continuation; the source is checked for instructions too; the answer gains `ignored_instructions`. | The facts the model reads are no longer lost; the form is fuller. | `git revert aacd705` |
| `utils/draft_engine/extract.py` | The prompt asks for the shortest exact quote instead of a whole sentence. | Nothing visible; the answers are shorter and easier to check. | `git revert aacd705` |
| `utils/injection_guard.py` | **New.** Recognises text that instructs the assistant. | Nothing on its own; it is used by the two routes above. | `git revert aacd705` (the file goes with it) |
| `frontend/src/components/AutoDraftWorkspace.jsx` | A notice when lines in the document were left out. | One extra line of text under the prompt box. | `git revert aacd705` |
| `requirements.txt` | `python-dotenv`, `requests`, `Werkzeug` pinned to the fixed versions; `Pillow` pinned to 12.3.0. | A different library version on Render. | `git revert` each of the four commits |
| `frontend/package.json` + `frontend/package-lock.json` | `react-router-dom` 7.18.4, `dompurify` 3.4.17, `vite` 8.3.5, and four build-time packages. | The routing and the HTML sanitiser are new versions. | `git revert` each of the six frontend commits |

**Not touched at all** (worth knowing, because it is most of the product): the 364 routes, the Document Hub,
the Practice module, the Case Vault, the contract analyzer, the conflict check, the export code, the
templates, the frontend screens (except the one notice above), and `firebase.json`.

---

## 3. How to roll back

**One commit** (safe on a shared branch — it adds a new commit that undoes the change):

```bash
git revert 2ed3482          # for example
```

**One whole step** (undo several commits; revert them in reverse order so the history stays readable):

```bash
git revert --no-commit 53059f1 546990a 797441c 497d384 ad8a1dc 154de7d 632ae82 ad5eb97 7642cd3 ee8b102 4c51874
git commit -m "revert: step 5 (the dependency triage)"
```

**Everything on the branch** (only if the branch is not shared and nothing is pushed):

```bash
git reset --hard a7ddf70        # or: git reset --hard fac6a2b   (keeps HANDOFF.md out)
```

**On the server, after a bad deploy:**

- *Backend*: Render → the service → Events → the failed deploy → **Rollback** (it redeploys the previous
  commit in a couple of minutes). The new tables and the `owner_user_id` columns are additive: rolling back
  leaves them in place, which is harmless.
- *Frontend*: the Firebase console → Hosting → the site → Releases → **"Rollback to this release"**. There
  is no `firebase hosting:rollback` command (checked in firebase-tools 15.19.0). The alternative is to
  rebuild the previous commit and `firebase deploy --only hosting:<SITE_ID>` again.
- The full order, including both sites and the smoke test, is in `docs/GO_LIVE.md`.

---

## 4. What this branch does **not** do

- It does not deploy anything, push anything, or change `firebase.json`.
- It does not upgrade the editor stack (`@tiptap/*`, `prosemirror-view`) — that needs the owner's
  approval, and `docs/VULN_TRIAGE.md` says exactly what it would take.
- It does not change the templates, the wording of any document, or the routes.
- It does not re-run the real-model evaluation after the last changes; the report in `docs/EVAL_REPORT.md`
  is from the run of 2026-10-22.
- The Python runtime on Render is still not pinned (there is no `runtime.txt`, `render.yaml` or
  `Dockerfile`), so Pillow 13 (and its 24 fixes) will not install until it is.
