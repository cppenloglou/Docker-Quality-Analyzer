from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock
import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.security import create_token
from app.infrastructure.db.models import UserModel
from app.main import create_app


@pytest.fixture
def app():
    @asynccontextmanager
    async def no_lifespan(_app):
        yield

    app_instance = create_app()
    app_instance.router.lifespan_context = no_lifespan
    return app_instance


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def fake_session() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def fake_db_session_dependency(fake_session):
    async def _fake_db() -> AsyncIterator[AsyncMock]:
        yield fake_session

    return _fake_db


def auth_header_for(user_id: uuid.UUID) -> dict[str, str]:
    token = create_token(str(user_id), "access", 30)
    return {"Authorization": f"Bearer {token}"}


def make_user(user_id: uuid.UUID | None = None, email: str = "user@example.com") -> UserModel:
    return UserModel(
        id=user_id or uuid.uuid4(),
        email=email,
        hashed_password="hashed",
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
