import json
import os
import sys
import time
import urllib.error
import urllib.request

TARGET_URL = os.getenv("TARGET_URL", "http://web:5000").rstrip("/")


def request(path: str, method: str = "GET", payload: dict | None = None):
    body = None
    headers = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{TARGET_URL}{path}", data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=5) as response:
        raw = response.read().decode("utf-8")
        return response.status, json.loads(raw) if raw else None


last_error = None
for _ in range(30):
    try:
        status, health = request("/health")
        if status == 200 and health["status"] == "ok":
            break
    except (urllib.error.URLError, TimeoutError, KeyError) as exc:
        last_error = exc
        time.sleep(1)
else:
    print(f"Service did not become healthy: {last_error}", file=sys.stderr)
    sys.exit(1)

status, created = request("/api/tasks", "POST", {"title": "Smoke test task", "priority": "high"})
assert status == 201, created
assert created["title"] == "Smoke test task"

status, stats = request("/api/stats")
assert status == 200, stats
assert stats["total"] >= 1, stats

print("Smoke test passed")
