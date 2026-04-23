from typing import Any

import docker


class DockerGateway:
    def __init__(self) -> None:
        self.client = docker.from_env()

    async def inspect_container_metrics(self, container_id: str) -> dict[str, Any]:
        container = self.client.containers.get(container_id)
        stats = container.stats(stream=False)
        mem_usage = stats.get("memory_stats", {}).get("usage", 0)
        mem_limit = stats.get("memory_stats", {}).get("limit", 1) or 1
        cpu_delta = stats.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0) - stats.get(
            "precpu_stats", {}
        ).get("cpu_usage", {}).get("total_usage", 0)
        system_delta = stats.get("cpu_stats", {}).get("system_cpu_usage", 0) - stats.get("precpu_stats", {}).get(
            "system_cpu_usage", 0
        )
        cpu_percent = (cpu_delta / system_delta * 100.0) if system_delta > 0 else 0.0
        return {
            "cpu_percent": round(cpu_percent, 2),
            "memory_bytes": mem_usage,
            "memory_percent": round((mem_usage / mem_limit) * 100.0, 2),
            "network_rx": stats.get("networks", {}),
            "uptime_seconds": 0,
        }
