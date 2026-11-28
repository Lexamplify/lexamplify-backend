# Evaluation report: the inline AI rewrite (`POST /api/documents/inline-edit`)

Run against the real model (gpt-4o-mini (OpenAI, with the app's fallbacks)) with the key read from the environment.
The key is not in this file, not in the output and not in the repository.

- cases: **8**
- hard failures (the route did not return a success body): **0**
- cases with an invariant broken: **0**
- total time: **11.0 s**
- tokens: **2204**

## What is scored

The inline rewrite replaces a selection directly inside a clause, so the output must be a small, inline-safe HTML fragment that reworks the *same* text. Each case checks four invariants:

- **markdown fences**: no ``` fence survived into the output (the editor pastes raw HTML).
- **block-level tags**: no `<p>`/`<div>`/`<body>`/`<html>` (or list/table/heading) wrapper - the span lives inside an existing paragraph.
- **invented figures**: every number, amount or percentage in the output is also in the selection. A figure that is not is an invented fact.
- **statutory terms**: the Act and section names in the selection survive the rewrite.

## Every case

| case | instruction | hard failure | invariants broken | seconds | tokens |
|---|---|---|---|---|---|
| ie-01 | make this more formal | no | 0 | 1.4 | 284 |
| ie-02 | tighten this clause | no | 0 | 1.3 | 272 |
| ie-03 | simplify this into plainer language without losing the legal effect | no | 0 | 1.8 | 266 |
| ie-04 | fix the grammar and make it read cleanly | no | 0 | 1.4 | 282 |
| ie-05 | make this more concise | no | 0 | 1.1 | 268 |
| ie-06 | rewrite this in the active voice | no | 0 | 1.0 | 265 |
| ie-07 | make the defined terms consistent and formal | no | 0 | 1.6 | 282 |
| ie-08 | emphasise the deadline and keep the meaning | no | 0 | 1.4 | 285 |

## Failures, verbatim

None: every case returned a clean inline fragment that kept all four invariants.

## Not verified by this run

- The legal quality of the wording: this run checks that the rewrite stays inline and invents no figures, not that a lawyer would approve the phrasing.
- The editor's own paste/undo behaviour and the BubbleMenu UI.
- In stub mode, anything about the real model: the stand-in echoes the selection, so every invariant passes by construction.
