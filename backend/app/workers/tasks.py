import asyncio
import json
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable

import yaml
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.application.services.analysis_service import AnalysisService, _grade
from app.application.services.compose_mapper import map_compose_services
from app.domain.events import DomainEvent
from app.infrastructure.db.models import JobStatus
from app.infrastructure.db.repositories import JobRepository
from app.infrastructure.docker.client import DockerGateway
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.events.bus import publish_event, redis_client

settings = get_settings()
DEPLOY_STATE_TTL_SECONDS = 60 * 60 * 6
METRICS_INTERVAL_SECONDS = 2


async def run_dockerfile_analysis(ctx, payload: dict) -> dict:
    async with SessionLocal() as session:
        return await _run_with_payload(session, payload, ["hadolint", "security_scanner", "resource_estimation"], job_type="dockerfile")


async def run_compose_analysis(ctx, payload: dict) -> dict:
    async with SessionLocal() as session:
        return await _run_with_payload(
            session,
            payload,
            ["compose_validator", "compose_runnability", "security_scanner", "resource_estimation"],
            job_type="compose",
        )


async def run_project_analysis(ctx, payload: dict) -> dict:
    """Analyze selected Dockerfiles and Compose files separately, then merge results."""
    async with SessionLocal() as session:
        user_id = uuid.UUID(payload["user_id"])
        job_id = uuid.UUID(payload["job_id"])
        project_path = Path(payload["project_path"])
        dockerfiles: list[str] = payload.get("dockerfiles", [])
        compose_files: list[str] = payload.get("compose_files", [])
        repo = JobRepository(session)
        svc = AnalysisService(session)

        await publish_event(DomainEvent("project.analysis_started", str(user_id), str(job_id), payload={"project_path": str(project_path)}))
        await repo.update_status(job_id, user_id, JobStatus.running)
        await session.commit()

        if not dockerfiles and not compose_files:
            result: dict[str, Any] = {
                "message": "No Dockerfile or Compose file found. Cannot analyze containerization.",
                "overall_score": 0,
                "overall_grade": "F",
                "per_file_results": [],
                "project_summary": {
                    "total_files_analyzed": 0,
                    "dockerfiles_analyzed": 0,
                    "compose_files_analyzed": 0,
                    "total_errors": 0,
                    "total_warnings": 0,
                    "total_security_issues": 0,
                    "total_suggestions": 0,
                },
            }
            await repo.update_status(job_id, user_id, JobStatus.failed, result=result)
            await session.commit()
            await publish_event(DomainEvent("project.analysis_failed", str(user_id), str(job_id), payload=result))
            return result

        per_file_results: list[dict[str, Any]] = []
        all_scores: list[int] = []

        # Analyze each Dockerfile separately
        for df_rel in dockerfiles:
            df_path = project_path / df_rel
            await publish_event(
                DomainEvent("project.file_analysis_started", str(user_id), str(job_id), payload={"file": df_rel, "type": "dockerfile"})
            )
            try:
                content = df_path.read_text(encoding="utf-8", errors="ignore")
                file_result = await svc.analyze_content(
                    content,
                    content_type="dockerfile",
                    context_extras={"project_path": str(project_path)},
                )
                file_entry: dict[str, Any] = {"file_path": df_rel, "file_type": "dockerfile", **file_result}
                per_file_results.append(file_entry)
                all_scores.append(file_result["score"])
            except Exception as exc:
                per_file_results.append(
                    {
                        "file_path": df_rel,
                        "file_type": "dockerfile",
                        "score": 0,
                        "grade": "F",
                        "errors_count": 1,
                        "warnings_count": 0,
                        "security_count": 0,
                        "suggestions_count": 0,
                        "errors": [{"code": "SCAN_ERROR", "severity": "error", "message": str(exc), "line": 1, "suggestion": ""}],
                        "warnings": [],
                        "securityIssues": [],
                        "suggestions": [],
                        "meta": {},
                    }
                )
                all_scores.append(0)
            await publish_event(
                DomainEvent("project.file_analysis_completed", str(user_id), str(job_id), payload={"file": df_rel, "type": "dockerfile"})
            )

        # Analyze each Compose file separately
        for cf_rel in compose_files:
            cf_path = project_path / cf_rel
            await publish_event(
                DomainEvent("project.file_analysis_started", str(user_id), str(job_id), payload={"file": cf_rel, "type": "compose"})
            )
            try:
                content = cf_path.read_text(encoding="utf-8", errors="ignore")
                file_result = await svc.analyze_content(
                    content,
                    content_type="compose",
                    context_extras={"project_path": str(project_path)},
                )
                file_entry = {"file_path": cf_rel, "file_type": "compose", **file_result}
                per_file_results.append(file_entry)
                all_scores.append(file_result["score"])
            except Exception as exc:
                per_file_results.append(
                    {
                        "file_path": cf_rel,
                        "file_type": "compose",
                        "score": 0,
                        "grade": "F",
                        "errors_count": 1,
                        "warnings_count": 0,
                        "security_count": 0,
                        "suggestions_count": 0,
                        "errors": [{"code": "SCAN_ERROR", "severity": "error", "message": str(exc), "line": 1, "suggestion": ""}],
                        "warnings": [],
                        "securityIssues": [],
                        "suggestions": [],
                        "meta": {},
                    }
                )
                all_scores.append(0)
            await publish_event(
                DomainEvent("project.file_analysis_completed", str(user_id), str(job_id), payload={"file": cf_rel, "type": "compose"})
            )

        await publish_event(DomainEvent("project.merge_started", str(user_id), str(job_id), payload={}))

        # Compose-to-Dockerfile mapping
        service_mappings: list[dict[str, Any]] = []
        primary_compose = payload.get("primary_compose_file") or (compose_files[0] if compose_files else None)
        if primary_compose:
            service_mappings = map_compose_services(primary_compose, project_path)

        # Aggregate project-level result
        overall_score = round(sum(all_scores) / len(all_scores)) if all_scores else 0
        overall_grade = _grade(overall_score)

        df_results = [r for r in per_file_results if r["file_type"] == "dockerfile"]
        cf_results = [r for r in per_file_results if r["file_type"] == "compose"]

        total_errors = sum(r.get("errors_count", len(r.get("errors", []))) for r in per_file_results)
        total_warnings = sum(r.get("warnings_count", len(r.get("warnings", []))) for r in per_file_results)
        total_security = sum(r.get("security_count", len(r.get("securityIssues", []))) for r in per_file_results)
        total_suggestions = sum(r.get("suggestions_count", len(r.get("suggestions", []))) for r in per_file_results)

        best_file = max(per_file_results, key=lambda r: r["score"])["file_path"] if per_file_results else None
        worst_file = min(per_file_results, key=lambda r: r["score"])["file_path"] if per_file_results else None

        project_recommendations: list[str] = []
        if not dockerfiles:
            project_recommendations.append("No Dockerfile found — add a Dockerfile to enable image builds.")
        if not compose_files:
            project_recommendations.append("No Compose file found — add a docker-compose.yml for multi-service orchestration.")
        if dockerfiles and not any("dockerignore" in p for p in payload.get("dockerfiles", [])):
            project_recommendations.append("Consider adding a .dockerignore to reduce build context size.")
        for mapping in service_mappings:
            for issue in mapping.get("issues", []):
                project_recommendations.append(f"[{mapping['service']}] {issue}")

        for r in per_file_results:
            r.setdefault("errors_count", len(r.get("errors", [])))
            r.setdefault("warnings_count", len(r.get("warnings", [])))
            r.setdefault("security_count", len(r.get("securityIssues", [])))
            r.setdefault("suggestions_count", len(r.get("suggestions", [])))

        result = {
            "score": overall_score,
            "grade": overall_grade,
            "overall_score": overall_score,
            "overall_grade": overall_grade,
            "per_file_results": per_file_results,
            "service_mappings": service_mappings,
            "project_summary": {
                "total_files_analyzed": len(per_file_results),
                "dockerfiles_analyzed": len(df_results),
                "compose_files_analyzed": len(cf_results),
                "total_errors": total_errors,
                "total_warnings": total_warnings,
                "total_security_issues": total_security,
                "total_suggestions": total_suggestions,
                "best_score_file": best_file,
                "worst_score_file": worst_file,
            },
            "project_recommendations": project_recommendations,
        }

        await repo.update_status(job_id, user_id, JobStatus.done, result=result)
        await session.commit()
        await publish_event(DomainEvent("project.analysis_completed", str(user_id), str(job_id), payload={"overall_score": overall_score, "overall_grade": overall_grade}))
        await publish_event(DomainEvent("user.analysis.completed", str(user_id), str(job_id), payload=result))
        return result


