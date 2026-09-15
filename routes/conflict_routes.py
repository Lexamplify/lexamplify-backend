"""
routes/conflict_routes.py
Cross-Document Conflict Engine — upload up to 3 docs, find contradictions with AI.
"""
import os
import json
import re
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify, render_template, current_app
from litellm import completion
from utils.ai_helper import extract_json_from_llm_response

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
    try:
        from utils.pdf_helper import extract_text_for_summary
        ext = filename.rsplit('.', 1)[-1].lower()
        return extract_text_for_summary(file_bytes, ext)
    except Exception as e:
        return file_bytes.decode('utf-8', errors='ignore')


@conflict_bp.route('/conflict-engine')
def conflict_engine():
    return render_template('conflict_engine.html')


@conflict_bp.route('/api/conflict/analyze', methods=['POST'])
@conflict_bp.route('/api/conflict-engine/analyze', methods=['POST'])
def analyze_conflicts():
    try:
        from utils.ai_helper import ask_groq
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

        # Context length control per document
        truncated_docs = []
        per_doc_limit = max(1500, 7000 // len(docs))
        for d in docs:
            text = d['text']
            if len(text) > per_doc_limit:
                text = text[:per_doc_limit] + '\n... [truncated for token budget]'
            truncated_docs.append({'name': d['name'], 'text': text})

        doc_sections = '\n\n'.join(
            [f'=== Document {i+1}: {d["name"]} ===\n{d["text"]}' for i, d in enumerate(truncated_docs)]
        )

        system_prompt = (
            "You are an expert Indian contract lawyer and legal auditor. Your role is to perform rigorous cross-document "
            "clause analysis across multiple agreements governing a commercial, civil, or employment relationship. "
            "Identify real legal and commercial contradictions, conflicting notice periods, conflicting jurisdiction clauses, "
            "contradictory liability caps, inconsistent payment terms, IP ownership disputes, and confidentiality mismatches under Indian Law."
        )

        user_prompt = f"""Review the following {len(docs)} documents for contradictions and conflicting clauses:

{doc_sections}

Identify ALL direct conflicts and contradictions between these documents.
For each conflict found, respond ONLY in valid JSON matching this exact structure:
{{
  "conflicts": [
    {{
      "id": "1",
      "title": "Clear concise conflict title",
      "severity": "critical",
      "docA": {{
        "file": "exact filename of document A",
        "quote": "exact verbatim excerpt from document A",
        "page": "page reference if mentioned in text, otherwise omit or empty",
        "section": "section name/number if mentioned in text",
        "context": "surrounding paragraph context if available"
      }},
      "docB": {{
        "file": "exact filename of document B",
        "quote": "exact verbatim excerpt from document B",
        "page": "page reference if mentioned in text, otherwise omit or empty",
        "section": "section name/number if mentioned in text",
        "context": "surrounding paragraph context if available"
      }},
      "legalExplanation": "Substantive legal rationale explaining the commercial risk and enforceability issues under Indian contract law (Indian Contract Act 1872, Arbitration and Conciliation Act 1996, etc.)",
      "harmonization": "Actionable recommended clause reconciliation to resolve the contradiction"
    }}
  ],
  "summary": "Overall 2-sentence executive summary of the discrepancies found across the agreements."
}}

Severity must be either "critical" or "major".
If no conflicts or contradictions exist between the documents, respond with:
{{"conflicts": [], "summary": "No contradictions or conflicting clauses were identified across the provided documents."}}
"""

        raw = ask_groq(system_prompt, user_prompt)
        if not raw:
            return jsonify({'error': 'AI analysis failed to generate a response. Please try again.', 'code': 'LLM_EMPTY_RESPONSE'}), 502

        result = extract_json_from_llm_response(raw)
        if not isinstance(result, dict) or 'conflicts' not in result:
            return jsonify({
                'error': 'AI returned an unparseable conflict analysis.',
                'code': 'LLM_JSON_PARSE_ERROR',
                'raw': raw[:1500],
            }), 502

        # Normalize conflicts for dual schema compatibility
        normalized_conflicts = []
        for idx, c in enumerate(result.get('conflicts', [])):
            cid = str(c.get('id') or (idx + 1))
            title = c.get('title') or f"Discrepancy {idx + 1}"
            raw_sev = str(c.get('severity') or 'critical').lower()
            severity = 'major' if 'maj' in raw_sev else 'critical'

            # Extract docA
            raw_doc_a = c.get('docA') or c.get('doc_a') or {}
            file_a = raw_doc_a.get('file') or c.get('doc_a_name') or docs[0]['name']
            quote_a = raw_doc_a.get('quote') or c.get('doc_a_excerpt') or ''
            page_a = raw_doc_a.get('page') or c.get('doc_a_page') or ''
            sec_a = raw_doc_a.get('section') or ''
            ctx_a = raw_doc_a.get('context') or (f'"{quote_a}"' if quote_a else '')

            # Extract docB
            raw_doc_b = c.get('docB') or c.get('doc_b') or {}
            file_b = raw_doc_b.get('file') or c.get('doc_b_name') or (docs[1]['name'] if len(docs) > 1 else docs[0]['name'])
            quote_b = raw_doc_b.get('quote') or c.get('doc_b_excerpt') or ''
            page_b = raw_doc_b.get('page') or c.get('doc_b_page') or ''
            sec_b = raw_doc_b.get('section') or ''
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
                # Legacy keys for backward compatibility
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

        summary = result.get('summary') or (
            f"Cross-document analysis identified {len(normalized_conflicts)} conflict(s) across the reviewed agreements."
            if normalized_conflicts else "No contradictions or conflicting clauses were identified across the provided documents."
        )

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
            # Matter severity boost: high-risk matters escalate Potential → High Conflict
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
            continue  # skip deep doc matching if metadata matched

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

        # Create table if not exists (idempotent)
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

        # ── Color constants matching Slate & Rust palette ──
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

        # ── Header & Footer ──
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

        # ── Document Title / Masthead ──
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

        # ── Memo Block Table ──
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

        # ── Executive Summary ──
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

        # ── Conflicts Section ──
        for idx, c in enumerate(conflicts):
            c_num = f"{idx + 1:02d}"
            c_title = c.get('title') or f"Conflict {c_num}"
            sev_raw = (c.get('severity') or 'critical').upper()
            is_crit = 'CRIT' in sev_raw

            # Canonical Data extraction from §2 Data Contract
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

            # Conflict Title
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

            # Two-Column Clash Comparison Table
            clash_tbl = doc.add_table(rows=2, cols=2)
            clash_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
            set_table_borders(clash_tbl, "D2D5D4")

            # Row 0: Headers
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

            # Row 1: Excerpts
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

            # Legal Explanation Block
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

            # Recommended Harmonization Callout Box (Left Accent Rule)
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

        # ── Return generated docx stream ──
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

