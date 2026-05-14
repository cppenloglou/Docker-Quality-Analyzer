from datetime import datetime, timezone
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock
import uuid
import zipfile

import pytest
from fastapi import HTTPException

from app.api.deps import get_current_user
from app.application.schemas import TokenResponse, UserRead
from app.core.security import create_token
from app.infrastructure.db.models import AnalysisJobModel, ApiKeyModel, JobStatus, JobType
from app.infrastructure.db.session import get_db_session
from tests.conftest import auth_header_for, make_user


def test_health_endpoint_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_register_returns_tokens(client, monkeypatch, app, fake_db_session_dependency):
    async def fake_register(self, email: str, password: str):
        return TokenResponse(
            access_token="access-token",
            refresh_token="refresh-token",
            user=UserRead(
                id=uuid.uuid4(),
                email=email,
                created_at=datetime.now(timezone.utc),
            ),
        )

    monkeypatch.setattr("app.application.services.auth_service.AuthService.register", fake_register)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    response = client.post("/auth/register", json={"email": "new@example.com", "password": "StrongPass123"})
    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["access_token"] == "access-token"
    assert payload["user"]["email"] == "new@example.com"


def test_login_invalid_credentials_returns_401(client, monkeypatch, app, fake_db_session_dependency):
    async def fake_login(self, email: str, password: str):
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    monkeypatch.setattr("app.application.services.auth_service.AuthService.login", fake_login)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    response = client.post("/auth/login", json={"email": "x@y.com", "password": "wrong-pass"})
    app.dependency_overrides.clear()
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials."


def test_dockerfile_analyze_requires_auth(client, app, fake_db_session_dependency):
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    response = client.post(
        "/api/v1/dockerfile/analyze",
        files={"file": ("Dockerfile", b"FROM alpine:3.20\n", "text/plain")},
    )
    app.dependency_overrides.clear()
    assert response.status_code == 401
    assert "Authentication required" in response.json()["detail"]


