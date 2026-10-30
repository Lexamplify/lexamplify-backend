"""Upload checks on the five routes that used to read uploaded files with no real checks (Step 7, batch 2a):
  POST /api/ai/extract-file, POST /api/upload-case, POST /api/vc/simulate,
  POST /api/conflict/analyze and its twin POST /api/conflict-engine/analyze.

Hostile files must get a 4xx with a plain message (never a 5xx) in under 5 seconds; valid files must still work.
The app is built once per module through tests/helpers_app.make_app. The LLM is stubbed (and the API keys are blank),
files are built in memory, nothing touches the network.

Test names containing "cheap" are the quick cases that can also be run against the unfixed routes."""
import io
import json
import re
import time

import pytest

from tests.helpers_app import make_app, register
from tests.test_upload_guard_strict import (DOCX_FIXTURES, STYLES_CT, doc_xml, docx_typed, linked_docx, para, pdf_owner_only, pdf_password, pdf_scanned,
                                            pdf_with_text, random_xml, realistic_300_docx, tiny_part, varied_xml, zip_docx)

LEAK = re.compile(r"Traceback|File \"|\.py\"|\.py\b|sqlite|psycopg|sqlalchemy|SELECT |INSERT |/Users/|C:\\\\|E:\\\\|secret_client|word/|Exception", re.I)
STRICT = ["extract", "upload", "vc"]
CONFLICT = ["conflict", "conflict_engine"]
ALL = STRICT + CONFLICT
URLS = {"extract": "/api/ai/extract-file", "upload": "/api/upload-case", "vc": "/api/vc/simulate",
        "conflict": "/api/conflict/analyze", "conflict_engine": "/api/conflict-engine/analyze"}
SECOND_DOC = b"Second agreement.\nPayment shall be made within 15 days.\nCourts at Delhi have exclusive jurisdiction.\n" * 3
THIRD_DOC = b"Third agreement.\nNotice period is 30 days.\nCourts at Mumbai have exclusive jurisdiction.\n" * 3
TIMINGS = []


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    flask_app = make_app(tmp_path_factory.mktemp("upload_hardening"), mp)
    c = register(flask_app, "uploads@example.com")
    import routes.argument_routes as arg
    import routes.conflict_routes as conf
    mp.setattr(conf, "ask_groq", lambda *a, **k: "", raising=True)                                   # no LLM: the rule-based comparator answers
    reply = json.dumps({"argument": "<p>Argument</p>", "objections": "<ul><li>O</li></ul>", "rebuttals": "<ul><li>R</li></ul>"})
    mp.setattr(arg, "ask_llm", lambda prompt, max_tokens=None: reply, raising=True)
    yield c
    mp.undo()


def send(client, route, name, data, strategy="Balanced"):
    ct = "multipart/form-data"
    if route in ("extract", "upload"):
        return client.post(URLS[route], data={"file": (io.BytesIO(data), name)}, content_type=ct)
    if route == "vc":
        return client.post(URLS[route], data={"file": (io.BytesIO(data), name), "strategy": strategy}, content_type=ct)
    return client.post(URLS[route], data={"doc1": (io.BytesIO(data), name), "label1": "First", "doc2": (io.BytesIO(SECOND_DOC), "second.txt"), "label2": "Second"}, content_type=ct)


def timed(label, fn):
    t = time.perf_counter()
    r = fn()
    dt = time.perf_counter() - t
    TIMINGS.append((label, dt, r.status_code))
    print(f"\nTIMING {label}: {dt:.2f}s -> {r.status_code}")
    return r, dt


def rejected(resp, dt, status, code, route):
    body = resp.get_data(as_text=True)
    j = resp.get_json()
    assert resp.status_code == status, (resp.status_code, body[:300])
    assert j["code"] == code, j
    assert isinstance(j["error"], str) and j["error"], j
    if route in CONFLICT:
        assert j["message"] == j["error"], j                                                         # D6: message and code next to error
    assert not LEAK.search(body), body[:300]
    assert dt < 5, f"{dt:.1f}s"


# ── valid files still work (same answers as before the change) ──────────────────────────────────
def _real_docx():
    import docx
    d = docx.Document()
    d.add_paragraph("Agreement between Alpha Ltd and Beta Ltd. Governing law: courts at Mumbai.")
    t = d.add_table(rows=1, cols=2)
    t.rows[0].cells[0].text = "Fee"
    t.rows[0].cells[1].text = "Rs. 4,75,000"
    b = io.BytesIO()
    d.save(b)
    return b.getvalue()


