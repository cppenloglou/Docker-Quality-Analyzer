"""Tests for DockerGateway log streaming/parsing and runtime inspection."""
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.infrastructure.docker.client import DockerGateway


def _make_gateway(fake_client) -> DockerGateway:
    with patch("docker.from_env", return_value=fake_client):
        return DockerGateway()


def test_split_log_timestamp_parses_rfc3339():
    ts, msg = DockerGateway._split_log_timestamp(
        "2026-05-13T10:00:00.123456789Z hello world"
    )
    assert ts == "2026-05-13T10:00:00.123456789Z"
    assert msg == "hello world"


def test_split_log_timestamp_passthrough_without_timestamp():
    ts, msg = DockerGateway._split_log_timestamp("just a plain log line")
    assert ts is None
    assert msg == "just a plain log line"


@pytest.mark.asyncio
async def test_follow_container_logs_parses_timestamped_lines():
    fake_stream = [
        b"2026-05-13T10:00:00.000000000Z hello world\n",
        b"2026-05-13T10:00:01.000000000Z second line\n",
    ]
    fake_container = MagicMock()
    fake_container.logs.return_value = iter(fake_stream)
    fake_client = MagicMock()
    fake_client.containers.get.return_value = fake_container

    gateway = _make_gateway(fake_client)
    entries = [entry async for entry in gateway.follow_container_logs("cid", tail=10)]

    assert len(entries) == 2
    assert entries[0]["stream"] == "stdout"
    assert entries[0]["line"] == "hello world"
    assert entries[0]["timestamp"] == "2026-05-13T10:00:00.000000000Z"
    assert entries[1]["stream"] == "stdout"
    assert entries[1]["line"] == "second line"

    _, kwargs = fake_container.logs.call_args
    assert kwargs["follow"] is True
    assert kwargs["timestamps"] is True
    assert kwargs["tail"] == 10
    assert "demux" not in kwargs


def test_tail_container_logs_returns_decoded_lines():
    fake_container = MagicMock()
    fake_container.logs.return_value = b"line one\nline two\n"
    fake_client = MagicMock()
    fake_client.containers.get.return_value = fake_container

    gateway = _make_gateway(fake_client)
    lines = gateway._tail_container_logs_sync("cid", 200)

    assert lines == ["line one", "line two"]
    fake_container.logs.assert_called_once_with(tail=200, stream=False)


def test_inspect_container_runtime_maps_service_and_ports():
    fake_container = MagicMock()
    fake_container.attrs = {
        "Name": "/dqa-proj-web-1",
        "RestartCount": 0,
        "Config": {
            "Image": "nginx:1.27",
            "Labels": {"com.docker.compose.service": "web"},
        },
        "State": {"Status": "running", "Health": {"Status": "healthy"}},
        "NetworkSettings": {
            "Networks": {"backend": {"IPAddress": "172.18.0.5"}},
            "Ports": {
                "80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8080"}],
            },
        },
    }
    fake_client = MagicMock()
    fake_client.containers.get.return_value = fake_container

    gateway = _make_gateway(fake_client)
    info = gateway._inspect_container_runtime_sync("cid")

    assert info["service"] == "web"
    assert info["name"] == "dqa-proj-web-1"
    assert info["status"] == "running"
    assert info["health_status"] == "healthy"
    assert info["ip_address"] == "172.18.0.5"
    assert info["ports"] == [
        {"container_port": "80/tcp", "host_bindings": [{"host_ip": "0.0.0.0", "host_port": "8080"}]}
    ]


@pytest.mark.asyncio
async def test_stream_logs_publishes_container_log_events():
    async def fake_follow(container_id, *, tail=200):
        yield {"stream": "stdout", "line": "hello", "timestamp": "2026-05-13T10:00:00Z"}
        yield {"stream": "stderr", "line": "boom", "timestamp": None}

    fake_gateway = MagicMock()
    fake_gateway.follow_container_logs = fake_follow

    published = []

    async def capture(event):
        published.append(event)

    with (
        patch("app.workers.tasks.DockerGateway", return_value=fake_gateway),
        patch("app.workers.tasks.publish_event", side_effect=capture),
        patch("app.workers.tasks._append_deploy_log_line", new=AsyncMock()),
        patch("app.workers.tasks._is_stop_requested", new=AsyncMock(return_value=False)),
    ):
        from app.workers.tasks import _stream_logs

        await _stream_logs(str(uuid.uuid4()), str(uuid.uuid4()), ["c1"])

    log_events = [e for e in published if e.event_name == "container.log"]
    assert len(log_events) == 2
    assert log_events[0].payload["container_id"] == "c1"
    assert log_events[0].payload["line"] == "hello"
    assert log_events[0].payload["stream"] == "stdout"
    assert log_events[1].payload["stream"] == "stderr"


@pytest.mark.asyncio
async def test_build_initial_containers_includes_last_logs():
    fake_gateway = MagicMock()
    fake_gateway.inspect_container_runtime = AsyncMock(
        return_value={
            "id": "cid1",
            "name": "web",
            "service": "app",
            "status": "running",
            "ports": [],
        }
    )
    fake_gateway.tail_container_logs = AsyncMock(return_value=["boot complete"])

    with patch("app.workers.tasks.DockerGateway", return_value=fake_gateway):
        from app.workers.tasks import _build_initial_containers

        result = await _build_initial_containers(["cid1"])

    assert result[0]["last_logs"] == ["boot complete"]
    fake_gateway.tail_container_logs.assert_awaited_once_with("cid1", tail=200)


@pytest.mark.asyncio
async def test_append_deploy_log_line_caps_ring_buffer():
    from app.workers.tasks import DEPLOY_LOG_TAIL_MAX, _append_deploy_log_line

    stored: dict[str, Any] = {
        "containers": [{"id": "c1", "status": "running", "last_logs": [f"line-{i}" for i in range(DEPLOY_LOG_TAIL_MAX)]}]
    }

    async def fake_get(_uid: str, _jid: str):
        return dict(stored)

    async def fake_set(_uid: str, _jid: str, state: dict):
        stored.clear()
        stored.update(state)

    with (
        patch("app.workers.tasks._get_deploy_state", side_effect=fake_get),
        patch("app.workers.tasks._set_deploy_state", side_effect=fake_set),
    ):
        await _append_deploy_log_line("u1", "j1", "c1", "line-new")

    logs = stored["containers"][0]["last_logs"]
    assert len(logs) == DEPLOY_LOG_TAIL_MAX
    assert logs[-1] == "line-new"
    assert logs[0] == "line-1"
