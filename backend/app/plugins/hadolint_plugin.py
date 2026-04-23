import json
import tempfile
from typing import Any

from app.infrastructure.tools.process import run_command
from app.plugins.base import BasePlugin


class HadolintPlugin(BasePlugin):
    name = "hadolint"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        content = context.get("dockerfile_content", "")
        with tempfile.NamedTemporaryFile(mode="w+", suffix=".Dockerfile", encoding="utf-8") as temp:
            temp.write(content)
            temp.flush()
            output = await run_command(["hadolint", "--format", "json", temp.name])
        findings = json.loads(output or "[]")
        return {"findings": findings}