async def run_compose_deploy(ctx, payload: dict) -> dict:
    user_id = str(payload["user_id"])
    job_id = str(payload["job_id"])
    run_stack = bool(payload.get("run_stack", False))
    compose_up_completed = False
    deploy_spec: dict[str, Any] | None = None

    try:
        async with SessionLocal() as session:
            repo = JobRepository(session)
            job = await repo.get_job(uuid.UUID(job_id), uuid.UUID(user_id))
            if not job:
                raise RuntimeError("Job not found for deployment.")
            deploy_spec = _resolve_deploy_spec(user_id, job_id, job.input_metadata or {})
            await _set_deploy_state(user_id, job_id, deploy_spec)

        primary_container_id = ""
        container_ids: list[str] = []
        if run_stack:
            await _compose_up(deploy_spec, user_id=user_id, job_id=job_id)
            compose_up_completed = True
            container_ids = await _compose_ps_ids(deploy_spec)
            if container_ids:
                primary_container_id = container_ids[0]
                await _set_deploy_state(
                    user_id,
                    job_id,
                    {
                        **deploy_spec,
                        "container_id": primary_container_id,
                        "container_ids": container_ids,
                    },
                )

        started_container = primary_container_id or deploy_spec["project_name"]
        await publish_event(
            DomainEvent(
                "container.started",
                user_id=user_id,
                job_id=job_id,
                payload={
                    "container_id": started_container,
                    "run_stack": run_stack,
                    "project_name": deploy_spec["project_name"],
                    "container_ids": container_ids,
                },
            )
        )

        if run_stack and container_ids:
            await _stream_metrics(user_id, job_id, container_ids)

        return {
            "status": "deployment workflow acknowledged",
            "project_name": deploy_spec["project_name"],
            "container_id": started_container,
        }
    except Exception as exc:
        if run_stack and deploy_spec is not None:
            cleanup_payload = {"project_name": deploy_spec["project_name"]}
            await publish_event(
                DomainEvent("deploy.cleanup_started", user_id=user_id, job_id=job_id, payload=cleanup_payload)
            )
            await _compose_down_soft(deploy_spec, remove_volumes=False)
            await publish_event(
                DomainEvent(
                    "deploy.cleanup_completed",
                    user_id=user_id,
                    job_id=job_id,
                    payload={**cleanup_payload, "ok": True},
                )
            )
        if deploy_spec is not None:
            try:
                await _clear_deploy_state(user_id, job_id)
            except Exception:
                pass
        fail_payload = {"message": str(exc)}
        await publish_event(
            DomainEvent("user.analysis.failed", user_id=user_id, job_id=job_id, payload=fail_payload)
        )
        raise


