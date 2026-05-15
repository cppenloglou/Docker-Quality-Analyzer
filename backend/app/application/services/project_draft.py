"""Shared helpers for project draft expiry and cleanup."""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.infrastructure.db.models import AnalysisJobModel


_EXPIRED_DETAIL = (
    "This project draft expired after 1 hour. "
    "Please upload the archive again to continue."
)


def is_draft_expired(meta: dict[str, Any]) -> bool:
    """Return True if the draft's wall-clock TTL has elapsed."""
    expires_at_str: str | None = meta.get("draft_expires_at")
    if not expires_at_str:
        return False
    try:
        expires_at = datetime.fromisoformat(expires_at_str)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        return datetime.now(UTC) > expires_at
    except ValueError:
        return False


def seconds_until_expiry(meta: dict[str, Any]) -> int:
    """Return remaining seconds until expiry (0 if already expired or no TTL set)."""
    expires_at_str: str | None = meta.get("draft_expires_at")
    if not expires_at_str:
        return 0
    try:
        expires_at = datetime.fromisoformat(expires_at_str)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        remaining = (expires_at - datetime.now(UTC)).total_seconds()
        return max(0, int(remaining))
    except ValueError:
        return 0


async def expire_draft(job: AnalysisJobModel, session: Any) -> None:
    """Delete the DB job and remove the extracted project directory from disk."""
    project_path = job.input_metadata.get("project_path")
    if project_path:
        path = Path(project_path)
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
    await session.delete(job)
    await session.commit()
