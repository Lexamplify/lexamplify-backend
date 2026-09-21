# Home Gateway v3 — Logo, Context Trail Redesign, Default-Naming Fix — Implementation Brief

**Companion file:** `home-gateway-v3.html` (updated mockup — same 4 screens as v2, with the changes below applied throughout).

**Builds on:** `home-gateway-v2.html` / `home-gateway-v2-brief.md`. Everything in that brief still applies (the Home promotion, the routing default change, the "My Chambers" team rename, the "Firm Console" rename, the full dynamic-data contract for the Matter Workspace screen). This document only covers what changed in this round. Asset delivered alongside: `assets/lexamplify-logo-mark.png`.

**Trigger for this round:** JN sent the actual LexAmplify logo file plus two screenshots — one of the current sidebar (masthead showing the old, stale "LexAmplify Chamber C..." text — confirms the live site is still running a build from before the previous cleanup round shipped), and one of the live `test.lexamplify.com/workspace/matters` page showing the context capsule reading "My 1st Matter · My Private Space · Firm Console." Two asks: (1) add the logo mark to the top of the sidebar, before the firm name; (2) redesign that capsule's UI and change "My 1st Matter"/"My Private Space"/"Firm Console" to different names, because those names already exist on Lexlegis.ai.

---

## 1. Logo mark

Added as `<img class="logo-mark">` in the sidebar head, directly before the firm name block (`LexAmplify` / `LEXAMPLIFY` credit line stays exactly as-is, just shifted right to make room). 27×27px, `object-fit: contain`. Checked in both themes — the mark's navy/grey coloring reads cleanly against both the dark paper (`#212527`) and light paper (`#EAEBE8`) backgrounds, so no separate light/dark variant is needed.

