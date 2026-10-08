"""Side-effect jobs (all simulated: no real payments or emails) and scheduled maintenance.

Lifecycle: queued → running → succeeded | retrying → dead (exponential backoff + jitter, max 5).
The worker imports only the DB layer, never the agent/LLM stack, to stay small in memory.
"""

from __future__ import annotations

import hashlib
import logging
import os
import random
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from celery.signals import worker_ready
from sqlalchemy import select, text, update

from returnpilot.config import get_settings
from returnpilot.db.models import Approval, Job, OutboxEmail, Refund, Return
from returnpilot.db.session import sync_session
from returnpilot.events import publish_sync
from returnpilot.jobs.celery_app import celery_app

log = logging.getLogger(__name__)
MAX_ATTEMPTS = 5


def _label_code(seed: str) -> str:
    digest = hashlib.sha256(seed.encode()).hexdigest().upper()
    return f"RP-{digest[:4]}-{digest[4:8]}"


def _action_event(
    kind: str, status: str, label: str, amount: float | None, order_number: int | None, detail: str, ident: str
) -> dict[str, Any]:
    return {
        "id": ident,
        "kind": kind,
        "status": status,
        "label": label,
        "amount": amount,
        "order_number": order_number,
        "updated_at": datetime.now(UTC).isoformat(),
        "detail": detail,
    }


def _process_refund(job: Job) -> None:
    p = job.payload
    if not get_settings().celery_eager:
        time.sleep(random.uniform(1.0, 2.5))  # simulated payment-provider latency
    with sync_session() as s:
        refund = s.get(Refund, uuid.UUID(p["refund_id"]))
        if refund is None:
            raise RuntimeError("refund row missing")
        if refund.status != "issued":
            refund.status = "issued"
            refund.updated_at = datetime.now(UTC)
            s.add(
                OutboxEmail(
                    customer_id=refund.customer_id,
                    subject=f"Your refund of ${float(refund.amount):,.2f} is on its way",
                    body=f"We've issued a refund of ${float(refund.amount):,.2f} for {p.get('item_name', 'your item')} "
                    f"(order #{p.get('order_number')}). This is a simulated demo email.",
                )
            )
    publish_sync(
        p.get("thread_id"),
        "action",
        _action_event(
            "refund",
            "succeeded",
            f"Refund ${float(p['amount']):,.2f} · {p.get('item_name', '')}",
            float(p["amount"]),
            p.get("order_number"),
            "Refund issued (simulated)",
            p["refund_id"],
        ),
    )


def _create_return_label(job: Job) -> None:
    p = job.payload
    if not get_settings().celery_eager:
        time.sleep(random.uniform(0.5, 1.2))
    with sync_session() as s:
        ret = s.get(Return, uuid.UUID(p["return_id"]))
        if ret is None:
            raise RuntimeError("return row missing")
        if ret.status in ("requested", "pending_approval"):
            ret.status = "label_created"
            ret.label_code = ret.label_code or _label_code(str(ret.id))
            ret.updated_at = datetime.now(UTC)
            s.add(
                OutboxEmail(
                    customer_id=ret.customer_id,
                    subject=f"Your return label {ret.label_code}",
                    body=f"Drop {p.get('item_name', 'your item')} off at any store or ship it with label "
                    f"{ret.label_code}. This is a simulated demo email.",
                )
            )
        code = ret.label_code
    publish_sync(
        p.get("thread_id"),
        "action",
        _action_event(
            "return",
            "succeeded",
            f"Return · {p.get('item_name', '')}",
            None,
            p.get("order_number"),
            f"Return label {code} created (simulated)",
            p["return_id"],
        ),
    )


HANDLERS = {"process_refund": _process_refund, "create_return_label": _create_return_label}


@celery_app.task(name="returnpilot.jobs.tasks.run_job", bind=True, max_retries=MAX_ATTEMPTS, acks_late=True)
def run_job(self: Any, job_id: str) -> None:
    with sync_session() as s:
        job = s.get(Job, uuid.UUID(job_id))
        if job is None:
            log.warning("job %s not found", job_id)
            return
        if job.status in ("succeeded", "dead"):
            return  # idempotent: already done
        dup = s.scalar(
            select(Job).where(Job.idempotency_key == job.idempotency_key, Job.status == "succeeded", Job.id != job.id)
        )
        if dup:
            job.status = "succeeded"
            return
        job.status, job.attempts, job.updated_at, job.celery_task_id = (
            "running",
            job.attempts + 1,
            datetime.now(UTC),
            self.request.id,
        )
        s.flush()
        s.expunge(job)
    try:
        HANDLERS[job.kind](job)
    except Exception as exc:
        attempts = job.attempts
        final = attempts >= MAX_ATTEMPTS
        with sync_session() as s:
            s.execute(
                update(Job)
                .where(Job.id == job.id)
                .values(status="dead" if final else "retrying", last_error=str(exc)[:500], updated_at=datetime.now(UTC))
            )
        if final:
            publish_sync(
                job.payload.get("thread_id"),
                "action",
                {
                    "id": job_id,
                    "kind": job.kind,
                    "status": "failed",
                    "detail": "Processing failed; a team member will follow up.",
                },
            )
            return
        countdown = min(300, 2**attempts) + random.uniform(0, 1.5)
        raise self.retry(exc=exc, countdown=countdown) from exc
    with sync_session() as s:
        s.execute(
            update(Job)
            .where(Job.id == job.id)
            .values(status="succeeded", last_error=None, updated_at=datetime.now(UTC))
        )


