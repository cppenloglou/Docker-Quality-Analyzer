import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import (
    AnalysisEnqueueResponse,
    ProjectAnalyzeRequest,
    ProjectDraftRead,
    ProjectDraftSaveRequest,
    ProjectSavedSelections,
    ProjectScanResponse,
    ProjectDetectedAssets,
    DetectedService,
    ProjectRecommendation,
)
from app.application.services.analysis_service import AnalysisService
from app.application.services.project_draft import (
    _EXPIRED_DETAIL,
    expire_draft,
    is_draft_expired,
    seconds_until_expiry,
)
from app.application.services.project_scanner import safe_extract_zip, scan_extracted_project
from app.core.config import get_settings
from app.infrastructure.db.models import JobStatus, JobType, UserModel
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import get_db_session
from app.workers.queue import enqueue_job

router = APIRouter(prefix="/api/v1/project", tags=["project"])
settings = get_settings()


def _draft_expires_at() -> str:
    """ISO8601 UTC timestamp for when a freshly-scanned draft expires."""
    return (datetime.now(UTC) + timedelta(seconds=settings.project_draft_ttl_seconds)).isoformat()


def _build_scan_response(
    project_id: uuid.UUID,
    archive_name: str,
    scan_result: dict,
    meta: dict | None = None,
) -> ProjectScanResponse:
    """Construct a ProjectScanResponse from scanner output and optional stored metadata."""
    detected = scan_result["detected"]
    rec = scan_result["recommendation"]

    workflow_step = "review"
    saved_selections = None
    expires_at = None
    expires_in_secs = None

    if meta:
        workflow_step = meta.get("workflow_step", "review")
        expires_at_str = meta.get("draft_expires_at")
        if expires_at_str:
            try:
                expires_at = datetime.fromisoformat(expires_at_str)
                expires_in_secs = seconds_until_expiry(meta)
            except ValueError:
                pass

        # Reconstruct saved selections only if user has already saved something
        if meta.get("saved_selections_set"):
            saved_selections = ProjectSavedSelections(
                workflow_step=meta.get("workflow_step", "review"),
                selected_dockerfiles=meta.get("selected_dockerfiles", []),
                selected_compose_files=meta.get("selected_compose_files", []),
                primary_compose_file=meta.get("primary_compose_file"),
                analysis_mode=meta.get("analysis_mode", "auto"),
                build_selected_images=meta.get("build_selected_images", False),
                run_after_analysis=meta.get("run_after_analysis", False),
            )

    return ProjectScanResponse(
        project_id=project_id,
        archive_name=archive_name,
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
        workflow_step=workflow_step,
        saved_selections=saved_selections,
        expires_at=expires_at,
        expires_in_seconds=expires_in_secs,
    )


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

    scan_meta = {
        **scan_result["db_safe_summary"],
        "scan_only": True,
        "analysis_confirmed": False,
        "workflow_step": "review",
        "draft_expires_at": _draft_expires_at(),
    }
    service = AnalysisService(session)
    job_id = await service.enqueue_job(
        current_user.id,
        JobType.project,
        scan_meta,
        initial_status=JobStatus.scanned,
    )

    return _build_scan_response(job_id, file.filename, scan_result, scan_meta)


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

    if is_draft_expired(job.input_metadata):
        await expire_draft(job, session)
        raise HTTPException(status_code=410, detail=_EXPIRED_DETAIL)

    if job.status not in {JobStatus.scanned, JobStatus.queued}:
        raise HTTPException(
            status_code=409,
            detail=f"Project is not in a confirmable state (current status: {job.status.value}).",
        )

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

    updated_meta = {
        **job.input_metadata,
        "selected_dockerfiles": payload.selected_dockerfiles,
        "selected_compose_files": payload.selected_compose_files,
        "primary_compose_file": payload.primary_compose_file or (payload.selected_compose_files[0] if payload.selected_compose_files else None),
        "analysis_mode": payload.analysis_mode,
        "build_selected_images": payload.build_selected_images,
        "run_after_analysis": payload.run_after_analysis,
        "scan_only": False,
        "analysis_confirmed": True,
    }

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
            # Always analyze all detected compose files; selection controls deploy choice.
            "compose_files": scanned_compose,
            "primary_compose_file": updated_meta["primary_compose_file"],
            "analysis_mode": payload.analysis_mode,
            "build_selected_images": payload.build_selected_images,
        },
    )

    return AnalysisEnqueueResponse(job_id=payload.project_id, status="queued")


