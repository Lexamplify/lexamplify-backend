# AI Legal Associate — Full UI Redesign — Implementation Brief (v1)

**Companion file:** `ai-legal-associate-v1.html` (interactive vanilla mockup — a top-right switcher labeled "1 · Landing / 2 · Streaming / 3 · Result" moves between the three states; that switcher is mockup-only scaffolding, not real UI, same convention as the "SPEC NOTE" callouts in earlier rounds).

**Why this is a full redesign, not a reskin:** every other feature in this project (Case Vault, Dashboard, Legal Calendar, Contract Analyzer, the workspace hierarchy) runs on one shared design system — Slate & Rust, a strict two-accent contract, Fraunces italic for identity-bearing text. The AI Legal Associate — the product's core feature, the thing lawyers actually spend their time in — runs on a completely different, ungoverned visual language: a generic blue chatbot accent, a sidebar hardcoded to dark regardless of the app's own theme toggle, and **four** colors doing accent work at once (blue primary, green checkmarks, blue spinner, red stop button) in a product that enforces exactly two everywhere else. That inconsistency is the actual problem this brief fixes — not the icon shapes or the corner radii.

Every control from the original three screenshots/recording is preserved: New Conversation, search conversations, Today/Earlier history grouping, the workflow tab filter (All Workflows/Drafting/Research/Analysis), all 9 workflow cards, the 4 "TRY" suggestion chips, the composer with its slash-command hint, all 5 toolbar tools (Attach, Voice, Find Citation, Cause List, Statutory Research), Send, Stop, the 4-step progress checklist, the rendered document output, and the disclaimer. Nothing was trimmed.

---

## 1. What research grounded this redesign

