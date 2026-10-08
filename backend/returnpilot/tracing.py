"""Run tracing (SPEC §2.3 runs view, §11 runs/run_steps).

A `Tracer` collects steps in memory while a run executes and writes them in one batch at
the end (after the reply has been sent), so tracing never adds latency to the chat.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import insert, update

from returnpilot.db.models import Run, RunStep
from returnpilot.db.session import db_session
from returnpilot.guards.pii import redact

log = logging.getLogger(__name__)


@dataclass
class Step:
    seq: int
    kind: str
    name: str
    started_at: datetime
    model: str | None = None
    duration_ms: int | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    status: str = "ok"
    input: Any = None
    output: Any = None
    error: str | None = None


@dataclass
class Tracer:
    run_id: uuid.UUID
    thread_id: uuid.UUID | None
    customer_id: uuid.UUID | None
    workspace_id: uuid.UUID | None
    kind: str = "turn"
    first_user_text: str | None = None
    steps: list[Step] = field(default_factory=list)
    started: float = field(default_factory=time.perf_counter)
    route: str | None = None
    model_primary: str | None = None
    profile_version: str | None = None
    mode: str = "live"
    case_id: str | None = None
    _created: bool = False

    def add(self, kind: str, name: str, **kw: Any) -> Step:
        step = Step(seq=len(self.steps) + 1, kind=kind, name=name, started_at=datetime.now(UTC), **kw)
        self.steps.append(step)
        return step

    @contextmanager
    def step(self, kind: str, name: str, *, model: str | None = None, input: Any = None) -> Iterator[Step]:
        s = self.add(kind, name, model=model, input=input)
        t0 = time.perf_counter()
        try:
            yield s
        except Exception as exc:
            s.status = "error"
            s.error = f"{type(exc).__name__}: {exc}"[:500]
            raise
        finally:
            s.duration_ms = int((time.perf_counter() - t0) * 1000)

    def record_llm(
        self,
        name: str,
        model: str,
        duration_ms: int,
        tokens_in: int,
        tokens_out: int,
        *,
        input: Any = None,
        output: Any = None,
        status: str = "ok",
    ) -> None:
        s = self.add("llm", name, model=model, input=input, output=output, status=status)
        s.duration_ms, s.tokens_in, s.tokens_out = duration_ms, tokens_in, tokens_out
        if self.model_primary is None and name == "agent":
            self.model_primary = model

    @property
    def totals(self) -> dict[str, int]:
        return {
            "llm_calls": sum(1 for s in self.steps if s.kind == "llm"),
            "tool_calls": sum(1 for s in self.steps if s.kind == "tool"),
            "tokens_in": sum(s.tokens_in or 0 for s in self.steps),
            "tokens_out": sum(s.tokens_out or 0 for s in self.steps),
        }

    async def start(self) -> None:
        try:
            async with db_session() as s:
                await s.execute(
                    insert(Run).values(
                        id=self.run_id,
                        thread_id=self.thread_id,
                        customer_id=self.customer_id,
                        workspace_id=self.workspace_id,
                        kind=self.kind,
                        status="running",
                        first_user_text=(redact(self.first_user_text) if self.first_user_text else None),
                        profile_version=self.profile_version,
                        mode=self.mode,
                        case_id=self.case_id,
                    )
                )
            self._created = True
        except Exception:  # noqa: BLE001 - tracing must never break a chat turn
            log.exception("could not create run row")

    async def finish(self, status: str, error: str | None = None) -> None:
        if not self._created:
            return
        try:
            async with db_session() as s:
                await s.execute(
                    update(Run)
                    .where(Run.id == self.run_id)
                    .values(
                        status=status,
                        error=error,
                        route=self.route,
                        model_primary=self.model_primary,
                        total_ms=int((time.perf_counter() - self.started) * 1000),
                        **self.totals,
                    )
                )
                if self.steps:
                    await s.execute(
                        insert(RunStep),
                        [
                            {
                                "run_id": self.run_id,
                                "seq": st.seq,
                                "kind": st.kind,
                                "name": st.name,
                                "model": st.model,
                                "started_at": st.started_at,
                                "duration_ms": st.duration_ms,
                                "tokens_in": st.tokens_in,
                                "tokens_out": st.tokens_out,
                                "status": st.status,
                                "input_redacted": redact(st.input),
                                "output_redacted": redact(st.output),
                                "error": st.error,
                            }
                            for st in self.steps
                        ],
                    )
        except Exception:  # noqa: BLE001
            log.exception("could not persist trace for run %s", self.run_id)
            return
        if self.mode == "live":
            from returnpilot.agentforge import exporter

            exporter.submit(self.run_id)  # async export to AgentForge (no-op when not configured)
