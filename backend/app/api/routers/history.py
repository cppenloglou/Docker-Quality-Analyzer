import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import JobRead
from app.infrastructure.db.models import UserModel
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import get_db_session

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


@router.get("/history", response_model=list[JobRead])
async def get_job_history(
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
