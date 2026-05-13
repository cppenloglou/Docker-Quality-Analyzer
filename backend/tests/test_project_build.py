"""Tests for image build phase in run_project_analysis."""
import asyncio
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_payload(
    tmp_path: Path,
    build_selected_images: bool = False,
    dockerfiles: list[str] | None = None,
    compose_files: list[str] | None = None,
) -> dict[str, Any]:
    user_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    dockerfiles = dockerfiles or []
    compose_files = compose_files or []

    for df in dockerfiles:
        p = tmp_path / df
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("FROM python:3.12\nRUN echo hello\n")

    for cf in compose_files:
        p = tmp_path / cf
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("version: '3'\nservices:\n  web:\n    image: python:3.12\n")

    return {
        "user_id": user_id,
        "job_id": job_id,
        "project_path": str(tmp_path),
        "dockerfiles": dockerfiles,
        "compose_files": compose_files,
        "build_selected_images": build_selected_images,
    }


def _make_fake_session():
    session = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


def _make_fake_job_repo():
    repo = AsyncMock()
    repo.update_status = AsyncMock()
    repo.get_job = AsyncMock(return_value=None)
    return repo


# ─── Tests ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_build_selected_images_false_skips_builds(tmp_path):
    """When build_selected_images=False, no images are built."""
    payload = _make_payload(tmp_path, build_selected_images=False, dockerfiles=["Dockerfile"])

    fake_repo = _make_fake_job_repo()
    fake_svc = AsyncMock()
    fake_svc.analyze_content = AsyncMock(return_value={
        "score": 70,
        "grade": "B",
        "errors": [],
        "warnings": [],
        "securityIssues": [],
        "suggestions": [],
        "meta": {},
    })

    with (
        patch("app.workers.tasks.SessionLocal") as mock_sl,
        patch("app.workers.tasks.JobRepository", return_value=fake_repo),
        patch("app.workers.tasks.AnalysisService", return_value=fake_svc),
        patch("app.workers.tasks.publish_event", new=AsyncMock()),
        patch("app.workers.tasks.map_compose_services", return_value=[]),
    ):
        session_ctx = AsyncMock()
        session_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
        session_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_sl.return_value = session_ctx

        from app.workers.tasks import run_project_analysis
        result = await run_project_analysis(None, payload)

    assert "image_build_results" in result
    assert result["image_build_results"] == []


@pytest.mark.asyncio
async def test_build_selected_images_true_records_results(tmp_path):
    """When build_selected_images=True, image_build_results is populated."""
    payload = _make_payload(tmp_path, build_selected_images=True, dockerfiles=["Dockerfile"])

    fake_repo = _make_fake_job_repo()
    fake_svc = AsyncMock()
    fake_svc.analyze_content = AsyncMock(return_value={
        "score": 70,
        "grade": "B",
        "errors": [],
        "warnings": [],
        "securityIssues": [],
        "suggestions": [],
        "meta": {},
    })

    mock_image = MagicMock()

    async def fake_build_image(path, dockerfile, tag, buildargs=None):
        return mock_image, ["Step 1/2 : FROM python:3.12", "Successfully built abc123def456"]

    async def fake_inspect_image(image_id_or_tag):
        return {
            "image_id": "abc123def456",
            "image_size_bytes": 150_000_000,
            "image_size_human": "150.0 MB",
            "layer_count": 3,
            "architecture": "amd64",
            "os": "linux",
            "created_at": "2026-05-13T10:00:00Z",
            "repo_tags": [image_id_or_tag],
            "repo_digests": [],
            "exposed_ports": [],
            "env_keys": ["PYTHON_VERSION"],
            "labels": {},
            "entrypoint": None,
            "cmd": ["python3"],
            "user": None,
            "workdir": "/app",
        }

    fake_gateway = MagicMock()
    fake_gateway.build_image = fake_build_image
    fake_gateway.inspect_image = fake_inspect_image

    with (
        patch("app.workers.tasks.SessionLocal") as mock_sl,
        patch("app.workers.tasks.JobRepository", return_value=fake_repo),
        patch("app.workers.tasks.AnalysisService", return_value=fake_svc),
        patch("app.workers.tasks.publish_event", new=AsyncMock()),
        patch("app.workers.tasks.map_compose_services", return_value=[]),
        patch("app.workers.tasks.DockerGateway", return_value=fake_gateway),
    ):
        session_ctx = AsyncMock()
        session_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
        session_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_sl.return_value = session_ctx

        from app.workers.tasks import run_project_analysis
        result = await run_project_analysis(None, payload)

    assert "image_build_results" in result
    builds = result["image_build_results"]
    assert len(builds) == 1
    build = builds[0]
    assert build["dockerfile_path"] == "Dockerfile"
    assert build["status"] == "success"
    assert build["image_id"] == "abc123def456"
    assert build["image_size_human"] == "150.0 MB"
    assert build["layer_count"] == 3
    assert len(build["build_logs"]) == 2


