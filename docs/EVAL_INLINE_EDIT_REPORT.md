# Evaluation report: the inline AI rewrite (`POST /api/documents/inline-edit`)

**STUB MODE.** No `GROQ_API_KEY` was set, so a deterministic stand-in model answered the
prompts (it echoes the selected span back unchanged). This run proves the harness, the real
route and the scoring work; it says **nothing** about how a real model behaves. Run it again
with the key set in the environment for that.

- cases: **8**
- hard failures (the route did not return a success body): **0**
- cases with an invariant broken: **0**
- total time: **0.0 s**
- tokens: **not measured (stub mode)**

## What is scored

The inline rewrite replaces a selection directly inside a clause, so the output must be a small, inline-safe HTML fragment that reworks the *same* text. Each case checks four invariants:

- **markdown fences**: no ``` fence survived into the output (the editor pastes raw HTML).
- **block-level tags**: no `<p>`/`<div>`/`<body>`/`<html>` (or list/table/heading) wrapper - the span lives inside an existing paragraph.
- **invented figures**: every number, amount or percentage in the output is also in the selection. A figure that is not is an invented fact.
- **statutory terms**: the Act and section names in the selection survive the rewrite.

## Every case

| case | instruction | hard failure | invariants broken | seconds | tokens |
|---|---|---|---|---|---|
| ie-01 | make this more formal | no | 0 | 0.0 | - |
| ie-02 | tighten this clause | no | 0 | 0.0 | - |
| ie-03 | simplify this into plainer language without losing the legal effect | no | 0 | 0.0 | - |
| ie-04 | fix the grammar and make it read cleanly | no | 0 | 0.0 | - |
| ie-05 | make this more concise | no | 0 | 0.0 | - |
| ie-06 | rewrite this in the active voice | no | 0 | 0.0 | - |
| ie-07 | make the defined terms consistent and formal | no | 0 | 0.0 | - |
| ie-08 | emphasise the deadline and keep the meaning | no | 0 | 0.0 | - |

## Failures, verbatim

None: every case returned a clean inline fragment that kept all four invariants.

## Not verified by this run

- The legal quality of the wording: this run checks that the rewrite stays inline and invents no figures, not that a lawyer would approve the phrasing.
- The editor's own paste/undo behaviour and the BubbleMenu UI.
- In stub mode, anything about the real model: the stand-in echoes the selection, so every invariant passes by construction.
