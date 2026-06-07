/** Session flags for in-flight compose deploy stop (survives route changes). */
export const SESSION_STOPPING_KEY = "dqa:containerStatus";

export function markSessionStopping(jobId: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SESSION_STOPPING_KEY, "stopping");
  sessionStorage.setItem(`${SESSION_STOPPING_KEY}:${jobId}`, "stopping");
}

export function clearSessionStopping(jobId?: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(SESSION_STOPPING_KEY);
  if (jobId) {
    sessionStorage.removeItem(`${SESSION_STOPPING_KEY}:${jobId}`);
  }
}

export function isSessionStopping(jobId?: string): boolean {
  if (typeof sessionStorage === "undefined") return false;
  if (sessionStorage.getItem(SESSION_STOPPING_KEY) === "stopping") return true;
  if (jobId && sessionStorage.getItem(`${SESSION_STOPPING_KEY}:${jobId}`) === "stopping") {
    return true;
  }
  return false;
}