async def run_compose_stop(ctx, payload: dict) -> dict:
    user_id = str(payload["user_id"])
    job_id = str(payload["job_id"])
    remove_volumes = bool(payload.get("remove_volumes", False))
    state = await _get_deploy_state(user_id, job_id)
    if not state:
        return {"status": "no_active_deploy"}

    await _set_stop_requested(user_id, job_id)
    await _compose_down(state, remove_volumes)

    container_id = str(state.get("container_id") or state.get("project_name") or "")
    await publish_event(
        DomainEvent(
            "container.stopped",
            user_id=user_id,
            job_id=job_id,
            payload={
                "container_id": container_id,
                "project_name": state.get("project_name"),
                "remove_volumes": remove_volumes,
            },
        )
    )
    await _clear_deploy_state(user_id, job_id)
    return {"status": "stopped"}


async def _run_with_payload(session: AsyncSession, payload: dict, plugins: list[str], job_type: str = "dockerfile") -> dict:
    user_id = uuid.UUID(payload["user_id"])
    job_id = uuid.UUID(payload["job_id"])
    content = payload.get("content", "")
    context = {
        "dockerfile_content": content if job_type == "dockerfile" else "",
        "compose_content": content if job_type == "compose" else "",
        "filename": payload.get("filename", ""),
    }
    svc = AnalysisService(session)
    return await svc.run_job_with_plugins(user_id, job_id, context, plugins)


def _deployment_key(user_id: str, job_id: str) -> str:
    return f"deploy:{user_id}:{job_id}"


def _deploy_stop_key(user_id: str, job_id: str) -> str:
    return f"deploy-stop:{user_id}:{job_id}"


def _compose_base_cmd(spec: dict[str, Any]) -> list[str]:
    return ["docker-compose", "-p", str(spec["project_name"]), "-f", str(spec["compose_file"])]


