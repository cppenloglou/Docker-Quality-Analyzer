import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.application.schemas import ApiKeyCreateResponse, ApiKeyRead
from app.infrastructure.db.models import UserModel
from app.infrastructure.db.repositories import ApiKeyRepository
from app.infrastructure.db.session import get_db_session

router = APIRouter(prefix="/api/v1/users/me/api-keys", tags=["api-keys"])


@router.post("", response_model=ApiKeyCreateResponse)
async def create_api_key(
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> ApiKeyCreateResponse:
    repo = ApiKeyRepository(session)
    record, raw_key = await repo.create_key(current_user.id)
    await session.commit()
    return ApiKeyCreateResponse(id=record.id, key=raw_key, key_prefix=record.key_prefix)


@router.get("", response_model=list[ApiKeyRead])
async def list_api_keys(
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> list[ApiKeyRead]:
    repo = ApiKeyRepository(session)
    keys = await repo.list_keys(current_user.id)
    return [ApiKeyRead(id=item.id, key_prefix=item.key_prefix, created_at=item.created_at) for item in keys]


@router.delete("/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: uuid.UUID,
    current_user: UserModel = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> None:
    repo = ApiKeyRepository(session)
    revoked = await repo.revoke(current_user.id, key_id)
    if not revoked:
        raise HTTPException(status_code=404, detail="API key not found.")
    await session.commit()
