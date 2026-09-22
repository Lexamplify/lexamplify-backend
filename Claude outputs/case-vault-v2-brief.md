# Case Vault v2 — Document Vault: real folder hierarchy, right-click, Share — Implementation Brief

**Companion file:** `case-vault-v2.html` (vanilla HTML/CSS/JS mockup — visual and interaction-behavior reference only, not code meant to be pasted directly into the real app).

**Builds on:** `case-vault-v1.html` / `case-vault-v1-brief.md`. Everything in that brief still applies — the six-panel layout, the Slate & Rust tokens and color semantics, the Case Tracker/Legal Drafts/Provenance Trail/Timeline panels, the data contracts for Matter/ProvenanceEntry/TimelineEvent/Draft. **This round only touches Document Vault** (§1–§10 of this document); nothing else changed.

**Before handing these files to Antigravity:** confirm this exact pair (`case-vault-v2.html` + this brief) is what's being pasted in, not v1's — v1's Document Vault section is fully superseded by this round, everything else in v1 carries forward untouched.

---

## 1. What this round covers

The current, already-implemented Document Vault (confirmed live, and reproduced faithfully in `case-vault-v1.html`) is a flat set of five folder cards in a grid. Clicking a card expands it in place to show that folder's documents — but there is no nesting, no way to create a folder or subfolder, and no right-click on anything. It's a one-level bucket list wearing a folder icon, not a real hierarchy.

This round replaces that grid with an actual Explorer-style tree:

- **Arbitrary nesting depth.** Folders can contain subfolders, which can contain subfolders, which can contain documents — the mockup ships three levels deep inside "03 · Evidence & Exhibits" (`Bank Statements` → `Scanned Originals` → `Scan_001.pdf`) specifically to prove the tree isn't hardcoded to a fixed depth.
- **Right-click everywhere.** Right-clicking a folder or a document opens a context menu scoped to that item. Right-clicking blank space below the tree opens a root-level menu (New folder / Upload document). Every row also has a hover-revealed "⋯" button that opens the identical menu, so the feature doesn't depend on the user knowing to right-click — same rationale as giving every segment of the context capsule a dropdown chevron in the Home Gateway v3 round.
- **Share, from the context menu, on both folders and documents.** Opens a picker of the firm's own team roster (see §3) with per-person checkboxes and a view/edit permission select, plus a "link access" toggle. This is the feature JN specifically asked for and the reason this round exists.
- **Inline rename, in place.** Right-click → Rename (or the same from the kebab menu) turns the row's name into a text field, focused and selected, committed on Enter/blur, cancelled on Escape — the same pattern Explorer and Finder both use, so nothing about it needs explaining to a lawyer.
- **New folders created inline.** "New folder" (either the toolbar button or the context-menu action) inserts the node immediately, already in rename mode, so naming it is the very next keystroke — no separate "create" then "rename" round-trip.

**Design system:** unchanged from v1 — Slate & Rust, exact shared tokens, no new colors. Rust is still reserved for primary actions, active/selected state, and urgency; amber is still reserved for genuine caution ("Needs review" tags). The new tree, context menu, and Share modal all draw from the same token set — nothing introduces a new color.

---

## 2. A decision this round makes explicit — and flags back to product

The five top-level folders (`01 · Pleadings & Drafts` through `05 · Research & Precedents`) created by "Initialize standard blueprint" are marked `protected: true` in the mockup's data and **cannot be deleted** from the context menu — the Delete item is present but disabled, with a tooltip explaining why. Renaming, sharing, and adding subfolders/documents inside them all work normally; only deletion is blocked.

