import pytest
import uuid

from app.workers.tasks import (
    _compose_up,
    _stderr_suggests_host_port_publish_conflict,
    run_compose_deploy,
    run_compose_stop,
)


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

    async def fake_compose_up(_spec, **_kwargs):
        return None

    async def fake_compose_ps_ids(_spec):
        return ["web-123"]

    monkeypatch.setattr("app.workers.tasks._compose_up", fake_compose_up)
    monkeypatch.setattr("app.workers.tasks._compose_ps_ids", fake_compose_ps_ids)
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
    assert "container.started" in event_names
    assert "container.metrics" in event_names

    started_event = next(event for event in emitted_events if event.event_name == "container.started")
    metrics_event = next(event for event in emitted_events if event.event_name == "container.metrics")
    assert started_event.payload["container_id"] == "web-123"
    assert metrics_event.payload["container_id"] == "web-123"


@pytest.mark.asyncio
async def test_run_compose_deploy_clears_redis_when_compose_up_fails(monkeypatch: pytest.MonkeyPatch):
    emitted_events = []
    set_state_calls: list[dict] = []
    down_calls: list[tuple[str, bool]] = []

    async def fake_publish(event):
        emitted_events.append(event)

    async def record_down(spec: dict, remove_volumes: bool):
        down_calls.append((str(spec.get("project_name")), remove_volumes))

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

    async def fake_set_deploy(uid: str, jid: str, state: dict):
        set_state_calls.append(state)

    async def fake_get_deploy(uid: str, jid: str):
        return {}

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
    monkeypatch.setattr("app.workers.tasks._set_deploy_state", fake_set_deploy)
    monkeypatch.setattr("app.workers.tasks._get_deploy_state", fake_get_deploy)

    async def failing_compose_up(_spec, **_kwargs):
        raise RuntimeError("docker-compose up failed: nope")

    monkeypatch.setattr("app.workers.tasks._compose_up", failing_compose_up)
    monkeypatch.setattr("app.workers.tasks._compose_down", record_down)
    monkeypatch.setattr("app.workers.tasks.publish_event", fake_publish)

    user_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    with pytest.raises(RuntimeError, match="docker-compose up failed"):
        await run_compose_deploy(
            None,
            {"user_id": user_id, "job_id": job_id, "run_stack": True},
        )

    # Cleanup state must mark cleanup_completed (not self-exit)
    final_states = [s for s in set_state_calls if s.get("explicit_runtime_state") == "cleanup_completed"]
    assert len(final_states) >= 1
    assert down_calls == [("dqa-proj", False)]
    assert [event.event_name for event in emitted_events] == [
        "deploy.cleanup_started",
        "deploy.cleanup_completed",
        "user.analysis.failed",
    ]


@pytest.mark.asyncio
async def test_run_compose_deploy_cleans_up_when_post_start_work_fails(monkeypatch: pytest.MonkeyPatch):
    emitted_events = []
    set_state_calls: list[dict] = []
    down_calls: list[tuple[str, bool]] = []

    async def fake_publish(event):
        emitted_events.append(event)

    async def record_down(spec: dict, remove_volumes: bool):
        down_calls.append((str(spec.get("project_name")), remove_volumes))

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

    async def fake_set_deploy(uid: str, jid: str, state: dict):
        set_state_calls.append(state)

    async def fake_get_deploy(uid: str, jid: str):
        return {}

    async def fake_compose_up(_spec, **_kwargs):
        return None

    async def fake_compose_ps_ids(_spec):
        return ["web-123"]

    async def failing_stream_metrics(_user_id: str, _job_id: str, _container_ids: list[str]):
        raise RuntimeError("metrics failed after stack start")

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
    monkeypatch.setattr("app.workers.tasks._set_deploy_state", fake_set_deploy)
    monkeypatch.setattr("app.workers.tasks._get_deploy_state", fake_get_deploy)
    monkeypatch.setattr("app.workers.tasks._compose_up", fake_compose_up)
    monkeypatch.setattr("app.workers.tasks._compose_ps_ids", fake_compose_ps_ids)
    monkeypatch.setattr("app.workers.tasks._stream_metrics", failing_stream_metrics)
    monkeypatch.setattr("app.workers.tasks._compose_down", record_down)
    monkeypatch.setattr("app.workers.tasks.publish_event", fake_publish)

    user_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    with pytest.raises(RuntimeError, match="metrics failed"):
        await run_compose_deploy(
            None,
            {"user_id": user_id, "job_id": job_id, "run_stack": True},
        )

    # Cleanup state must mark cleanup_completed
    final_states = [s for s in set_state_calls if s.get("explicit_runtime_state") == "cleanup_completed"]
    assert len(final_states) >= 1
    assert down_calls == [("dqa-proj", False)]
    assert [event.event_name for event in emitted_events] == [
        "container.started",
        "deploy.cleanup_started",
        "deploy.cleanup_completed",
        "user.analysis.failed",
    ]


