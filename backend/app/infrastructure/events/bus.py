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
    await redis_client.publish(f"user:{event.user_id}:events", json.dumps(payload))
    if event.job_id:
        await redis_client.publish(f"job:{event.job_id}:events", json.dumps(payload))
    container_id = event.payload.get("container_id")
    if container_id:
        await redis_client.publish(f"container:{container_id}:metrics", json.dumps(payload))
        await redis_client.publish(
            f"user:{event.user_id}:container:{container_id}:metrics",
            json.dumps(payload),
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
