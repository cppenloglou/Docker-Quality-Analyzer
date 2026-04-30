import asyncio
import json
import subprocess
import uuid
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.application.services.analysis_service import AnalysisService
from app.domain.events import DomainEvent
from app.infrastructure.db.models import JobStatus
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.docker.client import DockerGateway
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.events.bus import publish_event, redis_client

settings = get_settings()
DEPLOY_STATE_TTL_SECONDS = 60 * 60 * 6
METRICS_INTERVAL_SECONDS = 2
METRICS_MAX_RUNTIME_SECONDS = 60 * 60


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
            await publish_event(DomainEvent("user.analysis.failed", str(user_id), str(job_id), payload=result))
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
    user_id = str(payload["user_id"])
    job_id = str(payload["job_id"])
    run_stack = bool(payload.get("run_stack", False))

    try:
        async with SessionLocal() as session:
            repo = JobRepository(session)
            job = await repo.get_job(uuid.UUID(job_id), uuid.UUID(user_id))
            if not job:
                raise RuntimeError("Job not found for deployment.")
            deploy_spec = _resolve_deploy_spec(user_id, job_id, job.input_metadata or {})
            await _set_deploy_state(user_id, job_id, deploy_spec)

        primary_container_id = ""
        container_ids: list[str] = []
        if run_stack:
            _compose_up(deploy_spec)
            container_ids = _compose_ps_ids(deploy_spec)
            if container_ids:
                primary_container_id = container_ids[0]
                await _set_deploy_state(
                    user_id,
                    job_id,
                    {
                        **deploy_spec,
                        "container_id": primary_container_id,
                        "container_ids": container_ids,
                    },
                )

        started_container = primary_container_id or deploy_spec["project_name"]
        await publish_event(
            DomainEvent(
                "container.started",
                user_id=user_id,
                job_id=job_id,
                payload={
                    "container_id": started_container,
                    "run_stack": run_stack,
                    "project_name": deploy_spec["project_name"],
                    "container_ids": container_ids,
                },
            )
        )

        if run_stack and container_ids:
            await _stream_metrics(user_id, job_id, container_ids)

        return {
            "status": "deployment workflow acknowledged",
            "project_name": deploy_spec["project_name"],
            "container_id": started_container,
        }
    except Exception as exc:
        fail_payload = {"message": str(exc)}
        await publish_event(
            DomainEvent("user.analysis.failed", user_id=user_id, job_id=job_id, payload=fail_payload)
        )
        raise


async def run_compose_stop(ctx, payload: dict) -> dict:
    user_id = str(payload["user_id"])
    job_id = str(payload["job_id"])
    remove_volumes = bool(payload.get("remove_volumes", False))
    state = await _get_deploy_state(user_id, job_id)
    if not state:
        return {"status": "no_active_deploy"}

    await _set_stop_requested(user_id, job_id)
    _compose_down(state, remove_volumes)

    container_id = str(state.get("container_id") or state.get("project_name") or "")
    await publish_event(
        DomainEvent(
            "container.stopped",
            user_id=user_id,
            job_id=job_id,
            payload={
                "container_id": container_id,
                "project_name": state.get("project_name"),
                "remove_volumes": remove_volumes,
            },
        )
    )
    await _clear_deploy_state(user_id, job_id)
    return {"status": "stopped"}


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


def _deployment_key(user_id: str, job_id: str) -> str:
    return f"deploy:{user_id}:{job_id}"


def _deploy_stop_key(user_id: str, job_id: str) -> str:
    return f"deploy-stop:{user_id}:{job_id}"


def _compose_base_cmd(spec: dict[str, Any]) -> list[str]:
    return ["docker-compose", "-p", str(spec["project_name"]), "-f", str(spec["compose_file"])]


def _resolve_deploy_spec(user_id: str, job_id: str, metadata: dict[str, Any]) -> dict[str, str]:
    project_name = f"dqa-{job_id.replace('-', '')[:12]}"
    project_path = metadata.get("project_path")
    compose_files = metadata.get("compose_files") or []
    if project_path and compose_files:
        project_dir = Path(str(project_path)).resolve()
        compose_rel = str(compose_files[0])
        compose_file = (project_dir / compose_rel).resolve()
        return {
            "project_name": project_name,
            "project_dir": str(project_dir),
            "compose_file": str(compose_file),
        }

    compose_content = metadata.get("compose_content")
    if isinstance(compose_content, str) and compose_content.strip():
        deploy_dir = (Path(settings.upload_dir) / "deployments" / user_id / job_id).resolve()
        deploy_dir.mkdir(parents=True, exist_ok=True)
        filename = str(metadata.get("filename") or "docker-compose.yml")
        compose_file = (deploy_dir / filename).resolve()
        compose_file.write_text(compose_content, encoding="utf-8")
        return {
            "project_name": project_name,
            "project_dir": str(deploy_dir),
            "compose_file": str(compose_file),
        }

    raise RuntimeError("No deployable compose content found for this job.")