def _resolve_deploy_spec(user_id: str, job_id: str, metadata: dict[str, Any]) -> dict[str, str]:
    project_name = f"dqa-{job_id.replace('-', '')[:12]}"
    project_path = metadata.get("project_path")

    # Prefer explicit primary_compose_file from analyze selections
    primary_compose = metadata.get("primary_compose_file")
    compose_files = metadata.get("selected_compose_files") or metadata.get("compose_files") or []
    compose_rel = primary_compose or (compose_files[0] if compose_files else None)

    if project_path and compose_rel:
        project_dir = Path(str(project_path)).resolve()
        compose_file = (project_dir / compose_rel).resolve()
        return {
            "project_name": project_name,
            "project_dir": str(project_dir),
            "compose_file": str(compose_file),
        }

    compose_content = metadata.get("compose_content")
    if isinstance(compose_content, str) and compose_content.strip():
        deploy_dir = (Path(settings.upload_dir) / "deployments" / user_id / job_id).resolve()
        deploy_dir.mkdir(parents=True, exist_ok=True)
        filename = str(metadata.get("filename") or "docker-compose.yml")
        compose_file = (deploy_dir / filename).resolve()
        compose_file.write_text(compose_content, encoding="utf-8")
        return {
            "project_name": project_name,
            "project_dir": str(deploy_dir),
            "compose_file": str(compose_file),
        }

    raise RuntimeError("No deployable compose content found for this job.")


def _stderr_suggests_host_port_publish_conflict(stderr: str) -> bool:
    """Detect Docker / Compose errors where published host ports block ``up``."""
    s = stderr.lower()
    return any(
        needle in s
        for needle in (
            "port is already allocated",
            "address already in use",
            "failed to bind port",
            "userland proxy",
            "failed programming external connectivity",
        )
    )


def _count_compose_services(spec: dict[str, Any]) -> int:
    """Best-effort count of service definitions in the spec's compose file."""
    try:
        raw = Path(str(spec["compose_file"])).read_text(encoding="utf-8")
        parsed = yaml.safe_load(raw) or {}
        services = parsed.get("services")
        if isinstance(services, dict):
            return len(services)
    except Exception:
        return 0
    return 0


def _classify_compose_up_line(line: str) -> str | None:
    """Map a compose-up output line to a coarse progress bucket."""
    text = line.strip()
    if not text or "Container " not in text:
        return None
    lower = text.lower()
    if lower.endswith(" started"):
        return "started"
    if lower.endswith(" created"):
        return "created"
    return None


async def _compose_up(
    spec: dict[str, Any],
    *,
    user_id: str | None = None,
    job_id: str | None = None,
) -> None:
    project_name = str(spec["project_name"])
    total_services = _count_compose_services(spec)

    async def emit_log(line: str) -> None:
        if user_id and job_id and line:
            await publish_event(
                DomainEvent(
                    "deploy.compose_up_log",
                    user_id=user_id,
                    job_id=job_id,
                    payload={"line": line, "project_name": project_name},
                )
            )

    async def make_progress_callback(buffer: list[str]) -> Callable[[str], Awaitable[None]]:
        counters = {"created": 0, "started": 0}

        async def on_line(line: str) -> None:
            buffer.append(line)
            await emit_log(line)
            bucket = _classify_compose_up_line(line)
            if not bucket:
                return
            counters[bucket] = counters[bucket] + 1
            if user_id and job_id and total_services:
                await publish_event(
                    DomainEvent(
                        "deploy.compose_up_progress",
                        user_id=user_id,
                        job_id=job_id,
                        payload={
                            "project_name": project_name,
                            "total_services": total_services,
                            "created": min(counters["created"], total_services),
                            "started": min(counters["started"], total_services),
                        },
                    )
                )

        return on_line

    primary_buffer: list[str] = []
    primary_cb = await make_progress_callback(primary_buffer)
    command = _compose_base_cmd(spec) + ["up", "-d"]
    rc = await _run_subprocess_streaming(command, cwd=str(spec["project_dir"]), on_line=primary_cb)
    if rc == 0:
        return

    combined_stderr = "\n".join(primary_buffer)
    if _stderr_suggests_host_port_publish_conflict(combined_stderr):
        sanitized_file = _build_no_ports_compose(spec)
        await emit_log("[falling back: stripping published ports and retrying]")
        fallback_buffer: list[str] = []
        fallback_cb = await make_progress_callback(fallback_buffer)
        fallback_command = [
            "docker-compose",
            "-p",
            project_name,
            "-f",
            sanitized_file,
            "up",
            "-d",
        ]
        fallback_rc = await _run_subprocess_streaming(
            fallback_command, cwd=str(spec["project_dir"]), on_line=fallback_cb
        )
        if fallback_rc != 0:
            raise RuntimeError(
                f"docker-compose up failed (fallback): {chr(10).join(fallback_buffer)}"
            )
        return
    raise RuntimeError(f"docker-compose up failed: {combined_stderr}")


