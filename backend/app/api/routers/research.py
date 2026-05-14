"""Public research analytics — anonymized, privacy-safe.

Any authenticated user can read aggregate statistics and per-job public signals.
No personal identifiers, file contents, paths, or raw metadata are exposed.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.research_privacy import (
    anonymize_user_id,
    sanitize_research_metadata,
    sanitize_research_result,
)
from app.application.schemas import (
    PaginatedPublicResearchJobs,
    PublicResearchJobRead,
    ResearchSummary,
    ResearchTimeBucket,
)
from app.infrastructure.db.models import AnalysisJobModel, UserModel
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import get_db_session

router = APIRouter(prefix="/api/v1/research", tags=["research"])

_DEFAULT_CHART_DAYS = 90
_MAX_LIMIT = 100
_DEFAULT_LIMIT = 50


def _extract_score_grade(result: dict | None) -> tuple[int | None, str | None]:
    if not result or not isinstance(result, dict):
        return None, None
    score_val = result.get("score")
    grade_val = result.get("grade")
    score: int | None = None
    if isinstance(score_val, int):
        score = score_val
    elif isinstance(score_val, float):
        score = int(score_val)
    elif isinstance(score_val, str) and score_val.strip().isdigit():
        score = int(score_val)
    grade: str | None = None
    if isinstance(grade_val, str) and grade_val.strip():
        grade = grade_val.strip()
    return score, grade


def _to_public_research_job(job: AnalysisJobModel) -> PublicResearchJobRead:
    score, grade = _extract_score_grade(job.result)
    return PublicResearchJobRead(
        id=job.id,
        anonymized_submitter=anonymize_user_id(job.user_id),
        type=job.type.value,
        status=job.status.value,
        created_at=job.created_at,
        score=score,
        grade=grade,
        public_metadata=sanitize_research_metadata(dict(job.input_metadata or {})),
        public_result=sanitize_research_result(job.result),
    )


@router.get("/summary", response_model=ResearchSummary)
async def research_summary(
    chart_days: int = Query(default=_DEFAULT_CHART_DAYS, ge=1, le=366),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> ResearchSummary:
    _ = current_user
    repo = JobRepository(session)
    total = await repo.count_jobs_global()
    since_7d = datetime.now(UTC) - timedelta(days=7)
    jobs_last_7 = await repo.count_jobs_since(since_7d)
    count_by_type = await repo.aggregate_jobs_by_type()
    count_by_status = await repo.aggregate_jobs_by_status()
    chart_since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=chart_days - 1)
    raw_buckets = await repo.daily_job_counts(chart_since)
    daily_buckets: list[ResearchTimeBucket] = []
    for bucket_day, cnt in raw_buckets:
        if isinstance(bucket_day, datetime):
            bd = bucket_day.date()
        elif isinstance(bucket_day, date):
            bd = bucket_day
        else:
            bd = bucket_day  # type: ignore[assignment]
        daily_buckets.append(ResearchTimeBucket(bucket_date=bd, count=cnt))

    avg_score = await repo.avg_score_global()
    grade_distribution = await repo.grade_distribution_global()

    return ResearchSummary(
        total_jobs=total,
        count_by_type=count_by_type,
        count_by_status=count_by_status,
        jobs_last_7_days=jobs_last_7,
        avg_score=avg_score,
        grade_distribution=grade_distribution,
        daily_buckets=daily_buckets,
    )


@router.get("/jobs", response_model=PaginatedPublicResearchJobs)
async def list_research_jobs(
    limit: int = Query(default=_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    job_type: str | None = Query(default=None),
    status: str | None = Query(default=None),
    created_after: datetime | None = Query(default=None),
    created_before: datetime | None = Query(default=None),
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> PaginatedPublicResearchJobs:
    _ = current_user
    repo = JobRepository(session)
    total = await repo.count_jobs_global_filtered(
        job_type=job_type,
        status=status,
        created_from=created_after,
        created_to=created_before,
    )
    rows = await repo.list_jobs_global(
        limit=limit,
        offset=offset,
        job_type=job_type,
        status=status,
        created_from=created_after,
        created_to=created_before,
    )
    return PaginatedPublicResearchJobs(
        items=[_to_public_research_job(j) for j in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/jobs/{job_id}", response_model=PublicResearchJobRead)
async def get_research_job(
    job_id: uuid.UUID,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> PublicResearchJobRead:
    _ = current_user
    repo = JobRepository(session)
    job = await repo.get_job_global(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return _to_public_research_job(job)
