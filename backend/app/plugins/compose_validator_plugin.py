import json
import tempfile
from typing import Any

from app.infrastructure.tools.process import run_command
from app.plugins.base import BasePlugin


class ComposeValidatorPlugin(BasePlugin):
    name = "compose_validator"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        content = context.get("compose_content", "")
        with tempfile.NamedTemporaryFile(mode="w+", suffix=".yaml", encoding="utf-8") as temp:
            temp.write(content)
            temp.flush()
            output = await run_command(["dclint", "-f", "rdjson", temp.name])
        findings = json.loads(output or "{}")
        return {"findings": findings}
