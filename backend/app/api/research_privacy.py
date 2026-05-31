"""Privacy helpers for the public research API.

All functions are pure and stateless — safe to call from any context.
"""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from typing import Any

# Keys in input_metadata that are safe to expose (no filenames, no content, no paths).
_SAFE_METADATA_KEYS: frozenset[str] = frozenset(
    {
        "line_count",
        "service_count",
        "has_dockerfile",
        "has_compose",
        "uses_build",
        "uses_volumes",
        "uses_networks",
        "detected_analyzer",
    }
)

# Top-level result fields that are safe to expose directly.
_SAFE_RESULT_SCALAR_KEYS: frozenset[str] = frozenset({"score", "grade"})


def strip_source_preview_recursive(obj: Any) -> Any:
    """Remove ``source_preview`` keys at any nesting depth (defense in depth for research API)."""
    if isinstance(obj, dict):
        return {k: strip_source_preview_recursive(v) for k, v in obj.items() if k != "source_preview"}
    if isinstance(obj, list):
        return [strip_source_preview_recursive(v) for v in obj]
    return obj


# Issue list keys whose items we summarise (count + code extraction).
_ISSUE_LIST_KEYS: tuple[str, ...] = ("errors", "warnings", "suggestions", "securityIssues")

# Count key names that map to the above issue lists.
_ISSUE_COUNT_KEYS: tuple[str, ...] = ("errors_count", "warnings_count", "suggestions_count", "security_count")

_FINDING_MESSAGE_MAX_LEN = 180
_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_DOMAIN_RE = re.compile(r"\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b")
_SECRET_RE = re.compile(r"(?i)\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+")
_ABS_PATH_RE = re.compile(r"(?:[A-Za-z]:\\|/)[^\s,;]+")
_REL_PATH_RE = re.compile(r"(?:\.\./|\.\/)[^\s,;]+")
_MULTI_SPACE_RE = re.compile(r"\s+")


def _normalize_finding_code(raw_code: Any) -> str:
    if isinstance(raw_code, str):
        code = raw_code.strip()
        if code:
            return code
    return "UNKNOWN"


def _normalize_finding_message(raw_message: Any) -> str:
    if isinstance(raw_message, str):
        message = raw_message.strip()
    else:
        message = ""
    if not message:
        message = "No details provided"
    # Redact path / host / secret-like tokens from message-level aggregates.
    message = _SECRET_RE.sub("[redacted]", message)
    message = _ABS_PATH_RE.sub("[redacted-path]", message)
    message = _REL_PATH_RE.sub("[redacted-path]", message)
    message = _IP_RE.sub("[redacted-ip]", message)
    message = _DOMAIN_RE.sub("[redacted-domain]", message)
    message = _MULTI_SPACE_RE.sub(" ", message).strip()
    if len(message) > _FINDING_MESSAGE_MAX_LEN:
        message = f"{message[:_FINDING_MESSAGE_MAX_LEN - 3]}..."
    return message


def _normalize_finding_severity(raw_severity: Any, *, code: str, issue_list_key: str) -> str:
    if issue_list_key == "securityIssues" or code.upper().startswith("SEC"):
        return "security"
    severity = str(raw_severity or "").strip().lower()
    if severity == "warn":
        severity = "warning"
    if severity == "fatal":
        severity = "error"
    if severity in {"error", "warning", "info"}:
        return severity
    if issue_list_key == "errors":
        return "error"
    if issue_list_key == "warnings":
        return "warning"
    return "info"


def _extract_findings_from_container(container: dict[str, Any]) -> list[dict[str, str | None]]:
    findings: list[dict[str, str | None]] = []
    for issue_list_key in _ISSUE_LIST_KEYS:
        issues = container.get(issue_list_key)
        if not isinstance(issues, list):
            continue
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            code = _normalize_finding_code(issue.get("code"))
            message = _normalize_finding_message(issue.get("message"))
            severity = _normalize_finding_severity(
                issue.get("severity"),
                code=code,
                issue_list_key=issue_list_key,
            )
            doc_url_raw = issue.get("doc_url")
            doc_url: str | None = None
            if isinstance(doc_url_raw, str):
                stripped = doc_url_raw.strip()
                if stripped.startswith(("http://", "https://")):
                    doc_url = stripped
            findings.append(
                {
                    "code": code,
                    "severity": severity,
                    "message": message,
                    "doc_url": doc_url,
                }
            )
    return findings


