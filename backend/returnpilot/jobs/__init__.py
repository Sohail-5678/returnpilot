"""Celery jobs (SPEC §4.3). `celery -A returnpilot.jobs worker` finds the app here."""

from returnpilot.jobs.celery_app import celery_app

app = celery_app

__all__ = ["app", "celery_app"]
