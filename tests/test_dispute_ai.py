"""Run:  python tests/test_dispute_ai.py   (or pytest). No network: the LLM is stubbed."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils import dispute_ai as da

CAT = da.load_catalog()
passed = 0


def check(name, cond, extra=""):
    global passed
    if not cond:
        print("FAIL:", name, extra)
        sys.exit(1)
    passed += 1
    print("ok  ", name)


# ── catalog sanity ──
check("catalog has >=100 disputes", len(CAT["disputes"]) >= 100)
check("ids unique", len({d["id"] for d in CAT["disputes"]}) == len(CAT["disputes"]))

# ── keyword matcher ──
def top(q):
    r = da.score_disputes(q)
    return r[0]["id"] if r else None
check("bounced cheque -> 138", top("my client's cheque bounced, need to file 138") in ("complaint-138-ni", "notice-cheque-138"), top("my client's cheque bounced, need to file 138"))
check("anticipatory bail", top("anticipatory bail apprehend arrest") == "bail-anticipatory", top("anticipatory bail apprehend arrest"))
check("mutual divorce", top("mutual consent divorce") == "divorce-mutual-hma", top("mutual consent divorce"))
check("rti", top("RTI application to PIO for records") == "rti-application", top("RTI application to PIO for records"))
check("gibberish -> none", da.score_disputes("zzzz qqqq") == [])

# ── guard ──
d = da.get_dispute("bail-anticipatory")
pairs, corpus = da.allowed_context(d)
src = da.digits_in(corpus) | da.digits_in("FIR 245 of 2025 Rs. 5,00,000")
g, fl = da.guard_text("The applicant seeks relief under Section 482 of the BNSS.", pairs, corpus, src)
check("known section untouched", "[verify" not in g and not fl, g)
g, fl = da.guard_text("Relief under Section 999 of the Imaginary Act.", pairs, corpus, src)
check("unknown section flagged", "[verify: not in library]" in g and fl[0]["type"] == "citation_not_in_library", g)
g, fl = da.guard_text("As held in Ram Kumar v. State of Delhi AIR 1999 SC 123, bail is a rule.", pairs, corpus, src)
check("case law removed", "Ram Kumar" not in g and "AIR 1999" not in g and any(f["type"] == "case_removed" for f in fl), g)
g, fl = da.guard_text("He paid Rs. 7,50,000 on 12 March.", pairs, corpus, src)
check("unsupplied figure flagged", "[verify: figure not in your facts]" in g, g)
g, fl = da.guard_text("The FIR number is 245 and the loss was Rs. 5,00,000.", pairs, corpus, src)
check("supplied figures pass", "[verify" not in g, g)
g, fl = da.guard_text("Sections 482 and 483 of the BNSS and Article 21 apply.", pairs, corpus, src)
expected = (0 if ("section", "483") in pairs else 1) + (0 if ("article", "21") in pairs else 1)
check("list: each unlisted number flagged individually", g.count("[verify: not in library]") == expected, g)
g, fl = da.guard_text("The application must be filed within 45 days.", pairs, corpus, src)
check("invented period flagged", "[verify: period not in library]" in g, g)
d138 = da.get_dispute("notice-cheque-138"); p2, c2 = da.allowed_context(d138)
g, fl = da.guard_text("The drawer has fifteen days from receipt, and notice must be given within thirty days.", p2, c2, da.digits_in(c2))
check("periods that are in the entry pass", "[verify" not in g, g)
g, fl = da.guard_text("Sections 482 and 111 of the BNSS.", pairs, corpus, src)
check("one bad in a list flagged once", g.count("[verify: not in library]") == 1, g)
check("clean_text strips html/markdown/numbering", da.clean_text("1. <b>**Hello**</b>\nworld") == "Hello world", da.clean_text("1. <b>**Hello**</b>\nworld"))

# ── validate_slots ──
try:
    da.validate_slots({"facts_narrative": "nope", "grounds": []}, d); ok = False
except ValueError:
    ok = True
check("bad shape rejected", ok)
v = da.validate_slots({"facts_narrative": ["<p>One.</p>", " "], "grounds": ["a"] * 30, "missing": ["x"]}, d)
check("slots cleaned/capped", v["facts_narrative"] == ["One."] and len(v["grounds"]) <= len(d["grounds"]) + 3, v)

# ── draft_slots with stub LLM ──
calls = []
def stub(system_prompt, user_msg, **kw):
    calls.append((system_prompt, user_msg, kw))
    return json.dumps({
        "facts_narrative": ["The applicant is a resident of Chennai. FIR No. 245 of 2025 was registered at Anna Nagar police station.",
                            "The applicant paid Rs. 9,99,999 to the complainant. See Sharma v. State AIR 2001 SC 55."],
        "grounds": ["Under Section 482 of the BNSS the applicant apprehends arrest. Section 420 of the IPC is invoked."],
        "missing": ["Date of the alleged offence"]})
da._llm = stub
facts = {"fir_no": "245 of 2025", "ps": "Anna Nagar", "offences": "cheating", "apprehension": "Police issued notice and threatened arrest", "bogus key!": "x"}
r = da.draft_slots("bail-anticipatory", facts, "keep it formal")
check("draft ok", r["ok"], r)
txt = json.dumps(r["slots"])
check("case law stripped from AI output", "Sharma" not in txt and "AIR 2001" not in txt, txt)
check("invented figure tagged", "[verify: figure not in your facts]" in txt, txt)
check("IPC 420 tagged (not in entry)", "[verify: not in library]" in txt, txt)
check("Section 482 not tagged", "Section 482 of the BNSS the" in txt or "Section 482 of the BNSS" in txt)
check("missing propagated", r["missing"] == ["Date of the alleged offence"])
check("prompt contains lawyer facts and no invalid key", "Anna Nagar" in calls[0][1] and "bogus" not in calls[0][1])
check("prompt forbids case law", "NO case law" in calls[0][0])
n = len(calls)
r = da.draft_slots("bail-anticipatory", {"fir_no": "1"})
check("too few facts -> no LLM call", (not r["ok"]) and r["error"] == "not_enough_facts" and len(calls) == n, r)
r = da.draft_slots("nope", facts)
check("unknown dispute", r["error"] == "unknown_dispute")

def bad_stub(*a, **k):
    return "I cannot do JSON, sorry"
da._llm = bad_stub
r = da.draft_slots("bail-anticipatory", facts)
check("garbage twice -> bad_model_output (skeleton unaffected)", r["error"] == "bad_model_output", r)
def boom(*a, **k):
    raise RuntimeError("rate limited")
da._llm = boom
r = da.draft_slots("bail-anticipatory", facts)
check("provider failure -> ai_unavailable", r["error"] == "ai_unavailable")

# ── ask ──
da._llm = lambda s, u, **k: "Anticipatory bail is under Section 482 BNSS. Also see Section 77 of the Foo Act. The limitation is 45 days."
r = da.ask_question("what section is anticipatory bail", "bail-anticipatory")
check("ask answers with guard", r["ok"] and "[verify: not in library]" in r["answer"] and "[verify: period not in library]" in r["answer"] and "bail-anticipatory" in r["grounded_on"], r)
check("ask empty", da.ask_question("")["error"] == "empty_question")
r = da.ask_question("zzzz qqqq xxxx")
check("no retrieval + no active -> refusal without LLM", r["refused"] and "not in the reference library" in r["answer"])

# ── match ──
da._llm = lambda s, u, **k: json.dumps({"matches": [{"id": "made-up-id", "why": "x"}, {"id": "bail-anticipatory", "why": "client fears arrest"}]})
r = da.match_matter("my client fears arrest in a cheating case and needs anticipatory bail")
check("match validates ids", r["source"] == "ai" and [m["id"] for m in r["matches"]] == ["bail-anticipatory"], r)
da._llm = lambda s, u, **k: "not json"
r = da.match_matter("my client fears arrest in a cheating case and needs anticipatory bail")
check("match falls back to keywords", r["source"] == "keywords" and r["matches"][0]["id"] == "bail-anticipatory", r)

# ── flask blueprint (auth required) ──
try:
    from flask import Flask
    from flask_jwt_extended import JWTManager, create_access_token
    from routes.dispute_routes import dispute_bp
    app = Flask(__name__); app.config["JWT_SECRET_KEY"] = "t"; app.config["JWT_TOKEN_LOCATION"] = ["headers"]
    JWTManager(app); app.register_blueprint(dispute_bp)
    c = app.test_client()
    check("catalog public", c.get("/api/disputes/catalog").status_code == 200)
    check("draft needs auth", c.post("/api/disputes/draft", json={}).status_code == 401)
    with app.app_context():
        tok = create_access_token(identity="1")
    h = {"Authorization": "Bearer " + tok}
    da._llm = stub
    rr = c.post("/api/disputes/draft", json={"dispute_id": "bail-anticipatory", "facts": facts}, headers=h)
    check("draft 200", rr.status_code == 200 and rr.get_json()["ok"], rr.get_json())
    rr = c.post("/api/disputes/draft", json={"dispute_id": "bail-anticipatory", "facts": {}}, headers=h)
    check("draft 422 without facts", rr.status_code == 422)
except ImportError as e:
    print("skip flask tests:", e)

print(f"\nALL {passed} CHECKS PASSED")
