"""The real-model evaluation for the inline AI rewrite (POST /api/documents/inline-edit).

    python scripts/eval_inline_edit.py                 # run every case, write docs/EVAL_INLINE_EDIT_REPORT.md
    python scripts/eval_inline_edit.py --only ie-01    # one case
    python scripts/eval_inline_edit.py --no-report     # do not write the report file
    python scripts/eval_inline_edit.py --stub          # ignore any key, force stub mode

This is the editor's BubbleMenu "AI Rewrite": the advocate selects a span inside a clause and
asks the model to reword it in place. The result replaces the selection directly, so the only
acceptable output is a small, inline-safe HTML fragment that reworks the SAME text without adding
facts.

The key is read from the environment at run time (`load_dotenv()` picks up the local .env, and the
Render dashboard value works the same way). The key is never printed, never written to the report
and never leaves this machine. **If no GROQ_API_KEY is set, the harness says so and runs in stub
mode**: a deterministic stand-in model echoes the selection back unchanged. A stub run measures
NOTHING about model quality - it only proves the harness, the real route and the scoring work. The
report says so on every table.

What is scored, for every case (the invariants an in-place rewrite must keep):

  markdown fences      the output must not contain a ``` code fence (the editor pastes raw HTML)
  block-level tags     no <p>/<div>/<body>/<html> wrapper - the span lives inside a paragraph
  invented figures     every number / amount / percentage in the output must be in the selection
  statutory terms      the Act / section names in the selection must survive the rewrite

Everything runs through the REAL Flask app (the real prompt, the real route, the real ask_groq
gateway and its _clean_inline_html) - only the provider call itself is swapped in stub mode, exactly
as scripts/eval_drafts.py does it.
"""
import argparse
import os
import re
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

# The key is read from the environment here, at run time. Nothing below ever prints it.
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except Exception:  # noqa: BLE001 - dotenv is optional; the environment alone is enough
    pass

REPORT_PATH = ROOT / "docs" / "EVAL_INLINE_EDIT_REPORT.md"
MODEL_LABEL = "groq/openai/gpt-oss-120b (with the app's fallbacks)"
URL = "/api/documents/inline-edit"


# ── the golden set ──────────────────────────────────────────────────────────────────────────────────
# Every selection is a short, obviously-synthetic span of an Indian legal clause. The parties are
# generic ("ABC Pvt Ltd", "the Lessee") so nothing here can be mistaken for real case data. Each case
# records the numbers the rewrite is allowed to use (they are all in the selection) and the statutory
# terms it must not drop.
CASES = [
    {
        "id": "ie-01",
        "instruction": "make this more formal",
        "selection": ("if the cheque for Rs. 4,75,000 bounces then ABC Pvt Ltd will be liable under "
                      "Section 138 of the Negotiable Instruments Act, 1881."),
        "must_keep": ["Section 138", "Negotiable Instruments Act, 1881", "Rs. 4,75,000"],
    },
    {
        "id": "ie-02",
        "instruction": "tighten this clause",
        "selection": ("the Lessee shall pay to the Lessor a sum of Rs. 45,000 every single month and this "
                      "obligation is governed by the Indian Contract Act, 1872."),
        "must_keep": ["Indian Contract Act, 1872", "Rs. 45,000", "Lessee", "Lessor"],
    },
    {
        "id": "ie-03",
        "instruction": "simplify this into plainer language without losing the legal effect",
        "selection": ("any dispute arising out of this agreement shall be referred to arbitration in "
                      "accordance with the Arbitration and Conciliation Act, 1996."),
        "must_keep": ["Arbitration and Conciliation Act, 1996", "arbitration"],
    },
    {
        "id": "ie-04",
        "instruction": "fix the grammar and make it read cleanly",
        "selection": ("the Buyer may seek specific performance of this sale deed as per the Specific "
                      "Relief Act, 1963 in respect of the property at Plot 7, ABC Nagar."),
        "must_keep": ["Specific Relief Act, 1963", "specific performance", "Plot 7"],
    },
    {
        "id": "ie-05",
        "instruction": "make this more concise",
        "selection": ("XYZ Services LLP shall pay interest at the rate of 18% per annum and shall comply "
                      "with the Information Technology Act, 2000 for all electronic records."),
        "must_keep": ["Information Technology Act, 2000", "18%"],
    },
    {
        "id": "ie-06",
        "instruction": "rewrite this in the active voice",
        "selection": ("the work created by the Contractor shall be owned by ABC Pvt Ltd and shall be "
                      "protected under the Copyright Act, 1957."),
        "must_keep": ["Copyright Act, 1957", "ABC Pvt Ltd"],
    },
    {
        "id": "ie-07",
        "instruction": "make the defined terms consistent and formal",
        "selection": ("the Licensee must protect the personal data of users and follow the Digital Personal "
                      "Data Protection Act, 2023 along with clause 9.2 of this agreement."),
        "must_keep": ["Digital Personal Data Protection Act, 2023", "Licensee", "clause 9.2"],
    },
    {
        "id": "ie-08",
        "instruction": "emphasise the deadline and keep the meaning",
        "selection": ("the Lessee shall remedy any breach within 30 days of written notice, failing which "
                      "the Lessor may terminate under the Transfer of Property Act, 1882."),
        "must_keep": ["Transfer of Property Act, 1882", "30 days", "Lessee", "Lessor"],
    },
]


