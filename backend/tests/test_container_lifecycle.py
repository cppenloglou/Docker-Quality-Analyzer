"""Tests for container lifecycle: exited detection, deploy state, partial states."""
import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import docker.errors
import pytest


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _uid():
    return str(uuid.uuid4())


# ─── Tests ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stream_metrics_publishes_container_exited_on_not_found():
    """_stream_metrics publishes container.exited when a container disappears (NotFound)."""
    user_id = _uid()
    job_id = _uid()
    container_id = "abc123"

    # First call raises NotFound
    async def fake_inspect(cid):
        raise docker.errors.NotFound("Container not found")

    async def fake_final_state(cid):
        return {
            "container_id": cid,
            "container_name": "web",
            "image": "python:3.12",
            "status": "exited",
            "exit_code": 1,
            "error": "",
            "started_at": "2026-05-13T10:00:00Z",
            "finished_at": "2026-05-13T10:01:00Z",
            "restart_count": 0,
            "oom_killed": False,
            "last_logs": ["error: something went wrong"],
        }

    fake_gateway = MagicMock()
    fake_gateway.inspect_container_state = AsyncMock(return_value={"status": "running"})
    fake_gateway.inspect_container_metrics = fake_inspect
    fake_gateway.inspect_container_final_state = fake_final_state

    published_events: list[Any] = []

    async def capture_event(event):
        published_events.append(event)

    async def fake_is_stop(uid, jid):
        # Never stop requested
        return False

    fake_state = {}

    async def fake_get_state(uid, jid):
        return dict(fake_state)

    async def fake_set_state(uid, jid, state):
        fake_state.update(state)

    with (
        patch("app.workers.tasks.DockerGateway", return_value=fake_gateway),
        patch("app.workers.tasks.publish_event", side_effect=capture_event),
        patch("app.workers.tasks._is_stop_requested", side_effect=fake_is_stop),
        patch("app.workers.tasks._get_deploy_state", side_effect=fake_get_state),
        patch("app.workers.tasks._set_deploy_state", side_effect=fake_set_state),
    ):
        from app.workers.tasks import _stream_metrics
        # Run one iteration — all containers exit immediately
        await _stream_metrics(user_id, job_id, [container_id])

    event_names = [e.event_name for e in published_events]
    assert "container.exited" in event_names
    assert "project.runtime_stopped" in event_names

    exited_event = next(e for e in published_events if e.event_name == "container.exited")
    assert exited_event.payload["exit_code"] == 1
    assert exited_event.payload["container_id"] == container_id


@pytest.mark.asyncio
async def test_stream_metrics_all_containers_exit_publishes_runtime_stopped():
    """When all containers exit, project.runtime_stopped is published."""
    user_id = _uid()
    job_id = _uid()
    container_ids = ["c1", "c2"]

    async def fake_inspect(cid):
        # Both containers raise NotFound on first call
        raise docker.errors.NotFound("gone")

    async def fake_final_state(cid):
        return {
            "container_id": cid,
            "container_name": cid,
            "exit_code": 0,
            "status": "exited",
            "oom_killed": False,
            "last_logs": [],
        }

    fake_gateway = MagicMock()
    fake_gateway.inspect_container_state = AsyncMock(return_value={"status": "running"})
    fake_gateway.inspect_container_metrics = fake_inspect
    fake_gateway.inspect_container_final_state = fake_final_state

    published_events = []

    async def capture(event):
        published_events.append(event)

    async def fake_is_stop(uid, jid):
        return False

    async def fake_get_state(uid, jid):
        return {}

    async def fake_set_state(uid, jid, state):
        pass

    with (
        patch("app.workers.tasks.DockerGateway", return_value=fake_gateway),
        patch("app.workers.tasks.publish_event", side_effect=capture),
        patch("app.workers.tasks._is_stop_requested", side_effect=fake_is_stop),
        patch("app.workers.tasks._get_deploy_state", side_effect=fake_get_state),
        patch("app.workers.tasks._set_deploy_state", side_effect=fake_set_state),
    ):
        from app.workers.tasks import _stream_metrics
        await _stream_metrics(user_id, job_id, container_ids)

    event_names = [e.event_name for e in published_events]
    exited_events = [e for e in published_events if e.event_name == "container.exited"]
    assert len(exited_events) == 2
    assert "project.runtime_stopped" in event_names


