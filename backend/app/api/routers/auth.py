from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.schemas import LoginRequest, RegisterRequest, TokenResponse
from app.application.services.auth_service import AuthService
from app.infrastructure.db.session import get_db_session

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
async def register(payload: RegisterRequest, session: AsyncSession = Depends(get_db_session)) -> TokenResponse:
    return await AuthService(session).register(payload.email, payload.password)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: AsyncSession = Depends(get_db_session)) -> TokenResponse:
    return await AuthService(session).login(payload.email, payload.password)
