from typing import Any

import yaml

from app.plugins.base import BasePlugin


class ResourceEstimationPlugin(BasePlugin):
    name = "resource_estimation"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        dockerfile_content = context.get("dockerfile_content") or ""
        compose_content = context.get("compose_content") or ""

        estimate: dict[str, Any] = {}

        if dockerfile_content.strip():
            lines = dockerfile_content.splitlines()
            layers = sum(1 for line in lines if line.strip().upper().startswith(("RUN ", "COPY ", "ADD ")))
            estimate["estimated_layers"] = layers
            estimate["estimated_memory_mb"] = max(64, layers * 32)
            estimate["estimated_cpu_millicores"] = max(100, layers * 40)
            estimate["explanation"] = (
                f"Dockerfile has {len(lines)} lines with {layers} layer-creating instructions "
                f"(RUN/COPY/ADD). Each layer adds build-time memory overhead. "
                f"Estimated runtime memory: {estimate['estimated_memory_mb']} MB, "
                f"CPU: {estimate['estimated_cpu_millicores']}m."
            )

        if compose_content.strip():
            try:
                parsed = yaml.safe_load(compose_content) or {}
            except Exception:
                parsed = {}
            services = parsed.get("services", {})
            if isinstance(services, dict):
                service_count = len(services)
                total_memory_mb = 0
                total_cpu_millicores = 0
                service_details: list[dict[str, Any]] = []
                for name, svc in services.items():
                    if not isinstance(svc, dict):
                        continue
                    mem_mb = 128
                    cpu_m = 100
                    deploy = svc.get("deploy", {})
                    if isinstance(deploy, dict):
                        resources = deploy.get("resources", {})
                        if isinstance(resources, dict):
                            limits = resources.get("limits", {})
                            if isinstance(limits, dict):
                                if "memory" in limits:
                                    mem_mb = _parse_memory(str(limits["memory"]))
                                if "cpus" in limits:
                                    try:
                                        cpu_m = int(float(str(limits["cpus"])) * 1000)
                                    except (ValueError, TypeError):
                                        pass
                    has_build = "build" in svc
                    image = svc.get("image", "")
                    total_memory_mb += mem_mb
                    total_cpu_millicores += cpu_m
                    service_details.append({
                        "name": name,
                        "estimated_memory_mb": mem_mb,
                        "estimated_cpu_millicores": cpu_m,
                        "has_build_context": has_build,
                        "image": image if isinstance(image, str) else "",
                    })
                estimate["service_count"] = service_count
                estimate["total_estimated_memory_mb"] = total_memory_mb
                estimate["total_estimated_cpu_millicores"] = total_cpu_millicores
                estimate["services"] = service_details
                estimate["explanation"] = (
                    f"Compose file defines {service_count} service(s). "
                    f"Total estimated memory: {total_memory_mb} MB across all services. "
                    f"Total estimated CPU: {total_cpu_millicores}m. "
                    f"These are baseline estimates — services with explicit resource limits use those values, "
                    f"otherwise 128 MB / 100m CPU per service is assumed."
                )

        if not estimate:
            estimate = {
                "estimated_memory_mb": 128,
                "estimated_cpu_millicores": 100,
                "explanation": "No Dockerfile or Compose content available for estimation.",
            }

        return {"estimate": estimate}


def _parse_memory(value: str) -> int:
    import re
    value = value.strip().lower()
    try:
        match = re.match(r"^([0-9]*\.?[0-9]+)\s*(gb|g|mb|m|kb|k|b)?$", value)
        if not match:
            return 128
        num = float(match.group(1))
        unit = match.group(2) or "b"
        if unit in ("g", "gb"):
            return int(num * 1024)
        if unit in ("m", "mb"):
            return int(num)
        if unit in ("k", "kb"):
            return max(1, int(num / 1024))
        return max(1, int(num / (1024 * 1024)))
    except (ValueError, TypeError):
        return 128
