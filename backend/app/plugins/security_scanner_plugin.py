import re
from typing import Any

from app.plugins.base import BasePlugin

SECURITY_KEYWORDS = ("root", "privileged", "secret", "password", "latest")

# "latest" matches whole words only so prose like "non-latest" is not flagged.
_LATEST_PATTERN = re.compile(r"\blatest\b")


def _strip_comments(line: str, *, is_yaml: bool) -> str:
    """Remove comment content from a line while keeping line numbering intact.

    Full-line comments (first non-whitespace char is '#') are blanked for both
    Dockerfiles and YAML. Inline comments ('#' preceded by whitespace, outside
    quotes) are only stripped for YAML — in Dockerfiles a mid-line '#' can be
    part of a shell command.
    """
    if line.lstrip().startswith("#"):
        return ""
    if not is_yaml:
        return line

    in_single = False
    in_double = False
    for idx, char in enumerate(line):
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif (
            char == "#"
            and not in_single
            and not in_double
            and idx > 0
            and line[idx - 1] in (" ", "\t")
        ):
            return line[:idx]
    return line


def _keyword_matches(lower_line: str) -> list[str]:
    matches: list[str] = []
    for word in SECURITY_KEYWORDS:
        if word == "latest":
            if _LATEST_PATTERN.search(lower_line):
                matches.append(word)
        elif word in lower_line:
            matches.append(word)
    return matches


def _check_final_stage_user(dockerfile_content: str) -> list[dict[str, Any]]:
    """Emit SEC002 when the final build stage runs as root.

    Fires when the final stage (after the last FROM) has no USER instruction,
    or when its last USER instruction is root / uid 0.
    """
    last_from_line: int | None = None
    last_user_line: int | None = None
    last_user_value: str | None = None

    for idx, raw_line in enumerate(dockerfile_content.splitlines(), start=1):
        stripped = raw_line.lstrip()
        if not stripped or stripped.startswith("#"):
            continue
        instruction, _, rest = stripped.partition(" ")
        instruction = instruction.upper()
        if instruction == "FROM":
            last_from_line = idx
            last_user_line = None
            last_user_value = None
        elif instruction == "USER":
            last_user_line = idx
            last_user_value = rest.strip()

    if last_from_line is None:
        return []

    if last_user_line is None or last_user_value is None:
        return [
            {
                "line": last_from_line,
                "code": "SEC002",
                "severity": "warning",
                "message": "Container runs as root: no USER instruction in final stage",
                "suggestion": "Create a non-privileged user and switch to it with USER before the entrypoint.",
            }
        ]

    user_part = last_user_value.split(":", 1)[0].strip().lower()
    if user_part in {"root", "0"}:
        return [
            {
                "line": last_user_line,
                "code": "SEC002",
                "severity": "warning",
                "message": "Container explicitly runs as root",
                "suggestion": "Create a non-privileged user and switch to it with USER before the entrypoint.",
            }
        ]
    return []


class SecurityScannerPlugin(BasePlugin):
    name = "security_scanner"

    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        dockerfile_content = context.get("dockerfile_content")
        source = dockerfile_content or context.get("compose_content") or ""
        is_yaml = not dockerfile_content

        issues: list[dict[str, Any]] = []
        for idx, line in enumerate(source.splitlines(), start=1):
            effective = _strip_comments(line, is_yaml=is_yaml)
            if not effective.strip():
                continue
            matches = _keyword_matches(effective.lower())
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

        if dockerfile_content:
            issues.extend(_check_final_stage_user(dockerfile_content))

        return {"findings": issues}
