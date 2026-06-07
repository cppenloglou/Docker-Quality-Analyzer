import json
from dataclasses import asdict
from collections.abc import AsyncIterator
from typing import Any

from redis.asyncio import Redis

from app.core.config import get_settings
from app.domain.events import DomainEvent

settings = get_settings()
redis_client = Redis.from_url(settings.redis_url, decode_responses=True)


async def publish_event(event: DomainEvent) -> None:
    payload = asdict(event)
    data = json.dumps(payload)

    # Container log lines are high-volume; keep them isolated on a dedicated
    # user-scoped logs channel so they never flood the user/job event streams.
    if event.event_name == "container.log":
        container_id = event.payload.get("container_id")
        if container_id:
            await redis_client.publish(
                f"user:{event.user_id}:container:{container_id}:logs",
                data,
            )
        return

    await redis_client.publish(f"user:{event.user_id}:events", data)
    if event.job_id:
        await redis_client.publish(f"job:{event.job_id}:events", data)
    container_id = event.payload.get("container_id")
    if container_id:
        await redis_client.publish(f"container:{container_id}:metrics", data)
        await redis_client.publish(
            f"user:{event.user_id}:container:{container_id}:metrics",
            data,
        )


async def subscribe(channel: str) -> AsyncIterator[dict[str, Any]]:
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(channel)
    try:
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            yield json.loads(message["data"])
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
