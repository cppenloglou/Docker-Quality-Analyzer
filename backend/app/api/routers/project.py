import uuid
import logging
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import (
    AnalysisEnqueueResponse,
    ProjectGithubUploadRequest,
    ProjectPrimaryComposeRequest,
)
from app.application.services.analysis_service import AnalysisService
from app.application.services.build_selection import select_dockerfiles_for_build
from app.application.services.github_import import download_repo_zipball, resolve_public_repo_target
from app.application.services.project_scanner import safe_extract_zip, scan_extracted_project
from app.core.config import get_settings
from app.infrastructure.db.models import JobStatus, JobType, UserModel
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import get_db_session
from app.workers.queue import enqueue_job

router = APIRouter(prefix="/api/v1/project", tags=["project"])
settings = get_settings()
logger = logging.getLogger("docker-platform-api")


async def _enqueue_project_analysis_job(
    current_user: UserModel,
    session: AsyncSession,
    extract_dir: Path,
    scan_result: dict,
    metadata_overrides: dict | None = None,
) -> AnalysisEnqueueResponse:
    metadata = {
        **scan_result["db_safe_summary"],
        "analysis_confirmed": True,
        "build_selected_images": True,
    }
    if metadata_overrides:
        metadata.update(metadata_overrides)

    dockerfiles: list[str] = metadata.get("dockerfiles", [])
    compose_files: list[str] = metadata.get("compose_files", [])
    primary_compose_file = compose_files[0] if compose_files else None
    build_dockerfiles = select_dockerfiles_for_build(
        dockerfiles,
        extract_dir,
        primary_compose_file=primary_compose_file,
        max_builds=settings.max_image_builds,
    )
    metadata["primary_compose_file"] = primary_compose_file
    metadata["build_dockerfiles"] = build_dockerfiles
    metadata["build_selected_images"] = bool(build_dockerfiles)

    service = AnalysisService(session)
    job_id = await service.enqueue_job(
        current_user.id,
        JobType.project,
        metadata,
        initial_status=JobStatus.queued,
    )

    await enqueue_job(
        "run_project_analysis",
        {
            "user_id": str(current_user.id),
            "job_id": str(job_id),
            "project_path": str(extract_dir),
            "dockerfiles": dockerfiles,
            "compose_files": compose_files,
            "primary_compose_file": primary_compose_file,
            "build_dockerfiles": build_dockerfiles,
            "analysis_mode": "auto",
            "build_selected_images": bool(build_dockerfiles),
        },
    )
    return AnalysisEnqueueResponse(job_id=uuid.UUID(str(job_id)), status="queued")


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

    return await _enqueue_project_analysis_job(current_user, session, extract_dir, scan_result)


@router.post("/upload/github", response_model=AnalysisEnqueueResponse)
async def upload_project_github(
    payload: ProjectGithubUploadRequest,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> AnalysisEnqueueResponse:
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    upload_root = Path(settings.upload_dir) / str(current_user.id)
    upload_root.mkdir(parents=True, exist_ok=True)

    # Scale read timeout with upload cap (~0.75s per MB, minimum 30s).
    read_timeout_s = max(30.0, settings.max_upload_size_mb * 0.75)
    timeout = httpx.Timeout(connect=10.0, read=read_timeout_s, write=30.0, pool=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            target = await resolve_public_repo_target(client, payload.url, payload.ref)
            short_id = uuid.uuid4().hex[:8]
            archive_stem = f"github-{target.owner}-{target.repo}-{short_id}"
            archive_path = upload_root / f"{archive_stem}.zip"
            extract_dir = upload_root / archive_stem
            extract_dir.mkdir(parents=True, exist_ok=True)

            try:
                await download_repo_zipball(client, target, archive_path, max_bytes)
                safe_extract_zip(archive_path, extract_dir)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            finally:
                archive_path.unlink(missing_ok=True)
    except httpx.TimeoutException as exc:
        logger.warning(
            "github_import_timeout",
            extra={"user_id": str(current_user.id)},
            exc_info=True,
        )
        raise HTTPException(status_code=504, detail="GitHub request timed out. Please try again.") from exc
    except httpx.ConnectError as exc:
        logger.error(
            "github_import_connect_error url=%s ref=%s",
            payload.url,
            payload.ref or "",
            extra={"user_id": str(current_user.id)},
            exc_info=True,
        )
        message = str(exc)
        if "name resolution" in message.lower():
            detail = (
                "Failed to contact GitHub: DNS resolution failed from the API container. "
                "Check Docker DNS/network settings and retry."
            )
        else:
            detail = "Failed to contact GitHub due to a network connectivity error."
        raise HTTPException(status_code=502, detail=detail) from exc
    except httpx.HTTPError as exc:
        logger.error(
            "github_import_http_error url=%s ref=%s",
            payload.url,
            payload.ref or "",
            extra={"user_id": str(current_user.id)},
            exc_info=True,
        )
        raise HTTPException(status_code=502, detail="Failed to contact GitHub.") from exc

    archive_label = f"github-{target.owner}-{target.repo}.zip"
    try:
        scan_result = scan_extracted_project(extract_dir, archive_label)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Project scan failed: {exc}") from exc

    metadata_overrides = {
        "source_type": "github_public",
        "source_url": target.source_url,
        "source_ref": target.resolved_ref,
        "repo_owner": target.owner,
        "repo_name": target.repo,
    }
    return await _enqueue_project_analysis_job(
        current_user,
        session,
        extract_dir,
        scan_result,
        metadata_overrides=metadata_overrides,
    )


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