# ── the app under test (mirrors scripts/eval_drafts.py build_app) ───────────────────────────────────
def build_app(real_model: bool):
    """The real Flask app, in a throw-away folder, with its own database. The developer's data is never touched."""
    work = tempfile.mkdtemp(prefix="lex_eval_ie_")
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(work, 'eval.db')}"
    os.environ["JWT_SECRET_KEY"] = "eval-only-secret-0123456789abcdef0123456789"
    os.environ["PHONE_OTP_REQUIRED"] = "false"
    os.environ["LEGACY_USER_MIGRATION"] = "off"
    os.environ["LPMS_SCHEDULER"] = "0"
    os.environ["MAX_CONTENT_LENGTH"] = str(100 * 1024 * 1024)
    os.environ.pop("FLASK_ENV", None)
    os.environ.pop("RENDER", None)
    for name in ("PINECONE_API_KEY", "PINECONE_HOST", "ZENROWS_API_KEY", "TAVILY_API_KEY", "OPENAI_API_KEY"):
        os.environ[name] = ""
    if real_model:
        os.environ["LLM_TPM_BUDGET"] = os.environ.get("LLM_TPM_BUDGET", "8000")
    else:
        # The stub costs nothing, so the shared allowance must not make the harness wait.
        os.environ["LLM_TPM_BUDGET"] = "1000000"
        os.environ["GROQ_API_KEY"] = "EVAL-STUB-NO-REAL-KEY"
    os.chdir(work)
    sys.path.insert(0, str(ROOT))
    import app as app_module
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    return flask_app, app_module


class SignedIn:
    """A browser-like client: the cookies persist and every write carries the CSRF header."""

    def __init__(self, client):
        self.c = client

    def _headers(self):
        ck = self.c.get_cookie("csrf_access_token")
        return {"X-CSRF-TOKEN": ck.value} if ck else {}

    def post(self, url, **kw):
        kw["headers"] = {**self._headers(), **kw.get("headers", {})}
        return self.c.post(url, **kw)

    def get(self, url, **kw):
        return self.c.get(url, **kw)


def sign_in(flask_app):
    # The /api/documents/inline-edit route carries no @jwt_required, but app.py's global
    # before_request gate requires a valid session for every /api/ route, so the harness signs in.
    client = flask_app.test_client()
    r = client.post("/api/auth/register", json={"email": "eval-ie@example.com", "password": "TestPass123!",
                                                "name": "Evaluation Advocate"})
    if r.status_code != 201:
        raise SystemExit(f"could not create the test account: {r.status_code} {r.get_data(as_text=True)[:200]}")
    return SignedIn(client)


# ── counting the model's work (mirrors scripts/eval_drafts.py) ──────────────────────────────────────
class Meter:
    """Wraps the provider call so the harness can report the real token use and the latency."""

    def __init__(self):
        self.calls = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.seconds = 0.0
        self.stub = False

    def reset(self):
        self.calls = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.seconds = 0.0

    @property
    def total_tokens(self):
        return self.prompt_tokens + self.completion_tokens


METER = Meter()


def install_meter(app_module, stub=None):
    """Patch the provider call: count the tokens and the time, and (in stub mode) answer with the stub."""
    import utils.ai_helper as ah

    real_completion = ah.completion

    def counting_completion(*args, **kwargs):
        t0 = time.time()
        if stub is not None:
            response = stub(*args, **kwargs)
        else:
            response = real_completion(*args, **kwargs)
        METER.seconds += time.time() - t0
        METER.calls += 1
        usage = getattr(response, "usage", None)
        METER.prompt_tokens += int(getattr(usage, "prompt_tokens", 0) or 0)
        METER.completion_tokens += int(getattr(usage, "completion_tokens", 0) or 0)
        return response

    ah.completion = counting_completion
    METER.stub = stub is not None


class _Msg:
    def __init__(self, content):
        self.content = content
        self.role = "assistant"


class _Choice:
    def __init__(self, content):
        self.message = _Msg(content)
        self.finish_reason = "stop"


