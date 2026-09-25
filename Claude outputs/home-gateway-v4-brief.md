# Home Gateway v4 — Typography unification, matter/team decoupling, Matter Workspace rebuild — Implementation Brief

**Companion file:** `home-gateway-v4.html` (vanilla HTML/CSS/JS mockup — now interactive and data-driven, not just static reference markup; see §7).

**Builds on:** `home-gateway-v3.html` / `home-gateway-v3-brief.md`, which itself builds on v2. Everything in those briefs that isn't explicitly revised below still applies (the Home promotion, the routing default, the "My Chambers"/"Firm Console" renames, the context-trail hierarchy redesign). This round was triggered by JN reviewing the **live** `test.lexamplify.com` build — five screenshots of the actual deployed Home and Matter Workspace screens — and it surfaces several places where the live implementation has drifted from what was specified, plus real IA/product changes JN asked for on top of that.

---

## 1. What was actually wrong, split by cause — read this before assigning work

JN's five screenshots point at two different kinds of problem, and it matters which is which:

**A. The live app has drifted from the mockup's own spec (bugs to fix in the real code, not design changes):**
- The color background reads as near-flat black in the live screenshots, not the warm slate (`#191C1D`/`#212527`) the tokens actually specify. The mockup's own `:root` tokens are correct — this is implementation drift, the same category of bug as the stale "LexAmplify Chamber Console" masthead flagged two rounds ago. **Before touching any CSS, open the live app's devtools and check the computed `background-color` against the exact hex values in §6 below** — this is very likely a Tailwind config or CSS-variable mismatch, not something to redesign around.
- The metric tiles on the live Matter Workspace screen render as run-on text ("Documents1in Case Vault", all on one line) — the mockup's `.metric-tile` has always been `display:flex; flex-direction:column; gap:5px`, so each label/value/sub-line sits on its own row. The live build isn't applying that layout. This is very likely why the screen reads as "crowded" — it's not just density, some of it is a broken flex layout.
- The "Litigation detail" card's empty-state text ships this sentence verbatim: *"...these fields exist on the record (forum, ecourtsSync, integrity) but stay null, and the UI, until a real matter has them. Never fill this with placeholder legal detail."* That grammatically-broken tail ("and the UI, until a real matter has them. Never fill this with placeholder legal detail.") is implementer-facing guidance that leaked into real product copy — **this is the exact same class of bug the v3 round already fixed once** (the hero banner's spec-note), just in a different card this time, because it was actually present in `home-gateway-v2.html`'s own source (see §2 below) and nobody caught it before it shipped. Fixed in this round's mockup — see §5.
- Clicking "Upload" under Case Documents fires a native `alert('Document ingestion wizard opened.')` instead of doing anything. This is the exact same anti-pattern this mockup itself uses for *deliberately out-of-scope* nav items (e.g. `onclick="alert('Contract Analyzer — unchanged by this round...')"` on the Dashboard/Contract Analyzer sidebar items) — it looks like whoever implemented this button used a placeholder `alert()` the way the mockup uses them for "not this round" items, and then shipped it as if it were the real feature. **Process note for whoever implements v4:** an `alert()` anywhere in a mockup is a signal that says "not built yet," never a pattern to carry into production, even loosely. Worth a second pass over the live app for other `alert()`-as-placeholder spots.

**B. Real product/IA changes JN asked for (design changes, not bug fixes):**
- One typeface everywhere, no italics (§3).
- More breathing room in the context trail (§4, cosmetic-only, no behavior change).
- Matter creation decoupled from team assignment, plus a way to add an existing matter to a team afterward (§7).
- Deadlines need a description field (§8.1).
- Case Documents needs a working upload that feeds extracted deadlines back into Limitation & Deadlines (§8.2).
- Action Items & Tasks, Chamber Handoff Notes, and Matter Activity Stream all needed to go from static decoration to actually working (§8.3–§8.5).

---

## 2. Where the leaked "Litigation detail" copy actually came from

