# Home Gateway v2 — IA promotion, renaming, and full dynamic-data pass — Implementation Brief

**Companion file:** `home-gateway-v2.html` (vanilla mockup, interactive — click the sidebar/capsule to switch between the four screens).

**Supersedes:** `workspace-hierarchy-v1.html` / `workspace-hierarchy-v1-brief.md`'s *information architecture* (nav position, route defaults, screen names). It does **not** replace that brief's visual/token work, its status-color rules, or its "Hours Logged: not tracked yet" rule — all of that carries forward unchanged and is reused here.

**Trigger for this round:** JN recorded a walkthrough of Lexlegis.ai's own "Home" screen (`app.lexlegis.ai/home/`) and asked for three things:
1. The matter-chooser should be the app's actual entry gate — like Lexlegis's Home — not one nav item sitting among Dashboard/Contract Analyzer/etc.
2. Redesign — and rename — the Matter, Team, and Org screens; JN doesn't like their current UI or their current names.
3. Everything on the matter screen must be dynamic — nothing hardcoded.

---

## 1. What was learned from the Lexlegis recording

Frame-by-frame, `app.lexlegis.ai/home/` is:
- The **first item in the sidebar**, above "Dashboard" — not nested under a generic "Workspace" group as one option among several.
- The **default landing route** — it's what renders immediately after login, at `/home/`.
- A **personalized hero banner** ("Good evening, naren." + date + weather + a one-line AI-generated status summary), sitting directly above the matter-chooser grid — so the screen reads as "your command center," not "a list of matters."
- Below that: the same job LexAmplify's `MatterLauncher` already does — search, a context-tab strip for quick-switching between recently used matter/team/org, and the matter cards themselves.

Two things from the recording are **deliberately not copied**:
- **The weather widget.** It's decorative, has nothing to do with legal work, and would be the first genuinely hardcoded/unnecessary external dependency in this product. Left out.
- **The literal default seed names "A v. B" / "My Private Space".** Those are Lexlegis's own trial-account placeholder content, not a naming convention to imitate — coincidentally, LexAmplify's current seed data uses the exact same generic strings (see §3). That's the naming problem JN is actually pointing at.

---

## 2. IA change — promote the gateway to Home

Current state (`AppRouter.jsx`, confirmed from source): sidebar's "Workspace" group lists `Dashboard`, then `Matters` (routes to `/workspace/matters`, the `MatterLauncher` component), then `Contract Analyzer`, `Auto-Draft Studio`, `Virtual Courtroom`. Login lands on `/dashboard` (the personal Advocate Terminal).

