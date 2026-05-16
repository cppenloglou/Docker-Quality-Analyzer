import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import (
    AnalysisEnqueueResponse,
    ProjectPrimaryComposeRequest,
)
from app.application.services.analysis_service import AnalysisService
from app.application.services.project_scanner import safe_extract_zip, scan_extracted_project
from app.core.config import get_settings
from app.infrastructure.db.models import JobStatus, JobType, UserModel
from app.infrastructure.db.repositories import JobRepository
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
    """Upload a ZIP archive, scan it, and immediately queue analysis of all detected files."""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Project upload expects a .zip archive.")

    content = await file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Uploaded archive is too large.")

    upload_root = Path(settings.upload_dir) / str(current_user.id)
    upload_root.mkdir(parents=True, exist_ok=True)

    archive_stem = Path(file.filename).stem
    extract_dir = upload_root / f"{archive_stem}-{uuid.uuid4().hex[:8]}"
    extract_dir.mkdir(parents=True, exist_ok=True)
    archive_path = upload_root / f"{archive_stem}-{uuid.uuid4().hex[:8]}.zip"
    archive_path.write_bytes(content)

    try:
        safe_extract_zip(archive_path, extract_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        archive_path.unlink(missing_ok=True)

    try:
        scan_result = scan_extracted_project(extract_dir, file.filename)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Project scan failed: {exc}") from exc

    meta = {
        **scan_result["db_safe_summary"],
        "analysis_confirmed": True,
        "build_selected_images": True,
    }

    service = AnalysisService(session)
    job_id = await service.enqueue_job(
        current_user.id,
        JobType.project,
        meta,
        initial_status=JobStatus.queued,
    )

    dockerfiles: list[str] = meta.get("dockerfiles", [])
    compose_files: list[str] = meta.get("compose_files", [])

    await enqueue_job(
        "run_project_analysis",
        {
            "user_id": str(current_user.id),
            "job_id": str(job_id),
            "project_path": str(extract_dir),
            "dockerfiles": dockerfiles,
            "compose_files": compose_files,
            "primary_compose_file": compose_files[0] if compose_files else None,
            "analysis_mode": "auto",
            "build_selected_images": True,
        },
    )

    return AnalysisEnqueueResponse(job_id=uuid.UUID(str(job_id)), status="queued")


@router.patch("/{project_id}/primary-compose", response_model=AnalysisEnqueueResponse)
async def set_primary_compose(
    project_id: uuid.UUID,
    payload: ProjectPrimaryComposeRequest,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    """Set the primary compose file for deploy after analysis results are available."""
    repo = JobRepository(session)
    job = await repo.get_job(project_id, current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Project not found.")

    if job.type != JobType.project:
        raise HTTPException(status_code=400, detail="This endpoint is only for project jobs.")

    if job.status != JobStatus.done:
        raise HTTPException(
            status_code=409,
            detail="Primary compose can only be set after analysis is complete.",
        )

    result = job.result if isinstance(job.result, dict) else {}
    per_file_results = result.get("per_file_results") or []
    analyzed_compose_paths = [
        row["file_path"]
        for row in per_file_results
        if isinstance(row, dict) and row.get("file_type") == "compose"
    ]

    if payload.primary_compose_file not in analyzed_compose_paths:
        raise HTTPException(
            status_code=400,
            detail=f"Compose file '{payload.primary_compose_file}' was not analyzed in this project.",
        )

    updated = await repo.update_job_metadata(
        project_id,
        current_user.id,
        {"primary_compose_file": payload.primary_compose_file},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found.")
    await session.commit()

    return AnalysisEnqueueResponse(job_id=project_id, status="updated")