This isn't new copy Antigravity invented — it's `home-gateway-v2-brief.md` §4's own words, describing what the empty-state text *should say*, pasted directly into the mockup's markup instead of being turned into clean product copy first. The brief said: *"render the exact empty-state copy in the mockup ('Forum, eCourts sync, and conflict-integrity data aren't available for this matter yet…'), never a placeholder number or fabricated forum name."* That's guidance about what NOT to fake — not a sentence meant to be read by a lawyer. It ended up half-quoted, half-explained, directly in the UI. Fixed to a clean, single sentence in this round (§5) — flagging the root cause so the same thing doesn't happen a third time on some other empty state this project hasn't gotten to yet.

---

## 3. Typography — one typeface, no italics, everywhere

JN's instruction was explicit: switch everything to Calibri, nothing renders italic. This retires the two-and-a-half-typeface system this project has used since round one (Fraunces italic for identity text — page titles, matter names, the firm name; IBM Plex Sans for UI chrome; IBM Plex Mono for reference data, hashes, stat lines).

**What changed:**
- `body` font-family is now `Calibri, Carlito, 'Segoe UI', Candara, Optima, sans-serif`. Calibri is listed first because it's natively installed on any Windows/Office machine (the realistic environment for most Indian litigation practices); **Carlito** is the fallback — a free, metrically-compatible substitute for Calibri (same glyph widths, so nothing reflows when the fallback kicks in), pulled from Google Fonts for machines that don't have Calibri locally (mac/Linux without Office installed).
- The `.serif` class (used throughout the markup as a hook on titles, matter names, the firm name) no longer swaps to a different face — it's now just `font-weight:600` for a mild identity-level distinction from UI chrome. **The class name is now misleading** (it hasn't been a serif in this build since this round) — when this gets ported to React, rename it to something like `.identity-text` rather than carrying the old name forward. Left as `.serif` in this mockup only because it's used as a hook in dozens of places and renaming it here wouldn't be caught by a diff review the way it will be in a real component tree.
- The `.mono` class (reference data, hashes, stat lines) similarly no longer swaps typefaces — it now applies `font-variant-numeric: tabular-nums` so numbers still line up in columns, without a second font family. Same rename note applies.
- Every inline `font-style: italic` and every hardcoded `font-family: 'IBM Plex Mono'/'IBM Plex Sans'` override was removed — checked with a full-file grep after the edit, zero remaining.
- **Trade-off worth confirming, not silently absorbed:** the old system used a genuinely different face (Fraunces) to make identity elements — page titles, a matter's own name — visually distinct from UI chrome. That distinction is gone now; a matter's title and a button label are the same typeface, differentiated only by size/weight. If that reads as too flat once it's live, the fix is a weight/size adjustment, not bringing back a second face — but it's worth a look together before calling this settled.

---

## 4. Context trail spacing

The trail (`Untitled Matter › My Chambers › Firm Console`) had almost no internal spacing — `padding:4px; gap:0` on the container, and `padding:0 1px` around each `›` separator. Widened to `padding:6px; gap:3px` on the container, `padding:9px 16px` per segment (up from `8px 13px`), and `padding:0 6px` around each separator. No structural or behavioral change — same three segments, same current/ghost hierarchy from v3, just room to breathe. Compare `home-gateway-v3.html` and `home-gateway-v4.html` side by side if it's easier to eyeball than read the CSS diff.

---

## 5. "Litigation detail" empty-state copy — fixed

**Was** (the leaked-instruction sentence, see §2): *"Forum, eCourts sync, and conflict-integrity data aren't available for this matter yet — these fields exist on the record (`forum`, `ecourtsSync`, `integrity`) but stay `null`, and the UI, until a real matter has them. Never fill this with placeholder legal detail."*

**Now:** *"Forum, eCourts sync status, and conflict-integrity checks aren't available for this matter yet — they'll appear here automatically once a real court-record integration is connected."* One sentence, no field-name soup, no meta-instruction. The underlying behavior (nullable `forum`/`ecourtsSync`/`integrity` fields on the `Matter` record, per v2 brief §4) is unchanged — this is copy-only.

---

## 6. Color tokens — restated for the audit, not changed

No hex values were touched this round; they were already correct in the mockup. Restating them here specifically so whoever checks the live app's CSS has the exact reference to diff against:

