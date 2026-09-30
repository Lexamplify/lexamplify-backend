#!/usr/bin/env python3
"""
scripts/make_sample_corpus.py - generate a realistic-looking set of Indian legal documents for
trying out (and load-testing) the Document Hub.

    python scripts/make_sample_corpus.py --out ./sample_docs --count 500
    python scripts/make_sample_corpus.py --out ./sample_docs --count 3000 --seed 7 --scans 20

Then drag the folder onto Document Hub > Import. Everything is invented: parties, case numbers and
facts are random; no real person or case is referenced.

A manifest.json is written next to the files with what each file really is (its class, case
number, page count). Tests use it to check the classifier; treat it with care - the documents are
written by the same people who wrote the classifier's rules, so agreement with the manifest shows
the pipeline is wired correctly, NOT how it will do on your firm's own paperwork.
"""
import argparse
import io
import json
import os
import random
import sys

FIRST = ["Rajesh", "Sunita", "Amit", "Priya", "Mohammed", "Lakshmi", "Vikram", "Anjali", "Suresh", "Kavita", "Imran", "Deepa", "Arjun", "Meera",
         "Harish", "Farhan", "Geeta", "Naveen", "Pooja", "Ramesh", "Shalini", "Karthik", "Nisha", "Sanjay", "Fatima", "Balaji", "Rekha", "Tarun"]
LAST = ["Kumar", "Sharma", "Reddy", "Iyer", "Khan", "Nair", "Singh", "Patel", "Das", "Gupta", "Menon", "Joshi", "Verma", "Chopra", "Pillai", "Bose",
        "Malhotra", "Rao", "Ansari", "Banerjee", "Kulkarni", "Mishra", "Thakur", "Saxena"]
COMPANIES = ["Alpha Traders Pvt. Ltd.", "Sundaram Constructions", "Bharat Textiles Ltd.", "Omkar Realty LLP", "Green Valley Foods", "Zenith Logistics Pvt. Ltd.",
             "Kaveri Agro Industries", "Metro Auto Finance Ltd.", "Himalaya Pharma Co.", "Blue Ocean Exports"]
STATES = ["State of Tamil Nadu", "State of Maharashtra", "Union of India", "State of Karnataka", "State of Uttar Pradesh", "State of Delhi (NCT)"]
COURTS = ["IN THE HIGH COURT OF DELHI AT NEW DELHI", "IN THE HIGH COURT OF JUDICATURE AT MADRAS", "IN THE HIGH COURT OF BOMBAY",
          "IN THE COURT OF THE DISTRICT AND SESSIONS JUDGE, PATIALA HOUSE COURTS", "IN THE COURT OF THE CIVIL JUDGE, SENIOR DIVISION, PUNE",
          "BEFORE THE DISTRICT CONSUMER DISPUTES REDRESSAL COMMISSION, CHENNAI"]
CASE_TYPES = ["W.P.(C)", "CRL.M.C.", "CS", "O.S.", "BAIL APPLN.", "C.M.A.", "ARB.P.", "MACP", "CRL.A.", "S.A."]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
FILLER = [
    "The petitioner has approached this Court seeking appropriate directions against the respondents for the reasons set out hereinafter.",
    "It is submitted that the impugned action is arbitrary, unreasonable and violative of the principles of natural justice.",
    "The facts giving rise to the present proceedings are briefly stated as under. The parties are governed by the terms recorded in writing.",
    "That the deponent has read the contents of the foregoing paragraphs and the same are true and correct to the best of his knowledge.",
    "The learned counsel for the respondent sought time to file a detailed reply and the request was not opposed.",
    "Reliance is placed on the documents annexed hereto and the settled position of law on the subject.",
    "The amount claimed is outstanding despite repeated reminders, and no part of the dues has been paid so far.",
    "Photocopies of the relevant correspondence, receipts and statements of account are enclosed for ready reference.",
    "Interim relief is sought as the balance of convenience lies in favour of the applicant and irreparable injury would otherwise ensue.",
    "The possession of the premises has been with the tenant since the inception of the tenancy and rent has been paid regularly until default.",
]


def person(r):
    return f"{r.choice(FIRST)} {r.choice(LAST)}"


def date_txt(r, year=None):
    d, m, y = r.randint(1, 28), r.randint(1, 12), year or r.choice([2022, 2023, 2024, 2025])
    return d, m, y


def paras(r, n):
    return "\n\n".join(r.choice(FILLER) + " " + r.choice(FILLER) for _ in range(n))


def caption(r):
    ct = r.choice(CASE_TYPES)
    num, yr = r.randint(1, 9000), r.choice([2021, 2022, 2023, 2024, 2025])
    a = person(r) if r.random() < .7 else r.choice(COMPANIES)
    b = r.choice(STATES) if r.random() < .5 else (person(r) if r.random() < .5 else r.choice(COMPANIES))
    return r.choice(COURTS), f"{ct} {num}/{yr}", a, b