def test_deploy_status_returns_exited_container_state(client, app):
    """GET /api/v1/compose/deploy/status/{job_id} returns exited container state from Redis."""
    from app.api.deps import get_current_user
    from app.infrastructure.db.session import get_db_session
    from tests.conftest import make_user, auth_header_for

    user = make_user()
    job_id = uuid.uuid4()

    state = {
        "container_ids": ["abc123"],
        "containers": [
            {
                "id": "abc123",
                "name": "web",
                "status": "exited",
                "exit_code": 1,
                "started_at": "2026-05-13T10:00:00Z",
                "finished_at": "2026-05-13T10:01:00Z",
            }
        ],
        "running_count": 0,
        "exited_count": 1,
        "unhealthy_count": 0,
        "project_name": "test-project",
    }

    from app.infrastructure.events.bus import redis_client as _redis

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db_session] = AsyncMock

    async def fake_get(key: str):
        if "deploy-stop:" in str(key):
            return None
        return json.dumps(state)

    with patch.object(_redis, "get", new=AsyncMock(side_effect=fake_get)):
        response = client.get(
            f"/api/v1/compose/deploy/status/{job_id}",
            headers=auth_header_for(user.id),
        )

    app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["active"] is False
    assert data["runtime_state"] == "exited"
    assert data["exited_count"] == 1
    assert data["running_count"] == 0
    assert len(data["containers"]) == 1
    assert data["containers"][0]["status"] == "exited"
    assert data["containers"][0]["exit_code"] == 1


def test_deploy_status_runtime_state_partial(client, app):
    """Mixed running + exited yields partial and active=true; counts recomputed from containers."""
    from app.api.deps import get_current_user
    from app.infrastructure.db.session import get_db_session
    from tests.conftest import auth_header_for, make_user

    user = make_user()
    job_id = uuid.uuid4()
    state = {
        "container_ids": ["a", "b"],
        "containers": [
            {"id": "a", "status": "running"},
            {"id": "b", "status": "exited", "exit_code": 0},
        ],
        "running_count": 2,
        "exited_count": 0,
        "unhealthy_count": 0,
        "project_name": "demo",
    }
    from app.infrastructure.events.bus import redis_client as _redis

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db_session] = AsyncMock

    async def fake_get(key: str):
        if "deploy-stop:" in str(key):
            return None
        return json.dumps(state)

    with patch.object(_redis, "get", new=AsyncMock(side_effect=fake_get)):
        response = client.get(
            f"/api/v1/compose/deploy/status/{job_id}",
            headers=auth_header_for(user.id),
        )
    app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["runtime_state"] == "partial"
    assert data["active"] is True
    assert data["running_count"] == 1
    assert data["exited_count"] == 1


def test_deploy_status_unhealthy_priority_over_running(client, app):
    """Unhealthy + still running => runtime_state=unhealthy."""
    from app.api.deps import get_current_user
    from app.infrastructure.db.session import get_db_session
    from tests.conftest import auth_header_for, make_user

    user = make_user()
    job_id = uuid.uuid4()
    state = {
        "container_ids": ["a"],
        "containers": [{"id": "a", "status": "running", "health_status": "unhealthy"}],
        "project_name": "demo",
    }
    from app.infrastructure.events.bus import redis_client as _redis

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db_session] = AsyncMock

    async def fake_get(key: str):
        if "deploy-stop:" in str(key):
            return None
        return json.dumps(state)

    with patch.object(_redis, "get", new=AsyncMock(side_effect=fake_get)):
        response = client.get(
            f"/api/v1/compose/deploy/status/{job_id}",
            headers=auth_header_for(user.id),
        )
    app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["runtime_state"] == "unhealthy"
    assert data["active"] is True


