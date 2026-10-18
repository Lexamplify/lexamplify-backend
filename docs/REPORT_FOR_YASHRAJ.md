# LexAmplify: Part 2 report for Yashraj

**One line:** a lawyer who has never seen the product can now draft a cheque-bounce notice, check a contract, or check for a conflict of interest, each in a few steps, and the product no longer makes up facts to fill gaps. I could not test it against the real AI model, on Firefox or Safari, or on your live servers; those are listed under "Not proven".

## What a lawyer sees now

1. **Start page.** "What would you like to get done?" with three big choices (Draft a document, Analyze a contract, Check conflicts), each with the time it takes. Everything else is under "All tools". Drafts left half way appear under "Continue where you left off".
2. **Draft a document** (11 types: cheque-bounce notice s.138, general notice, reply to a notice, affidavit, NDA, rent agreement, sale deed, vakalatnama, plaint skeleton, bail application, contract amendment). Four steps: Choose, Add details, Review, Download.
   - It **asks first**: take the facts from one of your cases, from a file you upload (PDF, Word, text), or type them in.
   - Each value read from a file shows **the sentence it came from**. Doubtful ones are marked "Please check".
   - Anything not given stays a **yellow blank** (`[Bracketed Field: …]`). It is never guessed. Dates, amounts (₹4,75,000 and the amount in words), cheque numbers, PAN, GSTIN and mobile numbers are checked as you type, in plain words.
   - Review shows exactly what goes into the **Word** file (A4, Times New Roman 12, 1.5 spacing, page numbers, blanks highlighted) and the **PDF**. Statutory timing is flagged (for example a notice sent more than 30 days after the return memo).
   - Work is **saved as you type**; a refresh, a dropped connection or an expired session loses nothing.
3. **Analyze a contract.** Upload PDF or Word. The result quotes the exact sentence it is worried about (a quote that is not in the contract is thrown away and counted), lists standard clauses that are really absent, and lists key dates and periods. "Draft an amendment" carries a finding into the drafting wizard.
4. **Check conflicts.** Compares names with **your own** clients, cases and parties in Practice, including spelling variants (Sundaram / Sundharam, Mohd. / Mohammed, R. Gupta / Ramesh Gupta). It says **Conflict / Please check / No match found**, and with an empty Practice it says **"nothing to check against, this is not a clearance"**.

## What I found and removed that was fake or unsafe

The conflict check was **fake**: it searched a hard-coded list of invented cases ("Sharma vs Tech Corp") and said "Clear" when nothing matched, even with no data. The contract analyzer would say "analyzed successfully, no risks" when the AI had failed, and always showed the same four statutes as "matching precedents". The Firm Console showed an invented "142 AI runs". All replaced with real data or an honest empty state.

Security and privacy, found by trying to break it (62 findings logged in `docs/RED_TEAM_REPORT.md`, 53 fixed, 1 accepted risk, 0 Critical or High open or accepted):
- Any signed-in advocate could read and change another advocate's clients, billing, cases, tasks and calendar. Fixed, and an automated test now walks **all 363 routes as a second advocate: 0 leaks**.
- Contracts you uploaded for analysis were saved in a folder that anyone on the internet could read by guessing the file name. Fixed.
- Signing out did not end the session (the cookie kept working for up to 30 days). Fixed.
- A zip-bomb Word file could exhaust the server; macro files and fake PDFs were accepted. Fixed.
- The server now refuses to start in production with a weak secret or no database setting, every error carries a reference number, nothing technical reaches the screen, and a strict browser security policy (CSP) is configured.

## What is proven (numbers from the final runs)

| Check | Result |
|---|---|
| Backend tests | 709 passed, 9 skipped, 1 failed (an order-dependent rate-limit test that passes alone; see BASELINE.md) |
| Browser tests (real backend, real browser, strict CSP, desktop and 375 px phone) | 56 passed |
| Frontend unit tests | 74 passed; build passes |
| Cheque-bounce notice, 100 runs with varied parties, amounts ₹25,000 to ₹1,25,00,000 and dates | 0 failures in 19 s; every draft checked for invented facts; Word text equals the preview; PDF carries the amount |
| 35 synthetic Indian legal documents (PDF, Word, text, scanned, password-protected, macro, empty, truncated, Hindi/Tamil mixed, 40-page contract) | every one gets the right outcome; no server error |
| Facts seeded to test the fact-checker (made-up amount, date, case number, names, PAN, mobile, a section that does not exist, an Act that does not exist) | all caught; no false alarm on the real facts |
| 12 advocates working at the same time | no errors; each sees only their own drafts |
| Conflict check on a firm with 6,000 matters | 1.3 s |
| A first-day advocate script through all three tasks, desktop and phone (22 screens) | 0 confusion points (see `docs/WALKTHROUGH.md`) |
| Secrets scan of every file and every past version | 0 found |

## Not proven (please read)

- **The real AI model was never run.** No key was available here. The notice drafting does not use the AI at all (fixed wording plus your facts), so it is unaffected. Reading facts from a file, contract analysis and free-writing do use it. A 20-run real-model test exists (`tests/test_corpus.py`, needs your key) but has not been run. **Run the manual test in `docs/DEPLOY_STEPS.md` step 4.2 first.**
- **Only Chrome-family browsers were tested.** Firefox and Safari engines are not installed here and I did not install them without your permission.
- **Lighthouse could not be run** (not installed). I ran my own accessibility checks instead: names on every control, headings, colour contrast in light and dark, keyboard use, focus. They pass on Start, the wizard and conflict pages. The older screens (sidebar, analyzer workbench) were improved in colour contrast but not fully audited.
- **Nothing was deployed or checked on your live servers.** Deploy steps are in `docs/DEPLOY_STEPS.md`. **Google sign-in under the new security policy is the most likely thing to need a one-line adjustment.**
- **Document wording has not been reviewed by a practising advocate.** Every template says so on screen. Mohan's checklist (`docs/MOHAN_TEST_CHECKLIST.md`) is for exactly this.
- **Word and PDF were checked by reading the files back, not by opening them in Word.** Page breaks and fonts in real Word were not seen.
- **Frontend packages have known vulnerabilities** (`npm audit`: 36, of which 3 high, in a text-editor library and the router). A fix exists inside the allowed version ranges; I did not apply it without asking. Python packages were not audited.
- **The Render disk question:** Practice, the Case Vault and the Document Hub keep data in SQLite files on the server. If Render has no persistent Disk, a redeploy erases them. Please confirm.
- Phone sign-in (OTP) is still on hold, as instructed. The older Contract Analyzer screen still has several primary buttons on one screen.

## Five-minute demo

1. Sign in → Start. 2. **Draft a document → Cheque bounce notice → From a file → upload `s138_return_memo_1.pdf`** (in `tests/fixtures/indian_legal`). Show the sentence beside each value. 3. Leave one detail empty → Review: yellow blank. 4. Continue → Download Word, open it. 5. **Analyze a contract → `commercial_contract_40pages.docx`**: open a flagged clause, show the quote is in the contract; click "Draft an amendment". 6. **Check conflicts**: empty Practice says "not a clearance"; add one case, check a spelling variant of the other side.