@pytest.mark.parametrize("route", ALL)
@pytest.mark.parametrize("kind,name,make,needle", [
    ("pdf", "contract.pdf", lambda: pdf_with_text("Rent agreement between A and B. Courts at Delhi."), "Rent agreement"),
    ("docx", "contract.docx", _real_docx, "Alpha Ltd"),
    ("txt", "notes.txt", lambda: "Plain notice. भुगतान 30 दिनों में".encode(), "Plain notice"),
    ("md", "readme.md", lambda: b"# Heading\nA markdown note about payment.", "markdown note"),
    ("csv", "table.csv", lambda: b"party,amount\nAlpha,4000\n", "Alpha,4000"),
    ("html", "page.html", lambda: b"<p>An html note on termination.</p>", "html note"),
    ("owner-only-pdf", "court.pdf", pdf_owner_only, "owner password only"),
], ids=["pdf", "docx", "txt", "md", "csv", "html", "owner-only-pdf"])
def test_valid_control_files_are_accepted(client, route, kind, name, make, needle):
    r, dt = timed(f"valid {kind} on {route}", lambda: send(client, route, name, make()))
    assert r.status_code == 200, r.get_data(as_text=True)[:300]
    j = r.get_json()
    if route == "extract":
        assert needle in j["text"] and j["filename"] == name
    elif route == "upload":
        assert needle in j["text"]
    elif route == "vc":
        assert set(j) >= {"argument", "objections", "rebuttals"}
    else:
        assert j["status"] == "success" and needle in {d["name"]: d["text"] for d in j["documents"]}["First"]
        assert "unreadable_documents" not in j, kind                           # a readable file never gets the new field


def send3(client, route, name, data):
    """Conflict routes: the file under test plus TWO readable documents (so a scan among them is not below the minimum)."""
    return client.post(URLS[route], data={"doc1": (io.BytesIO(data), name), "label1": "First", "doc2": (io.BytesIO(SECOND_DOC), "second.txt"), "label2": "Second",
                                          "doc3": (io.BytesIO(THIRD_DOC), "third.txt"), "label3": "Third"}, content_type="multipart/form-data")


def not_enough(resp, route):
    j = resp.get_json()
    assert resp.status_code == 400, (resp.status_code, resp.get_data(as_text=True)[:300])
    assert j["code"] == "NOT_ENOUGH_READABLE_TEXT" and j["error"] == j["message"] and set(j) == {"error", "message", "code"}, j
    assert "readable text" in j["message"] and "scan" in j["message"]
    assert not LEAK.search(resp.get_data(as_text=True))
    return j


@pytest.mark.parametrize("route", STRICT)
def test_scanned_pdf_with_no_text_is_still_accepted_on_the_other_routes(client, route):
    """/api/ai/extract-file, /api/upload-case and /api/vc/simulate keep their behaviour for scans (not changed in this batch)."""
    r, dt = timed(f"scanned pdf on {route}", lambda: send(client, route, "scan.pdf", pdf_scanned()))
    if route == "vc":
        assert r.status_code == 200 or r.status_code == 400             # no text and no facts: the route's own 400, not a file refusal
        assert "code" not in (r.get_json() or {}) or r.get_json()["code"] not in ("NOT_A_PDF", "EXTRACTION_ERROR", "UNSAFE_ARCHIVE")
    else:
        assert r.status_code == 200, r.get_data(as_text=True)[:300]


@pytest.mark.parametrize("route", CONFLICT)
def test_scanned_pdf_among_enough_readable_documents_gets_the_placeholder(client, route):
    r, dt = timed(f"scanned pdf + 2 readable on {route}", lambda: send3(client, route, "scan.pdf", pdf_scanned()))
    j = r.get_json()
    assert r.status_code == 200 and j["unreadable_documents"] == ["First"]
    first = {d["name"]: d["text"] for d in j["documents"]}["First"]
    assert first == "Document: First\nOperative contractual terms and covenants for First."      # never the raw PDF bytes
    assert "%PDF" not in json.dumps(j)


def _docx_with_only_a_picture():
    import docx
    import fitz
    png = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 40, 40), False).tobytes("png")
    d = docx.Document()
    d.add_picture(io.BytesIO(png))
    b = io.BytesIO()
    d.save(b)
    return b.getvalue()


@pytest.mark.parametrize("route", CONFLICT)
@pytest.mark.parametrize("name,make", [("pictures.docx", _docx_with_only_a_picture), ("blank.txt", lambda: b"  \n\n \t \n"),
                                       ("restored.pdf", lambda: b"   \n   "), ("scan.pdf", pdf_scanned)],
                         ids=["word-with-only-a-picture", "whitespace-only-txt", "whitespace-only-under-pdf-name", "scanned-pdf"])
