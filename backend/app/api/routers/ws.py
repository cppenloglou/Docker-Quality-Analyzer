import json
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.security import decode_token
from app.infrastructure.events.bus import subscribe

router = APIRouter(tags=["websockets"])


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
        _ = uuid.UUID(payload["sub"])
        uuid.UUID(job_id)
    except Exception:
        await websocket.send_json({"error": "invalid token"})
        await websocket.close(code=4401)
        return

    try:
        async for event in subscribe(f"job:{job_id}:events"):
            await websocket.send_text(json.dumps(event))
    except WebSocketDisconnect:
        return


@router.websocket("/ws/metrics/{container_id}")
async def container_metrics(websocket: WebSocket, container_id: str) -> None:
    await websocket.accept()
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
    except Exception:
        await websocket.send_json({"error": "invalid token"})
        await websocket.close(code=4401)
        return
    try:
        async for event in subscribe(f"user:{user_id}:container:{container_id}:metrics"):
            await websocket.send_text(json.dumps(event))
    except WebSocketDisconnect:
        return