def enqueue_jobs(job_ids: list[str]) -> None:
    if get_settings().celery_eager:  # eval adapter: side effects complete within the case
        for jid in job_ids:
            run_job.apply(args=[jid])
        return
    for jid in job_ids:
        try:
            celery_app.send_task("returnpilot.jobs.tasks.run_job", args=[jid], task_id=jid)
        except Exception as exc:  # noqa: BLE001 - reconcile picks queued jobs up later
            log.error("could not enqueue job %s: %s", jid, exc)


def reconcile_jobs(older_than_s: int = 120) -> int:
    """Re-enqueue jobs stuck in queued/retrying (Redis is ephemeral in the container)."""
    cutoff = datetime.now(UTC) - timedelta(seconds=older_than_s)
    with sync_session() as s:
        ids = [
            str(j)
            for j in s.scalars(
                select(Job.id).where(Job.status.in_(("queued", "retrying", "running")), Job.updated_at < cutoff)
            ).all()
        ]
    enqueue_jobs(ids)
    return len(ids)


@celery_app.task(name="returnpilot.jobs.tasks.expire_approvals")
def expire_approvals() -> int:
    """Pending approvals past their deadline are expired; the API resumes each graph with 'expired'."""
    s_ = get_settings()
    with sync_session() as s:
        ids = [
            str(a)
            for a in s.scalars(
                select(Approval.id).where(Approval.status == "pending", Approval.expires_at < datetime.now(UTC))
            ).all()
        ]
    port = int(os.environ.get("WEB_PORT") or os.environ.get("PORT") or "10000")
    for approval_id in ids:
        try:
            httpx.post(
                f"http://127.0.0.1:{port}/internal/approvals/{approval_id}/expire",
                headers={"X-Cron-Token": s_.cron_token},
                timeout=30,
            ).raise_for_status()
        except Exception as exc:  # noqa: BLE001 - fall back to a DB-only expiry
            log.warning("API expiry failed for %s (%s); expiring in DB only", approval_id, exc)
            with sync_session() as s:
                s.execute(
                    update(Approval)
                    .where(Approval.id == uuid.UUID(approval_id), Approval.status == "pending")
                    .values(status="expired", decided_at=datetime.now(UTC), decision={"decision": "expired"})
                )
                s.execute(
                    update(Refund)
                    .where(Refund.approval_id == uuid.UUID(approval_id), Refund.status == "pending_approval")
                    .values(status="expired")
                )
                s.execute(
                    update(Return)
                    .where(Return.approval_id == uuid.UUID(approval_id), Return.status == "pending_approval")
                    .values(status="expired")
                )
    return len(ids)


@celery_app.task(name="returnpilot.jobs.tasks.retention_cleanup")
def retention_cleanup() -> dict[str, int]:
    """Keep the free 1 GB database small: drop demo sandboxes, threads and traces older than N days."""
    days = get_settings().retention_days
    out: dict[str, int] = {}
    with sync_session() as s:
        for name, sql in {
            "workspaces": "DELETE FROM customers WHERE workspace_id IS NOT NULL AND created_at < now() - make_interval(days => :d)",
            "app_users": "DELETE FROM app_users WHERE customer_id IS NULL AND last_seen_at < now() - make_interval(days => :d)",
            "threads": "DELETE FROM threads WHERE updated_at < now() - make_interval(days => :d)",
            "runs": "DELETE FROM runs WHERE created_at < now() - make_interval(days => :d)",
            "jobs": "DELETE FROM jobs WHERE created_at < now() - make_interval(days => :d)",
            "audit": "DELETE FROM audit_log WHERE created_at < now() - make_interval(days => :d)",
            "emails": "DELETE FROM outbox_emails WHERE created_at < now() - make_interval(days => :d)",
        }.items():
            out[name] = s.execute(text(sql), {"d": days}).rowcount  # type: ignore[attr-defined]
        for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
            exists = s.scalar(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": table})
            if exists:
                out[table] = s.execute(
                    text(f"DELETE FROM {table} WHERE thread_id NOT IN (SELECT id::text FROM threads)")
                ).rowcount  # type: ignore[attr-defined]
    log.info("retention cleanup: %s", out)
    return out


@worker_ready.connect
def _reconcile_on_start(**_: Any) -> None:
    """Redis is ephemeral in the container: re-send jobs that were queued before a restart."""
    try:
        log.info("re-enqueued %s stuck jobs", reconcile_jobs(older_than_s=0))
    except Exception:  # noqa: BLE001
        log.exception("job reconcile failed")
