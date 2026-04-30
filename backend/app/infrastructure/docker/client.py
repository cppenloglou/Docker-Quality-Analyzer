from typing import Any

import docker


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

    async def inspect_container_metrics(self, container_id: str) -> dict[str, Any]:
        container = self.client.containers.get(container_id)
        stats = container.stats(stream=False)
        inspect = container.attrs
        mem_usage = stats.get("memory_stats", {}).get("usage", 0)
        mem_limit = stats.get("memory_stats", {}).get("limit", 1) or 1
        mem_stats = stats.get("memory_stats", {}).get("stats", {})
        cpu_delta = stats.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0) - stats.get(
            "precpu_stats", {}
        ).get("cpu_usage", {}).get("total_usage", 0)
        system_delta = stats.get("cpu_stats", {}).get("system_cpu_usage", 0) - stats.get("precpu_stats", {}).get(
            "system_cpu_usage", 0
        )
        cpu_percent = (cpu_delta / system_delta * 100.0) if system_delta > 0 else 0.0

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
        memory_percent = round((mem_usage / mem_limit) * 100.0, 2) if mem_limit > 0 else 0.0
        mounts = inspect.get("Mounts", []) or []
        state = inspect.get("State", {}) or {}

        return {
            # legacy keys
            "cpu_percent": round(cpu_percent, 2),
            "memory_bytes": mem_usage,
            "memory_percent": memory_percent,
            "network_rx": net_raw,
            "uptime_seconds": 0,
            # rich payload
            "cpu": {
                "percent": round(cpu_percent, 2),
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
