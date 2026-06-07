"""Tests for project build target selection."""

from pathlib import Path

import pytest

from app.application.services.build_selection import (
    compose_file_sort_key,
    select_dockerfiles_for_build,
)


def test_compose_file_sort_key_prefers_root_docker_compose_yml() -> None:
    files = [
        "proj/docker-compose-image-tag.yml",
        "proj/docker-compose-light.yml",
        "proj/docker-compose.yml",
        "proj/scripts/databases/hive/docker-compose.yml",
    ]
    files.sort(key=compose_file_sort_key)
    assert files[0] == "proj/docker-compose.yml"


def test_select_dockerfiles_for_build_uses_primary_compose(tmp_path: Path) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()
    (project_root / "Dockerfile").write_text("FROM python:3.12\n", encoding="utf-8")
    (project_root / "docker-compose.yml").write_text(
        """
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
""",
        encoding="utf-8",
    )
    (project_root / ".devcontainer").mkdir()
    (project_root / ".devcontainer" / "Dockerfile").write_text("FROM debian\n", encoding="utf-8")

    selected = select_dockerfiles_for_build(
        ["Dockerfile", ".devcontainer/Dockerfile"],
        project_root,
        primary_compose_file="docker-compose.yml",
        max_builds=3,
    )
    assert selected == ["Dockerfile"]


def test_select_dockerfiles_for_build_falls_back_to_root_dockerfile(tmp_path: Path) -> None:
    project_root = tmp_path / "proj"
    project_root.mkdir()
    (project_root / "Dockerfile").write_text("FROM alpine:3.20\n", encoding="utf-8")
    (project_root / "RELEASING").mkdir()
    (project_root / "RELEASING" / "Dockerfile.make_docs").write_text("FROM alpine\n", encoding="utf-8")

    selected = select_dockerfiles_for_build(
        ["Dockerfile", "RELEASING/Dockerfile.make_docs"],
        project_root,
        primary_compose_file=None,
        max_builds=3,
    )
    assert selected == ["Dockerfile"]