Two sources were pulled specifically for this round (a legal-drafting AI tool has real trust/verification stakes, so this wasn't done by eye alone):

- **[AI Chatbot UI Design: 8 Patterns That Build User Trust](https://designpixil.com/blog/ai-chatbot-interface-design)** — the patterns actually applied below: sources placed beside the answer rather than as footnotes; a five-state response lifecycle (thinking, streaming, stopped, complete, failed) where most products only design the "complete" state; AI-generated, distinguishing conversation titles instead of generic/duplicate ones; a first-message/empty-state that sets scope and a concrete next move rather than a blank box.
- **[Chatbot UX Patterns: Streaming, Errors, Citations & More](https://ai-tldr.dev/learn/building-ai-apps/ai-ux-patterns/chatbot-ux-patterns/)** — the reasoning behind two specific decisions below: why citations must come from a retrieval layer and never be generated from the model's memory ("models hallucinate them confidently"), and why a blank or disconnected error state is actively harmful ("an interface that leaves a blank bubble trains users to distrust the entire product").

Both are cited because this brief's recommendations aren't aesthetic opinions — they're specific, sourced answers to the question the user asked directly: *"is this something a lawyer can trust?"*

---

## 2. The four-color problem — and why it matters more here than anywhere else

The original screenshots show: a blue primary accent (buttons, user message bubble, send icon), green checkmarks on completed progress steps, a blue spinner on the active step, and a solid red "Stop" button. That's four accent colors in one screen, in a product whose design system elsewhere enforces exactly two — rust for urgent/primary/current, amber for caution — and nothing else, specifically so a lawyer can learn the color vocabulary once and trust it everywhere.

This is the single highest-stakes place in the product for that discipline to hold, because this is where the AI is actively generating legal text a lawyer might file. If red and green appear here and nowhere else, a lawyer has no learned association for what they mean in this context — they're just noise. Fixed in this mockup:

- **Progress steps**: done = solid rust-filled circle with a rust checkmark (not green); active = a rust ring with a pulsing rust halo, no separate spinner color; pending = plain neutral outline. One color communicates the entire state machine.
- **Stop button**: a neutral outlined button (ink border/text, hover-to-rust) — not solid red. It doesn't need to alarm; it needs to be findable and unambiguous, and it already sits directly across from a "working" label, so red adds nothing but a new color.
- **User message**: moved off a solid blue chat-bubble-app look entirely — now a rust-soft-tinted card with a rust border and rounded corner cut on one side (a restrained echo of a speech-bubble shape, not a loud pill), consistent with how `accent-soft` is already used for "current/selected" states elsewhere in the product (the matter-card `.current` treatment, the context trail's active segment).
- **Trust/warning bar on the generated draft**: amber (`major`/`major-soft`), the product's one dedicated caution color — not a new warning-yellow.

---

## 3. The sidebar now actually follows the theme toggle

The original screenshots show a sidebar that's dark navy regardless of what the rest of the app is doing — there's no visible light-mode version of it in any screenshot, and the styling (a distinct near-black panel) doesn't match either of the product's two theme palettes. Rebuilt on the same `--paper`/`--ink`/`--rule` tokens as every other sidebar in the product, so `data-theme="light"` actually produces a light sidebar here too — confirmed in the mockup by toggling the theme button and checking both states render correctly (screenshotted during this round — both hold up).

---

## 4. Trust and citations — proximity, not a footnote

Per the DesignPixil/ai-tldr research above, verification friction is what determines whether a lawyer actually checks an AI-drafted clause or just trusts it blindly. The original design buries its entire trust message in one line of small grey text at the very bottom of the page — true whether you're looking at an empty composer or a finished, filed-ready-looking document. Changes:

- **On the landing screen**, a `trust-line` pill sits directly under the hero description, before any interaction happens: *"Draft-only, not legal advice. Every citation is checked against the statute before it's shown to you."* This sets scope in the first three seconds, per the "first message design" pattern.
- **On the generated draft**, a persistent amber bar sits at the top of the draft card itself — *"AI-drafted, not filed. Review every bracketed field and clause against your matter facts before sending to a party or the court"* — directly above the content it's warning about, not scrolled away at the page's bottom edge. The original bottom-of-page disclaimer text is **kept as well** (it's still useful as a standing footer reminder) — this is additive, not a replacement.
- **A new "Grounded in:" chip row** above the draft names the specific statutes the draft actually cites (Indian Contract Act 1872, IT Act 2000 in this example), each clickable through to the citation. **Implementation-critical, per the ai-tldr source directly:** these chips must be populated from whatever statute/citation the drafting model actually retrieved and grounded its clauses on — never generated from the model's own unverified memory of what a statute says. If the backend doesn't currently track which statutes backed a given draft, that's a real gap to raise, not something to fake with a plausible-looking chip.

---

## 5. The five-state lifecycle — not just "working" and "done"

The original only visibly designs two states: the 4-step progress card, and the finished document. Per the DesignPixil source, that's the most commonly-skipped part of a chat UI, and skipping it is exactly what "trains users to distrust the product" when it happens to them for the first time. The mockup's Streaming view includes a compact example block (clearly marked mockup-only, matching the "spec note" convention from earlier rounds) documenting the other two states:

- **Stopped** (user clicked Stop mid-generation): replace the working card in place with "You stopped this response," keep whatever steps had already completed visible (so the lawyer can see how far it got), no retry needed since it was their own action — but offer a plain "Resume" or "Start over" action.
- **Failed** (model/backend error): replace the working card in place with a specific, human-readable reason where possible ("Couldn't reach the drafting model," not a blank space or a raw error code) and a Retry button — amber icon (caution), never red, consistent with §2.

**The rule that matters for implementation:** never let the working card just vanish or freeze with no visible outcome. A blank space where a response should be is the single worst-case outcome for trust, worse than a slow response or an ugly error message.

---

## 6. Conversation history — the duplicate-title problem

JN's own screenshots show **three separate history entries all named "Mutual NDA Agreement"**, indistinguishable from each other in the sidebar. That's not a cosmetic nitpick — per the DesignPixil source's "auto-named history" pattern, a history list that can't tell two conversations apart is close to useless for actually finding past work, which matters for a lawyer managing several matters' worth of drafts. The mockup's example history uses distinguishing detail in the title ("Mutual NDA — Acme Textiles counterparty," "Mutual NDA — 3-yr survival, draft 2") instead of the generic workflow name alone.

**Implementation direction, not a fixed template:** auto-name each conversation from something specific to it — the counterparty name if one was mentioned, the matter it's scoped to (tying back into the Home Gateway work — a conversation started from within a matter context should probably carry that matter's name), or a short excerpt of the actual request. Never let the workflow template name (e.g. "Mutual NDA") stand alone as the entire title when more than one conversation would produce the identical string.

---

## 7. Layout and IA changes

- **Workflow cards**: icons unified to the single hand-built SVG system (24×24, ~1.7px stroke) used everywhere else in the product, rendered in one rust tone on a neutral tile — replacing the original's assorted candy-colored icon badges (blue, green, purple, teal, orange all appeared across the 9 cards). A small mono category tag (`DRAFTING`/`RESEARCH`/`ANALYSIS`) on each card ties it back to the tab filter above the grid, so the grouping is visually legible even before touching the tabs.
- **Workflow tabs**: restyled as the same segmented-control pattern (`.ftab`/`.wf-tab`) used for team filters in the Home Gateway work, for visual consistency across the product rather than this screen inventing its own tab component.
- **Composer**: the five toolbar tools kept exactly, restyled as icon+label pills matching the Quick Jump dock pattern from the workspace-hierarchy round. Send button is a filled rust circle, consistent with primary-action treatment everywhere else.
- **Generated document**: Fraunces italic for the document title (identity-bearing text, per the standing typography rule — the original used a generic serif with no relationship to the product's type system), IBM Plex Mono for the sub-line and table headers, tables restyled to the product's own rule/border tokens instead of the original's blue-tinted borders.
- **New, clearly-flagged addition — action toolbar above the draft** (Copy / Export .docx / **Insert into Case Vault**): Copy and Export existed only implicitly in the original (there was no visible way to do either in the screenshots — it's not clear how a lawyer gets a finished draft out of the chat). "Insert into Case Vault" is a genuinely new option, called out here for product sign-off rather than silently added: once a matter has a real Case Vault (already redesigned earlier in this project), the natural, arguably necessary next step for an AI-drafted NDA is getting it into that matter's document record without a manual re-upload round-trip. Flagging it as a recommendation, not asserting it's already scoped.

---

## 8. What's simulated in the mockup vs. needs real wiring

- All history items, the current conversation, and the draft content are static example data standing in for whatever chat/session store the AI Legal Associate is actually built on.
- The "Grounded in:" citation chips are illustrative — wire them to real retrieval-layer citation data per §4's implementation-critical note.
- The three-state switcher in the top bar is mockup-only navigation; the real UI transitions between these states as an actual response streams, not via manual clicks.
- Stopped/failed states are documented in the brief and shown as one compact example block, not built out as full separate screens — apply the same visual language (§5) when implementing them for real.

---

## 9. Definition of Done

- [ ] No more than two accent colors anywhere on this screen (rust + amber) — confirmed removed: blue primary, green checkmarks, blue spinner ring, red stop button
- [ ] Sidebar rebuilt on the shared `--paper`/`--ink`/`--rule` tokens — confirmed it renders correctly in both `data-theme="dark"` and `data-theme="light"`
- [ ] Trust messaging appears in three places, not one: the landing hero trust line, the draft's top trust bar, and the existing bottom-of-page disclaimer (kept, not replaced)
- [ ] "Grounded in:" citation chips wired to real retrieval-layer data — never generated from the model's own memory of a statute
- [ ] Five-state lifecycle implemented: thinking, streaming, stopped, complete, failed — no state where the UI goes blank or silently freezes
- [ ] Conversation auto-titling changed to produce distinguishing titles — confirmed the "three identical 'Mutual NDA Agreement' entries" problem from JN's own screenshots can't recur
- [ ] All 9 workflow cards present, icons unified to the single hand-built SVG system, category tags added
- [ ] All 5 composer tools (Attach, Voice, Find Citation, Cause List, Statutory Research) present and functional — none trimmed
- [ ] Fraunces italic applied to the generated document's title; IBM Plex Mono to its sub-line and table headers
- [ ] New "Insert into Case Vault" action confirmed with product before build — flagged in §7 as an addition, not part of the original scope
- [ ] Mobile responsiveness reasoned, not device-verified — standing caveat, same as every prior round in this project

---

Sources:
- [AI Chatbot UI Design: 8 Patterns That Build User Trust](https://designpixil.com/blog/ai-chatbot-interface-design)
- [Chatbot UX Patterns: Streaming, Errors, Citations & More](https://ai-tldr.dev/learn/building-ai-apps/ai-ux-patterns/chatbot-ux-patterns/)
