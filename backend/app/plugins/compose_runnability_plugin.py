import re
from typing import Any

import yaml

from app.plugins.base import BasePlugin

UNRESOLVED_ENV_PATTERN = re.compile(r"\$\{[A-Za-z_][A-Za-z0-9_]*\}")


class ComposeRunnabilityPlugin(BasePlugin):
    name = "compose_runnability"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        compose_content = str(context.get("compose_content") or "")
        reasons: list[str] = []
        rules: dict[str, bool] = {}

        try:
            parsed = yaml.safe_load(compose_content) or {}
        except Exception as exc:
            return {
                "runnability": {
                    "runnable": False,
                    "reasons": [f"Compose file is not valid YAML: {exc}"],
                    "rules": {"valid_yaml": False},
                }
            }

        services = parsed.get("services") if isinstance(parsed, dict) else None
        if not isinstance(services, dict) or not services:
            reasons.append("Compose file must define at least one service.")
            rules["has_services"] = False
            return {"runnability": {"runnable": False, "reasons": reasons, "rules": rules}}
        rules["has_services"] = True

        has_build = False
        has_missing_or_latest_tag = False
        has_bind_mount = False
        has_env_file = False
        has_dangerous_runtime = False

        for service_name, service in services.items():
            if not isinstance(service, dict):
                continue

            if "build" in service:
                has_build = True
                reasons.append(f"Service '{service_name}' uses build context and needs project files.")

            image = service.get("image")
            if isinstance(image, str):
                image_text = image.strip()
                if "@sha256:" not in image_text:
                    if ":" not in image_text or image_text.rsplit(":", 1)[1].lower() == "latest":
                        has_missing_or_latest_tag = True
                        reasons.append(
                            f"Service '{service_name}' image must use a non-latest explicit tag or digest."
                        )
            else:
                has_missing_or_latest_tag = True
                reasons.append(f"Service '{service_name}' is missing an image reference.")

            if "env_file" in service:
                has_env_file = True
                reasons.append(f"Service '{service_name}' references env_file, which is unavailable standalone.")

            volumes = service.get("volumes", [])
            if isinstance(volumes, list):
                for volume in volumes:
                    if isinstance(volume, str):
                        source = volume.split(":", 1)[0].strip()
                        if source.startswith(("./", "../", "/", "~")):
                            has_bind_mount = True
                            reasons.append(
                                f"Service '{service_name}' uses host bind mount '{source}', unavailable standalone."
                            )
                    elif isinstance(volume, dict):
                        if str(volume.get("type", "")).lower() == "bind":
                            has_bind_mount = True
                            reasons.append(
                                f"Service '{service_name}' uses bind mount via long syntax, unavailable standalone."
                            )
                        source = str(volume.get("source") or "")
                        if source.startswith(("./", "../", "/", "~")):
                            has_bind_mount = True
                            reasons.append(
                                f"Service '{service_name}' uses host source '{source}', unavailable standalone."
                            )

            if service.get("privileged") is True:
                has_dangerous_runtime = True
                reasons.append(f"Service '{service_name}' uses privileged mode.")
            if str(service.get("network_mode") or "").lower() == "host":
                has_dangerous_runtime = True
                reasons.append(f"Service '{service_name}' uses host network mode.")
            if str(service.get("pid") or "").lower() == "host":
                has_dangerous_runtime = True
                reasons.append(f"Service '{service_name}' uses host PID mode.")
            if service.get("cap_add"):
                has_dangerous_runtime = True
                reasons.append(f"Service '{service_name}' uses cap_add.")
            if service.get("devices"):
                has_dangerous_runtime = True
                reasons.append(f"Service '{service_name}' uses device mappings.")

        unresolved_env = bool(UNRESOLVED_ENV_PATTERN.search(compose_content))
        if unresolved_env:
            reasons.append("Compose file contains unresolved ${VAR} interpolation without defaults.")

        external_resource = False
        for group in ("networks", "volumes"):
            entries = parsed.get(group, {})
            if not isinstance(entries, dict):
                continue
            for name, definition in entries.items():
                if isinstance(definition, dict) and definition.get("external") is True:
                    external_resource = True
                    reasons.append(f"{group[:-1].capitalize()} '{name}' is marked external=true.")

        rules["no_build_contexts"] = not has_build
        rules["explicit_non_latest_images"] = not has_missing_or_latest_tag
        rules["no_bind_mounts"] = not has_bind_mount
        rules["no_external_resources"] = not external_resource
        rules["no_env_file"] = not has_env_file
        rules["no_unresolved_env"] = not unresolved_env
        rules["no_dangerous_runtime_flags"] = not has_dangerous_runtime

        deduped_reasons = list(dict.fromkeys(reasons))
        return {
            "runnability": {
                "runnable": len(deduped_reasons) == 0,
                "reasons": deduped_reasons,
                "rules": rules,
            }
        }