def test_documents_without_readable_text_use_the_placeholder_and_are_listed(client, route, name, make):
    """Two readable documents plus one without text: accepted, the placeholder is used, the document is listed."""
    r, dt = timed(f"unreadable {name} + 2 readable on {route}", lambda: send3(client, route, name, make()))
    j = r.get_json()
    assert r.status_code == 200 and j["unreadable_documents"] == ["First"], j
    docs = {d["name"]: d["text"] for d in j["documents"]}
    assert docs["First"] == "Document: First\nOperative contractual terms and covenants for First."
    assert docs["Second"].startswith("Second agreement") and docs["Third"].startswith("Third agreement")      # the readable ones are untouched
    assert dt < 5


@pytest.mark.parametrize("route", CONFLICT)
@pytest.mark.parametrize("name,make", [("pictures.docx", _docx_with_only_a_picture), ("blank.txt", lambda: b"  \n\n \t \n"),
                                       ("restored.pdf", lambda: b"   \n   "), ("scan.pdf", pdf_scanned)],
                         ids=["word-with-only-a-picture", "whitespace-only-txt", "whitespace-only-under-pdf-name", "scanned-pdf"])
def test_one_readable_and_one_unreadable_document_is_below_the_minimum_of_two(client, route, name, make):
    """File branch: the minimum is 2 documents (the old 400), so the number WITH readable text must be at least 2."""
    r, dt = timed(f"1 unreadable + 1 readable ({name}) on {route}", lambda: send(client, route, name, make()))
    j = not_enough(r, route)
    assert "1 of your 2 documents had no readable text" in j["message"] and "At least 2 documents" in j["message"]
    assert name not in j["message"] and "First" not in j["message"]


@pytest.mark.parametrize("route", CONFLICT)
def test_zero_readable_documents_is_always_refused_on_the_file_branch(client, route):
    ct = "multipart/form-data"
    one = client.post(URLS[route], data={"doc1": (io.BytesIO(pdf_scanned()), "scan.pdf"), "label1": "First"}, content_type=ct)
    j = not_enough(one, route)                                                                  # one scan alone (the old 400 would have said "at least 2")
    assert "none of your 1 document had readable text" in j["message"]
    two = client.post(URLS[route], data={"doc1": (io.BytesIO(pdf_scanned()), "a.pdf"), "label1": "A", "doc2": (io.BytesIO(pdf_scanned()), "b.pdf"), "label2": "B"}, content_type=ct)
    j = not_enough(two, route)
    assert "none of your 2 documents had readable text" in j["message"]
    blank = client.post(URLS[route], data={"doc1": (io.BytesIO(b" \n "), "x.txt"), "doc2": (io.BytesIO(b"\t"), "y.txt")}, content_type=ct)
    not_enough(blank, route)


@pytest.mark.parametrize("route", CONFLICT)
def test_json_branch_needs_two_readable_documents_and_never_zero(client, route):
    real = lambda n: {"name": n, "text": "Payment within 30 days. Courts at Delhi."}
    blank = lambda n: {"name": n, "text": "   \n "}
    j = not_enough(client.post(URLS[route], json={"documents": [real("Real"), blank("Blank one")]}), route)       # 1 readable of 2: below the minimum
    assert "1 of your 2 documents had no readable text" in j["message"] and "Blank one" not in j["message"] and "Real" not in j["message"]
    not_enough(client.post(URLS[route], json={"documents": [blank("Blank one")]}), route)                          # one blank alone
    not_enough(client.post(URLS[route], json={"documents": [blank("A"), blank("B")]}), route)                      # two blanks
    # an entry with no name at all is still ignored and not counted anywhere
    r = client.post(URLS[route], json={"documents": [real("Only one"), {"text": ""}]})
    assert r.status_code == 400 and set(r.get_json()) == {"error"}                                              # the old 400, untouched
    r = client.post(URLS[route], json={"documents": [blank("Blank one"), {"text": ""}]})
    not_enough(r, route)                                                                                         # 1 named blank, nothing readable
    # two readable + one blank: accepted, the blank one is listed
    j = client.post(URLS[route], json={"documents": [blank("Blank one"), real("Real"), real("Real two"), {"text": ""}]}).get_json()
    assert j["status"] == "success" and j["unreadable_documents"] == ["Blank one"]
    assert [d["name"] for d in j["documents"]] == ["Blank one", "Real", "Real two"]
    j = client.post(URLS[route], json={"documents": [{"name": "A", "text": "Payment within 30 days."}, {"name": "B", "text": "Courts at Delhi."}]}).get_json()
    assert "unreadable_documents" not in j


