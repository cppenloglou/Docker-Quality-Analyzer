import asyncio
import threading
from collections.abc import AsyncIterator
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
        timeout: int | None = None,
    ) -> tuple[Any, list[str]]:
        """Build a Docker image and return (image, log_lines)."""
        build_coro = asyncio.to_thread(
            self._build_image_sync, path, dockerfile, tag, buildargs or {}
        )
        if timeout and timeout > 0:
            image, log_gen = await asyncio.wait_for(build_coro, timeout=timeout)
        else:
            image, log_gen = await build_coro
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

    async def remove_image(self, tag: str) -> bool:
        """Remove an image by tag or id. Returns True if removed, False if not found."""
        return await asyncio.to_thread(self._remove_image_sync, tag)

    def _remove_image_sync(self, tag: str) -> bool:
        try:
            self.client.images.remove(tag, force=True)
            return True
        except docker.errors.ImageNotFound:
            return False

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

    @staticmethod
    def _decode_log_bytes(raw_logs: bytes | str) -> list[str]:
        if isinstance(raw_logs, bytes):
            text = raw_logs.decode("utf-8", errors="ignore")
        else:
            text = raw_logs
        return [line for line in text.splitlines() if line]

    async def tail_container_logs(self, container_id: str, *, tail: int = 200) -> list[str]:
        """Return the last ``tail`` log lines (non-streaming snapshot)."""
        return await asyncio.to_thread(self._tail_container_logs_sync, container_id, tail)

    def _tail_container_logs_sync(self, container_id: str, tail: int) -> list[str]:
        try:
            container = self.client.containers.get(container_id)
        except docker.errors.NotFound:
            return []
        try:
            raw_logs = container.logs(tail=tail, stream=False)
            if isinstance(raw_logs, bytes):
                return self._decode_log_bytes(raw_logs)
        except Exception:
            pass
        return []

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

        last_logs = self._tail_container_logs_sync(container_id, 50)

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

    # ── Container runtime info (no stats; for deploy-state enrichment) ─────────

    async def inspect_container_runtime(self, container_id: str) -> dict[str, Any]:
        """Lightweight inspect (no stats) for deploy-state enrichment: name, service, ports, health."""
        return await asyncio.to_thread(self._inspect_container_runtime_sync, container_id)

    def _inspect_container_runtime_sync(self, container_id: str) -> dict[str, Any]:
        try:
            container = self.client.containers.get(container_id)
        except docker.errors.NotFound:
            return {"id": container_id, "status": "not_found"}
        attrs = container.attrs or {}
        state = attrs.get("State") or {}
        cfg = attrs.get("Config") or {}
        labels = cfg.get("Labels") or {}
        return {
            "id": container_id,
            "name": str(attrs.get("Name", "")).lstrip("/") or None,
            "service": labels.get("com.docker.compose.service"),
            "image": str(cfg.get("Image", "")) or None,
            "status": state.get("Status"),
            "health_status": (state.get("Health") or {}).get("Status"),
            "restart_count": int(attrs.get("RestartCount") or 0),
            "ip_address": self._extract_ip(attrs),
            "ports": self._extract_ports(attrs),
        }

    # ── Container log streaming ───────────────────────────────────────────────

    @staticmethod
    def _split_log_timestamp(text: str) -> tuple[str | None, str]:
        """Split a ``docker logs --timestamps`` line into (timestamp, message)."""
        if " " not in text:
            return None, text
        candidate, _, rest = text.partition(" ")
        # RFC3339 timestamps from the Docker daemon look like 2024-01-02T03:04:05.123456789Z
        if "T" in candidate and (candidate.endswith("Z") or "+" in candidate or candidate.count(":") >= 2):
            normalized = candidate.replace("Z", "+00:00")
            try:
                datetime.fromisoformat(normalized)
                return candidate, rest
            except ValueError:
                return None, text
        return None, text

    async def follow_container_logs(
        self,
        container_id: str,
        *,
        tail: int = 200,
        max_buffer: int = 2000,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield ``{stream, line, timestamp}`` dicts, tailing then following container logs.

        The synchronous Docker SDK log generator is consumed in a background thread and
        pushed onto a bounded asyncio queue so the event loop never blocks. The stream ends
        naturally when the container stops or is removed (EOF).
        """
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=max_buffer)
        sentinel = object()

        def _put(item: Any) -> None:
            try:
                queue.put_nowait(item)
            except asyncio.QueueFull:
                # Drop oldest to keep memory bounded under log floods.
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(item)
                except asyncio.QueueFull:
                    pass

        def _reader() -> None:
            try:
                container = self.client.containers.get(container_id)
                # docker-py Container.logs() does not accept demux= (only attach() does).
                # Streamed logs arrive as multiplexed payload bytes without stream ids.
                stream = container.logs(
                    stream=True,
                    follow=True,
                    timestamps=True,
                    tail=tail,
                    stdout=True,
                    stderr=True,
                )
                for chunk in stream:
                    if isinstance(chunk, tuple):
                        # attach()-style demux tuples if a future caller passes them through
                        chunks = (("stdout", chunk[0]), ("stderr", chunk[1]))
                    elif isinstance(chunk, bytes):
                        chunks = (("stdout", chunk),)
                    else:
                        chunks = (("stdout", str(chunk).encode()),)
                    for source, raw in chunks:
                        if not raw:
                            continue
                        decoded = raw.decode("utf-8", errors="ignore")
                        for line in decoded.splitlines():
                            if not line:
                                continue
                            timestamp, message = DockerGateway._split_log_timestamp(line)
                            loop.call_soon_threadsafe(
                                _put,
                                {"stream": source, "line": message, "timestamp": timestamp},
                            )
            except docker.errors.NotFound:
                loop.call_soon_threadsafe(
                    _put,
                    {
                        "stream": "system",
                        "line": f"Container {container_id[:12]} not found.",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
            except Exception as exc:  # noqa: BLE001 - surface as a system log line
                loop.call_soon_threadsafe(
                    _put,
                    {
                        "stream": "system",
                        "line": f"Log stream error: {exc}",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
            finally:
                loop.call_soon_threadsafe(_put, sentinel)

        thread = threading.Thread(target=_reader, name=f"logs-{container_id[:12]}", daemon=True)
        thread.start()

        while True:
            item = await queue.get()
            if item is sentinel:
                break
            yield item

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
