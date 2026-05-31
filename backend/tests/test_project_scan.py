"""Tests for project scanning, safety checks, and multi-file analysis."""

from __future__ import annotations

import io
import uuid
import zipfile
from pathlib import Path

import pytest

from app.application.services.project_scanner import (
    _MAX_ENTRIES,
    _MAX_TOTAL_BYTES,
    safe_extract_zip,
    scan_extracted_project,
)
from app.application.services.compose_mapper import map_compose_services


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def make_zip(files: dict[str, bytes]) -> bytes:
    """Create an in-memory ZIP with the given filename → content mapping."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


def write_zip(tmp_path: Path, files: dict[str, bytes], name: str = "project.zip") -> Path:
    archive_path = tmp_path / name
    archive_path.write_bytes(make_zip(files))
    return archive_path


# ─────────────────────────────────────────────────────────────────────────────
# safe_extract_zip — path traversal protection
# ─────────────────────────────────────────────────────────────────────────────


def test_safe_extract_normal(tmp_path: Path) -> None:
    """Normal archive extracts successfully."""
    archive = write_zip(tmp_path, {"Dockerfile": b"FROM ubuntu\n", "compose.yml": b"services: {}\n"})
    extract_dir = tmp_path / "out"
    extract_dir.mkdir()
    safe_extract_zip(archive, extract_dir)
    assert (extract_dir / "Dockerfile").exists()
    assert (extract_dir / "compose.yml").exists()


def test_safe_extract_path_traversal(tmp_path: Path) -> None:
    """Path traversal entries must be rejected."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # Malicious path that would escape the extraction directory
        zf.writestr("../../etc/passwd", "root:x:0:0\n")
    archive_path = tmp_path / "evil.zip"
    archive_path.write_bytes(buf.getvalue())

    extract_dir = tmp_path / "out"
    extract_dir.mkdir()

    with pytest.raises(ValueError, match="escape extraction directory"):
        safe_extract_zip(archive_path, extract_dir)


