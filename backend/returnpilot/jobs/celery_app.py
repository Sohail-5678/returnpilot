"""Celery app: Redis broker, no result backend (job state lives in Postgres `jobs`)."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from returnpilot.config import get_settings

settings = get_settings()

celery_app = Celery("returnpilot", broker=settings.redis_url, include=["returnpilot.jobs.tasks"])
celery_app.conf.update(
    task_ignore_result=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=200,
    broker_connection_retry_on_startup=True,
    broker_transport_options={"visibility_timeout": 600},
    timezone="UTC",
    beat_schedule={
        "expire-approvals": {"task": "returnpilot.jobs.tasks.expire_approvals", "schedule": 15 * 60},
        "retention-cleanup": {
            "task": "returnpilot.jobs.tasks.retention_cleanup",
            "schedule": crontab(hour=3, minute=17),
        },
    },
)
