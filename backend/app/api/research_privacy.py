"""Privacy helpers for the public research API.

All functions are pure and stateless — safe to call from any context.
"""

from __future__ import annotations

import hashlib
import os
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

# Issue list keys whose items we summarise (count + code extraction).
_ISSUE_LIST_KEYS: tuple[str, ...] = ("errors", "warnings", "suggestions", "securityIssues")

# Count key names that map to the above issue lists.
_ISSUE_COUNT_KEYS: tuple[str, ...] = ("errors_count", "warnings_count", "suggestions_count", "security_count")


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

    safe: dict[str, Any] = {}

    # Copy safe scalar fields.
    for key in _SAFE_RESULT_SCALAR_KEYS:
        if key in result:
            safe[key] = result[key]

    # Summarise each issue list.
    issue_codes: list[str] = []
    doc_urls: list[str] = []
    severity_counts: dict[str, int] = {}

    for list_key, count_key in zip(_ISSUE_LIST_KEYS, _ISSUE_COUNT_KEYS):
        issues = result.get(list_key)
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

    return safe
