"""General + firm-master checklists for the Contract Analyzer (pipeline item 3).

TWO checklists feed every analyze run:

  1. GENERAL — a baseline Indian-commercial-contract review checklist
     curated from standing Indian statute and market practice (Indian
     Contract Act 1872, Arbitration & Conciliation Act 1996 as amended
     2015/2019/2021, DPDP Act 2023, MSMED Act 2006, Information
     Technology Act 2000, Specific Relief Act 1963, Companies Act 2013,
     Trade Marks Act 1999, Copyright Act 1957, Consumer Protection Act
     2019, Negotiable Instruments Act 1881, Income Tax Act 1961,
     GST Acts 2017, FEMA 1999, PMLA 2002). Baked into the code so
     every firm starts from the same floor.

  2. MASTER — a firm-level override checklist persisted in the
     firm_master_checklists table. The firm's senior partner edits it
     from Settings; the AI treats these rules as HIGHEST PRIORITY
     above the general checklist (same precedence model as the
     existing per-upload `rule_book_text` playbook_block in
     routes/contract_routes.py).

Both are injected into the Contract Analyzer system prompt. The AI uses
them to populate the `missing_protections` top-level key the master
prompt already demands.
"""
from __future__ import annotations
import sqlite3

from flask import current_app


# A terse title + 1-liner for every item keeps the prompt tight. Full
# educational blurbs go in a reference the user can read from Settings;
# the AI never needs more than the title + the statute hook.
GENERAL_CHECKLIST = [
    ("Governing Law",
     "Must specify 'laws of the Republic of India'. Vague wording leaves scope for forum shopping."),
    ("Jurisdiction / Exclusive Forum",
     "Name a specific Indian court (e.g. 'courts at Mumbai, India'). Generic 'competent courts' is weak."),
    ("Arbitration Clause",
     "Specify the Arbitration & Conciliation Act 1996, seat city, venue, number of arbitrators, "
     "appointment procedure (fallback to Section 11), language, and emergency-arbitrator access."),
    ("Limitation of Liability (LoL)",
     "Cap on direct AND indirect/consequential damages. Without it, Section 73 ICA exposes our client "
     "to unlimited 'reasonable foreseeable' loss."),
    ("Indemnity",
     "Scope, cap, carve-outs (fraud, willful misconduct, gross negligence, IP infringement). "
     "Must specify who indemnifies whom and the procedure for third-party claims."),
    ("Force Majeure",
     "Modern wording covering pandemic/epidemic, government order, cyber-attack, utility failure, "
     "strikes. Written notice within a fixed window; obligation to mitigate."),
    ("Termination for Convenience",
     "Notice period, obligations on exit (handover, confidential-info return), fees for work-in-progress."),
    ("Termination for Cause",
     "Material-breach definition, cure period (usually 30 days), insolvency / winding-up trigger, "
     "immediate termination for breach of confidentiality or IP."),
    ("Confidentiality",
     "Mutual, survives termination 2–5 years, carve-outs (public domain, independently developed, "
     "legally compelled disclosure). Injunctive relief acknowledged."),
    ("Intellectual Property",
     "Pre-existing IP ownership stays with the owner. Newly-created IP ownership + any license-back. "
     "IP infringement indemnity from the vendor side."),
    ("DPDP Act 2023 Compliance",
     "Required if processing personal data: lawful ground, purpose limitation, data minimisation, "
     "72-hour breach notification, Data Protection Officer contact, cross-border transfer restrictions."),
    ("Non-Compete / Non-Solicit",
     "Section 27 ICA bars post-contract restraint of trade. Only reasonable scope + duration on employees "
     "/ customers survives; broad non-competes void."),
    ("Representations & Warranties",
     "Authority to sign, no conflict, enforceability, no pending litigation, compliance with applicable "
     "laws including sector regulators (SEBI/RBI/IRDA if relevant)."),
    ("Payment Terms",
     "Due dates, late-payment interest (MSMED Act 2006 — 3× RBI bank rate for registered MSMEs), "
     "GST treatment, invoicing procedure, TDS treatment."),
    ("GST Clause",
     "Who bears GST, invoice format (CGST/SGST/IGST), input-tax-credit availability, GSTN registration "
     "warranty, treatment of rate changes."),
    ("Audit Rights",
     "Right to audit books related to the contract, notice period (usually 15–30 days), who bears cost, "
     "frequency cap (once per year), post-termination audit window."),
    ("Assignment & Novation",
     "Prohibition without written consent; carve-outs for affiliate / merger / change-of-control transfers."),
    ("Notice Clause",
     "Mode (registered post + email), named recipient addresses, deemed-receipt rules, time of effect."),
    ("Entire Agreement + Amendments",
     "Written-only variations, counterparts clause for e-signature (IT Act 2000 Section 3A)."),
    ("Severability",
     "Unenforceable clauses do not void the whole agreement; blue-pencil preserved."),
    ("Waiver",
     "No waiver by inaction; waiver must be in writing + signed."),
    ("Insurance Requirements",
     "Applicable where risk is high: public liability, professional indemnity, cyber. Minimum coverage, "
     "additional-insured naming, certificate production."),
    ("Compliance Reps",
     "PMLA 2002 AML, FEMA 1999 for cross-border payment, Companies Act 2013 director-duty compliance, "
     "sector-specific (e.g. SEBI listing obligations for a listed counterparty)."),
    ("Dispute Escalation",
     "Mandatory negotiation period (30–60 days) between senior management before arbitration kicks in."),
    ("Change of Control",
     "Trigger notification, right of termination on change of control at the other party, retention "
     "of benefit of prior obligations."),
]