This wasn't explicitly requested, but it follows directly from v1's still-open §2 discrepancy (the blueprint's own copy vs. actual folder count) and from the taxonomy being the thing every other panel — Case Tracker's document-linking, the auto-classification tags — is built around. Letting a user delete `03 · Evidence & Exhibits` out from under a matter with linked documents seems like the kind of thing that should be a deliberate product decision, not an accident of shipping a generic "everything is deletable" tree. **Confirm this is actually the intended behavior before implementing** — the alternative is allowing deletion but requiring the folder to be empty first, which is the other common pattern for this.

Subfolders and documents created after that point (`Bank Statements`, `Scanned Originals`, and anything a user uploads) are ordinary, unprotected nodes — full delete works on those, and the mockup's automated pass (see §8) confirms it.

---

## 3. Where the Share roster comes from

Share's people-picker is **not new data invented for this feature** — it's the same team-member model already built for `workspace-hierarchy-v1.html` (`teamMembers[teamId]`, `{name, role}` shape). The mockup's roster is "My Chambers"'s membership, styled identically to that file's roster rows (avatar-initials circle, name, role line).

```
RosterMember { id: string, name: string, role: string }   // role is display text, e.g. "Partner · My Chambers"
```

**This needs to be one source of truth in the real app, not two team-membership lists that can drift.** Document Vault's Share picker should read from whatever store already backs the Team screen's roster (per the workspace-hierarchy/Home Gateway briefs), not maintain its own copy. Same category of risk v1's brief already flagged for document-to-matter linking (§5 there) — a second, parallel membership list is how these things quietly go stale.

**What Share actually sets, in the mockup:**

```
node.shared: string[]        // rosterMember ids given access
node.linkShared: boolean     // "anyone in My Chambers with the link can view" toggle
```

A small badge (person icon + count) appears next to any folder or document with `shared.length > 0`, so sharing state is visible in the tree itself, not just inside the modal.

**Simulated, needs real wiring:** the permission select (Can view / Can edit) next to each checked person is presentational only — checking someone in doesn't currently persist which permission level they got, just that they're on the list. Real version needs `shared` to carry a permission per person (`{ memberId, permission }[]`, not a bare id array), and "Anyone in My Chambers with the link" needs an actual shareable-link mechanism behind it, not just a toggle.

---

## 4. What's simulated in the mockup — needs real wiring

Same convention as every other feature's brief: everything below is a UI stand-in.

- **Upload (toolbar button, dropzone, and "Upload here" from a folder's context menu)** — all three create a placeholder document node tagged "Just uploaded" with a fixed size. No real file picker, no real upload, no real auto-classification. Needs the same ML-triage/auto-classification pipeline v1's brief already flagged for the dropzone.
- **Preview and Download (document context menu)** — both show a toast saying they're not wired up. Needs a real document viewer and a real file-serving endpoint respectively.
- **Delete** — removes the node from the mockup's in-memory tree immediately, no confirmation step. A real implementation should almost certainly confirm before deleting (Explorer/Finder both do), and — given this vault's own "tamper-evident" framing — probably needs to write the deletion itself to the Provenance Trail rather than silently vanishing the node. Not addressed here; flagging because it's a real gap, not an oversight to silently fix by guessing at the right confirmation copy.
- **Share's permission level and link-sharing toggle** — see §3.
- **The document count and "N DOCS" per folder** — computed live from the tree's actual structure in the mockup (recursive count of all descendant documents, including nested subfolders), which is the behavior the real version should match — this one is *not* a stand-in, it's the actual intended logic, called out so it doesn't get miscoded as a stored/denormalized count that can drift.

---

## 5. Data contract — replaces v1 §3's flat `Document`/folder shape for this panel

```
TreeNode =
  | { type: 'folder', id: string, name: string, updatedAt: ISODate,
      protected: boolean,        // true only for the 5 standard-blueprint folders — see §2
      shared: string[],          // RosterMember ids
      linkShared: boolean,
      children: TreeNode[] }     // arbitrary depth — folders and documents freely mixed
  | { type: 'doc', id: string, name: string, tag: string, tagSeverity: 'neutral' | 'review',
      sizeBytes: number, updatedAt: ISODate, contentHash: string,
      shared: string[], linkShared: boolean,
      matterId: string | null }  // v1's per-matter linkage still applies to doc nodes, unchanged
```

This is a strict superset of v1's `Document` type (adds `shared`/`linkShared`) plus a new recursive `folder` shape (adds `children`, `protected`, drops the flat `docs: Document[]` array in favor of nesting). `matterId` and `contentHash` behave exactly as specified in v1 §3 — not redesigned here, just carried over onto the new node shape.

**One real design question this raises, not answered here:** does `shared` on a folder cascade to its contents (sharing a folder implicitly shares everything inside it), or is sharing strictly per-node and a shared folder's documents need their own separate share? The mockup treats every node's `shared` list as fully independent — sharing `02 · Court Filings` does not touch `Counter_Affidavit_SBI.pdf`'s own (separately set) share list, and the screenshots reflect that. Real litigation-vault products usually cascade folder shares (that's the whole point of sharing a folder rather than each file in it one at a time) — this needs a product decision before implementation, not a silent default either way.

---

## 6. Rendering approach note — same standing lesson as v1 §8

The tree, context menu, and Share roster are all built via direct `innerHTML` template-string assembly (vanilla JS, event delegation on the tree container for clicks/right-clicks/rename-commit). Fine for a mockup; **do not port this directly into React.** Build the tree as a real recursive component (`<TreeNode node={n} depth={d} />` rendering its own `children.map(...)`), let React own expand/collapse and selection state, and use a proper positioned-menu/popover primitive for the context menu rather than a single shared absolutely-positioned div — the mockup's single-div-with-innerHTML approach works fine for click-to-open/click-outside-to-close, but a real popover library will handle focus trapping and keyboard nav (arrow keys between menu items) that this mockup doesn't attempt.

---

## 7. Open product questions — do not silently default these

1. **Folder-share cascading** — see §5's callout. This is the biggest open question in this round.
2. **Does deleting a protected folder ever become possible** (e.g., once it's empty), or is it permanently blocked? See §2.
3. **Does Delete need a confirmation step, and does it need to write to the Provenance Trail?** See §4. Given the vault's "hand this to a court" framing, silent deletion with no audit trail feels like it undermines the product's own core claim — but that's a call for Yogesh/Saurabh, not something to default silently either way.
4. **Permission levels ("Can view" / "Can edit") — do they do anything yet**, or is Document Vault view-only for non-owners regardless of what's selected in Share? The picker UI implies edit access is a real, enforced thing; confirm the backend actually distinguishes the two before shipping a control that implies it does.
5. **Does "Upload here" from a folder's context menu respect the same auto-classification as the top-level dropzone**, or is classification only applied to the standard 5 taxonomy folders? Matters for anything uploaded into a user-created subfolder like `Bank Statements`.

---

## 8. What was actually checked, not just reasoned about

Ran the mockup headlessly (Playwright, both themes) end to end before writing this up:

- Expanded three levels of nesting (`03 · Evidence & Exhibits` → `Bank Statements` → `Scanned Originals`) and confirmed the deepest document renders and is reachable.
- Right-clicked a folder, confirmed the context menu shows the correct five items with Delete disabled and a tooltip present.
- Opened Share on a folder that already had one person shared (`02 · Court Filings` → Rekha Iyer), confirmed the picker pre-checks the right roster row and shows the correct breadcrumb path in the target line.
- Added a second person, saved, confirmed the tree's shared-badge count updated from 1 to 2 and a confirmation toast appeared.
- Created a new folder via the toolbar, confirmed it entered rename mode immediately, typed a name, pressed Enter, confirmed it committed and the parent's own name was untouched (a rename-scoping bug this specifically guards against).
- Right-clicked that same new folder and deleted it, confirmed it's gone and a protected folder's Delete stays disabled in the same session.
- Confirmed the Document Vault tab's document count updates live off the tree's actual contents rather than a static "20".
- Toggled dark/light theme with the tree in a partially-expanded, mid-interaction state, confirmed no color drift outside the token set.

**Not checked — same standing caveat as every other feature's mobile pass:** no real device or touch-input testing (no long-press-for-context-menu equivalent exists yet; the hover-revealed "⋯" button is the mockup's answer for touch, but hasn't been verified on an actual phone).

---

## 9. Scope boundaries — what this brief does NOT cover

- **Case Tracker, Legal Drafts, Provenance Trail, Timeline, and the Overview panel** are unchanged from v1 — nothing in those panels was touched this round.
- **The sidebar is representative of the existing, stable Sidebar component**, same as every other brief in this project — don't rebuild it from this mockup's markup.
- **Drag-and-drop reordering/moving nodes within the tree is not part of this round.** Explorer-style trees usually support dragging a file or folder onto another folder to move it; this mockup does not implement that (it would meaningfully expand scope and risk — a broken drag-drop is worse than none). Worth a follow-up round once the static tree, right-click, and Share are confirmed working end to end.
- **The Provenance Trail entries shown are still v1's illustrative sample data** — creating/renaming/sharing/deleting a node in this mockup does not write a new trail entry, even though a real implementation almost certainly should (see §7.3).
- **Mobile responsiveness is reasoned, not device-verified** — see §8.

---

## 10. Definition of Done (this round only — see v1's brief for everything else)

- [ ] Document Vault renders a real recursive folder tree (not a flat grid) with no artificial depth limit
- [ ] Every folder and document row supports right-click → context menu, and the same menu is reachable via a visible "⋯" button (not right-click-only)
- [ ] Context menu items match §1/§8: New subfolder, Upload here, Rename, Share…, Delete for folders (Delete disabled + tooltipped on the 5 protected blueprint folders); Preview, Rename, Share…, Download, Delete for documents
- [ ] Share opens a picker backed by the **same roster data source** as the Team screen (§3) — not a second, independently maintained membership list
- [ ] Rename is inline (row becomes a text field), committed on Enter/blur, cancelled on Escape, matching the mockup's behavior
- [ ] New folders are created already in rename mode
- [ ] Folder document counts are computed live from actual nested contents, not stored/denormalized (§4)
- [ ] §7's five open product questions (folder-share cascading, protected-folder deletion, delete confirmation + Provenance Trail logging, permission-level enforcement, auto-classification scope on subfolder uploads) resolved with product before or during implementation — not silently defaulted
- [ ] Upload, Preview, Download, and Delete's audit-trail write are either wired to real backends or explicitly ticketed as follow-ups — not silently shipped as the mockup's placeholder behavior
- [ ] Rendered as real recursive components, not ported `innerHTML` string assembly (§6)
- [ ] Mobile/touch interaction (the "⋯" fallback for right-click) checked on a real device before considering this done
