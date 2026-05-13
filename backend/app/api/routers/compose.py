import json
import uuid

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
    container_ids: list[str] = []
    project_name: str | None = None
    containers: list[ContainerStateInfo] = []
    running_count: int = 0
    exited_count: int = 0
    unhealthy_count: int = 0


@router.get("/deploy/status/{job_id}", response_model=DeployStatusResponse)
async def get_deploy_status(
    job_id: uuid.UUID,
    current_user: UserModel = Depends(get_current_user),
) -> DeployStatusResponse:
    key = f"deploy:{current_user.id}:{job_id}"
    raw = await redis_client.get(key)
    if not raw:
        return DeployStatusResponse(active=False)
    try:
        state = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return DeployStatusResponse(active=False)

    raw_containers: list[dict] = state.get("containers", [])
    containers = [ContainerStateInfo(**c) for c in raw_containers if isinstance(c, dict)]
    running_count = state.get("running_count", 0)
    exited_count = state.get("exited_count", 0)
    unhealthy_count = state.get("unhealthy_count", 0)

    # If counts not stored yet, derive from containers list
    if not running_count and not exited_count and containers:
        for c in containers:
            if c.status in ("running",):
                running_count += 1
            elif c.status in ("exited", "dead", "removing"):
                exited_count += 1
            if c.health_status == "unhealthy":
                unhealthy_count += 1

    # Determine active: active if stop not explicitly requested and containers exist
    # Use stored active flag if present; fall back to container_ids existence
    active = bool(state.get("container_ids") or state.get("containers"))

    return DeployStatusResponse(
        active=active,
        container_ids=state.get("container_ids", []),
        project_name=state.get("project_name"),
        containers=containers,
        running_count=running_count,
        exited_count=exited_count,
        unhealthy_count=unhealthy_count,
    )
