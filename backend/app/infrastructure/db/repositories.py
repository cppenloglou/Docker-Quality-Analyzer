import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import Select, select
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

    async def create_job(self, user_id: uuid.UUID, job_type: JobType, metadata: dict) -> AnalysisJobModel:
        job = AnalysisJobModel(user_id=user_id, type=job_type, status=JobStatus.queued, input_metadata=metadata)
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

    async def list_jobs(self, user_id: uuid.UUID) -> list[AnalysisJobModel]:
        stmt = select(AnalysisJobModel).where(AnalysisJobModel.user_id == user_id).order_by(AnalysisJobModel.created_at.desc())
        rows = await self.session.scalars(stmt)
        return list(rows)
