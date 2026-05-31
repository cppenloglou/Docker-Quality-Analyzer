import json
import uuid
from unittest.mock import AsyncMock

from app.core.security import create_token


def test_ws_metrics_streams_container_events(client, monkeypatch):
    user_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)

    async def fake_subscribe(channel: str):
        assert channel == "container:web-container:metrics"
        yield {
            "event_name": "container.metrics",
            "user_id": "u-1",
            "job_id": "j-1",
            "payload": {"container_id": "web-container", "cpu_percent": 11.2},
        }

    monkeypatch.setattr("app.api.routers.ws.subscribe", fake_subscribe)
    monkeypatch.setattr("app.api.routers.ws._user_has_container_access", AsyncMock(return_value=True))

    with client.websocket_connect(f"/ws/metrics/web-container?token={token}") as websocket:
        message = websocket.receive_text()
        payload = json.loads(message)
        assert payload["event_name"] == "container.metrics"
        assert payload["payload"]["container_id"] == "web-container"
        assert payload["payload"]["cpu_percent"] == 11.2


def test_ws_jobs_streams_events_with_valid_access_token(client, monkeypatch):
    user_id = uuid.uuid4()
    job_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)

    async def fake_subscribe(channel: str):
        assert channel == f"job:{job_id}:events"
        yield {
            "event_name": "user.analysis.completed",
            "user_id": str(user_id),
            "job_id": str(job_id),
            "payload": {"status": "done"},
        }

    monkeypatch.setattr("app.api.routers.ws.subscribe", fake_subscribe)
    monkeypatch.setattr("app.api.routers.ws._job_belongs_to_user", AsyncMock(return_value=True))

    with client.websocket_connect(f"/ws/jobs/{job_id}?token={token}") as websocket:
        message = websocket.receive_text()
        payload = json.loads(message)
        assert payload["event_name"] == "user.analysis.completed"
        assert payload["job_id"] == str(job_id)


def test_ws_user_container_requires_matching_token(client, monkeypatch):
    user_id = uuid.uuid4()
    other_user_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)

    async def fake_subscribe(channel: str):
        assert channel == f"user:{user_id}:container:web-container:metrics"
        yield {
            "event_name": "container.metrics",
            "user_id": str(user_id),
            "job_id": "j-1",
            "payload": {"container_id": "web-container", "cpu_percent": 9.3},
        }

    monkeypatch.setattr("app.api.routers.ws.subscribe", fake_subscribe)

    with client.websocket_connect(
        f"/ws/users/{user_id}/containers/web-container?token={token}"
    ) as websocket:
        payload = json.loads(websocket.receive_text())
        assert payload["event_name"] == "container.metrics"

    with client.websocket_connect(
        f"/ws/users/{other_user_id}/containers/web-container?token={token}"
    ) as websocket:
        payload = websocket.receive_json()
        assert payload["error"] == "invalid token"


def test_ws_jobs_rejects_non_owner_subscription(client, monkeypatch):
    user_id = uuid.uuid4()
    job_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)
    monkeypatch.setattr("app.api.routers.ws._job_belongs_to_user", AsyncMock(return_value=False))

    with client.websocket_connect(f"/ws/jobs/{job_id}?token={token}") as websocket:
        payload = websocket.receive_json()
        assert payload["error"] == "forbidden"


def test_ws_metrics_rejects_non_owner_subscription(client, monkeypatch):
    user_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)
    monkeypatch.setattr("app.api.routers.ws._user_has_container_access", AsyncMock(return_value=False))

    with client.websocket_connect(f"/ws/metrics/web-container?token={token}") as websocket:
        payload = websocket.receive_json()
        assert payload["error"] == "forbidden"


def test_ws_user_events_streams_with_matching_token(client, monkeypatch):
    user_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)

    async def fake_subscribe(channel: str):
        assert channel == f"user:{user_id}:events"
        yield {
            "event_name": "user.analysis.completed",
            "user_id": str(user_id),
            "job_id": "j-1",
            "payload": {"status": "done"},
        }

    monkeypatch.setattr("app.api.routers.ws.subscribe", fake_subscribe)

    with client.websocket_connect(f"/ws/users/{user_id}/events?token={token}") as websocket:
        payload = websocket.receive_json()
        assert payload["event_name"] == "user.analysis.completed"


def test_ws_user_events_rejects_user_mismatch(client):
    user_id = uuid.uuid4()
    other_user_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)

    with client.websocket_connect(f"/ws/users/{other_user_id}/events?token={token}") as websocket:
        payload = websocket.receive_json()
        assert payload["error"] == "invalid token"
