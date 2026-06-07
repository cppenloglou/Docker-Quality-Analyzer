"""Tests for DomainEvent routing on the Redis event bus."""
from unittest.mock import AsyncMock, patch

import pytest

from app.domain.events import DomainEvent
from app.infrastructure.events import bus


@pytest.mark.asyncio
async def test_container_log_routes_only_to_logs_channel():
    """container.log events must stay on the dedicated logs channel (no user/job flooding)."""
    event = DomainEvent(
        "container.log",
        user_id="u1",
        job_id="j1",
        payload={"container_id": "c1", "line": "hello", "stream": "stdout"},
    )

    publish = AsyncMock()
    with patch.object(bus, "redis_client") as mock_redis:
        mock_redis.publish = publish
        await bus.publish_event(event)

    channels = [call.args[0] for call in publish.await_args_list]
    assert channels == ["user:u1:container:c1:logs"]


@pytest.mark.asyncio
async def test_metrics_event_routes_to_event_and_metrics_channels():
    """Non-log container events keep publishing to user/job/metrics channels."""
    event = DomainEvent(
        "container.metrics",
        user_id="u1",
        job_id="j1",
        payload={"container_id": "c1", "cpu_percent": 1.0},
    )

    publish = AsyncMock()
    with patch.object(bus, "redis_client") as mock_redis:
        mock_redis.publish = publish
        await bus.publish_event(event)

    channels = [call.args[0] for call in publish.await_args_list]
    assert "user:u1:events" in channels
    assert "job:j1:events" in channels
    assert "container:c1:metrics" in channels
    assert "user:u1:container:c1:metrics" in channels
    assert "user:u1:container:c1:logs" not in channels
