import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import AnalysisEnqueueResponse
from app.application.services.analysis_service import AnalysisService
from app.infrastructure.db.models import JobType, UserModel
from app.infrastructure.db.session import get_db_session
from app.workers.queue import enqueue_job

router = APIRouter(prefix="/api/v1/dockerfile", tags=["dockerfile"])


@router.post("/analyze", response_model=AnalysisEnqueueResponse)
async def analyze_dockerfile(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required.")
    content = (await file.read()).decode("utf-8")
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
