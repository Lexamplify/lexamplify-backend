"""POST /api/documents/inline-edit — the /editor BubbleMenu "AI Rewrite".

The one AI endpoint the WordCraft editor calls, driven through the REAL Flask
app (routes/document_routes.py:inline_edit). The AI is replaced by a
deterministic stand-in — no real network, no real key — the same posture as
tests/test_corpus.py.

What the handler actually does (tested as written, not as hoped):
  - requires both `selectedText` (alias `selected_text`) and `instruction`,
    each .strip()-ed; a missing/blank one is a 400 {error:True, message:...}
  - calls ask_groq(system_prompt, user_msg) and passes the raw reply through
    _clean_inline_html, which strips a ```html/``` code fence and a pair of
    wrapping quotes (and nothing else — it does NOT strip <p>/<div> tags; the
    inline-only shape is the model's job, enforced only by the system prompt),
    then returns {status:"success", html:<cleaned>} with 200
  - an empty reply, an empty-after-cleanup reply, or any ask_groq exception is
    a 500; the handler's own {error:True, message:"AI inline rewrite failed..."}
    body is then rewritten by app.py's after_request hook (any 5xx without a
    `code` becomes {error:True, code:"SERVER_ERROR", message:<generic>}), so
    that generic shape is what the caller actually receives
  - the route has no @jwt_required decorator, but app.py's global
    before_request gate still requires a valid session for every /api/ route
    (except /api/auth/* and /api/ping), so an anonymous caller gets 401 and a
    signed-in one reaches the handler
"""
import pytest

from tests.helpers_app import make_app, register


URL = "/api/documents/inline-edit"


@pytest.fixture
def ai(tmp_path, monkeypatch):
    """The real app, a signed-in client, and a handle to swap the stubbed
    model's reply per test.

    inline_edit uses `from utils.ai_helper import ask_groq`, so the name it
    calls lives in routes.document_routes — that is the binding we patch."""
    flask_app = make_app(tmp_path, monkeypatch)
    import routes.document_routes as dr

    box = {"reply": "<strong>the rewritten clause</strong>"}
    seen = {}

    def fake_ask_groq(system_prompt, user_msg, *args, **kwargs):
        seen["system_prompt"] = system_prompt
        seen["user_msg"] = user_msg
        reply = box["reply"]
        if isinstance(reply, BaseException):
            raise reply
        if callable(reply):
            return reply(system_prompt, user_msg)
        return reply

    monkeypatch.setattr(dr, "ask_groq", fake_ask_groq)
    client = register(flask_app, "editor@example.com")
    return {"app": flask_app, "client": client, "box": box, "seen": seen}


# ── validation (400) ────────────────────────────────────────────────────────
def test_missing_instruction_is_400(ai):
    r = ai["client"].post(URL, json={"selectedText": "The Lessee shall pay the rent."})
    assert r.status_code == 400, r.get_data(as_text=True)
    body = r.get_json()
    assert body["error"] is True and "required" in body["message"].lower()


def test_missing_selected_text_is_400(ai):
    r = ai["client"].post(URL, json={"instruction": "make this more formal"})
    assert r.status_code == 400
    assert r.get_json()["error"] is True


def test_empty_body_is_400(ai):
    r = ai["client"].post(URL, json={})
    assert r.status_code == 400
    assert r.get_json()["error"] is True


def test_whitespace_only_fields_are_400(ai):
    """.strip() reduces a blank field to empty, so this is the same 400 path."""
    r = ai["client"].post(URL, json={"selectedText": "   ", "instruction": "\n\t "})
    assert r.status_code == 400
    assert r.get_json()["error"] is True


def test_validation_never_calls_the_model(ai):
    ai["client"].post(URL, json={"selectedText": "ABC Pvt Ltd"})  # no instruction
    assert ai["seen"] == {}  # ask_groq was not reached


# ── success (200) ─────────────────────────────────────────────────────────────
def test_success_shape_and_inline_only(ai):
    ai["box"]["reply"] = "<strong>the Lessee shall remit the rent in advance</strong>"
    r = ai["client"].post(URL, json={"selectedText": "the Lessee pays rent",
                                     "instruction": "make this more formal"})
    assert r.status_code == 200, r.get_data(as_text=True)
    body = r.get_json()
    # exact success keys from the handler
    assert body["status"] == "success"
    assert set(body) == {"status", "html"}
    html = body["html"]
    assert html == "<strong>the Lessee shall remit the rent in advance</strong>"
    # inline-only: no block wrappers and no code fences
    assert "```" not in html
    for tag in ("<p", "<div", "<body", "<html"):
        assert tag not in html.lower()


