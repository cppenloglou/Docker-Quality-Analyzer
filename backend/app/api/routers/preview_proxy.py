"""Authenticated reverse proxy for in-app container previews (strips X-Frame-Options)."""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.routers.compose import (
    _looks_like_platform_api_url,
    _normalize_preview_url,
)
from app.core.security import decode_token
from app.infrastructure.db.models import UserModel
from app.infrastructure.db.session import get_db_session
from app.infrastructure.events.bus import redis_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/compose/deploy/preview-proxy", tags=["compose-preview"])
bearer_scheme = HTTPBearer(auto_error=False)

PREVIEW_SESSION_TTL_SECONDS = 60 * 60
PREVIEW_SESSION_KEY_PREFIX = "preview-proxy:"
PREVIEW_COOKIE_NAME = "dpa_preview"
PREVIEW_PROXY_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)

HOP_BY_HOP_REQUEST = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
        "content-length",
    }
)

STRIP_RESPONSE_HEADERS = frozenset(
    {
        "x-frame-options",
        "content-security-policy",
        "content-security-policy-report-only",
        "strict-transport-security",
        "permissions-policy",
        "cross-origin-embedder-policy",
        "cross-origin-opener-policy",
        "cross-origin-resource-policy",
    }
)


class PreviewSessionCreate(BaseModel):
    url: str
    user_agent: str | None = None
    accept_language: str | None = None


class PreviewSessionResponse(BaseModel):
    session_id: str
    proxy_root: str


def _session_redis_key(session_id: str) -> str:
    return f"{PREVIEW_SESSION_KEY_PREFIX}{session_id}"


async def _load_preview_session(session_id: str) -> dict[str, Any]:
    raw = await redis_client.get(_session_redis_key(session_id))
    if not raw:
        raise HTTPException(status_code=404, detail="Preview session not found or expired.")
    try:
        state = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(status_code=404, detail="Preview session is invalid.") from exc
    if not isinstance(state, dict):
        raise HTTPException(status_code=404, detail="Preview session is invalid.")
    return state


async def _authenticate_preview_user(
    token: str | None,
    credentials: HTTPAuthorizationCredentials | None,
    session: AsyncSession,
) -> UserModel:
    if credentials:
        return await get_current_user(credentials=credentials, session=session)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required for preview proxy.")
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type.")
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid token.") from exc

    from app.infrastructure.db.repositories import UserRepository

    user = await UserRepository(session).get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token.")
    return user


async def _authorize_preview_session(
    session_id: str,
    user: UserModel | None,
    preview_cookie: str | None,
) -> dict[str, Any]:
    state = await _load_preview_session(session_id)
    if preview_cookie == session_id:
        return state
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required for preview proxy.")
    if str(state.get("user_id")) != str(user.id):
        raise HTTPException(status_code=403, detail="Preview session does not belong to this user.")
    return state


def _build_upstream_url(base_url: str, path: str, query: str | None) -> str:
    base_parsed = urlparse(base_url)
    clean_path = path or ""
    if clean_path.startswith("/"):
        clean_path = clean_path[1:]
    upstream = urljoin(base_url if base_url.endswith("/") else f"{base_url}/", clean_path)
    if query:
        upstream = f"{upstream}?{query}"
    # Guard: upstream must stay on the same host as the session base.
    upstream_parsed = urlparse(upstream)
    if upstream_parsed.hostname != base_parsed.hostname:
        raise HTTPException(status_code=400, detail="Preview path escapes the container origin.")
    if _looks_like_platform_api_url(upstream_parsed):
        raise HTTPException(status_code=400, detail="Preview cannot proxy the platform API.")
    return upstream


def _filter_request_headers(headers: Any, upstream_host: str) -> dict[str, str]:
    forwarded: dict[str, str] = {}
    for key, value in headers.items():
        lowered = key.lower()
        if lowered in HOP_BY_HOP_REQUEST:
            continue
        forwarded[key] = value
    forwarded["Host"] = upstream_host
    return forwarded


