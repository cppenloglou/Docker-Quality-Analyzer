import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import Date, Numeric, Select, and_, cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, verify_password
from app.infrastructure.db.models import (
    AnalysisJobModel,
    ApiKeyModel,
    JobStatus,
    JobType,
    UserModel,
)


class UserRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_user(self, email: str, password: str) -> UserModel:
        user = UserModel(email=email.lower().strip(), hashed_password=hash_password(password))
        self.session.add(user)
        await self.session.flush()
        return user

    async def get_by_email(self, email: str) -> UserModel | None:
        stmt: Select[tuple[UserModel]] = select(UserModel).where(UserModel.email == email.lower().strip())
        return await self.session.scalar(stmt)

    async def get_by_id(self, user_id: uuid.UUID) -> UserModel | None:
        return await self.session.get(UserModel, user_id)

    async def authenticate(self, email: str, password: str) -> UserModel | None:
        user = await self.get_by_email(email)
        if not user:
            return None
        return user if verify_password(password, user.hashed_password) else None


class ApiKeyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_key(self, user_id: uuid.UUID) -> tuple[ApiKeyModel, str]:
        raw = f"dpa_{secrets.token_urlsafe(32)}"
        key_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        record = ApiKeyModel(user_id=user_id, key_prefix=raw[:12], key_hash=key_hash)
        self.session.add(record)
        await self.session.flush()
        return record, raw

    async def list_keys(self, user_id: uuid.UUID) -> list[ApiKeyModel]:
        stmt = (
            select(ApiKeyModel)
            .where(ApiKeyModel.user_id == user_id)
            .where(ApiKeyModel.revoked_at.is_(None))
            .order_by(ApiKeyModel.created_at.desc())
        )
        rows = await self.session.scalars(stmt)
        return list(rows)

    async def get_by_raw_key(self, raw_key: str) -> ApiKeyModel | None:
        key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
        stmt = (
            select(ApiKeyModel)
            .where(ApiKeyModel.key_hash == key_hash)
            .where(ApiKeyModel.revoked_at.is_(None))
        )
        return await self.session.scalar(stmt)

    async def revoke(self, user_id: uuid.UUID, key_id: uuid.UUID) -> bool:
        key = await self.session.get(ApiKeyModel, key_id)
        if not key or key.user_id != user_id or key.revoked_at is not None:
            return False
        key.revoked_at = datetime.now(UTC)
        await self.session.flush()
        return True


class JobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_job(self, user_id: uuid.UUID, job_type: JobType, metadata: dict, initial_status: JobStatus = JobStatus.queued) -> AnalysisJobModel:
        job = AnalysisJobModel(user_id=user_id, type=job_type, status=initial_status, input_metadata=metadata)
        self.session.add(job)
        await self.session.flush()
        return job

    async def update_status(self, job_id: uuid.UUID, user_id: uuid.UUID, status: JobStatus, result: dict | None = None) -> AnalysisJobModel | None:
        job = await self.session.get(AnalysisJobModel, job_id)
        if not job or job.user_id != user_id:
            return None
        job.status = status
        if result is not None:
            job.result = result
        await self.session.flush()
        return job

    async def get_job(self, job_id: uuid.UUID, user_id: uuid.UUID) -> AnalysisJobModel | None:
        job = await self.session.get(AnalysisJobModel, job_id)
        if not job or job.user_id != user_id:
            return None
        return job

    async def delete_job(self, job_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        stmt = delete(AnalysisJobModel).where(
            AnalysisJobModel.id == job_id,
            AnalysisJobModel.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return (result.rowcount or 0) > 0

    async def list_jobs(self, user_id: uuid.UUID) -> list[AnalysisJobModel]:
        stmt = select(AnalysisJobModel).where(AnalysisJobModel.user_id == user_id).order_by(AnalysisJobModel.created_at.desc())
        rows = await self.session.scalars(stmt)
        return list(rows)

    async def update_job_metadata(self, job_id: uuid.UUID, user_id: uuid.UUID, patch: dict) -> AnalysisJobModel | None:
        """Shallow-merge *patch* into a job's input_metadata and flush."""
        job = await self.session.get(AnalysisJobModel, job_id)
        if not job or job.user_id != user_id:
            return None
        job.input_metadata = {**job.input_metadata, **patch}
        await self.session.flush()
        return job

    async def count_jobs_global(self) -> int:
        stmt = select(func.count()).select_from(AnalysisJobModel)
        result = await self.session.scalar(stmt)
        return int(result or 0)

    async def count_jobs_since(self, since: datetime) -> int:
        stmt = select(func.count()).select_from(AnalysisJobModel).where(AnalysisJobModel.created_at >= since)
        result = await self.session.scalar(stmt)
        return int(result or 0)

    async def aggregate_jobs_by_type(self) -> dict[str, int]:
        stmt = select(AnalysisJobModel.type, func.count(AnalysisJobModel.id)).group_by(AnalysisJobModel.type)
        rows = await self.session.execute(stmt)
        return {row[0].value: int(row[1]) for row in rows.all()}

    async def aggregate_jobs_by_status(self) -> dict[str, int]:
        stmt = select(AnalysisJobModel.status, func.count(AnalysisJobModel.id)).group_by(AnalysisJobModel.status)
        rows = await self.session.execute(stmt)
        return {row[0].value: int(row[1]) for row in rows.all()}

    async def daily_job_counts(self, since: datetime) -> list[tuple[datetime, int]]:
        day_bucket = cast(func.date_trunc("day", AnalysisJobModel.created_at), Date)
        stmt = (
            select(day_bucket, func.count(AnalysisJobModel.id))
            .where(AnalysisJobModel.created_at >= since)
            .group_by(day_bucket)
            .order_by(day_bucket)
        )
        rows = await self.session.execute(stmt)
        return [(row[0], int(row[1])) for row in rows.all()]

    async def avg_score_global(self) -> float | None:
        score_txt = AnalysisJobModel.result["score"].astext
        stmt = select(func.avg(cast(score_txt, Numeric))).where(
            AnalysisJobModel.result.isnot(None),
            score_txt.isnot(None),
            score_txt != "",
        )
        val = await self.session.scalar(stmt)
        if val is None:
            return None
        return float(val)

    async def grade_distribution_global(self) -> dict[str, int]:
        grade_txt = AnalysisJobModel.result["grade"].astext
        stmt = (
            select(grade_txt, func.count(AnalysisJobModel.id))
            .where(AnalysisJobModel.result.isnot(None), grade_txt.isnot(None), grade_txt != "")
            .group_by(grade_txt)
        )
        rows = await self.session.execute(stmt)
        return {str(row[0]): int(row[1]) for row in rows.all()}

    def _global_jobs_base_filter(
        self,
        *,
        job_type: str | None,
        status: str | None,
        created_from: datetime | None,
        created_to: datetime | None,
    ) -> list:
        clauses = []
        if job_type is not None:
            try:
                jt = JobType(job_type)
            except ValueError:
                jt = None
            if jt is not None:
                clauses.append(AnalysisJobModel.type == jt)
        if status is not None:
            try:
                st = JobStatus(status)
            except ValueError:
                st = None
            if st is not None:
                clauses.append(AnalysisJobModel.status == st)
        if created_from is not None:
            clauses.append(AnalysisJobModel.created_at >= created_from)
        if created_to is not None:
            clauses.append(AnalysisJobModel.created_at <= created_to)
        return clauses

    async def count_jobs_global_filtered(
        self,
        *,
        job_type: str | None = None,
        status: str | None = None,
        created_from: datetime | None = None,
        created_to: datetime | None = None,
    ) -> int:
        clauses = self._global_jobs_base_filter(
            job_type=job_type, status=status, created_from=created_from, created_to=created_to
        )
        stmt = select(func.count()).select_from(AnalysisJobModel)
        if clauses:
            stmt = stmt.where(and_(*clauses))
        result = await self.session.scalar(stmt)
        return int(result or 0)

    async def list_jobs_global(
        self,
        *,
        limit: int,
        offset: int,
        job_type: str | None = None,
        status: str | None = None,
        created_from: datetime | None = None,
        created_to: datetime | None = None,
    ) -> list[AnalysisJobModel]:
        clauses = self._global_jobs_base_filter(
            job_type=job_type, status=status, created_from=created_from, created_to=created_to
        )
        stmt: Select[tuple[AnalysisJobModel]] = select(AnalysisJobModel).order_by(AnalysisJobModel.created_at.desc())
        if clauses:
            stmt = stmt.where(and_(*clauses))
        stmt = stmt.limit(limit).offset(offset)
        rows = await self.session.scalars(stmt)
        return list(rows)

    async def get_job_global(self, job_id: uuid.UUID) -> AnalysisJobModel | None:
        return await self.session.get(AnalysisJobModel, job_id)