def extract_public_research_findings(
    result: dict[str, Any] | None,
    *,
    prefer_per_file: bool = False,
) -> list[dict[str, str | None]]:
    """Extract privacy-safe findings from public result sources only.

    Uses only allowed findings arrays:
    - top-level: errors, warnings, suggestions, securityIssues
    - project per-file: per_file_results[*].errors|warnings|suggestions|securityIssues
    """
    if not result or not isinstance(result, dict):
        return []
    sanitized = strip_source_preview_recursive(result)
    if not isinstance(sanitized, dict):
        return []

    per_file = sanitized.get("per_file_results")
    per_file_rows = [row for row in per_file if isinstance(row, dict)] if isinstance(per_file, list) else []
    findings: list[dict[str, str | None]] = []

    if not (prefer_per_file and per_file_rows):
        findings.extend(_extract_findings_from_container(sanitized))
    if per_file_rows:
        for row in per_file_rows:
            findings.extend(_extract_findings_from_container(row))

    return findings


def anonymize_user_id(user_id: uuid.UUID) -> str:
    """Return a stable, anonymized submitter token for a user.

    Uses SHA-256 of the UUID bytes so the same user always gets the same token,
    but the token cannot be reversed to recover the original UUID.
    """
    digest = hashlib.sha256(user_id.bytes).hexdigest()
    return f"user_{digest[:12]}"


def sanitize_research_metadata(input_metadata: dict[str, Any]) -> dict[str, Any]:
    """Strip all privacy-sensitive keys from input_metadata.

    Only scalar structural flags are kept; filenames, file contents, local
    paths, registry URLs, and env-var values are all removed.
    """
    safe: dict[str, Any] = {}

    # Carry over explicitly allowed scalar keys.
    for key in _SAFE_METADATA_KEYS:
        if key in input_metadata:
            safe[key] = input_metadata[key]

    # Derive file_extension from filename without exposing the full name.
    filename = input_metadata.get("filename")
    if isinstance(filename, str) and filename:
        _, ext = os.path.splitext(filename)
        if ext:
            safe["file_extension"] = ext.lower()

    return safe


def sanitize_research_result(result: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return a privacy-safe summary of an analysis result.

    Keeps aggregate counts, issue codes, severity distribution, and
    documentation URLs.  Strips all free-text messages, suggestion text,
    line numbers, and raw findings.
    """
    if not result or not isinstance(result, dict):
        return None

    sanitized = strip_source_preview_recursive(result)
    if not isinstance(sanitized, dict):
        return None

    safe: dict[str, Any] = {}

    # Copy safe scalar fields.
    for key in _SAFE_RESULT_SCALAR_KEYS:
        if key in sanitized:
            safe[key] = sanitized[key]

    # Summarise each issue list.
    issue_codes: list[str] = []
    doc_urls: list[str] = []
    severity_counts: dict[str, int] = {}

    for list_key, count_key in zip(_ISSUE_LIST_KEYS, _ISSUE_COUNT_KEYS):
        issues = sanitized.get(list_key)
        if isinstance(issues, list):
            safe[count_key] = len(issues)
            for issue in issues:
                if not isinstance(issue, dict):
                    continue
                code = issue.get("code")
                if isinstance(code, str) and code:
                    issue_codes.append(code)
                sev = issue.get("severity")
                if isinstance(sev, str) and sev:
                    severity_counts[sev] = severity_counts.get(sev, 0) + 1
                url = issue.get("doc_url")
                if isinstance(url, str) and url:
                    doc_urls.append(url)
        else:
            safe[count_key] = 0

    if issue_codes:
        safe["issue_codes"] = issue_codes
    if severity_counts:
        safe["severity_distribution"] = severity_counts
    if doc_urls:
        safe["doc_urls"] = list(dict.fromkeys(doc_urls))  # deduplicated, order preserved

    return strip_source_preview_recursive(safe)
