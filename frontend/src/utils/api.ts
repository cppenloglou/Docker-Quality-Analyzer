export interface Issue {
  line: number;
  code: string;
  severity: string;
  message: string;
  suggestion: string;
}

export interface AnalysisResult {
  score: number;
  grade: string;
  errors: Issue[];
  warnings: Issue[];
  suggestions: Issue[];
  securityIssues: Issue[];
  meta?: {
    runnability?: {
      runnable: boolean;
      reasons: string[];
      rules?: Record<string, boolean>;
    };
  };
}

export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  user: User;
}

export interface Job {
  id: string;
  type: "dockerfile" | "compose" | "project";
  status: "queued" | "running" | "done" | "failed";
  input_metadata: Record<string, unknown>;
  result: AnalysisResult | { message?: string } | null;
  created_at: string;
}

interface JobEnqueueResponse {
  job_id: string;
  status: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8000";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const auth = localStorage.getItem("dpa_access_token");
  if (auth) {
    headers.set("Authorization", `Bearer ${auth}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const fallbackError = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail || fallbackError);
    } catch {
      throw new Error(fallbackError);
    }
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function persistSession(auth: AuthResponse) {
  localStorage.setItem("dpa_access_token", auth.access_token);
  localStorage.setItem("dpa_refresh_token", auth.refresh_token);
  localStorage.setItem("dpa_user", JSON.stringify(auth.user));
}

export function clearSession() {
  localStorage.removeItem("dpa_access_token");
  localStorage.removeItem("dpa_refresh_token");
  localStorage.removeItem("dpa_user");
}

export function readUserFromStorage(): User | null {
  const raw = localStorage.getItem("dpa_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export async function register(payload: { email: string; password: string }) {
  return request<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(payload) });
}

export async function login(payload: { email: string; password: string }) {
  return request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(payload) });
}

export async function enqueueDockerfileAnalysis(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<JobEnqueueResponse>("/api/v1/dockerfile/analyze", {
    method: "POST",
    body: formData,
  });
}

export async function enqueueComposeAnalysis(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<JobEnqueueResponse>("/api/v1/compose/analyze", {
    method: "POST",
    body: formData,
  });
}

export async function deployCompose(payload: {
  job_id: string;
  push_public_images: boolean;
  run_stack: boolean;
}) {
  return request<JobEnqueueResponse>("/api/v1/compose/deploy", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function uploadProjectArchive(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<JobEnqueueResponse>("/api/v1/project/upload", {
    method: "POST",
    body: formData,
  });
}

export async function getJobs() {
  return request<Job[]>("/api/v1/users/me/jobs");
}

export async function getHistory() {
  return request<Job[]>("/api/v1/users/me/history");
}

export async function getJob(jobId: string) {
  return request<Job>(`/api/v1/users/me/jobs/${jobId}`);
}

export function connectJobSocket(jobId: string): WebSocket {
  const token = localStorage.getItem("dpa_access_token");
  const wsUrl = API_BASE_URL.replace("http://", "ws://").replace("https://", "wss://");
  return new WebSocket(`${wsUrl}/ws/jobs/${jobId}?token=${encodeURIComponent(token || "")}`);
}

export function connectContainerMetricsSocket(containerId: string): WebSocket {
  const wsUrl = API_BASE_URL.replace("http://", "ws://").replace("https://", "wss://");
  return new WebSocket(`${wsUrl}/ws/metrics/${containerId}`);
}
