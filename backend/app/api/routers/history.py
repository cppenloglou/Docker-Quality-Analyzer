import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.routers.compose import compute_deploy_status, deploy_state_redis_key, deploy_stop_redis_key
from app.application.schemas import JobRead
from app.application.services.job_cleanup import cleanup_job_artifacts
from app.infrastructure.db.models import JobStatus, JobType, UserModel
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import get_db_session
from app.infrastructure.events.bus import redis_client

router = APIRouter(prefix="/api/v1/users/me", tags=["history"])


@router.get("/jobs", response_model=list[JobRead])
async def list_jobs(
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> list[JobRead]:
    jobs = await JobRepository(session).list_jobs(current_user.id)
    return [
        JobRead(
            id=item.id,
            type=item.type.value,
            status=item.status.value,
            input_metadata=item.input_metadata,
            result=item.result,
            created_at=item.created_at,
        )
        for item in jobs
    ]


@router.get("/jobs/{job_id}", response_model=JobRead)
async def get_job(
    job_id: uuid.UUID,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> JobRead:
    job = await JobRepository(session).get_job(job_id, current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobRead(
        id=job.id,
        type=job.type.value,
        status=job.status.value,
        input_metadata=job.input_metadata,
        result=job.result,
        created_at=job.created_at,
    )


@router.get("/jobs/{job_id}/events", response_model=JobRead)
async def get_job_events(
    job_id: uuid.UUID,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> JobRead:
    """Reconciliation endpoint: returns the last-known job state plus result.

    Used by the UI to recover state after a WebSocket disconnect or page refresh
    without relying on Redis event replay.
    """
    job = await JobRepository(session).get_job(job_id, current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return JobRead(
        id=job.id,
        type=job.type.value,
        status=job.status.value,
        input_metadata=job.input_metadata,
        result=job.result,
        created_at=job.created_at,
    )


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: uuid.UUID,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    repo = JobRepository(session)
    job = await repo.get_job(job_id, current_user.id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")

    if job.status in (JobStatus.queued, JobStatus.running):
        raise HTTPException(
            status_code=409,
            detail="Cannot delete a job that is still queued or running. Wait for it to finish.",
        )

    if job.type in (JobType.compose, JobType.project):
        deploy_status = await compute_deploy_status(current_user.id, job_id)
        if deploy_status.active:
            raise HTTPException(
                status_code=409,
                detail="Stop running containers for this job before deleting it.",
            )

    await cleanup_job_artifacts(
        user_id=current_user.id,
        job_id=job_id,
        input_metadata=dict(job.input_metadata or {}),
        result=dict(job.result) if isinstance(job.result, dict) else job.result,
    )

    deleted = await repo.delete_job(job_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job not found.")
    await session.commit()

    await redis_client.delete(deploy_state_redis_key(current_user.id, job_id))
    await redis_client.delete(deploy_stop_redis_key(current_user.id, job_id))

    return Response(status_code=204)


@router.get("/history", response_model=list[JobRead])
async def get_job_history(
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> list[JobRead]:
    return await list_jobs(current_user=current_user, session=session)
