"""Comprehensive test suite for the Contract Analyzer's three-layer
checklist pipeline (General, Firm Master, Playbook) and the
evidence-based source-tagging policy.

Why this file exists (serious-in-law policy):
  A '🏛️ Firm rule' or '📘 Playbook' badge is a legal claim — it tells a
  lawyer their firm's own rule flagged a clause. A false positive or
  negative is a real liability. Every rule in the pipeline needs a
  test that will trip CI the day someone silently regresses it.

Scope:
  * General checklist: always on, baked-in, deterministic regex check.
  * Firm Master Checklist: per-firm, DB-stored, must be injected on
    every analysis, must survive edits (no caching), stripped when
    empty.
  * Playbook: per-upload, must be transmitted on BOTH analyze paths
    (/analyze JSON + /analyze-file multipart), stripped when absent.
  * Source priority: firm_master > playbook > general > ai_suggested.
  * Evidence-based tagging: firm_master/playbook survive ONLY when
    _cite_rule produces an exact matched line.
  * Hallucination guard: no firm text => no firm_master badge is
    MATHEMATICALLY POSSIBLE anywhere in the output.
  * Dedup: AI's firm_master item upgrades a general item with the
    same title (never silently dropped).

These are pure-Python / tight SQL / grep-the-source tests — no network,
no Celery, no LLM. They lock the INVARIANTS; the live end-to-end
behavior is tested separately in the browser walkthroughs.
"""
import os
import re
import sqlite3

import pytest


# ────────────────────────────────────────────────────────────────────
# Section A — General Checklist (always on, baked-in)
# ────────────────────────────────────────────────────────────────────

def test_general_checklist_is_defined_and_nonempty():
    """The baked-in general checklist is the baseline every analysis
    checks against. If it's accidentally emptied, every missing-clause
    output goes blank and the analyzer loses its deterministic layer."""
    from utils.contract_checklist import GENERAL_CHECKLIST
    assert isinstance(GENERAL_CHECKLIST, (list, tuple)), "GENERAL_CHECKLIST must be a sequence"
    assert len(GENERAL_CHECKLIST) >= 20, (
        f"GENERAL_CHECKLIST has only {len(GENERAL_CHECKLIST)} entries — "
        "the baseline Indian commercial checklist should be ~25. Someone truncated it."
    )
    for item in GENERAL_CHECKLIST:
        assert isinstance(item, tuple) and len(item) == 2, (
            "every GENERAL_CHECKLIST entry must be (title, description)"
        )
        title, desc = item
        assert title and desc, f"blank entry in GENERAL_CHECKLIST: {item}"


def test_general_checklist_always_in_llm_prompt():
    """build_checklist_block (what the LLM sees as its system prompt
    chunk) MUST always include the general checklist, even when the
    firm has no master checklist. If this regresses, the AI stops
    being told what the baseline is and starts missing standard items."""
    from utils.contract_checklist import build_checklist_block
    block = build_checklist_block(firm_id=None)
    assert "GENERAL CHECKLIST" in block, (
        "LLM prompt no longer includes the general checklist header — "
        "the AI will miss baseline clauses"
    )
    # Must list numbered items (1. ...), not a bare header.
    assert re.search(r"^\s*1\.\s", block, re.M), "general checklist items not numbered in prompt"


def test_find_missing_clauses_tags_source_general():
    """The deterministic regex-based missing-clauses finder must either
    tag items as source='general' itself OR produce items that the
    merger will tag. Tested via grep because the function doesn't set
    source — the merger does."""
    src = open("tasks/contract_tasks.py", encoding="utf-8").read()
    # The merger must tag deterministic missing_clauses with 'general'
    # whenever source is absent. If this line vanishes, those items
    # would surface with source='' and the frontend would show no badge
    # distinction between them and firm rules.
    assert '"source": "general"' in src, (
        "the general-tag line in the missing-clauses merger is gone — "
        "deterministic missing items will no longer be tagged 'general'"
    )


# ────────────────────────────────────────────────────────────────────
# Section B — Firm Master Checklist (per-firm, DB-stored)
# ────────────────────────────────────────────────────────────────────

