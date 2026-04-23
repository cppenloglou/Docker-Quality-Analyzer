import uuid

from arq import create_pool
from arq.connections import RedisSettings

from app.core.config import get_settings

settings = get_settings()


async def enqueue_job(task_name: str, payload: dict) -> None:
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await redis.enqueue_job(task_name, payload)
    await redis.close()


def serialize_uuid(value: uuid.UUID) -> str:
    return str(value)