def _compose_up(spec: dict[str, Any]) -> None:
    command = _compose_base_cmd(spec) + ["up", "-d"]
    try:
        subprocess.run(
            command,
            check=True,
            cwd=str(spec["project_dir"]),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr or ""
        if "port is already allocated" in stderr.lower():
            sanitized_file = _build_no_ports_compose(spec)
            fallback_command = [
                "docker-compose",
                "-p",
                str(spec["project_name"]),
                "-f",
                sanitized_file,
                "up",
                "-d",
            ]
            try:
                subprocess.run(
                    fallback_command,
                    check=True,
                    cwd=str(spec["project_dir"]),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
            except subprocess.CalledProcessError:
                raise
            return
        raise


def _build_no_ports_compose(spec: dict[str, Any]) -> str:
    compose_path = Path(str(spec["compose_file"]))
    raw = compose_path.read_text(encoding="utf-8")
    parsed = yaml.safe_load(raw) or {}
    services = parsed.get("services")
    if not isinstance(services, dict):
        raise RuntimeError("Compose file missing services for no-port fallback.")
    changed = False
    for service_name, service_def in services.items():
        if isinstance(service_def, dict) and service_def.get("ports"):
            service_def.pop("ports", None)
            services[service_name] = service_def
            changed = True
    if not changed:
        raise RuntimeError("No service ports to remove after port allocation failure.")
    sanitized_path = Path(str(spec["project_dir"])) / ".dqa-no-publish.compose.yml"
    sanitized_path.write_text(yaml.safe_dump(parsed, sort_keys=False), encoding="utf-8")
    return str(sanitized_path.resolve())


def _compose_ps_ids(spec: dict[str, Any]) -> list[str]:
    command = _compose_base_cmd(spec) + ["ps", "-q"]
    result = subprocess.run(
        command,
        check=True,
        cwd=str(spec["project_dir"]),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _compose_down(spec: dict[str, Any], remove_volumes: bool) -> None:
    command = _compose_base_cmd(spec) + ["down"]
    if remove_volumes:
        command.append("-v")
    try:
        subprocess.run(
            command,
            check=True,
            cwd=str(spec["project_dir"]),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except subprocess.CalledProcessError:
        raise


async def _stream_metrics(user_id: str, job_id: str, container_ids: list[str]) -> None:
    docker_gateway = DockerGateway()
    while True:
        if await _is_stop_requested(user_id, job_id):
            break
        for container_id in container_ids:
            try:
                metrics = await docker_gateway.inspect_container_metrics(container_id)
            except Exception:
                continue
            payload = {"container_id": container_id, **metrics}
            await publish_event(
                DomainEvent(
                    "container.metrics",
                    user_id=user_id,
                    job_id=job_id,
                    payload=payload,
                )
            )
        await asyncio.sleep(METRICS_INTERVAL_SECONDS)


async def _set_deploy_state(user_id: str, job_id: str, state: dict[str, Any]) -> None:
    await redis_client.set(_deployment_key(user_id, job_id), json.dumps(state), ex=DEPLOY_STATE_TTL_SECONDS)


async def _get_deploy_state(user_id: str, job_id: str) -> dict[str, Any] | None:
    raw = await redis_client.get(_deployment_key(user_id, job_id))
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


async def _set_stop_requested(user_id: str, job_id: str) -> None:
    await redis_client.set(_deploy_stop_key(user_id, job_id), "1", ex=DEPLOY_STATE_TTL_SECONDS)


async def _is_stop_requested(user_id: str, job_id: str) -> bool:
    raw = await redis_client.get(_deploy_stop_key(user_id, job_id))
    return raw == "1"


async def _clear_deploy_state(user_id: str, job_id: str) -> None:
    await redis_client.delete(_deployment_key(user_id, job_id))
    await redis_client.delete(_deploy_stop_key(user_id, job_id))
