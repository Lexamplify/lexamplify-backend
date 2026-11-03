"""Regression tests for Auto-Draft Studio's workspace-awareness
pipeline (Chunk 1 of the Auto-Draft overhaul).

Why this file exists:
  User tested the AI assistant with 'Draft a 2-line opening addressed
  to our client. Use our client's full name and workspace address.'
  and got the right output: 'Dear Mr. Rohit Sharma, A-402, Vasant Vihar,
  New Delhi 110057, India'. Before Chunk 1 the AI returned a generic
  '[Client's Workspace Address]' placeholder.

  That round-trip has FIVE moving pieces:
    (1) utils/draft_engine/extract.py — model_extract() / extract()
        accept workspace_brief kwarg and prepend it to the system prompt
    (2) routes/draft_engine_routes.py — /extract route fetches
        build_workspace_context(current_workspace_id()) and passes it
    (3) routes/draft_engine_routes.py — /ai-edit route prepends the
        workspace brief to the edit system prompt
    (4) routes/draft_engine_routes.py — new /workspace-prefill endpoint
        returns the active client's details as a draft-fact dict
    (5) frontend/src/pages/Draft.jsx — fetches /workspace-prefill and
        seeds new drafts' facts with it

  If any one regresses, the AI goes back to writing '[Client Name]'
  placeholders instead of real client details. These tests lock each
  piece. Pure-Python / grep-the-source — no network, no LLM.
"""
import re


# ────────────────────────────────────────────────────────────────────
# Piece 1 — extract.py accepts workspace_brief and uses it in system prompt
# ────────────────────────────────────────────────────────────────────

def test_extract_module_accepts_workspace_brief_kwarg():
    """Both extract() and model_extract() must still accept the
    workspace_brief kwarg. A silent removal would compile fine but
    cause every /extract call to lose client context — AI goes back
    to guessing party-A details."""
    import inspect
    from utils.draft_engine import extract as ex
    sig = inspect.signature(ex.extract)
    assert "workspace_brief" in sig.parameters, (
        "extract.extract() no longer takes workspace_brief — AI "
        "extraction loses client identity"
    )
    sig_m = inspect.signature(ex.model_extract)
    assert "workspace_brief" in sig_m.parameters, (
        "extract.model_extract() no longer takes workspace_brief — "
        "even if the route passes it, the per-call model prompt won't"
    )


def test_model_extract_prepends_workspace_brief_to_system():
    """model_extract must put the workspace brief in the SYSTEM
    prompt — NOT the user doc. Previously tempting bug: inlining it
    into the document would make the quote-match verifier reject every
    workspace-sourced value because the quote isn't literally in the
    source document."""
    src = open("utils/draft_engine/extract.py", encoding="utf-8").read()
    # Grep the model_extract body — the key assembly line.
    assert "system_prompt" in src and "workspace_brief" in src, (
        "model_extract no longer assembles a workspace-brief-prefixed "
        "system prompt — AI goes back to generic extraction"
    )
    # Must be prepended to _MODEL_SYSTEM (not concatenated to the user
    # prompt which would false-reject values via quote verification).
    assert "_MODEL_SYSTEM" in src, "_MODEL_SYSTEM constant removed from extract.py"


# ────────────────────────────────────────────────────────────────────
# Piece 2 — /extract route fetches workspace context and passes it
# ────────────────────────────────────────────────────────────────────

def test_extract_route_pulls_workspace_context():
    """The /api/drafts/extract route must call build_workspace_context
    for the active workspace and pass workspace_brief to the extractor.
    Without this, AI extraction has no client identity to work from."""
    src = open("routes/draft_engine_routes.py", encoding="utf-8").read()
    # Must import both the scope helper and the context builder.
    assert "from utils.workspace_scope import current_workspace_id" in src, (
        "/extract no longer imports current_workspace_id — workspace "
        "selection is being ignored"
    )
    assert "from utils.workspace_context import build_workspace_context" in src, (
        "/extract no longer imports build_workspace_context — the AI "
        "has no way to know who our client is"
    )
    # Must thread workspace_brief into the extractor.
    assert "workspace_brief=" in src, (
        "/extract no longer passes workspace_brief to the extractor — "
        "even if the brief is built, the extractor never sees it"
    )
    # Response field so the frontend can diagnose if context was used.
    assert "workspace_context_used" in src, (
        "/extract response no longer includes workspace_context_used; "
        "silent regressions become invisible in the browser Network tab"
    )


