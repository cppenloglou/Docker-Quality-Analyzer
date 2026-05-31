from unittest.mock import AsyncMock

from app.application.services.analysis_service import AnalysisService, _build_analysis_started_payload


def test_normalize_issue_uses_level_when_severity_missing():
    service = AnalysisService(AsyncMock())
    issue = service._normalize_issue(
        {
            "line": 4,
            "code": "DL3002",
            "level": "warning",
            "message": "Last USER should not be root",
        }
    )
    assert issue.severity == "warning"
    assert issue.code == "DL3002"
    assert issue.line == 4
    assert issue.doc_url == "https://github.com/hadolint/hadolint/wiki/DL3002"


def test_normalize_issue_shellcheck_code_gets_wiki_url():
    service = AnalysisService(AsyncMock())
    issue = service._normalize_issue(
        {
            "line": 10,
            "code": "SC2086",
            "level": "warning",
            "message": "Double quote to prevent globbing and word splitting.",
        }
    )
    assert issue.code == "SC2086"
    assert issue.doc_url == "https://github.com/koalaman/shellcheck/wiki/SC2086"


def test_normalize_issue_custom_code_has_no_wiki_url():
    service = AnalysisService(AsyncMock())
    issue = service._normalize_issue(
        {
            "line": 2,
            "code": "SEC001",
            "severity": "warning",
            "message": "Potential security smell",
        }
    )
    assert issue.code == "SEC001"
    assert issue.doc_url is None


def test_normalize_issue_dclint_rdjson_code_object():
    service = AnalysisService(AsyncMock())
    issue = service._normalize_issue(
        {
            "message": "Port without interface",
            "severity": "ERROR",
            "location": {"range": {"start": {"line": 7}}},
            "code": {
                "value": "no-unbound-port-interfaces",
                "url": "https://github.com/zavoloklom/docker-compose-linter/blob/main/docs/rules/no-unbound-port-interfaces-rule.md",
            },
            "original_output": (
                '{"meta":{"description":"Bind ports to a host interface.","url":"https://example/doc"}}'
            ),
        }
    )
    assert issue.code == "no-unbound-port-interfaces"
    assert issue.doc_url == (
        "https://github.com/zavoloklom/docker-compose-linter/blob/main/docs/rules/no-unbound-port-interfaces-rule.md"
    )
    assert issue.line == 7
    assert issue.severity == "error"
    assert issue.suggestion == "Bind ports to a host interface."


def test_build_analysis_started_payload_omits_source_content():
    payload = _build_analysis_started_payload(
        {
            "filename": "docker-compose.yml",
            "source": "upload",
            "compose_content": "services:\n  web:\n    image: nginx:1.27\n",
            "dockerfile_content": "",
        }
    )
    assert payload["analysis_type"] == "compose"
    assert payload["line_count"] == 3
    assert payload["filename"] == "docker-compose.yml"
    assert payload["source"] == "upload"
    assert "compose_content" not in payload
    assert "dockerfile_content" not in payload
