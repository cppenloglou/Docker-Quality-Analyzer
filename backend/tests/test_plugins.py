import pytest

from pathlib import Path

from app.plugins.registry import load_plugins
from app.plugins.security_scanner_plugin import SecurityScannerPlugin


def test_plugin_registry_loads_configured_plugins():
    plugins = load_plugins(["hadolint", "security_scanner", "resource_estimation"])
    names = {plugin.name for plugin in plugins}
    assert "hadolint" in names
    assert "security_scanner" in names
    assert "resource_estimation" in names


@pytest.mark.asyncio
async def test_security_plugin_flags_risky_keywords():
    plugin = SecurityScannerPlugin()
    result = await plugin.run({"dockerfile_content": "FROM ubuntu:latest\nUSER root\nRUN echo secret"})
    assert result["findings"]
    assert any(item["code"] == "SEC001" for item in result["findings"])


@pytest.mark.asyncio
async def test_security_plugin_ignores_dockerfile_full_line_comment():
    plugin = SecurityScannerPlugin()
    dockerfile = "# root, latest stuff\nFROM ubuntu:24.04\nUSER appuser\n"
    result = await plugin.run({"dockerfile_content": dockerfile})
    sec001 = [f for f in result["findings"] if f["code"] == "SEC001"]
    assert not any(f["line"] == 1 for f in sec001)


@pytest.mark.asyncio
async def test_security_plugin_still_flags_latest_tag():
    plugin = SecurityScannerPlugin()
    result = await plugin.run({"dockerfile_content": "FROM ubuntu:latest\nUSER appuser\n"})
    sec001 = [f for f in result["findings"] if f["code"] == "SEC001"]
    assert len(sec001) == 1
    assert sec001[0]["line"] == 1
    assert "latest" in sec001[0]["message"]


@pytest.mark.asyncio
async def test_security_plugin_compose_comments_produce_no_findings():
    plugin = SecurityScannerPlugin()
    compose = (
        "# pinned non-latest tag, no privileged flags\n"
        "services:\n"
        "  web:\n"
        "    image: nginx:1.27-alpine\n"
    )
    result = await plugin.run({"compose_content": compose})
    sec001 = [f for f in result["findings"] if f["code"] == "SEC001"]
    assert sec001 == []


@pytest.mark.asyncio
async def test_security_plugin_compose_flags_privileged_on_correct_line():
    plugin = SecurityScannerPlugin()
    compose = (
        "# pinned non-latest tag, no privileged flags\n"  # line 1
        "services:\n"  # line 2
        "  web:\n"  # line 3
        "    image: nginx:1.27-alpine\n"  # line 4
        "    ports:\n"  # line 5
        "      - '8080:80'\n"  # line 6
        "  worker:\n"  # line 7
        "    image: busybox:1.36\n"  # line 8
        "    privileged: true\n"  # line 9
    )
    result = await plugin.run({"compose_content": compose})
    sec001 = [f for f in result["findings"] if f["code"] == "SEC001"]
    assert len(sec001) == 1
    assert sec001[0]["line"] == 9
    assert "privileged" in sec001[0]["message"]


@pytest.mark.asyncio
async def test_security_plugin_strips_inline_yaml_comment():
    plugin = SecurityScannerPlugin()
    compose = "services:\n  cache:\n    image: redis:7.2-alpine  # was latest\n"
    result = await plugin.run({"compose_content": compose})
    sec001 = [f for f in result["findings"] if f["code"] == "SEC001"]
    assert sec001 == []


@pytest.mark.asyncio
async def test_security_plugin_keeps_dockerfile_midline_hash():
    plugin = SecurityScannerPlugin()
    dockerfile = "FROM ubuntu:24.04\nRUN echo 'secret#value' > /tmp/x\nUSER appuser\n"
    result = await plugin.run({"dockerfile_content": dockerfile})
    sec001 = [f for f in result["findings"] if f["code"] == "SEC001"]
    assert any(f["line"] == 2 and "secret" in f["message"] for f in sec001)


