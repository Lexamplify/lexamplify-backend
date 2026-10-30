# Test checklist for Mohan

Use the test documents in `tests/fixtures/indian_legal/` (all invented; no real client data). For each step, do what it says, compare with "You should see", and write what happened in the last column. Tick the box only if it matched. **Anything confusing counts as a problem, even if it works.** Please note the time you started and finished each task.

Sign in with the account Yashraj gives you. Start here: the **Start** page. You should see three big choices: Draft a document, Analyze a contract, Check conflicts.

## A. Draft a cheque-bounce notice (the main test)

| # | Do this | You should see | OK? | Notes |
|---|---|---|---|---|
| A1 | Start → **Draft a document** → **Cheque bounce notice (s.138 NI Act)** | A page "add the details" with three ways to give facts, a short "Good to know" box (30 days / 15 days / 3 months), and a bar "0 of 16 needed details filled" | ☐ | |
| A2 | Choose **From a file I upload**. Upload `s138_return_memo_1.pdf` | "Read N details from…". Cheque number **942936**, amount **Rs. 1,25,000/-**, cheque date **19/05/2026** (or 19 May 2026), reason **Exceeds arrangement**, memo date **16/06/2026**, presented **15/06/2026**, bank **Canara Bank, Chennai Main Branch**. Each shows a grey box "Read from s138_return_memo_1.pdf: …" with the sentence it came from. Yellow ones say "Please check" | ☐ | |
| A3 | Click **Looks right** on one yellow value, and change another | The yellow turns normal once you confirm or edit it | ☐ | |
| A4 | Leave "Name of the person who gave the cheque" empty. Type `31/02/2026` as a date and `five lakh` as the amount | Plain red messages next to those fields ("is not a date this tool can read", "is not a rupee amount"). Nothing invented | ☐ | |
| A5 | Fill the rest from the memo's parties: your client **M/s Gupta Builders Pvt Ltd**, other side **M/s Bose Logistics Pvt Ltd**, with addresses and dates of your own | The bar fills up | ☐ | |
| A6 | Press **Review the draft** | A white page. Amount shown like **₹1,25,000 (Rupees One Lakh Twenty Five Thousand Only)**, dates like **16 June 2026**, numbered paragraphs, signature block. Any detail you left empty is a **yellow [Bracketed Field: …]** you can click | ☐ | |
| A7 | Put a notice date **more than 30 days after** the memo date and Review again | A red "Please check" note that the notice may be out of time (Section 138(b)) | ☐ | |
| A8 | **Looks good, continue** → **Download Word** | A .docx opens in Word. A4, Times New Roman 12 pt, 1.5 line spacing, page number at the bottom, blanks highlighted yellow. **Read every paragraph: is anything you would not send to a court?** | ☐ | |
| A9 | **Download PDF** | The same text, with the ₹ sign shown properly | ☐ | |
| A10 | Close the tab half way through step A5, then open Start | **Continue where you left off** lists this draft. Opening it brings back everything you typed | ☐ | |
| A11 | **Open in the editor** | The finished notice appears in the drafting studio | ☐ | |
| A12 | Repeat A1–A6 with `s138_return_memo_2.pdf` (cheque **489063**, **Rs. 2,50,000/-**, **Account closed**), then with `s138_return_memo_4.txt` (cheque **120119**, **Rs. 21,50,000/-**, **Funds insufficient**) | Same behaviour. Amounts in crores/lakhs grouped the Indian way (21,50,000) | ☐ | |

## B. Other documents (each from "I will type them in")

Look at: are the questions the ones you would ask? Is any wording wrong for Indian practice? Is anything missing that you always need?

| # | Document | You should see | OK? | Notes |
|---|---|---|---|---|
| B1 | Bail application (regular) | A choice of section (BNSS 483 / 480, CrPC 439 / 437). Grounds you type become numbered paragraphs. Nothing added by us | ☐ | |
| B2 | Affidavit | Verification block, deponent signature | ☐ | |
| B3 | Legal notice (general), Reply to a legal notice | Your facts, one per line, become numbered paragraphs | ☐ | |
| B4 | NDA (mutual), Rent agreement | A rent agreement of 24 months shows a note that a lease over one year must be registered | ☐ | |
| B5 | Sale deed, Vakalatnama, Plaint (skeleton) | Plaint prayer is lettered (a), (b), (c) | ☐ | |
| B6 | For every document: the small grey note "The fixed wording … has not yet been checked by a practising advocate" | Please check that wording and tell us what to change | ☐ | |

