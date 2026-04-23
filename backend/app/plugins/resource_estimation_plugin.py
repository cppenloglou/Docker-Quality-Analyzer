from typing import Any

from app.plugins.base import BasePlugin


class ResourceEstimationPlugin(BasePlugin):
    name = "resource_estimation"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        source = context.get("dockerfile_content") or context.get("compose_content") or ""
        layers = sum(1 for line in source.splitlines() if line.strip().upper().startswith("RUN "))
        services = sum(1 for line in source.splitlines() if line.strip().endswith(":"))
        estimate = {
            "estimated_layers": layers,
            "estimated_memory_mb": max(128, layers * 32 + services * 64),
            "estimated_cpu_millicores": max(100, layers * 40 + services * 80),
        }
        return {"estimate": estimate}
