import uuid
from datetime import datetime
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