## C. Draft from a case

| # | Do this | You should see | OK? | Notes |
|---|---|---|---|---|
| C1 | In **Practice**, add a client "M/s Sundaram Agencies" and a case with opposite party "M/s Kumar Traders Pvt Ltd" | The case is saved | ☐ | |
| C2 | Draft → cheque bounce notice → **From one of my cases** → choose it | "Filled 2 details from this case": your client and the drawer. Nothing else is guessed | ☐ | |

## D. Analyze a contract

| # | Do this | You should see | OK? | Notes |
|---|---|---|---|---|
| D1 | Start → **Analyze a contract** → upload `commercial_contract_40pages.docx` → **Begin analysis** | Progress, then flagged clauses. Each flagged clause **quotes text that is really in the contract** (use Ctrl+F in the document to confirm). Tabs: Missing clauses, Key dates (1 August 2026, 90 days, 3 years) | ☐ | |
| D2 | Click **Draft an amendment** on a flagged clause | The amendment form opens with the clause number and the existing wording filled in; the new wording is marked "Please check" because it is a suggestion | ☐ | |
| D3 | Upload `scanned_contract.pdf` | A plain message that it is a scanned image, and what to do instead | ☐ | |
| D4 | Upload `password_protected.pdf`, `old_word_renamed.docx`, `macro_enabled.docx`, `empty.pdf`, `fake_pdf.pdf` | A plain message for each (password-protected, not a real Word file, contains macros, empty, not a real PDF). No error codes or technical words | ☐ | |
| D5 | Upload `messy_tables_1.docx` | The payment schedule in the table appears in the text | ☐ | |
| D6 | If the AI is unavailable the screen must say **nothing was checked**, never "no risks found" | (Only if you see this: tell us what it said) | ☐ | |

## E. Check conflicts

| # | Do this | You should see | OK? | Notes |
|---|---|---|---|---|
| E1 | With an empty Practice, check any name | "Nothing to check against… This is not a clearance" and a button to add your clients | ☐ | |
| E2 | With the client and case from C1: "Who wants to hire you?" = `Kumar Traders` | **Possible conflict**: you act against M/s Kumar Traders Pvt Ltd in that matter, with a link to it | ☐ | |
| E3 | "Who is on the other side?" = `Sundharam Agencies` (a different spelling) | A conflict, because it sounds like your client Sundaram Agencies | ☐ | |
| E4 | `R. Gupta` against a case that has opposite party `Ramesh Gupta` | A "please check" (initial plus surname) | ☐ | |
| E5 | A name that is nowhere in your records | **No match found**, saying how many clients and cases were searched | ☐ | |
| E6 | **Save a record of this check** | A Word record with the date, names, result and limits | ☐ | |

## F. Things that go wrong

| # | Do this | You should see | OK? | Notes |
|---|---|---|---|---|
| F1 | Refresh the page in the middle of a draft | Nothing lost | ☐ | |
| F2 | Open the same draft in two tabs and change it in one | The other tab says "This draft was changed in another tab" | ☐ | |
| F3 | Turn off the internet while typing | An "offline" bar; what you typed stays on screen and saves when you are back | ☐ | |
| F4 | Leave the page idle until the session ends, keep typing | A message that the session ended; after signing in again, **Restore it** brings back your typing | ☐ | |
| F5 | Use a phone (or a 375 px wide window) for A1–A9 | Everything reachable with a thumb, no sideways scrolling, buttons easy to tap | ☐ | |
| F6 | Try the dark theme on the draft preview | The paper stays white with dark text | ☐ | |
| F7 | Paste a very long text into any field | It is cut to the field's limit and still saves | ☐ | |

## G. Your overall view

1. How long did task A take, start to finish? ______ minutes
2. Would you send the Word notice from A8 after your own review? ☐ Yes ☐ With changes (list them) ☐ No
3. Which question or label made you stop and think? ____________________
4. What would you ask for next? ____________________
