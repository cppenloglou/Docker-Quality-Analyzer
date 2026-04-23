import pytest

from app.workers.tasks import run_compose_deploy


@pytest.mark.asyncio
async def test_run_compose_deploy_emits_expected_events(monkeypatch: pytest.MonkeyPatch):
    emitted_events = []

    async def fake_publish(event):
        emitted_events.append(event)

    monkeypatch.setattr("app.workers.tasks.publish_event", fake_publish)

    result = await run_compose_deploy(
        None,
        {
            "user_id": "user-1",
            "job_id": "job-1",
            "push_public_images": True,
            "run_stack": True,
        },
    )

    assert result["status"] == "deployment workflow acknowledged"
    event_names = [event.event_name for event in emitted_events]
    assert "docker.image.pushed" in event_names
    assert "container.started" in event_names
    assert "container.metrics" in event_names

    started_event = next(event for event in emitted_events if event.event_name == "container.started")
    metrics_event = next(event for event in emitted_events if event.event_name == "container.metrics")
    assert started_event.payload["container_id"] == "web-container"
    assert metrics_event.payload["container_id"] == "web-container"
