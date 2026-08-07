"""
celery_app.py
Strict Flask Application Factory integration (per Flask's official Celery
guide): FlaskTask wraps every task execution in app.app_context() so tasks
can use current_app, the DB, extensions, etc. exactly like a request would.
"""
from celery import Celery, Task


def celery_init_app(app):
    class FlaskTask(Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery_app = Celery(app.name, task_cls=FlaskTask)
    celery_app.config_from_object(dict(
        broker_url=app.config["CELERY_BROKER_URL"],
        result_backend=app.config["CELERY_RESULT_BACKEND"],
        task_ignore_result=False,
        result_expires=3600,
        task_track_started=True,
        broker_connection_retry_on_startup=True,
    ))
    celery_app.set_default()
    app.extensions["celery"] = celery_app
    return celery_app
