"""Pure project scanning logic — no DB, no HTTP, no side effects beyond filesystem reads."""

from __future__ import annotations

import zipfile
from pathlib import Path
from typing import Any

import yaml

_IGNORED_DIRS: frozenset[str] = frozenset(
    {
        "node_modules",
        ".git",
        "__pycache__",
        ".venv",
        "venv",
        "dist",
        "build",
        "target",
        "coverage",
        ".next",
        ".turbo",
        "vendor",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".tox",
        "htmlcov",
    }
)

_COMPOSE_NAMES: frozenset[str] = frozenset(
    {
        "docker-compose.yml",
        "docker-compose.yaml",
        "compose.yml",
        "compose.yaml",
    }
)

# ZIP bomb limits
_MAX_ENTRIES = 10_000
_MAX_TOTAL_BYTES = 500 * 1024 * 1024  # 500 MB
_MAX_SINGLE_BYTES = 100 * 1024 * 1024  # 100 MB per file
_MAX_COMPRESSION_RATIO = 100  # decompressed / compressed


def safe_extract_zip(
    archive_path: Path,
    extract_dir: Path,
) -> None:
    """Extract a ZIP archive with path-traversal and zip-bomb protection."""
    with zipfile.ZipFile(archive_path, "r") as zf:
        members = zf.infolist()

        if len(members) > _MAX_ENTRIES:
            raise ValueError(f"Archive contains too many entries ({len(members)} > {_MAX_ENTRIES}).")

        total_size = sum(m.file_size for m in members)
        if total_size > _MAX_TOTAL_BYTES:
            raise ValueError(
                f"Archive total uncompressed size ({total_size // (1024*1024)} MB) exceeds {_MAX_TOTAL_BYTES // (1024*1024)} MB limit."
            )

        for member in members:
            if member.file_size > _MAX_SINGLE_BYTES:
                raise ValueError(
                    f"Archive entry '{member.filename}' is too large ({member.file_size // (1024*1024)} MB)."
                )
            compressed = member.compress_size or 1
            if member.file_size > 0 and (member.file_size / compressed) > _MAX_COMPRESSION_RATIO:
                raise ValueError(
                    f"Archive entry '{member.filename}' has suspicious compression ratio — possible zip bomb."
                )
            member_path = (extract_dir / member.filename).resolve()
            if not str(member_path).startswith(str(extract_dir.resolve())):
                raise ValueError(f"Archive entry '{member.filename}' would escape extraction directory.")

        zf.extractall(extract_dir)


def _is_ignored(path: Path, extract_root: Path) -> bool:
    """True if any component of the path (relative to extract_root) is in the ignore list."""
    try:
        relative = path.relative_to(extract_root)
    except ValueError:
        return False
    return any(part in _IGNORED_DIRS for part in relative.parts)


def _is_dockerfile(path: Path) -> bool:
    name = path.name
    if name == "Dockerfile":
        return True
    if name.startswith("Dockerfile.") and len(name) > len("Dockerfile."):
        return True
    if name.lower().endswith(".dockerfile"):
        return True
    return False


def _is_compose_file(path: Path) -> bool:
    name = path.name.lower()
    if name in _COMPOSE_NAMES:
        return True
    if name.endswith(".compose.yml") or name.endswith(".compose.yaml"):
        return True
    if (name.startswith("docker-compose.") or name.startswith("docker-compose-")) and (
        name.endswith(".yml") or name.endswith(".yaml")
    ):
        return True
    return False


def _detect_stacks(extract_root: Path, file_paths: list[Path]) -> list[str]:
    names = {p.name.lower() for p in file_paths}
    stacks: list[str] = []

    if "package.json" in names:
        if "pnpm-lock.yaml" in names:
            stacks.append("node/pnpm")
        elif "yarn.lock" in names:
            stacks.append("node/yarn")
        else:
            stacks.append("node/npm")

    if "pyproject.toml" in names or "requirements.txt" in names or "pipfile" in names:
        if "poetry.lock" in names:
            stacks.append("python/poetry")
        elif "pipfile" in names:
            stacks.append("python/pipenv")
        else:
            stacks.append("python/pip")

    if "go.mod" in names:
        stacks.append("go")

    if "cargo.toml" in names:
        stacks.append("rust")

    if "pom.xml" in names:
        stacks.append("java/maven")
    elif "build.gradle" in names or "build.gradle.kts" in names:
        stacks.append("java/gradle")

    if any(n.endswith(".csproj") or n.endswith(".sln") for n in names):
        stacks.append("dotnet")

    if "composer.json" in names:
        stacks.append("php/composer")

    if any("nginx" in n for n in names):
        stacks.append("nginx")

    # Kubernetes manifests
    if any(p.suffix in {".yaml", ".yml"} and _looks_like_k8s(p) for p in file_paths):
        stacks.append("kubernetes")

    return stacks


