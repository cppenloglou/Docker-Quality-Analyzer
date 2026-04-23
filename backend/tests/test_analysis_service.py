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
