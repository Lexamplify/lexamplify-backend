# Vulnerability triage

What `npm audit` and `pip-audit` say about this repository, what is actually shipped to a user's browser,
and what was done about it.

**Before this step:** `npm audit` reported **47** (10 high, 35 moderate, 2 low, 0 critical) and `pip-audit`
reported **43** advisories in 6 Python packages. The Python packages had never been audited before.

**After this step:** `npm audit` reports **36** (2 high, 33 moderate, 1 low, 0 critical) and `pip-audit`
reports **30** advisories in 3 packages. Every remaining **high** is either the editor stack (which needs
the owner's approval) or a package that is not in the deployed bundle.

The two commands (run on 2026-10-22):

```bash
cd frontend && npm audit --json
python -m pip_audit -r requirements.txt --format json      # pip-audit 2.10.1
```

---

## 1. The high and critical findings, one by one

### 1.1 What actually ships to the user

The honest question is not "is this package installed" but "does its code reach the browser or the
server". Two measurements:

```bash
cd frontend && npm ls --omit=dev --all     # the production tree: what the bundle is built from
grep -l "undici\|postcss\|nanoid\|source-map-js\|brace-expansion" frontend/dist/assets/*.js   # nothing
```

The production tree is: `@react-oauth/google`, `@tiptap/*` (the editor), `react-router-dom`, `dompurify`,
`lucide-react`, `marked`, `react`, `react-dom`, `zustand`. Everything else — vite, vitest, jsdom, eslint,
babel, postcss, nanoid, undici, browserslist, source-map-js, brace-expansion — is a **build or test tool**
and is not in `frontend/dist`.

### 1.2 The findings

| # | Package | Severity | Shipped to the browser? | The problem | The minimal safe fix | Done? |
|---|---|---|---|---|---|---|
| 1 | `@tiptap/core` 3.29.1 (+ 31 `@tiptap/*` packages) | **high** (+ 31 moderate) | **yes** — the drafting editor | A quadratic ReDoS in the block/inline Markdown attribute parsing, and `mergeAttributes` merging attributes it should not | Upgrade the whole editor stack to **3.32.0** (all `@tiptap/*` packages to the same version) | **No — needs the owner's approval** (see 2.1) |
| 2 | `prosemirror-view` 1.42.2 | **high** | **yes** — it is inside `@tiptap/pm`, i.e. the editor | An XSS in the paste handling | It comes in with `@tiptap/pm`; upgrading the editor stack to 3.32.0 brings `prosemirror-view` ≥ 1.42.3 | **No — same approval** |
| 3 | `react-router` 7.15.1 | **high** | **yes** | `deserializeErrors()` allowed an arbitrary constructor to be injected in React Router's **SSR** error handling. This app is a static SPA with no server rendering, so the path was not reachable | `react-router-dom` → **7.18.4** | **Done** |
| 4 | `vite` 8.0.14 | **high** | no (build tool) | Cross-origin script execution through custom middleware; files outside the project root could be served | `vite` → **8.3.5** | **Done** |
| 5 | `undici` 7.29.0 | **high** | no (via jsdom → vitest) | Denial of service through an unclean `WebSocketStream` close; a header-parsing flaw let a malformed response be read as valid | `undici` → **7.30.1** (inside the range jsdom already allows) | **Done** |
| 6 | `browserslist` 4.28.2 | **high** | no (via babel) | The cache grew without ever evicting, so a build with many distinct queries could run out of memory | `browserslist` → **4.29.4** | **Done** |
| 7 | `brace-expansion` 5.0.6 | **high** | no (via minimatch → eslint) | Consecutive non-expanding `{}` groups could expand in exponential time | `brace-expansion` → **5.0.12** | **Done** |
| 8 | `nanoid` 3.3.12, `postcss` 8.5.15, `source-map-js` 1.2.1 | **high** | no (via vite, css-tree) | A non-secure generator and an infinite loop at size zero; a path traversal through `sourceMappingURL`; an event-loop denial of service | They came in with the `vite` upgrade | **Done** |
| 9 | `dompurify` 3.4.13 | low | **yes** — it sanitises the contract and vault HTML the advocate reads | `IN_PLACE` could return a force-removed `rawtext` root whose text still carried attacker markup | `dompurify` → **3.4.17** | **Done** |
| 10 | `vitest` 4.1.10, `@vitest/mocker` | moderate | no (the test runner) | Code injection through mock registration; a path traversal in the mocker | Upgrading vitest would pull a new test runner; the vulnerable code only runs on the machine that runs the tests | **No — no fix published inside the allowed range; it never leaves the test machine** |
| 11 | `@babel/core` | low | no (build tool) | Arbitrary file read through a `sourceMappingURL` comment | Only reachable through a malicious source map in a build | **No — no fix available; build-time only** |

### 1.3 The Python side

| # | Package | Advisories | In the app? | The problem | The minimal safe fix | Done? |
|---|---|---|---|---|---|---|
| 12 | `python-dotenv` 1.2.1 | 1 | yes | `set_key()`/`unset_key()` follow symbolic links when rewriting a `.env` file. The app only **reads** `.env` (`load_dotenv()`), so the path was not reachable | → **1.2.4** | **Done** |
| 13 | `requests` 2.32.3 | 2 | yes | A URL parsing issue could leak `.netrc` credentials to a third party; `extract_zipped_paths()` used a predictable file name when extracting a zip | → **2.34.2** | **Done** |
| 14 | `Werkzeug` 3.1.3 | 4 | yes (Flask) | `safe_join()` allowed Windows device names (`CON`, `AUX`, `NUL`, …) and NTFS alternate-data-stream markers as path segments | → **3.1.9** | **Done** |
| 15 | `Pillow` 12.2.0 | 24 | yes — OCR and the document previews | Crashes, infinite loops and out-of-bounds reads in the image decoders (TIFF, GIF, PNG, PDF, EPS, XBM) on a crafted file | The fixes are in **Pillow 13.0.0**, which requires **Python ≥ 3.11**. This repository runs on **Python 3.10**, where 12.3.0 is the newest that installs | **Partly** — upgraded to 12.3.0; the rest needs Python 3.11 (see 2.2) |
| 16 | `PyPDF2` 3.0.1 | 1 | yes, as the **fallback** PDF text extractor (`utils/pdf_helper.py`, `routes/document_routes.py`, `routes/conflict_routes.py`) | A crafted PDF can make `__parse_content_stream` loop for ever | The package is end-of-life and has **no fixed version**. The maintained successor is `pypdf` (6.21.2) with the same `PdfReader` API | **No — needs a code change** (see 2.3) |
| 17 | `chromadb` 1.5.9 | 5 | only when `LOCAL_VECTOR_SEARCH=1`, which is **off** in production | Pre-authentication code injection, a code injection for authenticated users, and missing authorisation checks — all in the Chroma **server** | The app uses the in-process `PersistentClient`, never the server, and the feature is off | **No — recommended removal** (see 2.4) |

---

## 2. The four things that are left, and what each one would take

### 2.1 The editor stack (`@tiptap/*` + `prosemirror-view`) — 2 high, 31 moderate — **needs the owner's approval**

The brief says not to upgrade the editor stack without approval, so it was not done. Here is exactly what
it would take, because the current state is also broken in a way that blocks every other upgrade:

- **The installed tree is invalid.** `package.json` pins `@tiptap/core` 3.29.1, but
  `@tiptap/extension-text-style` 3.29.2 (and `@tiptap/extension-font-family` 3.29.2) require
  `@tiptap/core` **3.29.2**. `npm ls` reports `invalid: "3.29.2"`, and **every `npm install` fails with
  ERESOLVE** until the whole `@tiptap/*` family is on one version. This is why "npm audit fix crashes"
  (from the earlier handoff).
- **The fix:** move every `@tiptap/*` package to **3.32.0** (the version the advisories say is safe) and
  let npm resolve the family together. That fixes `@tiptap/core` (ReDoS) and brings
  `prosemirror-view` ≥ 1.42.3 (the paste XSS), and it repairs the install.
- **The risk:** 3.29 → 3.32 is three minor versions of the editor. The draft editor
  (`frontend/src/components/ContractTiptapEditor.jsx`) and the wizard's preview use it; a change in the
  extension API would show up as a broken editor. The proof that it is safe is: the build, the 74 unit
  tests **and the 62 browser tests** (which drive the editor) all green.
- **The alternative** (no upgrade): leave it. The ReDoS needs a document that is pasted into the editor;
  the XSS needs a crafted paste. Both are in the advocate's own browser, and the CSP limits what a
  successful XSS could do.

**My recommendation:** do the upgrade as its own step, with the browser tests as the proof, and do it
before the `app.py` / `AutoDraftWorkspace.jsx` splits — otherwise the split and the upgrade would have to
be checked together.

### 2.2 Pillow's remaining 24 advisories — **needs Python 3.11 on Render**

Pillow 13.0.0 has the fixes but requires Python ≥ 3.11; this repository runs on Python 3.10. There is
**no `render.yaml`, no `runtime.txt` and no `Dockerfile`** in the repository, so the Python version on
Render is whatever Render's default happens to be — which is also why the deployed Pillow may already be
13.0.0 (if Render is on 3.11+) and may not be (if it is on 3.10).

**The minimal safe fix:** pin the runtime. Add a `runtime.txt` (or `PYTHON_VERSION` in `render.yaml`) with
`3.11` or newer, and pin `Pillow==13.0.0` in `requirements.txt`. Two lines, and 24 advisories go.

### 2.3 PyPDF2's one advisory — **needs a small code change**

`PyPDF2` is end-of-life (the project was renamed to `pypdf`); there is no fixed 3.0.x. The app uses it in
three places, always as a **fallback** when `pdfplumber` and `PyMuPDF` have failed:

- `utils/pdf_helper.py:10`
- `routes/document_routes.py:83` (the third fallback for an uploaded file)
- `routes/conflict_routes.py:69`

`pypdf` has the same `PdfReader` API, so the change is `import PyPDF2` → `import pypdf as PyPDF2` in those
three files, plus `PyPDF2` → `pypdf` in `requirements.txt`. The upstream advisory says the fix is in
`pypdf`; `pypdf` 6.21.2 is the current release.

**The risk:** the fallback is only reached when the two better extractors have failed, so a behaviour
difference would be rare and would show up as "no text extracted" — the app answers that with a plain
message and the advocate can paste the text instead.

### 2.4 chromadb (5 advisories) and sentence-transformers — **recommended removal, needs approval**

`chromadb` and `sentence-transformers` are in `requirements.txt`, so Render installs them on every deploy,
even though the feature that uses them (`LOCAL_VECTOR_SEARCH`) is **off** and must stay off: the search
model alone needs about 500 MB, more than the whole free Render plan (512 MB).

`utils/local_search.py` imports `chromadb` **inside a function**, and only when `LOCAL_VECTOR_SEARCH` is
switched on. So both packages can be removed from `requirements.txt` without touching any code path that
runs today: the install gets much smaller, the 5 advisories go, and the memory story improves.

**The risk:** if somebody ever sets `LOCAL_VECTOR_SEARCH=1`, the import fails with a clear
`ModuleNotFoundError` instead of working. That is a feature that is documented as "leave unset" — and
the memory budget says it must not be turned on anyway.

---

## 3. What was changed (one package per commit)

| Commit | Change | Tests |
|---|---|---|
| `4c51874` | `python-dotenv` 1.2.1 → 1.2.4 | 45 passed |
| `ee8b102` | `requests` 2.32.3 → 2.34.2 | 56 passed |
| `7642cd3` | `Werkzeug` 3.1.3 → 3.1.9 | 47 passed |
| `546990a` | `Pillow` (unpinned) → `Pillow==12.3.0` | 47 passed, 7 skipped |
| `ad5eb97` | `react-router-dom` 7.15.1 → 7.18.4 | build + 74 passed |
| `632ae82` | `dompurify` 3.4.13 → 3.4.17 | build + 74 passed |
| `154de7d` | `vite` 8.0.14 → 8.3.5 | build + 74 passed |
| `ad8a1dc` | `browserslist` 4.28.2 → 4.29.4 | build + 74 passed |
| `497d384` | `undici` 7.29.0 → 7.30.1 | build + 74 passed |
| `797441c` | `brace-expansion` 5.0.6 → 5.0.12 | build + 74 passed |

Each upgrade was made on its own, and the build and the tests were run before the commit.

**Note on `npm install`:** every install needed `--legacy-peer-deps`, because the `@tiptap/*` versions in
`package.json` contradict each other (2.1). That is a pre-existing fault, not something these upgrades
introduced — but it is why the editor stack should be repaired.

## 4. What was deliberately not done

- **No `--force` install, no blind `npm audit fix`.** The audit's own suggested fix jumps the editor
  family to 3.32.0, which needs the owner's approval.
- **No editor upgrade** (2.1).
- **No removal of a feature** (chromadb, 2.4) and **no runtime change** (Python 3.11, 2.2) — both are the
  owner's decisions, and both are written out above with the exact change needed.
- **No new pins that break the build:** every upgrade was checked with the build and the tests.

## 5. How to re-check

```bash
cd frontend && npm audit --json | head -40
python -m pip_audit -r requirements.txt          # pip-audit 2.10.1 (pip install pip-audit)
```