def _tmp_lpms_db(tmp_path):
    """A fresh LPMS DB with the firm_master_checklists schema the
    production code uses. Returns the path."""
    db = tmp_path / "lex.db"
    conn = sqlite3.connect(str(db))
    conn.executescript("""
        CREATE TABLE firm_master_checklists (
            firm_id INTEGER PRIMARY KEY,
            body TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by_user_id INTEGER
        );
        CREATE TABLE lpms_members (
            id INTEGER PRIMARY KEY, firm_id INTEGER, user_id INTEGER,
            role TEXT, active INTEGER DEFAULT 1
        );
    """)
    conn.close()
    return db


def test_firm_master_checklist_round_trips(tmp_path, monkeypatch):
    """Save a firm master checklist, read it back — must match byte-for-
    byte. This is the storage layer; if it regresses, every lawyer's
    custom rules silently disappear."""
    from utils import contract_checklist as cc
    db = _tmp_lpms_db(tmp_path)
    # The module calls _lpms_db_path() internally; patch that so our
    # temp DB stands in for the real one.
    monkeypatch.setattr(cc, "_lpms_db_path", lambda: str(db))
    body = (
        "- Indemnity cap must be <= 100% of contract value.\n"
        "- Arbitration seat must be Mumbai or Delhi.\n"
    )
    cc.set_firm_master(firm_id=1, body=body, user_id=42)
    assert cc.get_firm_master(1) == body, "firm master checklist storage round-trip failed"


def test_firm_master_checklist_update_overwrites(tmp_path, monkeypatch):
    """Save → update → read: the latest version must win. If a UPSERT
    regresses to INSERT-only, edits would silently be ignored."""
    from utils import contract_checklist as cc
    db = _tmp_lpms_db(tmp_path)
    monkeypatch.setattr(cc, "_lpms_db_path", lambda: str(db))
    cc.set_firm_master(1, "first version", user_id=1)
    cc.set_firm_master(1, "second version", user_id=1)
    assert cc.get_firm_master(1) == "second version", (
        "firm master update did not overwrite — users will see stale rules"
    )


def test_firm_master_included_in_llm_prompt_when_set(tmp_path, monkeypatch):
    """build_checklist_block must include the FIRM MASTER CHECKLIST
    block when the firm has saved rules. If the AI never sees them, the
    user's firm rules can't be flagged no matter how good the matcher is."""
    from utils import contract_checklist as cc
    db = _tmp_lpms_db(tmp_path)
    monkeypatch.setattr(cc, "_lpms_db_path", lambda: str(db))
    cc.set_firm_master(1, "- Indemnity cap must be <= 100%.", user_id=1)
    block = cc.build_checklist_block(firm_id=1)
    assert "FIRM MASTER CHECKLIST" in block, (
        "FIRM MASTER CHECKLIST header missing from LLM prompt — the "
        "AI never sees the firm's rules even though they're saved"
    )
    assert "Indemnity cap must be <= 100%" in block, (
        "firm master checklist body missing from LLM prompt"
    )
    # Must be marked as higher-priority than the general checklist.
    assert "HIGHEST PRIORITY" in block or "overrides" in block.lower(), (
        "LLM prompt no longer tells the model that firm master overrides "
        "general — the AI may apply them with wrong priority"
    )


def test_firm_master_absent_from_prompt_when_firm_has_none(tmp_path, monkeypatch):
    """A firm with no saved checklist must NOT get a FIRM MASTER
    block in the prompt — otherwise the AI could hallucinate rules
    'from' an empty block."""
    from utils import contract_checklist as cc
    db = _tmp_lpms_db(tmp_path)
    monkeypatch.setattr(cc, "_lpms_db_path", lambda: str(db))
    block = cc.build_checklist_block(firm_id=1)   # nothing saved
    assert "FIRM MASTER CHECKLIST" not in block, (
        "FIRM MASTER CHECKLIST header appears in prompt even though the "
        "firm has no saved rules — the AI could invent rules out of thin air"
    )


# ────────────────────────────────────────────────────────────────────
# Section C — Playbook (per-upload, text extracted from file)
# ────────────────────────────────────────────────────────────────────

