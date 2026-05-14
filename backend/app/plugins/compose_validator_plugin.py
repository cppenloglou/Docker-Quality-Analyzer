import json
import os
import tempfile
from pathlib import Path
from typing import Any

from app.infrastructure.tools.process import run_command
from app.plugins.base import BasePlugin


class ComposeValidatorPlugin(BasePlugin):
    name = "compose_validator"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run dclint with RDJSON output written to a temp file.

        Large compose files can produce >64KiB of JSON; some environments truncate
        subprocess stdout at that boundary. Using ``-o`` avoids truncation.
        """
        content = context.get("compose_content", "")
        compose_path: str | None = None
        out_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".yaml",
                encoding="utf-8",
                delete=False,
            ) as compose_tf:
                compose_path = compose_tf.name
                compose_tf.write(content)

            out_fd, out_path = tempfile.mkstemp(suffix=".rdjson", text=True)
            os.close(out_fd)

            await run_command(
                ["dclint", "-f", "rdjson", "-o", out_path, compose_path],
                allow_empty_stdout=True,
            )

            raw = Path(out_path).read_text(encoding="utf-8", errors="ignore")
            if not raw.strip():
                return {"findings": {"diagnostics": []}}

            try:
                findings: Any = json.loads(raw)
            except json.JSONDecodeError as exc:
                return {
                    "findings": [
                        {
                            "severity": "warning",
                            "line": 1,
                            "code": {"value": "dclint-output-parse"},
                            "message": (
                                "Docker Compose linter (dclint) output could not be parsed as JSON. "
                                "If you still see this after upgrading dclint, the report may be corrupt. "
                                f"Parse error: {exc}"
                            ),
                        }
                    ],
                    "dclint_parse_error": str(exc),
                }

            return {"findings": findings}
        finally:
            for path in (compose_path, out_path):
                if path:
                    try:
                        os.unlink(path)
                    except OSError:
                        pass