Change:
- **Rename the nav item** `Matters` → `Home`. Same route target (`/workspace/matters` → consider renaming the route itself to `/home` for clarity, but that's a routing-table decision, not a design one).
- **Move it to the top of the Workspace group**, above `Dashboard` — matching Lexlegis's ordering exactly.
- **Change the post-login default redirect** from `/dashboard` to the Home/gateway route. `Dashboard` (Advocate Terminal) stays exactly where it is functionally — it's still a first-class, separately reachable screen — it's just no longer the *first* screen a lawyer sees. This mirrors Lexlegis's own pattern (Home first, Dashboard second, both present).
- Add the personalized hero banner (see mockup `#screen-home .hero`) directly above the existing matter-chooser content. It is **not** a new component with its own data source — every value in it comes from the same `useOrganizationStore` state the rest of the screen already reads (see §4).

This is the entire fix for JN's point 1 — nothing about the matter-chooser's own grid/search/filter behavior changes, only where it sits and what wraps it.

---

## 3. Renaming — three screens, three names, with reasoning

| Old | New | Where the old name showed up | Why |
|---|---|---|---|
| "Matters" (nav) | **Home** | Sidebar nav label | Matches its new role as the landing screen (§2). |
| *(no formal name — informally "My Matter")* | **Matter Workspace** (eyebrow label only) | Nothing in the current UI literally says "My Matter" in chrome — the confusion is that the screen has no distinct identity beyond the matter's own title. This brief gives it one: a small `MATTER WORKSPACE` eyebrow, with the real matter's `title` field as the H1, always. The screen itself is never called anything generic — it's always named after the matter that's open. | Consistent with how the Matter Dashboard already behaves (§9.1 of the master handoff) — this just makes the "role" label explicit and removes any generic placeholder text a future implementer might otherwise add. |
| **"My Private Space"** (default seed team name, `stores/useOrganizationStore.js`) | **"My Chambers"** | Rendered wherever `team.name` is shown — capsule, launcher cards, breadcrumbs | "My Private Space" is generic SaaS-onboarding copy (and, per §1, it's literally Lexlegis's own default trial content — LexAmplify's seed data copied it verbatim). "My Chambers" matches the product's own established voice: the existing UI already says "Chamber Workspaces," "Global Chamber Audit Trail," "Private Chamber (Solo)" (the old Chamber system's bench list) — this just makes the *default* team name consistent with language already used everywhere else in the app, instead of introducing a second, generic vocabulary. This is a **data change** (the seed value in the store), not just a label swap — see §5. |
| **"Org Dashboard"** | **"Firm Console"** (nav + breadcrumb + capsule text) — "Executive Console" kept as the small eyebrow micro-label | Sidebar-adjacent references, capsule's third segment, `OrgDashboard.jsx`'s masthead | `OrgDashboard.jsx` already has an eyebrow reading "Executive Console" — "Org Dashboard" as the actual page/nav title undersells it and reads as a generic admin screen name. "Firm Console" keeps the eyebrow as-is and gives the screen itself a name consistent with the product's firm/practice/chamber vocabulary, the same call already made for the launcher ("Practice Gateway") and the roster grid ("Practice Groups & Chamber Workspaces"). |

**Team Workspace** — the generic *role* name for any team's own screen (not just "My Chambers," which is one specific team's name) is **Team Workspace**, mirroring Matter Workspace: eyebrow `TEAM WORKSPACE`, the team's own `name` as H1.

---

## 4. Everything on the Matter Workspace screen — the exact dynamic-data contract

This directly answers point 3 ("make everything inside the matter page dynamic, don't do anything hardcoded"). Every value the mockup shows, mapped to its real source in `useOrganizationStore` (already migrated with the Chamber fields as of the previous cleanup round):

```
Headline / chrome
  Matter title           → matters[].title
  Status pill             → matters[].status          ("open" | "active" | "on_hold" | "closed")
  Team name               → teams.find(t.id === matter.teamId).name
  Lead counsel             → matters[].leadCounsel
  Opened date               → matters[].openedAt

Metric tiles
  Documents count          → matters[].documentsCount   (or documents.length — pick ONE source of truth, don't let the two drift)
  Open tasks                → matters[].tasks.filter(t => !t.completed).length
  Deadlines                 → matters[].deadlines.length, next date = earliest deadlines[].date
  Hours logged               → NOT a real field yet. Render the fixed muted label "Not tracked yet" per
                                workspace-hierarchy-v1-brief.md §2.4 — do not compute anything from
                                matters[].hoursLogged, and do not remove that field from the store; it stays
                                reserved for when a real time-tracking feature ships.

Deadlines / Tasks / Documents / Activity panels
  → matters[].deadlines[], matters[].tasks[], matters[].documents[], matters[].activity[] — rendered as-is,
    empty-state text shown when the array is empty (never a fake row).

Litigation detail card (new since the Chamber migration)
  → matters[].counsel, .forum, .ecourtsSync, .integrity, .telemetry — all nullable. While null, render the
    exact empty-state copy in the mockup ("Forum, eCourts sync, and conflict-integrity data aren't available
    for this matter yet…"), never a placeholder number or fabricated forum name. Once a real integration
    populates these, render their real sub-fields (see the field list in the master handoff §9.3b).
```

**Team Workspace and Firm Console follow the identical rule** — every tile in `home-gateway-v2.html`'s `#screen-team` and `#screen-org` sections is commented inline with its source field (`team.membersCount`, `team.isPrivate`, `organization.totalAiRuns30d`, etc.). None of it is copy text; all of it is computed from the store at render time.

**The hero banner's sentence itself is a template, not a string:** `"You're working inside {team.name}. {deadlines due this week} deadline(s) need attention, {open tasks} task(s) still open."` — every number is a live count; if a count is zero, the sentence should drop that clause rather than say "0 deadlines" (a zero-count clause reads as a false all-clear, which is exactly the kind of overclaiming this project has flagged before — e.g. the "Hours Logged" rule in §2.4 of the prior brief).

---

## 5. Data-model changes needed (small, targeted)

- `stores/useOrganizationStore.js`: change the seed team's `name` from `'My Private Space'` to `'My Chambers'` (both the initial `teams` array entry and anywhere else it's referenced as a literal string, e.g. `createTeam()`'s default team assumptions if any). This is one line, same pattern as the `organization.name` default fixed in the previous cleanup round.
- No other store shape changes are needed — everything else in this brief reads fields that already exist (including the nullable Chamber-migration fields from the last round).

---

## 6. Scope boundaries

- This round does not touch Dashboard (Advocate Terminal), Case Vault, Contract Analyzer, Legal Calendar, or Conflict Engine — only the Home/Matter/Team/Org screens and the sidebar/route change that promotes Home.
- The Sidebar component itself is reused verbatim except for the one reorder + one rename described in §2 — no new visual treatment for the sidebar.
- Mobile responsiveness is reasoned, not device-verified, same standing caveat as every prior round.
- The hero banner's "status summary" sentence logic (§4) is new UI surface — if product wants it to eventually pull from more than deadlines/tasks (e.g. unread messages, pending approvals), that's a future round; this brief only wires it to data that already exists in the store today.

---

## 7. Definition of Done

- [ ] "Matters" renamed to "Home" in the sidebar nav, moved above "Dashboard"
- [ ] Post-login default route changed from `/dashboard` to the Home/gateway screen
- [ ] Hero greeting banner added above the existing matter-chooser grid, entirely computed from store data — no hardcoded numbers, names, or status words
- [ ] Weather widget and any other non-legal decorative content from the Lexlegis reference intentionally NOT added
- [ ] Default seed team renamed `My Private Space` → `My Chambers` in the store
- [ ] "Org Dashboard" renamed to "Firm Console" everywhere it appears as a nav/breadcrumb/capsule label; "Executive Console" kept only as the small eyebrow
- [ ] Matter screen given the `MATTER WORKSPACE` eyebrow; team screen given the `TEAM WORKSPACE` eyebrow; both always show the real record's `title`/`name` as the H1, never a generic screen name
- [ ] Every field on the Matter Workspace screen confirmed traced to a real store field per §4 — including the "Hours logged → Not tracked yet" rule and the nullable Chamber-migration fields' empty state
- [ ] Zero-count clauses in the hero sentence drop out rather than render "0 …"
- [ ] Confirmed against `workspace-hierarchy-v1-brief.md`: status-color mapping, typography rules, and the "current context vs. matter status" distinction all still apply unchanged
