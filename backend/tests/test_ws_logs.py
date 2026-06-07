import json
import uuid
from unittest.mock import AsyncMock

from app.core.security import create_token


def test_ws_logs_streams_container_log_for_valid_user(client, monkeypatch):
    user_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)

    async def fake_subscribe(channel: str):
        assert channel == f"user:{user_id}:container:web-container:logs"
        yield {
            "event_name": "container.log",
            "user_id": str(user_id),
            "job_id": "j-1",
            "payload": {
                "container_id": "web-container",
                "line": "listening on :8000",
                "stream": "stdout",
                "timestamp": "2026-05-13T10:00:00Z",
            },
            "timestamp": "2026-05-13T10:00:00Z",
        }

    async def fake_get_logs(_uid, _cid):
        return [], None

    monkeypatch.setattr("app.api.routers.ws._get_container_last_logs", fake_get_logs)
    monkeypatch.setattr("app.api.routers.ws.subscribe", fake_subscribe)
    monkeypatch.setattr(
        "app.api.routers.ws._user_has_container_access", AsyncMock(return_value=True)
    )

    with client.websocket_connect(
        f"/ws/users/{user_id}/containers/web-container/logs?token={token}"
    ) as websocket:
        payload = json.loads(websocket.receive_text())
        assert payload["event_name"] == "container.log"
        assert payload["payload"]["container_id"] == "web-container"
        assert payload["payload"]["line"] == "listening on :8000"
        assert payload["payload"]["stream"] == "stdout"


def test_ws_logs_rejects_non_access_token(client):
    # A refresh token must not be accepted on the logs websocket.
    user_id = uuid.uuid4()
    refresh_token = create_token(str(user_id), "refresh", 30)
    with client.websocket_connect(
        f"/ws/users/{user_id}/containers/web-container/logs?token={refresh_token}"
    ) as websocket:
        payload = websocket.receive_json()
        assert payload["error"] == "invalid token"


def test_ws_logs_rejects_user_mismatch(client):
    user_id = uuid.uuid4()
    other_user_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)

    with client.websocket_connect(
        f"/ws/users/{other_user_id}/containers/web-container/logs?token={token}"
    ) as websocket:
        payload = websocket.receive_json()
        assert payload["error"] == "invalid token"


def test_ws_logs_hydrates_cached_tail_before_subscribe(client, monkeypatch):
    user_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)

    async def fake_get_logs(_uid, _cid):
        return ["boot line 1", "boot line 2"], "job-abc"

    async def fake_subscribe(channel: str):
        assert channel == f"user:{user_id}:container:web-container:logs"
        yield {
            "event_name": "container.log",
            "user_id": str(user_id),
            "job_id": "job-abc",
            "payload": {
                "container_id": "web-container",
                "line": "live line",
                "stream": "stdout",
                "timestamp": "2026-05-13T10:00:01Z",
            },
            "timestamp": "2026-05-13T10:00:01Z",
        }

    monkeypatch.setattr("app.api.routers.ws._get_container_last_logs", fake_get_logs)
    monkeypatch.setattr("app.api.routers.ws.subscribe", fake_subscribe)
    monkeypatch.setattr(
        "app.api.routers.ws._user_has_container_access", AsyncMock(return_value=True)
    )

    with client.websocket_connect(
        f"/ws/users/{user_id}/containers/web-container/logs?token={token}"
    ) as websocket:
        first = json.loads(websocket.receive_text())
        second = json.loads(websocket.receive_text())
        third = json.loads(websocket.receive_text())
        assert first["payload"]["line"] == "boot line 1"
        assert second["payload"]["line"] == "boot line 2"
        assert third["payload"]["line"] == "live line"


def test_ws_logs_rejects_container_not_owned(client, monkeypatch):
    user_id = uuid.uuid4()
    token = create_token(str(user_id), "access", 30)
    monkeypatch.setattr(
        "app.api.routers.ws._user_has_container_access", AsyncMock(return_value=False)
    )

    with client.websocket_connect(
        f"/ws/users/{user_id}/containers/foreign-container/logs?token={token}"
    ) as websocket:
        payload = websocket.receive_json()
        assert payload["error"] == "forbidden"
