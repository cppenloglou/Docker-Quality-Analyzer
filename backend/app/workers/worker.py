from arq.connections import RedisSettings

from app.core.config import get_settings
from app.workers.tasks import (
    run_compose_analysis,
    run_compose_deploy,
    run_compose_stop,
    run_dockerfile_analysis,
    run_project_analysis,
)

settings = get_settings()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    functions = [run_dockerfile_analysis, run_compose_analysis, run_project_analysis, run_compose_deploy, run_compose_stop]
