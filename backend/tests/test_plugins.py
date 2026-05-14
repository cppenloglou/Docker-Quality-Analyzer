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