@router.get("/drafts", response_model=list[ProjectDraftRead])
async def list_project_drafts(
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> list[ProjectDraftRead]:
    """List project jobs that were scanned but never had analysis confirmed."""
    jobs = await JobRepository(session).list_scanned_project_drafts(current_user.id)
    result = []
    for job in jobs:
        meta = job.input_metadata
        if is_draft_expired(meta):
            await expire_draft(job, session)
            continue
        result.append(
            ProjectDraftRead(
                project_id=job.id,
                archive_name=meta.get("filename", "unknown.zip"),
                created_at=job.created_at,
                dockerfiles=meta.get("dockerfiles", []),
                compose_files=meta.get("compose_files", []),
                stacks=meta.get("stacks", []),
                service_count=meta.get("service_count", 0),
                workflow_step=meta.get("workflow_step", "review"),
                expires_at=datetime.fromisoformat(meta["draft_expires_at"]) if meta.get("draft_expires_at") else None,
                expires_in_seconds=seconds_until_expiry(meta),
            )
        )
    return result


@router.get("/{project_id}/scan", response_model=ProjectScanResponse)
async def get_project_scan(
    project_id: uuid.UUID,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> ProjectScanResponse:
    """Re-fetch detected assets for a previously scanned project so the user can resume review."""
    repo = JobRepository(session)
    job = await repo.get_job(project_id, current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Project not found.")

    if is_draft_expired(job.input_metadata):
        await expire_draft(job, session)
        raise HTTPException(status_code=410, detail=_EXPIRED_DETAIL)

    if job.status != JobStatus.scanned:
        raise HTTPException(
            status_code=409,
            detail=f"Project is not in scanned state (current status: {job.status.value}).",
        )

    project_path = job.input_metadata.get("project_path")
    archive_name = job.input_metadata.get("filename", "unknown.zip")

    if not project_path or not Path(project_path).is_dir():
        raise HTTPException(
            status_code=410,
            detail="Extracted project directory no longer exists. Please re-upload the archive.",
        )

    try:
        scan_result = scan_extracted_project(Path(project_path), archive_name)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Project re-scan failed: {exc}") from exc

    return _build_scan_response(project_id, archive_name, scan_result, job.input_metadata)


@router.patch("/{project_id}/draft", response_model=ProjectDraftRead)
async def save_project_draft(
    project_id: uuid.UUID,
    payload: ProjectDraftSaveRequest,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> ProjectDraftRead:
    """Persist review/plan step and selections for an in-progress draft."""
    repo = JobRepository(session)
    job = await repo.get_job(project_id, current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Project not found.")

    if is_draft_expired(job.input_metadata):
        await expire_draft(job, session)
        raise HTTPException(status_code=410, detail=_EXPIRED_DETAIL)

    if job.status != JobStatus.scanned:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot save draft for a job in state '{job.status.value}'.",
        )

    # Validate selections against scanned lists
    scanned_dockerfiles: list[str] = job.input_metadata.get("dockerfiles", [])
    scanned_compose: list[str] = job.input_metadata.get("compose_files", [])

    for df in payload.selected_dockerfiles:
        if df not in scanned_dockerfiles:
            raise HTTPException(status_code=400, detail=f"Dockerfile '{df}' was not found in scan results.")

    for cf in payload.selected_compose_files:
        if cf not in scanned_compose:
            raise HTTPException(status_code=400, detail=f"Compose file '{cf}' was not found in scan results.")

    patch: dict = {
        "workflow_step": payload.workflow_step,
        "selected_dockerfiles": payload.selected_dockerfiles,
        "selected_compose_files": payload.selected_compose_files,
        "primary_compose_file": payload.primary_compose_file,
        "analysis_mode": payload.analysis_mode,
        "build_selected_images": payload.build_selected_images,
        "run_after_analysis": payload.run_after_analysis,
        "saved_selections_set": True,
    }

    updated = await repo.update_job_metadata(project_id, current_user.id, patch)
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found.")
    await session.commit()

    meta = updated.input_metadata
    return ProjectDraftRead(
        project_id=updated.id,
        archive_name=meta.get("filename", "unknown.zip"),
        created_at=updated.created_at,
        dockerfiles=meta.get("dockerfiles", []),
        compose_files=meta.get("compose_files", []),
        stacks=meta.get("stacks", []),
        service_count=meta.get("service_count", 0),
        workflow_step=meta.get("workflow_step", "review"),
        expires_at=datetime.fromisoformat(meta["draft_expires_at"]) if meta.get("draft_expires_at") else None,
        expires_in_seconds=seconds_until_expiry(meta),
    )


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
