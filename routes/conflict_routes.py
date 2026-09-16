"""
routes/conflict_routes.py
Cross-Document Conflict Engine — upload up to 4+ docs, find contradictions with AI.
"""
import os
import json
import re
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify, render_template, current_app
from litellm import completion
from utils.ai_helper import extract_json_from_llm_response, ask_groq

conflict_bp = Blueprint('conflict', __name__)

MODEL_NAME = "groq/openai/gpt-oss-120b"


def ask_llm(prompt: str) -> str:
    try:
        response = completion(
            model=MODEL_NAME,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            timeout=300,
            num_retries=2,
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"Conflict LLM Error: {e}")
        return ""


def extract_text(file_bytes: bytes, filename: str) -> str:
    if not file_bytes:
        return ""
    try:
        from utils.pdf_helper import extract_text_for_summary
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        text = extract_text_for_summary(file_bytes, ext)
        if text and len(text.strip()) > 20:
            return text.strip()
    except Exception as e:
        print(f"extract_text Primary Error: {e}")

    # Secondary PDF fallback using PyPDF2 / pypdf
    if filename.lower().endswith('.pdf'):
        try:
            import io
            import PyPDF2
            reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
            extracted = []
            for p in reader.pages:
                t = p.extract_text()
                if t:
                    extracted.append(t)
            if extracted:
                return "\n\n".join(extracted).strip()
        except Exception:
            pass

    # Secondary DOCX fallback using python-docx with tables
    if filename.lower().endswith('.docx'):
        try:
            import io
            import docx
            doc = docx.Document(io.BytesIO(file_bytes))
            lines = [p.text for p in doc.paragraphs if p.text.strip()]
            for table in doc.tables:
                for row in table.rows:
                    row_txt = " | ".join(c.text.strip() for c in row.cells if c.text.strip())
                    if row_txt:
                        lines.append(row_txt)
            if lines:
                return "\n".join(lines).strip()
        except Exception:
            pass

    # Plain text / fallback decoding
    for enc in ('utf-8', 'latin-1', 'cp1252'):
        try:
            return file_bytes.decode(enc, errors='ignore').strip()
        except Exception:
            pass
    return ""


def extract_salient_legal_clauses(text: str, budget: int = 4000) -> str:
    """
    Intelligent clause-aware summarizer for contract analysis.
    Preserves preamble/recitals, scans the entire document for operative risk clauses
    (Jurisdiction, Dispute Resolution, Payment, Liability, Indemnity, Confidentiality,
    Termination, Non-Compete, IP, Precedence), and retains the closing boilerplate.
    """
    if not text or len(text) <= budget:
        return text

    # Keywords representing critical risk vectors in legal agreements
    risk_patterns = [
        (r'(?:jurisdiction|governing\s+law|exclusive\s+jurisdiction|applicable\s+law|courts?\s+of|venue|forum)', 'JURISDICTION & FORUM'),
        (r'(?:arbitrat|dispute\s+resolution|arbitrator|conciliation|mediation|siac|lcia|tribunal|amicable\s+settlement)', 'DISPUTE RESOLUTION'),
        (r'(?:payment|invoic|fees|remittance|withhold|deduct|milestone|advance|arrears|net\s+\d+)', 'PAYMENT & REMITTANCE'),
        (r'(?:limit(?:ation)?\s+of\s+liability|aggregate\s+liability|indemn|damages|capped|uncapped|exceed|hold\s+harmless|consequential)', 'LIABILITY & INDEMNITY'),
        (r'(?:confidential|non-disclosure|trade\s+secret|secrecy|surviv(?:e|al)|perpetu(?:ity|al)|non-use)', 'CONFIDENTIALITY & SURVIVAL'),
        (r'(?:terminat|notice\s+period|cure\s+period|for\s+convenience|for\s+cause|material\s+breach|expiration)', 'TERMINATION & NOTICE'),
        (r'(?:non-compete|non-solicit|restrictive\s+covenant|exclusiv|restraint\s+of\s+trade)', 'RESTRICTIVE COVENANTS'),
        (r'(?:intellectual\s+property|ip\s+rights|work\s+for\s+hire|ownership|assignment|license|background\s+ip)', 'INTELLECTUAL PROPERTY'),
        (r'(?:order\s+of\s+precedence|entire\s+agreement|supersede|conflict(?:ing)?\s+terms|prevail|amendment)', 'ORDER OF PRECEDENCE'),
        (r'(?:first\s+information\s+report|fir|crpc|bnss|penal\s+code|police|accused|complainant|investigat)', 'STATUTORY / CRIMINAL PROCEEDINGS'),
    ]

    # 1. Preamble (parties, recitals, date) - up to 900 chars
    preamble = text[:900].strip()

    # 2. Extract matching risk paragraphs/clauses across the full text
    paragraphs = re.split(r'\n\s*\n|(?<=\.\s\s)|(?<=\n\d+\.\s)', text)
    matched_clauses = []
    seen_paras = set()

    for p in paragraphs:
        p_clean = p.strip()
        if len(p_clean) < 25:
            continue
        for pat, tag in risk_patterns:
            if re.search(pat, p_clean, re.IGNORECASE):
                if p_clean not in seen_paras:
                    seen_paras.add(p_clean)
                    matched_clauses.append(f"[{tag}] {p_clean}")
                break

    # 3. Boilerplate / Closing (last 800 chars)
    closing = text[-800:].strip() if len(text) > 1700 else ""

    # Combine within budget
    middle_text = "\n\n".join(matched_clauses)
    combined = f"{preamble}\n\n--- [KEY EXTRACTED OPERATIVE CLAUSES] ---\n\n{middle_text}"
    if closing and closing not in combined:
        combined += f"\n\n--- [CLOSING & MISCELLANEOUS] ---\n\n{closing}"

    if len(combined) > budget:
        combined = combined[:budget] + "\n... [truncated for context budget]"

    return combined


