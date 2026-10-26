"""
routes/legal_research_routes.py - Dual-Brain legal research and the
case-vault document read path.

Blueprint: no prefix (the public paths are absolute and stay byte-identical)
  POST /api/legal-research
  GET  /api/legal-research/document/<string:case_id>
"""
import os

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

legal_research_bp = Blueprint("legal_research", __name__)


@legal_research_bp.route('/api/legal-research', methods=['POST', 'OPTIONS'])
def api_legal_research():
    import app as app_module

    if request.method == 'OPTIONS':
        return jsonify({}), 200

    data = request.get_json(force=True, silent=True) or {}
    lawyer_question = data.get('question', '').strip()

    if not lawyer_question:
        return jsonify({"error": True, "message": "Question cannot be empty."}), 400

    try:
        # 1. Initialize Pinecone & Groq using existing .env keys
        pc = app_module.Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
        index = app_module._get_pinecone_index(pc)
        namespace = os.getenv("PINECONE_NAMESPACE", "legal-cases")
        groq_client = app_module.Groq(api_key=os.getenv("GROQ_API_KEY"))

        # 2. Embed the question and query the raw vector index — worker.py
        # ingests via index.upsert() with real metadata (case_id, year,
        # chunk_index, text), not via Pinecone's integrated-inference
        # records API, so matches carry .metadata directly instead of
        # needing the id string parsed apart.
        embed_response = pc.inference.embed(
            model=app_module.EMBED_MODEL,
            inputs=[lawyer_question],
            parameters={"input_type": "query", "truncate": "END"},
        )
        query_vector = embed_response[0].values

        # top_k=10 (not 2) deliberately over-fetches chunks so dedup below
        # has multiple same-case chunks to actually collapse — a small
        # top_k would rarely return more than one chunk per case anyway,
        # making the dedup step a no-op.
        pinecone_results = index.query(
            vector=query_vector,
            top_k=10,
            include_metadata=True,
            namespace=namespace,
        )

        context_chunks = []
        sources = []
        seen_cases = set()

        for match in (pinecone_results.matches or []):
            metadata = match.metadata or {}
            case_id = metadata.get('case_id') or match.id

            text = metadata.get('text', '')
            if text:
                context_chunks.append(text)

            # CRITICAL DEDUPLICATION — a case can have hundreds of chunks;
            # without this, the same case would flood the UI as N
            # identical-looking source cards.
            if case_id in seen_cases:
                continue
            seen_cases.add(case_id)

            sources.append({
                "case_id": case_id,
                "title": app_module.format_case_title(case_id),
                "year": metadata.get('year', ''),
                "snippet": text[:200],
            })

        context_text = "\n\n".join(context_chunks)

        if not context_chunks:
            return jsonify({
                "status": "success",
                "answer": "I couldn't find any relevant precedents in the Firm Library regarding this query.",
                "sources": []
            }), 200

        # 3. Generate Answer using Groq
        system_prompt = (
            "You are an expert senior legal counsel in India. Analyze the following legal fragments "
            "and answer the user's question precisely based *only* on the context provided. If the "
            "context doesn't contain the answer, state that clearly."
        )

        user_prompt = f"Context:\n{context_text}\n\nQuestion: {lawyer_question}"

        chat_completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            model="llama-3.1-8b-instant",
            temperature=0.2,
        )

        ai_answer = chat_completion.choices[0].message.content

        return jsonify({
            "status": "success",
            "answer": ai_answer,
            "sources": sources
        }), 200

    except Exception as e:
        print(f"[PINECONE ERROR] {e}")
        return jsonify({
            "answer": "I am currently unable to access the legal database. Please try again later.",
            "context": []
        }), 200


@legal_research_bp.route('/api/legal-research/document/<string:case_id>', methods=['GET', 'OPTIONS'])
@jwt_required()
def api_legal_research_document(case_id):
    import app as app_module

    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()

    # Strict allow-list validation — case_id arrives as a raw URL path
    # segment, so this is the only thing standing between an attacker and
    # a crafted "../" or SQL-metacharacter payload reaching the query.
    if not app_module.CASE_ID_RE.match(case_id):
        return jsonify({"error": True, "message": "Invalid case_id format."}), 400

    try:
        conn = app_module.db
        c = conn.cursor()
        c.execute(
            "SELECT title, content FROM case_vault WHERE case_id = ? AND (user_id = ? OR is_public = 1) "
            "ORDER BY created_at DESC LIMIT 1",
            (case_id, uid)
        )
        row = c.fetchone()

        if not row:
            return jsonify({"error": True, "message": f"Document with case_id '{case_id}' not found."}), 404

        title, content = row
        return jsonify({"title": title, "full_text": content}), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": True, "message": str(e)}), 500