def _looks_like_k8s(path: Path) -> bool:
    """Quick heuristic: file contains 'kind:' common k8s resource names."""
    k8s_kinds = {"Deployment", "Service", "Pod", "ConfigMap", "Secret", "Ingress", "StatefulSet"}
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
        for kind in k8s_kinds:
            if f"kind: {kind}" in text:
                return True
    except OSError:
        pass
    return False


def _parse_compose_services(compose_path: Path, project_root: Path) -> list[dict[str, Any]]:
    """Parse a compose file and return a list of service descriptors."""
    try:
        text = compose_path.read_text(encoding="utf-8", errors="ignore")
        parsed = yaml.safe_load(text) or {}
    except Exception:
        return []

    if not isinstance(parsed, dict):
        return []

    services_raw = parsed.get("services")
    if not isinstance(services_raw, dict):
        return []

    result: list[dict[str, Any]] = []
    for name, svc in services_raw.items():
        if not isinstance(svc, dict):
            continue
        image = svc.get("image")
        build = svc.get("build")
        build_context: str | None = None
        build_dockerfile: str | None = None
        if isinstance(build, str):
            build_context = build
        elif isinstance(build, dict):
            build_context = build.get("context")
            build_dockerfile = build.get("dockerfile")

        # Detect which databases / caches are used
        db_hints: list[str] = []
        if isinstance(image, str):
            img_lower = image.lower()
            for db in ("postgres", "mysql", "mariadb", "redis", "mongodb", "mongo", "elasticsearch", "rabbitmq"):
                if db in img_lower:
                    db_hints.append(db)

        result.append(
            {
                "name": str(name),
                "image": image,
                "build_context": build_context,
                "build_dockerfile": build_dockerfile,
                "db_hints": db_hints,
                "ports": svc.get("ports", []),
                "depends_on": list(svc.get("depends_on", {}).keys())
                if isinstance(svc.get("depends_on"), dict)
                else list(svc.get("depends_on", [])),
            }
        )

    return result


def _detect_package_managers(file_paths: list[Path]) -> list[str]:
    names = {p.name.lower() for p in file_paths}
    managers: list[str] = []
    if "package-lock.json" in names:
        managers.append("npm")
    if "pnpm-lock.yaml" in names:
        managers.append("pnpm")
    if "yarn.lock" in names:
        managers.append("yarn")
    if "poetry.lock" in names:
        managers.append("poetry")
    if "pipfile.lock" in names:
        managers.append("pipenv")
    if "cargo.lock" in names:
        managers.append("cargo")
    if "go.sum" in names:
        managers.append("go")
    return managers


def _build_recommendation(
    dockerfiles: list[str],
    compose_files: list[str],
    services: list[dict[str, Any]],
    warnings: list[str],
) -> dict[str, Any]:
    has_df = bool(dockerfiles)
    has_cf = bool(compose_files)

    if has_df and has_cf:
        mode = "full-project"
    elif has_df:
        mode = "dockerfile-only"
    elif has_cf:
        mode = "compose-only"
    else:
        mode = "no-docker"

    primary_dockerfile = dockerfiles[0] if dockerfiles else None
    primary_compose = compose_files[0] if compose_files else None

    # can_build: need at least one Dockerfile
    can_build = has_df

    # can_run: need a compose file; builds with build context are possible but note
    # services with external images can always "run" standalone if no blockers
    can_run = has_cf

    reasons: list[str] = []
    if not has_df:
        reasons.append("No Dockerfile detected — image build not available.")
    if not has_cf:
        reasons.append("No Compose file detected — stack run not available.")
    if has_cf and services:
        build_services = [s["name"] for s in services if s.get("build_context")]
        if build_services:
            reasons.append(f"Services with build context: {', '.join(build_services)} — must build images first to run.")

    return {
        "analysis_mode": mode,
        "primary_dockerfile": primary_dockerfile,
        "primary_compose_file": primary_compose,
        "can_build": can_build,
        "can_run": can_run,
        "reasons": reasons,
    }