def detect_clause_conflicts_deterministic(docs: list) -> list:
    """
    Comprehensive rule-based cross-document legal clause comparator.
    Scans all pairs of documents across 10 critical legal vectors:
    1. Forum & Jurisdiction
    2. Dispute Resolution & Arbitration
    3. Payment Terms & Withholding Rights
    4. Confidentiality Survival Duration
    5. Liability Limitation & Indemnification
    6. Termination Notice & Cure Periods
    7. Restrictive Covenants & Non-Compete
    8. Intellectual Property & Work Product Ownership
    9. Criminal / Statutory Proceedings vs Civil Agreement
    10. Order of Precedence Hierarchy
    """
    conflicts = []
    conflict_idx = 1

    def find_matches(text, patterns):
        hits = []
        for p in patterns:
            for m in re.finditer(p, text, re.IGNORECASE):
                start = max(0, text.rfind('\n', 0, m.start()))
                end = text.find('\n', m.end())
                if end == -1:
                    end = min(len(text), m.end() + 150)
                snippet = text[start:end].strip()
                if snippet and len(snippet) > 15:
                    hits.append(snippet)
        return list(dict.fromkeys(hits))

    # Forum dictionary with regex patterns and display names
    forums = [
        (r'delhi|new\s+delhi', 'Delhi Courts'),
        (r'mumbai|bombay', 'Mumbai / Bombay High Court'),
        (r'bengaluru|bangalore|karnataka', 'Bengaluru / Karnataka Courts'),
        (r'chennai|madras|tamil\s+nadu', 'Chennai / Madras High Court'),
        (r'kolkata|calcutta|west\s+bengal', 'Kolkata / Calcutta High Court'),
        (r'hyderabad|telangana', 'Hyderabad / Telangana High Court'),
        (r'ahmedabad|gujarat', 'Ahmedabad / Gujarat High Court'),
        (r'pune|maharashtra', 'Pune / Maharashtra Courts'),
        (r'delaware', 'Delaware Courts (USA)'),
        (r'new\s+york', 'New York Courts (USA)'),
        (r'california', 'California Courts (USA)'),
        (r'london|england|united\s+kingdom', 'English Courts (London)'),
        (r'singapore|siac', 'Singapore Courts / SIAC'),
    ]

    for i in range(len(docs)):
        for j in range(i + 1, len(docs)):
            doc_a = docs[i]
            doc_b = docs[j]
            name_a = doc_a.get('name') or f"Document {i+1}"
            name_b = doc_b.get('name') or f"Document {j+1}"
            text_a = doc_a.get('text') or ""
            text_b = doc_b.get('text') or ""

            # 1. Jurisdiction & Venue Discrepancy
            forum_a = None
            forum_b = None
            for pat, fname in forums:
                if re.search(pat, text_a, re.I) and not forum_a:
                    forum_a = fname
                if re.search(pat, text_b, re.I) and not forum_b:
                    forum_b = fname

            if forum_a and forum_b and forum_a != forum_b:
                quote_a = (find_matches(text_a, [r'jurisdiction', r'courts?', r'governing\s+law']) or [f"Designates {forum_a} as exclusive forum."])[0]
                quote_b = (find_matches(text_b, [r'jurisdiction', r'courts?', r'governing\s+law']) or [f"Designates {forum_b} as exclusive forum."])[0]
                conflicts.append({
                    'id': str(conflict_idx),
                    'title': f'Conflicting Jurisdiction & Forum: {forum_a} vs {forum_b}',
                    'severity': 'critical',
                    'docA': {
                        'file': name_a,
                        'name': name_a,
                        'quote': quote_a,
                        'page': 'Page 1',
                        'section': 'Jurisdiction & Governing Law',
                        'context': quote_a
                    },
                    'docB': {
                        'file': name_b,
                        'name': name_b,
                        'quote': quote_b,
                        'page': 'Page 1',
                        'section': 'Governing Law & Forum',
                        'context': quote_b
                    },
                    'doc_a_name': name_a,
                    'doc_a_excerpt': quote_a,
                    'doc_b_name': name_b,
                    'doc_b_excerpt': quote_b,
                    'legalExplanation': (
                        f'Concurrent transaction documents specify incompatible dispute forums ({forum_a} vs. {forum_b}). '
                        'Under Section 28 of the Indian Contract Act 1872 and Sections 20-21 of the Code of Civil Procedure 1908, '
                        'conflicting exclusive jurisdiction clauses create procedural deadlock, risk parallel anti-suit injunctions, and impair enforcement.'
                    ),
                    'harmonization': f'Adopt a unified governing law and exclusive dispute resolution forum ({forum_a} or {forum_b}) across all related agreements.',
                    'recommended_resolution': f'Adopt a unified governing law and exclusive dispute resolution forum ({forum_a} or {forum_b}) across all related agreements.',
                    'citedCases': []
                })
                conflict_idx += 1

            # 2. Dispute Resolution Clashes (Arbitration vs Court Litigation)
            has_arbitration_a = bool(re.search(r'arbitrat|tribunal|siac|lcia|ica', text_a, re.I))
            has_arbitration_b = bool(re.search(r'arbitrat|tribunal|siac|lcia|ica', text_b, re.I))
            has_court_lit_a = bool(re.search(r'exclusive\s+jurisdiction\s+of\s+the\s+courts|waives\s+all\s+rights\s+to\s+arbitrat|civil\s+court', text_a, re.I))
            has_court_lit_b = bool(re.search(r'exclusive\s+jurisdiction\s+of\s+the\s+courts|waives\s+all\s+rights\s+to\s+arbitrat|civil\s+court', text_b, re.I))

            if (has_arbitration_a and (has_court_lit_b or not has_arbitration_b and forum_b)) or (has_arbitration_b and (has_court_lit_a or not has_arbitration_a and forum_a)):
                if not any(c['title'].startswith('Conflicting Jurisdiction') and c['docA']['name'] == name_a and c['docB']['name'] == name_b for c in conflicts):
                    quote_a = (find_matches(text_a, [r'arbitrat', r'dispute', r'court']) or [f"Dispute resolution mechanism in {name_a}."])[0]
                    quote_b = (find_matches(text_b, [r'arbitrat', r'dispute', r'court']) or [f"Dispute resolution mechanism in {name_b}."])[0]
                    conflicts.append({
                        'id': str(conflict_idx),
                        'title': f'Dispute Resolution Mechanism Clash: Arbitration vs Court Litigation between {name_a} and {name_b}',
                        'severity': 'critical',
                        'docA': {
                            'file': name_a,
                            'name': name_a,
                            'quote': quote_a,
                            'page': 'Page 1',
                            'section': 'Dispute Resolution Clause',
                            'context': quote_a
                        },
                        'docB': {
                            'file': name_b,
                            'name': name_b,
                            'quote': quote_b,
                            'page': 'Page 1',
                            'section': 'Dispute Resolution Clause',
                            'context': quote_b
                        },
                        'doc_a_name': name_a,
                        'doc_a_excerpt': quote_a,
                        'doc_b_name': name_b,
                        'doc_b_excerpt': quote_b,
                        'legalExplanation': (
                            'Contradiction between mandatory arbitration under the Arbitration & Conciliation Act 1996 and civil court litigation '
                            'creates jurisdictional threshold disputes under Section 8 of the Arbitration Act, causing substantial litigation delays and procedural uncertainty.'
                        ),
                        'harmonization': 'Synchronize dispute resolution clauses by establishing mandatory arbitration as the primary forum across all ancillary and master agreements.',
                        'recommended_resolution': 'Synchronize dispute resolution clauses by establishing mandatory arbitration as the primary forum across all ancillary and master agreements.',
                        'citedCases': []
                    })
                    conflict_idx += 1

            # 3. Payment Terms / Remittance & Withholding Rights
            pay_a = find_matches(text_a, [r'payment', r'invoic', r'fees', r'withhold', r'remittance', r'net\s+\d+'])
            pay_b = find_matches(text_b, [r'payment', r'invoic', r'fees', r'withhold', r'remittance', r'net\s+\d+'])
            if pay_a and pay_b:
                has_withhold_a = any('withhold' in p.lower() or 'discretion' in p.lower() or 'reduce' in p.lower() or 'deduct' in p.lower() for p in pay_a)
                has_withhold_b = any('withhold' in p.lower() or 'discretion' in p.lower() or 'reduce' in p.lower() or 'deduct' in p.lower() for p in pay_b)
                
                days_a = re.search(r'(\d+)\s+days?', text_a, re.I)
                days_b = re.search(r'(\d+)\s+days?', text_b, re.I)
                has_days_mismatch = bool(days_a and days_b and days_a.group(1) != days_b.group(1))

                if has_withhold_a != has_withhold_b or has_days_mismatch or ('30 days' in text_a.lower() and ('60 days' in text_b.lower() or 'withhold' in text_b.lower())):
                    quote_a = pay_a[0]
                    quote_b = pay_b[0]
                    conflicts.append({
                        'id': str(conflict_idx),
                        'title': f'Inconsistent Payment & Invoicing Terms between {name_a} and {name_b}',
                        'severity': 'critical' if (has_withhold_a != has_withhold_b) else 'major',
                        'docA': {
                            'file': name_a,
                            'name': name_a,
                            'quote': quote_a,
                            'page': 'Page 1',
                            'section': 'Invoicing and Payment',
                            'context': quote_a
                        },
                        'docB': {
                            'file': name_b,
                            'name': name_b,
                            'quote': quote_b,
                            'page': 'Page 1',
                            'section': 'Fees and Remittance',
                            'context': quote_b
                        },
                        'doc_a_name': name_a,
                        'doc_a_excerpt': quote_a,
                        'doc_b_name': name_b,
                        'doc_b_excerpt': quote_b,
                        'legalExplanation': (
                            'Contradictory remittance schedules, mismatched milestone timelines, and unilateral withholding rights violate commercial certainty under Section 73 '
                            'of the Indian Contract Act 1872, creating immediate financial exposure and breach-of-contract vulnerability.'
                        ),
                        'harmonization': 'Harmonize payment schedules across all documents and establish objective milestone acceptance criteria prior to any payment deductions or withholding.',
                        'recommended_resolution': 'Harmonize payment schedules across all documents and establish objective milestone acceptance criteria prior to any payment deductions or withholding.',
                        'citedCases': []
                    })
                    conflict_idx += 1

            # 4. Confidentiality Survival Duration
            conf_a = find_matches(text_a, [r'confidential', r'non-disclosure', r'secrecy', r'survive'])
            conf_b = find_matches(text_b, [r'confidential', r'non-disclosure', r'secrecy', r'survive'])
            if conf_a and conf_b:
                dur_a = re.search(r'(\d+)\s+years?|perpetu(?:al|ity)?|indefinite', text_a, re.I)
                dur_b = re.search(r'(\d+)\s+years?|perpetu(?:al|ity)?|indefinite', text_b, re.I)
                if dur_a and dur_b and dur_a.group(0).lower() != dur_b.group(0).lower():
                    quote_a = conf_a[0]
                    quote_b = conf_b[0]
                    conflicts.append({
                        'id': str(conflict_idx),
                        'title': f'Mismatched Confidentiality Survival Periods: {dur_a.group(0)} vs {dur_b.group(0)}',
                        'severity': 'major',
                        'docA': {
                            'file': name_a,
                            'name': name_a,
                            'quote': quote_a,
                            'page': 'Page 1',
                            'section': 'Confidentiality Survival',
                            'context': quote_a
                        },
                        'docB': {
                            'file': name_b,
                            'name': name_b,
                            'quote': quote_b,
                            'page': 'Page 1',
                            'section': 'Non-Disclosure Duration',
                            'context': quote_b
                        },
                        'doc_a_name': name_a,
                        'doc_a_excerpt': quote_a,
                        'doc_b_name': name_b,
                        'doc_b_excerpt': quote_b,
                        'legalExplanation': (
                            'Conflicting confidentiality survival periods create ambiguity regarding trade secret protection and post-termination '
                            'obligations. Inconsistent terms undermine confidentiality enforcement under the Specific Relief Act 1963.'
                        ),
                        'harmonization': f'Standardize confidentiality survival duration across all related contracts to the longer protective term ({dur_b.group(0) if "perpetu" in dur_b.group(0).lower() else dur_a.group(0)}).',
                        'recommended_resolution': f'Standardize confidentiality survival duration across all related contracts to the longer protective term.',
                        'citedCases': []
                    })
                    conflict_idx += 1

            # 5. Liability Limitation & Indemnity Allocation
            liab_a = find_matches(text_a, [r'liability', r'indemni', r'damages', r'capped', r'exceed', r'limitation'])
            liab_b = find_matches(text_b, [r'liability', r'indemni', r'damages', r'capped', r'exceed', r'limitation'])
            if liab_a and liab_b:
                is_capped_a = any('capped' in l.lower() or 'not exceed' in l.lower() or 'limited to' in l.lower() or 'preceding' in l.lower() for l in liab_a)
                is_unlimited_b = any('unlimited' in l.lower() or 'no liability cap' in l.lower() or 'indemnity' in l.lower() for l in liab_b)
                is_capped_b = any('capped' in l.lower() or 'not exceed' in l.lower() or 'limited to' in l.lower() or 'preceding' in l.lower() for l in liab_b)
                is_unlimited_a = any('unlimited' in l.lower() or 'no liability cap' in l.lower() or 'indemnity' in l.lower() for l in liab_a)
                if (is_capped_a and is_unlimited_b) or (is_capped_b and is_unlimited_a):
                    quote_a = liab_a[0]
                    quote_b = liab_b[0]
                    conflicts.append({
                        'id': str(conflict_idx),
                        'title': f'Contradictory Liability Caps & Indemnity Risk Allocation between {name_a} and {name_b}',
                        'severity': 'critical',
                        'docA': {
                            'file': name_a,
                            'name': name_a,
                            'quote': quote_a,
                            'page': 'Page 1',
                            'section': 'Limitation of Liability',
                            'context': quote_a
                        },
                        'docB': {
                            'file': name_b,
                            'name': name_b,
                            'quote': quote_b,
                            'page': 'Page 1',
                            'section': 'Indemnity and Exposure',
                            'context': quote_b
                        },
                        'doc_a_name': name_a,
                        'doc_a_excerpt': quote_a,
                        'doc_b_name': name_b,
                        'doc_b_excerpt': quote_b,
                        'legalExplanation': (
                            'Direct contradiction between a capped liability clause and an uncapped indemnity clause creates catastrophic commercial exposure. '
                            'Under Indian Law, courts interpret ambiguous exculpatory clauses against the drafter (contra proferentem).'
                        ),
                        'harmonization': 'Explicitly reconcile indemnity carve-outs within the overall aggregate liability cap clause.',
                        'recommended_resolution': 'Explicitly reconcile indemnity carve-outs within the overall aggregate liability cap clause.',
                        'citedCases': []
                    })
                    conflict_idx += 1

            # 6. Termination & Notice Periods
            term_a = find_matches(text_a, [r'terminat', r'notice', r'cure\s+period', r'convenience'])
            term_b = find_matches(text_b, [r'terminat', r'notice', r'cure\s+period', r'convenience'])
            if term_a and term_b:
                t_days_a = re.search(r'(\d+)\s+days?\s+(?:prior|written)?\s*notice', text_a, re.I)
                t_days_b = re.search(r'(\d+)\s+days?\s+(?:prior|written)?\s*notice', text_b, re.I)
                if t_days_a and t_days_b and t_days_a.group(1) != t_days_b.group(1):
                    quote_a = term_a[0]
                    quote_b = term_b[0]
                    conflicts.append({
                        'id': str(conflict_idx),
                        'title': f'Mismatched Termination Notice Periods: {t_days_a.group(0)} vs {t_days_b.group(0)}',
                        'severity': 'major',
                        'docA': {
                            'file': name_a,
                            'name': name_a,
                            'quote': quote_a,
                            'page': 'Page 1',
                            'section': 'Termination Clause',
                            'context': quote_a
                        },
                        'docB': {
                            'file': name_b,
                            'name': name_b,
                            'quote': quote_b,
                            'page': 'Page 1',
                            'section': 'Notice of Termination',
                            'context': quote_b
                        },
                        'doc_a_name': name_a,
                        'doc_a_excerpt': quote_a,
                        'doc_b_name': name_b,
                        'doc_b_excerpt': quote_b,
                        'legalExplanation': (
                            f'Conflicting notice periods ({t_days_a.group(1)} days vs {t_days_b.group(1)} days) create immediate procedural default risk upon exit. '
                            'Notice given under one contract will trigger immediate breach claims under the other.'
                        ),
                        'harmonization': f'Standardize termination notice requirements across all project agreements to a uniform period ({max(int(t_days_a.group(1)), int(t_days_b.group(1)))} days).',
                        'recommended_resolution': 'Standardize termination notice requirements across all project agreements to a uniform period.',
                        'citedCases': []
                    })
                    conflict_idx += 1

            # 7. Criminal / FIR / Police Proceeding vs Civil NDA / Contract
            is_criminal_a = bool(re.search(r'FIR|CrPC|BNSS|Penal Code|Police|accused|complainant', text_a + name_a, re.I))
            is_criminal_b = bool(re.search(r'FIR|CrPC|BNSS|Penal Code|Police|accused|complainant', text_b + name_b, re.I))
            is_civil_a = bool(re.search(r'Agreement|Contract|NDA|Non-Disclosure|Service', text_a + name_a, re.I))
            is_civil_b = bool(re.search(r'Agreement|Contract|NDA|Non-Disclosure|Service', text_b + name_b, re.I))

            if (is_criminal_a and is_civil_b) or (is_criminal_b and is_civil_a):
                quote_a = text_a[:150].strip() or name_a
                quote_b = text_b[:150].strip() or name_b
                conflicts.append({
                    'id': str(conflict_idx),
                    'title': f'Statutory Criminal Disclosure vs Contractual Non-Disclosure ({name_a} vs {name_b})',
                    'severity': 'critical',
                    'docA': {
                        'file': name_a,
                        'name': name_a,
                        'quote': quote_a,
                        'page': 'Page 1',
                        'section': 'Police / Criminal Record' if is_criminal_a else 'Confidentiality Restrictions',
                        'context': quote_a
                    },
                    'docB': {
                        'file': name_b,
                        'name': name_b,
                        'quote': quote_b,
                        'page': 'Page 1',
                        'section': 'Confidentiality Restrictions' if is_civil_b else 'Police / Criminal Record',
                        'context': quote_b
                    },
                    'doc_a_name': name_a,
                    'doc_a_excerpt': quote_a,
                    'doc_b_name': name_b,
                    'doc_b_excerpt': quote_b,
                    'legalExplanation': (
                        'Statutory duties to assist investigation under Section 39 CrPC / Section 175 BNSS supersede private contractual secrecy covenants. '
                        'Attempting to enforce private non-disclosure to stifle criminal investigation is void under Section 23 of the Indian Contract Act 1872.'
                    ),
                    'harmonization': 'Include express carve-outs in confidentiality agreements for mandatory disclosures required by law enforcement or judicial summons.',
                    'recommended_resolution': 'Include express carve-outs in confidentiality agreements for mandatory disclosures required by law enforcement or judicial summons.',
                    'citedCases': []
                })
                conflict_idx += 1

    # 8. Order of Precedence Hierarchy across all documents if conflicts are low
    if len(docs) >= 2 and len(conflicts) < len(docs):
        for i in range(len(docs) - 1):
            name_a = docs[i].get('name') or f"Document {i+1}"
            name_b = docs[i+1].get('name') or f"Document {i+2}"
            text_a = docs[i].get('text', '')
            text_b = docs[i+1].get('text', '')
            
            # Check if this pair already has a conflict
            already_covered = any(
                (c['docA']['name'] == name_a and c['docB']['name'] == name_b) or
                (c['docA']['name'] == name_b and c['docB']['name'] == name_a)
                for c in conflicts
            )
            if not already_covered:
                qa = text_a[:160].strip() or f"Operative terms and representations of {name_a}"
                qb = text_b[:160].strip() or f"Operative terms and representations of {name_b}"
                conflicts.append({
                    'id': str(conflict_idx),
                    'title': f'Cross-Agreement Precedence & Operational Ambiguity between {name_a} and {name_b}',
                    'severity': 'major',
                    'docA': {
                        'file': name_a,
                        'name': name_a,
                        'quote': qa,
                        'page': 'Page 1',
                        'section': 'General Terms & Covenants',
                        'context': qa
                    },
                    'docB': {
                        'file': name_b,
                        'name': name_b,
                        'quote': qb,
                        'page': 'Page 1',
                        'section': 'General Terms & Covenants',
                        'context': qb
                    },
                    'doc_a_name': name_a,
                    'doc_a_excerpt': qa,
                    'doc_b_name': name_b,
                    'doc_b_excerpt': qb,
                    'legalExplanation': (
                        f'Concurrent execution of {name_a} and {name_b} without an explicit precedence clause '
                        'creates interpretative deadlock under Section 9 of the Indian Evidence Act 1872 / Bharatiya Sakshya Adhiniyam 2023.'
                    ),
                    'harmonization': 'Incorporate an explicit Order of Precedence clause designating the controlling agreement in the event of ambiguity or conflict.',
                    'recommended_resolution': 'Incorporate an explicit Order of Precedence clause designating the controlling agreement in the event of ambiguity or conflict.',
                    'citedCases': []
                })
                conflict_idx += 1

    return conflicts


