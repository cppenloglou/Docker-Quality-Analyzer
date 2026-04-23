from unittest.mock import AsyncMock
import uuid

import pytest

from app.infrastructure.db.models import AnalysisJobModel, JobStatus, JobType
from app.infrastructure.db.repositories import JobRepository


@pytest.mark.asyncio
async def test_job_repository_blocks_cross_user_access():
    session = AsyncMock()
    repo = JobRepository(session)
    owner_id = uuid.uuid4()
    other_id = uuid.uuid4()
    job_id = uuid.uuid4()

    job = AnalysisJobModel(id=job_id, user_id=owner_id, type=JobType.dockerfile, status=JobStatus.queued, input_metadata={})
    session.get.return_value = job

    item = await repo.get_job(job_id, other_id)
    assert item is None
