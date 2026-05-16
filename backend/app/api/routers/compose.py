import json
import os
import re
import socket
import subprocess
import uuid
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import AnalysisEnqueueResponse, ContainerStateInfo
from app.application.services.analysis_service import AnalysisService
from app.infrastructure.db.models import JobStatus, JobType, UserModel
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import get_db_session
from app.infrastructure.events.bus import redis_client
from app.workers.queue import enqueue_job

router = APIRouter(prefix="/api/v1/compose", tags=["compose"])


class ComposeDeployRequest(BaseModel):
    job_id: uuid.UUID
    run_stack: bool = False


class ComposeStopRequest(BaseModel):
    job_id: uuid.UUID
    remove_volumes: bool = False


MAX_COMPOSE_BYTES = 2 * 1024 * 1024


@router.post("/analyze", response_model=AnalysisEnqueueResponse)
async def analyze_compose(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    raw = await file.read()
    if len(raw) > MAX_COMPOSE_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Maximum 2 MB for compose analysis.")
    content = raw.decode("utf-8")
    filename = file.filename or "compose.yml"
    service = AnalysisService(session)
    job_id = await service.enqueue_job(
        current_user.id,
        JobType.compose,
        {"filename": filename, "compose_content": content},
    )
    await enqueue_job(
        "run_compose_analysis",
        {"user_id": str(current_user.id), "job_id": str(job_id), "content": content, "filename": filename},
    )
    return AnalysisEnqueueResponse(job_id=uuid.UUID(str(job_id)), status="queued")


@router.post("/deploy", response_model=AnalysisEnqueueResponse)
async def deploy_compose(
    payload: ComposeDeployRequest,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    repository = JobRepository(session)
    job = await repository.get_job(payload.job_id, current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.type == JobType.project:
        if job.status != JobStatus.done:
            raise HTTPException(status_code=409, detail="Project analysis must complete before deploy.")
        result = job.result if isinstance(job.result, dict) else {}
        per_file_results = result.get("per_file_results")
        compose_results = []
        if isinstance(per_file_results, list):
            compose_results = [
                row
                for row in per_file_results
                if isinstance(row, dict) and row.get("file_type") == "compose"
            ]
        if not compose_results:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Project deploy blocked by runnability precheck.",
                    "reasons": ["No compose analysis results available for this project job."],
                },
            )

        metadata = job.input_metadata if isinstance(job.input_metadata, dict) else {}
        primary_compose = metadata.get("primary_compose_file")
        selected_compose = metadata.get("selected_compose_files")
        if not isinstance(primary_compose, str) or not primary_compose:
            if isinstance(selected_compose, list) and selected_compose and isinstance(selected_compose[0], str):
                primary_compose = selected_compose[0]
            else:
                primary_compose = compose_results[0].get("file_path")

        target_compose_result = next(
            (
                row
                for row in compose_results
                if isinstance(row.get("file_path"), str) and row.get("file_path") == primary_compose
            ),
            None,
        )
        if target_compose_result is None:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Project deploy blocked by runnability precheck.",
                    "reasons": [f"Primary compose file '{primary_compose}' was not analyzed."],
                },
            )

        runnability = ((target_compose_result.get("meta") or {}).get("runnability") or {})
        if runnability.get("runnable") is not True:
            reasons = runnability.get("reasons") or [
                f"Primary compose file '{primary_compose}' is not runnable.",
            ]
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Project deploy blocked by runnability precheck.",
                    "reasons": reasons,
                },
            )
    elif job.type == JobType.compose:
        if job.status != JobStatus.done:
            raise HTTPException(status_code=409, detail="Compose analysis must complete before deploy.")
        runnability = ((job.result or {}).get("meta") or {}).get("runnability") or {}
        if runnability.get("runnable") is not True:
            reasons = runnability.get("reasons") or ["Compose file is not runnable from standalone analysis."]
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Compose deploy blocked by runnability precheck.",
                    "reasons": reasons,
                },
            )
    else:
        raise HTTPException(status_code=400, detail="Deploy is supported only for compose or project jobs.")

    await enqueue_job(
        "run_compose_deploy",
        {
            "user_id": str(current_user.id),
            "job_id": str(payload.job_id),
            "run_stack": payload.run_stack,
        },
    )
    return AnalysisEnqueueResponse(job_id=payload.job_id, status="queued")