def test_analyze_file_accepts_playbook_as_file():
    """The /analyze-file endpoint used to only read request.form.get
    ('ruleBook'), but the frontend sends the playbook as a FILE under
    key 'playbook'. The result was EVERY playbook getting silently
    dropped. This test locks the file-reading path in."""
    src = open("routes/contract_routes.py", encoding="utf-8").read()
    # The file-reading branch must still exist.
    assert "request.files.get(\"playbook\")" in src, (
        "/analyze-file no longer reads 'playbook' as a file — attached "
        "playbooks will silently fail to transmit again"
    )
    # And it must extract the text (not just read bytes).
    assert "extract_text_for_summary(_pb_data" in src, (
        "/analyze-file no longer extracts playbook text — attached "
        "playbook files won't produce rule_book_text, so the matcher "
        "and the LLM both won't see them"
    )


def test_analyze_text_path_sends_playbook():
    """The pasted-text path in Contracts.jsx must extract the playbook
    file client-side and send its text as 'ruleBook' in the JSON body —
    without this step the playbook attached on paste was silently lost."""
    src = open("frontend/src/pages/Contracts.jsx", encoding="utf-8").read()
    assert "ruleBook: ruleBookText" in src, (
        "pasted-text path no longer includes ruleBook in the request "
        "body — a playbook attached on paste will be silently dropped"
    )
    # And it must call /extract-text to get the playbook as text first.
    assert "/api/contract/extract-text" in src and "pbFd" in src, (
        "pasted-text path no longer extracts the playbook via "
        "/extract-text before sending — the playbook text won't be "
        "populated and no Playbook badge will fire"
    )


# ────────────────────────────────────────────────────────────────────
# Section D — Hallucination guards (serious-in-law policy)
# ────────────────────────────────────────────────────────────────────

def test_hallucination_guard_no_firm_text_no_firm_badge():
    """When firm_master_text is empty, source='firm_master' must be
    MATHEMATICALLY IMPOSSIBLE in the output — not 'unlikely', not
    'filtered later', impossible. The AI could claim firm_master out
    of hallucination; the guard must strip it unconditionally."""
    src = open("tasks/contract_tasks.py", encoding="utf-8").read()
    # The hard guard _has_firm / _has_play must still exist and gate
    # _norm_source. If this regresses, hallucinated firm_master tags
    # from the LLM start leaking into the output again.
    assert "_has_firm = bool(str(firm_master_text or" in src, (
        "_has_firm hard guard missing — LLM-hallucinated firm_master "
        "tags will leak through again"
    )
    assert "_has_play = bool(str(rule_book_text or" in src, (
        "_has_play hard guard missing — LLM-hallucinated playbook "
        "tags will leak through again"
    )
    # _norm_source must strip firm_master / playbook when the guards
    # are false.
    assert "if _has_firm else" in src, (
        "_norm_source no longer demotes firm_master when _has_firm is "
        "False — the hallucination guard is open"
    )
    assert "if _has_play else" in src, (
        "_norm_source no longer demotes playbook when _has_play is "
        "False — the hallucination guard is open"
    )


def test_evidence_based_tagging_requires_cite():
    """A firm_master or playbook badge survives ONLY when _cite_rule
    returns an actual rule line. The matched line is stored on
    item['source_rule'] as audit trail — a lawyer must be able to see
    exactly which rule justified the badge."""
    src = open("tasks/contract_tasks.py", encoding="utf-8").read()
    assert "def _cite_rule(" in src, (
        "_cite_rule helper was removed — firm_master / playbook tags "
        "would survive without evidence, defeating the serious-in-law "
        "policy"
    )
    assert 'item["source_rule"]' in src or "item['source_rule']" in src, (
        "source_rule is no longer set on upgraded items — the frontend "
        "audit-trail block has nothing to display, and badges become "
        "unverifiable"
    )
    # _upgrade must only promote to firm_master IF cite is truthy.
    assert "cite and _PRIO" in src, (
        "upgrade logic no longer gates on cite — a badge could survive "
        "without a matched rule line"
    )