**Asset handling — this is a brand mark, not a UI icon.** Every other icon in this product is hand-built inline SVG (per the design system's standing rule), but a logo has to reproduce the actual brand artwork pixel-for-pixel, so it doesn't get redrawn as a generic icon. `assets/lexamplify-logo-mark.png` (delivered alongside this brief, trimmed to its bounding box, transparent background) should go into the real codebase's asset folder (e.g. `frontend/src/assets/` or `public/`) and be imported as a normal image asset in `AppRouter.jsx`'s sidebar masthead. If there's a source SVG or a brand-guidelines file for this mark, use that instead of the PNG — it'll scale more cleanly at different sidebar widths (e.g. the collapsed icon-only sidebar state, if the sidebar still supports one) — this PNG is a faithful fallback, not the preferred format.

**Also worth fixing while touching this file:** the sidebar masthead JN's screenshot shows still reads the stale default org name from before the previous round's fix landed — a rebuild/redeploy should clear that up; flagging in case it isn't just a caching artifact.

---

## 2. Context capsule redesign — "trail," not a row of identical chips

**What was wrong with the old design (confirmed in JN's screenshot):** three pill-shaped chips, side by side, each with a dim gray dot and plain text — visually identical regardless of whether it's the matter you're actually working in or just a quick link to switch teams. Worse, the first two chips had a small dropdown chevron and the third ("Firm Console") didn't — an unintentional inconsistency, not a deliberate design choice.

**New design:** a single connected trail, current-matter segment first, joined by `›` chevrons down to team and then firm — read as "you are here, and here's the broader context you can zoom out to," not three unrelated buttons:
- The **current segment** (whichever level you're actually inside — almost always the matter) is solid rust fill, white/on-accent text, bold — unmistakably "this is where you are."
- The other segments are ghost/ranked behind it — muted text, no fill, hover state only — reading as secondary, still-clickable context.
- **Every segment now carries the same dropdown chevron**, fixing the old inconsistency — clicking any of the three opens that level's switcher popover (matter switcher, team switcher, or a link straight to Firm Console).
- Chevron separators (`›`) between segments instead of a plain vertical divider bar, reinforcing the hierarchy read (matter is nested in team is nested in firm).

This is a visual and interaction redesign, not a data change — it still reads from exactly the same active-matter/active-team/organization state as the old capsule (`ContextCapsule.jsx`'s existing store wiring).

---

## 3. Default naming — the real problem was that LexAmplify's seed data matched Lexlegis's

JN's core objection: "My 1st Matter" and "My Private Space" are the literal default trial-account content Lexlegis.ai itself ships to new signups (confirmed directly from the recording reviewed last round — see `home-gateway-v2-brief.md` §1). A lawyer who's tried Lexlegis's free trial would recognize LexAmplify's onboarding screen as a copy on sight. That's a real credibility problem for a product whose whole pitch is being a distinct, trustworthy tool — not "the same thing as Lexlegis with different colors."

**"Firm Console" does not have this problem** — Lexlegis's own third capsule segment is literally labeled "Org Dashboard" (also confirmed from the recording), and the previous round already renamed away from that exact string specifically to avoid the collision. No further change needed there; it only gets the visual "trail" redesign from §2, not another rename.

**What changed this round:**

| Field | Old default | New default | Where it's seeded |
|---|---|---|---|
| Seed matter title | `"My 1st Matter"` | **`"Untitled Matter"`** | `stores/useOrganizationStore.js` — both the initial `matters` array entry and `createMatter()`'s default when no title is passed |
| Seed team name | `"My Private Space"` | `"My Chambers"` *(unchanged from last round — reconfirming since it hadn't shipped yet as of this screenshot)* | same file |

**Why "Untitled Matter," specifically:** rather than invent another proper-noun-style placeholder (which risks colliding with some other product's onboarding copy the same way, and also risks being mistaken for a real case name), "Untitled Matter" borrows the plain, honest convention most software already uses for unsaved/unnamed records ("Untitled Document," etc.) — it reads unambiguously as "rename me," not as content. This also nudges a new user toward actually naming their first matter, which the generic "My 1st Matter" phrasing didn't.

**A related issue surfaced while confirming this:** the seed matter's `leadCounsel` field is currently hardcoded to `'Narendar V'` in `useOrganizationStore.js` (both the initial seed and, as a literal string, inside `createMatter()`). That's a second, smaller hardcoding problem in the same file — the lead counsel of a brand-new user's default matter should be that user's own name, read from whatever auth/session object the app already has, not a fixed string. Flagging this for the same pass, since it's directly adjacent to the rename and easy to fix at the same time — but it's a separate bug from the naming-collision issue above, not required to close out this round's core ask.

---

## 4. A process catch, not a design change — read this before implementing anything else from `home-gateway-v2.html`

JN's screenshot of the live `test.lexamplify.com` site shows the v2 mockup's hero banner note — *"— every number in this line is computed live from useOrganizationStore (deadlines[], tasks[]) for whichever matter/team is active. No case names, counts, or status words are ever hardcoded into this banner's copy."* — rendered **verbatim, to real users**, directly under the greeting. That sentence was written as an instruction to whoever implements the mockup, styled as italic muted text inline in the paragraph — evidently not distinct enough, since it shipped as if it were real product copy.

**Fixed in this round:** that note is now a separate `.spec-note` callout — dashed border, warning-triangle icon, monospace "SPEC NOTE — NOT PRODUCT COPY" label, visually unrelated to any real card or paragraph style in the design system. It should never be implemented as any part of the real UI; delete the whole block when building the real screen.

**Worth doing regardless of this specific fix:** whoever is implementing from `home-gateway-v2.html` as it currently stands should grep that file for anything that reads as an explanatory sentence rather than real copy before building from it, since this is now a confirmed live defect, not a hypothetical risk.

---

## 5. Definition of Done (this round only — see v2's brief for the rest)

- [ ] Logo mark (`assets/lexamplify-logo-mark.png`, or a source SVG if one exists) added to the sidebar head, before the firm name, in both themes
- [ ] Context capsule rebuilt as a connected trail: current segment solid-rust, others ghost, `›` separators, dropdown chevron on all three segments (not just two)
- [ ] Seed matter title changed `"My 1st Matter"` → `"Untitled Matter"` in `useOrganizationStore.js` (seed + `createMatter()` default)
- [ ] Confirmed the seed team rename to `"My Chambers"` from the previous round has actually shipped (JN's screenshot shows it hadn't yet as of this round)
- [ ] The literal hero-banner spec-note sentence removed from whatever was already built from v2 — confirmed not present in the live app
- [ ] (Adjacent, optional for this round) `leadCounsel` on the seed matter sourced from the authenticated user instead of the hardcoded `'Narendar V'` string
- [ ] Stale "LexAmplify Chamber Console" masthead text confirmed cleared by a fresh deploy