@pytest.mark.asyncio
async def test_failed_image_build_records_error_and_job_completes(tmp_path):
    """A failing image build records status='failed' with error_message; job still completes."""
    payload = _make_payload(tmp_path, build_selected_images=True, dockerfiles=["Dockerfile"])

    fake_repo = _make_fake_job_repo()
    fake_svc = AsyncMock()
    fake_svc.analyze_content = AsyncMock(return_value={
        "score": 50,
        "grade": "C",
        "errors": [],
        "warnings": [],
        "securityIssues": [],
        "suggestions": [],
        "meta": {},
    })

    async def failing_build(*args, **kwargs):
        raise RuntimeError("docker build failed: context not found")

    fake_gateway = MagicMock()
    fake_gateway.build_image = failing_build

    with (
        patch("app.workers.tasks.SessionLocal") as mock_sl,
        patch("app.workers.tasks.JobRepository", return_value=fake_repo),
        patch("app.workers.tasks.AnalysisService", return_value=fake_svc),
        patch("app.workers.tasks.publish_event", new=AsyncMock()),
        patch("app.workers.tasks.map_compose_services", return_value=[]),
        patch("app.workers.tasks.DockerGateway", return_value=fake_gateway),
    ):
        session_ctx = AsyncMock()
        session_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
        session_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_sl.return_value = session_ctx

        from app.workers.tasks import run_project_analysis
        result = await run_project_analysis(None, payload)

    # Job should still complete (not raise)
    assert "image_build_results" in result
    builds = result["image_build_results"]
    assert len(builds) == 1
    build = builds[0]
    assert build["status"] == "failed"
    assert "docker build failed" in build["error_message"]

    # Overall job should have an overall_score (not crash)
    assert "overall_score" in result
    assert "per_file_results" in result


@pytest.mark.asyncio
async def test_per_file_results_contain_source_preview(tmp_path):
    """Each per-file result includes a source_preview field."""
    dockerfile_content = "FROM python:3.12\nRUN echo hello\n"
    dockerfile_path = tmp_path / "Dockerfile"
    dockerfile_path.write_text(dockerfile_content)

    payload = {
        "user_id": str(uuid.uuid4()),
        "job_id": str(uuid.uuid4()),
        "project_path": str(tmp_path),
        "dockerfiles": ["Dockerfile"],
        "compose_files": [],
        "build_selected_images": False,
    }

    fake_repo = _make_fake_job_repo()
    fake_svc = AsyncMock()
    fake_svc.analyze_content = AsyncMock(return_value={
        "score": 75,
        "grade": "B",
        "errors": [],
        "warnings": [],
        "securityIssues": [],
        "suggestions": [],
        "meta": {},
    })

    with (
        patch("app.workers.tasks.SessionLocal") as mock_sl,
        patch("app.workers.tasks.JobRepository", return_value=fake_repo),
        patch("app.workers.tasks.AnalysisService", return_value=fake_svc),
        patch("app.workers.tasks.publish_event", new=AsyncMock()),
        patch("app.workers.tasks.map_compose_services", return_value=[]),
    ):
        session_ctx = AsyncMock()
        session_ctx.__aenter__ = AsyncMock(return_value=AsyncMock())
        session_ctx.__aexit__ = AsyncMock(return_value=False)
        mock_sl.return_value = session_ctx

        from app.workers.tasks import run_project_analysis
        result = await run_project_analysis(None, payload)

    assert len(result["per_file_results"]) == 1
    file_result = result["per_file_results"][0]
    assert "source_preview" in file_result
    assert "FROM python:3.12" in file_result["source_preview"]