def test_merger_distrusts_ai_source_claim():
    """The merger (pass 2 over missing_proactive) must downgrade AI's
    firm_master / playbook claim to a neutral source before the
    deterministic matcher re-promotes it. Without this, a model that
    hallucinates source='firm_master' bypasses the evidence check."""
    src = open("tasks/contract_tasks.py", encoding="utf-8").read()
    assert "src_raw if src_raw in" in src and '"general", "ai_suggested"' in src, (
        "merger no longer scrubs AI's firm_master/playbook claim pre-"
        "verification — hallucinated tags skip the evidence check"
    )


def test_risks_start_as_ai_suggested_not_ai_claim():
    """formatted_clauses (risks) must initialize source='ai_suggested'
    unconditionally. The post-pass _upgrade is the ONLY route to
    firm_master / playbook on risks."""
    src = open("tasks/contract_tasks.py", encoding="utf-8").read()
    # Grep for the specific risk initializer block.
    assert '"source": "ai_suggested"' in src, (
        "risks no longer default to source='ai_suggested' — a model that "
        "returns source='firm_master' on a risk now leaks through "
        "unverified"
    )


# ────────────────────────────────────────────────────────────────────
# Section E — Source priority + dedup
# ────────────────────────────────────────────────────────────────────

def test_priority_order_firm_master_playbook_general_ai():
    """The merger's _PRIO map encodes the priority rule:
       firm_master > playbook > general > ai_suggested
    Flip these values and the whole precedence (which lawyers rely on)
    inverts silently."""
    src = open("tasks/contract_tasks.py", encoding="utf-8").read()
    # Grep the exact priority dict shape.
    assert re.search(
        r'"firm_master"\s*:\s*3[,\s].*?"playbook"\s*:\s*2[,\s].*?"general"\s*:\s*1[,\s].*?"ai_suggested"\s*:\s*0',
        src, re.S,
    ), (
        "_PRIO map no longer declares firm_master=3, playbook=2, "
        "general=1, ai_suggested=0 — the source priority order the "
        "whole pipeline relies on is broken"
    )


def test_dedup_upgrades_lower_to_higher_source():
    """When the deterministic missing-clauses list AND the AI's
    missing_protections both produce an item with the SAME title, the
    one with the HIGHER priority source must win. Previously the
    deterministic one was always kept and the AI's firm_master version
    was silently dropped."""
    src = open("tasks/contract_tasks.py", encoding="utf-8").read()
    assert "_PRIO.get(src, 0) > _PRIO.get" in src, (
        "merger no longer promotes higher-priority sources on dedup — "
        "a firm_master item will be dropped when a general one has "
        "the same title"
    )


# ────────────────────────────────────────────────────────────────────
# Section F — Firm-rule matcher: specificity (false-positive guard)
# ────────────────────────────────────────────────────────────────────

def test_matcher_rejects_generic_single_word_match():
    """Previous matcher said 'any item mentioning indemnity or contract
    matches'. That tagged 'Entire agreement' and 'Severability' as
    firm_master just because their rationale contained 'contract'. The
    new matcher requires either a bigram hit or 2+ keywords."""
    src = open("tasks/contract_tasks.py", encoding="utf-8").read()
    assert "if hits >= 2" in src, (
        "_cite_rule no longer requires 2+ keyword hits — generic words "
        "(contract, clause, indemnity) will false-positive again"
    )
    # Generic legal nouns must be in the stopword list.
    for noun in ("contract", "agreement", "party", "clause"):
        assert f" {noun} " in src or f"'{noun}'" in src or f'"{noun}"' in src, (
            f"stopword list no longer excludes '{noun}' — it will "
            f"false-positive on nearly every missing-clause rationale"
        )


def test_matcher_accepts_verbatim_bigram():
    """A verbatim 2-word phrase from the rule (e.g. 'indemnity cap')
    appearing in the item text must still fire the badge. This is the
    high-confidence path; losing it would require 2 keyword overlaps
    even for clear matches."""
    src = open("tasks/contract_tasks.py", encoding="utf-8").read()
    # Bigram construction must still exist and be checked.
    assert "bigrams.add(" in src or "bigrams.add(f" in src, (
        "bigram set construction removed from _extract_keywords"
    )
    assert "for bg in bigrams" in src, (
        "bigram loop removed from _cite_rule — verbatim phrase matches "
        "(the high-confidence badge path) no longer fire"
    )