```
Dark:  --bg:#191C1D  --paper:#212527  --paper-2:#2A2F31
       --ink:#D6D9D9  --ink-soft:#AAAEAE  --muted:#727776  --muted-2:#494E4D  --rule:#333939
       --accent:#CC6B48  --accent-soft:#3B281F
       --major:#D9AD5C  --major-soft:#35301C
       --on-accent:#FBF7EE

Light: --bg:#DFE1E0  --paper:#EAEBE8  --paper-2:#E3E4E1
       --ink:#181B1D  --ink-soft:#494E51  --muted:#868C8E  --muted-2:#B3B8B9  --rule:#D2D5D4
       --accent:#B24A2E  --accent-soft:#EFDCD1
       --major:#9C7A2E  --major-soft:#F1E6C9
       --on-accent:#FBF7EE
```

If the live app's stylesheet doesn't produce these exact computed values on `body`/`.paper`/etc., that's the bug — not a reason to introduce new values.

---

## 7. Matter creation decoupled from team assignment

**The problem JN identified:** the live "Create a new matter" modal forces an "Assigned Team" field with no way to skip it — a matter cannot exist without immediately belonging to a team. JN's framing: a lawyer working solo should be able to open a matter on their own, and only loop a team in later, if and when the work actually gets shared — not be forced to pick a team (or invent one) just to start working.

**What changed — the data model:**

```
Matter.teamId: string | null   // was implicitly required; now nullable
```

**What changed — the flows (both implemented and interactive in the mockup, not just described):**

1. **New Matter modal** (`#matterModal`): only **Matter Title** is required. "Assigned Team" is a select defaulting to **"Not assigned yet"** — presented as a normal, first-class option, not a disabled/degraded state — with the firm's existing teams listed below it, and a **"+ Create a new team…"** option at the bottom that reveals an inline name field in the same modal. Creating the matter with a team selected (existing or brand-new) assigns it immediately; leaving it on "Not assigned yet" creates an unassigned matter and takes you straight to its (now real) Matter Workspace screen, where the next flow picks up.

2. **Add an existing matter to a team.** Any matter with `teamId: null` shows a dashed **"+ Add to team"** pill instead of a team tag — both on its Home matter-card and in the Matter Workspace header. Clicking it opens the same team-picker modal (`#teamModal`) used by Home's standalone "New team" button, but in "assign" mode: it lists the firm's existing teams as selectable rows (with each team's current matter count, so the decision isn't blind) plus a "+ Create a new team instead" fallback that swaps to the same inline name field, with a "‹ Back to existing teams" link to undo that choice. Saving sets the matter's `teamId`, updates the header/card everywhere, and — like every other action on this screen — writes an entry to the Matter Activity Stream ("Added to team: Dispute Resolution").

3. **Home's filter tabs and search now reflect the new model**: alongside "All teams" and one tab per team, there's now an **"Unassigned"** tab with its own live count, and the search box (previously non-functional in the mockup — see §9) filters by title/lead across whichever filter is active.

**Seed data reflects the null case on purpose, not just after user action.** Three demo matters ship in this mockup: the existing default (`Untitled Matter`, on My Chambers), a second team's matter (`Mehta Textiles v. Union Bank`, on Dispute Resolution), and a third with `teamId: null` (`Freelance Advisory — Consumer Complaint`) — so the "add an unassigned matter to a team" flow is demonstrable immediately on page load, not only after first creating a new matter through the modal.

---

## 8. Matter Workspace — rebuilt, not just restyled

The screen went from static reference markup (every number, list row, and note was hardcoded text — nothing on this screen actually did anything before this round) to a real render engine over an in-memory data model, so every interaction below is genuinely testable in the mockup, not just described.

### 8.1 Limitation & Deadlines — description field added

Each deadline now carries a `description` field alongside its existing `title`/`date`. The "+ Add" form is a title input, a date input, and a description textarea (optional but encouraged via placeholder copy); saved deadlines show their description as a muted line under the title/date row when present. The pre-existing seed deadline ("Written Statement Limitation") was given a real description too, so the field isn't only visible on newly-added ones.

### 8.2 Case Documents — a real upload interaction, wired to Limitation & Deadlines