def test_deploy_status_stopping_flag(client, app):
    """``stopping: true`` in deploy JSON yields runtime_state=stopping while stack exists."""
    from app.api.deps import get_current_user
    from app.infrastructure.db.session import get_db_session
    from tests.conftest import auth_header_for, make_user

    user = make_user()
    job_id = uuid.uuid4()
    state = {
        "container_ids": ["a"],
        "containers": [{"id": "a", "status": "running"}],
        "stopping": True,
        "project_name": "demo",
    }
    from app.infrastructure.events.bus import redis_client as _redis

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db_session] = AsyncMock

    async def fake_get(key: str):
        if "deploy-stop:" in str(key):
            return None
        return json.dumps(state)

    with patch.object(_redis, "get", new=AsyncMock(side_effect=fake_get)):
        response = client.get(
            f"/api/v1/compose/deploy/status/{job_id}",
            headers=auth_header_for(user.id),
        )
    app.dependency_overrides.clear()

    assert response.status_code == 200
    data = response.json()
    assert data["runtime_state"] == "stopping"
    assert data["active"] is True


@pytest.mark.asyncio
async def test_stream_metrics_skips_inspect_metrics_when_already_exited():
    """Pre-check exits avoid calling Docker stats APIs for exited containers."""
    user_id = _uid()
    job_id = _uid()

    async def forbidden_metrics(cid):
        raise AssertionError(f"inspect_container_metrics unexpectedly called for {cid}")

    async def fake_final_state(cid):
        return {
            "container_id": cid,
            "container_name": "svc",
            "exit_code": 1,
            "status": "exited",
            "oom_killed": False,
            "last_logs": ["oops"],
            "error": "",
        }

    fake_gateway = MagicMock()
    fake_gateway.inspect_container_state = AsyncMock(return_value={"status": "exited"})
    fake_gateway.inspect_container_metrics = AsyncMock(side_effect=forbidden_metrics)
    fake_gateway.inspect_container_final_state = fake_final_state

    redis_boxes: dict[str, Any] = {}

    async def fake_get_state(uid, jid):
        return dict(redis_boxes)

    async def fake_set_state(uid, jid, state):
        redis_boxes.clear()
        redis_boxes.update(state)

    with (
        patch("app.workers.tasks.DockerGateway", return_value=fake_gateway),
        patch("app.workers.tasks.publish_event", new=AsyncMock()),
        patch("app.workers.tasks._is_stop_requested", new=AsyncMock(return_value=False)),
        patch("app.workers.tasks._get_deploy_state", side_effect=fake_get_state),
        patch("app.workers.tasks._set_deploy_state", side_effect=fake_set_state),
    ):
        from app.workers.tasks import _stream_metrics

        await _stream_metrics(user_id, job_id, ["cid1"])

    stored = redis_boxes.get("containers", [])
    assert len(stored) == 1
    assert stored[0]["last_logs"] == ["oops"]


# ─── stopped_by_user vs self-exit state markers ───────────────────────────────


@pytest.mark.asyncio
async def test_stream_metrics_sets_self_exit_markers():
    """After all containers exit naturally, deploy state must carry explicit_runtime_state=exited and stopped_by_user=False."""
    user_id = _uid()
    job_id = _uid()

    fake_gateway = MagicMock()
    fake_gateway.inspect_container_state = AsyncMock(return_value={"status": "running"})
    fake_gateway.inspect_container_metrics = AsyncMock(side_effect=docker.errors.NotFound("gone"))
    fake_gateway.inspect_container_final_state = AsyncMock(
        return_value={"container_id": "c1", "exit_code": 1, "oom_killed": False, "last_logs": []}
    )

    redis_boxes: dict = {}

    async def fake_get_state(uid, jid):
        return dict(redis_boxes)

    async def fake_set_state(uid, jid, state):
        redis_boxes.update(state)

    with (
        patch("app.workers.tasks.DockerGateway", return_value=fake_gateway),
        patch("app.workers.tasks.publish_event", new=AsyncMock()),
        patch("app.workers.tasks._is_stop_requested", new=AsyncMock(return_value=False)),
        patch("app.workers.tasks._get_deploy_state", side_effect=fake_get_state),
        patch("app.workers.tasks._set_deploy_state", side_effect=fake_set_state),
    ):
        from app.workers.tasks import _stream_metrics
        await _stream_metrics(user_id, job_id, ["c1"])

    assert redis_boxes.get("explicit_runtime_state") == "exited"
    assert redis_boxes.get("stopped_by_user") is False
    assert redis_boxes.get("exit_reason") == "all_containers_exited"


