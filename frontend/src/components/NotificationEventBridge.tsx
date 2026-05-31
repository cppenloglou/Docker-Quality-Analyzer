import { useEffect, useRef } from "react";

import { useAuth } from "../auth/AuthProvider";
import { jobs, ws, type DomainEvent, type JobStatus } from "../utils/api";
import { pushNotification } from "../utils/notifications";

const RECENT_JOB_WINDOW_MS = 15 * 60 * 1000;

function replayStateStorageKey(userId: string): string {
  return `dqa:notifications:replay:${userId}`;
}

function loadReplayState(userId: string): Record<string, JobStatus> {
  try {
    const raw = localStorage.getItem(replayStateStorageKey(userId));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, JobStatus>;
  } catch {
    return {};
  }
}

function saveReplayState(userId: string, state: Record<string, JobStatus>) {
  localStorage.setItem(replayStateStorageKey(userId), JSON.stringify(state));
}

function notifyFromEvent(event: DomainEvent) {
  const payload = event.payload ?? {};
  const jobSuffix = event.job_id ? event.job_id.slice(0, 8) : "unknown";
  const messageFromPayload =
    typeof payload.message === "string" && payload.message.trim().length > 0
      ? payload.message
      : undefined;

  switch (event.event_name) {
    case "user.analysis.completed":
    case "project.analysis_completed":
      pushNotification(
        "success",
        "Analysis Complete",
        `Job ${jobSuffix} finished successfully`,
        { dedupeKey: `analysis.completed:${event.job_id ?? "none"}` },
      );
      return;
    case "user.analysis.failed":
    case "project.analysis_failed":
      pushNotification(
        "error",
        "Analysis Failed",
        messageFromPayload ?? `Job ${jobSuffix} failed`,
        { dedupeKey: `analysis.failed:${event.job_id ?? "none"}` },
      );
      return;
    case "container.started":
      pushNotification(
        "success",
        "Containers Running",
        "Compose containers started successfully",
        { dedupeKey: `container.started:${event.job_id ?? "none"}` },
      );
      return;
    case "container.stopped":
    case "project.runtime_stopped":
      pushNotification(
        "warning",
        "Runtime Stopped",
        "Containers have stopped",
        { dedupeKey: `${event.event_name}:${event.job_id ?? "none"}` },
      );
      return;
    case "deploy.cleanup_started":
      pushNotification(
        "info",
        "Cleanup Started",
        "Removing containers created by the failed deploy",
        { dedupeKey: `${event.event_name}:${event.job_id ?? "none"}` },
      );
      return;
    case "deploy.cleanup_completed":
      pushNotification(
        "success",
        "Cleanup Completed",
        "Failed deploy containers were removed from the sandbox",
        { dedupeKey: `${event.event_name}:${event.job_id ?? "none"}` },
      );
      return;
    default:
      return;
  }
}

export function NotificationEventBridge() {
  const { user } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByEffect = false;
    let replayState = loadReplayState(user.id);

    const reconcileMissedJobOutcomes = async () => {
      try {
        const allJobs = await jobs.list();
        const now = Date.now();
        const nextReplayState: Record<string, JobStatus> = {};

        for (const job of allJobs) {
          const createdAt = Date.parse(job.created_at);
          const isRecent = Number.isFinite(createdAt) && now - createdAt <= RECENT_JOB_WINDOW_MS;
          const previousStatus = replayState[job.id];
          const statusChanged = previousStatus != null && previousStatus !== job.status;
          const isFreshTerminal =
            previousStatus == null && isRecent && (job.status === "done" || job.status === "failed");

          if ((statusChanged || isFreshTerminal) && job.status === "done") {
            pushNotification(
              "success",
              "Analysis Complete",
              `Job ${job.id.slice(0, 8)} finished successfully`,
              { dedupeKey: `analysis.completed:${job.id}`, dedupeWindowMs: 12 * 60 * 60 * 1000 },
            );
          } else if ((statusChanged || isFreshTerminal) && job.status === "failed") {
            const resultMessage =
              job.result && typeof job.result === "object" && "message" in job.result
                ? job.result.message
                : null;
            pushNotification(
              "error",
              "Analysis Failed",
              typeof resultMessage === "string" && resultMessage.trim()
                ? resultMessage
                : `Job ${job.id.slice(0, 8)} failed`,
              { dedupeKey: `analysis.failed:${job.id}`, dedupeWindowMs: 12 * 60 * 60 * 1000 },
            );
          }

          nextReplayState[job.id] = job.status;
        }

        replayState = nextReplayState;
        saveReplayState(user.id, nextReplayState);
      } catch {
        // Non-blocking reconciliation best effort only.
      }
    };

    const connect = () => {
      if (closedByEffect) return;
      const socket = ws.connectUserEvents(user.id);
      socketRef.current = socket;
      void reconcileMissedJobOutcomes();

      socket.onmessage = (rawEvent) => {
        try {
          const event = JSON.parse(rawEvent.data as string) as DomainEvent;
          notifyFromEvent(event);
        } catch {
          // ignore malformed payloads
        }
      };

      socket.onclose = () => {
        if (closedByEffect) return;
        reconnectTimer = setTimeout(connect, 2000);
      };
    };

    connect();
    return () => {
      closedByEffect = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          // noop
        }
        socketRef.current = null;
      }
    };
  }, [user?.id]);

  return null;
}
