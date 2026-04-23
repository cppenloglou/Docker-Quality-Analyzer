import uuid
from collections.abc import Iterable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.application.schemas import Issue
from app.domain.events import DomainEvent
from app.infrastructure.db.models import JobStatus, JobType
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.events.bus import publish_event
from app.plugins.base import BasePlugin
from app.plugins.registry import load_plugins


def _grade(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 75:
        return "B"
    if score >= 60:
        return "C"
    if score >= 45:
        return "D"
    return "F"


class AnalysisService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = JobRepository(session)

    async def enqueue_job(self, user_id: uuid.UUID, job_type: JobType, metadata: dict[str, Any]) -> uuid.UUID:
        job = await self.repo.create_job(user_id, job_type, metadata)
        await self.session.commit()
        return job.id

    async def run_job_with_plugins(
        self, user_id: uuid.UUID, job_id: uuid.UUID, context: dict[str, Any], plugin_names: Iterable[str]
    ) -> dict[str, Any]:
        await publish_event(DomainEvent("user.analysis.started", str(user_id), str(job_id), payload=context))
        await self.repo.update_status(job_id, user_id, JobStatus.running)
        await self.session.commit()

        try:
            plugins: list[BasePlugin] = load_plugins(plugin_names)
            aggregate: list[dict[str, Any]] = []
            meta: dict[str, Any] = {}
            for plugin in plugins:
                output = await plugin.run(context)
                findings = output.get("findings", [])
                if isinstance(findings, dict):
                    findings = findings.get("diagnostics", [])
                if isinstance(findings, list):
                    aggregate.extend(findings)
                for key, value in output.items():
                    if key != "findings":
                        meta[key] = value

            issues = [self._normalize_issue(item) for item in aggregate]
            errors = [i for i in issues if i.severity == "error"]
            warnings = [i for i in issues if i.severity == "warning"]
            suggestions = [i for i in issues if i.severity == "info"]
            security = [i for i in issues if i.code.startswith("SEC")]

            score = max(0, 100 - (len(errors) * 15 + len(warnings) * 8 + len(suggestions) * 3 + len(security) * 10))
            result = {
                "score": score,
                "grade": _grade(score),
                "errors": [i.model_dump() for i in errors],
                "warnings": [i.model_dump() for i in warnings],
                "suggestions": [i.model_dump() for i in suggestions],
                "securityIssues": [i.model_dump() for i in security],
            }
            if meta:
                result["meta"] = meta
            await self.repo.update_status(job_id, user_id, JobStatus.done, result=result)
            await self.session.commit()
            await publish_event(DomainEvent("user.analysis.completed", str(user_id), str(job_id), payload=result))
            return result
        except Exception as exc:
            fail_result = {"message": str(exc)}
            await self.repo.update_status(job_id, user_id, JobStatus.failed, result=fail_result)
            await self.session.commit()
            await publish_event(DomainEvent("user.analysis.failed", str(user_id), str(job_id), payload=fail_result))
            raise

    def _normalize_issue(self, raw: dict[str, Any]) -> Issue:
        severity = str(raw.get("severity") or raw.get("level") or "info").lower()
        if severity not in {"error", "warning", "info"}:
            if severity in {"warn"}:
                severity = "warning"
            elif severity in {"fatal"}:
                severity = "error"
            else:
                severity = "info"
        line = raw.get("line") or raw.get("location", {}).get("range", {}).get("start", {}).get("line") or 1
        return Issue(
            line=int(line),
            code=str(raw.get("code", raw.get("rule", "GEN000"))),
            severity=severity,
            message=str(raw.get("message", "No details provided.")),
            suggestion=str(raw.get("suggestion", "Review related container best practices.")),
        )