def scan_extracted_project(extract_root: Path, archive_name: str) -> dict[str, Any]:
    """Walk an extracted project directory and return a scan manifest.

    The manifest contains only paths, file-kind flags, counts, and stack hints —
    never raw file contents (to keep input_metadata lightweight in the DB).
    """
    all_paths: list[Path] = []
    for path in extract_root.rglob("*"):
        if path.is_file() and not _is_ignored(path, extract_root):
            all_paths.append(path)

    def rel(p: Path) -> str:
        return str(p.relative_to(extract_root))

    dockerfiles: list[str] = []
    compose_files: list[str] = []
    dockerignore_files: list[str] = []
    env_examples: list[str] = []

    for path in all_paths:
        if _is_dockerfile(path):
            dockerfiles.append(rel(path))
        elif _is_compose_file(path):
            compose_files.append(rel(path))
        elif path.name == ".dockerignore":
            dockerignore_files.append(rel(path))
        elif path.name in {".env.example", ".env.sample", ".env.template"}:
            env_examples.append(rel(path))

    # Sort for determinism; shortest path first = root-level files preferred
    dockerfiles.sort(key=lambda p: (p.count("/"), p))
    compose_files.sort(key=lambda p: (p.count("/"), p))

    # Detect stacks from all non-ignored files
    stacks = _detect_stacks(extract_root, all_paths)
    package_managers = _detect_package_managers(all_paths)

    # Parse services from all compose files
    all_services: list[dict[str, Any]] = []
    for cf in compose_files:
        compose_path = extract_root / cf
        services = _parse_compose_services(compose_path, extract_root)
        for svc in services:
            svc["compose_file"] = cf
        all_services.extend(services)

    # De-duplicate services by name (same service may appear in multiple compose files)
    seen_names: set[str] = set()
    deduped_services: list[dict[str, Any]] = []
    for svc in all_services:
        key = f"{svc['compose_file']}:{svc['name']}"
        if key not in seen_names:
            seen_names.add(key)
            deduped_services.append(svc)

    # Detect databases referenced in services
    db_hints: list[str] = list({h for svc in deduped_services for h in svc.get("db_hints", [])})
    if db_hints:
        for db in db_hints:
            if db not in stacks:
                stacks.append(db)

    warnings: list[str] = []
    if dockerfiles and not dockerignore_files:
        warnings.append("No .dockerignore found — build contexts may be unnecessarily large.")
    if not dockerfiles and not compose_files:
        warnings.append("No Dockerfile or Compose file detected in this archive.")
    if compose_files and not dockerfiles:
        # Check if any service uses build context
        build_services = [s["name"] for s in deduped_services if s.get("build_context")]
        if build_services:
            warnings.append(
                f"Compose services with build context ({', '.join(build_services)}) require Dockerfiles that were not found."
            )
    if env_examples and not any("env_file" in str(svc) for svc in deduped_services):
        warnings.append(".env.example found — remember to provide a .env file before running.")

    recommendation = _build_recommendation(dockerfiles, compose_files, deduped_services, warnings)

    return {
        "archive_name": archive_name,
        "extracted_root": str(extract_root),
        "detected": {
            "dockerfiles": dockerfiles,
            "compose_files": compose_files,
            "dockerignore_files": dockerignore_files,
            "env_examples": env_examples,
            "stacks": stacks,
            "package_managers": package_managers,
            "services": deduped_services,
        },
        "recommendation": recommendation,
        "warnings": warnings,
        # Safe summary for DB storage (no raw content)
        "db_safe_summary": {
            "filename": archive_name,
            "dockerfiles": dockerfiles,
            "compose_files": compose_files,
            "dockerignore_files": dockerignore_files,
            "env_examples": env_examples,
            "stacks": stacks,
            "package_managers": package_managers,
            "service_count": len(deduped_services),
            "has_dockerfile": bool(dockerfiles),
            "has_compose": bool(compose_files),
            "total_files_scanned": len(all_paths),
            "project_path": str(extract_root),
        },
    }