@pytest.mark.asyncio
async def test_sec002_missing_user_instruction():
    plugin = SecurityScannerPlugin()
    dockerfile = "FROM ubuntu:24.04\nRUN apt-get update\nCMD ['bash']\n"
    result = await plugin.run({"dockerfile_content": dockerfile})
    sec002 = [f for f in result["findings"] if f["code"] == "SEC002"]
    assert len(sec002) == 1
    assert sec002[0]["line"] == 1
    assert sec002[0]["severity"] == "warning"
    assert sec002[0]["message"] == "Container runs as root: no USER instruction in final stage"


@pytest.mark.asyncio
async def test_sec002_not_emitted_when_user_set():
    plugin = SecurityScannerPlugin()
    dockerfile = "FROM ubuntu:24.04\nRUN useradd appuser\nUSER appuser\nCMD ['bash']\n"
    result = await plugin.run({"dockerfile_content": dockerfile})
    assert not any(f["code"] == "SEC002" for f in result["findings"])


@pytest.mark.asyncio
async def test_sec002_multistage_only_final_stage_counts():
    plugin = SecurityScannerPlugin()
    dockerfile = (
        "FROM node:22 AS builder\n"
        "RUN npm ci\n"
        "FROM node:22-slim\n"
        "COPY --from=builder /app /app\n"
        "USER node\n"
        "CMD ['node', 'server.js']\n"
    )
    result = await plugin.run({"dockerfile_content": dockerfile})
    assert not any(f["code"] == "SEC002" for f in result["findings"])


@pytest.mark.asyncio
async def test_sec002_explicit_root_user():
    plugin = SecurityScannerPlugin()
    dockerfile = "FROM ubuntu:24.04\nUSER appuser\nUSER root\nCMD ['bash']\n"
    result = await plugin.run({"dockerfile_content": dockerfile})
    sec002 = [f for f in result["findings"] if f["code"] == "SEC002"]
    assert len(sec002) == 1
    assert sec002[0]["line"] == 3
    assert sec002[0]["message"] == "Container explicitly runs as root"


@pytest.mark.asyncio
async def test_sec002_not_emitted_for_compose_content():
    plugin = SecurityScannerPlugin()
    compose = "services:\n  web:\n    image: nginx:1.27-alpine\n"
    result = await plugin.run({"compose_content": compose})
    assert not any(f["code"] == "SEC002" for f in result["findings"])


@pytest.mark.asyncio
async def test_compose_validator_writes_rdjson_via_output_file(monkeypatch):
    async def fake_run_command(cmd: list[str], timeout: int = 45, *, allow_empty_stdout: bool = False):
        assert cmd[0] == "dclint"
        assert "-f" in cmd and cmd[cmd.index("-f") + 1] == "rdjson"
        assert "-o" in cmd
        assert allow_empty_stdout is True
        out_idx = cmd.index("-o")
        out_file = cmd[out_idx + 1]
        compose_file = cmd[-1]
        assert Path(compose_file).is_file()
        Path(out_file).write_text(
            '{"source":{"name":"dclint","url":"https://example.com"},"diagnostics":[]}',
            encoding="utf-8",
        )
        return ""

    monkeypatch.setattr("app.plugins.compose_validator_plugin.run_command", fake_run_command)

    from app.plugins.compose_validator_plugin import ComposeValidatorPlugin

    plugin = ComposeValidatorPlugin()
    result = await plugin.run({"compose_content": "services:\n  web:\n    image: nginx\n"})
    assert result["findings"]["diagnostics"] == []


@pytest.mark.asyncio
async def test_compose_validator_returns_synthetic_issue_on_invalid_json(monkeypatch):
    async def fake_run_command(cmd: list[str], timeout: int = 45, *, allow_empty_stdout: bool = False):
        out_idx = cmd.index("-o")
        out_file = cmd[out_idx + 1]
        Path(out_file).write_text('{"broken": ', encoding="utf-8")
        return ""

    monkeypatch.setattr("app.plugins.compose_validator_plugin.run_command", fake_run_command)

    from app.plugins.compose_validator_plugin import ComposeValidatorPlugin

    plugin = ComposeValidatorPlugin()
    result = await plugin.run({"compose_content": "x: 1\n"})
    assert "dclint_parse_error" in result
    assert isinstance(result["findings"], list)
    assert result["findings"][0]["code"]["value"] == "dclint-output-parse"
