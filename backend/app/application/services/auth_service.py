import uuid

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.schemas import TokenResponse, UserRead
from app.core.config import get_settings
from app.core.security import create_token, decode_token
from app.infrastructure.db.repositories import UserRepository


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = UserRepository(session)
        self.settings = get_settings()

    async def register(self, email: str, password: str) -> TokenResponse:
        existing = await self.repo.get_by_email(email)
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered.")
        user = await self.repo.create_user(email, password)
        await self.session.commit()
        return self._issue_tokens(user.id, user.email, user.created_at)

    async def login(self, email: str, password: str) -> TokenResponse:
        user = await self.repo.authenticate(email, password)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials.")
        return self._issue_tokens(user.id, user.email, user.created_at)

    async def refresh(self, refresh_token: str) -> TokenResponse:
        try:
            payload = decode_token(refresh_token)
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Invalid refresh token.") from exc
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type.")
        try:
            user_id = uuid.UUID(payload["sub"])
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=401, detail="Invalid refresh token.") from exc
        user = await self.repo.get_by_id(user_id)
        if not user:
            raise HTTPException(status_code=401, detail="User no longer exists.")
        return self._issue_tokens(user.id, user.email, user.created_at)

    def _issue_tokens(self, user_id: uuid.UUID, email: str, created_at) -> TokenResponse:
        access = create_token(str(user_id), "access", self.settings.access_token_expire_minutes)
        refresh = create_token(str(user_id), "refresh", self.settings.refresh_token_expire_minutes)
        return TokenResponse(
            access_token=access,
            refresh_token=refresh,
            user=UserRead(id=user_id, email=email, created_at=created_at),
        )