# ────────────────────────────────────────────────────────────────────
# Piece 3 — /ai-edit route prepends workspace brief to system prompt
# ────────────────────────────────────────────────────────────────────

def test_ai_edit_prepends_workspace_brief():
    """The /api/drafts/ai-edit route must prepend the workspace brief
    to its system prompt. User's successful test proved this is the
    exact mechanism that made 'Draft a 2-line opening' return the real
    client name instead of a '[Client Name]' placeholder."""
    src = open("routes/draft_engine_routes.py", encoding="utf-8").read()
    # Isolate the ai_edit handler body so we only grep the right scope.
    body = src.split("def ai_edit")[-1].split("\n@drafts_bp.route")[0]
    assert "_wsctx" in body or "build_workspace_context" in body, (
        "/ai-edit no longer builds the workspace context — AI edits "
        "lose client identity and start returning '[Client Name]' "
        "placeholders again"
    )
    # Must mutate `sys` (the system prompt), not the user prompt.
    assert "sys = " in body and "+ sys" in body, (
        "/ai-edit workspace-brief prepend to `sys` is gone — context "
        "may be built but not actually used"
    )


# ────────────────────────────────────────────────────────────────────
# Piece 4 — /workspace-prefill endpoint exists and returns client dict
# ────────────────────────────────────────────────────────────────────

def test_workspace_prefill_endpoint_exists():
    """The /api/drafts/workspace-prefill endpoint must still be
    registered. The frontend fetches this on mount; its removal would
    make every new draft start empty with no client identity."""
    src = open("routes/draft_engine_routes.py", encoding="utf-8").read()
    assert '"/workspace-prefill"' in src, (
        "/workspace-prefill route is gone — frontend prefill fetch 404s"
    )
    assert "def workspace_prefill" in src, (
        "workspace_prefill handler function is gone"
    )


def test_workspace_prefill_maps_to_common_slot_ids():
    """The prefill dict uses slot IDs that templates reference —
    party_a_name, party_a_address, etc. If these keys are renamed
    silently, templates stop finding their prefilled values and the
    form fields look empty again."""
    src = open("routes/draft_engine_routes.py", encoding="utf-8").read()
    body = src.split("def workspace_prefill")[-1].split("\n@drafts_bp.route")[0]
    for slot in ("client_name", "party_a_name", "client_address", "party_a_address",
                 "client_email", "party_a_email", "client_phone", "party_a_phone"):
        assert f'"{slot}"' in body, (
            f"workspace_prefill no longer emits '{slot}' — any template "
            f"using that slot ID loses its prefill"
        )
    # firm_name is populated from the lpms_members join — critical for
    # letterhead rendering later.
    assert "firm_name" in body, "firm_name no longer in prefill dict"


def test_workspace_prefill_empty_without_workspace():
    """No active workspace must return {prefill: {}} with workspace_id:
    None — not an error. Zero-cost behaviour on the Start / Dashboard
    pages where no workspace is selected."""
    src = open("routes/draft_engine_routes.py", encoding="utf-8").read()
    body = src.split("def workspace_prefill")[-1].split("\n@drafts_bp.route")[0]
    # The 'wid is None' early return must stay.
    assert "if wid is None" in body, (
        "/workspace-prefill no longer short-circuits when no workspace "
        "is active — may try to read workspace 0 or crash on a NULL id"
    )
    assert '"prefill": {}' in body, (
        "/workspace-prefill no longer returns {prefill: {}} on the "
        "no-workspace path — the shape the frontend depends on changed"
    )


# ────────────────────────────────────────────────────────────────────
# Piece 5 — frontend Draft.jsx fetches prefill and uses it
# ────────────────────────────────────────────────────────────────────

def test_frontend_fetches_workspace_prefill():
    """Draft.jsx must fetch /api/drafts/workspace-prefill on mount and
    seed new-draft sessions with the returned prefill dict. Removing
    either half breaks the end-user prefill experience."""
    src = open("frontend/src/pages/Draft.jsx", encoding="utf-8").read()
    assert "/api/drafts/workspace-prefill" in src, (
        "Draft.jsx no longer fetches the workspace prefill endpoint — "
        "new drafts start empty regardless of active workspace"
    )
    assert "loadWsPrefill" in src, (
        "loadWsPrefill helper removed — prefill not refetched on "
        "workspace change (storage event listener relies on it)"
    )
    # The session-create payload must include the prefill in facts.
    # Grep for the exact spread so a rename or type change trips.
    assert "...wsPrefill" in src, (
        "new-draft POST body no longer spreads wsPrefill into facts — "
        "even if fetched, the prefill never reaches the server"
    )


