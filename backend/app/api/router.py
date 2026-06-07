from fastapi import APIRouter

from app.api.routers import auth, compose, dockerfile, history, preview_proxy, project, research, ws

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(dockerfile.router)
api_router.include_router(compose.router)
api_router.include_router(preview_proxy.router)
api_router.include_router(project.router)
api_router.include_router(history.router)
api_router.include_router(research.router)
api_router.include_router(ws.router)
