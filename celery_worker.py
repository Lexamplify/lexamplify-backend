"""
celery_worker.py
Local worker entrypoint — runs in the existing venv, NOT in Docker, so it
shares every dependency (groq, litellm, pdf helpers, etc.) with the Flask
process. Redis (broker + result backend) is the only Dockerized piece.

Run:
    celery -A celery_worker.celery worker --loglevel=info --pool=solo
    (--pool=solo is required on Windows; drop it on Linux/macOS for the
    default prefork pool.)
"""
from app import create_app
from celery_app import celery_init_app

flask_app = create_app()
celery = celery_init_app(flask_app)

# Import task modules so they register with the Celery app instance above —
# @shared_task bodies aren't visible to the worker until their module loads.
import tasks.contract_tasks  # noqa: E402,F401
import tasks.library_tasks  # noqa: E402,F401