@pytest.mark.asyncio
async def test_stream_metrics_user_stop_keeps_user_stop_semantics():
    """When user stop is requested, _stream_metrics should not emit runtime_stopped or set self-exit markers."""
    user_id = _uid()
    job_id = _uid()

    fake_gateway = MagicMock()
    fake_gateway.inspect_container_state = AsyncMock(return_value={"status": "running"})
    fake_gateway.inspect_container_metrics = AsyncMock(side_effect=docker.errors.NotFound("gone"))
    fake_gateway.inspect_container_final_state = AsyncMock(
        return_value={"container_id": "c1", "exit_code": 0, "oom_killed": False, "last_logs": []}
    )

    published_events: list[Any] = []
    redis_boxes: dict[str, Any] = {"stop_requested_by_user": True, "stopped_by_user": True}

    async def capture(event):
        published_events.append(event)

    async def fake_get_state(uid, jid):
        return dict(redis_boxes)

    async def fake_set_state(uid, jid, state):
        redis_boxes.update(state)

    with (
        patch("app.workers.tasks.DockerGateway", return_value=fake_gateway),
        patch("app.workers.tasks.publish_event", side_effect=capture),
        patch("app.workers.tasks._is_stop_requested", new=AsyncMock(return_value=False)),
        patch("app.workers.tasks._get_deploy_state", side_effect=fake_get_state),
        patch("app.workers.tasks._set_deploy_state", side_effect=fake_set_state),
    ):
        from app.workers.tasks import _stream_metrics
        await _stream_metrics(user_id, job_id, ["c1"])

    event_names = [e.event_name for e in published_events]
    assert "container.exited" in event_names
    assert "project.runtime_stopped" not in event_names
    exited_event = next(e for e in published_events if e.event_name == "container.exited")
    assert exited_event.payload.get("stop_requested_by_user") is True
    assert redis_boxes.get("explicit_runtime_state") != "exited"
    assert redis_boxes.get("exit_reason") != "all_containers_exited"


@pytest.mark.asyncio
async def test_deploy_status_differentiates_stopped_by_user_vs_self_exit():
    """compute_deploy_status must return stopped_by_user for user stops and can_retry_runtime accordingly."""
    import json
    from app.api.routers.compose import compute_deploy_status

    user_id = uuid.uuid4()
    job_id = uuid.uuid4()

    # Simulate user-stopped state
    stopped_state = json.dumps({
        "container_ids": ["c1"],
        "containers": [{"id": "c1", "status": "exited"}],
        "explicit_runtime_state": "stopped_by_user",
        "stopped_by_user": True,
        "stop_reason": "user_requested",
    })

    with patch("app.api.routers.compose.redis_client") as mock_redis:
        mock_redis.get = AsyncMock(side_effect=[stopped_state.encode(), None])
        result = await compute_deploy_status(user_id, job_id)

    assert result.runtime_state == "stopped_by_user"
    assert result.stopped_by_user is True
    assert result.can_retry_runtime is True

    # Simulate self-exit state
    self_exit_state = json.dumps({
        "container_ids": ["c1"],
        "containers": [{"id": "c1", "status": "exited"}],
        "explicit_runtime_state": "exited",
        "stopped_by_user": False,
        "exit_reason": "all_containers_exited",
    })

    with patch("app.api.routers.compose.redis_client") as mock_redis:
        mock_redis.get = AsyncMock(side_effect=[self_exit_state.encode(), None])
        result = await compute_deploy_status(user_id, job_id)

    assert result.runtime_state == "exited"
    assert result.stopped_by_user is False
    assert result.can_retry_runtime is False