def _pdf_with_hidden_keywords(chars=300000):
    """A valid PDF whose only page has no text, plus a big never-drawn string full of repeated keywords (in the document info)."""
    import fitz
    d = fitz.open()
    d.new_page()
    hidden = ("Payment within 30 days. Courts at Delhi. Arbitration seated at Mumbai. " * (chars // 60 + 1))[:chars]
    d.set_metadata({"title": hidden})
    b = d.tobytes()
    d.close()
    assert b"Payment within 30 days" in b and len(b) > chars                    # the dense single-line text really is in the raw bytes
    return b


@pytest.mark.parametrize("route", CONFLICT)
def test_hidden_keywords_in_a_pdf_with_no_page_text_never_reach_the_comparator(client, route, monkeypatch):
    import routes.conflict_routes as conf
    seen = {"comparator": [], "salient": []}
    real_cmp, real_sal = conf.detect_clause_conflicts_deterministic, conf.extract_salient_legal_clauses
    def spy_cmp(docs):
        seen["comparator"].append([len(d["text"]) for d in docs])
        return real_cmp(docs)
    def spy_sal(text, budget=2500):
        seen["salient"].append(len(text))
        return real_sal(text, budget=budget)
    monkeypatch.setattr(conf, "detect_clause_conflicts_deterministic", spy_cmp)
    monkeypatch.setattr(conf, "extract_salient_legal_clauses", spy_sal)
    data = _pdf_with_hidden_keywords()
    r, dt = timed(f"hidden-keyword pdf on {route}", lambda: send3(client, route, "hidden.pdf", data))
    j = r.get_json()
    assert r.status_code == 200 and j["unreadable_documents"] == ["First"] and dt < 5, (r.status_code, dt)
    assert seen["comparator"] and max(max(sizes) for sizes in seen["comparator"]) < 1000, seen      # only the stand-in text and the small second document
    assert max(seen["salient"]) < 1000, seen
    assert "Payment within 30 days" not in {d["name"]: d["text"] for d in j["documents"]}["First"]


@pytest.mark.parametrize("route", ALL)
@pytest.mark.parametrize("name", ["../../x.pdf", "a\x00b.pdf", ("n" * 296) + ".pdf", "C:\\secret_client\\a.pdf"], ids=["traversal", "nul", "300chars", "windows-path"])
def test_odd_file_names_on_a_valid_pdf(client, route, name):
    try:
        r, dt = timed(f"name {name[:12]!r} on {route}", lambda: send(client, route, name, pdf_with_text("Notice dated 5 May about rent.")))
    except (ValueError, TypeError) as e:                                 # the test client itself refuses a name it cannot put in a header
        pytest.skip(f"test client cannot send this name: {e}")
    assert r.status_code < 500, r.get_data(as_text=True)[:300]
    assert dt < 5


# ── hostile files: quick cases (can run against the unfixed routes) ─────────────────────────────
CHEAP = {
    "empty-pdf": ("a.pdf", b"", "EMPTY_FILE", 422),
    "empty-txt": ("a.txt", b"", "EMPTY_FILE", 422),
    "empty-docx": ("a.docx", b"", "EMPTY_FILE", 422),
}


@pytest.mark.parametrize("route", ALL)
@pytest.mark.parametrize("case", sorted(CHEAP))
def test_cheap_empty_files_are_refused(client, route, case):
    name, data, code, status = CHEAP[case]
    r, dt = timed(f"{case} on {route}", lambda: send(client, route, name, data))
    rejected(r, dt, status, code, route)


@pytest.mark.parametrize("route", STRICT)
def test_cheap_text_named_pdf_or_docx_is_refused_on_the_strict_routes(client, route):
    r, dt = timed(f"text-named-pdf on {route}", lambda: send(client, route, "fake.pdf", b"this is plain text pretending to be a pdf"))
    rejected(r, dt, 422, "NOT_A_PDF", route)
    r, dt = timed(f"text-named-docx on {route}", lambda: send(client, route, "fake.docx", b"not a zip at all, just words"))
    rejected(r, dt, 422, "NOT_A_DOCX", route)


@pytest.mark.parametrize("route", CONFLICT)
def test_cheap_text_under_a_pdf_or_docx_name_is_accepted_on_the_conflict_routes(client, route):
    """D4: the conflict page re-sends restored documents as plain text under their old .pdf/.docx names."""
    for name in ("restored.pdf", "restored.docx"):
        r, dt = timed(f"text-named-{name} on {route}", lambda: send(client, route, name, b"Restored text. Payment within 30 days. Courts at Mumbai."))
        assert r.status_code == 200, r.get_data(as_text=True)[:300]
        assert "Restored text" in {d["name"]: d["text"] for d in r.get_json()["documents"]}["First"]


@pytest.mark.parametrize("route", CONFLICT)
def test_cheap_conflict_still_refuses_what_is_not_clean_text(client, route):
    r, dt = timed(f"nul-bytes-named-pdf on {route}", lambda: send(client, route, "x.pdf", b"abc\x00def\x00" * 50))
    rejected(r, dt, 422, "NOT_A_PDF", route)
    r, dt = timed(f"pdf-header-fake on {route}", lambda: send(client, route, "x.pdf", b"%PDF-1.4 and then only words"))
    rejected(r, dt, 422, "NOT_A_PDF", route)
    r, dt = timed(f"pk-fake on {route}", lambda: send(client, route, "x.docx", b"PK and then only words"))
    rejected(r, dt, 422, "NOT_A_DOCX", route)


@pytest.mark.parametrize("route", ALL)
def test_cheap_macro_docx_is_refused(client, route):
    data = zip_docx(doc_xml(para(), 3), extra={"word/vbaProject.bin": b"\x00macro"})
    r, dt = timed(f"macro docx on {route}", lambda: send(client, route, "invoice.docx", data))
    rejected(r, dt, 422, "MACRO_DOCUMENT", route)


@pytest.mark.parametrize("route", ALL)
def test_cheap_password_pdf_is_refused_with_extraction_error(client, route):
    r, dt = timed(f"password pdf on {route}", lambda: send(client, route, "locked.pdf", pdf_password()))
    rejected(r, dt, 422, "EXTRACTION_ERROR", route)
    assert "password" in r.get_json()["error"].lower()


@pytest.mark.parametrize("route", CONFLICT)
def test_cheap_too_many_documents_in_a_json_body(client, route):
    docs = [{"name": f"d{i}", "text": "Payment within 30 days. Courts at Delhi."} for i in range(11)]
    r, dt = timed(f"11 json docs on {route}", lambda: client.post(URLS[route], json={"documents": docs}))
    rejected(r, dt, 413, "TOO_MANY_FILES", route)
    r, dt = timed(f"10 json docs on {route}", lambda: client.post(URLS[route], json={"documents": docs[:10]}))
    assert r.status_code == 200


@pytest.mark.parametrize("route", CONFLICT)
def test_cheap_too_many_files_whatever_the_field_names(client, route):
    parts = {f"name{i}": (io.BytesIO(b"A short agreement. Payment within 30 days."), f"f{i}.txt") for i in range(11)}
    r, dt = timed(f"11 odd-named files on {route}", lambda: client.post(URLS[route], data=parts, content_type="multipart/form-data"))
    rejected(r, dt, 413, "TOO_MANY_FILES", route)
    parts = {"documents": [(io.BytesIO(b"A short agreement. Payment within 30 days."), f"f{i}.txt") for i in range(11)]}
    r, dt = timed(f"11 files in one list on {route}", lambda: client.post(URLS[route], data=parts, content_type="multipart/form-data"))
    rejected(r, dt, 413, "TOO_MANY_FILES", route)


@pytest.mark.parametrize("route", CONFLICT)
def test_cheap_an_extra_file_hidden_behind_a_gap_in_the_slots_is_counted(client, route):
    parts = {f"doc{i}": (io.BytesIO(b"Agreement text. Payment within 30 days."), f"f{i}.txt") for i in range(2, 14)}      # no doc1: the handler would see none
    r, dt = timed(f"slot gap on {route}", lambda: client.post(URLS[route], data=parts, content_type="multipart/form-data"))
    rejected(r, dt, 413, "TOO_MANY_FILES", route)


@pytest.mark.parametrize("route", CONFLICT)
def test_json_text_over_600000_characters_is_refused_not_cut(client, route):
    docs = [{"name": "A", "text": "Payment within 30 days. " * 26100}, {"name": "B", "text": "Courts at Delhi."}]      # 600,300 characters
    assert len(docs[0]["text"]) > 600000
    r, dt = timed(f"json text over cap on {route}", lambda: client.post(URLS[route], json={"documents": docs}))
    rejected(r, dt, 413, "TOO_LARGE", route)
    assert "600,000" in r.get_json()["message"]


@pytest.mark.parametrize("route", CONFLICT)
def test_file_text_over_600000_characters_is_refused_not_cut(client, route):
    big = b"Payment within 30 days. " * 26100
    r, dt = timed(f"file text over cap on {route}", lambda: send(client, route, "big.txt", big))
    rejected(r, dt, 413, "TOO_LARGE", route)
    r, dt = timed(f"restored text over cap on {route}", lambda: send(client, route, "big.pdf", big))                  # D8 applies to D4 text too
    rejected(r, dt, 413, "TOO_LARGE", route)


@pytest.mark.parametrize("route", CONFLICT)
def test_pair_budget_refuses_too_much_text_to_compare_together_before_any_analysis(client, route, monkeypatch):
    """Limit lowered to 1,000 so the test is fast. Exactly at the limit is accepted, one over is refused."""
    from utils import upload_guard
    monkeypatch.setattr(upload_guard, "CONFLICT_MAX_PAIR_CHARS", 1000)
    def two(n):
        return [{"name": "A", "text": ("p" * 9 + "\n") * (n // 10)}, {"name": "B", "text": ("c" * 9 + "\n") * (n // 10)}]
    r, dt = timed(f"pair budget at the limit on {route}", lambda: client.post(URLS[route], json={"documents": two(500)}))
    assert r.status_code == 200                                                                  # 1 x (500 + 500) = 1,000
    r, dt = timed(f"pair budget one over on {route}", lambda: client.post(URLS[route], json={"documents": two(510)}))
    rejected(r, dt, 413, "TOO_LARGE", route)                                                     # 1 x 1,020
    assert "too much text to compare" in r.get_json()["message"]
    three = [{"name": f"D{i}", "text": ("c" * 9 + "\n") * 20} for i in range(3)]                # 2 x 600 = 1,200
    r, dt = timed(f"pair budget 3 docs on {route}", lambda: client.post(URLS[route], json={"documents": three}))
    rejected(r, dt, 413, "TOO_LARGE", route)


@pytest.mark.parametrize("route", CONFLICT)
def test_longest_line_rule_on_both_branches(client, route, monkeypatch):
    """Limit lowered to 50. Exactly 50 characters between newlines is accepted, 51 is refused, other separators do not help."""
    from utils import upload_guard
    monkeypatch.setattr(upload_guard, "CONFLICT_MAX_LINE_CHARS", 50)
    other = "Courts at Delhi.\n"
    def js(text):
        return client.post(URLS[route], json={"documents": [{"name": "A", "text": text}, {"name": "B", "text": other}]})
    r, dt = timed(f"line of 50 (json) on {route}", lambda: js("x" * 50 + "\nPayment within 30 days.\n"))
    assert r.status_code == 200
    r, dt = timed(f"line of 51 (json) on {route}", lambda: js("x" * 51 + "\nPayment within 30 days.\n"))
    rejected(r, dt, 413, "TOO_LARGE", route)
    assert "line break" in r.get_json()["message"]
    for sep, label in (("\r", "cr"), (" ", "ls"), (" ", "ps")):
        r, dt = timed(f"{label} separators (json) on {route}", lambda: js((("x" * 20) + sep) * 8))
        rejected(r, dt, 413, "TOO_LARGE", route)
    # file branch: an uploaded text file, and restored text under a .pdf name
    for name in ("long.txt", "restored.pdf"):
        r, dt = timed(f"line of 51 ({name}) on {route}", lambda: send(client, route, name, b"x" * 51 + b"\nPayment within 30 days.\n"))
        rejected(r, dt, 413, "TOO_LARGE", route)
        r, dt = timed(f"line of 50 ({name}) on {route}", lambda: send(client, route, name, b"x" * 50 + b"\nPayment within 30 days.\n"))
        assert r.status_code == 200
        r, dt = timed(f"cr separators ({name}) on {route}", lambda: send(client, route, name, (b"x" * 20 + b"\r") * 8))
        rejected(r, dt, 413, "TOO_LARGE", route)


@pytest.mark.parametrize("route", CONFLICT)
def test_conflict_rejections_keep_the_old_shape_and_add_message_and_code(client, route):
    r = client.post(URLS[route], json={"documents": [{"name": "only", "text": "one document"}]})
    assert r.status_code == 400 and set(r.get_json()) == {"error"}                  # the old 400 is untouched
    docs = [{"name": f"d{i}", "text": "x. " * 10} for i in range(11)]
    j = client.post(URLS[route], json={"documents": docs}).get_json()
    assert set(j) == {"error", "message", "code"} and j["error"] == j["message"]


@pytest.mark.parametrize("route", STRICT)
def test_strict_routes_keep_error_as_a_string_and_add_code(client, route):
    j = send(client, route, "a.pdf", b"").get_json()
    assert set(j) == {"error", "code"} and isinstance(j["error"], str)


def test_cheap_nothing_in_a_refusal_names_the_file(client):
    for route in ALL:
        r = send(client, route, "secret_client_names.docx", b"plain words only")
        body = r.get_data(as_text=True)
        if route in STRICT:
            assert r.status_code == 422 and "secret_client_names" not in body
        else:
            assert "secret_client_names" not in (json.dumps(r.get_json().get("error") or ""))


# ── hostile files: slow-before-the-fix cases (never run against the unfixed routes) ─────────────
@pytest.mark.parametrize("route", ALL)
def test_compressible_docx_bomb_is_refused_fast(client, route):
    data = zip_docx(doc_xml(para(), 210000))                      # 12 MB of xml in a tiny zip, ratio about 330
    assert len(data) < 100 * 1024
    r, dt = timed(f"12MB-xml docx bomb on {route}", lambda: send(client, route, "bomb.docx", data))
    rejected(r, dt, 422, "UNSAFE_ARCHIVE", route)


@pytest.mark.parametrize("route", ALL)
def test_docx_bomb_by_ratio_is_refused_fast(client, route):
    data = zip_docx(doc_xml(para(), 3), extra={"word/media/blob.bin": b"\x00" * (4 * 1024 * 1024)})
    r, dt = timed(f"ratio bomb on {route}", lambda: send(client, route, "bomb.docx", data))
    rejected(r, dt, 422, "UNSAFE_ARCHIVE", route)


@pytest.mark.parametrize("route", ALL)
def test_docx_with_another_xml_prefix_and_too_many_elements_is_refused_fast(client, route):
    data = zip_docx(varied_xml(15000, "x"), level=1)
    r, dt = timed(f"alt-prefix docx on {route}", lambda: send(client, route, "alt.docx", data))
    rejected(r, dt, 422, "UNSAFE_ARCHIVE", route)


@pytest.mark.parametrize("route", ALL)
def test_junk_pdf_of_one_megabyte_is_refused_fast(client, route):
    junk = b"%PDF-1.4\n" + b"\x00" * (1024 * 1024 - 9)
    r, dt = timed(f"1MB junk pdf on {route}", lambda: send(client, route, "junk.pdf", junk))
    rejected(r, dt, 422, "NOT_A_PDF", route)
    junk2 = b"%PDF-1.4\n" + (b"1 0 obj\n<< /Type /Catalog >>\nendobj\n" * 28000)
    r, dt = timed(f"1MB object-junk pdf on {route}", lambda: send(client, route, "junk.pdf", junk2))
    rejected(r, dt, 422, "NOT_A_PDF", route)


@pytest.mark.parametrize("route", ALL)
def test_oversize_file_is_refused_with_413(client, route, monkeypatch):
    from utils import upload_guard
    monkeypatch.setattr(upload_guard, "STRICT_MAX_BYTES", 20000)
    r, dt = timed(f"oversize on {route}", lambda: send(client, route, "big.txt", b"Plain words about payment. " * 1000))
    rejected(r, dt, 413, "TOO_LARGE", route)


@pytest.mark.parametrize("route", ALL)
def test_pdf_with_too_many_pages_is_refused(client, route, monkeypatch):
    from utils import upload_guard
    monkeypatch.setattr(upload_guard, "STRICT_MAX_PDF_PAGES", 2)
    r, dt = timed(f"3-page pdf over a 2-page limit on {route}", lambda: send(client, route, "long.pdf", pdf_with_text(pages=3)))
    rejected(r, dt, 413, "TOO_MANY_PAGES", route)
    r, dt = timed(f"2-page pdf on {route}", lambda: send(client, route, "ok.pdf", pdf_with_text(pages=2)))
    assert r.status_code == 200


@pytest.mark.parametrize("route", CONFLICT)
def test_total_upload_size_cap_on_conflict(client, route, monkeypatch):
    from utils import upload_guard
    monkeypatch.setattr(upload_guard, "CONFLICT_MAX_TOTAL_BYTES", 90 * 1024)
    line = b"Agreement text. Payment within 30 days.\n"
    parts = {f"doc{i}": (io.BytesIO(line * 600), f"f{i}.txt") for i in range(1, 5)}      # 4 x 24 KB
    r, dt = timed(f"total size over cap on {route}", lambda: client.post(URLS[route], data=parts, content_type="multipart/form-data"))
    rejected(r, dt, 413, "TOO_LARGE", route)
    parts = {f"doc{i}": (io.BytesIO(line * 600), f"f{i}.txt") for i in range(1, 4)}      # 3 x 24 KB
    r, dt = timed(f"total size under cap on {route}", lambda: client.post(URLS[route], data=parts, content_type="multipart/form-data"))
    assert r.status_code == 200


@pytest.mark.parametrize("route", CONFLICT)
def test_a_document_of_exactly_600000_characters_is_accepted(client, route):
    docs = [{"name": "A", "text": ("Lorem ipsum dolor sit amet, consectetur elit.\n" * 14000)[:600000]}, {"name": "B", "text": "Courts at Delhi."}]
    r, dt = timed(f"json text at cap on {route}", lambda: client.post(URLS[route], json={"documents": docs}))
    assert r.status_code == 200 and dt < 30


# ── D7: what an owner-password-only PDF and a password PDF do on each route ─────────────────────
@pytest.mark.parametrize("route", ALL)
def test_owner_password_only_pdf_is_accepted_and_read(client, route):
    r, dt = timed(f"owner-only pdf on {route}", lambda: send(client, route, "court.pdf", pdf_owner_only()))
    assert r.status_code == 200
    j = r.get_json()
    if route in ("extract", "upload"):
        assert "owner password only" in j["text"]
    elif route in CONFLICT:
        assert "owner password only" in {d["name"]: d["text"] for d in j["documents"]}["First"]


@pytest.mark.parametrize("route", ALL)
def test_realistic_300_page_contract_is_accepted_on_every_route(client, route):
    import docx
    d = docx.Document()
    for page in range(300):
        for k in range(8):
            p = d.add_paragraph()
            p.add_run(f"{k + 1}. ")
            p.add_run("The Company").bold = True
            p.add_run(" shall indemnify the Contractor against all losses arising from breach of this Agreement.")
    b = io.BytesIO()
    d.save(b)
    r, dt = timed(f"300-page docx on {route}", lambda: send(client, route, "big-contract.docx", b.getvalue()))
    assert r.status_code == 200, r.get_data(as_text=True)[:300]


# ── docx parts judged by content type: a big picture is fine, a big XML part is not, whatever the name ─────────────
def test_picture_heavy_docx_is_accepted_on_every_route(client):
    import os
    data = docx_typed({"word/media/photo.png": os.urandom(10 * 1024 * 1024)}, defaults={"png": "image/png"}, link=["word/media/photo.png"])
    for route in ALL:
        r, dt = timed(f"10MB picture docx on {route}", lambda: send(client, route, "stamp.docx", data))
        assert r.status_code == 200, (route, r.get_data(as_text=True)[:300])
        assert dt < 10


PART_CASES = {
    "xml-9mb": lambda: docx_typed({"word/styles.xml": random_xml(9)}, overrides={"word/styles.xml": STYLES_CT}),
    "png-name-but-xml-type": lambda: docx_typed({"word/media/x.png": random_xml(9)}, overrides={"word/media/x.png": STYLES_CT}, defaults={"png": "image/png"}),
    "no-content-type-for-part": lambda: docx_typed({"word/custom/x.dat": random_xml(9)}),
    "picture-ratio-over-200": lambda: docx_typed({"word/media/z.png": (b"\x00" * (6 * 1024 * 1024),)}, defaults={"png": "image/png"}),
    "no-content-types-file": lambda: docx_typed(content_types=False),
}


@pytest.mark.parametrize("route", ALL)
@pytest.mark.parametrize("case", sorted(PART_CASES))
def test_docx_part_rules_on_the_routes(client, route, case):
    data = PART_CASES[case]()
    r, dt = timed(f"{case} on {route}", lambda: send(client, route, "a.docx", data))
    rejected(r, dt, 422, "NOT_A_DOCX" if case == "no-content-types-file" else "UNSAFE_ARCHIVE", route)


# ── one element budget for ALL XML parts: bombs hidden in styles.xml or split over linked parts ─────────────────────────────────
@pytest.mark.parametrize("route", ALL)
def test_tiny_element_bomb_in_styles_xml_is_refused_and_python_docx_never_runs(client, route, monkeypatch):
    import docx
    monkeypatch.setattr(docx, "Document", lambda *a, **k: (_ for _ in ()).throw(AssertionError("python-docx must not run on a bomb")))
    data = linked_docx({"word/styles.xml": tiny_part("styles", 300000)})
    r, dt = timed(f"300k tiny elements in styles.xml on {route}", lambda: send(client, route, "bomb.docx", data))
    rejected(r, dt, 422, "UNSAFE_ARCHIVE", route)


@pytest.mark.parametrize("route", ALL)
def test_same_bomb_split_over_three_linked_parts_is_refused_and_python_docx_never_runs(client, route, monkeypatch):
    import docx
    monkeypatch.setattr(docx, "Document", lambda *a, **k: (_ for _ in ()).throw(AssertionError("python-docx must not run on a bomb")))
    data = linked_docx({"word/styles.xml": tiny_part("styles", 90000), "word/numbering.xml": tiny_part("numbering", 90000, 4),
                        "word/settings.xml": tiny_part("settings", 90000, 5)})
    r, dt = timed(f"3 x 90k tiny elements in linked parts on {route}", lambda: send(client, route, "split.docx", data))
    rejected(r, dt, 422, "UNSAFE_ARCHIVE", route)


@pytest.mark.parametrize("route", ALL)
def test_table_heavy_realistic_300_page_contract_is_accepted_on_every_route(client, route):
    r, dt = timed(f"table-heavy 300-page docx on {route}", lambda: send(client, route, "big-contract.docx", realistic_300_docx()))
    assert r.status_code == 200, r.get_data(as_text=True)[:300]
    if route in CONFLICT:
        assert "unreadable_documents" not in r.get_json()


@pytest.mark.parametrize("route", ALL)
def test_every_valid_docx_fixture_is_accepted_on_every_route(client, route):
    for path in DOCX_FIXTURES:
        r = send(client, route, path.name, path.read_bytes())
        assert r.status_code == 200, (route, path.name, r.get_data(as_text=True)[:300])
