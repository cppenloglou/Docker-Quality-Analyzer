import pytest

from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(database_path=str(tmp_path / "test.db"))
    app.config.update(TESTING=True)
    return app.test_client()


def test_homepage_loads(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"Python Mini Task App" in response.data
    assert b"Flask + SQLite + Docker" in response.data


def test_health_endpoint(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "ok"
    assert "tasks" in data


def test_create_task_api(client):
    response = client.post("/api/tasks", json={"title": "Test task", "priority": "high"})
    assert response.status_code == 201
    data = response.get_json()
    assert data["title"] == "Test task"
    assert data["priority"] == "high"
    assert data["done"] is False


def test_update_task_api(client):
    created = client.post("/api/tasks", json={"title": "Patch me"}).get_json()
    response = client.patch(f"/api/tasks/{created['id']}", json={"done": True, "priority": "low"})
    assert response.status_code == 200
    data = response.get_json()
    assert data["done"] is True
    assert data["priority"] == "low"


def test_delete_task_api(client):
    created = client.post("/api/tasks", json={"title": "Delete me"}).get_json()
    response = client.delete(f"/api/tasks/{created['id']}")
    assert response.status_code == 204


def test_stats_endpoint(client):
    response = client.get("/api/stats")
    assert response.status_code == 200
    data = response.get_json()
    assert data["total"] >= 3
    assert "remaining" in data
