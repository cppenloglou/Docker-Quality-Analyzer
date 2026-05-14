import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import (
    AnalysisEnqueueResponse,
    ProjectAnalyzeRequest,
    ProjectScanResponse,
    ProjectDetectedAssets,
    DetectedService,
    ProjectRecommendation,
)
from app.application.services.analysis_service import AnalysisService
from app.application.services.project_scanner import safe_extract_zip, scan_extracted_project
from app.core.config import get_settings
from app.infrastructure.db.models import JobType, UserModel
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import get_db_session
from app.workers.queue import enqueue_job

router = APIRouter(prefix="/api/v1/project", tags=["project"])
settings = get_settings()


@router.post("/scan", response_model=ProjectScanResponse)
async def scan_project(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> ProjectScanResponse:
    """Upload a ZIP archive, scan it safely, and return detected assets without starting analysis."""
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

    # Store scan metadata as a queued project job (analysis not started yet)
    service = AnalysisService(session)
    job_id = await service.enqueue_job(
        current_user.id,
        JobType.project,
        scan_result["db_safe_summary"],
    )

    detected = scan_result["detected"]
    rec = scan_result["recommendation"]

    return ProjectScanResponse(
        project_id=job_id,
        archive_name=file.filename,
        detected=ProjectDetectedAssets(
            dockerfiles=detected["dockerfiles"],
            compose_files=detected["compose_files"],
            dockerignore_files=detected["dockerignore_files"],
            env_examples=detected["env_examples"],
            stacks=detected["stacks"],
            package_managers=detected["package_managers"],
            services=[DetectedService(**s) for s in detected["services"]],
        ),
        recommendation=ProjectRecommendation(
            analysis_mode=rec["analysis_mode"],
            primary_dockerfile=rec.get("primary_dockerfile"),
            primary_compose_file=rec.get("primary_compose_file"),
            can_build=rec["can_build"],
            can_run=rec["can_run"],
            reasons=rec["reasons"],
        ),
        warnings=scan_result["warnings"],
    )


@router.post("/analyze", response_model=AnalysisEnqueueResponse)
async def analyze_project(
    payload: ProjectAnalyzeRequest,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    """Confirm analysis of a previously scanned project with selected files."""
    repo = JobRepository(session)
    job = await repo.get_job(payload.project_id, current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Project scan not found.")

    # Validate that selected files are among the scanned ones
    scanned_dockerfiles: list[str] = job.input_metadata.get("dockerfiles", [])
    scanned_compose: list[str] = job.input_metadata.get("compose_files", [])
    project_path = job.input_metadata.get("project_path")

    if not project_path:
        raise HTTPException(status_code=400, detail="Project path missing from scan metadata.")

    for df in payload.selected_dockerfiles:
        if df not in scanned_dockerfiles:
            raise HTTPException(status_code=400, detail=f"Dockerfile '{df}' was not found in scan results.")

    for cf in payload.selected_compose_files:
        if cf not in scanned_compose:
            raise HTTPException(status_code=400, detail=f"Compose file '{cf}' was not found in scan results.")

    # Update the job metadata with the user's selections
    # run_after_analysis records intent to enable a post-analysis manual Compose run from the
    # results UI; it does not auto-run or auto-deploy Compose (worker payload omits it on purpose).
    updated_meta = {
        **job.input_metadata,
        "selected_dockerfiles": payload.selected_dockerfiles,
        "selected_compose_files": payload.selected_compose_files,
        "primary_compose_file": payload.primary_compose_file or (payload.selected_compose_files[0] if payload.selected_compose_files else None),
        "analysis_mode": payload.analysis_mode,
        "build_selected_images": payload.build_selected_images,
        "run_after_analysis": payload.run_after_analysis,
    }

    from app.infrastructure.db.models import JobStatus
    job.input_metadata = updated_meta
    job.status = JobStatus.queued
    await session.flush()
    await session.commit()

    await enqueue_job(
        "run_project_analysis",
        {
            "user_id": str(current_user.id),
            "job_id": str(payload.project_id),
            "project_path": project_path,
            "dockerfiles": payload.selected_dockerfiles or scanned_dockerfiles,
            "compose_files": payload.selected_compose_files or scanned_compose,
            "primary_compose_file": updated_meta["primary_compose_file"],
            "analysis_mode": payload.analysis_mode,
            "build_selected_images": payload.build_selected_images,
        },
    )

    return AnalysisEnqueueResponse(job_id=payload.project_id, status="queued")


@router.post("/upload", response_model=AnalysisEnqueueResponse)
async def upload_project(
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    """Legacy single-step upload endpoint — kept for backwards compatibility.

    New callers should use POST /scan then POST /analyze instead.
    """
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
    archive_path = upload_root / f"{archive_stem}-tmp.zip"
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

    meta = scan_result["db_safe_summary"]
    service = AnalysisService(session)
    job_id = await service.enqueue_job(current_user.id, JobType.project, meta)

    dockerfiles = meta["dockerfiles"]
    compose_files = meta["compose_files"]

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
            "build_selected_images": False,
        },
    )
    return AnalysisEnqueueResponse(job_id=uuid.UUID(str(job_id)), status="queued")