def test_dockerfile_analyze_enqueues_job(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="owner@example.com")
    job_id = uuid.uuid4()

    async def fake_enqueue_job(self, user_id, job_type, metadata):
        assert user_id == user.id
        assert job_type == JobType.dockerfile
        assert metadata["filename"] == "Dockerfile"
        return job_id

    queue_calls: list[dict] = []

    async def fake_enqueue(task_name: str, payload: dict):
        queue_calls.append({"task": task_name, "payload": payload})

    monkeypatch.setattr("app.application.services.analysis_service.AnalysisService.enqueue_job", fake_enqueue_job)
    monkeypatch.setattr("app.api.routers.dockerfile.enqueue_job", fake_enqueue)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.post(
        "/api/v1/dockerfile/analyze",
        files={"file": ("Dockerfile", b"FROM alpine:3.20\n", "text/plain")},
        headers=auth_header_for(user.id),
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["job_id"] == str(job_id)
    assert response.json()["status"] == "queued"
    assert queue_calls and queue_calls[0]["task"] == "run_dockerfile_analysis"


def test_compose_deploy_returns_404_when_job_missing(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user()

    class MissingJobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, _job_id, _user_id):
            return None

    monkeypatch.setattr("app.api.routers.compose.JobRepository", MissingJobRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.post(
        "/api/v1/compose/deploy",
        json={"job_id": str(uuid.uuid4()), "push_public_images": False, "run_stack": False},
        headers=auth_header_for(user.id),
    )
    app.dependency_overrides.clear()
    assert response.status_code == 404


def test_compose_deploy_returns_409_when_non_runnable(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user()
    job_id = uuid.uuid4()
    blocked_job = AnalysisJobModel(
        id=job_id,
        user_id=user.id,
        type=JobType.compose,
        status=JobStatus.done,
        input_metadata={},
        result={"meta": {"runnability": {"runnable": False, "reasons": ["build context required"]}}},
    )

    class BlockedJobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, _job_id, _user_id):
            return blocked_job

    monkeypatch.setattr("app.api.routers.compose.JobRepository", BlockedJobRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.post(
        "/api/v1/compose/deploy",
        json={"job_id": str(job_id), "push_public_images": True, "run_stack": True},
        headers=auth_header_for(user.id),
    )
    app.dependency_overrides.clear()
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "runnability precheck" in detail["message"]
    assert "build context required" in detail["reasons"]


def test_compose_deploy_returns_200_for_runnable_compose(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user()
    job_id = uuid.uuid4()
    runnable_job = AnalysisJobModel(
        id=job_id,
        user_id=user.id,
        type=JobType.compose,
        status=JobStatus.done,
        input_metadata={},
        result={"meta": {"runnability": {"runnable": True, "reasons": []}}},
    )

    class RunnableJobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, _job_id, _user_id):
            return runnable_job

    calls: list[dict] = []

    async def fake_enqueue(task_name: str, payload: dict):
        calls.append({"task": task_name, "payload": payload})

    monkeypatch.setattr("app.api.routers.compose.JobRepository", RunnableJobRepo)
    monkeypatch.setattr("app.api.routers.compose.enqueue_job", fake_enqueue)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.post(
        "/api/v1/compose/deploy",
        json={"job_id": str(job_id), "push_public_images": True, "run_stack": True},
        headers=auth_header_for(user.id),
    )
    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["status"] == "queued"
    assert calls and calls[0]["task"] == "run_compose_deploy"


def test_compose_stop_enqueues_stop_job(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user()
    job_id = uuid.uuid4()
    runnable_job = AnalysisJobModel(
        id=job_id,
        user_id=user.id,
        type=JobType.compose,
        status=JobStatus.done,
        input_metadata={},
        result={"meta": {"runnability": {"runnable": True, "reasons": []}}},
    )

    class RunnableJobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, _job_id, _user_id):
            return runnable_job

    calls: list[dict] = []

    async def fake_enqueue(task_name: str, payload: dict):
        calls.append({"task": task_name, "payload": payload})

    monkeypatch.setattr("app.api.routers.compose.JobRepository", RunnableJobRepo)
    monkeypatch.setattr("app.api.routers.compose.enqueue_job", fake_enqueue)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.post(
        "/api/v1/compose/deploy/stop",
        json={"job_id": str(job_id), "remove_volumes": False},
        headers=auth_header_for(user.id),
    )
    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["status"] == "queued"
    assert calls and calls[0]["task"] == "run_compose_stop"


def test_get_job_enforces_user_scope_and_returns_404_for_other_user(client, monkeypatch, app, fake_db_session_dependency):
    requester = make_user(email="requester@example.com")
    owner_id = uuid.uuid4()
    job_id = uuid.uuid4()

    class ScopedJobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, requested_job_id, requested_user_id):
            if requested_job_id == job_id and requested_user_id == owner_id:
                return AnalysisJobModel(
                    id=job_id,
                    user_id=owner_id,
                    type=JobType.compose,
                    status=JobStatus.done,
                    input_metadata={"filename": "docker-compose.yml"},
                    result={"score": 80},
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
            return None

    monkeypatch.setattr("app.api.routers.history.JobRepository", ScopedJobRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: requester

    response = client.get(
        f"/api/v1/users/me/jobs/{job_id}",
        headers=auth_header_for(requester.id),
    )
    app.dependency_overrides.clear()
    assert response.status_code == 404
    assert response.json()["detail"] == "Job not found."


def test_project_upload_enqueues_project_analysis(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="project-owner@example.com")
    job_id = uuid.uuid4()

    async def fake_enqueue_job(self, user_id, job_type, metadata):
        assert user_id == user.id
        assert job_type == JobType.project
        assert metadata["filename"] == "project.zip"
        return job_id

    queue_calls: list[dict] = []

    async def fake_enqueue(task_name: str, payload: dict):
        queue_calls.append({"task": task_name, "payload": payload})

    monkeypatch.setattr("app.application.services.analysis_service.AnalysisService.enqueue_job", fake_enqueue_job)
    monkeypatch.setattr("app.api.routers.project.enqueue_job", fake_enqueue)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    mem_zip = io.BytesIO()
    with zipfile.ZipFile(mem_zip, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("Dockerfile", "FROM alpine:3.20\n")
        archive.writestr("docker-compose.yml", "services:\n  web:\n    image: nginx:1.27\n")
    mem_zip.seek(0)

    response = client.post(
        "/api/v1/project/upload",
        files={"file": ("project.zip", mem_zip.getvalue(), "application/zip")},
        headers=auth_header_for(user.id),
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["job_id"] == str(job_id)
    assert response.json()["status"] == "queued"
    assert queue_calls and queue_calls[0]["task"] == "run_project_analysis"


def test_project_upload_rejects_non_zip_file(client, app, fake_db_session_dependency):
    user = make_user(email="project-owner@example.com")
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.post(
        "/api/v1/project/upload",
        files={"file": ("notes.txt", b"hello", "text/plain")},
        headers=auth_header_for(user.id),
    )

    app.dependency_overrides.clear()
    assert response.status_code == 400
    assert "expects a .zip archive" in response.json()["detail"]


def test_compose_analyze_enqueues_job(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="compose-owner@example.com")
    job_id = uuid.uuid4()

    async def fake_enqueue_job(self, user_id, job_type, metadata):
        assert user_id == user.id
        assert job_type == JobType.compose
        assert metadata["filename"] == "docker-compose.yml"
        return job_id

    queue_calls: list[dict] = []

    async def fake_enqueue(task_name: str, payload: dict):
        queue_calls.append({"task": task_name, "payload": payload})

    monkeypatch.setattr("app.application.services.analysis_service.AnalysisService.enqueue_job", fake_enqueue_job)
    monkeypatch.setattr("app.api.routers.compose.enqueue_job", fake_enqueue)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.post(
        "/api/v1/compose/analyze",
        files={"file": ("docker-compose.yml", b"services:\n  web:\n    image: nginx:1.27\n", "text/plain")},
        headers=auth_header_for(user.id),
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["job_id"] == str(job_id)
    assert response.json()["status"] == "queued"
    assert queue_calls and queue_calls[0]["task"] == "run_compose_analysis"


def test_list_jobs_returns_user_jobs(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="jobs-owner@example.com")
    job_id = uuid.uuid4()

    class JobsRepo:
        def __init__(self, _session):
            pass

        async def list_jobs(self, requested_user_id):
            assert requested_user_id == user.id
            return [
                AnalysisJobModel(
                    id=job_id,
                    user_id=user.id,
                    type=JobType.compose,
                    status=JobStatus.done,
                    input_metadata={"filename": "docker-compose.yml"},
                    result={"score": 88},
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
            ]

    monkeypatch.setattr("app.api.routers.history.JobRepository", JobsRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.get("/api/v1/users/me/jobs", headers=auth_header_for(user.id))

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == str(job_id)
    assert payload[0]["status"] == "done"


def test_history_returns_user_history_list(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="history-owner@example.com")
    job_id = uuid.uuid4()

    class HistoryRepo:
        def __init__(self, _session):
            pass

        async def list_jobs(self, requested_user_id):
            assert requested_user_id == user.id
            return [
                AnalysisJobModel(
                    id=job_id,
                    user_id=user.id,
                    type=JobType.project,
                    status=JobStatus.running,
                    input_metadata={"filename": "project.zip"},
                    result=None,
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
            ]

    monkeypatch.setattr("app.api.routers.history.JobRepository", HistoryRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.get("/api/v1/users/me/history", headers=auth_header_for(user.id))

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == str(job_id)
    assert payload[0]["type"] == "project"


def test_api_key_create_returns_new_key(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="apikey-owner@example.com")
    key_id = uuid.uuid4()

    class ApiKeyRepo:
        def __init__(self, _session):
            pass

        async def create_key(self, requested_user_id):
            assert requested_user_id == user.id
            record = ApiKeyModel(id=key_id, user_id=user.id, key_prefix="dpa_prefix123")
            return record, "dpa_secret_value"

    monkeypatch.setattr("app.api.routers.api_keys.ApiKeyRepository", ApiKeyRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.post("/api/v1/users/me/api-keys", headers=auth_header_for(user.id))

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(key_id)
    assert payload["key"] == "dpa_secret_value"
    assert payload["key_prefix"] == "dpa_prefix123"


def test_api_key_list_returns_active_keys(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="apikey-owner@example.com")
    key_id = uuid.uuid4()
    created_at = datetime.now(timezone.utc)

    class ApiKeyRepo:
        def __init__(self, _session):
            pass

        async def list_keys(self, requested_user_id):
            assert requested_user_id == user.id
            return [
                ApiKeyModel(
                    id=key_id,
                    user_id=user.id,
                    key_prefix="dpa_prefix123",
                    key_hash="hash",
                    created_at=created_at,
                )
            ]

    monkeypatch.setattr("app.api.routers.api_keys.ApiKeyRepository", ApiKeyRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.get("/api/v1/users/me/api-keys", headers=auth_header_for(user.id))

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == str(key_id)
    assert payload[0]["key_prefix"] == "dpa_prefix123"


def test_api_key_revoke_returns_404_when_missing(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="apikey-owner@example.com")
    key_id = uuid.uuid4()

    class ApiKeyRepo:
        def __init__(self, _session):
            pass

        async def revoke(self, requested_user_id, requested_key_id):
            assert requested_user_id == user.id
            assert requested_key_id == key_id
            return False

    monkeypatch.setattr("app.api.routers.api_keys.ApiKeyRepository", ApiKeyRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.delete(
        f"/api/v1/users/me/api-keys/{key_id}",
        headers=auth_header_for(user.id),
    )

    app.dependency_overrides.clear()
    assert response.status_code == 404
    assert response.json()["detail"] == "API key not found."


def test_project_upload_rejects_oversized_archive(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="project-owner@example.com")
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user
    monkeypatch.setattr("app.api.routers.project.settings.max_upload_size_mb", 0)

    response = client.post(
        "/api/v1/project/upload",
        files={"file": ("project.zip", b"small-but-over-zero", "application/zip")},
        headers=auth_header_for(user.id),
    )

    app.dependency_overrides.clear()
    assert response.status_code == 413
    assert "too large" in response.json()["detail"]


def test_auth_refresh_issues_new_tokens(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="refresh@example.com")
    refresh_token = create_token(str(user.id), "refresh", 60)

    class StubUserRepo:
        def __init__(self, _session):
            pass

        async def get_by_id(self, requested_user_id):
            assert requested_user_id == user.id
            return user

    monkeypatch.setattr("app.application.services.auth_service.UserRepository", StubUserRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency

    response = client.post("/auth/refresh", json={"refresh_token": refresh_token})

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]
    assert payload["refresh_token"]
    assert payload["user"]["email"] == "refresh@example.com"


def test_auth_refresh_rejects_access_token(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="refresh@example.com")
    access_token = create_token(str(user.id), "access", 60)

    app.dependency_overrides[get_db_session] = fake_db_session_dependency

    response = client.post("/auth/refresh", json={"refresh_token": access_token})

    app.dependency_overrides.clear()
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid token type."


def test_auth_me_returns_current_user(client, app, fake_db_session_dependency):
    user = make_user(email="me@example.com")
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.get("/auth/me", headers=auth_header_for(user.id))

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(user.id)
    assert payload["email"] == "me@example.com"


def test_job_events_returns_job_state(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="events@example.com")
    job_id = uuid.uuid4()

    class JobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, requested_job_id, requested_user_id):
            assert requested_job_id == job_id
            assert requested_user_id == user.id
            return AnalysisJobModel(
                id=job_id,
                user_id=user.id,
                type=JobType.dockerfile,
                status=JobStatus.done,
                input_metadata={"filename": "Dockerfile"},
                result={"score": 91, "grade": "A"},
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )

    monkeypatch.setattr("app.api.routers.history.JobRepository", JobRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.get(
        f"/api/v1/users/me/jobs/{job_id}/events",
        headers=auth_header_for(user.id),
    )

    app.dependency_overrides.clear()
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == str(job_id)
    assert payload["status"] == "done"
    assert payload["result"]["score"] == 91


def test_job_events_returns_404_for_missing_job(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="events@example.com")

    class JobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, _job_id, _user_id):
            return None

    monkeypatch.setattr("app.api.routers.history.JobRepository", JobRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.get(
        f"/api/v1/users/me/jobs/{uuid.uuid4()}/events",
        headers=auth_header_for(user.id),
    )

    app.dependency_overrides.clear()
    assert response.status_code == 404


def test_delete_job_success_returns_204(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="delete-owner@example.com")
    job_id = uuid.uuid4()
    calls = {"deleted": False}

    class JobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, jid, uid):
            if jid == job_id and uid == user.id:
                return AnalysisJobModel(
                    id=job_id,
                    user_id=user.id,
                    type=JobType.dockerfile,
                    status=JobStatus.done,
                    input_metadata={"filename": "Dockerfile"},
                    result={"score": 90},
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
            return None

        async def delete_job(self, jid, uid):
            assert jid == job_id and uid == user.id
            calls["deleted"] = True
            return True

    redis_del = AsyncMock()
    monkeypatch.setattr("app.api.routers.history.JobRepository", JobRepo)
    monkeypatch.setattr("app.api.routers.history.redis_client.delete", redis_del)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.delete(
        f"/api/v1/users/me/jobs/{job_id}",
        headers=auth_header_for(user.id),
    )
    app.dependency_overrides.clear()
    assert response.status_code == 204
    assert response.content == b""
    assert calls["deleted"] is True
    assert redis_del.await_count == 2


def test_delete_job_returns_404_when_missing(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="delete-missing@example.com")

    class JobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, _jid, _uid):
            return None

        async def delete_job(self, *_a, **_k):
            raise AssertionError("delete_job should not be called")

    monkeypatch.setattr("app.api.routers.history.JobRepository", JobRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.delete(
        f"/api/v1/users/me/jobs/{uuid.uuid4()}",
        headers=auth_header_for(user.id),
    )
    app.dependency_overrides.clear()
    assert response.status_code == 404


@pytest.mark.parametrize("in_progress_status", [JobStatus.running, JobStatus.queued])
def test_delete_job_returns_409_when_in_progress(
    client, monkeypatch, app, fake_db_session_dependency, in_progress_status
):
    user = make_user(email="delete-busy@example.com")
    job_id = uuid.uuid4()

    class JobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, jid, uid):
            if jid == job_id and uid == user.id:
                return AnalysisJobModel(
                    id=job_id,
                    user_id=user.id,
                    type=JobType.dockerfile,
                    status=in_progress_status,
                    input_metadata={"filename": "Dockerfile"},
                    result=None,
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
            return None

        async def delete_job(self, *_a, **_k):
            raise AssertionError("delete_job should not be called")

    monkeypatch.setattr("app.api.routers.history.JobRepository", JobRepo)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.delete(
        f"/api/v1/users/me/jobs/{job_id}",
        headers=auth_header_for(user.id),
    )
    app.dependency_overrides.clear()
    assert response.status_code == 409


def test_delete_job_returns_409_when_compose_deploy_active(client, monkeypatch, app, fake_db_session_dependency):
    user = make_user(email="delete-active-deploy@example.com")
    job_id = uuid.uuid4()

    class JobRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, jid, uid):
            if jid == job_id and uid == user.id:
                return AnalysisJobModel(
                    id=job_id,
                    user_id=user.id,
                    type=JobType.compose,
                    status=JobStatus.done,
                    input_metadata={"filename": "docker-compose.yml"},
                    result={"score": 88},
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
            return None

        async def delete_job(self, *_a, **_k):
            raise AssertionError("delete_job should not be called")

    async def fake_deploy_status(*_a, **_k):
        return SimpleNamespace(active=True)

    monkeypatch.setattr("app.api.routers.history.JobRepository", JobRepo)
    monkeypatch.setattr("app.api.routers.history.compute_deploy_status", fake_deploy_status)
    app.dependency_overrides[get_db_session] = fake_db_session_dependency
    app.dependency_overrides[get_current_user] = lambda: user

    response = client.delete(
        f"/api/v1/users/me/jobs/{job_id}",
        headers=auth_header_for(user.id),
    )
    app.dependency_overrides.clear()
    assert response.status_code == 409
    assert "Stop running containers" in response.json()["detail"]
