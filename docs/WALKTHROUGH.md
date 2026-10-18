# Walkthrough: a first-day junior advocate

A script walks Start, then each of the three tasks, on a desktop (1280 px) and a phone (375 px), choosing the obvious action at every screen.
At each screen it records objective signs of confusion: no clear title, more than one primary button, nothing to click, controls with no name, sideways scrolling,
raw text such as `undefined`, and a first control that takes longer than 2 seconds to appear. It is a script, not a person: it finds where a person would be lost; it does not replace watching Mohan use the product.

Screens checked: 22. Screens with a confusion point: 0. Screenshots are in `docs/screens/walkthrough-*.png`.

| Device | Screen | Title shown | Primary buttons | First control ready | Confusion points |
|---|---|---|---|---|---|
| desktop | Start | What would you like to get done? | none | 89 ms | none |
| desktop | Draft: choose a document | What would you like to draft? | none | 46 ms | none |
| desktop | Draft: where do the facts come from | Cheque bounce notice (s.138 NI Act): add the details | Review the draft | 36 ms | none |
| desktop | Draft: pick a case | Cheque bounce notice (s.138 NI Act): add the details | Review the draft | 41 ms | none |
| desktop | Draft: details filled from the case | Cheque bounce notice (s.138 NI Act): add the details | Review the draft | 35 ms | none |
| desktop | Draft: review | Check the draft | Looks good, continue | 29 ms | none |
| desktop | Draft: download | Your draft is ready | Download Word (.docx) | 36 ms | none |
| desktop | Analyzer: upload | Contract Analyzer | Begin analysis | 41 ms | none |
| desktop | Analyzer: results | Contract Analyzer | Export report | 38 ms | none |
| desktop | Conflicts: the form | Check for a conflict of interest | Check names | 42 ms | none |
| desktop | Conflicts: the answer | Check for a conflict of interest | Check names | 39 ms | none |
| phone | Start | What would you like to get done? | none | 49 ms | none |
| phone | Draft: choose a document | What would you like to draft? | none | 57 ms | none |
| phone | Draft: where do the facts come from | Cheque bounce notice (s.138 NI Act): add the details | Review the draft | 32 ms | none |
| phone | Draft: pick a case | Cheque bounce notice (s.138 NI Act): add the details | Review the draft | 38 ms | none |
| phone | Draft: details filled from the case | Cheque bounce notice (s.138 NI Act): add the details | Review the draft | 31 ms | none |
| phone | Draft: review | Check the draft | Looks good, continue | 28 ms | none |
| phone | Draft: download | Your draft is ready | Download Word (.docx) | 32 ms | none |
| phone | Analyzer: upload | Contract Analyzer | Begin analysis | 31 ms | none |
| phone | Analyzer: results | Contract Analyzer | Export report | 37 ms | none |
| phone | Conflicts: the form | Check for a conflict of interest | Check names | 36 ms | none |
| phone | Conflicts: the answer | Check for a conflict of interest | Check names | 34 ms | none |

## What this found while it was being built

- The first version of the wizard moved the whole page 16 to 40 px off the left edge on a phone every time it changed step. The cause was the shell's header capsule, which is wider than a phone. Fixed.
- The review preview was unreadable in the dark theme (1.1:1 contrast). Fixed.
- The Start page and wizard had muted text at 2.85:1 contrast. Fixed app-wide through the shared colour tokens.
- A page-wide scroll shift came back whenever focus moved; every page change now moves focus to the new heading without scrolling.

## What it cannot tell you

Whether the wording of the questions is the wording an advocate would use, whether the draft text is what a court expects, and how long a real person takes. Those need Mohan (see `docs/MOHAN_TEST_CHECKLIST.md`).