class _Usage:
    def __init__(self, prompt=0, completion=0):
        self.prompt_tokens = prompt
        self.completion_tokens = completion
        self.total_tokens = prompt + completion


class _Response:
    def __init__(self, content, prompt=0, completion=0):
        self.choices = [_Choice(content)]
        self.usage = _Usage(prompt, completion)
        self.model = "stub"


_SELECTION_RE = re.compile(r"SELECTED TEXT:\n(.*?)\n\nINSTRUCTION:", re.DOTALL)


def stub_completion(*args, **kwargs):
    """A deterministic stand-in for the model.

    It behaves like a careful one: it echoes the selected span back unchanged - which invents no
    fact, drops no statutory term, adds no fence and adds no block tag. That is the upper bound of
    what the rewrite can do, and it lets the harness, the route and the scoring be checked without a
    key. It says NOTHING about how a real model behaves.
    """
    messages = kwargs.get("messages") or (args[1] if len(args) > 1 else [])
    user = ""
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "user":
            user = m.get("content") or ""
    match = _SELECTION_RE.search(user)
    selection = match.group(1).strip() if match else (user.strip() or "the clause")
    return _Response(selection, prompt=len(user) // 4, completion=len(selection) // 4)


# ── the scoring ──────────────────────────────────────────────────────────────────────────────────────
_FENCE_RE = re.compile(r"```")
_BLOCK_RE = re.compile(r"</?(?:p|div|body|html|h[1-6]|ul|ol|li|table)\b", re.IGNORECASE)
_NUM_RE = re.compile(r"\d[\d,]*(?:\.\d+)?%?")


def _norm_num(tok):
    return tok.replace(",", "").rstrip("%")


def _numbers(text):
    return {_norm_num(t) for t in _NUM_RE.findall(text or "")}


def score(case, html):
    """The invariants an in-place inline rewrite must keep. Returns (problems, detail)."""
    problems = []
    if _FENCE_RE.search(html):
        problems.append("a markdown code fence was left in the output")
    block = _BLOCK_RE.findall(html)
    if block:
        problems.append(f"a block-level tag was used: {block[0]}")
    # invented figures: every number in the output must be in the selection
    invented = sorted(_numbers(html) - _numbers(case["selection"]))
    for n in invented:
        problems.append(f"a figure not in the selection appeared in the output: {n}")
    # statutory terms the rewrite must not drop
    low = html.lower()
    dropped = [t for t in case["must_keep"] if t.lower() not in low]
    for t in dropped:
        problems.append(f"a term from the selection was dropped: {t!r}")
    return problems


# ── a single case through the real route ──────────────────────────────────────────────────────────────
def run_case(client, case):
    t0 = time.time()
    out = {"id": case["id"], "hard_failure": None, "html": "", "problems": []}
    r = client.post(URL, json={"selectedText": case["selection"], "instruction": case["instruction"]})
    if r.status_code != 200:
        out["hard_failure"] = f"the route returned {r.status_code}: {r.get_data(as_text=True)[:200]}"
        out["seconds"] = time.time() - t0
        return out
    body = r.get_json() or {}
    if body.get("status") != "success" or not isinstance(body.get("html"), str):
        out["hard_failure"] = f"unexpected success body: {str(body)[:200]}"
        out["seconds"] = time.time() - t0
        return out
    out["html"] = body["html"]
    out["problems"] = score(case, out["html"])
    out["seconds"] = time.time() - t0
    return out


# ── the run ────────────────────────────────────────────────────────────────────────────────────────
def main(argv=None):
    ap = argparse.ArgumentParser(description="Run the inline-rewrite evaluation over the golden set.")
    ap.add_argument("--only", action="append", help="run only the cases with this id (can be repeated)")
    ap.add_argument("--no-report", action="store_true", help="do not write docs/EVAL_INLINE_EDIT_REPORT.md")
    ap.add_argument("--stub", action="store_true", help="ignore the key and run in stub mode")
    args = ap.parse_args(argv)

    key = "" if args.stub else (os.environ.get("GROQ_API_KEY") or "").strip()
    real_model = bool(key)
    cases = [c for c in CASES if not args.only or c["id"] in set(args.only)]
    if not cases:
        print("no case matches --only")
        return 2

    print("LexAmplify inline-rewrite evaluation")
    print(f"  cases     : {len(cases)}")
    if real_model:
        print(f"  mode      : REAL MODEL ({MODEL_LABEL}) - the key is read from the environment and never printed")
    else:
        print("  mode      : STUB - no GROQ_API_KEY is set, so a deterministic stand-in model is used.")
        print("              The numbers below measure the harness, the route and the scoring only;")
        print("              they say NOTHING about how a real model behaves.")

    flask_app, app_module = build_app(real_model)
    install_meter(app_module, stub=None if real_model else stub_completion)
    client = sign_in(flask_app)

    rows = []
    for case in cases:
        METER.reset()
        res = run_case(client, case)
        res["tokens"] = METER.total_tokens
        res["calls"] = METER.calls
        rows.append(res)
        verdict = "FAIL" if (res["hard_failure"] or res["problems"]) else "ok"
        print(f"  {verdict:4} {case['id']:<8} {res.get('seconds', 0):>5.1f}s  "
              f"{res['tokens']:>6} tokens  problems={len(res['problems'])}"
              + (f"  [{res['hard_failure']}]" if res["hard_failure"] else ""))

    if not args.no_report:
        write_report(rows, real_model)
        print(f"\nreport written to {REPORT_PATH.relative_to(ROOT)}")
    # a non-zero exit when something actually failed, so CI can gate on it
    return 1 if any(r["hard_failure"] or r["problems"] for r in rows) and real_model else 0


# ── the report ─────────────────────────────────────────────────────────────────────────────────────
def write_report(rows, real_model):
    total_tokens = sum(r["tokens"] for r in rows)
    total_seconds = sum(r.get("seconds", 0) for r in rows)
    failed = [r for r in rows if r["hard_failure"] or r["problems"]]

    out = []
    out.append("# Evaluation report: the inline AI rewrite (`POST /api/documents/inline-edit`)\n")
    if real_model:
        out.append(f"Run against the real model ({MODEL_LABEL}) with the key read from the environment.\n"
                   "The key is not in this file, not in the output and not in the repository.\n")
    else:
        out.append("**STUB MODE.** No `GROQ_API_KEY` was set, so a deterministic stand-in model answered the\n"
                   "prompts (it echoes the selected span back unchanged). This run proves the harness, the real\n"
                   "route and the scoring work; it says **nothing** about how a real model behaves. Run it again\n"
                   "with the key set in the environment for that.\n")
    out.append(f"- cases: **{len(rows)}**")
    out.append(f"- hard failures (the route did not return a success body): "
               f"**{sum(1 for r in rows if r['hard_failure'])}**")
    out.append(f"- cases with an invariant broken: **{len(failed) - sum(1 for r in rows if r['hard_failure'])}**")
    out.append(f"- total time: **{total_seconds:.1f} s**")
    out.append(f"- tokens: **{total_tokens if real_model else 'not measured (stub mode)'}**\n")

    out.append("## What is scored\n")
    out.append("The inline rewrite replaces a selection directly inside a clause, so the output must be a small, "
               "inline-safe HTML fragment that reworks the *same* text. Each case checks four invariants:\n")
    out.append("- **markdown fences**: no ``` fence survived into the output (the editor pastes raw HTML).")
    out.append("- **block-level tags**: no `<p>`/`<div>`/`<body>`/`<html>` (or list/table/heading) wrapper - the span "
               "lives inside an existing paragraph.")
    out.append("- **invented figures**: every number, amount or percentage in the output is also in the selection. "
               "A figure that is not is an invented fact.")
    out.append("- **statutory terms**: the Act and section names in the selection survive the rewrite.\n")

    out.append("## Every case\n")
    out.append("| case | instruction | hard failure | invariants broken | seconds | tokens |")
    out.append("|---|---|---|---|---|---|")
    cases_by_id = {c["id"]: c for c in CASES}
    for r in rows:
        instr = cases_by_id.get(r["id"], {}).get("instruction", "")
        hard = "yes" if r["hard_failure"] else "no"
        out.append(f"| {r['id']} | {instr} | {hard} | {len(r['problems'])} | "
                   f"{r.get('seconds', 0):.1f} | {r['tokens'] if real_model else '-'} |")
    out.append("")

    out.append("## Failures, verbatim\n")
    if not failed:
        out.append("None: every case returned a clean inline fragment that kept all four invariants.\n")
    else:
        for r in failed:
            out.append(f"### {r['id']}\n")
            if r["hard_failure"]:
                out.append(f"- hard failure: {r['hard_failure']}")
            for p in r["problems"]:
                out.append(f"- {p}")
            if r["html"]:
                out.append("\nThe fragment the model returned:\n")
                out.append("```")
                out.append(r["html"][:1500])
                out.append("```\n")

    out.append("## Not verified by this run\n")
    out.append("- The legal quality of the wording: this run checks that the rewrite stays inline and invents no "
               "figures, not that a lawyer would approve the phrasing.")
    out.append("- The editor's own paste/undo behaviour and the BubbleMenu UI.")
    out.append("- In stub mode, anything about the real model: the stand-in echoes the selection, so every "
               "invariant passes by construction.")
    out.append("")
    REPORT_PATH.write_text("\n".join(out), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
