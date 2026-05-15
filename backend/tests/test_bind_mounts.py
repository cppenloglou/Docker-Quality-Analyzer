from pathlib import Path

import pytest

from app.application.services.bind_mounts import (
    is_bind_mount_source,
    runnability_bind_mount_reasons,
    validate_bind_mounts,
)
from app.application.services.compose_mapper import map_compose_services
from app.plugins.compose_runnability_plugin import ComposeRunnabilityPlugin


@pytest.mark.parametrize(
    ("src", "expected"),
    [
        (".", True),
        ("..", True),
        ("~", True),
        ("./data", True),
        ("../data", True),
        ("/var/data", True),
        ("~/data", True),
        ("C:/Users/me/project", True),
        (r"C:\Users\me\project", True),
        ("mydata", False),
        ("pgdata", False),
    ],
)
def test_is_bind_mount_source(src: str, expected: bool) -> None:
    assert is_bind_mount_source(src) is expected


@pytest.mark.asyncio
async def test_runnability_blocks_dot_bind_mount() -> None:
    plugin = ComposeRunnabilityPlugin()
    compose = """
services:
  app:
    image: nginx:1.27
    volumes:
      - .:/usr/src/app
"""
    result = await plugin.run({"compose_content": compose})
    runnability = result["runnability"]
    assert runnability["runnable"] is False
    assert runnability["rules"]["no_bind_mounts"] is False
    assert any("bind mount" in r.lower() and "." in r for r in runnability["reasons"])


def test_runnability_bind_mount_reasons_dot_only() -> None:
    reasons = runnability_bind_mount_reasons(
        "app",
        {"volumes": [".:/usr/src/app"]},
    )
    assert len(reasons) == 1
    assert "'.'" in reasons[0] or "bind mount '.'" in reasons[0]


def test_validate_bind_mounts_dot_mount_flags_dind(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    issues = validate_bind_mounts(
        "app",
        {"volumes": [".:/usr/src/app"]},
        project_root,
    )
    assert any("bind mount '.'" in issue for issue in issues)
    assert any("Docker-in-Docker" in issue for issue in issues)


def test_compose_mapper_dot_bind_mount(tmp_path: Path) -> None:
    project_root = tmp_path / "project"
    project_root.mkdir()
    compose_content = """
services:
  app:
    image: nginx:1.27
    volumes:
      - .:/usr/src/app
"""
    (project_root / "docker-compose.yml").write_text(compose_content, encoding="utf-8")

    mappings = map_compose_services("docker-compose.yml", project_root)
    assert len(mappings) == 1
    issues = mappings[0]["issues"]
    assert any("bind mount '.'" in issue for issue in issues)
    assert any("Docker-in-Docker" in issue for issue in issues)