def _build_no_ports_compose(spec: dict[str, Any]) -> str:
    compose_path = Path(str(spec["compose_file"]))
    raw = compose_path.read_text(encoding="utf-8")
    parsed = yaml.safe_load(raw) or {}
    services = parsed.get("services")
    if not isinstance(services, dict):
        raise RuntimeError("Compose file missing services for no-port fallback.")
    changed = False
    for service_name, service_def in services.items():
        if isinstance(service_def, dict) and service_def.get("ports"):
            service_def.pop("ports", None)
            services[service_name] = service_def
            changed = True
    if not changed:
        raise RuntimeError("No service ports to remove after port allocation failure.")
    sanitized_path = Path(str(spec["project_dir"])) / ".dqa-no-publish.compose.yml"
    sanitized_path.write_text(yaml.safe_dump(parsed, sort_keys=False), encoding="utf-8")
    return str(sanitized_path.resolve())


async def _compose_ps_ids(spec: dict[str, Any]) -> list[str]:
    command = _compose_base_cmd(spec) + ["ps", "-q"]
    stdout, _, _ = await _run_subprocess(command, cwd=str(spec["project_dir"]))
    return [line.strip() for line in stdout.splitlines() if line.strip()]


async def _compose_down(spec: dict[str, Any], remove_volumes: bool) -> None:
    command = _compose_base_cmd(spec) + ["down"]
    if remove_volumes:
        command.append("-v")
    _, stderr, returncode = await _run_subprocess(command, cwd=str(spec["project_dir"]))
    if returncode != 0:
        raise RuntimeError(f"docker-compose down failed: {stderr}")


async def _compose_down_soft(spec: dict[str, Any], *, remove_volumes: bool = False) -> None:
    """Remove a partially created stack without masking the original deploy error."""
    try:
        await _compose_down(spec, remove_volumes)
    except Exception:
        pass


async def _run_subprocess(command: list[str], cwd: str | None = None) -> tuple[str, str, int]:
    proc = await asyncio.create_subprocess_exec(
        *command,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_bytes, stderr_bytes = await proc.communicate()
    return (
        stdout_bytes.decode("utf-8", errors="ignore"),
        stderr_bytes.decode("utf-8", errors="ignore"),
        proc.returncode or 0,
    )


async def _run_subprocess_streaming(
    command: list[str],
    cwd: str | None,
    on_line: Callable[[str], Awaitable[None]],
) -> int:
    """Run a subprocess streaming combined stdout/stderr line-by-line to ``on_line``."""
    proc = await asyncio.create_subprocess_exec(
        *command,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdout is not None
    while True:
        chunk = await proc.stdout.readline()
        if not chunk:
            break
        text = chunk.decode("utf-8", errors="ignore").rstrip("\r\n")
        if not text:
            continue
        try:
            await on_line(text)
        except Exception:
            pass
    await proc.wait()
    return proc.returncode or 0


async def _stream_metrics(user_id: str, job_id: str, container_ids: list[str]) -> None:
    docker_gateway = DockerGateway()
    while True:
        if await _is_stop_requested(user_id, job_id):
            break
        for container_id in container_ids:
            try:
                metrics = await docker_gateway.inspect_container_metrics(container_id)
            except Exception:
                continue
            payload = {"container_id": container_id, **metrics}
            await publish_event(
                DomainEvent(
                    "container.metrics",
                    user_id=user_id,
                    job_id=job_id,
                    payload=payload,
                )
            )
        await asyncio.sleep(METRICS_INTERVAL_SECONDS)


async def _set_deploy_state(user_id: str, job_id: str, state: dict[str, Any]) -> None:
    await redis_client.set(_deployment_key(user_id, job_id), json.dumps(state), ex=DEPLOY_STATE_TTL_SECONDS)


async def _get_deploy_state(user_id: str, job_id: str) -> dict[str, Any] | None:
    raw = await redis_client.get(_deployment_key(user_id, job_id))
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


async def _set_stop_requested(user_id: str, job_id: str) -> None:
    await redis_client.set(_deploy_stop_key(user_id, job_id), "1", ex=DEPLOY_STATE_TTL_SECONDS)


async def _is_stop_requested(user_id: str, job_id: str) -> bool:
    raw = await redis_client.get(_deploy_stop_key(user_id, job_id))
    return raw == "1"


async def _clear_deploy_state(user_id: str, job_id: str) -> None:
    await redis_client.delete(_deployment_key(user_id, job_id))
    await redis_client.delete(_deploy_stop_key(user_id, job_id))
