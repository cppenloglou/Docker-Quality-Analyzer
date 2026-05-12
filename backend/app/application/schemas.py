import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


class UserRead(BaseModel):
    id: uuid.UUID
    email: EmailStr
    created_at: datetime


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserRead


class RefreshRequest(BaseModel):
    refresh_token: str


class ApiKeyRead(BaseModel):
    id: uuid.UUID
    key_prefix: str
    created_at: datetime


class ApiKeyCreateResponse(BaseModel):
    id: uuid.UUID
    key: str
    key_prefix: str


class AnalysisEnqueueResponse(BaseModel):
    job_id: uuid.UUID
    status: str


class Issue(BaseModel):
    line: int = 1
    code: str
    severity: Literal["error", "warning", "info"]
    message: str
    suggestion: str = ""
    doc_url: str | None = None


class AnalysisOutput(BaseModel):
    score: int
    grade: str
    errors: list[Issue]
    warnings: list[Issue]
    suggestions: list[Issue]
    securityIssues: list[Issue]


class JobRead(BaseModel):
    id: uuid.UUID
    type: str
    status: str
    input_metadata: dict[str, Any]
    result: dict[str, Any] | None
    created_at: datetime


class ResearchJobRead(BaseModel):
    """Cross-tenant job row for authenticated research dashboard (see research router docstring)."""

    id: uuid.UUID
    user_id: uuid.UUID
    type: str
    status: str
    input_metadata: dict[str, Any]
    result: dict[str, Any] | None
    created_at: datetime
    score: int | None = None
    grade: str | None = None


class ResearchTimeBucket(BaseModel):
    bucket_date: date
    count: int


class ResearchSummary(BaseModel):
    total_jobs: int
    count_by_type: dict[str, int]
    count_by_status: dict[str, int]
    jobs_last_7_days: int
    avg_score: float | None = None
    grade_distribution: dict[str, int]
    daily_buckets: list[ResearchTimeBucket]


class PaginatedResearchJobs(BaseModel):
    items: list[ResearchJobRead]
    total: int
    limit: int
    offset: int
