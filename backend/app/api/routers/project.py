import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import AnalysisEnqueueResponse
from app.application.services.analysis_service import AnalysisService
from app.core.config import get_settings
from app.infrastructure.db.models import JobType, UserModel
from app.infrastructure.db.session import get_db_session
from app.workers.queue import enqueue_job

router = APIRouter(prefix="/api/v1/project", tags=["project"])
settings = get_settings()


@router.post("/upload", response_model=AnalysisEnqueueResponse)
async def upload_project(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Project upload expects a .zip archive.")

    content = await file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Uploaded archive is too large.")

    upload_root = Path(settings.upload_dir) / str(current_user.id)
    upload_root.mkdir(parents=True, exist_ok=True)
    archive_path = upload_root / file.filename
    archive_path.write_bytes(content)

    extract_dir = upload_root / f"{archive_path.stem}-{uuid.uuid4().hex[:8]}"
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive_path, "r") as zf:
        for member in zf.namelist():
            member_path = (extract_dir / member).resolve()
            if not str(member_path).startswith(str(extract_dir.resolve())):
                raise HTTPException(status_code=400, detail="Archive contains path traversal entries.")
        zf.extractall(extract_dir)

    dockerfiles = [str(path.relative_to(extract_dir)) for path in extract_dir.rglob("Dockerfile")]
    compose_files = [
        str(path.relative_to(extract_dir))
        for path in extract_dir.rglob("*")
        if path.name.lower() in {"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"}
    ]

    service = AnalysisService(session)
    job_id = await service.enqueue_job(
        current_user.id,
        JobType.project,
        {
            "filename": file.filename,
            "dockerfiles": dockerfiles,
            "compose_files": compose_files,
            "project_path": str(extract_dir),
        },
    )
    await enqueue_job(
        "run_project_analysis",
        {
            "user_id": str(current_user.id),
            "job_id": str(job_id),
            "project_path": str(extract_dir),
            "dockerfiles": dockerfiles,
            "compose_files": compose_files,
        },
    )
    return AnalysisEnqueueResponse(job_id=uuid.UUID(str(job_id)), status="queued")
