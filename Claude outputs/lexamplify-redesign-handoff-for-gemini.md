# LexAmplify UI Redesign — Full Conversation Handoff

**Purpose of this document:** a complete, self-contained record of every UI redesign decision made in this conversation, written so it can be fed to a different AI assistant (Gemini) as project knowledge and the work can continue there without re-deriving any of it. It assumes the reader has no memory of this conversation.

---

## 1. Project context

**Product:** LexAmplify (also called LexAI India) — an AI-powered legal practice platform for Indian advocates.

**Team:** JN (Narendar V), AI intern at Adtomate Solutions, is directing this redesign work. Yogesh (UX) and Saurabh (architecture) are the LexAI India managers who own final sign-off on design-system questions raised below.

**Stack:** Python/Flask backend (`ask_groq` LLM gateway, Groq `llama-3.3-70b-versatile` with fallback chains and token-budget handling), Vite + React frontend, Quill.js for rich text, Firebase Hosting (manual deploy: `git add/commit/push` → `npm run build` → `firebase deploy --only hosting`, no CI/CD pipeline). Live product: `test.lexamplify.com`.

**How this redesign work is being run — the established workflow:**
1. JN uploads screenshots (and sometimes screen recordings) of a feature's current live UI.
2. Claude (this assistant) redesigns the feature's *entire* UI — never a reskin, never trimming any existing option/field/control.
3. Claude delivers exactly two files per feature: a single-file vanilla HTML/CSS/JS mockup (`<feature>-v<N>.html`) and a companion markdown implementation brief (`<feature>-v<N>-brief.md`).
4. JN hands both files to **Antigravity**, a separate AI coding agent, which implements the redesign against the real Flask+React codebase.
5. Sometimes Antigravity's implementation doesn't match its own claims when checked against live screenshots — this has happened once already (Dashboard v2, see §6) and needs to be treated as its own failure mode, not dismissed.

**Standing instructions JN repeats for every feature (treat these as permanent, not per-request):**
- Redesign the *entire* UI of the named feature — never a reskin of what's in the screenshots.
- Never trim, remove, or simplify away any existing option, field, control, or flow.
- The result must be unique, smooth, elegant, clean, and impressive — not generic.
- Must support both dark and light themes fully.
- Every design decision should be framed around trust and reliability — "is this something a lawyer can trust," "is this reliable."
- Stay aware of the feature's actual purpose for lawyers, not just visual polish.
- Redesign *only* the named feature — do not touch or rebuild adjacent features.
- Bring genuine design enthusiasm/expertise to it, not a mechanical pass.

---

## 2. The design system — "Slate & Rust" (exact tokens, use verbatim)

This is the single most important section. Every mockup in this project uses these exact values — do not approximate or invent new ones.

### Color tokens

**Dark theme (default):**
```css
--bg:#191C1D; --paper:#212527; --paper-2:#2A2F31;
--ink:#D6D9D9; --ink-soft:#AAAEAE; --muted:#727776; --muted-2:#494E4D; --rule:#333939;
--accent:#CC6B48; --accent-soft:#3B281F;
--major:#D9AD5C; --major-soft:#35301C;
--on-accent:#FBF7EE;
```

**Light theme:**
```css
--bg:#DFE1E0; --paper:#EAEBE8; --paper-2:#E3E4E1;
--ink:#181B1D; --ink-soft:#494E51; --muted:#868C8E; --muted-2:#B3B8B9; --rule:#D2D5D4;
--accent:#B24A2E; --accent-soft:#EFDCD1;
--major:#9C7A2E; --major-soft:#F1E6C9;
--on-accent:#FBF7EE;
```

**Hero-only constants** (Virtual Courtroom feature specifically — never theme-flips):
```css
--hero-bg:#14171A; --hero-text:#F1F2F0; --hero-muted:rgba(241,242,240,.62); --hero-rule:rgba(241,242,240,.14);
```

### Color semantics — strict, product-wide contract

This is a **two-accent-color system**, and it is the single rule most often violated by Antigravity's implementations:
- **Rust (`--accent`)** = urgent / critical / primary action / active navigation state. Nothing else.
- **Amber (`--major`)** = caution / needs review soon. Nothing else.
- **Everything else** — default/neutral/informational states — uses plain `ink`/`ink-soft`/`muted`. No exceptions.
- **Never introduce a third accent color.** No green "success" states, no blue, no purple, ever, on any screen.

This rule has been violated in the actual live product multiple times (see §6 and §7's color-audit tables) — every violation found has been treated as a bug to fix during redesign, explicitly flagged in the brief rather than silently changed, with a recommendation to get final confirmation from Yogesh/Saurabh on whether it's an oversight or an undocumented exception.

### Typography

- **Fraunces** (italic axis only, weights 400–700) — used for *identity-bearing* text: page titles/mastheads, document and case/matter names, quoted clause or excerpt text. The rule of thumb applied throughout: if it's naming or quoting something specific (a case name, a document name, a clause as literally written), it gets Fraunces italic.
- **IBM Plex Sans** — all UI chrome: buttons, labels, body copy, form fields.
- **IBM Plex Mono** — reference/structured data: stat values, hashes, citation numbers, section references, timestamps, category tags, console/log output.

Google Fonts import used in every mockup:
```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@1,400;1,500;1,600;1,700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
```

### Icons

Hand-built inline SVG only — never an icon font, never emoji. 24×24 viewBox, rendered at 16px, 1.6px stroke, round caps/joins (`stroke-linecap="round" stroke-linejoin="round"`). One icon = one consistent meaning across the whole product; a real bug (a checkmark icon reused for an unrelated label) was caught and fixed once in this project — a caution to re-check icon reuse carefully in every new mockup.

### The Sidebar component — already built, stable, reused verbatim in every mockup

This is treated as an existing, already-implemented, stable piece of the real product — every mockup includes a matching copy of it for visual completeness, but the brief always says explicitly: **reuse the real component, do not rebuild it from the mockup's markup.**

Structure: docket-style nav index, grouped into "Workspace" / "Litigation & Disputes" / "Practice & Vault" sections. Fraunces italic firm name "LexAmplify" at the top with "LEXAMPLIFY" in mono beneath it as a credit line. Collapses into a floating rounded capsule via a `.sidebar.collapsed` class — the collapse/expand transition uses `width .42s cubic-bezier(.32,.72,0,1)` (plus matching margin/border-radius transitions on the same easing). Nav items use real inline SVG icons. Rust is used in the sidebar for exactly two things: the active nav item, and the Log Out action — nothing else in the sidebar is colored.

Full nav item list (in order): Dashboard, Contract Analyzer, Auto-Draft Studio | Court Resources, Legal Calendar, Virtual Courtroom | Case Vault, Conflict Engine, Firm Library, Legal Forms.

---

## 3. Design philosophy applied throughout (not just Contract Analyzer)

- Every visual decision must be tied to a stated functional reason — never redesign purely for aesthetics ("pure reskin" is explicitly what JN does not want).
- Preserve every existing option, field, and control — this has been restated as an explicit instruction in every single round.
- Populate mockups with realistic, plausible sample data (not empty placeholder states only) so the design can actually be judged in context — balanced against the newer instruction (Contract Analyzer round) that sample data must never be presented as if it were the *only* possible shape of the data; it must be visibly array-driven.
- State scope boundaries explicitly in every brief: what's in scope, what's deliberately not touched, what already works elsewhere and shouldn't be rebuilt.
- Self-audit before shipping — catch inconsistencies (a wrong icon reuse, a stray off-palette color) during the build, not after.
- Be explicit, in every brief, about what's "verified" (actually checked/tested) vs. "reasoned but not verified" (a judgment call that hasn't been confirmed against a real device or real backend behavior). Mobile responsiveness in particular is *always* flagged as reasoned-not-verified, never claimed as confirmed.
- When a feature carries a specific trust-critical risk, the redesign should make *preventing* that risk the actual centerpiece of the design, not a decorative footnote. (Case Vault → the Provenance Trail hash-chain is the centerpiece. Contract Analyzer → sourced/cited risk flags plus explicit human-in-the-loop accept/discard is the centerpiece.)