@router.post("/deploy/stop", response_model=AnalysisEnqueueResponse)
async def stop_compose_deploy(
    payload: ComposeStopRequest,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    repository = JobRepository(session)
    job = await repository.get_job(payload.job_id, current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.type not in {JobType.compose, JobType.project}:
        raise HTTPException(status_code=400, detail="Stop deploy is supported only for compose or project jobs.")
    await enqueue_job(
        "run_compose_stop",
        {
            "user_id": str(current_user.id),
            "job_id": str(payload.job_id),
            "remove_volumes": payload.remove_volumes,
        },
    )
    return AnalysisEnqueueResponse(job_id=payload.job_id, status="queued")


class DeployStatusResponse(BaseModel):
    active: bool
    runtime_state: Literal[
        "none",
        "running",
        "partial",
        "exited",
        "failed",
        "unhealthy",
        "stopping",
        "stopped_by_user",
        "cleanup_completed",
    ] = "none"
    container_ids: list[str] = []
    project_name: str | None = None
    containers: list[ContainerStateInfo] = []
    running_count: int = 0
    exited_count: int = 0
    unhealthy_count: int = 0
    stopped_by_user: bool = False
    stop_reason: str | None = None
    exit_reason: str | None = None
    can_retry_runtime: bool = True


class DindIpResponse(BaseModel):
    dind_ip: str | None = None


def deploy_state_redis_key(user_id: uuid.UUID, job_id: uuid.UUID) -> str:
    return f"deploy:{user_id}:{job_id}"


def deploy_stop_redis_key(user_id: uuid.UUID, job_id: uuid.UUID) -> str:
    return f"deploy-stop:{user_id}:{job_id}"


def _is_ipv4(value: str) -> bool:
    return bool(re.match(r"^\d{1,3}(\.\d{1,3}){3}$", value))


def _resolve_dind_ip() -> str | None:
    # Prefer direct inspect of the known DinD container names.
    for candidate in ("docker-platform-dind-1", "docker-platform-dind", "dind", "docker"):
        try:
            proc = subprocess.run(
                [
                    "docker",
                    "inspect",
                    candidate,
                    "--format",
                    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
                ],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            if proc.returncode == 0:
                ip = proc.stdout.strip()
                if ip and _is_ipv4(ip):
                    return ip
        except Exception:
            continue

    # Fallback to DOCKER_HOST host resolution.
    docker_host = os.getenv("DOCKER_HOST", "")
    if docker_host.startswith("tcp://"):
        parsed = urlparse(docker_host)
        host = (parsed.hostname or "").strip()
        if host:
            if _is_ipv4(host):
                return host
            try:
                resolved = socket.gethostbyname(host)
                if resolved and _is_ipv4(resolved):
                    return resolved
            except Exception:
                pass

    # Final fallback for API container runtime: resolve DinD service names by Docker DNS.
    for candidate in ("docker", "dind", "docker-platform-dind", "docker-platform-dind-1"):
        try:
            resolved = socket.gethostbyname(candidate)
            if resolved and _is_ipv4(resolved):
                return resolved
        except Exception:
            continue
    return None


def _recompute_container_counts(containers: list[ContainerStateInfo]) -> tuple[int, int, int]:
    running = exited = unhealthy = 0
    for c in containers:
        st = (c.status or "").lower()
        if st in ("running", "paused", "restarting"):
            running += 1
        elif st in ("exited", "dead", "removing") or "exited" in st:
            exited += 1
        if (c.health_status or "").lower() == "unhealthy":
            unhealthy += 1
    return running, exited, unhealthy


async def compute_deploy_status(user_id: uuid.UUID, job_id: uuid.UUID) -> DeployStatusResponse:
    key = deploy_state_redis_key(user_id, job_id)
    raw = await redis_client.get(key)
    if not raw:
        return DeployStatusResponse(active=False, runtime_state="none")

    try:
        state = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return DeployStatusResponse(active=False, runtime_state="none")

    raw_containers: list[dict] = state.get("containers", [])
    containers = [ContainerStateInfo(**c) for c in raw_containers if isinstance(c, dict)]
    container_ids: list[str] = list(state.get("container_ids", []) or [])

    if containers:
        running_count, exited_count, unhealthy_count = _recompute_container_counts(containers)
    else:
        running_count = int(state.get("running_count", 0) or 0)
        exited_count = int(state.get("exited_count", 0) or 0)
        unhealthy_count = int(state.get("unhealthy_count", 0) or 0)

    has_tracked = bool(container_ids) or bool(containers)
    stop_raw = await redis_client.get(deploy_stop_redis_key(user_id, job_id))
    stop_pending = str(stop_raw or "") == "1" or bool(state.get("stopping"))

    # Explicit terminal state markers written by the worker take priority over count-based inference.
    explicit_runtime_state: str | None = state.get("explicit_runtime_state")
    stored_stopped_by_user: bool = bool(state.get("stopped_by_user", False))
    stop_reason: str | None = state.get("stop_reason")
    exit_reason: str | None = state.get("exit_reason")

    runtime_state_val: str = "none"
    active = False

    if explicit_runtime_state in ("stopped_by_user", "cleanup_completed"):
        runtime_state_val = explicit_runtime_state
        active = False
    elif explicit_runtime_state == "failed":
        runtime_state_val = "failed"
        active = False
    elif not has_tracked:
        runtime_state_val = "none"
        active = False
    elif stop_pending:
        runtime_state_val = "stopping"
        active = True
    elif running_count == 0 and exited_count > 0:
        runtime_state_val = "exited" if not stored_stopped_by_user else "stopped_by_user"
        active = False
    elif unhealthy_count > 0 and running_count > 0:
        runtime_state_val = "unhealthy"
        active = True
    elif running_count > 0 and exited_count > 0:
        runtime_state_val = "partial"
        active = True
    elif running_count > 0:
        runtime_state_val = "running"
        active = True
    else:
        runtime_state_val = "none"
        active = False

    # can_retry_runtime: true for user-stop or transient states, false for self-exit/crash
    can_retry_runtime: bool
    if runtime_state_val in ("stopped_by_user", "none", "cleanup_completed"):
        can_retry_runtime = True
    elif runtime_state_val in ("exited", "failed"):
        can_retry_runtime = not stored_stopped_by_user
        # If user explicitly stopped, allow retry
        if stored_stopped_by_user:
            can_retry_runtime = True
        else:
            can_retry_runtime = False
    else:
        can_retry_runtime = True

    return DeployStatusResponse(
        active=active,
        runtime_state=runtime_state_val,  # type: ignore[arg-type]
        container_ids=container_ids,
        project_name=state.get("project_name"),
        containers=containers,
        running_count=running_count,
        exited_count=exited_count,
        unhealthy_count=unhealthy_count,
        stopped_by_user=stored_stopped_by_user,
        stop_reason=stop_reason,
        exit_reason=exit_reason,
        can_retry_runtime=can_retry_runtime,
    )


@router.get("/deploy/status/{job_id}", response_model=DeployStatusResponse)
async def get_deploy_status(
    job_id: uuid.UUID,
    current_user: UserModel = Depends(get_current_user),
) -> DeployStatusResponse:
    return await compute_deploy_status(current_user.id, job_id)


@router.get("/deploy/dind-ip", response_model=DindIpResponse)
async def get_dind_ip(current_user: UserModel = Depends(get_current_user)) -> DindIpResponse:
    _ = current_user
    return DindIpResponse(dind_ip=_resolve_dind_ip())