def test_frontend_rehydrates_on_workspace_change():
    """When the user switches workspace (storage event), the prefill
    must refresh so the NEXT draft they start uses the new client.
    Without this, switching Rohit → Mehta then starting a new draft
    would still prefill Rohit's details."""
    src = open("frontend/src/pages/Draft.jsx", encoding="utf-8").read()
    assert "window.addEventListener('storage'" in src, (
        "Draft.jsx no longer listens for workspace-change via storage "
        "event — prefill stays stale after switching workspace"
    )
    assert "/workspace/i.test" in src or '"workspace"' in src, (
        "storage listener no longer filters for workspace keys — may "
        "miss or spuriously trigger on unrelated keys"
    )


# ────────────────────────────────────────────────────────────────────
# Section — Contract Analyzer parity (already workspace-aware; lock it)
# ────────────────────────────────────────────────────────────────────

def test_contract_analyzer_still_uses_workspace_context():
    """Contract Analyzer was already workspace-aware before Chunk 1 —
    lock the two places that inject the brief so no refactor silently
    strips them."""
    src = open("routes/contract_routes.py", encoding="utf-8").read()
    # Main analysis prompt build (around line 514 at time of writing).
    assert "build_workspace_context" in src, (
        "contract_routes.py no longer imports build_workspace_context "
        "anywhere — Contract Analyzer lost workspace awareness"
    )
    # Both the analysis path AND the /chat endpoint must inject it.
    # Grep for at least 2 call sites — one for analysis prompt, one
    # for chat.
    count = src.count("build_workspace_context") + src.count("_wsctx(") + src.count("_ws_ctx(")
    assert count >= 2, (
        f"Contract Analyzer only has {count} workspace-context call "
        "site(s); expected at least 2 (analysis + chat)"
    )


# ────────────────────────────────────────────────────────────────────
# Chunk 4 — legal-grade header/footer on export
# ────────────────────────────────────────────────────────────────────

def test_export_accepts_structured_letterhead_dict():
    """to_docx and to_pdf must accept a letterhead DICT (new in Chunk 4)
    AND stay backward-compatible with the legacy list-of-lines shape.
    Dropping either breaks real callers."""
    import inspect
    from utils.draft_engine import export as ex
    for fn in (ex.to_docx, ex.to_pdf):
        sig = inspect.signature(fn)
        assert "letterhead" in sig.parameters, (
            f"{fn.__name__} dropped the structured 'letterhead' kwarg — "
            "the new header/footer renderer has no input shape to use"
        )
        assert "letterhead_lines" in sig.parameters, (
            f"{fn.__name__} dropped the legacy 'letterhead_lines' kwarg — "
            "existing callers break"
        )


def test_docx_export_installs_headers_and_footers():
    """to_docx must install a first-page header (full letterhead), a
    continuation header (page 2+), and a footer (every page). All three
    live on section.header / section.first_page_header / section.footer.
    Verified end-to-end against the real Document object — not just a
    grep."""
    from utils.draft_engine import export as ex
    blocks = [
        {"type": "title", "text": "Test"},
        {"type": "numbered", "number": 1, "text": "Paragraph one."},
    ]
    letterhead = {
        "name": "Khare & Associates",
        "tagline": "Advocates & Legal Consultants",
        "address": "7B, Barakhamba Road,\nConnaught Place,\nNew Delhi 110001",
        "contact": "+91 11 2345 6789",
        "footer": "Khare & Associates",
        "confidential": True,
    }
    data = ex.to_docx(blocks, title="Test Doc", letterhead=letterhead)
    # Round-trip through python-docx to inspect what we actually wrote.
    import io
    from docx import Document
    d = Document(io.BytesIO(data))
    sec = d.sections[0]
    assert sec.different_first_page_header_footer is True, (
        "docx export no longer enables different_first_page_header_footer "
        "— the full letterhead would show on EVERY page instead of only "
        "page 1"
    )
    # First-page header must mention the firm name.
    fph_text = "\n".join(p.text for p in sec.first_page_header.paragraphs)
    assert "Khare & Associates" in fph_text, (
        "first-page header missing the firm name — letterhead not "
        "rendering on page 1"
    )
    # Continuation header must also carry the firm/title but is a SEPARATE
    # object from the first-page header.
    ch_text = "\n".join(p.text for p in sec.header.paragraphs)
    assert "Khare & Associates" in ch_text or "Test Doc" in ch_text, (
        "continuation header empty — page 2+ would have no header strip"
    )
    # Footer must exist and be non-empty.
    foot_text = "\n".join(p.text for p in sec.footer.paragraphs) + \
                "\n".join(c.text for tbl in sec.footer.tables for row in tbl.rows for c in row.cells)
    assert foot_text.strip(), "docx export footer is empty — no page numbers"


