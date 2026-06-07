"""Remove on-disk and queued artifacts tied to an analysis job."""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.infrastructure.events.bus import redis_client
from app.workers.queue import enqueue_job

logger = logging.getLogger(__name__)
settings = get_settings()


def deploy_state_redis_key(user_id: uuid.UUID, job_id: uuid.UUID) -> str:
    return f"deploy:{user_id}:{job_id}"


def _user_upload_root(user_id: uuid.UUID) -> Path:
    return (Path(settings.upload_dir) / str(user_id)).resolve()


def _is_under_root(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def collect_image_tags(result: dict[str, Any] | None) -> list[str]:
    if not isinstance(result, dict):
        return []
    builds = result.get("image_build_results")
    if not isinstance(builds, list):
        return []
    tags: list[str] = []
    seen: set[str] = set()
    for row in builds:
        if not isinstance(row, dict):
            continue
        if row.get("status") != "success":
            continue
        tag = row.get("image_tag")
        if isinstance(tag, str) and tag.strip() and tag not in seen:
            seen.add(tag)
            tags.append(tag.strip())
    return tags


def collect_runtime_image_refs(
    deploy_state: dict[str, Any] | None,
    result: dict[str, Any] | None,
) -> list[str]:
    """Merge analysis-built tags and images recorded in deploy state."""
    seen: set[str] = set(collect_image_tags(result))
    refs = list(seen)
    if not isinstance(deploy_state, dict):
        return refs
    for row in deploy_state.get("containers") or []:
        if not isinstance(row, dict):
            continue
        image = row.get("image")
        if isinstance(image, str) and image.strip() and image not in seen:
            seen.add(image)
            refs.append(image.strip())
    return refs


def deploy_spec_from_state(state: dict[str, Any]) -> dict[str, Any] | None:
    project_name = state.get("project_name")
    project_dir = state.get("project_dir")
    compose_file = state.get("compose_file")
    if not all(isinstance(v, str) and v.strip() for v in (project_name, project_dir, compose_file)):
        return None
    spec: dict[str, Any] = {
        "project_name": project_name,
        "project_dir": project_dir,
        "compose_file": compose_file,
    }
    reused = state.get("reused_service_names")
    if isinstance(reused, list):
        spec["reused_service_names"] = reused
    return spec


async def _load_deploy_state(user_id: uuid.UUID, job_id: uuid.UUID) -> dict[str, Any] | None:
    raw = await redis_client.get(deploy_state_redis_key(user_id, job_id))
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def _safe_project_path(user_id: uuid.UUID, input_metadata: dict[str, Any]) -> Path | None:
    raw = input_metadata.get("project_path")
    if not isinstance(raw, str) or not raw.strip():
        return None
    candidate = Path(raw).resolve()
    upload_root = _user_upload_root(user_id)
    if not _is_under_root(candidate, upload_root):
        logger.warning(
            "job_cleanup_skip_project_path",
            extra={"user_id": str(user_id), "project_path": raw},
        )
        return None
    return candidate


def _deployment_dir(user_id: uuid.UUID, job_id: uuid.UUID) -> Path:
    return (Path(settings.upload_dir) / "deployments" / str(user_id) / str(job_id)).resolve()


def _rmtree_sync(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    elif path.exists():
        path.unlink(missing_ok=True)


async def _remove_path(path: Path) -> None:
    await asyncio.to_thread(_rmtree_sync, path)


async def cleanup_job_artifacts(
    *,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    input_metadata: dict[str, Any],
    result: dict[str, Any] | None,
) -> None:
    """Best-effort cleanup of filesystem artifacts and DinD runtime for a job."""
    metadata = input_metadata if isinstance(input_metadata, dict) else {}
    deploy_state = await _load_deploy_state(user_id, job_id)

    project_dir = _safe_project_path(user_id, metadata)
    if project_dir is not None:
        try:
            await _remove_path(project_dir)
        except Exception:
            logger.warning(
                "job_cleanup_project_path_failed",
                extra={"user_id": str(user_id), "job_id": str(job_id), "path": str(project_dir)},
                exc_info=True,
            )

    deploy_dir = _deployment_dir(user_id, job_id)
    upload_root = Path(settings.upload_dir).resolve()
    if _is_under_root(deploy_dir, upload_root):
        try:
            await _remove_path(deploy_dir)
        except Exception:
            logger.warning(
                "job_cleanup_deployment_dir_failed",
                extra={"user_id": str(user_id), "job_id": str(job_id), "path": str(deploy_dir)},
                exc_info=True,
            )

    image_tags = collect_runtime_image_refs(deploy_state, result)
    deploy_spec = deploy_spec_from_state(deploy_state) if deploy_state else None
    if deploy_spec or image_tags:
        payload: dict[str, Any] = {
            "user_id": str(user_id),
            "job_id": str(job_id),
            "remove_images": True,
            "remove_volumes": False,
            "image_tags": image_tags,
        }
        if deploy_spec:
            payload["deploy_spec"] = deploy_spec
        try:
            await enqueue_job("teardown_job_runtime", payload)
        except Exception:
            logger.warning(
                "job_cleanup_enqueue_runtime_failed",
                extra={"user_id": str(user_id), "job_id": str(job_id)},
                exc_info=True,
            )