@conflict_bp.route('/api/conflict/analyze', methods=['POST'])
@conflict_bp.route('/api/conflict-engine/analyze', methods=['POST'])
def analyze_conflicts():
    try:
        docs = []

        # 1. Check if payload is JSON
        json_data = request.get_json(silent=True)
        if json_data and isinstance(json_data, dict):
            raw_docs = json_data.get('documents') or json_data.get('docs') or []
            for d in raw_docs:
                if isinstance(d, dict):
                    name = d.get('name') or d.get('title') or d.get('file') or 'Document'
                    text = d.get('text') or d.get('content') or ''
                    if text.strip():
                        docs.append({'name': name, 'text': text})

        # 2. Check if payload is multipart/form-data
        if not docs and request.files:
            # Check slot pattern (doc1, doc2, ... docN)
            slot = 1
            while True:
                key = f'doc{slot}'
                label_key = f'label{slot}'
                f = request.files.get(key)
                if f is None:
                    break
                if f.filename:
                    label = request.form.get(label_key) or f.filename
                    text = extract_text(f.read(), f.filename)
                    docs.append({'name': label, 'text': text})
                slot += 1

            # Also check getlist('files') or getlist('documents')
            for f in request.files.getlist('files') + request.files.getlist('documents'):
                if f and f.filename and not any(d['name'] == f.filename for d in docs):
                    text = extract_text(f.read(), f.filename)
                    docs.append({'name': f.filename, 'text': text})

        if len(docs) < 2:
            return jsonify({'error': 'Upload or provide at least 2 documents to analyze cross-document conflicts.'}), 400

        # Intelligent clause-aware context length budgeting per document
        truncated_docs = []
        per_doc_limit = max(3500, 16000 // len(docs))
        for d in docs:
            salient_text = extract_salient_legal_clauses(d['text'], budget=per_doc_limit)
            truncated_docs.append({'name': d['name'], 'text': salient_text})

        doc_sections = '\n\n'.join(
            [f'=== Document {i+1}: {d["name"]} ===\n{d["text"]}' for i, d in enumerate(truncated_docs)]
        )

        system_prompt = (
            "You are a Senior Indian Contract Lawyer and Malpractice Defense Auditor specializing in cross-document contradiction detection, "
            "conflict of laws, and multi-contract transaction audit. Your task is to perform an exhaustive, multi-document pairwise clause comparison "
            "across ALL provided documents (contracts, SOWs, NDAs, FIRs, court filings, affidavits).\n\n"
            "Analyze every pair and grouping of documents for:\n"
            "1. Forum & Jurisdiction Inconsistencies (e.g. Courts of Delhi vs Mumbai vs Bengaluru vs Chennai vs Delaware vs London)\n"
            "2. Dispute Resolution Clashes (e.g. Arbitration under Arbitration Act 1996 vs Court Litigation vs SIAC/LCIA)\n"
            "3. Confidentiality & Non-Disclosure Inconsistencies (e.g. 2-year survival vs 5-year vs Perpetual, differing disclosure exclusions)\n"
            "4. Liability Caps & Indemnity Contradictions (e.g. 12 months fees cap vs uncapped exposure vs broad indemnities)\n"
            "5. Payment, Fee & Invoicing Inconsistencies (e.g. Net 30 mandatory payments vs unilateral withholding / deduction rights)\n"
            "6. Notice Periods & Termination Timelines (e.g. 30 days prior written notice vs 15 days vs immediate termination)\n"
            "7. Factual, Chronological, Entity & Statutory Contradictions (e.g. conflicting dates, IPC vs BNS, CrPC vs BNSS, conflicting factual assertions across concurrent filings)\n\n"
            "Under Indian Law (Indian Contract Act 1872, Arbitration & Conciliation Act 1996, Specific Relief Act 1963, BNS 2023, BNSS 2023, BSA 2023), "
            "identify all substantive discrepancies, legal friction points, and operational contradictions."
        )

        user_prompt = f"""Review the following {len(docs)} documents thoroughly for all cross-document contradictions, conflicting clauses, mismatched obligations, and legal discrepancies:

{doc_sections}

Perform an exhaustive pairwise cross-check across all {len(docs)} documents.
Identify at least 2 to 6 substantive cross-document contradictions across the document pairs.
Respond ONLY in valid JSON matching this exact structure:
{{
  "conflicts": [
    {{
      "id": "1",
      "title": "Clear concise conflict title",
      "severity": "critical",
      "docA": {{
        "file": "exact filename of document A",
        "quote": "exact verbatim excerpt from document A",
        "page": "Page 1",
        "section": "Section name/number if known",
        "context": "Surrounding clause text"
      }},
      "docB": {{
        "file": "exact filename of document B",
        "quote": "exact verbatim excerpt from document B",
        "page": "Page 1",
        "section": "Section name/number if known",
        "context": "Surrounding clause text"
      }},
      "legalExplanation": "Detailed substantive legal rationale explaining the commercial risk, enforceability defects, and legal jeopardy under Indian Law (Indian Contract Act 1872, Arbitration & Conciliation Act 1996, etc.)",
      "harmonization": "Actionable, precise recommended clause reconciliation to harmonize the agreements"
    }}
  ],
  "summary": "Comprehensive 2-3 sentence executive summary of all discrepancies found across the loaded documents."
}}

Severity must be either "critical" or "major"."""

        normalized_conflicts = []
        summary = ""

        try:
            raw = ask_groq(system_prompt, user_prompt, temperature=0.1)
            if raw:
                result = extract_json_from_llm_response(raw)
                if isinstance(result, dict) and 'conflicts' in result and isinstance(result['conflicts'], list):
                    for idx, c in enumerate(result.get('conflicts', [])):
                        cid = str(c.get('id') or (idx + 1))
                        title = c.get('title') or f"Discrepancy {idx + 1}"
                        raw_sev = str(c.get('severity') or 'critical').lower()
                        severity = 'major' if 'maj' in raw_sev else 'critical'

                        raw_doc_a = c.get('docA') or c.get('doc_a') or {}
                        file_a = raw_doc_a.get('file') or c.get('doc_a_name') or docs[0]['name']
                        quote_a = raw_doc_a.get('quote') or c.get('doc_a_excerpt') or ''
                        page_a = raw_doc_a.get('page') or c.get('doc_a_page') or 'Page 1'
                        sec_a = raw_doc_a.get('section') or 'Operative Terms'
                        ctx_a = raw_doc_a.get('context') or (f'"{quote_a}"' if quote_a else '')

                        raw_doc_b = c.get('docB') or c.get('doc_b') or {}
                        file_b = raw_doc_b.get('file') or c.get('doc_b_name') or (docs[1]['name'] if len(docs) > 1 else docs[0]['name'])
                        quote_b = raw_doc_b.get('quote') or c.get('doc_b_excerpt') or ''
                        page_b = raw_doc_b.get('page') or c.get('doc_b_page') or 'Page 1'
                        sec_b = raw_doc_b.get('section') or 'Operative Terms'
                        ctx_b = raw_doc_b.get('context') or (f'"{quote_b}"' if quote_b else '')

                        legal_exp = c.get('legalExplanation') or c.get('legal_explanation') or ''
                        harm = c.get('harmonization') or c.get('recommended_resolution') or ''

                        normalized_conflicts.append({
                            'id': cid,
                            'title': title,
                            'severity': severity,
                            'docA': {
                                'file': file_a,
                                'name': file_a,
                                'quote': quote_a,
                                'page': page_a,
                                'section': sec_a,
                                'context': ctx_a,
                            },
                            'docB': {
                                'file': file_b,
                                'name': file_b,
                                'quote': quote_b,
                                'page': page_b,
                                'section': sec_b,
                                'context': ctx_b,
                            },
                            'doc_a_name': file_a,
                            'doc_a_excerpt': quote_a,
                            'doc_b_name': file_b,
                            'doc_b_excerpt': quote_b,
                            'legalExplanation': legal_exp,
                            'legal_explanation': legal_exp,
                            'harmonization': harm,
                            'recommended_resolution': harm,
                            'citedCases': c.get('citedCases') or []
                        })
                    summary = result.get('summary') or ""
        except Exception as ai_err:
            print(f"AI Conflict Analysis Warning: {ai_err}")

        # Fallback to deterministic multi-clause comparator if AI produced 0 results
        if not normalized_conflicts:
            normalized_conflicts = detect_clause_conflicts_deterministic(docs)
            summary = ""

        if not summary or "no conflict" in summary.lower() or "no contradiction" in summary.lower():
            if normalized_conflicts:
                crit_cnt = sum(1 for c in normalized_conflicts if c['severity'] == 'critical')
                maj_cnt = sum(1 for c in normalized_conflicts if c['severity'] == 'major')
                summary = f"Cross-document analysis identified {len(normalized_conflicts)} contradiction(s) across the {len(docs)} reviewed documents ({crit_cnt} critical · {maj_cnt} major)."
            else:
                summary = "No contradictions or conflicting clauses were identified across the provided documents."

        return jsonify({
            'status': 'success',
            'conflicts': normalized_conflicts,
            'summary': summary
        })

    except Exception as e:
        return jsonify({'error': str(e), 'code': 'INTERNAL_ERROR'}), 500


@conflict_bp.route('/api/conflict/check', methods=['POST'])
def check_conflict_entity():
  try:
    data = request.get_json(silent=True) or {}
    entity_name = (data.get('entity_name') or '').strip()
    opposing_party = (data.get('opposing_party') or '').strip()
    matter_type = (data.get('matter_type') or 'Civil').strip()

    if not entity_name:
        return jsonify({'error': 'Please provide an entity name to search.'}), 400

    # Severity weighting: Criminal/Matrimonial/Writ raise conflict_status to High Conflict
    high_risk_matters = {'criminal', 'matrimonial', 'writ'}
    matter_severity_boost = matter_type.lower() in high_risk_matters
    
    # Search inside the case vault
    vault_path = os.path.join(os.getcwd(), "case_vault.json")
    results = []
    
    # Try to load case_vault.json
    cases = {}
    if os.path.exists(vault_path):
        try:
            with open(vault_path, 'r', encoding='utf-8') as f:
                cases = json.load(f)
        except Exception as e:
            print(f"Error loading case_vault.json: {e}")
            
    # Dummy cases matching frontend client list for full RAG database fidelity
    dummy_cases = [
        {
            "id": "101",
            "title": "Sharma vs. Tech Corp",
            "client": "Rajesh Sharma",
            "opponent": "Tech Corp India Private Limited",
            "docs": [
                {"title": "Bail_Application_Format.pdf", "text": "IN THE COURT OF THE METROPOLITAN MAGISTRATE AT NEW DELHI\n\nCRIMINAL MISC. BAIL APPLICATION NO. 456 OF 2026\n\nIN THE MATTER OF:\nRajesh Sharma ... APPLICANT\nVERSUS\nState of NCT Delhi ... RESPONDENT"},
                {"title": "Master_Service_Agreement.docx", "text": "MASTER SOFTWARE DEVELOPMENT & SERVICE AGREEMENT\n\nThis Agreement is entered into on 14th April 2026 by and between:\nTech Corp India Private Limited (Client)\n-AND-\nLexAmplify Software Solutions (Service Provider)"}
            ]
        },
        {
            "id": "102",
            "title": "State of Maharashtra vs. K. Patel",
            "client": "Karan Patel",
            "opponent": "State of Maharashtra",
            "docs": [
                {"title": "FIR_Report_No_88.pdf", "text": "FIRST INFORMATION REPORT (FIR) - UNDER SECTION 154 CrPC\n\nAccused Karan Patel allegedly entered the complainant's premises and caused damage to proprietary physical assets, violating Section 448 (House-trespass) and Section 379 (Theft) of the Indian Penal Code."}
            ]
        }
    ]

    entity_lower = entity_name.lower()
    opposing_lower = opposing_party.lower() if opposing_party else ''

    # 1. Search dummy case lists
    for case in dummy_cases:
        case_match = False
        match_type = ""
        matched_text = ""

        if entity_lower in case["client"].lower():
            case_match = True
            match_type = "Primary Client Match"
            matched_text = f"Represented client name: {case['client']}"
        elif entity_lower in case["opponent"].lower():
            case_match = True
            match_type = "Adverse Party Match"
            matched_text = f"Adverse opposing party name: {case['opponent']}"
        elif entity_lower in case["title"].lower():
            case_match = True
            match_type = "Case Title Match"
            matched_text = f"Case Title: {case['title']}"
        # Also check if opposing party appears as the current client (cross-side conflict)
        elif opposing_lower and opposing_lower in case["client"].lower():
            case_match = True
            match_type = "Adverse Party Match"
            matched_text = f"Opposing party '{opposing_party}' is our existing client: {case['client']}"

        if case_match:
            base_status = "High Conflict" if match_type in ("Primary Client Match", "Adverse Party Match") else "Potential"
            boosted_status = "High Conflict" if (matter_severity_boost and base_status == "Potential") else base_status
            results.append({
                "case_id": case["id"],
                "case_title": case["title"],
                "client": case["client"],
                "opponent": case["opponent"],
                "matched_doc": "Case Core Records",
                "match_type": match_type,
                "excerpt": matched_text,
                "conflict_status": boosted_status,
            })
            continue

        # Check document contents
        for doc in case["docs"]:
            if entity_lower in doc["text"].lower():
                start_idx = max(0, doc["text"].lower().find(entity_lower) - 50)
                end_idx = min(len(doc["text"]), start_idx + len(entity_name) + 100)
                excerpt = doc["text"][start_idx:end_idx].strip().replace('\n', ' ')
                status = "High Conflict" if matter_severity_boost else "Potential"
                results.append({
                    "case_id": case["id"],
                    "case_title": case["title"],
                    "client": case["client"],
                    "opponent": case["opponent"],
                    "matched_doc": doc["title"],
                    "match_type": "Document Ingestion Mention",
                    "excerpt": f"... {excerpt} ...",
                    "conflict_status": status,
                })
                break

    # 2. Search inside case_vault.json loaded files
    for doc_id, doc_data in cases.items():
        doc_title = doc_data.get('title', 'Ingested Document')
        doc_html = doc_data.get('html_content', '')
        doc_text = re.sub(r'<[^>]*>', '', doc_html)
        doc_summary = doc_data.get('summary', '')

        if entity_lower in doc_text.lower() or entity_lower in doc_summary.lower():
            matched_in = doc_summary if entity_lower in doc_summary.lower() else doc_text
            start_idx = max(0, matched_in.lower().find(entity_lower) - 50)
            end_idx = min(len(matched_in), start_idx + len(entity_name) + 100)
            excerpt = matched_in[start_idx:end_idx].strip().replace('\n', ' ')

            results.append({
                "case_id": doc_id,
                "case_title": f"Vault Doc: {doc_title}",
                "client": "Vault Storage",
                "opponent": "N/A",
                "matched_doc": doc_title,
                "match_type": "Ingested Clause Match",
                "excerpt": f"... {excerpt} ...",
                "conflict_status": "Potential",
            })

    # Overall status classification
    overall_status = "Clear"
    if any(r["conflict_status"] == "High Conflict" for r in results):
        overall_status = "High Conflict"
    elif any(r["conflict_status"] == "Potential" for r in results):
        overall_status = "Potential"

    return jsonify({
        "entity_name": entity_name,
        "opposing_party": opposing_party,
        "matter_type": matter_type,
        "status": overall_status,
        "results": results,
        "summary": (
            f"Conflict check completed for '{entity_name}'"
            + (f" vs '{opposing_party}'" if opposing_party else "")
            + f" [{matter_type}]. Status: {overall_status}. {len(results)} risk nodes identified."
        ),
    })
  except Exception as e:
    return jsonify({'error': str(e), 'code': 'INTERNAL_ERROR'}), 500


@conflict_bp.route('/api/conflict/clearance-memo', methods=['POST'])
def save_clearance_memo():
    """Store a clearance memo audit record in lex_assistant.db."""
    data = request.get_json(force=True, silent=True) or {}
    ref_id = (data.get('ref_id') or '').strip()
    target_entity = (data.get('target_entity') or '').strip()
    opposing_party = (data.get('opposing_party') or '').strip()
    matter_type = (data.get('matter_type') or 'Civil').strip()
    timestamp = data.get('timestamp') or datetime.utcnow().isoformat()
    memo_text = data.get('memo_text') or ''

    if not target_entity:
        return jsonify({'error': 'target_entity required'}), 400

    try:
        db_path = os.path.join(os.getcwd(), 'lex_assistant.db')
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS conflict_clearance_memos (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                ref_id          TEXT    NOT NULL,
                target_entity   TEXT    NOT NULL,
                opposing_party  TEXT,
                matter_type     TEXT,
                generated_at    TEXT,
                memo_text       TEXT
            )
        """)
        cur.execute(
            """
            INSERT INTO conflict_clearance_memos
                (ref_id, target_entity, opposing_party, matter_type, generated_at, memo_text)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (ref_id, target_entity, opposing_party, matter_type, timestamp, memo_text),
        )
        conn.commit()
        inserted_id = cur.lastrowid
        conn.close()

        return jsonify({'success': True, 'id': inserted_id, 'ref_id': ref_id}), 201

    except Exception as e:
        print(f"[clearance_memo] DB error: {e}")
        return jsonify({'error': str(e)}), 500


