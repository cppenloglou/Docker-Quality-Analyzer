from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserRead,
)
from app.application.services.auth_service import AuthService
from app.infrastructure.db.models import UserModel
from app.infrastructure.db.session import get_db_session

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(payload: RegisterRequest, session: AsyncSession = Depends(get_db_session)) -> TokenResponse:
    return await AuthService(session).register(payload.email, payload.password)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_db_session)) -> TokenResponse:
    return await AuthService(session).login(payload.email, payload.password)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, session: AsyncSession = Depends(get_db_session)) -> TokenResponse:
    return await AuthService(session).refresh(payload.refresh_token)


@router.get("/me", response_model=UserRead)
async def me(current_user: UserModel = Depends(get_current_user)) -> UserRead:
    return UserRead(id=current_user.id, email=current_user.email, created_at=current_user.created_at)
