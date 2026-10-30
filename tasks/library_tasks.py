"""
tasks/library_tasks.py
Celery task: async ratio-decidendi headnote generation for a Firm Library
document — same bind=True + self.update_state() progress pattern as
tasks/contract_tasks.py, registered on the same Celery app via the strict
Flask-factory integration in celery_app.py.
"""
import sqlite3

from celery import shared_task

DB_PATH = "lex_assistant.db"


@shared_task(bind=True)
def generate_headnote_task(self, doc_id):
    from utils.ai_helper import ask_groq

    def report(status, progress):
        self.update_state(state='PROGRESS', meta={'status': status, 'progress': progress})

    report('Loading document...', 10)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT id, title, content FROM case_vault WHERE id = ?", (doc_id,)).fetchone()
        if not row:
            raise ValueError(f"Document {doc_id} not found.")
        title = row["title"] or ""
        content = (row["content"] or "")[:12000]
    finally:
        conn.close()

    if not content.strip():
        raise ValueError("Document has no content to summarize.")

    report('Drafting ratio decidendi...', 40)
    system_prompt = (
        "You are an expert Indian legal editor. Read the judgment/document text and write "
        "a concise ratio decidendi headnote (2-4 sentences) — the core legal principle the "
        "document establishes or relies on. Plain English, no markdown, no preamble."
    )
    headnote = ask_groq(system_prompt, f"Title: {title}\n\nDocument Text:\n{content}")
    headnote = (headnote or "").strip()
    if not headnote:
        raise ValueError("AI returned an empty headnote.")

    report('Saving headnote...', 90)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("UPDATE case_vault SET ratio_headnote = ? WHERE id = ?", (headnote, doc_id))
        conn.commit()
    finally:
        conn.close()

    report('Done', 100)
    return {"id": doc_id, "ratio_headnote": headnote}
