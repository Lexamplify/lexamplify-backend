"""
routes/conflict_routes.py
Cross-Document Conflict Engine — upload up to 3 docs, find contradictions with AI.
"""
import os
import json
import re
from flask import Blueprint, request, jsonify, render_template, current_app
from litellm import completion

conflict_bp = Blueprint('conflict', __name__)

MODEL_NAME = "groq/llama-3.3-70b-versatile"


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
def analyze_conflicts():
    docs = []
    for i in range(1, 4):
        key = f'doc{i}'
        label_key = f'label{i}'
        f = request.files.get(key)
        if f and f.filename:
            label = request.form.get(label_key) or f.filename
            text = extract_text(f.read(), f.filename)
            # Truncate to prevent context exhaustion
            if len(text) > 3500:
                text = text[:3500] + '\n... [truncated]'
            docs.append({'name': label, 'text': text})

    if len(docs) < 2:
        return jsonify({'error': 'Upload at least 2 documents to analyze conflicts.'}), 400

    doc_sections = '\n\n'.join(
        [f'Document {i+1} ({d["name"]}):\n{d["text"]}' for i, d in enumerate(docs)]
    )

    prompt = f"""You are an expert Indian contract lawyer reviewing multiple legal documents for conflicts.

{doc_sections}

Identify ALL conflicts, contradictions, and inconsistencies between these documents.
For each conflict found, respond ONLY in this exact JSON format (no markdown, no extra text):
{{
  "conflicts": [
    {{
      "title": "conflict title",
      "severity": "Critical",
      "doc_a_name": "document name",
      "doc_a_excerpt": "exact conflicting text from doc A",
      "doc_b_name": "document name",
      "doc_b_excerpt": "exact conflicting text from doc B",
      "legal_explanation": "why this matters under Indian law",
      "recommended_resolution": "AI suggested harmonized clause"
    }}
  ],
  "summary": "overall conflict summary in 2 sentences"
}}

Severity must be exactly one of: Critical, Major, Minor.
Common conflicts: different confidentiality durations, different jurisdiction clauses, conflicting termination notice periods, contradictory payment terms, IP ownership contradictions, different governing law clauses.
If no conflicts are found, return an empty conflicts array with a summary explaining this."""

    raw = ask_llm(prompt)
    if not raw:
        return jsonify({'error': 'AI analysis failed. Try again.'}), 500

    # Strip markdown fences
    cleaned = re.sub(r'```json\s*|\s*```', '', raw).strip()
    try:
        result = json.loads(cleaned)
    except Exception:
        # Try to extract JSON object from the response
        match = re.search(r'\{[\s\S]+\}', cleaned)
        if match:
            try:
                result = json.loads(match.group())
            except Exception:
                result = {
                    'conflicts': [],
                    'summary': 'Could not parse AI response. Raw output returned.',
                    'raw': cleaned[:2000],
                }
        else:
            result = {
                'conflicts': [],
                'summary': 'AI returned an unstructured response.',
                'raw': cleaned[:2000],
            }

    return jsonify(result)


@conflict_bp.route('/api/conflict/check', methods=['POST'])
def check_conflict_entity():
    data = request.get_json() or {}
    entity_name = data.get('entity_name', '').strip()
    if not entity_name:
        return jsonify({'error': 'Please provide an entity name to search.'}), 400
    
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
            
        if case_match:
            results.append({
                "case_id": case["id"],
                "case_title": case["title"],
                "client": case["client"],
                "opponent": case["opponent"],
                "matched_doc": "Case Core Records",
                "match_type": match_type,
                "excerpt": matched_text,
                "conflict_status": "High Conflict"
            })
            continue # skip deep doc matching if metadata matches
            
        # Check document contents
        for doc in case["docs"]:
            if entity_lower in doc["text"].lower():
                start_idx = max(0, doc["text"].lower().find(entity_lower) - 50)
                end_idx = min(len(doc["text"]), start_idx + len(entity_name) + 100)
                excerpt = doc["text"][start_idx:end_idx].strip().replace('\n', ' ')
                results.append({
                    "case_id": case["id"],
                    "case_title": case["title"],
                    "client": case["client"],
                    "opponent": case["opponent"],
                    "matched_doc": doc["title"],
                    "match_type": "Document Ingestion Mention",
                    "excerpt": f"... {excerpt} ...",
                    "conflict_status": "Potential"
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
                "conflict_status": "Potential"
            })
            
    # Calculate overall status classification
    overall_status = "Clear"
    if any(r["conflict_status"] == "High Conflict" for r in results):
        overall_status = "High Conflict"
    elif any(r["conflict_status"] == "Potential" for r in results):
        overall_status = "Potential"
        
    return jsonify({
        "entity_name": entity_name,
        "status": overall_status,
        "results": results,
        "summary": f"Conflict check completed for '{entity_name}'. Overall status is {overall_status} with {len(results)} potential risk nodes identified."
    })
