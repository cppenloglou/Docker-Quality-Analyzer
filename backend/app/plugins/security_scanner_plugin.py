from typing import Any

from app.plugins.base import BasePlugin

SECURITY_KEYWORDS = ("root", "privileged", "secret", "password", "latest")


class SecurityScannerPlugin(BasePlugin):
    name = "security_scanner"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        source = context.get("dockerfile_content") or context.get("compose_content") or ""
        issues: list[dict[str, Any]] = []
        for idx, line in enumerate(source.splitlines(), start=1):
            lower = line.lower()
            matches = [word for word in SECURITY_KEYWORDS if word in lower]
            if matches:
                issues.append(
                    {
                        "line": idx,
                        "code": "SEC001",
                        "severity": "warning",
                        "message": f"Potential security smell: {', '.join(matches)}",
                        "suggestion": "Review principle of least privilege and immutable tags.",
                    }
                )
        return {"findings": issues}
