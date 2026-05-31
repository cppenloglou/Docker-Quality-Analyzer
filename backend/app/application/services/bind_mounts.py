"""Shared bind-mount detection and validation for Compose workflows."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def is_bind_mount_source(src: str) -> bool:
    """Return True if *src* looks like a host bind-mount path (not a named volume)."""
    src = src.strip()

    if not src:
        return False

    # Current directory or parent directory
    if src in {".", "..", "~"}:
        return True

    # Relative/absolute/home paths
    if src.startswith(("./", "../", "/", "~/")):
        return True

    # Windows absolute paths (C:\... or C:/...)
    if len(src) >= 3 and src[1] == ":" and src[0].isalpha():
        return True

    return False


def _is_windows_drive_path(src: str) -> bool:
    return len(src) >= 3 and src[1] == ":" and src[0].isalpha()


def validate_bind_mounts(service_name: str, service_def: dict[str, Any], project_root: Path) -> list[str]:
    """Project workflow: validate bind mounts against *project_root* and flag DinD risks."""
    issues: list[str] = []

    volumes = service_def.get("volumes", [])
    if not isinstance(volumes, list):
        return issues

    for vol in volumes:
        if isinstance(vol, str):
            parts = vol.split(":")
            if not parts:
                continue

            src = parts[0].strip()
            if not is_bind_mount_source(src):
                continue

            if _is_windows_drive_path(src):
                issues.append(
                    f"Service '{service_name}' uses Windows bind mount source '{src}'. "
                    "This may not work inside Docker-in-Docker."
                )
                continue

            if src.startswith("/"):
                mount_path = Path(src)
            else:
                mount_path = (project_root / src).expanduser().resolve()

            if not mount_path.exists():
                issues.append(f"Service '{service_name}' bind mount source '{src}' does not exist.")

            issues.append(
                f"Service '{service_name}' uses bind mount '{src}'. "
                "Bind mounts can break inside Docker-in-Docker because the source path may not exist "
                "or may not contain the uploaded project files."
            )

        elif isinstance(vol, dict):
            vol_type = vol.get("type")
            src = vol.get("source") or vol.get("src")

            if vol_type == "bind":
                if not src:
                    issues.append(f"Service '{service_name}' has a bind mount without a source.")
                    continue

                src = str(src).strip()

                if _is_windows_drive_path(src):
                    issues.append(
                        f"Service '{service_name}' uses Windows bind mount source '{src}'. "
                        "This may not work inside Docker-in-Docker."
                    )
                    continue

                if src.startswith("/"):
                    mount_path = Path(src)
                else:
                    mount_path = (project_root / src).expanduser().resolve()

                if not mount_path.exists():
                    issues.append(f"Service '{service_name}' bind mount source '{src}' does not exist.")

                issues.append(
                    f"Service '{service_name}' uses bind mount '{src}'. "
                    "Bind mounts can break inside Docker-in-Docker. Prefer copying files in the Dockerfile "
                    "and using named volumes only for runtime data."
                )

    return issues


def runnability_bind_mount_reasons(service_name: str, service_def: dict[str, Any]) -> list[str]:
    """Standalone compose workflow: any host bind mount makes the stack non-runnable."""
    reasons: list[str] = []

    volumes = service_def.get("volumes", [])
    if not isinstance(volumes, list):
        return reasons

    for vol in volumes:
        if isinstance(vol, str):
            parts = vol.split(":")
            if not parts:
                continue
            src = parts[0].strip()
            if is_bind_mount_source(src):
                reasons.append(
                    f"Service '{service_name}' uses host bind mount '{src}', unavailable standalone."
                )

        elif isinstance(vol, dict):
            vol_type = str(vol.get("type", "")).lower()
            src_raw = vol.get("source") or vol.get("src")
            src = str(src_raw).strip() if src_raw else ""

            if vol_type == "bind" and not src:
                reasons.append(f"Service '{service_name}' has a bind mount without a source.")
            elif vol_type == "bind" or is_bind_mount_source(src):
                label = src or "(bind mount)"
                reasons.append(
                    f"Service '{service_name}' uses host bind mount '{label}', unavailable standalone."
                )

    return reasons
