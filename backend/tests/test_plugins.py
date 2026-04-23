import pytest

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
