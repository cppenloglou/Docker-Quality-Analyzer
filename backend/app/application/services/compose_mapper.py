"""Compose-to-Dockerfile mapping — resolves services to local build contexts."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from app.application.services.bind_mounts import validate_bind_mounts


def _normalize_env_file_ref(entry: Any) -> tuple[str | None, bool]:
    """Return project-relative env file path and whether the reference is required."""
    if isinstance(entry, str):
        path = entry.strip()
        return (path or None, True)
    if isinstance(entry, dict):
        raw_path = entry.get("path")
        required = entry.get("required", True)
        if isinstance(raw_path, str):
            path = raw_path.strip()
            return (path or None, bool(required))
    return (None, True)


def map_compose_services(
    compose_file_rel: str,
    project_root: Path,
) -> list[dict[str, Any]]:
    """Parse a Compose file and map each service to its Dockerfile/build context.

    Returns a list of service mapping dicts containing:
      service, compose_file, build_context, dockerfile,
      resolved_dockerfile, can_build, can_run, issues
    """
    compose_path = project_root / compose_file_rel
    if not compose_path.exists():
        return [
            {
                "service": "__meta__",
                "compose_file": compose_file_rel,
                "build_context": None,
                "dockerfile": None,
                "resolved_dockerfile": None,
                "can_build": False,
                "can_run": False,
                "issues": [f"Compose file not found: {compose_file_rel}"],
            }
        ]

    try:
        text = compose_path.read_text(encoding="utf-8", errors="ignore")
        parsed = yaml.safe_load(text) or {}
    except Exception as exc:
        return [
            {
                "service": "__meta__",
                "compose_file": compose_file_rel,
                "build_context": None,
                "dockerfile": None,
                "resolved_dockerfile": None,
                "can_build": False,
                "can_run": False,
                "issues": [f"Failed to parse Compose file: {exc}"],
            }
        ]

    services = parsed.get("services") if isinstance(parsed, dict) else None
    if not isinstance(services, dict) or not services:
        return []

    mappings: list[dict[str, Any]] = []

    for service_name, service_def in services.items():
        if not isinstance(service_def, dict):
            continue

        issues: list[str] = []
        build = service_def.get("build")
        image = service_def.get("image")

        build_context_raw: str | None = None
        dockerfile_raw: str | None = None
        resolved_dockerfile: str | None = None
        can_build = False
        can_run = bool(image)  # service has a pre-built image → can run without local build

        if build is not None:
            if isinstance(build, str):
                build_context_raw = build
                dockerfile_raw = "Dockerfile"  # default
            elif isinstance(build, dict):
                build_context_raw = build.get("context", ".")
                dockerfile_raw = build.get("dockerfile", "Dockerfile")

            # Resolve build context
            context_path = (project_root / (build_context_raw or ".")).resolve()
            if not context_path.exists():
                issues.append(f"Build context '{build_context_raw}' does not exist.")
            else:
                # Resolve Dockerfile within build context
                df_path = (context_path / (dockerfile_raw or "Dockerfile")).resolve()
                if df_path.exists():
                    try:
                        resolved_dockerfile = str(df_path.relative_to(project_root))
                    except ValueError:
                        resolved_dockerfile = str(df_path)
                    can_build = True
                else:
                    issues.append(
                        f"Dockerfile '{dockerfile_raw}' not found in build context '{build_context_raw}'."
                    )

        # Validate env_file references
        env_files = service_def.get("env_file")
        if env_files:
            if isinstance(env_files, str):
                env_files = [env_files]
            for ef in env_files:
                ef_ref, required = _normalize_env_file_ref(ef)
                if not ef_ref:
                    issues.append("env_file entry is invalid or missing a path.")
                    continue
                ef_path = (project_root / ef_ref).resolve()
                if not ef_path.exists() and required:
                    issues.append(f"env_file '{ef_ref}' does not exist in project.")

        issues.extend(validate_bind_mounts(str(service_name), service_def, project_root))

        # A service with a build context that resolves correctly can run (with build first)
        if build is not None and can_build and not image:
            can_run = True

        mappings.append(
            {
                "service": str(service_name),
                "compose_file": compose_file_rel,
                "build_context": build_context_raw,
                "dockerfile": dockerfile_raw,
                "resolved_dockerfile": resolved_dockerfile,
                "can_build": can_build,
                "can_run": can_run,
                "issues": issues,
            }
        )

    return mappings