Replaces the alert()-firing "+ Upload" button (§1) with a click-to-upload dropzone. Clicking it: adds a document row immediately with an "Analyzing…" spinner state, waits ~1.3s (simulating processing time), then resolves — tagging the document **AI-ANALYZED** and, critically, **pushing a new deadline into Limitation & Deadlines** with an **AI-EXTRACTED** tag and a generated description explaining where it came from. This is the literal feature JN asked for: *"if they upload the document, then the document is to be fully analyzed and then it finds out the deadline and description on their own and then the deadline, description should be displayed in the Limitation & Deadline."* The mockup puts Case Documents directly below Limitation & Deadlines in the same column specifically so this cross-card effect reads as local cause-and-effect rather than something happening on the other side of the screen.

**This is simulated, not a real integration — same convention as every other AI feature in this project's briefs.** The extracted deadline's title/date/description are generated from a small fixed template, not read from real document text. Needs the same `ask_groq`-based extraction pattern already flagged for Case Vault's AI date extraction and Legal Forms' "Auto-Fill with AI" — confirm whether a shared extraction pipeline already exists before building this a third time.

### 8.3 Action Items & Tasks — now interactive

Checkboxes actually toggle (was static markup); "+ Add" inserts a real inline form instead of doing nothing; completing a task writes to the Activity Stream, adding one does not (only *completion* is treated as activity-worthy — adding a task is already visible in the task list itself).

### 8.4 Chamber Handoff Notes — kept, and made functional

JN asked directly whether this card was worth keeping. It's kept, because the underlying idea (a short note for whoever picks the matter up next) is a real, common workflow in shared practice — but it was previously a single hardcoded row with no way to add another, which is indistinguishable from a decorative placeholder. It now has a working compose box; posting a note prepends it to the list with author/timestamp and writes to the Activity Stream. If it turns out nobody uses it once real users have it, that's a usage-data question for later — it's no longer a fake feature either way.

### 8.5 Matter Activity Stream — kept, and made into the screen's actual spine

Same question JN asked about Handoff Notes applies here, and the answer is the same: kept, now functional, and in this round it became the thing that ties every other card together. Every action on the screen — adding a deadline, completing a task, uploading a document, the AI extraction that follows, posting a handoff note, assigning a team — writes a real entry here, newest first. It's no longer a static single row; it's a live audit trail of what actually happened in the session, which is the whole point of an activity stream. Verified end-to-end with Playwright (see §11) — a single test session produced eight real, distinct activity entries from ordinary use of the other cards, nothing hardcoded.

### 8.6 Header — decluttered

The old header was one run-on sentence: *"Open · My Chambers · Lead counsel Narendar V · Opened Sep 13, 2026"* as plain paragraph text. It's now discrete chip-like pieces (status pill, team chip or "+ Add to team," lead counsel, opened date) with real gaps and separators between them — same information, laid out so it doesn't read as a wall of text. This is very likely a second contributor to the "messy and crowded" feeling JN flagged, on top of the metric-tile flex bug in §1.

---

## 9. What's simulated in the mockup — needs real wiring

