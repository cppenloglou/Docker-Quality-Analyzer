from unittest.mock import AsyncMock
import uuid

import pytest
from fastapi import HTTPException

from app.api.routers.compose import ComposeDeployRequest, deploy_compose
from app.infrastructure.db.models import AnalysisJobModel, JobStatus, JobType, UserModel
from app.plugins.compose_runnability_plugin import ComposeRunnabilityPlugin


@pytest.mark.asyncio
async def test_compose_runnability_plugin_accepts_simple_public_images():
    plugin = ComposeRunnabilityPlugin()
    compose = """
services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
"""
    result = await plugin.run({"compose_content": compose})
    runnability = result["runnability"]
    assert runnability["runnable"] is True
    assert runnability["reasons"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("compose", "expected_reason_part"),
    [
        (
            """
services:
  api:
    build: .
    image: example/app:1.0
""",
            "build context",
        ),
        (
            """
services:
  api:
    image: nginx:latest
""",
            "non-latest explicit tag",
        ),
        (
            """
services:
  api:
    image: nginx:1.27
    volumes:
      - ./data:/data
""",
            "bind mount",
        ),
        (
            """
services:
  api:
    image: nginx:1.27
    env_file:
      - .env
""",
            "env_file",
        ),
        (
            """
services:
  api:
    image: nginx:1.27
    environment:
      - TOKEN=${TOKEN}
""",
            "unresolved",
        ),
        (
            """
services:
  api:
    image: nginx:1.27
    privileged: true
""",
            "privileged",
        ),
    ],
)
async def test_compose_runnability_plugin_blocks_non_runnable_cases(compose: str, expected_reason_part: str):
    plugin = ComposeRunnabilityPlugin()
    result = await plugin.run({"compose_content": compose})
    runnability = result["runnability"]
    assert runnability["runnable"] is False
    assert any(expected_reason_part.lower() in reason.lower() for reason in runnability["reasons"])


@pytest.mark.asyncio
async def test_deploy_compose_blocks_non_runnable_compose(monkeypatch: pytest.MonkeyPatch):
    user_id = uuid.uuid4()
    job_id = uuid.uuid4()
    blocked_job = AnalysisJobModel(
        id=job_id,
        user_id=user_id,
        type=JobType.compose,
        status=JobStatus.done,
        input_metadata={},
        result={"meta": {"runnability": {"runnable": False, "reasons": ["build context required"]}}},
    )

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, _job_id, _user_id):
            return blocked_job

    monkeypatch.setattr("app.api.routers.compose.JobRepository", FakeRepo)

    async def fake_enqueue(*_args, **_kwargs):
        return None

    monkeypatch.setattr("app.api.routers.compose.enqueue_job", fake_enqueue)

    with pytest.raises(HTTPException) as exc:
        await deploy_compose(
            ComposeDeployRequest(job_id=job_id, push_public_images=False, run_stack=False),
            current_user=UserModel(id=user_id, email="a@b.com", hashed_password="x"),
            session=AsyncMock(),
        )
    assert exc.value.status_code == 409
    assert "runnability precheck" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_deploy_compose_allows_runnable_compose_and_project(monkeypatch: pytest.MonkeyPatch):
    user_id = uuid.uuid4()
    compose_job_id = uuid.uuid4()
    project_job_id = uuid.uuid4()

    jobs = {
        compose_job_id: AnalysisJobModel(
            id=compose_job_id,
            user_id=user_id,
            type=JobType.compose,
            status=JobStatus.done,
            input_metadata={},
            result={"meta": {"runnability": {"runnable": True, "reasons": []}}},
        ),
        project_job_id: AnalysisJobModel(
            id=project_job_id,
            user_id=user_id,
            type=JobType.project,
            status=JobStatus.done,
            input_metadata={},
            result=None,
        ),
    }

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, job_id, _user_id):
            return jobs.get(job_id)

    calls: list[dict] = []

    async def fake_enqueue(_task, payload):
        calls.append(payload)

    monkeypatch.setattr("app.api.routers.compose.JobRepository", FakeRepo)
    monkeypatch.setattr("app.api.routers.compose.enqueue_job", fake_enqueue)

    compose_response = await deploy_compose(
        ComposeDeployRequest(job_id=compose_job_id, push_public_images=True, run_stack=True),
        current_user=UserModel(id=user_id, email="a@b.com", hashed_password="x"),
        session=AsyncMock(),
    )
    project_response = await deploy_compose(
        ComposeDeployRequest(job_id=project_job_id, push_public_images=False, run_stack=True),
        current_user=UserModel(id=user_id, email="a@b.com", hashed_password="x"),
        session=AsyncMock(),
    )

    assert compose_response.job_id == compose_job_id
    assert project_response.job_id == project_job_id
    assert len(calls) == 2
