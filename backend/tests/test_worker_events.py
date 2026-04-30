import pytest
import uuid

from app.workers.tasks import run_compose_deploy, run_compose_stop


@pytest.mark.asyncio
async def test_run_compose_deploy_emits_expected_events(monkeypatch: pytest.MonkeyPatch):
    emitted_events = []

    async def fake_publish(event):
        emitted_events.append(event)

    class FakeSessionContext:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class FakeRepo:
        def __init__(self, _session):
            pass

        async def get_job(self, _job_id, _user_id):
            class _Job:
                input_metadata = {"compose_content": "services: {web: {image: nginx:1.27}}"}

            return _Job()

    async def fake_set_state(_user_id: str, _job_id: str, _state: dict):
        return None

    async def fake_stream(_user_id: str, _job_id: str, container_ids: list[str]):
        container_id = container_ids[0]
        await fake_publish(
            type(
                "Event",
                (),
                {
                    "event_name": "container.metrics",
                    "payload": {"container_id": container_id},
                },
            )()
        )

    monkeypatch.setattr("app.workers.tasks.SessionLocal", lambda: FakeSessionContext())
    monkeypatch.setattr("app.workers.tasks.JobRepository", FakeRepo)
    monkeypatch.setattr(
        "app.workers.tasks._resolve_deploy_spec",
        lambda _user, _job, _meta: {
            "project_name": "dqa-proj",
            "project_dir": "/tmp",
            "compose_file": "/tmp/docker-compose.yml",
        },
    )
    monkeypatch.setattr("app.workers.tasks._set_deploy_state", fake_set_state)
    monkeypatch.setattr("app.workers.tasks._compose_up", lambda _spec: None)
    monkeypatch.setattr("app.workers.tasks._compose_ps_ids", lambda _spec: ["web-123"])
    monkeypatch.setattr("app.workers.tasks._stream_metrics", fake_stream)
    monkeypatch.setattr("app.workers.tasks.publish_event", fake_publish)

    result = await run_compose_deploy(
        None,
        {
            "user_id": str(uuid.uuid4()),
            "job_id": str(uuid.uuid4()),
            "push_public_images": True,
            "run_stack": True,
        },
    )

    assert result["status"] == "deployment workflow acknowledged"
    event_names = [event.event_name for event in emitted_events]
    assert "docker.image.pushed" in event_names
    assert "container.started" in event_names
    assert "container.metrics" in event_names

    started_event = next(event for event in emitted_events if event.event_name == "container.started")
    metrics_event = next(event for event in emitted_events if event.event_name == "container.metrics")
    assert started_event.payload["container_id"] == "web-123"
    assert metrics_event.payload["container_id"] == "web-123"


@pytest.mark.asyncio
async def test_run_compose_stop_downs_stack_and_emits_event(monkeypatch: pytest.MonkeyPatch):
    emitted_events = []
    stop_called = {"value": False}
    cleared_called = {"value": False}

    async def fake_publish(event):
        emitted_events.append(event)

    async def fake_get_state(_user_id: str, _job_id: str):
        return {
            "project_name": "dqa-proj",
            "project_dir": "/tmp",
            "compose_file": "/tmp/docker-compose.yml",
            "container_id": "web-123",
        }

    async def fake_set_stop(_user_id: str, _job_id: str):
        stop_called["value"] = True

    async def fake_clear(_user_id: str, _job_id: str):
        cleared_called["value"] = True

    monkeypatch.setattr("app.workers.tasks.publish_event", fake_publish)
    monkeypatch.setattr("app.workers.tasks._get_deploy_state", fake_get_state)
    monkeypatch.setattr("app.workers.tasks._set_stop_requested", fake_set_stop)
    monkeypatch.setattr("app.workers.tasks._clear_deploy_state", fake_clear)
    monkeypatch.setattr("app.workers.tasks._compose_down", lambda _state, _remove_volumes: None)

    result = await run_compose_stop(
        None,
        {
            "user_id": str(uuid.uuid4()),
            "job_id": str(uuid.uuid4()),
            "remove_volumes": True,
        },
    )

    assert result["status"] == "stopped"
    assert stop_called["value"] is True
    assert cleared_called["value"] is True
    event_names = [event.event_name for event in emitted_events]
    assert "container.stopped" in event_names