def _lpms_db_path() -> str:
    """Same resolver the LPMS routes use so the firm checklist lives in
    the same SQLite file as lpms_members / lpms_cases."""
    return current_app.extensions.get("lpms_db_path") or "lex_assistant.db"


def ensure_table():
    """Create firm_master_checklists on first use. Idempotent."""
    conn = sqlite3.connect(_lpms_db_path())
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS firm_master_checklists (
                firm_id INTEGER PRIMARY KEY,
                body TEXT NOT NULL DEFAULT '',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_by_user_id INTEGER
            )
        """)
        conn.commit()
    finally:
        conn.close()


def get_firm_master(firm_id) -> str:
    """Return the firm's current master checklist text, or '' if none set
    yet. Called from the Contract Analyzer prompt-builder and from the
    Settings GET endpoint."""
    if not firm_id:
        return ""
    ensure_table()
    conn = sqlite3.connect(_lpms_db_path())
    try:
        row = conn.execute(
            "SELECT body FROM firm_master_checklists WHERE firm_id = ?",
            (int(firm_id),),
        ).fetchone()
        return (row[0] or "") if row else ""
    finally:
        conn.close()


def set_firm_master(firm_id, body: str, user_id=None):
    """Upsert the firm's master checklist. Settings PUT endpoint calls this."""
    if not firm_id:
        raise ValueError("firm_id is required")
    ensure_table()
    conn = sqlite3.connect(_lpms_db_path())
    try:
        conn.execute(
            "INSERT INTO firm_master_checklists (firm_id, body, updated_at, updated_by_user_id) "
            "VALUES (?, ?, CURRENT_TIMESTAMP, ?) "
            "ON CONFLICT(firm_id) DO UPDATE SET "
            "body = excluded.body, updated_at = CURRENT_TIMESTAMP, "
            "updated_by_user_id = excluded.updated_by_user_id",
            (int(firm_id), str(body or "")[:12000], int(user_id) if user_id else None),
        )
        conn.commit()
    finally:
        conn.close()


def build_checklist_block(firm_id) -> str:
    """Return the system-prompt chunk the Contract Analyzer prepends to
    its scan. Combines the baked-in general checklist + the firm's
    master checklist (highest priority).

    Keep it tight: the AI's TPM budget is the hard constraint. Titles +
    1-liner each; the AI already knows the full statutes."""
    lines = ["=== GENERAL CHECKLIST (standard Indian commercial contract review) ==="]
    for i, (title, desc) in enumerate(GENERAL_CHECKLIST, start=1):
        lines.append(f"{i}. {title} — {desc}")
    lines.append("=== END GENERAL CHECKLIST ===\n")

    master = get_firm_master(firm_id).strip()
    if master:
        lines.append("=== FIRM MASTER CHECKLIST (HIGHEST PRIORITY — overrides general) ===")
        lines.append(master[:12000])
        lines.append("=== END FIRM MASTER CHECKLIST ===\n")

    lines.append(
        "Use BOTH checklists to populate the `missing_protections` array in your JSON output. "
        "For each item that would favor OUR CLIENT but is absent from the contract, add an entry. "
        "The firm master checklist is HIGHER PRIORITY than the general checklist — if the firm has "
        "its own rule on a topic, follow the firm's rule."
    )
    return "\n".join(lines)


__all__ = [
    "GENERAL_CHECKLIST",
    "get_firm_master",
    "set_firm_master",
    "build_checklist_block",
    "ensure_table",
]
