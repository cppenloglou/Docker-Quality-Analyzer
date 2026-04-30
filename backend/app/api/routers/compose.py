import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import AnalysisEnqueueResponse
from app.application.services.analysis_service import AnalysisService
from app.infrastructure.db.models import JobStatus, JobType, UserModel
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import get_db_session
from app.workers.queue import enqueue_job

router = APIRouter(prefix="/api/v1/compose", tags=["compose"])


class ComposeDeployRequest(BaseModel):
    job_id: uuid.UUID
    push_public_images: bool = False
    run_stack: bool = False


class ComposeStopRequest(BaseModel):
    job_id: uuid.UUID
    remove_volumes: bool = False


@router.post("/analyze", response_model=AnalysisEnqueueResponse)
async def analyze_compose(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    content = (await file.read()).decode("utf-8")
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
        pass
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
            "push_public_images": payload.push_public_images,
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
