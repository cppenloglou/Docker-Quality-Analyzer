import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import (
    AnalysisEnqueueResponse,
    BatchAnalysisEnqueueItem,
    BatchAnalysisEnqueueResponse,
)
from app.application.services.analysis_service import AnalysisService
from app.core.config import get_settings
from app.infrastructure.db.models import JobType, UserModel
from app.infrastructure.db.session import get_db_session
from app.workers.queue import enqueue_job

router = APIRouter(prefix="/api/v1/dockerfile", tags=["dockerfile"])
settings = get_settings()

MAX_DOCKERFILE_BYTES = 2 * 1024 * 1024
MAX_BATCH_FILES = 10


@router.post("/analyze", response_model=AnalysisEnqueueResponse)
async def analyze_dockerfile(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required.")
    raw = await file.read()
    if len(raw) > MAX_DOCKERFILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Maximum 2 MB for Dockerfile analysis.")
    content = raw.decode("utf-8")
    service = AnalysisService(session)
    job_id = await service.enqueue_job(
        current_user.id, JobType.dockerfile, {"filename": file.filename, "source": "upload"}
    )
    await enqueue_job(
        "run_dockerfile_analysis",
        {
            "user_id": str(current_user.id),
            "job_id": str(job_id),
            "content": content,
            "filename": file.filename,
        },
    )
    return AnalysisEnqueueResponse(job_id=uuid.UUID(str(job_id)), status="queued")


@router.post("/analyze/batch", response_model=BatchAnalysisEnqueueResponse)
async def analyze_dockerfile_batch(
    files: list[UploadFile] = File(...),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> BatchAnalysisEnqueueResponse:
    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required.")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_BATCH_FILES} files are allowed per batch.")

    service = AnalysisService(session)
    items: list[BatchAnalysisEnqueueItem] = []

    for file in files:
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required.")
        raw = await file.read()
        if len(raw) > MAX_DOCKERFILE_BYTES:
            raise HTTPException(status_code=413, detail="File too large. Maximum 2 MB for Dockerfile analysis.")
        content = raw.decode("utf-8")
        job_id = await service.enqueue_job(
            current_user.id,
            JobType.dockerfile,
            {"filename": file.filename, "source": "upload"},
        )
        await enqueue_job(
            "run_dockerfile_analysis",
            {
                "user_id": str(current_user.id),
                "job_id": str(job_id),
                "content": content,
                "filename": file.filename,
            },
        )
        items.append(
            BatchAnalysisEnqueueItem(
                filename=file.filename,
                job_id=uuid.UUID(str(job_id)),
                status="queued",
            )
        )

    return BatchAnalysisEnqueueResponse(count=len(items), items=items)