def test_pdf_export_header_footer_renders_on_every_page():
    """to_pdf's _PDF subclass must install header() and footer() methods.
    FPDF calls these automatically on every page, so overriding is the
    only path for per-page letterhead + page numbers."""
    src = open("utils/draft_engine/export.py", encoding="utf-8").read()
    # Grep inside to_pdf for the _PDF class definition.
    body = src.split("def to_pdf")[-1].split("\ndef ")[0]
    assert "class _PDF(FPDF)" in body, (
        "to_pdf's _PDF subclass is gone — no custom header/footer "
        "renderer available"
    )
    assert "def header(self):" in body, (
        "_PDF.header() removed — the full letterhead on page 1 and the "
        "continuation strip on page 2+ have no renderer"
    )
    assert "def footer(self):" in body, (
        "_PDF.footer() removed — page numbers, firm name and "
        "confidentiality notice have no renderer"
    )
    # 'Page X of Y' needs {nb} total-pages, which only resolves when
    # alias_nb_pages() has been called before add_page().
    assert "alias_nb_pages" in body, (
        "alias_nb_pages() call missing — 'Page X of Y' would print "
        "literally as 'Page X of {nb}'"
    )
    # Branch on page_no() == 1 so page 1 vs 2+ render differently.
    assert "page_no() == 1" in body, (
        "to_pdf's header() no longer differentiates page 1 from "
        "continuation pages — the full letterhead will repeat on every "
        "page (ugly) or neither page will have one"
    )


def test_export_route_fetches_letterhead_by_id():
    """The /api/drafts/export route must look up letterhead by
    letterhead_id from the DB (new in Chunk 4). The frontend's 'Export
    with my letterhead' button sends the id, not the full dict — if
    the lookup is removed, that button silently exports plain docs."""
    src = open("routes/draft_engine_routes.py", encoding="utf-8").read()
    body = src.split("def export_doc")[-1].split("\n@drafts_bp.route")[0]
    assert "letterhead_id" in body, (
        "/export no longer reads letterhead_id from the request — the "
        "frontend's letterhead-id send path is dead"
    )
    assert "FROM letterheads" in body, (
        "/export no longer looks up letterheads by id — the id arrives "
        "but is never resolved to a real letterhead"
    )
    assert "owner_user_id" in body, (
        "/export's letterhead lookup lost its owner_user_id gate — a "
        "user could export using another user's letterhead by guessing "
        "an id"
    )
    assert "letterhead=letterhead_struct" in body, (
        "/export no longer passes the structured letterhead dict to "
        "the exporter — the new header/footer builder gets nothing"
    )


def test_export_letterhead_backward_compat():
    """A list-of-lines letterhead must still work (old API shape).
    _normalize_letterhead maps it to the structured dict so pre-Chunk-4
    callers keep working through the transition."""
    from utils.draft_engine import export as ex
    assert hasattr(ex, "_normalize_letterhead"), (
        "_normalize_letterhead helper removed — old list-shape callers "
        "will crash"
    )
    out = ex._normalize_letterhead(["Firm Name", "Line 2", "Line 3"])
    assert out and out.get("name") == "Firm Name", (
        "_normalize_letterhead no longer treats the first list entry as "
        "the firm name — legacy callers export without a firm name"
    )


def test_zero_cost_when_no_workspace_active():
    """build_workspace_context must return '' when workspace_id is None.
    This is the 'only when required' invariant — no workspace active =>
    zero token cost on every AI call."""
    import inspect
    from utils import workspace_context as wc
    sig = inspect.signature(wc.build_workspace_context)
    assert "workspace_id" in sig.parameters, (
        "build_workspace_context signature changed — callers that pass "
        "a bare int or None may now break"
    )
    # Direct call with None.
    assert wc.build_workspace_context(None) == "", (
        "build_workspace_context(None) no longer returns '' — every AI "
        "call now pays token cost even when no workspace is active, "
        "violating the 'only when required' policy"
    )
    assert wc.build_workspace_context("not-an-int") == "", (
        "build_workspace_context no longer returns '' on invalid id — "
        "may crash downstream AI calls"
    )
