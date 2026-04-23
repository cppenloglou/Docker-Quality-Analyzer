from collections.abc import Iterable

from app.plugins.base import BasePlugin
from app.plugins.compose_runnability_plugin import ComposeRunnabilityPlugin
from app.plugins.compose_validator_plugin import ComposeValidatorPlugin
from app.plugins.hadolint_plugin import HadolintPlugin
from app.plugins.resource_estimation_plugin import ResourceEstimationPlugin
from app.plugins.security_scanner_plugin import SecurityScannerPlugin

PLUGIN_MAP = {
    "hadolint": HadolintPlugin,
    "compose_validator": ComposeValidatorPlugin,
    "compose_runnability": ComposeRunnabilityPlugin,
    "security_scanner": SecurityScannerPlugin,
    "resource_estimation": ResourceEstimationPlugin,
}


def load_plugins(names: Iterable[str]) -> list[BasePlugin]:
    plugins: list[BasePlugin] = []
    for name in names:
        cls = PLUGIN_MAP.get(name)
        if cls:
            plugins.append(cls())
    return plugins
