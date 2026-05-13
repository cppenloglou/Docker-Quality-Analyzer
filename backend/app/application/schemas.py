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


class PublicResearchJobRead(BaseModel):
    """Privacy-safe, anonymized job row for the public research dashboard."""

    id: uuid.UUID
    anonymized_submitter: str
    type: str
    status: str
    created_at: datetime
    score: int | None = None
    grade: str | None = None
    public_metadata: dict[str, Any]
    public_result: dict[str, Any] | None


class PaginatedPublicResearchJobs(BaseModel):
    items: list[PublicResearchJobRead]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Project scan / analyze schemas
# ---------------------------------------------------------------------------


class DetectedService(BaseModel):
    name: str
    compose_file: str
    image: str | None = None
    build_context: str | None = None
    build_dockerfile: str | None = None
    ports: list[Any] = []
    depends_on: list[str] = []
    db_hints: list[str] = []


class ProjectDetectedAssets(BaseModel):
    dockerfiles: list[str] = []
    compose_files: list[str] = []
    dockerignore_files: list[str] = []
    env_examples: list[str] = []
    stacks: list[str] = []
    package_managers: list[str] = []
    services: list[DetectedService] = []


class ProjectRecommendation(BaseModel):
    analysis_mode: str
    primary_dockerfile: str | None = None
    primary_compose_file: str | None = None
    can_build: bool = False
    can_run: bool = False
    reasons: list[str] = []


class ProjectScanResponse(BaseModel):
    project_id: uuid.UUID
    archive_name: str
    detected: ProjectDetectedAssets
    recommendation: ProjectRecommendation
    warnings: list[str] = []


class ProjectAnalyzeRequest(BaseModel):
    project_id: uuid.UUID
    selected_dockerfiles: list[str] = []
    selected_compose_files: list[str] = []
    primary_compose_file: str | None = None
    analysis_mode: Literal["auto", "dockerfile-only", "compose-only", "full-project"] = "auto"
    build_selected_images: bool = False
    run_after_analysis: bool = False


class PerFileAnalysisResult(BaseModel):
    file_path: str
    file_type: Literal["dockerfile", "compose"]
    score: int
    grade: str
    errors_count: int
    warnings_count: int
    security_count: int
    suggestions_count: int
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    securityIssues: list[dict[str, Any]] = []
    suggestions: list[dict[str, Any]] = []
    meta: dict[str, Any] = {}


class ProjectSummary(BaseModel):
    total_files_analyzed: int
    dockerfiles_analyzed: int
    compose_files_analyzed: int
    total_errors: int
    total_warnings: int
    total_security_issues: int
    total_suggestions: int
    best_score_file: str | None = None
    worst_score_file: str | None = None


class ServiceBuildMapping(BaseModel):
    service: str
    compose_file: str
    build_context: str | None = None
    dockerfile: str | None = None
    resolved_dockerfile: str | None = None
    can_build: bool = False
    can_run: bool = False
    issues: list[str] = []


class ProjectAnalysisResult(BaseModel):
    overall_score: int
    overall_grade: str
    project_summary: ProjectSummary
    per_file_results: list[PerFileAnalysisResult] = []
    service_mappings: list[ServiceBuildMapping] = []
    project_recommendations: list[str] = []
    image_build_results: list["ImageBuildResult"] = []


class ImageBuildResult(BaseModel):
    dockerfile_path: str
    build_context: str
    image_tag: str
    image_id: str | None = None
    status: Literal["success", "failed", "skipped"] = "skipped"
    build_started_at: str | None = None
    build_finished_at: str | None = None
    build_duration_ms: int | None = None
    image_size_bytes: int | None = None
    image_size_human: str | None = None
    layer_count: int | None = None
    base_image: str | None = None
    exposed_ports: list[str] = []
    env_keys: list[str] = []
    labels: dict[str, str] = {}
    entrypoint: list[str] | None = None
    cmd: list[str] | None = None
    user: str | None = None
    workdir: str | None = None
    architecture: str | None = None
    os: str | None = None
    created_at: str | None = None
    repo_tags: list[str] = []
    repo_digests: list[str] = []
    build_logs: list[str] = []
    error_message: str | None = None


class ContainerStateInfo(BaseModel):
    id: str
    name: str | None = None
    service: str | None = None
    image: str | None = None
    status: str | None = None
    health_status: str | None = None
    exit_code: int | None = None
    error: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    restart_count: int | None = None
    oom_killed: bool | None = None
    last_logs: list[str] = []