def build(r, kind, pages):
    """-> (text, meta) for one document of a given class"""
    court, case_no, a, b = caption(r)
    d, m, y = date_txt(r)
    nd, nm, ny = date_txt(r, 2026)
    date = f"{d:02d}-{m:02d}-{y}"
    head = f"{court}\n{case_no}\n{a} ... Petitioner\nversus\n{b} ... Respondent\n"
    body = lambda n: paras(r, n)
    meta = {"class": None, "case_no": case_no, "parties": f"{a} vs {b}", "date": f"{y}-{m:02d}-{d:02d}"}
    if kind == "order":
        meta["class"] = "Court Order"
        t = head + f"ORDER\nDate: {date}\nHeard learned counsel for the parties. {r.choice(FILLER)}\nList on {nd:02d}.{nm:02d}.{ny} for further hearing.\n" + body(pages)
    elif kind == "judgment":
        meta["class"] = "Judgment"
        t = head + f"JUDGMENT\nJudgment delivered on {d} {MONTHS[m - 1]} {y}\n" + body(pages) + "\nIn the result, the petition is hereby allowed and the impugned order is set aside."
    elif kind == "petition":
        meta["class"] = "Petition / Plaint"
        t = f"{court}\n{a} ... Petitioner\nversus\n{b} ... Respondent\nWRIT PETITION UNDER ARTICLE 226 OF THE CONSTITUTION OF INDIA\nMost respectfully showeth:\n" + body(pages) + \
            "\nCause of action arose within the jurisdiction of this Hon'ble Court.\nIt is therefore most respectfully prayed that this Court may be pleased to allow the petition.\nPRAYER"
        meta["case_no"] = None
    elif kind == "notice":
        meta["class"] = "Legal Notice"
        t = f"LEGAL NOTICE\nRef: LN/{y}/{r.randint(1, 999):03d}\nDate: {date}\nUnder instructions from and on behalf of my client {r.choice(COMPANIES)}, I hereby call upon you to pay Rs. {r.randint(1, 90)},{r.randint(100, 999)},000 within 15 days of receipt of this notice failing which legal proceedings shall be initiated at your risk as to costs and consequences.\n" + body(pages) + "\nAdvocate"
        meta.update(case_no=None, parties=None)
    elif kind == "affidavit":
        meta["class"] = "Affidavit"
        t = f"AFFIDAVIT\nI, {person(r)}, aged {r.randint(25, 70)} years, resident of {r.randint(1, 99)} MG Road, do hereby solemnly affirm and state on oath as under:\n" + body(pages) + "\nDEPONENT\nVERIFICATION\nVerified at Chennai that the contents are true and correct."
        meta.update(case_no=None, parties=None, date=None)
    elif kind == "agreement":
        meta["class"] = "Agreement / Contract"
        t = f"SERVICE AGREEMENT\nThis Agreement is made on this {d}th day of {MONTHS[m - 1]} {y} between {r.choice(COMPANIES)} and {r.choice(COMPANIES)}.\nWHEREAS the parties wish to record their understanding. NOW THIS AGREEMENT WITNESSETH as follows:\n" + body(pages) + "\nGoverning law and jurisdiction of the courts at Chennai. The parties agree to indemnify each other. IN WITNESS WHEREOF the parties have signed."
        meta.update(case_no=None, parties=None)
    elif kind == "invoice":
        meta["class"] = "Invoice / Fee Note"
        t = f"TAX INVOICE\nInvoice No: INV-{y}-{r.randint(1, 9999):04d}\nGSTIN 33AAAAA0000A1Z5\nProfessional fees for legal services rendered\nTotal amount payable: Rs. {r.randint(5, 250)},000\nBank details for NEFT transfer."
        meta.update(case_no=None, parties=None, date=None)
    elif kind == "summons":
        meta["class"] = "Summons / Court Notice"
        t = f"{court}\nSUMMONS\n{case_no}\nYou are hereby directed to appear before this Court on {nd:02d}.{nm:02d}.{ny} at 10.30 AM.\n" + body(max(1, pages // 3))
        meta["parties"] = None
    else:
        meta["class"] = "Correspondence / Letter"
        t = f"Date: {date}\nSub: Status of the matter and next steps\nDear Sir,\nPlease find enclosed the papers referred to. Kindly acknowledge receipt.\n" + body(pages) + "\nYours faithfully,"
        meta.update(case_no=None, parties=None)
    return t, meta


KINDS = [("order", 24), ("judgment", 8), ("petition", 10), ("notice", 10), ("affidavit", 10), ("agreement", 9), ("invoice", 5), ("summons", 6), ("letter", 18)]


def _fitz():
    try:
        import pymupdf
        return pymupdf
    except ImportError:
        import fitz
        return fitz


def make_pdf(text, pages):
    fitz = _fitz()
    doc = fitz.open()
    chunks = [c for c in text.split("\n\n")]
    per = max(1, len(chunks) // max(1, pages))
    first = True
    for i in range(0, max(1, len(chunks)), per):
        pg = doc.new_page()
        pg.insert_textbox(fitz.Rect(56, 56, 540, 790), "\n\n".join(chunks[i:i + per]), fontsize=10)
        first = False
    b = doc.tobytes(deflate=True)
    doc.close()
    return b


def make_docx(text):
    import docx
    d = docx.Document()
    for line in text.split("\n"):
        d.add_paragraph(line)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def make_xlsx(r):
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Case register"
    ws.append(["Case No", "Party", "Court", "Next hearing"])
    for _ in range(r.randint(5, 40)):
        ct, num = r.choice(CASE_TYPES), r.randint(1, 9000)
        ws.append([f"{ct} {num}/{r.choice([2022, 2023, 2024])}", person(r), r.choice(COURTS)[12:40], f"2026-{r.randint(1, 12):02d}-{r.randint(1, 28):02d}"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def make_scan(text):
    fitz = _fitz()
    src = fitz.open()
    pg = src.new_page()
    pg.insert_textbox(fitz.Rect(56, 56, 540, 790), text[:1800], fontsize=12)
    pix = pg.get_pixmap(dpi=150)
    out = fitz.open()
    p = out.new_page(width=pg.rect.width, height=pg.rect.height)
    p.insert_image(p.rect, stream=pix.tobytes("png"))
    return out.tobytes(deflate=True, garbage=3)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--count", type=int, default=200)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--scans", type=int, default=0, help="how many image-only (scanned) PDFs to include; they need OCR to read")
    ap.add_argument("--dup-rate", type=float, default=0.03)
    ap.add_argument("--max-pages", type=int, default=40)
    a = ap.parse_args(argv)
    r = random.Random(a.seed)
    os.makedirs(a.out, exist_ok=True)
    kinds = [k for k, w in KINDS for _ in range(w)]
    manifest, written = [], []
    for i in range(a.count):
        kind = r.choice(kinds)
        pages = r.choice([1, 1, 1, 2, 2, 3, 4, 6, 8, 12, 20, a.max_pages]) if kind in ("judgment", "petition", "agreement", "order") else r.choice([1, 1, 2, 3])
        text, meta = build(r, kind, pages)
        roll = r.random()
        if r.random() < 0.02:
            ext, data, npages = "xlsx", make_xlsx(r), 1
            meta = {"class": None, "case_no": None, "parties": None, "date": None, "spreadsheet": True}
            kind = "register"
        elif roll < 0.45:
            ext, data, npages = "pdf", make_pdf(text, pages), pages
        elif roll < 0.82:
            ext, data, npages = "docx", make_docx(text), 1
        else:
            ext, data, npages = "txt", text.encode(), 1
        generic = r.random() < 0.35
        stem = f"scan{r.randint(1, 9999):04d}" if generic else f"{(meta['class'] or 'Register').split(' / ')[0].replace(' ', '_')}_{i:05d}"
        sub = os.path.join(a.out, r.choice(["Client A", "Client B", "Matters 2023", "Matters 2024", "Inbox"]))
        os.makedirs(sub, exist_ok=True)
        name = f"{stem}.{ext}"
        if os.path.exists(os.path.join(sub, name)):          # random scanner names can collide - never overwrite
            name = f"{stem}-{i}.{ext}"
        with open(os.path.join(sub, name), "wb") as fh:
            fh.write(data)
        written.append((sub, name, data))
        manifest.append({"file": os.path.relpath(os.path.join(sub, name), a.out), "ext": ext, **meta, "pages": npages})
    for i in range(int(a.count * a.dup_rate)):                       # exact duplicates under different names
        sub, name, data = r.choice(written)
        dst = os.path.join(a.out, "Inbox")
        os.makedirs(dst, exist_ok=True)
        dup = f"copy_of_{i}_{name}"
        with open(os.path.join(dst, dup), "wb") as fh:
            fh.write(data)
        manifest.append({"file": os.path.relpath(os.path.join(dst, dup), a.out), "duplicate_of": name})
    for i in range(a.scans):
        kind = r.choice(["order", "affidavit", "notice"])
        text, meta = build(r, kind, 1)
        p = os.path.join(a.out, "Scans")
        os.makedirs(p, exist_ok=True)
        fn = f"scanned_{i:03d}.pdf"
        with open(os.path.join(p, fn), "wb") as fh:
            fh.write(make_scan(text))
        manifest.append({"file": os.path.relpath(os.path.join(p, fn), a.out), "ext": "pdf", "scanned": True, **meta, "pages": 1})
    p = os.path.join(a.out, "Inbox")
    os.makedirs(p, exist_ok=True)
    open(os.path.join(p, "damaged.pdf"), "wb").write(b"%PDF-1.4\n" + os.urandom(400))
    manifest.append({"file": "Inbox/damaged.pdf", "expect": "failed"})
    with open(os.path.join(a.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print(f"wrote {len(manifest)} files to {a.out}")


if __name__ == "__main__":
    main()
