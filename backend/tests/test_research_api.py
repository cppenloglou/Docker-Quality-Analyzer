import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
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


def test_research_jobs_list_cross_tenant_user_id(research_client: TestClient, research_app, monkeypatch: pytest.MonkeyPatch):
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
    assert body["items"][0]["user_id"] == str(owner_id)
    assert body["items"][0]["score"] == 80


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
    assert r_ok.json()["user_id"] == str(owner_id)

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
