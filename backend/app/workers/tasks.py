import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.analysis_service import AnalysisService
from app.domain.events import DomainEvent
from app.infrastructure.db.models import JobStatus
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.events.bus import publish_event


async def run_dockerfile_analysis(ctx, payload: dict) -> dict:
    async with SessionLocal() as session:
        return await _run_with_payload(session, payload, ["hadolint", "security_scanner", "resource_estimation"])


async def run_compose_analysis(ctx, payload: dict) -> dict:
    async with SessionLocal() as session:
        return await _run_with_payload(
            session,
            payload,
            ["compose_validator", "compose_runnability", "security_scanner", "resource_estimation"],
        )


async def run_project_analysis(ctx, payload: dict) -> dict:
    async with SessionLocal() as session:
        user_id = uuid.UUID(payload["user_id"])
        job_id = uuid.UUID(payload["job_id"])
        project_path = Path(payload["project_path"])
        dockerfiles = payload.get("dockerfiles", [])
        compose_files = payload.get("compose_files", [])
        service = AnalysisService(session)

        if not dockerfiles and not compose_files:
            result = {"message": "No Dockerfile or Compose file found. Cannot analyze containerization."}
            await JobRepository(session).update_status(job_id, user_id, JobStatus.failed, result=result)
            await session.commit()
            await publish_event(DomainEvent("user.analysis.failed", str(user_id), str(job_id), result))
            return result

        combined = {"dockerfile": None, "compose": None}
        if dockerfiles:
            combined["dockerfile"] = (project_path / dockerfiles[0]).read_text(encoding="utf-8", errors="ignore")
        if compose_files:
            combined["compose"] = (project_path / compose_files[0]).read_text(encoding="utf-8", errors="ignore")

        context = {"dockerfile_content": combined["dockerfile"], "compose_content": combined["compose"], "project_path": str(project_path)}
        plugins = ["security_scanner", "resource_estimation"]
        if combined["dockerfile"]:
            plugins.append("hadolint")
        if combined["compose"]:
            plugins.append("compose_validator")
        return await service.run_job_with_plugins(user_id, job_id, context, plugins)


async def run_compose_deploy(ctx, payload: dict) -> dict:
    user_id = payload["user_id"]
    job_id = payload["job_id"]
    if payload.get("push_public_images"):
        await publish_event(
            DomainEvent(
                "docker.image.pushed",
                user_id=user_id,
                job_id=job_id,
                payload={"registry_ref": "docker.io/library/example:latest"},
            )
        )
    await publish_event(
        DomainEvent(
            "container.started",
            user_id=user_id,
            job_id=job_id,
            payload={"container_id": "web-container", "run_stack": payload.get("run_stack", False)},
        )
    )
    await publish_event(
        DomainEvent(
            "container.metrics",
            user_id=user_id,
            job_id=job_id,
            payload={"container_id": "web-container", "cpu_percent": 12.3, "memory_bytes": 104857600},
        )
    )
    return {"status": "deployment workflow acknowledged"}


async def _run_with_payload(session: AsyncSession, payload: dict, plugins: list[str]) -> dict:
    user_id = uuid.UUID(payload["user_id"])
    job_id = uuid.UUID(payload["job_id"])
    content = payload.get("content", "")
    context = {
        "dockerfile_content": content,
        "compose_content": content,
        "filename": payload.get("filename", ""),
    }
    service = AnalysisService(session)
    return await service.run_job_with_plugins(user_id, job_id, context, plugins)