---

## 4. Process lessons learned in this project (apply going forward)

- **Never claim something is "already fixed" without checking the live app.** A written implementation report or passing test suite is not proof of a working live page — this exact failure happened with Dashboard v2 (see §6).
- **Caching needs explicit invalidation** (version + TTL) wherever a feature introduces or touches cached data — flagged as a standing caution any time caching comes up.
- **Always confirm the exact file pair** being handed to Antigravity — a past mistake fed Antigravity the wrong files for one feature (Firm Library), causing wasted implementation effort.
- **The mockup's vanilla-JS DOM-manipulation pattern must become real React state and conditional rendering** in the actual implementation — it must never be ported as literal `innerHTML` string-building or `dangerouslySetInnerHTML`. This has been flagged as a specific security/quality risk more than once (Legal Forms' rich text, and again for Contract Analyzer's AI-generated rewrite diffs — see §7).
- **Diagnose root cause before proposing a fix.** When Antigravity's implementation didn't match its own claims (Dashboard v2), the response was a ranked list of hypotheses and specific verification steps to hand back — not a guessed fix.
- **Visual/mobile claims from this assistant are "reasoned, not verified"** — there is no headless browser available in this environment, so any layout/responsiveness claim is explicitly caveated as such in every brief.
- **Every brief ends with a Definition of Done checklist** — a concrete, checkable list, not prose.
- **Any place where frontend and backend must agree on a data shape or a shared feed gets explicitly flagged as an integration risk** in the brief, with a direct question to resolve rather than an assumption.

---

## 5. Feature-by-feature status as of this handoff

| Feature | Status | Live-verified? |
|---|---|---|
| Sidebar | Done, stable, existing component | Yes (foundational, reused everywhere) |
| Virtual Courtroom | Done, stable (built in an earlier conversation not covered in detail here) | Presumed stable |
| Case Vault | Redesigned (v1, see §6.1) | Not yet confirmed live |
| Dashboard | Redesigned (v2, see §6.2) | **Confirmed broken live** — see §6.4, unresolved |
| Legal Calendar | Redesigned (v1, see §6.3) | **Confirmed correct live** — see §6.4 |
| Contract Analyzer | Redesigned (v1, see §7) — the most recent, most detailed round | Not yet built/verified by Antigravity |
| Conflict Engine | **Not yet redesigned — next up, but blocked on current live screenshots** (see below) | Not independently re-verified live in this conversation |
| Firm Library | Designed in an earlier round | Not implemented — wrong files were mistakenly handed to Antigravity |
| Legal Forms | Designed in an earlier round | Not yet handed off; has an open `dangerouslySetInnerHTML` security caution on its rich-text rendering |
| Workspace Hierarchy (Matter Launcher / Matter Dashboard / Team Dashboard / Org Dashboard) | Architecture built via Gemini (§9.1); Slate & Rust visual redesign done (§9.3, `workspace-hierarchy-v1.html`) | Not yet implemented/verified — and persistence/access-control questions in §9.2 are still open |

---

## 6. Prior rounds — what was actually redesigned

### 6.1 Case Vault (`case-vault-v1.html` / `case-vault-v1-brief.md`)

First redesign attempt was **wrong and discarded**: it used a completely different delivery mechanism (a multi-artboard "Design" canvas format with invented templating) and an invented, wrong color palette including a forbidden green "success" color. JN corrected this explicitly by uploading the authoritative knowledge-transfer document and asking for a redo that actually matched the established system. The corrected v1 below is what stands.

**Scope:** Overview (stat tiles + an AI Case Synopsis card that can be generated on demand), Document Vault (folder/document browser with categorized folders, upload dropzone, populated/empty toggle), Case Tracker (CNR-number eCourts lookup, a list of tracked matters, a 16-field "Add Matter" modal grouped into 5 sections: case identity, court details, parties & counsel, dates & status), Legal Drafts (empty state, links out to Auto-Draft Studio), Provenance Trail (hash-chained, tamper-evident audit log of every AI action and file event — this is the trust centerpiece of the feature), Timeline (AI-extracted chronological event list pulled from vault documents).

**Data contracts defined:** `Document`, `Matter` (all 16 Add-Matter fields), `ProvenanceEntry` (hash-chained), `TimelineEvent`, `Draft`.

**Key flagged discrepancy:** the live screenshots showed what looked like 7 document folders while the written project record described 5 — flagged as needing confirmation, not silently resolved either way.

**Key integration risk:** `Document.matterId` needs to be a canonical, shared matter/case ID used consistently across Case Vault, Case Tracker, and (later) Legal Calendar — this same concern resurfaces in every subsequent feature that references a case/matter.

### 6.2 Dashboard ("Advocate Terminal") — v2 (`dashboard-v2.html` / `dashboard-v2-brief.md`)

Called v2 because an earlier Dashboard redesign had been marked "complete/stable" in the project record — this round exists specifically because the live product didn't actually match that record or the design-system contract.

**Scope:** masthead ("Good afternoon, Counsel" in Fraunces, live eCourts-sync badge), CNR sync bar, four stat cards (Limitation Expiries, Pending Judgments, Drafts Pending Review, Tracked Cases), a two-panel "Morning Triage & Vault Digest" (urgent items + recent vault activity, with a toggle to preview both the populated and the all-clear empty state), a "Quick Draft" banner, and a six-module "Law Practice Modules" launch grid.