def test_safe_extract_zip_bomb_entry_count(tmp_path: Path) -> None:
    """ZIP archives with too many entries are rejected."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for i in range(_MAX_ENTRIES + 1):
            zf.writestr(f"file_{i}.txt", b"x")
    archive_path = tmp_path / "bomb.zip"
    archive_path.write_bytes(buf.getvalue())

    extract_dir = tmp_path / "out"
    extract_dir.mkdir()
    with pytest.raises(ValueError, match="too many entries"):
        safe_extract_zip(archive_path, extract_dir)


def test_safe_extract_zip_bomb_total_size(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """ZIP archives with excessive uncompressed total size are rejected.

    We patch the module-level limit to 100 bytes so we can create a real ZIP that
    exceeds it without writing gigabytes of data.
    """
    import app.application.services.project_scanner as scanner_module

    monkeypatch.setattr(scanner_module, "_MAX_TOTAL_BYTES", 100)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("bigfile.txt", b"x" * 200)  # 200 bytes > patched 100-byte limit
    archive_path = tmp_path / "bomb.zip"
    archive_path.write_bytes(buf.getvalue())

    extract_dir = tmp_path / "out"
    extract_dir.mkdir()
    with pytest.raises(ValueError, match="total uncompressed size"):
        safe_extract_zip(archive_path, extract_dir)


# ─────────────────────────────────────────────────────────────────────────────
# scan_extracted_project — detection
# ─────────────────────────────────────────────────────────────────────────────


def _make_project(tmp_path: Path, files: dict[str, str]) -> Path:
    """Write files to tmp_path and return the project root."""
    root = tmp_path / "project"
    root.mkdir()
    for rel_path, content in files.items():
        target = root / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    return root


def test_scan_detects_dockerfile(tmp_path: Path) -> None:
    root = _make_project(tmp_path, {"Dockerfile": "FROM ubuntu\n"})
    result = scan_extracted_project(root, "project.zip")
    assert "Dockerfile" in result["detected"]["dockerfiles"]


def test_scan_detects_dockerfile_variants(tmp_path: Path) -> None:
    root = _make_project(
        tmp_path,
        {
            "Dockerfile": "FROM ubuntu\n",
            "Dockerfile.prod": "FROM ubuntu\n",
            "Dockerfile.dev": "FROM ubuntu\n",
            "backend/Dockerfile": "FROM python\n",
        },
    )
    result = scan_extracted_project(root, "project.zip")
    dfs = result["detected"]["dockerfiles"]
    assert "Dockerfile" in dfs
    assert "Dockerfile.prod" in dfs
    assert "Dockerfile.dev" in dfs
    assert any("backend" in d for d in dfs)


def test_scan_detects_compose_files(tmp_path: Path) -> None:
    root = _make_project(
        tmp_path,
        {
            "docker-compose.yml": "services: {}\n",
            "compose.yaml": "services: {}\n",
            "docker-compose.prod.yml": "services: {}\n",
            "docker-compose.images.yaml": "services: {}\n",
        },
    )
    result = scan_extracted_project(root, "project.zip")
    cfs = result["detected"]["compose_files"]
    assert any("docker-compose.yml" in cf for cf in cfs)
    assert any("compose.yaml" in cf for cf in cfs)
    assert any("docker-compose.prod.yml" in cf for cf in cfs)
    assert any("docker-compose.images.yaml" in cf for cf in cfs)


def test_scan_ignores_node_modules(tmp_path: Path) -> None:
    root = _make_project(
        tmp_path,
        {
            "Dockerfile": "FROM node\n",
            "node_modules/express/Dockerfile": "FROM node\n",
            "node_modules/some-pkg/README.md": "# pkg\n",
        },
    )
    result = scan_extracted_project(root, "project.zip")
    for df in result["detected"]["dockerfiles"]:
        assert "node_modules" not in df


def test_scan_ignores_git_dir(tmp_path: Path) -> None:
    root = _make_project(
        tmp_path,
        {
            "Dockerfile": "FROM ubuntu\n",
            ".git/config": "[core]\n",
        },
    )
    result = scan_extracted_project(root, "project.zip")
    scanned_count = result["db_safe_summary"]["total_files_scanned"]
    # .git config should not be counted
    assert scanned_count == 1  # only Dockerfile


def test_scan_handles_no_docker_files(tmp_path: Path) -> None:
    root = _make_project(tmp_path, {"main.py": "print('hello')\n", "README.md": "# project\n"})
    result = scan_extracted_project(root, "project.zip")
    assert result["detected"]["dockerfiles"] == []
    assert result["detected"]["compose_files"] == []
    assert any("No Dockerfile" in w for w in result["warnings"])


def test_scan_detects_stacks(tmp_path: Path) -> None:
    root = _make_project(
        tmp_path,
        {
            "Dockerfile": "FROM node\n",
            "package.json": '{"name":"app"}',
            "pnpm-lock.yaml": "",
        },
    )
    result = scan_extracted_project(root, "project.zip")
    stacks = result["detected"]["stacks"]
    assert any("node" in s for s in stacks)
    assert any("pnpm" in s for s in stacks)


def test_scan_dockerignore_warning(tmp_path: Path) -> None:
    root = _make_project(tmp_path, {"Dockerfile": "FROM ubuntu\n"})
    result = scan_extracted_project(root, "project.zip")
    assert any(".dockerignore" in w.lower() for w in result["warnings"])


def test_scan_no_warning_when_dockerignore_present(tmp_path: Path) -> None:
    root = _make_project(tmp_path, {"Dockerfile": "FROM ubuntu\n", ".dockerignore": "node_modules\n"})
    result = scan_extracted_project(root, "project.zip")
    # Should NOT warn about .dockerignore if it's present
    assert not any("dockerignore" in w.lower() and "No" in w for w in result["warnings"])


def test_scan_recommendation_full_project(tmp_path: Path) -> None:
    root = _make_project(
        tmp_path,
        {"Dockerfile": "FROM ubuntu\n", "docker-compose.yml": "services: {}\n"},
    )
    result = scan_extracted_project(root, "project.zip")
    rec = result["recommendation"]
    assert rec["analysis_mode"] == "full-project"
    assert rec["can_build"] is True
    assert rec["can_run"] is True


def test_scan_recommendation_dockerfile_only(tmp_path: Path) -> None:
    root = _make_project(tmp_path, {"Dockerfile": "FROM ubuntu\n"})
    result = scan_extracted_project(root, "project.zip")
    rec = result["recommendation"]
    assert rec["analysis_mode"] == "dockerfile-only"
    assert rec["can_build"] is True
    assert rec["can_run"] is False


def test_scan_recommendation_compose_only(tmp_path: Path) -> None:
    root = _make_project(tmp_path, {"docker-compose.yml": "services: {}\n"})
    result = scan_extracted_project(root, "project.zip")
    rec = result["recommendation"]
    assert rec["analysis_mode"] == "compose-only"
    assert rec["can_build"] is False
    assert rec["can_run"] is True


def test_scan_db_safe_summary_no_raw_content(tmp_path: Path) -> None:
    """db_safe_summary must not contain raw file content."""
    root = _make_project(
        tmp_path,
        {"Dockerfile": "FROM ubuntu:22.04\nRUN apt-get update\n"},
    )
    result = scan_extracted_project(root, "project.zip")
    summary_str = str(result["db_safe_summary"])
    assert "FROM ubuntu" not in summary_str
    assert "apt-get" not in summary_str


def test_scan_parses_compose_services(tmp_path: Path) -> None:
    compose_content = """
