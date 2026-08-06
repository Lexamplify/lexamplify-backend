"""
tests/test_backend_full.py
Integration test suite for four core LexAmplify Flask endpoints:
  POST /api/documents/draft
  GET  /api/firm-library/external-search
  POST /api/contract/export
  GET  /api/kanoon-redirect

All outbound calls to third-party services (Groq/LiteLLM via ask_groq,
Pinecone, and the Indian Kanoon HTTP scrape) are mocked so the suite is
deterministic and runs offline. Nothing here touches the real sqlite
database — none of these four routes read or write it.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import requests as requests_lib
import pytest
from unittest.mock import patch, MagicMock

import app as app_module


@pytest.fixture()
def client():
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    with flask_app.test_client() as test_client:
        yield test_client


# ─────────────────────────────────────────────────────────────────────────
# POST /api/documents/draft
# ─────────────────────────────────────────────────────────────────────────

class TestDocumentsDraft:
    def test_missing_instructions_returns_400(self, client):
        resp = client.post("/api/documents/draft", json={})
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["error"] is True

    def test_successful_draft_returns_generated_text_under_three_keys(self, client):
        generated = "This Indemnity Clause is entered into under Indian law..."
        with patch("routes.document_routes.ask_groq", return_value=generated) as mock_ask:
            resp = client.post(
                "/api/documents/draft",
                json={"instructions": "Draft an indemnity clause for a services agreement"},
            )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "success"
        assert data["draft"] == generated
        assert data["clause"] == generated
        assert data["content"] == generated
        mock_ask.assert_called_once()

    def test_legacy_prompt_context_payload_still_works(self, client):
        """ContractAnalyzer.jsx's Auto-Draft panel posts {prompt, context}
        instead of {instructions, reference_context} — both shapes must
        keep working per the fallback chain in the route."""
        with patch("routes.document_routes.ask_groq", return_value="Generated clause text."):
            resp = client.post(
                "/api/documents/draft",
                json={"prompt": "Draft a termination clause", "context": "Existing MSA text."},
            )
        assert resp.status_code == 200
        assert resp.get_json()["draft"] == "Generated clause text."

    def test_non_string_instructions_does_not_crash(self, client):
        """A malformed JSON value (number instead of string) must be
        coerced safely, not raise an unhandled AttributeError on .strip()."""
        resp = client.post("/api/documents/draft", json={"instructions": 12345})
        assert resp.status_code in (200, 500)

    def test_ai_failure_returns_500_with_error_message(self, client):
        with patch(
            "routes.document_routes.ask_groq",
            side_effect=Exception("LLM gateway exhausted all fallbacks"),
        ):
            resp = client.post(
                "/api/documents/draft", json={"instructions": "Draft a force majeure clause"}
            )
        assert resp.status_code == 500
        data = resp.get_json()
        assert data["error"] is True
        assert "message" in data

    def test_options_preflight_returns_200_empty_body(self, client):
        resp = client.options("/api/documents/draft")
        assert resp.status_code == 200
        assert resp.get_json() == {}


# ─────────────────────────────────────────────────────────────────────────
# GET /api/firm-library/external-search
# ─────────────────────────────────────────────────────────────────────────

class TestFirmLibraryExternalSearch:
    def test_missing_query_returns_400(self, client):
        resp = client.get("/api/firm-library/external-search")
        assert resp.status_code == 400
        assert resp.get_json()["error"] is True

    def test_blank_query_returns_400(self, client):
        resp = client.get("/api/firm-library/external-search?query=   ")
        assert resp.status_code == 400

    def test_successful_search_maps_pinecone_matches_to_result_rows(self, client):
        mock_match = MagicMock()
        mock_match.metadata = {"case_id": "2022_13_342_356_EN.pdf", "year": 2022}
        mock_match.id = "chunk-abc-1"
        mock_match.score = 0.873

        mock_index = MagicMock()
        mock_index.query.return_value = MagicMock(matches=[mock_match])

        mock_pc = MagicMock()
        mock_pc.Index.return_value = mock_index
        mock_pc.inference.embed.return_value = [MagicMock(values=[0.001] * 1024)]

        with patch("app.Pinecone", return_value=mock_pc):
            resp = client.get(
                "/api/firm-library/external-search?query=breach+of+contract+damages"
            )

        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "success"
        assert len(data["results"]) == 1
        row = data["results"][0]
        assert row["case_id"] == "2022_13_342_356_EN.pdf"
        assert row["id"] == "2022_13_342_356_EN.pdf"
        assert row["category"] == "Case Law"
        assert row["author"] == "External Case Law DB"
        assert row["year"] == "2022"

    def test_dedupes_multiple_chunks_from_the_same_case(self, client):
        chunk_1 = MagicMock(metadata={"case_id": "case-1", "year": 2021}, id="c1", score=0.9)
        chunk_2 = MagicMock(metadata={"case_id": "case-1", "year": 2021}, id="c2", score=0.8)
        chunk_3 = MagicMock(metadata={"case_id": "case-2", "year": 2020}, id="c3", score=0.7)

        mock_index = MagicMock()
        mock_index.query.return_value = MagicMock(matches=[chunk_1, chunk_2, chunk_3])

        mock_pc = MagicMock()
        mock_pc.Index.return_value = mock_index
        mock_pc.inference.embed.return_value = [MagicMock(values=[0.001] * 1024)]

        with patch("app.Pinecone", return_value=mock_pc):
            resp = client.get("/api/firm-library/external-search?query=negligence")

        data = resp.get_json()
        case_ids = [r["case_id"] for r in data["results"]]
        assert case_ids == ["case-1", "case-2"]

    def test_pinecone_failure_returns_200_with_graceful_error_payload(self, client):
        """The route deliberately swallows Pinecone/vector-DB failures and
        returns 200 with an empty result set + status:'error' rather than a
        hard 500, so the Firm Library UI can render a soft warning instead
        of crashing the whole search panel."""
        with patch("app.Pinecone", side_effect=Exception("Pinecone unreachable")):
            resp = client.get("/api/firm-library/external-search?query=breach+of+contract")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "error"
        assert data["results"] == []

    def test_options_preflight_returns_200_empty_body(self, client):
        resp = client.options("/api/firm-library/external-search")
        assert resp.status_code == 200
        assert resp.get_json() == {}


# ─────────────────────────────────────────────────────────────────────────
# POST /api/contract/export
# ─────────────────────────────────────────────────────────────────────────

class TestContractExport:
    def test_pdf_export_returns_valid_pdf_attachment(self, client):
        resp = client.post(
            "/api/contract/export",
            json={
                "document_text": "Original scanned clause text.",
                "draft_text": "AI drafted revision text.",
                "format": "pdf",
            },
        )
        assert resp.status_code == 200
        assert resp.mimetype == "application/pdf"
        assert resp.data[:4] == b"%PDF"
        assert "LexAI_Export.pdf" in resp.headers.get("Content-Disposition", "")

    def test_docx_export_returns_valid_docx_attachment(self, client):
        resp = client.post(
            "/api/contract/export",
            json={
                "document_text": "Original scanned clause text.",
                "draft_text": "AI drafted revision text.",
                "format": "docx",
            },
        )
        assert resp.status_code == 200
        assert (
            resp.mimetype
            == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        # DOCX is a zip archive — PK is the zip local-file-header magic number.
        assert resp.data[:2] == b"PK"
        assert "LexAI_Export.docx" in resp.headers.get("Content-Disposition", "")

    def test_export_defaults_to_pdf_when_format_omitted(self, client):
        resp = client.post("/api/contract/export", json={"document_text": "Some text."})
        assert resp.status_code == 200
        assert resp.mimetype == "application/pdf"

    def test_export_with_non_latin1_characters_does_not_crash(self, client):
        """Rupee sign, smart quotes, and accented characters all sit outside
        latin-1 — the route's safe_text() helper must replace-encode them
        rather than raising UnicodeEncodeError from fpdf2."""
        resp = client.post(
            "/api/contract/export",
            json={
                "document_text": "Clause referencing ₹ amounts and “smart quotes” and café.",
                "draft_text": "",
                "format": "pdf",
            },
        )
        assert resp.status_code == 200
        assert resp.data[:4] == b"%PDF"

    def test_export_with_empty_body_still_returns_a_file(self, client):
        resp = client.post("/api/contract/export", json={})
        assert resp.status_code == 200
        assert resp.mimetype == "application/pdf"
        assert resp.data[:4] == b"%PDF"


# ─────────────────────────────────────────────────────────────────────────
# GET /api/kanoon-redirect
# ─────────────────────────────────────────────────────────────────────────

class TestKanoonRedirect:
    def test_network_failure_redirects_to_fallback_search_page(self, client):
        with patch(
            "app.requests.get",
            side_effect=requests_lib.exceptions.ConnectionError("Kanoon unreachable"),
        ):
            resp = client.get(
                "/api/kanoon-redirect?query=Doctrine of Promissory Estoppel",
                follow_redirects=False,
            )
        assert resp.status_code == 302
        assert "indiankanoon.org/search/" in resp.headers["Location"]

    def test_empty_query_redirects_without_crashing(self, client):
        with patch(
            "app.requests.get",
            side_effect=requests_lib.exceptions.ConnectionError("Kanoon unreachable"),
        ):
            resp = client.get("/api/kanoon-redirect", follow_redirects=False)
        assert resp.status_code == 302
        assert "indiankanoon.org/search/" in resp.headers["Location"]

    def test_statutory_query_redirects_to_matched_document(self, client):
        html = """
        <article class="result">
          <h4 class="result_title"><a href="/doc/123456/">Promissory Estoppel Doctrine Explained</a></h4>
          <div class="headline">A discussion of the doctrine of promissory estoppel.</div>
        </article>
        """
        mock_resp = MagicMock()
        mock_resp.text = html
        mock_resp.raise_for_status.return_value = None

        with patch("app.requests.get", return_value=mock_resp):
            resp = client.get(
                "/api/kanoon-redirect?query=Doctrine of Promissory Estoppel",
                follow_redirects=False,
            )

        assert resp.status_code == 302
        assert resp.headers["Location"] == "https://indiankanoon.org/doc/123456/"

    def test_case_citation_query_redirects_to_best_scoring_document(self, client):
        html = """
        <article class="result">
          <h4 class="result_title"><a href="/doc/999/">Kesavananda Bharati vs State of Kerala</a></h4>
          <div class="headline">Landmark constitutional law case decided in 1973.</div>
        </article>
        """
        mock_resp = MagicMock()
        mock_resp.text = html
        mock_resp.raise_for_status.return_value = None

        with patch("app.requests.get", return_value=mock_resp):
            resp = client.get(
                "/api/kanoon-redirect?query=Kesavananda Bharati v. State of Kerala",
                follow_redirects=False,
            )

        assert resp.status_code == 302
        assert resp.headers["Location"] == "https://indiankanoon.org/doc/999/"

    def test_case_citation_query_with_no_matches_falls_back_to_search_page(self, client):
        html = """
        <article class="result">
          <h4 class="result_title"><a href="/doc/1/">Completely Unrelated Judgment Title</a></h4>
          <div class="headline">Nothing to do with the requested parties at all.</div>
        </article>
        """
        mock_resp = MagicMock()
        mock_resp.text = html
        mock_resp.raise_for_status.return_value = None

        with patch("app.requests.get", return_value=mock_resp):
            resp = client.get(
                "/api/kanoon-redirect?query=Zyxqwvt Corp v. Plmnbvc Ltd",
                follow_redirects=False,
            )

        assert resp.status_code == 302
        assert "indiankanoon.org/search/" in resp.headers["Location"]
