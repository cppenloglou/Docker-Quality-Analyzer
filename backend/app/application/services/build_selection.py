"""Select primary compose files and Dockerfiles to auto-build for project jobs."""

from __future__ import annotations

from pathlib import Path

from app.application.services.compose_mapper import map_compose_services

# Auxiliary paths — still analyzed, but skipped for automatic image builds.
_BUILD_SKIP_DIR_SEGMENTS: frozenset[str] = frozenset({
    ".devcontainer",
    "RELEASING",
    "releasing",
    "scripts",
    "test",
    "tests",
    "docs",
})


def compose_file_sort_key(path: str) -> tuple[int, int, str]:
    """Prefer root docker-compose.yml over variants like docker-compose-light.yml."""
    normalized = path.replace("\\", "/")
    name = Path(normalized).name.lower()
    depth = normalized.count("/")
    if name in {"docker-compose.yml", "compose.yml"}:
        return (0, depth, normalized)
    if name in {"docker-compose.yaml", "compose.yaml"}:
        return (1, depth, normalized)
    if name.startswith("docker-compose") and all(
        token not in name for token in ("light", "non-dev", "image-tag", "override", "prod", "dev")
    ):
        return (2, depth, normalized)
    if name.startswith("docker-compose") or name.startswith("compose"):
        return (3, depth, normalized)
    return (4, depth, normalized)


def _is_auxiliary_dockerfile(path: str) -> bool:
    normalized = path.replace("\\", "/")
    if any(part in _BUILD_SKIP_DIR_SEGMENTS for part in Path(normalized).parts):
        return True
    return Path(normalized).name != "Dockerfile"


def _root_dockerfile(dockerfiles: list[str]) -> str | None:
    candidates = [p for p in dockerfiles if Path(p.replace("\\", "/")).name == "Dockerfile"]
    if not candidates:
        return None
    candidates.sort(key=lambda p: (p.count("/"), p))
    return candidates[0]


def select_dockerfiles_for_build(
    dockerfiles: list[str],
    project_path: Path,
    *,
    primary_compose_file: str | None = None,
    max_builds: int = 5,
) -> list[str]:
    """Return Dockerfiles to auto-build, prioritizing primary compose service builds."""
    if not dockerfiles or max_builds <= 0:
        return []

    selected: list[str] = []
    seen: set[str] = set()

    def add(path: str | None) -> None:
        if not path or path in seen or path not in dockerfiles:
            return
        seen.add(path)
        selected.append(path)

    if primary_compose_file:
        for mapping in map_compose_services(primary_compose_file, project_path):
            resolved = mapping.get("resolved_dockerfile")
            if mapping.get("can_build") and isinstance(resolved, str):
                add(resolved)
                if len(selected) >= max_builds:
                    return selected[:max_builds]

    root = _root_dockerfile(dockerfiles)
    if root:
        add(root)

    for df in sorted(dockerfiles, key=lambda p: (p.count("/"), p)):
        if _is_auxiliary_dockerfile(df):
            continue
        add(df)
        if len(selected) >= max_builds:
            break

    if not selected and root:
        add(root)

    return selected[:max_builds]