**Color-contract fix applied:** the live Dashboard used four different colors across the four stat cards (red/orange/purple/blue) plus a green "sync active" badge and a green "Clear" checkmark — all remapped to rust (Limitation Expiries only, since a missed limitation deadline is malpractice exposure) / amber (Pending Judgments only) / plain ink-muted (everything else). This drift was explicitly flagged for confirmation with Yogesh/Saurabh, not silently corrected.

**Data contracts defined:** `StatMetric` (with a *fixed* severity per metric key — severity is not supposed to vary with the count, only the visual escalation at `value > 0` does), `UrgentItem`, `VaultActivityItem`.

**Key integration risk:** the "Urgent — Next 48 Hours" panel and Legal Calendar's "Upcoming" rail (§6.3) are conceptually the same underlying feed (deadlines/hearings sorted by proximity, just windowed differently) — flagged that these must be one shared backend query, not two independently maintained ones that could drift.

**Also flagged:** the written project record's description of Dashboard's intended shape didn't match what was actually live — the live product was meaningfully richer than the record described, meaning the written record itself is stale and other briefs referencing it should be double-checked.

### 6.3 Legal Calendar ("Tickler Engine") — v1 (`legal-calendar-v1.html` / `legal-calendar-v1-brief.md`)

First redesign round for this feature (not previously in the project's file inventory).

**Scope:** "Sync Google Calendar" action (uses a generic sync icon, deliberately not a reproduction of Google's branded "G" logo — flagged that if brand guidelines require the real mark, source it officially rather than hand-drawing it), a real month grid with working date math (day/month navigation, today-highlighting), click-a-day to open a combined Day Agenda + Quick Add modal (fields: Target Date read-only, Event Title, Event Type select [Hearing / Deadline / Task-Internal], Related Case ID, Location/Court, Opposing Counsel), and a legend.

**One deliberate *addition*, explicitly framed as additive not a trim:** an "Upcoming" rail beside the month grid showing the next chronologically-ordered items with a countdown ("Tomorrow," "In 7 days") regardless of which month is currently in view — justified because a bare month grid can bury an urgent deadline that happens to be off-screen in the current view.

**Color-semantics solution worth carrying forward:** three event types (Deadline / Hearing / Task) need to be told apart, but the product only has two semantic accent colors. Solved by pairing icon + text label with color, never relying on color alone: Deadline = rust (most urgent — malpractice exposure), Hearing = amber (time-sensitive but scheduled/known), Task = plain ink/muted (informational). No third color was introduced.

**Data contract defined:** `CalendarEvent` (id, date, type, title, relatedCaseId, location, opposingCounsel, createdBy).

**Key integration risks:** (1) same canonical case/matter ID concern as Case Vault — now three features (Calendar, Case Vault, Case Tracker) all assume one shared ID; (2) same shared-feed concern as Dashboard's urgent panel (§6.2), stated from the other side.

**Verification result:** this implementation was confirmed correct against live screenshots (§6.4) — the one thing worth confirming rather than assuming: whether the day-grid's empty state (no event dots visible) reflects genuinely no real events yet, versus a silent rendering failure.

### 6.4 Live-verification diagnostic (not a redesign round — a bug investigation)

After Antigravity implemented both Dashboard v2 and Legal Calendar v1 and reported full success (its own `implementation_plan.md` and `walkthrough.md` claimed a faithful implementation with all automated tests passing — 50/50 Vitest, 27/27 Pytest, clean build), JN reported the *actual live result looked totally different*. A diagnostic comparison against real screenshots found:

- **Legal Calendar: correct.** Matches the brief and mockup closely. One minor deviation (live page title reads "Legal Calendar Dashboard" instead of "Legal Calendar" — worth confirming intentional vs. leftover copy) and one thing to directly confirm rather than assume (empty day-grid could be genuinely-no-events or a silent data-fetch failure).
- **Dashboard: confirmed broken**, in direct contradiction to Antigravity's own success report:
  1. The masthead, CNR sync bar, and all four stat tiles are completely absent from the live page — the page still shows the app's old generic header, with content starting directly at the urgent-items panel.
  2. The panels that do render ("Urgent," "Recent Vault Activity," "Quick Draft") are missing their card styling entirely — flat unstyled text with no border/background/padding.
  3. The "Upload document" link renders in an off-palette blue/violet color — notably, this is the exact kind of color drift Antigravity's own walkthrough claimed to have eliminated.

**Root-cause hypotheses ranked** (most likely first): (1) a render error or a stuck data-gate in the masthead/CNR/stat-grid subtree of the Dashboard component — React would silently render nothing for that subtree while unrelated sibling content still renders, which matches the observed pattern; check browser console for a thrown/rejected error first. (2) A CSS scoping or build issue — new classes not actually present in the compiled stylesheet (a CSS Modules hash mismatch, a Tailwind purge issue, a missing stylesheet import), which would explain both the missing card styling and the fallback-default blue link color. (3) Less likely but cheap to check first: a stale cached bundle — though this doesn't fully fit since Legal Calendar looks correct on the same deploy.

**What was handed back to Antigravity to check** (not a rewritten brief): an actual screenshot re-check after a hard refresh, the browser console output on `/dashboard`, DevTools "Computed" styles confirmation for where `.panel`/`.draft-banner`/the link color are actually defined and applied, and confirmation that the router is actually resolving `/dashboard` to the new component and not a stale duplicate.

**Status: this Dashboard bug is unresolved as of this handoff.** No fix has been confirmed. This should be picked up again if JN brings it back up, but it is separate from and should not block Contract Analyzer work.

---

## 7. Most recent round — Contract Analyzer (`contract-analyzer-v1.html` / `contract-analyzer-v1-brief.md`)

Explicitly called **"the core of this software"** by JN — the highest-stakes feature redesigned so far. All the standing instructions from §1 apply, plus one new, explicit, hard constraint that did not appear in any earlier round:

> **Do not hardcode anything shown in the screenshots. All results (risk counts, flagged clauses, missing-clause suggestions, citations, conflict results, chat) must render dynamically from arbitrary real document-analysis output, because lawyers upload documents of very different lengths, some exceeding 50 pages. Build carefully.**

### 7.1 Full feature scope preserved (nothing trimmed from the 16 reference screenshots)

- **Upload flow:** drag-and-drop or paste-text for the contract itself; an optional firm playbook/rule-book upload (so flags can cite an internal firm rule, not just generic risk); a review-posture "mode" selector (labeled Balanced / Aggressive / Quick scan in this redesign — explicitly flagged as an inferred guess at the real labels/behavior, needing confirmation with product before shipping).
- **Scanning state:** a live "Hybrid Engine Console" log (terminal-style, streamed lines) plus a progress bar and stage label.
- **Document editor pane:** a Quill-style formatting toolbar (presentational in the mockup — real editing capability should match whatever the live editor already supports, not be rebuilt from scratch here), inline-highlighted flagged clauses, inline "missing clause" markers at the point in the document where something standard is absent, and a new usability addition — a flag navigator in the toolbar ("Flag 2 of 6," prev/next) so a lawyer can jump between issues without scrolling a 50-page document. This is framed as pure usability, not new functionality.
- **Document summary bar:** pages read, risks flagged, missing clauses, citations found, scan time, current mode — all computed values, never fixed.
- **Six analysis-rail tabs, each with its full sub-flow preserved:**
  - **Risks** — severity-ranked flagged-clause cards; clicking one opens a **Revision Workshop modal** containing: the original clause quoted (Fraunces italic), a **Playbook Guardrail** citation box explaining which internal firm rule was violated and why, an **AI-suggested rewrite shown as a tracked-changes diff** (`<del>`/`<ins>` styling), a **Regenerate rewrite** action, and **Accept / Discard** buttons that resolve the flag.
  - **Missing** — checkbox-selectable missing-clause suggestions, each with a rationale and an expandable model-clause text, individual "Insert" per item, and a bulk "Add selected clauses" action once anything is checked.
  - **Ask AI (RAG Chat)** — a chat scoped to answer only from the loaded document, with suggested-prompt chips and inline citation chips on answers pointing back to specific clauses.
  - **Citations** — supporting precedent/statute cards, each tagged by firm-vault status, with Insert-citation / Open-source / Search-similar actions.
  - **Comments** — matched as-is; currently just an empty state in the live product.
  - **Conflicts** — upload a reference document to compare against, run a scan, get severity-tagged conflict results, click one to open a **detail modal with a side-by-side clause comparison** (this document vs. the reference document) and an **Apply Resolution** action.

### 7.2 Color-contract violations found and fixed (explicitly flagged, not silently changed)

| Live element | Live (wrong) color | Fixed to |
|---|---|---|
| Risk-count / severity badges | Red / orange / green | Rust (critical) / amber (caution) / plain ink-muted (info) |
| "Rewrite Clause with AI" button | Purple | Neutral secondary button — re-reasoned that Accept/Discard, not Regenerate, is the actual primary action in the workshop, so those get rust-primary instead |
| "Add Selected Clauses to Contract" button | Blue | Rust primary |
| "NOT IN FIRM VAULT" tag | Red | Amber — reasoned as a caution/awareness signal (unverified against firm sources), not a critical error |
| Conflict severity pills (CRITICAL/MAJOR) | Red / orange | Rust (critical) / amber (major) / plain ink-muted (minor) — reusing the exact same three-tier mapping as clause-risk severity so the color language is learned once |

Flagged for direct confirmation with Yogesh/Saurabh, same as the Dashboard color drift.

### 7.3 Data contracts defined (all explicitly variable-length arrays)

```
Risk: { id, severity: "critical"|"caution"|"info", title, excerpt,
        location: {section, page}, original, playbookRule (nullable),
        guardrailText (nullable),
        suggestedRevision: { diffHtml/structuredDiff, status: "pending"|"accepted"|"discarded" } }

MissingClause: { id, title, rationale, modelClauseText, selected (UI-local) }

Citation: { id, name, citationRef, snippet, inFirmVault: boolean, relatedRiskId (nullable) }

Conflict: { id, severity: "critical"|"major"|"minor", title, referenceDocumentName,
            summary, clauseInThisDocument: {text, location},
            clauseInReferenceDocument: {text, location}, status: "open"|"resolved"|"dismissed" }

ChatMessage: { id, role: "user"|"assistant", text, citations: string[] }

DocumentMeta: { fileName, pageCount, wordCount, scanMode, scanDurationSec, scannedAt }
```

### 7.4 The "don't hardcode, scale to 50+ pages" requirement — treated as first-class

This is its own called-out section in the brief, not a footnote:
- Every count on screen (risks, missing clauses, citations, conflicts, chat messages) must be computed from `array.length` at render time, never a fixed number anywhere in markup.
- The document pane must not assume the whole document fits comfortably in the DOM at once — pagination/virtualization needs to be confirmed with Antigravity for real long-document performance, not assumed to just work.
- The flag navigator must work identically whether there are 3 flags or 80 — never hardcode against a small test case.
- Scan progress and the console log must be **streamed from real backend progress** (page N of M, current stage), not a fixed-duration canned animation — the mockup's console script is explicitly flagged as illustrative-only, timed for demo purposes, and must not be copied as-is into the real implementation.
- **Explicit security/quality warning:** the mockup represents the AI rewrite diff as a raw HTML string (`<del>`/`<ins>` tags in a data field) purely as a mockup shortcut. The real backend should instead return a **structured diff** (a list of `{type: unchanged|removed|added, text}` segments) that the frontend renders into `<del>`/`<ins>` itself — never `dangerouslySetInnerHTML` a diff string coming directly from an LLM. This is the same class of risk already flagged once before for Legal Forms' rich-text rendering, and is called out as more acute here because the input is AI-generated text a lawyer may not fully re-read before accepting.

### 7.5 What's simulated in the mockup vs. needs real wiring

All risk/missing/citation/conflict content, the console log, "Regenerate rewrite," the chat responses, the reference-document conflict scan, and the playbook-upload-driven `playbookRule`/`guardrailText` fields are all illustrative/fake in the mockup and need real backend wiring. Notably: **Accept/Discard in the Revision Workshop currently only removes the card from the UI list — the real implementation needs to actually mutate the document content and log the action**, and it's an open, explicitly-flagged question whether that log should go into the same Provenance Trail already built for Case Vault (§6.1), given this whole product's trust/audit framing.

### 7.6 Integration risks flagged

1. **Conflicts tab vs. the standalone Conflict Engine feature (reported at v9):** the Conflicts tab here is functionally the same capability as the already-existing standalone Conflict Engine elsewhere in the sidebar. This needs a direct answer — does Contract Analyzer's Conflicts tab call the *same* backend service, or does it duplicate the logic? If duplicated, the two will eventually disagree on what counts as a conflict, mirroring the Dashboard/Calendar shared-feed risk already flagged in §6.2/§6.3. The mockup includes a visible on-screen note stating the shared-backend assumption specifically so this doesn't get lost.
2. **Contract Analyzer ↔ Case Vault:** if analyzed contracts can be saved into Case Vault as a `Document`, confirm whether the risk/citation/conflict analysis travels with it or has to be regenerated on reopen.

### 7.7 Scope boundaries for this round

Sidebar reused, not rebuilt. Does not cover the standalone Conflict Engine, Firm Library, Auto-Draft Studio, or Legal Forms as their own features. The rich-text toolbar is presentational only in the mockup. Mobile responsiveness is reasoned (built to collapse the two-column workbench to one column below 1080px) but not device-verified.

### 7.8 Definition of Done for Contract Analyzer (full checklist)

- All upload/scanning/analyzed states and all six rail tabs present, nothing trimmed from the 16 reference screenshots.
- Only rust/amber/plain-ink used anywhere on the screen — every violation in §7.2 confirmed fixed and confirmed with Yogesh/Saurabh.
- Every list renders from a real array of arbitrary length — tested against both a short (2–3 page) and a long (50+ page) real document.
- All counts (summary bar, tab badges) computed, never fixed.
- Flag navigator correctly counts/cycles an arbitrary number of flags.
- Scanning progress reflects real backend progress proportional to actual document length.
- AI rewrite diffs rendered from a structured diff object — confirmed no `dangerouslySetInnerHTML` on model output.
- Accept/Discard actually mutates document content and is logged to an audit trail (confirm whether it's Case Vault's Provenance Trail).
- Conflicts tab confirmed to call the same backend as the standalone Conflict Engine.
- Mode selector's real labels/behavior confirmed with product, not shipped as an inferred guess.
- Sidebar reused, not rebuilt.
- Mobile layout checked on a real device.

---

## 8. Open items to carry into the next assistant's work

1. **Dashboard v2's live implementation is confirmed broken** (§6.4) — unresolved. If picked back up, the next step is getting the specific diagnostic data requested from Antigravity (console errors, DevTools computed styles, router confirmation), not guessing at a fix.
2. **Case Vault v1's live implementation has not yet been confirmed** against real screenshots the way Dashboard and Legal Calendar were.
3. **Contract Analyzer v1 has just been produced in this conversation and has not yet been handed to Antigravity or checked live** — this is the newest, least-verified deliverable as of §7, though see §9 below — a canonical matter ID now exists and Contract Analyzer's briefs should be revisited to use it.
4. ~~Is there one canonical case/matter ID shared across Case Vault, Case Tracker, and Legal Calendar, or does each feature generate its own?~~ **Resolved as of §9** — `useOrganizationStore`'s `matters[].id`, propagated via `?matterId=` query params, is now the canonical ID. Every existing brief's data contract (`Document.matterId`, `CalendarEvent.relatedCaseId`, Dashboard's `UrgentItem.matterId`) should be re-pointed at this real ID source rather than treated as an open question.
5. **Two integration questions still need real answers, not assumptions:**
   - Do Dashboard's "Urgent — Next 48 Hours" and Legal Calendar's "Upcoming" rail share one backend feed?
   - Does Contract Analyzer's Conflicts tab call the same backend as the standalone Conflict Engine feature?
6. **The two-accent-color contract (rust/amber only) has now been found violated in the live product at least twice** (Dashboard's stat cards/badges, and everything listed in §7.2 for Contract Analyzer) — worth raising as a pattern, not just fixing instance-by-instance: either the written design-system rule needs firmer enforcement in code review, or there's an unwritten exception somewhere that needs to be written down. **See §9.2 for a third, newer instance found in the Organization/Team/Matter work.**
7. **Mode selector labels for Contract Analyzer** ("Balanced/Aggressive/Quick scan") are an inferred guess and need product confirmation.
8. **Whether Revision Workshop Accept/Discard actions should log to Case Vault's Provenance Trail** is an open design question, not yet decided either way.
9. **See §9.2 in full for a new, higher-priority set of open items** raised by the Organization/Team/Matter architecture — in particular the localStorage-only persistence model and the emoji-icon usage, both of which need resolution before any further feature is built on top of this layer.

---

## 9. Update — the Organization → Team → Matter workspace architecture (built via Gemini, outside this conversation)

Between rounds, JN worked with a different assistant (Gemini) to build a foundational architectural layer that the redesigns in §6–§7 did not have: a real 3-tier workspace hierarchy — **Organization (firm) → Teams (practice groups) → Matters (active case files)** — replacing what had been a flat, single-tier, hardcoded-card matter list. This section folds that work into the shared project record so nothing gets lost or duplicated going forward.

### 9.1 What was built

**Reference architecture:** extracted from an audit of 9 screens of the Lexlegis.ai enterprise platform, then adapted to LexAmplify's Indian legal-domain needs and the Slate & Rust design system.

**Central store:** `frontend/src/stores/useOrganizationStore.js`, Zustand with `persist` middleware (localStorage-backed). Holds `organization`, `teams[]`, `matters[]` (each matter carrying its own `deadlines[]`, `tasks[]`, `documents[]`, `activity[]`), plus `activeOrgId` / `activeTeamId` / `activeMatterId` pointers. Actions include `setActiveMatter`, `setActiveTeam`, `createTeam`, `createMatter`, `updateMatterStatus`, `addTask`/`toggleTask`, `addDeadline`.

**Global Context Capsule** (`ContextCapsule.jsx`, mounted in the topbar): a three-segment pill showing `[ • <matter> ] [ • <team> ] [ • Org Dashboard ]`, each segment clickable to route to and pop over matter-switching / team-switching / the firm dashboard.

**Four new views:**
- `MatterLauncher.jsx` (`/workspace/matters`) — the entry gateway; search + team-filter tabs; "New team" / "New matter" actions; a responsive grid of matter cards rendered from the store.
- `MatterDashboard.jsx` (`/workspace/matter/:matterId`) — 5 telemetry tiles (Documents, Open Tasks, Deadlines, Hours Logged, Team) computed from real array lengths; a Quick Jump dock that routes into Case Vault, Contract Analyzer, and Virtual Courtroom **with the matter ID passed as a query param** (`/contract-analyzer?matterId=...`, `/vault?matterId=...`, `/courtroom?matterId=...`); a two-column layout for deadlines/tasks/activity and documents/roster/chat.
- `TeamDashboard.jsx` (`/workspace/team/:teamId`) — team roster, a status-distribution performance bar (Open/Active/On Hold/Closed), guarded against divide-by-zero on an empty team, and the team's own matter list.
- `OrgDashboard.jsx` (`/workspace/org`) — firm-wide aggregate metrics (headcount, team count, open matters, 30-day AI run pool) and a team directory.

**Routing:** new routes under `/workspace/...`, with `/matters` and `/chamber` kept as backward-compatible redirects.

**Stated design-token usage:** rust for active-matter indicators, primary buttons, and the active capsule segment; amber for "On Hold" status and cautionary deadlines; neutral ink/paper/rule tokens for everything else — explicitly stated as "zero arbitrary blue, green, or purple accents," matching the product's two-color contract.

**Explicitly stated goal, matching this project's own standing principle almost word for word:** no hardcoded fallback arrays anywhere in the runtime path (`mockRisks`, `mockMatters`, `SAMPLE_CONTRACT` were named specifically as things to have eliminated).

### 9.2 Review of this work — findings, not yet verified against the actual running code

**Important caveat up front, consistent with this project's own "verified vs. reasoned" rule:** this review is based entirely on the written specification JN provided (store shape, component responsibilities, a stated checklist) — not on reading the actual source files or a live screenshot. Nothing below should be treated as a confirmed bug; it's what's worth checking before building further on top of this layer, the same way Dashboard v2's claimed-vs-live gap (§6.4) was worth checking rather than trusting the report.

**High priority:**

1. **localStorage-only persistence is very likely insufficient for what this layer is supposed to do.** Teams are described as having a member roster and an "Invite user" action — that only makes sense as a *shared, multi-user* workspace. A Zustand `persist` store backed by `localStorage` lives in one browser, on one device, for one user. As specified, a second lawyer invited to a team would not see any of its matters, tasks, or deadlines unless the whole store is also being synced through a real backend the spec doesn't mention. This is the single most important thing to confirm before treating this architecture as done: **is there a backend API behind this store, with `persist` as just an offline/instant-load cache — or is localStorage actually the only persistence?** If it's the latter, "Full Persistence" in the verification checklist (item 5) is true only in the narrow sense of surviving a refresh in the same browser, not in the sense the feature's own UI (rosters, invites) implies.
2. **No stated access control.** Following from #1: even with a real backend, nothing in the spec describes role enforcement (Owner vs. member permissions) or confirms that a team's matters are actually scoped server-side to that team's members — as opposed to just hidden by the frontend UI for anyone who has the app open. For a legal product where Case Vault's whole design centerpiece is a tamper-evident, confidentiality-conscious audit trail (§6.1), a client-side-only visibility model would be a real gap, not a cosmetic one. Worth a direct question before this ships: where does authorization actually happen?
3. **Emoji used for icons** (`👥 New team`, `+ New matter`, `🔍 Ask`, `💬 Interact`, `✍️ Draft`, `✨ MIRA`) directly conflicts with this project's icon rule, applied without exception in every other redesigned screen: hand-built inline SVG only, 24×24/16px/1.6px stroke, never an icon font, never emoji. If these are literally emoji characters in the shipped UI (rather than just shorthand in this write-up), they should be replaced with the same SVG icon system used everywhere else — otherwise this new layer will visually clash with Case Vault, Dashboard, Calendar, and Contract Analyzer the moment a user moves between them.

**Medium priority:**

4. **Status-color mapping needs the same audit already applied to Dashboard and Contract Analyzer.** The spec confirms amber for "On Hold" but doesn't say how "Open," "Active," and "Closed" are colored. If the implementation reached for a status-pipeline convention (e.g., green=Active, grey=Closed, red=something), that's the exact same two-color-contract violation already found and fixed twice in this project (§6.2, §7.2) — worth checking explicitly, not assuming it was avoided just because rust/amber were correctly used elsewhere.
5. **"Hours Logged" is one of the five headline telemetry tiles on the Matter Dashboard, but no time-tracking/billing UI, data contract, or entry flow was described anywhere in this architecture or in any prior brief.** If there's currently no way to actually log hours, this tile will either always read 0 or need its own follow-up feature — either way it's worth flagging now rather than discovering later that it's effectively a new hardcoded/empty stat, which is the same class of problem as the mock data this work was specifically meant to eliminate.
6. **Typography rules (Fraunces for identity-bearing names, IBM Plex Mono for structured/numeric data, IBM Plex Sans for chrome) are confirmed only for `MatterLauncher`'s headline** in the spec. Worth confirming the same rules were carried through `MatterDashboard`, `TeamDashboard`, and `OrgDashboard` — matter titles and team names should be Fraunces italic, telemetry values should be IBM Plex Mono, consistent with every other screen in this project.
7. **Navigation placement of "Org Dashboard" relative to the existing "Dashboard" (Advocate Terminal, §6.2) is unclear from the spec.** These are different scopes — one personal/individual, one firm-wide executive — but similar names risk confusing a user switching between them. Confirm whether Org Dashboard is reachable only via the Context Capsule (as described) or also needs a Sidebar entry, and if so, how it's worded to stay distinct from the existing "Dashboard" nav item.

**Lower priority / worth a note:**

8. Backward-compatible redirects (`/matters`, `/chamber` → `/workspace/matters`) are good practice and match this project's general caution about not silently breaking existing links.
9. The divide-by-zero guard on the Team Dashboard's performance bar (`0% when total matters = 0`) is exactly the kind of empty-state defensiveness this project has consistently valued (e.g., Case Vault's and Dashboard's explicit empty-state toggles) — worth calling out as a good pattern to keep, not just a bug that happened to be avoided.

None of the above blocks continuing to build on top of this layer — but items 1–3 in particular should be confirmed (via the same "actual screenshot / DevTools / console check" standard applied to Dashboard v2 in §6.4, not by re-reading the source) before any further feature redesign assumes multi-user team collaboration or ships icons that don't match the rest of the product.

### 9.3a Verified against the real source (not just screenshots) — a bigger architectural issue found

JN connected the actual `lexai-india` repository, which made it possible to check the §9.2 findings against real code instead of a written spec — and to go further. This section replaces "reasoned, not verified" with what the source actually shows. File paths below are relative to `frontend/src/`.

**The most important finding: there are two separate, simultaneously-mounted context-switcher systems in the topbar today, not one.**

- The new Organization/Team/Matter system from §9.1 is real and correctly wired: `components/organization/ContextCapsule.jsx`, `MatterLauncher.jsx`, `MatterDashboard.jsx`, `TeamDashboard.jsx`, `OrgDashboard.jsx`, and both creation modals all consistently import the same store, `stores/useOrganizationStore.js`. That part is internally consistent.
- But `AppRouter.jsx`'s `Layout` also mounts a second, older component in the same topbar: `<ChamberSwitcher variant="topbar" />` immediately followed by `<ContextCapsule />` (line ~860), and a third instance, `<ChamberSwitcher variant="sidebar" .../>`, in the sidebar itself (line ~719). `ChamberSwitcher.jsx` reads from a **different store**, `stores/useChamberStore.js` — a "Bench" selector (`Commercial Appellate Bench`, `Arbitration & Infrastructure`, `Corporate M&A Advisory`, `Private Chamber (Solo)`) with its own, much richer per-matter data model (`counsel`, `forum` with court/bench/stage/next-date/urgency, `ecourtsSync`, `integrity.conflictStatus`, `telemetry.vaultDocuments/flaggedRisks/simulationsRun`).
- **This is exactly what's visible in the Conflict Engine screenshots JN provided**: the topbar shows `[COMMERCIAL APPELLATE BENCH ▾]` (ChamberSwitcher) directly beside `[ • My 1st Matter ] [ • My Private Space ] [ • Org Dashboard ]` (ContextCapsule) — two unrelated context-switchers, backed by two unrelated stores, rendered side by side. This isn't a hypothesis; it's confirmed in both the screenshot and the router/component code.
- **The exact hardcoded sample matter this whole architectural effort was meant to eliminate is still in the codebase** — `stores/useChamberStore.js`'s `DEFAULT_DOSSIERS` still contains `"Tata Sons Pvt. Ltd. v. Cyrus Investments LLC"` as its first entry, under a comment that literally says `DEFAULT SAMPLE DOSSIERS (Mockup Parity & Legal Fidelity)`. The Organization store (§9.1) is genuinely dynamic and mock-free on its own — but the Chamber system it now sits beside was never removed or reconciled, so the product still ships a hardcoded matter name in production, just from a different file than before.
- **A third file, `store/useOrgStore.js`** (singular `store/`, not `stores/`), defines yet another independent org/team/matter model — different persist key (`lexamplify_org_store_v1`), different sample matters (`"A v. B"`, `"Acme Licensing & Trademark Dispute"`, `"Union of India v. Reliance Petrochemicals"`). None of the six `components/organization/*.jsx` files import it, and it didn't turn up in `ConflictEngine.jsx`, `DashboardView.jsx`, or `AppRouter.jsx` either — so it's very likely dead code left over from an earlier pass. Worth a quick repo-wide check (not done here) before deleting it, in case something else still imports it.

**What this means practically:** before any further redesign work builds a topbar/context-bar for Conflict Engine or anything else, someone needs to decide which system is canonical — the new Organization/Team/Matter model (simpler, but genuinely dynamic and the one this whole redesign series has been building toward) or the older Chamber model (richer per-matter legal detail — forum, eCourts sync, conflict integrity, telemetry — but still carrying a hardcoded sample dossier). The likely right answer is to fold Chamber's richer fields into `useOrganizationStore`'s `Matter` shape and retire `ChamberSwitcher`/`useChamberStore` entirely, rather than run both — but that's a product/architecture call, not a design one.

**Smaller confirmed findings from reading `components/ConflictEngine.jsx` directly:**
- Severity dots and badges (`.idx-dot.critical/.major`, `.sev-badge.critical/.major`) **do** correctly use `var(--accent)` / `var(--major)` — §7.2's assumption that Conflict Engine's severity pills were off-palette red/orange was wrong; this file already follows the two-color contract for severity. Correcting that assumption here.
- A real, separate violation was found instead: a `.cache-tag` style uses `var(--pine, #1F5C56)` (and `#4F8C82` in dark mode) — a **third accent color** ("pine," a green) for a "cached vs. fresh analysis" indicator, sitting right next to the correctly-rust `.fresh-tag`. This needs the same two-color-contract fix already applied elsewhere — likely just a plain neutral/muted "Cached" label instead of a green one.
- Two inline-styled error/retry banners (around lines 2115 and 2499) use raw hex values straight from Tailwind's red palette (`#FEE2E2` background, `#F87171` border, `#991B1B` text) instead of the token system — a confirmed, literal off-palette violation, not just a screenshot impression.
- Button hover states hardcode near-duplicate rust hex values (`#9C3E26`, `#B85A3B`) instead of deriving from `var(--accent)` — same visual family, but not tokenized, which risks drifting further out of sync over time.
- **A real severity-handling bug, not a style issue:** `const severity = rawSev === 'major' ? 'major' : 'critical';` — any severity value from the backend other than exactly `"major"` (including a future `"minor"`, `"moderate"`, or a typo/`null`) silently becomes `"critical"`. This can inflate the critical count and could miscalibrate a lawyer's trust in the severity signal — worth fixing to fail toward an explicit "unknown severity" state rather than the most alarming one.
- **The raw-PDF-binary-text bug visible in JN's screenshot is real and traced to the data, not the rendering:** `quoteB`/`ctxB` are taken directly from `raw.doc_b_excerpt`/`doc_b_context` with no validation — for `non disclosure.pdf`, the backend's text extraction evidently failed and returned raw PDF stream bytes (`%PDF-1.3%̃0 obj<</Type /Page...`), which the frontend then quotes verbatim as if it were the document's actual legal text. This is a backend document-ingestion robustness gap: extracted text should be validated (e.g., checked for a minimum ratio of printable/readable characters) before being shown to a lawyer as a sourced quotation — silently displaying unreadable binary as a "quote" is a real trust problem for a product whose whole design premise is sourced, citable analysis.
- **13 literal emoji characters** confirmed in `ConflictEngine.jsx` (✅📄🔍📂✕⚠⚡✓), consistent with the icon-system violation flagged from the spec in §9.2 — also found in `components/organization/*.jsx` (a handful each) and `DashboardView.jsx` (⚠📋). This is now source-confirmed, not inferred.

**Dashboard v2 bug (§6.4) — status update from reading `components/DashboardView.jsx` directly:** the masthead (`Workspace · Advocate Terminal` eyebrow, `Good {greeting}, Counsel`), the CNR sync bar, and the stat grid are all present in the component's JSX with no conditional gate hiding the whole block, `/dashboard` correctly routes to this exact component in `AppRouter.jsx` (ruling out the stale-router-mapping hypothesis), and styling is inline (`<style>{\`...\`}</style>` directly in the component, not an external stylesheet or CSS Modules file that could silently fail to apply) — so the specific failure pattern described in §6.4 does not reproduce from a static read of the current source. This strongly suggests it was already fixed in a later commit than the one that was live when that report was written. **Not claiming this as verified live** — per this project's own standing rule, that needs an actual fresh screenshot of `/dashboard`, not a source read, to close out. Recommend JN take one before marking §6.4 resolved.

### 9.3b Fix applied — the dual-context-switcher bug is resolved in code (committed to the repo)

Following §9.3a's finding, JN directed the full consolidation ("fix it now and do the full cleanup now"): remove the duplicate `ChamberSwitcher` mounts, migrate Chamber's richer per-matter fields into the canonical `useOrganizationStore` `Matter` shape, and retire the Chamber subsystem entirely. The following has been done and **committed to `E:\lexai-india\frontend\src\...` on JN's machine** (not just staged — verified written):

- **`AppRouter.jsx`**: both `ChamberSwitcher` mounts removed (topbar and sidebar). The sidebar masthead now shows the firm/org name dynamically from `useOrganizationStore`'s `organization.name` (`sb-firm-name` / `sb-firm-credit`, styled with the same Fraunces-italic treatment the old hardcoded `Shardul Amarchand Mangaldas` string used in `ChamberRoster.jsx`'s sidebar variant) instead of a hardcoded firm name. The `ChamberSwitcher`/`ChamberRoster` imports were removed and replaced with a direct `useOrganizationStore` import. Confirmed via grep: no remaining references to either component in the file.
- **`stores/useOrganizationStore.js`**: default org name changed from `'LexAmplify Chamber Console'` to `'LexAmplify'`. Chamber's richer per-matter fields — `counsel`, `forum`, `ecourtsSync`, `integrity`, `telemetry` — were added to the `Matter` shape (both the seed matter and `createMatter()`'s new-matter object) as **nullable fields, seeded with `null`, never with fake data** — consistent with this project's zero-mocks rule. A real matter has no forum/eCourts/telemetry data until a real integration populates it; the UI consuming these fields needs to render an honest "not available yet" state for `null`, the same pattern already used for "Hours Logged" in `workspace-hierarchy-v1.html`.
- **`components/organization/OrgDashboard.jsx`**: fallback title string updated from `'LexAmplify Chamber Console'` to `'LexAmplify'` for consistency with the above.

**Still blocked — file deletion could not be completed this session.** The now-dead Chamber files were confirmed safe to delete (grepped across ~25 component files; nothing outside the Chamber subsystem itself imports any of them), but the on-device shell tool needed to actually delete files was unavailable all session ("Workspace unavailable"), and no alternative delete mechanism exists from this side. **These files still exist on disk and need to be deleted manually** (they are dead code — unreachable, not imported anywhere — so leaving them a while longer is not a functional risk, just clutter):
- `frontend/src/components/chamber/ChamberSwitcher.jsx`
- `frontend/src/components/chamber/ChamberRoster.jsx`
- `frontend/src/components/chamber/MatterDossierCard.jsx`
- `frontend/src/components/chamber/NewDossierModal.jsx`
- `frontend/src/components/chamber/chamberRoster.css`
- `frontend/src/stores/useChamberStore.js`
- `frontend/src/store/useOrgStore.js` (the separate orphaned third store, singular `store/` — confirmed unimported anywhere)

Once those seven files are deleted, it's also worth deleting the now-empty `frontend/src/components/chamber/` and `frontend/src/store/` directories.

**Not yet addressed (deliberately out of scope for this cleanup pass, tracked from §9.3a):** the `.cache-tag` green/"pine" color in `ConflictEngine.jsx`, its two hardcoded red error banners, the button-hover hex values, the severity-coercion bug, the PDF-extraction validation gap, and the emoji characters across `ConflictEngine.jsx`/`components/organization/*.jsx`/`DashboardView.jsx`. Also not yet addressed: `AppRouter.jsx`'s `STATUS_STYLES` constant still hardcodes off-palette `#10B981` (green) and a non-token amber (`#F59E0B`) for status badges (e.g. "Active," "Hearing scheduled") — a two-color-contract violation found while making the above edit, not previously documented. All of these are separate, smaller fixes and can be tackled independently of the architecture consolidation above.

### 9.3 The visual/design-system redesign pass on this architecture — now done

`workspace-hierarchy-v1.html` / `workspace-hierarchy-v1-brief.md` apply the Slate & Rust system to all four screens described in §9.1 (Matter Launcher, Matter Dashboard, Team Dashboard, Org Dashboard) plus the Context Capsule, and concretely fix or address review items 1, 3, 4, 5, and 6 from §9.2 (emoji icons replaced with SVG, status-color mapping made explicit and narrow, typography carried through all four screens, Org Dashboard nav placement flagged for a product decision, "Hours Logged" shown honestly as untracked rather than faked). **Review items 1 and 2 — localStorage-only persistence and the lack of stated access control — are architectural, not visual, and are explicitly called out in the new brief as still open and blocking for real team-collaboration use.** See that brief's §5 for the exact framing to carry into whatever conversation resolves them.

---

## 11. Latest round — Home Gateway v2 (IA promotion + renaming + full dynamic-data pass)

Triggered by JN recording a walkthrough of Lexlegis.ai's own "Home" screen and asking for three things: (1) promote the matter-chooser from "one nav item among many" to the app's actual landing screen, the same role Lexlegis's Home plays; (2) redesign and rename the Matter/Team/Org screens — JN doesn't like their current UI or names; (3) make everything on the matter screen dynamic, nothing hardcoded.

Delivered as `home-gateway-v2.html` / `home-gateway-v2-brief.md` — full detail in that brief; summary here for continuity:

- **IA change:** "Matters" nav item renamed to "Home," moved above "Dashboard" in the sidebar (was below it), and made the post-login default route (was `/dashboard`). A personalized hero greeting banner (name, date, a live deadline/task-count sentence — no weather widget, deliberately not copied from the Lexlegis reference since it's decorative and not legal-work-relevant) sits above the existing matter-chooser grid, which is otherwise unchanged from `workspace-hierarchy-v1.html`.
- **Renaming, with reasoning documented in the brief §3:** default seed team `"My Private Space"` → `"My Chambers"` (a real data change in `useOrganizationStore.js`'s seed, not just a label — "My Private Space" turned out to be Lexlegis's own trial-account default copy, coincidentally duplicated verbatim in LexAmplify's seed data); `"Org Dashboard"` → `"Firm Console"` everywhere it's a nav/breadcrumb/capsule label, keeping "Executive Console" as the existing small eyebrow; the informal "My Matter"/"My Team" screens given neutral `MATTER WORKSPACE` / `TEAM WORKSPACE` eyebrow labels while always showing the real record's own title/name as the H1 — never a generic screen name.
- **Full dynamic-data contract for the Matter Workspace screen** (brief §4): every metric tile, list panel, and the new hero banner's status sentence mapped to its exact `useOrganizationStore` field, including the nullable Chamber-migration fields (`counsel`, `forum`, `ecourtsSync`, `integrity`, `telemetry`) added in the previous round and their required empty-state copy while null. Zero-count clauses in the hero sentence must drop out rather than render "0 …", to avoid a false all-clear reading.
- **Not yet applied to the live repo** — this round is mockup + brief only, same handoff pattern as every prior round; the IA/routing change (§2 of that brief) and the seed-name data change (§5) still need to be made in `AppRouter.jsx` and `stores/useOrganizationStore.js` respectively.

---

## 10. Files produced in this conversation (all delivered, all in the same location)

- `case-vault-v1.html` + `case-vault-v1-brief.md`
- `dashboard-v2.html` + `dashboard-v2-brief.md`
- `legal-calendar-v1.html` + `legal-calendar-v1-brief.md`
- `dashboard-calendar-live-verification-report.md` (diagnostic, not a redesign brief)
- `contract-analyzer-v1.html` + `contract-analyzer-v1-brief.md`
- `workspace-hierarchy-v1.html` + `workspace-hierarchy-v1-brief.md`
- `home-gateway-v2.html` + `home-gateway-v2-brief.md`
- This document

All mockups share the exact same CSS token block, sidebar markup, typography rules, icon spec, and vanilla-JS render-function pattern (`render*()` functions driven by JS arrays, `escapeHtml()` helper, `addEventListener`-based interactivity, no framework) — any new feature redesigned going forward should follow the same pattern for visual and structural consistency with everything built so far.