def _strip_response_headers(headers: httpx.Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in headers.items():
        if key.lower() in STRIP_RESPONSE_HEADERS:
            continue
        if key.lower() in {"content-encoding", "transfer-encoding", "content-length"}:
            continue
        out[key] = value
    return out


def _rewrite_location(location: str, session_id: str, base_url: str) -> str:
    parsed = urlparse(location)
    base_parsed = urlparse(base_url)
    if parsed.scheme and parsed.netloc:
        if parsed.hostname != base_parsed.hostname or parsed.port != base_parsed.port:
            return location
        path = parsed.path or "/"
        query = f"?{parsed.query}" if parsed.query else ""
        return f"/api/v1/compose/deploy/preview-proxy/{session_id}{path}{query}"
    path = location if location.startswith("/") else f"/{location}"
    return f"/api/v1/compose/deploy/preview-proxy/{session_id}{path}"


def _inject_html_base(html: bytes, base_href: str) -> bytes:
    base_tag = f'<base href="{base_href}">'
    text = html.decode("utf-8", errors="ignore")
    if re.search(r"<base\s", text, flags=re.IGNORECASE):
        return html
    head_match = re.search(r"<head[^>]*>", text, flags=re.IGNORECASE)
    if head_match:
        insert_at = head_match.end()
        text = text[:insert_at] + base_tag + text[insert_at:]
    elif re.search(r"<html[^>]*>", text, flags=re.IGNORECASE):
        text = re.sub(
            r"(<html[^>]*>)",
            r"\1<head>" + base_tag + "</head>",
            text,
            count=1,
            flags=re.IGNORECASE,
        )
    else:
        text = base_tag + text
    return text.encode("utf-8")


def _proxy_root_path(session_id: str) -> str:
    return f"/api/v1/compose/deploy/preview-proxy/{session_id}/"


async def _proxy_preview(
    session_id: str,
    path: str,
    request: Request,
    user: UserModel | None,
    preview_cookie: str | None,
    token: str | None,
) -> Response:
    state = await _authorize_preview_session(session_id, user, preview_cookie)
    base_url = str(state["base_url"])

    query_parts = [
        f"{key}={value}"
        for key, value in request.query_params.multi_items()
        if key != "token"
    ]
    query = "&".join(query_parts) if query_parts else None
    upstream = _build_upstream_url(base_url, path, query)
    upstream_parsed = urlparse(upstream)

    body = await request.body()
    forward_headers = _filter_request_headers(request.headers, upstream_parsed.hostname or "")
    stored_ua = state.get("user_agent")
    if isinstance(stored_ua, str) and stored_ua.strip():
        forward_headers["User-Agent"] = stored_ua.strip()
    stored_lang = state.get("accept_language")
    if isinstance(stored_lang, str) and stored_lang.strip():
        forward_headers["Accept-Language"] = stored_lang.strip()
    forward_headers["Accept"] = request.headers.get(
        "accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    )

    try:
        async with httpx.AsyncClient(
            timeout=PREVIEW_PROXY_TIMEOUT,
            follow_redirects=False,
        ) as client:
            upstream_response = await client.request(
                request.method,
                upstream,
                headers=forward_headers,
                content=body if body else None,
            )
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not reach the container from the preview proxy.",
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="Container preview timed out.") from exc
    except httpx.HTTPError as exc:
        logger.warning("preview_proxy_upstream_failed session=%s err=%s", session_id, exc)
        raise HTTPException(status_code=502, detail="Preview proxy upstream failed.") from exc

    if upstream_response.status_code in {301, 302, 303, 307, 308}:
        location = upstream_response.headers.get("location")
        if location:
            headers = _strip_response_headers(upstream_response.headers)
            headers["location"] = _rewrite_location(location, session_id, base_url)
            return Response(
                status_code=upstream_response.status_code,
                headers=headers,
            )

    content = upstream_response.content
    content_type = (upstream_response.headers.get("content-type") or "").lower()
    if "text/html" in content_type and request.method == "GET":
        content = _inject_html_base(content, _proxy_root_path(session_id))

    response_headers = _strip_response_headers(upstream_response.headers)
    response = Response(
        content=content,
        status_code=upstream_response.status_code,
        headers=response_headers,
        media_type=upstream_response.headers.get("content-type"),
    )
    if user is not None:
        response.set_cookie(
            key=PREVIEW_COOKIE_NAME,
            value=session_id,
            httponly=True,
            samesite="lax",
            max_age=PREVIEW_SESSION_TTL_SECONDS,
            path="/api/v1/compose/deploy/preview-proxy",
        )
    return response


@router.post("/session", response_model=PreviewSessionResponse)
async def create_preview_proxy_session(
    payload: PreviewSessionCreate,
    response: Response,
    current_user: UserModel = Depends(get_current_user),
) -> PreviewSessionResponse:
    base_url = _normalize_preview_url(payload.url)
    parsed = urlparse(base_url)
    if _looks_like_platform_api_url(parsed):
        raise HTTPException(
            status_code=400,
            detail="Cannot proxy the platform API. Use a container host:port URL.",
        )

    session_id = uuid.uuid4().hex
    session_payload: dict[str, Any] = {
        "user_id": str(current_user.id),
        "base_url": base_url,
    }
    if payload.user_agent and payload.user_agent.strip():
        session_payload["user_agent"] = payload.user_agent.strip()[:512]
    if payload.accept_language and payload.accept_language.strip():
        session_payload["accept_language"] = payload.accept_language.strip()[:256]
    await redis_client.set(
        _session_redis_key(session_id),
        json.dumps(session_payload),
        ex=PREVIEW_SESSION_TTL_SECONDS,
    )
    response.set_cookie(
        key=PREVIEW_COOKIE_NAME,
        value=session_id,
        httponly=True,
        samesite="lax",
        max_age=PREVIEW_SESSION_TTL_SECONDS,
        path="/api/v1/compose/deploy/preview-proxy",
    )
    return PreviewSessionResponse(
        session_id=session_id,
        proxy_root=f"/api/v1/compose/deploy/preview-proxy/{session_id}/",
    )


@router.api_route(
    "/{session_id}",
    methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
@router.api_route(
    "/{session_id}/{path:path}",
    methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)
async def preview_proxy(
    session_id: str,
    request: Request,
    path: str = "",
    token: str | None = Query(None),
    preview_cookie: str | None = Cookie(None, alias=PREVIEW_COOKIE_NAME),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    if request.method == "OPTIONS":
        return Response(status_code=204)

    user: UserModel | None = None
    if preview_cookie == session_id:
        user = None
    else:
        user = await _authenticate_preview_user(token, credentials, session)
    return await _proxy_preview(session_id, path, request, user, preview_cookie, token)
