import json
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.security import decode_token
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.events.bus import redis_client
from app.infrastructure.events.bus import subscribe

router = APIRouter(tags=["websockets"])


async def _job_belongs_to_user(job_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    async with SessionLocal() as session:
        repo = JobRepository(session)
        job = await repo.get_job(job_id, user_id)
        return job is not None


async def _user_has_container_access(user_id: uuid.UUID, container_id: str) -> bool:
    pattern = f"deploy:{user_id}:*"
    cursor = 0
    while True:
        cursor, keys = await redis_client.scan(cursor=cursor, match=pattern, count=100)
        for key in keys:
            raw_state = await redis_client.get(key)
            if not raw_state:
                continue
            try:
                state = json.loads(raw_state)
            except json.JSONDecodeError:
                continue
            if not isinstance(state, dict):
                continue
            ids: set[str] = set()
            top_id = state.get("container_id")
            if isinstance(top_id, str) and top_id:
                ids.add(top_id)
            top_ids = state.get("container_ids")
            if isinstance(top_ids, list):
                for row in top_ids:
                    if isinstance(row, str) and row:
                        ids.add(row)
            containers = state.get("containers")
            if isinstance(containers, list):
                for row in containers:
                    if isinstance(row, dict):
                        row_id = row.get("id")
                        if isinstance(row_id, str) and row_id:
                            ids.add(row_id)
            if container_id in ids:
                return True
        if cursor == 0:
            break
    return False


@router.websocket("/ws/jobs/{job_id}")
async def job_updates(
    websocket: WebSocket,
    job_id: str,
    token: str = Query(...),
) -> None:
    await websocket.accept()
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("wrong token type")
        user_id = uuid.UUID(payload["sub"])
        job_uuid = uuid.UUID(job_id)
    except (KeyError, TypeError, ValueError):
        await websocket.send_json({"error": "invalid token"})
        await websocket.close(code=4401)
        return

    if not await _job_belongs_to_user(job_uuid, user_id):
        await websocket.send_json({"error": "forbidden"})
        await websocket.close(code=4403)
        return

    try:
        async for event in subscribe(f"job:{job_id}:events"):
            await websocket.send_text(json.dumps(event))
    except WebSocketDisconnect:
        return


@router.websocket("/ws/metrics/{container_id}")
async def container_metrics(
    websocket: WebSocket,
    container_id: str,
    token: str = Query(...),
) -> None:
    await websocket.accept()
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("wrong token type")
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, TypeError, ValueError):
        await websocket.send_json({"error": "invalid token"})
        await websocket.close(code=4401)
        return

    if not await _user_has_container_access(user_id, container_id):
        await websocket.send_json({"error": "forbidden"})
        await websocket.close(code=4403)
        return
    try:
        async for event in subscribe(f"container:{container_id}:metrics"):
            await websocket.send_text(json.dumps(event))
    except WebSocketDisconnect:
        return


@router.websocket("/ws/users/{user_id}/containers/{container_id}")
async def user_container_metrics(
    websocket: WebSocket,
    user_id: str,
    container_id: str,
    token: str = Query(...),
) -> None:
    await websocket.accept()
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("wrong token type")
        if payload.get("sub") != user_id:
            raise ValueError("user mismatch")
        uuid.UUID(user_id)
    except (KeyError, TypeError, ValueError):
        await websocket.send_json({"error": "invalid token"})
        await websocket.close(code=4401)
        return
    try:
        async for event in subscribe(f"user:{user_id}:container:{container_id}:metrics"):
            await websocket.send_text(json.dumps(event))
    except WebSocketDisconnect:
        return


@router.websocket("/ws/users/{user_id}/events")
async def user_events(
    websocket: WebSocket,
    user_id: str,
    token: str = Query(...),
) -> None:
    await websocket.accept()
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise ValueError("wrong token type")
        if payload.get("sub") != user_id:
            raise ValueError("user mismatch")
        uuid.UUID(user_id)
    except (KeyError, TypeError, ValueError):
        await websocket.send_json({"error": "invalid token"})
        await websocket.close(code=4401)
        return

    try:
        async for event in subscribe(f"user:{user_id}:events"):
            await websocket.send_text(json.dumps(event))
    except WebSocketDisconnect:
        return
