import uuid

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.infrastructure.db.models import UserModel
from app.infrastructure.db.repositories import UserRepository
from app.infrastructure.db.session import get_db_session

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_db_session),
) -> UserModel:
    user_repo = UserRepository(session)

    if credentials:
        try:
            payload = decode_token(credentials.credentials)
            if payload.get("type") != "access":
                raise HTTPException(status_code=401, detail="Invalid token type.")
            user_id = uuid.UUID(payload["sub"])
            user = await user_repo.get_by_id(user_id)
            if user:
                return user
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Invalid bearer token.") from exc

    raise HTTPException(status_code=401, detail="Authentication required.")
