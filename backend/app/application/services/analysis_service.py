import json
import uuid
from collections.abc import Iterable
from typing import Any, Literal, cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.application.schemas import Issue
from app.domain.events import DomainEvent
from app.infrastructure.db.models import JobStatus, JobType
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.events.bus import publish_event
from app.plugins.base import BasePlugin
from app.plugins.registry import load_plugins


def _hadolint_doc_url(code: str) -> str | None:
    if code.startswith("DL"):
        return f"https://github.com/hadolint/hadolint/wiki/{code}"
    if code.startswith("SC"):
        return f"https://github.com/koalaman/shellcheck/wiki/{code}"
    return None


def _rule_code_and_doc_url(raw: dict[str, Any]) -> tuple[str, str | None]:
    field = raw.get("code", raw.get("rule"))
    if isinstance(field, dict):
        code = str(field.get("value") or field.get("rule") or "GEN000")
        url = field.get("url")
        return code, str(url) if url else None
    if field is not None and field != "":
        code = str(field)
        return code, _hadolint_doc_url(code)
    return "GEN000", None


def _suggestion_from_raw(raw: dict[str, Any]) -> str:
    direct = raw.get("suggestion")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    orig = raw.get("original_output")
    if isinstance(orig, str) and orig.strip():
        try:
            parsed = json.loads(orig)
            meta = parsed.get("meta") if isinstance(parsed, dict) else None
            if isinstance(meta, dict):
                desc = meta.get("description")
                if isinstance(desc, str) and desc.strip():
                    return desc.strip()
        except (json.JSONDecodeError, TypeError):
            pass
    return "Review related container best practices."


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


def _build_analysis_started_payload(context: dict[str, Any]) -> dict[str, Any]:
    filename = context.get("filename")
    source = context.get("source")
    dockerfile_content = context.get("dockerfile_content")
    compose_content = context.get("compose_content")
    analysis_type = "compose" if isinstance(compose_content, str) and compose_content else "dockerfile"
    effective_source = compose_content if analysis_type == "compose" else dockerfile_content
    line_count = len(effective_source.splitlines()) if isinstance(effective_source, str) else 0
    payload: dict[str, Any] = {"analysis_type": analysis_type, "line_count": max(1, line_count)}
    if isinstance(filename, str) and filename:
        payload["filename"] = filename
    if isinstance(source, str) and source:
        payload["source"] = source
    return payload


class AnalysisService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = JobRepository(session)

    async def enqueue_job(self, user_id: uuid.UUID, job_type: JobType, metadata: dict[str, Any], initial_status: JobStatus = JobStatus.queued) -> uuid.UUID:
        job = await self.repo.create_job(user_id, job_type, metadata, initial_status=initial_status)
        await self.session.commit()
        return job.id

    async def analyze_content(
        self,
        content: str,
        content_type: str,
        context_extras: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Run plugins on raw file content and return scored results without touching any job in the DB.

        Used by run_project_analysis to analyze individual files within a project.
        ``content_type`` is either ``"dockerfile"`` or ``"compose"``.
        """
        context: dict[str, Any] = {
            "dockerfile_content": content if content_type == "dockerfile" else "",
            "compose_content": content if content_type == "compose" else "",
        }
        if context_extras:
            context.update(context_extras)

        if content_type == "dockerfile":
            plugin_names_list: list[str] = ["hadolint", "security_scanner", "resource_estimation"]
        else:
            plugin_names_list = ["compose_validator", "compose_runnability", "security_scanner", "resource_estimation"]

        plugins: list[BasePlugin] = load_plugins(plugin_names_list)
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

        line_count = max(1, len(content.splitlines()))
        raw_penalty = len(errors) * 15 + len(warnings) * 8 + len(suggestions) * 3 + len(security) * 10
        density_factor = min(1.0, 50.0 / line_count)
        score = max(0, min(100, round(100 - raw_penalty * density_factor)))

        return {
            "score": score,
            "grade": _grade(score),
            "line_count": line_count,
            "errors_count": len(errors),
            "warnings_count": len(warnings),
            "security_count": len(security),
            "suggestions_count": len(suggestions),
            "errors": [i.model_dump() for i in errors],
            "warnings": [i.model_dump() for i in warnings],
            "suggestions": [i.model_dump() for i in suggestions],
            "securityIssues": [i.model_dump() for i in security],
            "meta": meta,
        }

    async def run_job_with_plugins(
        self, user_id: uuid.UUID, job_id: uuid.UUID, context: dict[str, Any], plugin_names: Iterable[str]
    ) -> dict[str, Any]:
        safe_start_payload = _build_analysis_started_payload(context)
        await publish_event(DomainEvent("user.analysis.started", str(user_id), str(job_id), payload=safe_start_payload))
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

            source = context.get("dockerfile_content") or context.get("compose_content") or ""
            line_count = max(1, len(source.splitlines()))
            raw_penalty = len(errors) * 15 + len(warnings) * 8 + len(suggestions) * 3 + len(security) * 10
            density_factor = min(1.0, 50.0 / line_count)
            score = max(0, min(100, round(100 - raw_penalty * density_factor)))
            result = {
                "score": score,
                "grade": _grade(score),
                "line_count": line_count,
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
        issue_severity = cast(Literal["error", "warning", "info"], severity)
        line = raw.get("line") or raw.get("location", {}).get("range", {}).get("start", {}).get("line") or 1
        code, doc_url = _rule_code_and_doc_url(raw)
        return Issue(
            line=int(line),
            code=code,
            severity=issue_severity,
            message=str(raw.get("message", "No details provided.")),
            suggestion=_suggestion_from_raw(raw),
            doc_url=doc_url,
        )