def test_code_fence_is_stripped(ai):
    """_clean_inline_html removes a ```html / ``` fence the model adds anyway."""
    ai["box"]["reply"] = "```html\n<em>the Lessee shall indemnify ABC Pvt Ltd</em>\n```"
    r = ai["client"].post(URL, json={"selectedText": "the Lessee indemnifies ABC Pvt Ltd",
                                     "instruction": "tighten this clause"})
    assert r.status_code == 200
    html = r.get_json()["html"]
    assert "```" not in html
    assert html == "<em>the Lessee shall indemnify ABC Pvt Ltd</em>"


def test_wrapping_quotes_are_stripped(ai):
    ai["box"]["reply"] = '"the Lessee shall pay on demand"'
    r = ai["client"].post(URL, json={"selectedText": "the Lessee pays on demand",
                                     "instruction": "rephrase"})
    assert r.status_code == 200
    html = r.get_json()["html"]
    assert html == "the Lessee shall pay on demand"
    assert not (html.startswith('"') and html.endswith('"'))


def test_plain_text_passthrough(ai):
    """Rule 3 of the prompt: no formatting needed -> plain text, no tags."""
    ai["box"]["reply"] = "the Lessor and the Lessee"
    r = ai["client"].post(URL, json={"selectedText": "landlord and tenant",
                                     "instruction": "use the deed's defined terms"})
    assert r.status_code == 200
    assert r.get_json()["html"] == "the Lessor and the Lessee"


def test_selected_text_snake_case_alias(ai):
    """The handler accepts `selected_text` as well as `selectedText`."""
    ai["box"]["reply"] = "<u>ABC Pvt Ltd</u>"
    r = ai["client"].post(URL, json={"selected_text": "the Company",
                                     "instruction": "name the party"})
    assert r.status_code == 200
    assert r.get_json()["html"] == "<u>ABC Pvt Ltd</u>"


def test_selection_and_instruction_reach_the_model(ai):
    ai["client"].post(URL, json={"selectedText": "the Lessee shall pay",
                                 "instruction": "make this more formal"})
    # both the selection and the instruction are handed to the model verbatim
    assert "the Lessee shall pay" in ai["seen"]["user_msg"]
    assert "make this more formal" in ai["seen"]["user_msg"]


# ── failure (500) ─────────────────────────────────────────────────────────────
def test_empty_rewrite_is_500(ai):
    ai["box"]["reply"] = ""
    r = ai["client"].post(URL, json={"selectedText": "the Lessee", "instruction": "rephrase"})
    assert r.status_code == 500
    body = r.get_json()
    # the after_request hook rewrites the handler's 500 body to the generic one
    assert body["error"] is True and body["code"] == "SERVER_ERROR"


def test_fence_only_rewrite_is_500(ai):
    """A reply that is empty AFTER _clean_inline_html is still a 500."""
    ai["box"]["reply"] = "```html\n\n```"
    r = ai["client"].post(URL, json={"selectedText": "the Lessee", "instruction": "rephrase"})
    assert r.status_code == 500
    assert r.get_json()["code"] == "SERVER_ERROR"


def test_model_exception_is_500(ai):
    ai["box"]["reply"] = RuntimeError("provider exhausted all fallbacks")
    r = ai["client"].post(URL, json={"selectedText": "the Lessee", "instruction": "rephrase"})
    assert r.status_code == 500
    assert r.get_json()["code"] == "SERVER_ERROR"


# ── auth / method ─────────────────────────────────────────────────────────────
def test_anonymous_caller_is_401(ai):
    """No @jwt_required on the handler, but app.py's global before_request gate
    still requires a valid session for every /api/ route, so an anonymous
    client is turned away before the handler runs."""
    anon = ai["app"].test_client()  # no cookies, no token
    r = anon.post(URL, json={"selectedText": "x pays y", "instruction": "formalise"})
    assert r.status_code == 401
    assert r.get_json()["code"] == "AUTH_REQUIRED"


def test_signed_in_client_can_rewrite(ai):
    """A registered, cookie-bearing client (CSRF header included) reaches the
    handler and gets the success shape back."""
    ai["box"]["reply"] = "<strong>the Lessee shall pay the rent monthly in advance</strong>"
    r = ai["client"].post(URL, json={"selectedText": "tenant pays rent",
                                     "instruction": "make this more formal"})
    assert r.status_code == 200, r.get_data(as_text=True)
    assert r.get_json()["html"].startswith("<strong>")


def test_options_preflight_is_200(ai):
    """OPTIONS is exempt from the auth gate (CORS preflight)."""
    r = ai["app"].test_client().open(URL, method="OPTIONS")
    assert r.status_code == 200