- **Document upload and its AI extraction** (§8.2) — no real file picker, no real storage, no real document-understanding call. See §8.2 for the specific pipeline question to resolve before building this for real.
- **The three quick-dock buttons and four Contract Analyzer/Auto-Draft/Virtual Courtroom/Conflict Engine buttons** — unchanged from v3, still presentational only, not part of this round's scope.
- **Search on Home** — this round actually wires it up for the first time (v3's search box had no event listener at all — worth flagging on its own: it looked functional but silently did nothing). It's a plain client-side substring filter against title/lead; a real implementation presumably wants server-side search once matter counts grow past what fits in one page.

---

## 10. Scope boundaries — what this round does NOT cover

- **Team Workspace and Firm Console screens** got the global font/color/spacing fixes (§3, §6) but were not otherwise redesigned or made more data-driven this round — they remain close to v3's static reference markup. JN's specific complaints were about Home and Matter Workspace only.
- **Case Vault, Contract Analyzer, and every other feature** covered by their own briefs are untouched.
- **The sidebar** is still representative of the existing, stable Sidebar component — don't rebuild it from this mockup's markup, same standing note as every other brief in this project.
- **Mobile layout is a confirmed gap, not just unverified this time.** Screenshotting this build at 400px wide shows the sidebar does not collapse or hide at narrow widths at all — it just sits there at full width, pushing all real content off-screen. This isn't new to v4 (v3 has the same gap — there's no sidebar breakpoint in either version's CSS), but it's now been actually checked rather than just flagged as "reasoned, not verified," so it should be treated as a known, real defect rather than a hypothetical risk. Fixing it wasn't part of JN's ask this round and would meaningfully expand scope; flagging it here so it doesn't get lost.

---

## 11. What was actually checked, not just reasoned about

Ran the mockup headlessly (Playwright, both themes, plus a 400px mobile viewport) before writing this up:

- Confirmed `body`'s computed font-family is the Calibri/Carlito stack everywhere, and the hero title's computed `font-style` is `normal` (not italic) — checked programmatically, not just by eye.
- Created a matter with no team selected, confirmed it lands on its own real Matter Workspace with the "+ Add to team" pill showing, then assigned it to an existing team through that flow and confirmed the header updated and an activity entry was written.
- Added a deadline with a description, confirmed the description renders under the title/date row.
- Toggled a task done, confirmed the strikethrough state and the activity entry.
- Clicked the upload dropzone, confirmed the "Analyzing…" spinner state appears immediately and resolves ~1.3s later into an AI-ANALYZED document plus a new AI-EXTRACTED deadline with a generated description.
- Posted a handoff note, confirmed it appears at the top of the list with author/time.
- Read back the full Activity Stream after all of the above and confirmed all eight actions were present, in the correct newest-first order, with no hardcoded entries mixed in incorrectly.
- Tested Home's search box against "consumer" and confirmed it correctly narrows to just the one matching matter (this also caught a real bug — the search input had no event listener wired at all on the first pass; fixed and re-verified, see the "confirmed, not defaulted" note in §9).
- Confirmed the deadline/task inline forms actually close after a successful save (also caught and fixed a bug here — they were staying open, cluttering the card, until this was checked directly rather than assumed from the code).

---

## 12. Definition of Done

- [ ] Live app's computed background/paper/ink colors verified against the exact hex values in §6 — root-caused (Tailwind config vs. CSS variable vs. something else) before any redesign work happens on top of it
- [ ] `.metric-tile`'s flex-column layout confirmed actually applied in the live build, not just present in the mockup's CSS (§1)
- [ ] Single typeface (Calibri, with Carlito as the open-license fallback) applied everywhere, zero italic anywhere — confirmed with a grep for `font-style: italic` and any remaining `Fraunces`/`IBM Plex` references before calling this done
- [ ] `.serif`/`.mono` class names renamed to something accurate (e.g. `.identity-text`) when ported to React, per §3
- [ ] Context trail spacing matches §4's values, or reads comparably roomy
- [ ] "Litigation detail" empty-state copy matches §5's fixed version — confirm it's not present anywhere else in the codebase in its broken form
- [ ] `Matter.teamId` is nullable end-to-end (schema, API, frontend types) — not just optional in the create form
- [ ] New Matter flow works with no team selected, and a real "add existing matter to a team" flow exists somewhere reachable from an unassigned matter's own page (§7)
- [ ] Deadlines carry a `description` field, shown in the UI wherever a deadline's title/date already show (§8.1)
- [ ] Case Documents' upload button does something real — at minimum, a real file picker and real storage; the AI-extraction-into-deadlines pipeline can ship as a fast-follow if it isn't ready, but the upload itself must not fire `alert()` in production under any circumstance
- [ ] Action Items & Tasks, Chamber Handoff Notes, and Matter Activity Stream are all functional (add/toggle/post persists and is visible), not static reference rows
- [ ] Matter Activity Stream is fed by real actions taken elsewhere on the same screen, not a fixed sample list
- [ ] A pass made over the rest of the live app for other `alert()`-as-placeholder spots, per the process note in §1
- [ ] Mobile sidebar behavior addressed or explicitly ticketed as a follow-up — not silently left as-is because it predates this round (§10)