# ────────────────────────────────────────────────────────────────────
# Section G — Frontend render contract
# ────────────────────────────────────────────────────────────────────

def test_frontend_renders_firm_rule_and_playbook_badges():
    """ContractDetail.jsx must render BOTH the Firm rule and Playbook
    badges, keyed off item.source. If either badge name is accidentally
    removed, that source silently has no UI representation."""
    src = open("frontend/src/pages/ContractDetail.jsx", encoding="utf-8").read()
    assert "🏛️ Firm rule" in src, "Firm rule badge removed from UI"
    assert "📘 Playbook" in src, "Playbook badge removed from UI"
    # And both must branch on source value.
    assert "firm_master" in src and "'playbook'" in src.replace('"', "'"), (
        "badge render no longer branches on firm_master / playbook "
        "source values"
    )


def test_shared_contract_analysis_grants_access_to_recipient():
    """Priyam shares an analysis into a case room → Arjun must be able
    to open it from the chat card. Previous code gated on owner_user_id
    only, so recipients hit 404 on every shared analysis — the chat
    card looked live but pointed nowhere.

    Lock the share-based access-grant path in /analyses/<job_id>:
      * require_case_access must still be imported (viewer must be a
        case member — not just anyone with a shared URL).
      * case_message_resources must be read with resource_type =
        'contract_analysis' AND resource_id = job_id to find shares.
      * The three allow-branches must all be present: public message
        OR author OR mentioned-on-the-message.
    """
    src = open("routes/contract_routes.py", encoding="utf-8").read()
    # The handler's body contains the fallback block.
    body = src.split("def get_contract_analysis")[-1].split("\n@contract_bp.route")[0]
    assert "require_case_access" in body, (
        "share-based access-grant for /analyses/<id> no longer calls "
        "require_case_access — a non-case-member could open any shared "
        "analysis they got a URL to"
    )
    assert "resource_type = 'contract_analysis'" in body, (
        "share lookup no longer scopes to contract_analysis — may "
        "accidentally grant access via a vault_doc share"
    )
    for branch in ('"public"', 'author_user_id', 'case_message_mentions'):
        assert branch in body, (
            f"share-access branch '{branch}' removed — recipients may "
            "see analyses they weren't actually invited to, OR vice "
            "versa — fail-closed to 404"
        )
    assert '"Analysis not found."' in body, (
        "share-access rejection no longer returns the 404 'Analysis "
        "not found' convention — may be leaking 403 (which discloses "
        "existence) or 500 instead"
    )


def test_frontend_renders_source_rule_audit_block():
    """The audit-trail block (italic quote of the matched rule) must
    be rendered under every Firm rule / Playbook card so a lawyer can
    verify the badge. Without this a user sees '🏛️ Firm rule' but
    cannot audit which rule — not acceptable for law."""
    src = open("frontend/src/pages/ContractDetail.jsx", encoding="utf-8").read()
    # Both lists (risks + missing) must render source_rule.
    occ = src.count("source_rule")
    assert occ >= 2, (
        f"source_rule rendered in only {occ} place(s) — need it on "
        "both the risks list AND the missing-clauses list"
    )
    # Audit copy is built from a template literal:
    #   Per {isFirmRule ? 'firm rule' : 'playbook'}: "..."
    # Grep for the fragments rather than the fully-rendered string.
    assert "'firm rule' : 'playbook'" in src or "'firm rule':'playbook'" in src.replace(" ", ""), (
        "audit-trail copy ('Per firm rule: ...' / 'Per playbook: ...') "
        "missing — users have no way to see which rule was matched"
    )
    assert "{m.source_rule}" in src and "{x.source_rule}" in src, (
        "source_rule template interpolation missing from one or both of "
        "the missing-clauses / risks lists"
    )
