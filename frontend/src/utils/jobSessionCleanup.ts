import { clearSessionStopping, SESSION_STOPPING_KEY } from "./deploySession";
import { clearState } from "./monitoringState";

const REPLAY_KEY_PREFIX = "dqa:notifications:replay:";

function replayStateStorageKey(userId: string): string {
  return `${REPLAY_KEY_PREFIX}${userId}`;
}

/** Remove browser session/local state tied to a deleted analysis job. */
export function clearJobSessionState(jobId: string, userId?: string | null): void {
  if (typeof window === "undefined") return;

  try {
    if (sessionStorage.getItem("analysisJobId") === jobId) {
      sessionStorage.removeItem("analysisJobId");
    }
    if (sessionStorage.getItem("projectJobId") === jobId) {
      sessionStorage.removeItem("projectJobId");
    }
    clearState(`dqa:execution:${jobId}`);
    clearState(`dqa:monitoring:${jobId}`);
    sessionStorage.removeItem(`dqa:resubmitRequired:${jobId}`);
    sessionStorage.removeItem(`${SESSION_STOPPING_KEY}:${jobId}`);
    clearSessionStopping(jobId);

    if (userId) {
      const key = replayStateStorageKey(userId);
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const state = JSON.parse(raw) as Record<string, unknown>;
          if (jobId in state) {
            delete state[jobId];
            localStorage.setItem(key, JSON.stringify(state));
          }
        } catch {
          // ignore malformed replay state
        }
      }
    }
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}