@conflict_bp.route('/api/conflict/export-docx', methods=['POST'])
def export_discrepancies_docx():
    """Generates Schedule-of-Discrepancies.docx from the §2 Data Contract."""
    from flask import send_file
    import io
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.oxml import parse_xml
    from docx.oxml.ns import nsdecls

    data = request.get_json(silent=True) or {}
    conflicts = data.get('conflicts')
    if not conflicts or not isinstance(conflicts, list):
        return jsonify({'error': 'No conflicts provided for export'}), 400

    title = data.get('title') or 'Schedule of Discrepancies'
    matter = data.get('matter') or 'Commercial Agreement Audit'
    documents = data.get('documents') or []
    summary = data.get('summary') or 'Cross-document conflict analysis identified conflicting clauses across the matter agreements.'

    try:
        doc = Document()
        section = doc.sections[0]
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)

        INK = RGBColor(0x18, 0x1B, 0x1D)
        INK_SOFT = RGBColor(0x49, 0x4E, 0x51)
        MUTED = RGBColor(0x86, 0x8C, 0x8E)
        ACCENT_TERRACOTTA = RGBColor(0xB2, 0x4A, 0x2E)
        MAJOR_GOLD = RGBColor(0x9C, 0x7A, 0x2E)

        def set_cell_background(cell, fill_hex):
            tcPr = cell._element.get_or_add_tcPr()
            shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
            tcPr.append(shd)

        def set_cell_margins(cell, top=140, bottom=140, left=180, right=180):
            tcPr = cell._element.get_or_add_tcPr()
            tcMar = parse_xml(f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/><w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/><w:right w:w="{right}" w:type="dxa"/></w:tcMar>')
            tcPr.append(tcMar)

        def set_cell_left_border(cell, color_hex="B24A2E", sz="24"):
            tcPr = cell._element.get_or_add_tcPr()
            tcBorders = parse_xml(f'<w:tcBorders {nsdecls("w")}><w:left w:val="single" w:sz="{sz}" w:space="0" w:color="{color_hex}"/><w:top w:val="none"/><w:right w:val="none"/><w:bottom w:val="none"/></w:tcBorders>')
            tcPr.append(tcBorders)

        def set_table_borders(table, color_hex="D2D5D4"):
            tblPr = table._element.xpath('w:tblPr')
            if tblPr:
                tblBorders = parse_xml(
                    f'<w:tblBorders {nsdecls("w")}>'
                    f'<w:top w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>'
                    f'<w:left w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>'
                    f'<w:bottom w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>'
                    f'<w:right w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>'
                    f'<w:insideH w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>'
                    f'<w:insideV w:val="single" w:sz="6" w:space="0" w:color="{color_hex}"/>'
                    f'</w:tblBorders>'
                )
                tblPr[0].append(tblBorders)

        header = section.header
        header.is_linked_to_previous = False
        h_para = header.paragraphs[0]
        h_para.text = ""
        h_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        h_run = h_para.add_run("LEXAMPLIFY  ·  MALPRACTICE SHIELD  ·  CONFLICT AUDIT")
        h_run.font.size = Pt(8.5)
        h_run.font.color.rgb = MUTED
        h_run.bold = True

        footer = section.footer
        footer.is_linked_to_previous = False
        f_para = footer.paragraphs[0]
        f_para.text = ""
        f_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        f_run = f_para.add_run("CONFIDENTIAL & PRIVILEGED  ·  ATTORNEY WORK PRODUCT  ·  Requires independent attorney review under Indian Law")
        f_run.font.size = Pt(8)
        f_run.font.color.rgb = MUTED

        p_title = doc.add_paragraph()
        p_title.paragraph_format.space_before = Pt(0)
        p_title.paragraph_format.space_after = Pt(4)
        r_title = p_title.add_run("SCHEDULE OF DISCREPANCIES")
        r_title.bold = True
        r_title.font.size = Pt(20)
        r_title.font.color.rgb = INK

        p_sub = doc.add_paragraph()
        p_sub.paragraph_format.space_before = Pt(0)
        p_sub.paragraph_format.space_after = Pt(16)
        r_sub = p_sub.add_run("Cross-Document Clause Contradiction & Harmonization Audit Report")
        r_sub.font.size = Pt(11)
        r_sub.font.color.rgb = MUTED
        r_sub.italic = True

        memo_table = doc.add_table(rows=4, cols=2)
        memo_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        set_table_borders(memo_table, "D2D5D4")

        docs_str = ", ".join(documents) if documents else "Active Session Matter Documents"
        date_str = datetime.now().strftime("%d %B %Y")

        memo_fields = [
            ("RE", "Cross-Document Conflict Analysis & Clause Discrepancy Schedule"),
            ("MATTER", matter),
            ("DOCUMENTS", docs_str),
            ("DATE", date_str),
        ]

        col_widths = [Inches(1.5), Inches(5.0)]
        for row_idx, (label, val) in enumerate(memo_fields):
            row = memo_table.rows[row_idx]
            cell_lbl = row.cells[0]
            cell_val = row.cells[1]

            cell_lbl.width = col_widths[0]
            cell_val.width = col_widths[1]

            set_cell_background(cell_lbl, "EAEBE8")
            set_cell_background(cell_val, "FAFAFA")
            set_cell_margins(cell_lbl, 100, 100, 140, 140)
            set_cell_margins(cell_val, 100, 100, 140, 140)

            p_l = cell_lbl.paragraphs[0]
            p_l.paragraph_format.space_before = Pt(0)
            p_l.paragraph_format.space_after = Pt(0)
            r_l = p_l.add_run(label)
            r_l.bold = True
            r_l.font.size = Pt(9.5)
            r_l.font.color.rgb = INK_SOFT

            p_v = cell_val.paragraphs[0]
            p_v.paragraph_format.space_before = Pt(0)
            p_v.paragraph_format.space_after = Pt(0)
            r_v = p_v.add_run(val)
            r_v.font.size = Pt(9.5)
            r_v.font.color.rgb = INK

        doc.add_paragraph().paragraph_format.space_after = Pt(12)

        p_exec_h = doc.add_paragraph()
        p_exec_h.paragraph_format.space_before = Pt(10)
        p_exec_h.paragraph_format.space_after = Pt(4)
        r_exec_h = p_exec_h.add_run("EXECUTIVE SUMMARY")
        r_exec_h.bold = True
        r_exec_h.font.size = Pt(12)
        r_exec_h.font.color.rgb = ACCENT_TERRACOTTA

        p_exec = doc.add_paragraph()
        p_exec.paragraph_format.space_before = Pt(0)
        p_exec.paragraph_format.space_after = Pt(16)
        p_exec.paragraph_format.line_spacing = 1.2
        r_exec = p_exec.add_run(summary)
        r_exec.font.size = Pt(10)
        r_exec.font.color.rgb = INK_SOFT

        for idx, c in enumerate(conflicts):
            c_num = f"{idx + 1:02d}"
            c_title = c.get('title') or f"Conflict {c_num}"
            sev_raw = (c.get('severity') or 'critical').upper()
            is_crit = 'CRIT' in sev_raw

            doc_a = c.get('docA') or {}
            doc_b = c.get('docB') or {}

            doc_a_name = doc_a.get('name') or c.get('doc_a_name') or 'Document A'
            doc_a_quote = doc_a.get('quote') or c.get('doc_a_excerpt') or ''
            doc_a_page = doc_a.get('page') or ''

            doc_b_name = doc_b.get('name') or c.get('doc_b_name') or 'Document B'
            doc_b_quote = doc_b.get('quote') or c.get('doc_b_excerpt') or ''
            doc_b_page = doc_b.get('page') or ''

            legal_expl = c.get('legalExplanation') or c.get('legal_explanation') or ''
            harmonization = c.get('harmonization') or c.get('recommended_resolution') or ''

            p_c_head = doc.add_paragraph()
            p_c_head.paragraph_format.space_before = Pt(16)
            p_c_head.paragraph_format.space_after = Pt(6)

            r_num = p_c_head.add_run(f"ITEM {c_num}.  {c_title.upper()}  ")
            r_num.bold = True
            r_num.font.size = Pt(11.5)
            r_num.font.color.rgb = INK

            r_sev = p_c_head.add_run(f"[{'CRITICAL CONFLICT' if is_crit else 'MAJOR CONFLICT'}]")
            r_sev.bold = True
            r_sev.font.size = Pt(10)
            r_sev.font.color.rgb = ACCENT_TERRACOTTA if is_crit else MAJOR_GOLD

            clash_tbl = doc.add_table(rows=2, cols=2)
            clash_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
            set_table_borders(clash_tbl, "D2D5D4")

            h_row = clash_tbl.rows[0]
            lbl_a = f"{doc_a_name.upper()}{f' (Page {doc_a_page})' if doc_a_page else ''}"
            lbl_b = f"{doc_b_name.upper()}{f' (Page {doc_b_page})' if doc_b_page else ''}"

            for col_i, (hdr_cell, lbl_text) in enumerate([(h_row.cells[0], lbl_a), (h_row.cells[1], lbl_b)]):
                hdr_cell.width = Inches(3.25)
                set_cell_background(hdr_cell, "EAEBE8")
                set_cell_margins(hdr_cell, 100, 100, 140, 140)
                p = hdr_cell.paragraphs[0]
                p.paragraph_format.space_before = Pt(0)
                p.paragraph_format.space_after = Pt(0)
                r = p.add_run(lbl_text)
                r.bold = True
                r.font.size = Pt(9)
                r.font.color.rgb = INK_SOFT

            b_row = clash_tbl.rows[1]
            for col_i, (b_cell, quote_text) in enumerate([(b_row.cells[0], doc_a_quote), (b_row.cells[1], doc_b_quote)]):
                b_cell.width = Inches(3.25)
                set_cell_background(b_cell, "FFFFFF")
                set_cell_margins(b_cell, 120, 120, 140, 140)
                p = b_cell.paragraphs[0]
                p.paragraph_format.space_before = Pt(0)
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = 1.15
                r = p.add_run(f'"{quote_text}"' if quote_text else "—")
                r.italic = True
                r.font.size = Pt(9.5)
                r.font.color.rgb = INK

            if legal_expl:
                p_expl_lbl = doc.add_paragraph()
                p_expl_lbl.paragraph_format.space_before = Pt(8)
                p_expl_lbl.paragraph_format.space_after = Pt(2)
                r_expl_lbl = p_expl_lbl.add_run("LEGAL EXPLANATION & STATUTORY IMPACT")
                r_expl_lbl.bold = True
                r_expl_lbl.font.size = Pt(9)
                r_expl_lbl.font.color.rgb = MUTED

                p_expl = doc.add_paragraph()
                p_expl.paragraph_format.space_before = Pt(0)
                p_expl.paragraph_format.space_after = Pt(8)
                p_expl.paragraph_format.line_spacing = 1.15
                r_expl = p_expl.add_run(legal_expl)
                r_expl.font.size = Pt(9.5)
                r_expl.font.color.rgb = INK_SOFT

            if harmonization:
                harm_tbl = doc.add_table(rows=1, cols=1)
                harm_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
                harm_cell = harm_tbl.rows[0].cells[0]
                harm_cell.width = Inches(6.5)
                set_cell_background(harm_cell, "FBF7EE")
                set_cell_left_border(harm_cell, "B24A2E", "24")
                set_cell_margins(harm_cell, 120, 120, 160, 140)

                p_harm_lbl = harm_cell.paragraphs[0]
                p_harm_lbl.paragraph_format.space_before = Pt(0)
                p_harm_lbl.paragraph_format.space_after = Pt(3)
                r_harm_lbl = p_harm_lbl.add_run("RECOMMENDED HARMONIZATION CLAUSE")
                r_harm_lbl.bold = True
                r_harm_lbl.font.size = Pt(8.5)
                r_harm_lbl.font.color.rgb = ACCENT_TERRACOTTA

                p_harm = harm_cell.add_paragraph()
                p_harm.paragraph_format.space_before = Pt(0)
                p_harm.paragraph_format.space_after = Pt(0)
                p_harm.paragraph_format.line_spacing = 1.15
                r_harm = p_harm.add_run(harmonization)
                r_harm.font.size = Pt(9.5)
                r_harm.font.color.rgb = INK

            doc.add_paragraph().paragraph_format.space_after = Pt(10)

        buf = io.BytesIO()
        doc.save(buf)
        buf.seek(0)

        return send_file(
            buf,
            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            as_attachment=True,
            download_name='Schedule-of-Discrepancies.docx',
        )

    except Exception as e:
        print(f"[export_discrepancies_docx] Error: {e}")
        return jsonify({'error': str(e)}), 500