@pytest.mark.asyncio
async def test_run_compose_stop_downs_stack_and_emits_event(monkeypatch: pytest.MonkeyPatch):
    emitted_events = []
    stop_called = {"value": False}
    set_state_calls: list[dict] = []

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

    async def fake_set_deploy(uid: str, jid: str, state: dict):
        set_state_calls.append(state)

    from unittest.mock import AsyncMock as _AsyncMock
    fake_redis_del = _AsyncMock()

    monkeypatch.setattr("app.workers.tasks.publish_event", fake_publish)
    monkeypatch.setattr("app.workers.tasks._get_deploy_state", fake_get_state)
    monkeypatch.setattr("app.workers.tasks._set_stop_requested", fake_set_stop)
    monkeypatch.setattr("app.workers.tasks._set_deploy_state", fake_set_deploy)
    monkeypatch.setattr("app.workers.tasks.redis_client.delete", fake_redis_del)

    async def fake_compose_down(_state, _remove_volumes):
        return None

    monkeypatch.setattr("app.workers.tasks._compose_down", fake_compose_down)

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
    # Terminal state must mark stopped_by_user=True
    terminal_states = [s for s in set_state_calls if s.get("explicit_runtime_state") == "stopped_by_user"]
    assert len(terminal_states) >= 1
    assert terminal_states[-1]["stopped_by_user"] is True
    event_names = [event.event_name for event in emitted_events]
    assert "container.stopped" in event_names


def test_stderr_port_conflict_detection_covers_bind_and_userland_proxy():
    assert _stderr_suggests_host_port_publish_conflict("port is already allocated")
    assert _stderr_suggests_host_port_publish_conflict(
        "failed to bind port 127.0.0.1:8025: bind: address already in use"
    )
    assert _stderr_suggests_host_port_publish_conflict(
        "Error starting userland proxy: listen tcp4 127.0.0.1:8025: bind: address already in use"
    )
    assert _stderr_suggests_host_port_publish_conflict(
        "driver failed programming external connectivity on endpoint foo"
    )
    assert not _stderr_suggests_host_port_publish_conflict("out of memory")


@pytest.mark.asyncio
async def test_compose_up_strips_ports_when_address_already_in_use(monkeypatch: pytest.MonkeyPatch):
    subprocess_calls: list[tuple[tuple[str, ...], str | None]] = []

    async def fake_stream(cmd: list[str], cwd: str | None, on_line):
        subprocess_calls.append((tuple(cmd), cwd))
        if len(subprocess_calls) == 1:
            await on_line("failed to bind port 127.0.0.1:8025: bind: address already in use")
            return 1
        return 0

    monkeypatch.setattr("app.workers.tasks._run_subprocess_streaming", fake_stream)
    monkeypatch.setattr(
        "app.workers.tasks._build_no_ports_compose",
        lambda _spec: "/tmp/.dqa-no-publish.compose.yml",
    )

    await _compose_up(
        {
            "project_name": "dqa-testproj",
            "project_dir": "/tmp",
            "compose_file": "/tmp/compose.yml",
        }
    )

    assert len(subprocess_calls) == 2
    assert subprocess_calls[1][0][4] == "/tmp/.dqa-no-publish.compose.yml"


@pytest.mark.asyncio
async def test_compose_up_no_fallback_on_unrelated_error(monkeypatch: pytest.MonkeyPatch):
    calls: list[int] = []

    async def fake_stream(_cmd: list[str], cwd: str | None, on_line):
        calls.append(1)
        await on_line("something else went wrong")
        return 1

    monkeypatch.setattr("app.workers.tasks._run_subprocess_streaming", fake_stream)

    with pytest.raises(RuntimeError, match="docker-compose up failed"):
        await _compose_up(
            {
                "project_name": "dqa-x",
                "project_dir": "/tmp",
                "compose_file": "/tmp/c.yml",
            }
        )
    assert len(calls) == 1
