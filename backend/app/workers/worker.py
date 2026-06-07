from arq.connections import RedisSettings
from arq.worker import func

from app.core.config import get_settings
from app.workers.tasks import (
    cleanup_job_images,
    run_compose_analysis,
    run_compose_deploy,
    run_compose_stop,
    run_dockerfile_analysis,
    run_project_analysis,
    teardown_job_runtime,
)

settings = get_settings()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    job_timeout = settings.project_job_timeout_seconds
    functions = [
        run_dockerfile_analysis,
        run_compose_analysis,
        func(
            run_project_analysis,
            timeout=settings.project_job_timeout_seconds,
            max_tries=1,
        ),
        run_compose_deploy,
        run_compose_stop,
        cleanup_job_images,
        teardown_job_runtime,
    ]
