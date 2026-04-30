from unittest.mock import AsyncMock

from app.application.services.analysis_service import AnalysisService


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
