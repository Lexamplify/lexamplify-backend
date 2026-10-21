# LexAmplify — Backend

Flask API for the LexAmplify legal‑AI platform: case/matter management, a document
vault, AI drafting, contract review, legal research (Pinecone + LLM), cause‑list /
eCourts sync, and a document‑management system. Background work runs on Celery +
Redis; data lives in Postgres (Neon) with a thread‑local SQLite layer for the vault.

The React frontend lives in [`frontend/`](frontend/) (see its own README).

---

## Project layout

```
app.py                  Application factory (create_app) — config, extensions, blueprint registration
database.py             SQLAlchemy db instance
worker.py               Background ingestion worker
celery_app.py           Celery app
gunicorn.conf.py        Production WSGI config (loads create_app)
docker-compose.yml      Local Redis

routes/                 Flask blueprints (auth, ai, billing, contract, court, dms_*, lpms_*,
                        matter, vault_workspace, library, sso, team, …) — 31 modules
services/               Scrapers & data seeders (court_scraper, supreme_court_seeder, …)
tasks/                  Celery tasks (contract_tasks, library_tasks)
utils/                  Shared utilities (auth, limiter, dms_*, pinecone, pdf, …)
models/                 SQLAlchemy models
rag_server/             RAG / vector pipeline
templates/  static/     Server‑rendered pages & assets
data/                   Seed JSON (districts, dispute catalog, cases)
scripts/                Standalone ingestion / maintenance scripts
tests/                  Unit + e2e tests and fixtures
docs/                   Documentation — see BACKEND_REFACTOR_PLAN.md
```

> `app.py` is large (≈5k lines) because it still defines ~46 route handlers inline.
> A step‑by‑step plan to move those into the existing `routes/` blueprints and slim
> the factory to ~250 lines is in [`docs/BACKEND_REFACTOR_PLAN.md`](docs/BACKEND_REFACTOR_PLAN.md).

---

## Running locally

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                 # then fill in secrets

docker compose up -d redis                           # background queue
flask --app app:create_app run                       # dev server
# or production:  gunicorn -c gunicorn.conf.py "app:create_app()"

celery -A celery_app.celery worker --loglevel=info   # background worker (separate shell)
```

Configuration (DB URL, JWT secret, Pinecone/Groq/Tavily keys, etc.) is read from
`.env` — see `.env.example`. With no `DATABASE_URL`, the app falls back to local
SQLite.

---

## Repository hygiene

A committed Python virtualenv (`rag_venv/`, 8,935 files), local backup folders
(`_backup_before_*`, `_vw_scratch`, `Claude outputs/`), the runtime vector store
(`chroma_data/`) and stray FS artifacts (`.fuse_hidden*`) were removed from version
control — tracked files dropped from ~9,600 to ~500. `.gitignore` now prevents them
from returning. **Never commit virtualenvs, vector‑store data, or `.env` files.**
