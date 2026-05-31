"""Unit tests for research API privacy helpers."""
import json

from app.api.research_privacy import (
    extract_public_research_findings,
    sanitize_research_result,
    strip_source_preview_recursive,
)


def test_strip_source_preview_recursive_removes_nested_keys():
    raw = {
        "per_file_results": [
            {"file_path": "Dockerfile", "source_preview": "SHOULD_DROP", "score": 1},
        ],
        "source_preview": "TOP_LEVEL_DROP",
        "nested": {"a": {"source_preview": "INNER"}},
    }
    stripped = strip_source_preview_recursive(raw)
    blob = json.dumps(stripped)
    assert "SHOULD_DROP" not in blob
    assert "TOP_LEVEL_DROP" not in blob
    assert "INNER" not in blob
    assert "source_preview" not in blob
    assert stripped["nested"]["a"] == {}


def test_sanitize_never_contains_source_preview_in_output():
    result = {
        "score": 50,
        "grade": "C",
        "errors": [],
        "warnings": [],
        "suggestions": [],
        "securityIssues": [],
        "per_file_results": [
            {"path": "./Dockerfile", "source_preview": "SECRET_MARKER_XYZ"},
        ],
    }
    safe = sanitize_research_result(result)
    assert safe is not None
    out = json.dumps(safe).lower()
    assert "secret_marker_xyz" not in out
    assert "source_preview" not in out


def test_extract_public_research_findings_normalizes_and_redacts():
    result = {
        "errors": [
            {
                "code": "",
                "severity": "error",
                "message": "Token=abc123 in /tmp/private/Dockerfile from api.internal.local 10.4.5.6",
            }
        ],
        "warnings": [],
        "suggestions": [],
        "securityIssues": [],
    }
    findings = extract_public_research_findings(result)
    assert len(findings) == 1
    finding = findings[0]
    assert finding["code"] == "UNKNOWN"
    assert finding["severity"] == "error"
    assert finding["message"] == "[redacted] in [redacted-path] from [redacted-domain] [redacted-ip]"


def test_extract_public_research_findings_prefers_per_file_when_requested():
    result = {
        "errors": [{"code": "TOP001", "severity": "error", "message": "top-level error"}],
        "per_file_results": [
            {
                "file_path": "src/Dockerfile",
                "errors": [{"code": "PF001", "severity": "error", "message": "per-file error"}],
                "warnings": [],
                "suggestions": [],
                "securityIssues": [],
            }
        ],
    }
    findings = extract_public_research_findings(result, prefer_per_file=True)
    assert len(findings) == 1
    assert findings[0]["code"] == "PF001"
    assert findings[0]["message"] == "per-file error"
