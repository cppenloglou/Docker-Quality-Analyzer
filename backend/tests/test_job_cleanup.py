import uuid
from pathlib import Path

import pytest

from app.application.services import job_cleanup


def test_collect_image_tags_success_only():
    result = {
        "image_build_results": [
            {"image_tag": "dqa-abc-main", "status": "success"},
            {"image_tag": "dqa-abc-side", "status": "failed"},
            {"image_tag": "dqa-abc-main", "status": "success"},
        ]
    }
    assert job_cleanup.collect_image_tags(result) == ["dqa-abc-main"]


def test_collect_image_tags_empty_when_missing():
    assert job_cleanup.collect_image_tags(None) == []
    assert job_cleanup.collect_image_tags({}) == []


def test_collect_runtime_image_refs_merges_deploy_and_build():
    deploy_state = {
        "containers": [{"image": "nginx:1.27"}, {"image": "dqa-abc-main"}],
    }
    result = {
        "image_build_results": [
            {"image_tag": "dqa-abc-main", "status": "success"},
            {"image_tag": "dqa-other", "status": "success"},
        ]
    }
    refs = job_cleanup.collect_runtime_image_refs(deploy_state, result)
    assert set(refs) == {"dqa-abc-main", "dqa-other", "nginx:1.27"}


def test_safe_project_path_rejects_escape(tmp_path, monkeypatch):
    user_id = uuid.uuid4()
    upload_root = tmp_path / "uploads" / str(user_id)
    upload_root.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()

    monkeypatch.setattr(job_cleanup.settings, "upload_dir", str(tmp_path / "uploads"))

    assert job_cleanup._safe_project_path(user_id, {"project_path": str(outside)}) is None


@pytest.mark.asyncio
async def test_cleanup_job_artifacts_removes_dirs(tmp_path, monkeypatch):
    user_id = uuid.uuid4()
    job_id = uuid.uuid4()
    upload_root = tmp_path / "uploads"
    user_dir = upload_root / str(user_id)
    project_dir = user_dir / "demo-abc12345"
    project_dir.mkdir(parents=True)
    (project_dir / "Dockerfile").write_text("FROM alpine\n", encoding="utf-8")

    deploy_dir = upload_root / "deployments" / str(user_id) / str(job_id)
    deploy_dir.mkdir(parents=True)
    (deploy_dir / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")

    monkeypatch.setattr(job_cleanup.settings, "upload_dir", str(upload_root))
    enqueued: list[tuple[str, dict]] = []

    async def fake_enqueue(task_name: str, payload: dict) -> None:
        enqueued.append((task_name, payload))

    async def fake_load_deploy(_uid, _jid):
        return {
            "project_name": "dqa-deadbeef",
            "project_dir": str(project_dir),
            "compose_file": str(project_dir / "docker-compose.yml"),
            "containers": [{"image": "nginx:1.27"}],
        }

    monkeypatch.setattr(job_cleanup, "enqueue_job", fake_enqueue)
    monkeypatch.setattr(job_cleanup, "_load_deploy_state", fake_load_deploy)

    await job_cleanup.cleanup_job_artifacts(
        user_id=user_id,
        job_id=job_id,
        input_metadata={"project_path": str(project_dir)},
        result={
            "image_build_results": [
                {"image_tag": "dqa-deadbeef0001-abcd1234", "status": "success"},
            ]
        },
    )

    assert not project_dir.exists()
    assert not deploy_dir.exists()
    assert len(enqueued) == 1
    assert enqueued[0][0] == "teardown_job_runtime"
    payload = enqueued[0][1]
    assert payload["user_id"] == str(user_id)
    assert payload["job_id"] == str(job_id)
    assert payload["remove_images"] is True
    assert "dqa-deadbeef0001-abcd1234" in payload["image_tags"]
    assert "nginx:1.27" in payload["image_tags"]
    assert payload["deploy_spec"]["project_name"] == "dqa-deadbeef"


@pytest.mark.asyncio
async def test_cleanup_job_images_worker(monkeypatch):
    from app.workers import tasks

    removed: list[str] = []

    class FakeGateway:
        async def remove_image(self, tag: str) -> bool:
            removed.append(tag)
            return tag != "missing"

    monkeypatch.setattr(tasks, "DockerGateway", lambda: FakeGateway())

    result = await tasks.cleanup_job_images(
        None,
        {
            "user_id": str(uuid.uuid4()),
            "job_id": str(uuid.uuid4()),
            "image_tags": ["dqa-one", "missing", "", "dqa-two"],
        },
    )

    assert removed == ["dqa-one", "missing", "dqa-two"]
    assert result == {"removed": 2, "skipped": 1}


@pytest.mark.asyncio
async def test_teardown_job_runtime_worker(monkeypatch):
    from app.workers import tasks

    compose_calls: list[dict] = []
    removed: list[str] = []

    async def fake_compose_down(spec, **kwargs):
        compose_calls.append({"spec": spec, **kwargs})

    class FakeGateway:
        async def remove_image(self, tag: str) -> bool:
            removed.append(tag)
            return True

    monkeypatch.setattr(tasks, "_compose_down", fake_compose_down)
    monkeypatch.setattr(tasks, "DockerGateway", lambda: FakeGateway())

    result = await tasks.teardown_job_runtime(
        None,
        {
            "user_id": str(uuid.uuid4()),
            "job_id": str(uuid.uuid4()),
            "remove_images": True,
            "deploy_spec": {
                "project_name": "dqa-test",
                "project_dir": "/tmp/proj",
                "compose_file": "/tmp/proj/docker-compose.yml",
            },
            "image_tags": ["dqa-one"],
        },
    )

    assert compose_calls[0]["remove_images"] is True
    assert removed == ["dqa-one"]
    assert result["stack_removed"] is True
    assert result["removed"] == 1
