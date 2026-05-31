import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.api.research_privacy import anonymize_user_id
from app.infrastructure.db.models import AnalysisJobModel, JobStatus, JobType
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import get_db_session
from app.main import create_app
from tests.conftest import auth_header_for, make_user


@pytest.fixture
def research_app(fake_session):
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def no_lifespan(_app):
        yield

    app_instance = create_app()
    app_instance.router.lifespan_context = no_lifespan

    async def fake_db():
        yield fake_session

    app_instance.dependency_overrides[get_db_session] = fake_db
    yield app_instance
    app_instance.dependency_overrides.clear()


@pytest.fixture
def research_client(research_app):
    with TestClient(research_app) as client:
        yield client


def test_research_requires_auth(research_client: TestClient):
    response = research_client.get("/api/v1/research/summary")
    assert response.status_code == 401


def test_research_summary_shapes(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    user = make_user()
    research_app.dependency_overrides[get_current_user] = lambda: user

    async def count_jobs_global(_self):
        return 5

    async def count_jobs_since(_self, _since):
        return 2

    async def aggregate_jobs_by_type(_self):
        return {"dockerfile": 3, "compose": 2}

    async def aggregate_jobs_by_status(_self):
        return {"done": 4, "failed": 1}

    async def daily_job_counts(_self, _since):
        return [(date(2026, 5, 1), 3), (date(2026, 5, 2), 2)]

    async def avg_score_global(_self):
        return 72.5

    async def grade_distribution_global(_self):
        return {"B": 3, "A": 2}

    monkeypatch.setattr(JobRepository, "count_jobs_global", count_jobs_global)
    monkeypatch.setattr(JobRepository, "count_jobs_since", count_jobs_since)
    monkeypatch.setattr(JobRepository, "aggregate_jobs_by_type", aggregate_jobs_by_type)
    monkeypatch.setattr(JobRepository, "aggregate_jobs_by_status", aggregate_jobs_by_status)
    monkeypatch.setattr(JobRepository, "daily_job_counts", daily_job_counts)
    monkeypatch.setattr(JobRepository, "avg_score_global", avg_score_global)
    monkeypatch.setattr(JobRepository, "grade_distribution_global", grade_distribution_global)

    response = research_client.get("/api/v1/research/summary", headers=auth_header_for(user.id))
    assert response.status_code == 200
    data = response.json()
    assert data["total_jobs"] == 5
    assert data["jobs_last_7_days"] == 2
    assert data["count_by_type"]["dockerfile"] == 3
    assert data["avg_score"] == 72.5
    assert data["grade_distribution"]["A"] == 2
    assert len(data["daily_buckets"]) == 2
    assert data["daily_buckets"][0]["bucket_date"] == "2026-05-01"


def test_research_jobs_list_anonymized(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    """Jobs list must not expose user_id, input_metadata, or raw result."""
    requester = make_user(uuid.uuid4())
    owner_id = uuid.uuid4()
    research_app.dependency_overrides[get_current_user] = lambda: requester

    job_other = AnalysisJobModel(
        id=uuid.uuid4(),
        user_id=owner_id,
        type=JobType.compose,
        status=JobStatus.done,
        input_metadata={"filename": "c.yml"},
        result={"score": 80, "grade": "A", "errors": [], "warnings": [], "suggestions": [], "securityIssues": []},
        created_at=datetime.now(UTC),
    )

    async def count_filtered(_self, **_kwargs):
        return 1

    async def list_global(_self, **_kwargs):
        return [job_other]

    monkeypatch.setattr(JobRepository, "count_jobs_global_filtered", count_filtered)
    monkeypatch.setattr(JobRepository, "list_jobs_global", list_global)

    response = research_client.get(
        "/api/v1/research/jobs",
        headers=auth_header_for(requester.id),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]

    # Privacy: real user_id must not be present.
    assert "user_id" not in item
    # Privacy: raw input_metadata must not be present.
    assert "input_metadata" not in item
    # Privacy: raw result must not be present.
    assert "result" not in item

    # Anonymized submitter must be present and stable.
    assert item["anonymized_submitter"] == anonymize_user_id(owner_id)
    assert item["anonymized_submitter"].startswith("user_")

    # Public fields must be present.
    assert item["score"] == 80
    assert item["grade"] == "A"
    assert "public_metadata" in item
    assert "public_result" in item


def test_research_job_by_id(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    requester = make_user()
    jid = uuid.uuid4()
    owner_id = uuid.uuid4()
    research_app.dependency_overrides[get_current_user] = lambda: requester

    job_row = AnalysisJobModel(
        id=jid,
        user_id=owner_id,
        type=JobType.dockerfile,
        status=JobStatus.done,
        input_metadata={},
        result={"score": 50, "grade": "C", "errors": [], "warnings": [], "suggestions": [], "securityIssues": []},
        created_at=datetime.now(UTC),
    )

    async def get_job_global(_self, job_id):
        return job_row if job_id == jid else None

    monkeypatch.setattr(JobRepository, "get_job_global", get_job_global)

    r_ok = research_client.get(f"/api/v1/research/jobs/{jid}", headers=auth_header_for(requester.id))
    assert r_ok.status_code == 200
    data = r_ok.json()

    # Must not expose raw user_id.
    assert "user_id" not in data
    assert data["anonymized_submitter"] == anonymize_user_id(owner_id)
    assert data["score"] == 50

    r404 = research_client.get(f"/api/v1/research/jobs/{uuid.uuid4()}", headers=auth_header_for(requester.id))
    assert r404.status_code == 404


def test_research_jobs_pagination_total(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    user = make_user()
    research_app.dependency_overrides[get_current_user] = lambda: user

    captured = {}

    async def count_filtered(_self, **_kwargs):
        return 25

    async def list_global(_self, *, limit, offset, **_kwargs):
        captured["limit"] = limit
        captured["offset"] = offset
        return []

    monkeypatch.setattr(JobRepository, "count_jobs_global_filtered", count_filtered)
    monkeypatch.setattr(JobRepository, "list_jobs_global", list_global)

    response = research_client.get(
        "/api/v1/research/jobs",
        params={"limit": 10, "offset": 5},
        headers=auth_header_for(user.id),
    )
    assert response.status_code == 200
    assert response.json()["total"] == 25
    assert captured["limit"] == 10
    assert captured["offset"] == 5


def test_research_privacy_no_leak(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    """Sensitive fields in input_metadata and result must never appear in the response."""
    user = make_user()
    owner_id = uuid.uuid4()
    research_app.dependency_overrides[get_current_user] = lambda: user

    jid = uuid.uuid4()
    sensitive_job = AnalysisJobModel(
        id=jid,
        user_id=owner_id,
        type=JobType.compose,
        status=JobStatus.done,
        input_metadata={
            "filename": "secret-project/docker-compose.yml",
            "dockerfile_content": "FROM ubuntu\nRUN echo secret",
            "compose_content": "version: '3'\nservices:\n  db:\n    image: postgres",
            "project_path": "/tmp/uploads/private-project-xyz",
            "line_count": 42,
            "service_count": 3,
        },
        result={
            "score": 70,
            "grade": "B",
            "errors": [{"line": 5, "code": "DL3008", "severity": "error", "message": "Pin versions in apt get", "suggestion": "Use specific version", "doc_url": "https://example.com/DL3008"}],
            "warnings": [{"line": 1, "code": "DL3006", "severity": "warning", "message": "Always tag the version", "suggestion": "Add version tag", "doc_url": None}],
            "suggestions": [],
            "securityIssues": [{"line": 2, "code": "SEC001", "severity": "error", "message": "Hardcoded secret detected: API_KEY=abc123", "suggestion": "Use env var", "doc_url": None}],
        },
        created_at=datetime.now(UTC),
    )

    async def get_job_global(_self, job_id):
        return sensitive_job if job_id == jid else None

    monkeypatch.setattr(JobRepository, "get_job_global", get_job_global)

    r = research_client.get(f"/api/v1/research/jobs/{jid}", headers=auth_header_for(user.id))
    assert r.status_code == 200
    data = r.json()

    # Must not leak user identity.
    assert "user_id" not in data
    assert "email" not in data

    # Must not leak raw metadata.
    assert "input_metadata" not in data
    raw_meta_str = str(data)
    assert "secret-project" not in raw_meta_str
    assert "dockerfile_content" not in raw_meta_str
    assert "compose_content" not in raw_meta_str
    assert "/tmp/uploads" not in raw_meta_str
    assert "project_path" not in raw_meta_str

    # Must not leak raw result (free-text messages, line numbers).
    assert "result" not in data
    assert "Pin versions in apt get" not in raw_meta_str
    assert "API_KEY=abc123" not in raw_meta_str
    assert "Hardcoded secret detected" not in raw_meta_str

    # Safe aggregates must still be accessible.
    pub_result = data["public_result"]
    assert pub_result["score"] == 70
    assert pub_result["grade"] == "B"
    assert pub_result["errors_count"] == 1
    assert pub_result["warnings_count"] == 1
    assert pub_result["security_count"] == 1
    assert "DL3008" in pub_result["issue_codes"]

    pub_meta = data["public_metadata"]
    assert pub_meta["line_count"] == 42
    assert pub_meta["service_count"] == 3
    # Extension derived from filename but full filename not exposed.
    assert pub_meta["file_extension"] == ".yml"
    assert "secret-project" not in str(pub_meta)
    assert "filename" not in pub_meta


def test_research_anonymized_submitter_stable(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    """The same user_id must always produce the same anonymized_submitter."""
    user = make_user()
    owner_id = uuid.uuid4()
    research_app.dependency_overrides[get_current_user] = lambda: user

    def make_job():
        return AnalysisJobModel(
            id=uuid.uuid4(),
            user_id=owner_id,
            type=JobType.dockerfile,
            status=JobStatus.done,
            input_metadata={},
            result={"score": 60, "grade": "C", "errors": [], "warnings": [], "suggestions": [], "securityIssues": []},
            created_at=datetime.now(UTC),
        )

    async def count_filtered(_self, **_kwargs):
        return 2

    call_count = {"n": 0}

    async def list_global(_self, **_kwargs):
        call_count["n"] += 1
        return [make_job(), make_job()]

    monkeypatch.setattr(JobRepository, "count_jobs_global_filtered", count_filtered)
    monkeypatch.setattr(JobRepository, "list_jobs_global", list_global)

    response = research_client.get("/api/v1/research/jobs", headers=auth_header_for(user.id))
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 2
    # Both jobs owned by the same user_id should share the same anonymized_submitter.
    assert items[0]["anonymized_submitter"] == items[1]["anonymized_submitter"]
    assert items[0]["anonymized_submitter"] == anonymize_user_id(owner_id)


def test_research_findings_empty_summary(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    user = make_user()
    research_app.dependency_overrides[get_current_user] = lambda: user

    async def list_global(_self, **_kwargs):
        return []

    monkeypatch.setattr(JobRepository, "list_jobs_global", list_global)
    response = research_client.get(
        "/api/v1/research/findings",
        headers=auth_header_for(user.id),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total_findings"] == 0
    assert body["total_jobs_considered"] == 0
    assert body["top_overall"] == []
    assert body["top_errors"] == []
    assert body["top_warnings"] == []
    assert body["top_info"] == []
    assert body["top_security"] == []


def test_research_findings_counts_top_level(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    user = make_user()
    research_app.dependency_overrides[get_current_user] = lambda: user

    docker_job = AnalysisJobModel(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        type=JobType.dockerfile,
        status=JobStatus.done,
        input_metadata={},
        result={
            "errors": [{"code": "DL3008", "severity": "error", "message": "Pin apt versions"}],
            "warnings": [{"code": "DL3006", "severity": "warning", "message": "Always tag image"}],
            "suggestions": [{"code": "GEN001", "severity": "info", "message": "Use LABEL metadata"}],
            "securityIssues": [{"code": "SEC001", "severity": "error", "message": "Hardcoded secret"}],
        },
        created_at=datetime.now(UTC),
    )
    compose_job = AnalysisJobModel(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        type=JobType.compose,
        status=JobStatus.done,
        input_metadata={},
        result={
            "errors": [{"code": "DL3008", "severity": "error", "message": "Pin apt versions"}],
            "warnings": [],
            "suggestions": [],
            "securityIssues": [],
        },
        created_at=datetime.now(UTC),
    )

    async def list_global(_self, **_kwargs):
        return [docker_job, compose_job]

    monkeypatch.setattr(JobRepository, "list_jobs_global", list_global)

    response = research_client.get(
        "/api/v1/research/findings",
        headers=auth_header_for(user.id),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total_jobs_considered"] == 2
    assert body["total_findings"] == 5
    top_error = body["top_errors"][0]
    assert top_error["code"] == "DL3008"
    assert top_error["count"] == 2
    assert top_error["workflow_counts"]["dockerfile"] == 1
    assert top_error["workflow_counts"]["compose"] == 1
    assert body["top_warnings"][0]["code"] == "DL3006"
    assert body["top_info"][0]["code"] == "GEN001"
    assert body["top_security"][0]["code"] == "SEC001"


def test_research_findings_counts_project_per_file_results(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    user = make_user()
    research_app.dependency_overrides[get_current_user] = lambda: user

    project_job = AnalysisJobModel(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        type=JobType.project,
        status=JobStatus.done,
        input_metadata={"project_path": "/tmp/private-project"},
        result={
            "errors": [{"code": "TOP001", "severity": "error", "message": "top level"}],
            "per_file_results": [
                {
                    "file_path": "services/api/Dockerfile",
                    "errors": [{"code": "DL3018", "severity": "error", "message": "Pin apk versions"}],
                    "warnings": [],
                    "suggestions": [],
                    "securityIssues": [],
                },
                {
                    "file_path": "compose.yml",
                    "errors": [{"code": "DL3018", "severity": "error", "message": "Pin apk versions"}],
                    "warnings": [{"code": "CMP001", "severity": "warning", "message": "Missing restart policy"}],
                    "suggestions": [],
                    "securityIssues": [],
                },
            ],
        },
        created_at=datetime.now(UTC),
    )

    async def list_global(_self, **_kwargs):
        return [project_job]

    monkeypatch.setattr(JobRepository, "list_jobs_global", list_global)

    response = research_client.get(
        "/api/v1/research/findings",
        headers=auth_header_for(user.id),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total_findings"] == 3
    assert body["top_errors"][0]["code"] == "DL3018"
    assert body["top_errors"][0]["count"] == 2
    assert body["top_errors"][0]["workflow_counts"]["project"] == 2
    assert body["top_warnings"][0]["code"] == "CMP001"


def test_research_findings_limit_is_respected(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    user = make_user()
    research_app.dependency_overrides[get_current_user] = lambda: user

    job = AnalysisJobModel(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        type=JobType.compose,
        status=JobStatus.done,
        input_metadata={},
        result={
            "errors": [],
            "warnings": [
                {"code": "W001", "severity": "warning", "message": "Warning one"},
                {"code": "W002", "severity": "warning", "message": "Warning two"},
                {"code": "W003", "severity": "warning", "message": "Warning three"},
            ],
            "suggestions": [],
            "securityIssues": [],
        },
        created_at=datetime.now(UTC),
    )

    async def list_global(_self, **_kwargs):
        return [job]

    monkeypatch.setattr(JobRepository, "list_jobs_global", list_global)

    response = research_client.get(
        "/api/v1/research/findings",
        params={"limit": 2},
        headers=auth_header_for(user.id),
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["top_warnings"]) == 2
    assert len(body["top_overall"]) == 2


def test_research_findings_privacy_no_sensitive_leak(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
    user = make_user()
    research_app.dependency_overrides[get_current_user] = lambda: user

    sensitive_job = AnalysisJobModel(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        type=JobType.dockerfile,
        status=JobStatus.done,
        input_metadata={
            "project_path": "/tmp/private-repo",
            "source_preview": "FROM private.registry.local/my-app",
            "filename": "secret/Dockerfile",
        },
        result={
            "errors": [
                {
                    "code": "DL4000",
                    "severity": "error",
                    "message": "Token leaked token=abc123 at /tmp/private-repo/Dockerfile from api.internal.local 10.1.2.3",
                    "doc_url": "https://example.com/docs",
                }
            ],
            "warnings": [],
            "suggestions": [],
            "securityIssues": [],
        },
        created_at=datetime.now(UTC),
    )

    async def list_global(_self, **_kwargs):
        return [sensitive_job]

    monkeypatch.setattr(JobRepository, "list_jobs_global", list_global)

    response = research_client.get(
        "/api/v1/research/findings",
        headers=auth_header_for(user.id),
    )
    assert response.status_code == 200
    body = response.json()
    blob = str(body)
    assert "private-repo" not in blob
    assert "token=abc123" not in blob
    assert "api.internal.local" not in blob
    assert "10.1.2.3" not in blob
    assert "/tmp/private-repo" not in blob
    assert "input_metadata" not in blob
