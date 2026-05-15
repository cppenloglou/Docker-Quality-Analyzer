from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, redirect, render_template, request, url_for


def create_app(database_path: str | None = None) -> Flask:
    app = Flask(__name__)
    app.config["DATABASE_PATH"] = database_path or os.getenv("DATABASE_PATH", "/data/tasks.db")
    app.config["APP_ENV"] = os.getenv("APP_ENV", "development")

    @app.before_request
    def ensure_database() -> None:
        init_db(app.config["DATABASE_PATH"])

    @app.get("/")
    def index():
        tasks = list_tasks(app.config["DATABASE_PATH"])
        remaining = sum(not task["done"] for task in tasks)
        completed = len(tasks) - remaining
        return render_template(
            "index.html",
            tasks=tasks,
            remaining=remaining,
            completed=completed,
            total=len(tasks),
            app_env=app.config["APP_ENV"],
        )

    @app.post("/tasks")
    def create_task_form():
        title = request.form.get("title", "").strip()
        priority = request.form.get("priority", "normal").strip() or "normal"
        if title:
            create_task(app.config["DATABASE_PATH"], title=title, priority=priority)
        return redirect(url_for("index"))

    @app.post("/tasks/<int:task_id>/toggle")
    def toggle_task_form(task_id: int):
        toggle_task(app.config["DATABASE_PATH"], task_id)
        return redirect(url_for("index"))

    @app.post("/tasks/<int:task_id>/delete")
    def delete_task_form(task_id: int):
        delete_task(app.config["DATABASE_PATH"], task_id)
        return redirect(url_for("index"))

    @app.get("/api/tasks")
    def api_list_tasks():
        return jsonify(list_tasks(app.config["DATABASE_PATH"]))

    @app.post("/api/tasks")
    def api_create_task():
        data = request.get_json(silent=True) or {}
        title = str(data.get("title", "")).strip()
        priority = str(data.get("priority", "normal")).strip() or "normal"
        if not title:
            return jsonify({"error": "title is required"}), 400
        task = create_task(app.config["DATABASE_PATH"], title=title, priority=priority)
        return jsonify(task), 201

    @app.patch("/api/tasks/<int:task_id>")
    def api_update_task(task_id: int):
        data = request.get_json(silent=True) or {}
        task = update_task(
            app.config["DATABASE_PATH"],
            task_id=task_id,
            title=data.get("title"),
            priority=data.get("priority"),
            done=data.get("done"),
        )
        if task is None:
            return jsonify({"error": "task not found"}), 404
        return jsonify(task)

    @app.delete("/api/tasks/<int:task_id>")
    def api_delete_task(task_id: int):
        deleted = delete_task(app.config["DATABASE_PATH"], task_id)
        if not deleted:
            return jsonify({"error": "task not found"}), 404
        return "", 204

    @app.get("/api/stats")
    def api_stats():
        tasks = list_tasks(app.config["DATABASE_PATH"])
        completed = sum(task["done"] for task in tasks)
        return jsonify(
            {
                "total": len(tasks),
                "completed": completed,
                "remaining": len(tasks) - completed,
                "database": app.config["DATABASE_PATH"],
                "environment": app.config["APP_ENV"],
            }
        )

    @app.get("/health")
    def health():
        try:
            init_db(app.config["DATABASE_PATH"])
            task_count = len(list_tasks(app.config["DATABASE_PATH"]))
        except Exception as exc:  # pragma: no cover - defensive health response
            return jsonify({"status": "error", "detail": str(exc)}), 500
        return jsonify({"status": "ok", "tasks": task_count, "environment": app.config["APP_ENV"]})

    return app


def connect(database_path: str) -> sqlite3.Connection:
    db_path = Path(database_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def init_db(database_path: str) -> None:
    with connect(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                priority TEXT NOT NULL DEFAULT 'normal',
                done INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        count = connection.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        if count == 0:
            connection.executemany(
                "INSERT INTO tasks (title, priority) VALUES (?, ?)",
                [
                    ("Run the app with Docker Compose", "high"),
                    ("Run tests inside the test container", "normal"),
                    ("Try the image-only compose file", "low"),
                ],
            )
        connection.commit()


def row_to_task(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "priority": row["priority"],
        "done": bool(row["done"]),
        "created_at": row["created_at"],
    }


def list_tasks(database_path: str) -> list[dict[str, Any]]:
    init_db(database_path)
    with connect(database_path) as connection:
        rows = connection.execute(
            "SELECT id, title, priority, done, created_at FROM tasks ORDER BY done ASC, id DESC"
        ).fetchall()
        return [row_to_task(row) for row in rows]


def create_task(database_path: str, title: str, priority: str = "normal") -> dict[str, Any]:
    init_db(database_path)
    with connect(database_path) as connection:
        cursor = connection.execute(
            "INSERT INTO tasks (title, priority) VALUES (?, ?)",
            (title, normalize_priority(priority)),
        )
        connection.commit()
        row = connection.execute(
            "SELECT id, title, priority, done, created_at FROM tasks WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return row_to_task(row)


def update_task(
    database_path: str,
    task_id: int,
    title: Any = None,
    priority: Any = None,
    done: Any = None,
) -> dict[str, Any] | None:
    init_db(database_path)
    current = get_task(database_path, task_id)
    if current is None:
        return None

    next_title = current["title"] if title is None else str(title).strip()
    next_priority = current["priority"] if priority is None else normalize_priority(str(priority))
    next_done = current["done"] if done is None else bool(done)
    if not next_title:
        next_title = current["title"]

    with connect(database_path) as connection:
        connection.execute(
            "UPDATE tasks SET title = ?, priority = ?, done = ? WHERE id = ?",
            (next_title, next_priority, int(next_done), task_id),
        )
        connection.commit()
    return get_task(database_path, task_id)


def get_task(database_path: str, task_id: int) -> dict[str, Any] | None:
    init_db(database_path)
    with connect(database_path) as connection:
        row = connection.execute(
            "SELECT id, title, priority, done, created_at FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        return row_to_task(row) if row else None


def toggle_task(database_path: str, task_id: int) -> dict[str, Any] | None:
    task = get_task(database_path, task_id)
    if task is None:
        return None
    return update_task(database_path, task_id, done=not task["done"])


def delete_task(database_path: str, task_id: int) -> bool:
    init_db(database_path)
    with connect(database_path) as connection:
        cursor = connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        connection.commit()
        return cursor.rowcount > 0


def normalize_priority(priority: str) -> str:
    value = priority.lower().strip()
    return value if value in {"low", "normal", "high"} else "normal"


app = create_app()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=os.getenv("APP_ENV") == "development")