services:
  web:
    image: nginx:latest
    ports:
      - "80:80"
  db:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: secret
"""
    root = _make_project(tmp_path, {"docker-compose.yml": compose_content})
    result = scan_extracted_project(root, "project.zip")
    service_names = [s["name"] for s in result["detected"]["services"]]
    assert "web" in service_names
    assert "db" in service_names


# ─────────────────────────────────────────────────────────────────────────────
# compose_mapper
# ─────────────────────────────────────────────────────────────────────────────


def test_compose_mapper_resolves_dockerfile(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    (project_root / "Dockerfile").write_text("FROM python:3.12\n", encoding="utf-8")
    compose_content = """
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
"""
    (project_root / "docker-compose.yml").write_text(compose_content, encoding="utf-8")

    mappings = map_compose_services("docker-compose.yml", project_root)
    assert len(mappings) == 1
    api_mapping = mappings[0]
    assert api_mapping["service"] == "api"
    assert api_mapping["can_build"] is True
    assert api_mapping["resolved_dockerfile"] == "Dockerfile"
    assert api_mapping["issues"] == []


def test_compose_mapper_missing_dockerfile(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    compose_content = """
services:
  web:
    build:
      context: ./frontend
      dockerfile: Dockerfile
"""
    (project_root / "docker-compose.yml").write_text(compose_content, encoding="utf-8")

    mappings = map_compose_services("docker-compose.yml", project_root)
    assert len(mappings) == 1
    web_mapping = mappings[0]
    assert web_mapping["can_build"] is False
    # should have an issue about missing dockerfile or missing context
    assert len(web_mapping["issues"]) > 0


def test_compose_mapper_image_only_service(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    compose_content = """
services:
  redis:
    image: redis:7
"""
    (project_root / "docker-compose.yml").write_text(compose_content, encoding="utf-8")

    mappings = map_compose_services("docker-compose.yml", project_root)
    assert len(mappings) == 1
    redis_mapping = mappings[0]
    # Image-only services can run but not "build" locally
    assert redis_mapping["can_run"] is True
    assert redis_mapping["can_build"] is False
    assert redis_mapping["issues"] == []


def test_compose_mapper_missing_env_file(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    compose_content = """
services:
  api:
    image: myapp:latest
    env_file: .env.production
"""
    (project_root / "docker-compose.yml").write_text(compose_content, encoding="utf-8")

    mappings = map_compose_services("docker-compose.yml", project_root)
    api_mapping = mappings[0]
    assert any("env_file" in issue for issue in api_mapping["issues"])


def test_compose_mapper_missing_compose_file(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()

    mappings = map_compose_services("nonexistent-compose.yml", project_root)
    assert len(mappings) == 1
    assert mappings[0]["service"] == "__meta__"
    assert mappings[0]["can_build"] is False
    assert len(mappings[0]["issues"]) > 0
