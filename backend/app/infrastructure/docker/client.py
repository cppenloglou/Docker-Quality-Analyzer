import asyncio
import io
from datetime import datetime, timezone
from typing import Any

import docker
import docker.errors


def _format_bytes(size: int) -> str:
    """Human-readable byte size."""
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size //= 1024
    return f"{size:.1f} TB"


class DockerGateway:
    def __init__(self) -> None:
        self.client = docker.from_env()

    @staticmethod
    def _extract_ports(inspect: dict) -> list[dict[str, Any]]:
        ports_raw = inspect.get("NetworkSettings", {}).get("Ports", {}) or {}
        result = []
        for container_port, bindings in ports_raw.items():
            entry: dict[str, Any] = {"container_port": container_port, "host_bindings": []}
            if isinstance(bindings, list):
                for b in bindings:
                    if isinstance(b, dict):
                        entry["host_bindings"].append({
                            "host_ip": b.get("HostIp", "0.0.0.0"),
                            "host_port": b.get("HostPort", ""),
                        })
            result.append(entry)
        return result

    @staticmethod
    def _extract_ip(inspect: dict) -> str:
        networks = inspect.get("NetworkSettings", {}).get("Networks", {}) or {}
        for net_name, net_info in networks.items():
            if isinstance(net_info, dict):
                ip = net_info.get("IPAddress", "")
                if ip:
                    return ip
        return inspect.get("NetworkSettings", {}).get("IPAddress", "")

    # ── Image build & inspect ─────────────────────────────────────────────────

    async def build_image(
        self,
        path: str,
        dockerfile: str,
        tag: str,
        buildargs: dict[str, str] | None = None,
    ) -> tuple[Any, list[str]]:
        """Build a Docker image and return (image, log_lines)."""
        image, log_gen = await asyncio.to_thread(
            self._build_image_sync, path, dockerfile, tag, buildargs or {}
        )
        log_lines: list[str] = []
        for chunk in log_gen:
            if isinstance(chunk, dict):
                line = chunk.get("stream", "") or chunk.get("error", "") or ""
                line = line.rstrip("\n")
                if line:
                    log_lines.append(line)
        return image, log_lines

    def _build_image_sync(
        self,
        path: str,
        dockerfile: str,
        tag: str,
        buildargs: dict[str, str],
    ) -> tuple[Any, Any]:
        image, log_gen = self.client.images.build(
            path=path,
            dockerfile=dockerfile,
            tag=tag,
            buildargs=buildargs,
            rm=True,
        )
        return image, log_gen

    async def inspect_image(self, image_id_or_tag: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._inspect_image_sync, image_id_or_tag)

    def _inspect_image_sync(self, image_id_or_tag: str) -> dict[str, Any]:
        img = self.client.images.get(image_id_or_tag)
        attrs = img.attrs or {}
        cfg = attrs.get("Config") or {}
        rootfs = attrs.get("RootFS") or {}
        layers = rootfs.get("Layers") or []

        exposed_ports = list((cfg.get("ExposedPorts") or {}).keys())
        env_raw: list[str] = cfg.get("Env") or []
        env_keys = [e.split("=", 1)[0] for e in env_raw if "=" in e]

        entrypoint = cfg.get("Entrypoint")
        cmd = cfg.get("Cmd")

        size_bytes = int(attrs.get("Size") or 0)

        return {
            "image_id": attrs.get("Id", "").replace("sha256:", "")[:12],
            "image_size_bytes": size_bytes,
            "image_size_human": _format_bytes(size_bytes),
            "layer_count": len(layers),
            "architecture": attrs.get("Architecture"),
            "os": attrs.get("Os"),
            "created_at": attrs.get("Created"),
            "repo_tags": list(attrs.get("RepoTags") or []),
            "repo_digests": list(attrs.get("RepoDigests") or []),
            "exposed_ports": exposed_ports,
            "env_keys": env_keys,
            "labels": dict(cfg.get("Labels") or {}),
            "entrypoint": list(entrypoint) if isinstance(entrypoint, list) else None,
            "cmd": list(cmd) if isinstance(cmd, list) else None,
            "user": cfg.get("User") or None,
            "workdir": cfg.get("WorkingDir") or None,
        }

    # ── Container final state (for exited containers) ─────────────────────────

    async def inspect_container_final_state(self, container_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._inspect_final_sync, container_id)

    def _inspect_final_sync(self, container_id: str) -> dict[str, Any]:
        try:
            container = self.client.containers.get(container_id)
        except docker.errors.NotFound:
            return {"error": f"Container {container_id} not found", "exit_code": -1}

        attrs = container.attrs or {}
        state = attrs.get("State") or {}
        cfg = attrs.get("Config") or {}

        last_logs: list[str] = []
        try:
            raw_logs = container.logs(tail=50, stream=False)
            if isinstance(raw_logs, bytes):
                last_logs = [l for l in raw_logs.decode("utf-8", errors="ignore").splitlines() if l]
        except Exception:
            pass

        return {
            "container_id": container_id,
            "container_name": str(attrs.get("Name", "")).lstrip("/"),
            "image": str(cfg.get("Image", "")),
            "status": state.get("Status"),
            "exit_code": state.get("ExitCode"),
            "error": state.get("Error") or None,
            "started_at": state.get("StartedAt"),
            "finished_at": state.get("FinishedAt"),
            "restart_count": int(attrs.get("RestartCount") or 0),
            "oom_killed": bool(state.get("OOMKilled")),
            "last_logs": last_logs,
        }

    async def inspect_container_state(self, container_id: str) -> dict[str, Any]:
        """Return container State.Status without collecting stats (cheap pre-check for lifecycle)."""
        return await asyncio.to_thread(self._inspect_container_state_sync, container_id)

    def _inspect_container_state_sync(self, container_id: str) -> dict[str, Any]:
        try:
            container = self.client.containers.get(container_id)
        except docker.errors.NotFound:
            return {"container_id": container_id, "status": "not_found"}
        attrs = container.attrs or {}
        state = attrs.get("State") or {}
        status = str(state.get("Status") or "").lower()
        return {"container_id": container_id, "status": status}

    # ── Container metrics ─────────────────────────────────────────────────────

    async def inspect_container_metrics(self, container_id: str) -> dict[str, Any]:
        container, stats, inspect = await asyncio.to_thread(self._fetch_stats_sync, container_id)
        return self._build_metrics(container_id, stats, inspect)

    def _fetch_stats_sync(self, container_id: str) -> tuple:
        container = self.client.containers.get(container_id)
        stats = container.stats(stream=False)
        inspect = container.attrs
        return container, stats, inspect

    def _build_metrics(self, container_id: str, stats: dict, inspect: dict) -> dict[str, Any]:
        mem_usage = stats.get("memory_stats", {}).get("usage", 0)
        mem_limit = stats.get("memory_stats", {}).get("limit", 1) or 1
        mem_stats = stats.get("memory_stats", {}).get("stats", {})
        cpu_delta = stats.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0) - stats.get(
            "precpu_stats", {}
        ).get("cpu_usage", {}).get("total_usage", 0)
        system_delta = stats.get("cpu_stats", {}).get("system_cpu_usage", 0) - stats.get("precpu_stats", {}).get(
            "system_cpu_usage", 0
        )
        online_cpus = stats.get("cpu_stats", {}).get("online_cpus", 0) or len(
            stats.get("cpu_stats", {}).get("cpu_usage", {}).get("percpu_usage", []) or []
        ) or 1
        cpu_percent = (cpu_delta / system_delta * online_cpus * 100.0) if system_delta > 0 else 0.0

        net_raw = stats.get("networks", {}) or {}
        net_totals = {
            "rx_bytes": 0,
            "tx_bytes": 0,
            "rx_packets": 0,
            "tx_packets": 0,
            "rx_errors": 0,
            "tx_errors": 0,
            "rx_dropped": 0,
            "tx_dropped": 0,
        }
        for values in net_raw.values():
            if not isinstance(values, dict):
                continue
            net_totals["rx_bytes"] += int(values.get("rx_bytes", 0) or 0)
            net_totals["tx_bytes"] += int(values.get("tx_bytes", 0) or 0)
            net_totals["rx_packets"] += int(values.get("rx_packets", 0) or 0)
            net_totals["tx_packets"] += int(values.get("tx_packets", 0) or 0)
            net_totals["rx_errors"] += int(values.get("rx_errors", 0) or 0)
            net_totals["tx_errors"] += int(values.get("tx_errors", 0) or 0)
            net_totals["rx_dropped"] += int(values.get("rx_dropped", 0) or 0)
            net_totals["tx_dropped"] += int(values.get("tx_dropped", 0) or 0)

        blkio = stats.get("blkio_stats", {}) or {}
        io_read_bytes = 0
        io_write_bytes = 0
        for entry in blkio.get("io_service_bytes_recursive", []) or []:
            if not isinstance(entry, dict):
                continue
            op = str(entry.get("op", "")).lower()
            value = int(entry.get("value", 0) or 0)
            if op == "read":
                io_read_bytes += value
            elif op == "write":
                io_write_bytes += value

        cpu_stats = stats.get("cpu_stats", {}) or {}
        throttling = cpu_stats.get("throttling_data", {}) or {}
        memory_percent = (mem_usage / mem_limit * 100.0) if mem_limit > 0 else 0.0
        mounts = inspect.get("Mounts", []) or []
        state = inspect.get("State", {}) or {}

        return {
            "cpu_percent": cpu_percent,
            "memory_bytes": mem_usage,
            "memory_percent": memory_percent,
            # rich payload
            "cpu": {
                "percent": cpu_percent,
                "total_usage": int(cpu_stats.get("cpu_usage", {}).get("total_usage", 0) or 0),
                "system_usage": int(cpu_stats.get("system_cpu_usage", 0) or 0),
                "online_cpus": int(cpu_stats.get("online_cpus", 0) or 0),
                "throttling": {
                    "periods": int(throttling.get("periods", 0) or 0),
                    "throttled_periods": int(throttling.get("throttled_periods", 0) or 0),
                    "throttled_time": int(throttling.get("throttled_time", 0) or 0),
                },
            },
            "memory": {
                "usage_bytes": int(mem_usage or 0),
                "limit_bytes": int(mem_limit or 0),
                "percent": memory_percent,
                "cache_bytes": int(mem_stats.get("cache", 0) or 0),
                "rss_bytes": int(mem_stats.get("rss", 0) or 0),
                "mapped_file_bytes": int(mem_stats.get("mapped_file", 0) or 0),
                "failcnt": int(stats.get("memory_stats", {}).get("failcnt", 0) or 0),
            },
            "network": {
                "interfaces": net_raw,
                "totals": net_totals,
            },
            "io": {
                "read_bytes": io_read_bytes,
                "write_bytes": io_write_bytes,
            },
            "pids": {
                "current": int(stats.get("pids_stats", {}).get("current", 0) or 0),
            },
            "container": {
                "id": container_id,
                "name": str(inspect.get("Name", "")).lstrip("/"),
                "image": str(inspect.get("Config", {}).get("Image", "")),
                "command": inspect.get("Config", {}).get("Cmd", []),
                "created_at": inspect.get("Created"),
                "started_at": state.get("StartedAt"),
                "status": state.get("Status"),
                "health_status": (state.get("Health") or {}).get("Status"),
                "restart_count": int(inspect.get("RestartCount", 0) or 0),
                "mounts": [
                    {
                        "type": m.get("Type"),
                        "source": m.get("Source"),
                        "destination": m.get("Destination"),
                        "mode": m.get("Mode"),
                        "rw": m.get("RW"),
                    }
                    for m in mounts
                    if isinstance(m, dict)
                ],
                "ports": self._extract_ports(inspect),
                "ip_address": self._extract_ip(inspect),
            },
        }
