export interface Issue {
  line: number;
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion: string;
  doc_url?: string | null;
}

export interface RunnabilityMeta {
  runnable: boolean;
  reasons: string[];
  rules?: Record<string, boolean>;
}

export interface ResourceEstimateMeta {
  estimated_layers?: number;
  estimated_memory_mb?: number;
  estimated_cpu_millicores?: number;
  total_estimated_memory_mb?: number;
  total_estimated_cpu_millicores?: number;
  service_count?: number;
  explanation?: string;
  services?: Array<{
    name: string;
    estimated_memory_mb: number;
    estimated_cpu_millicores: number;
    has_build_context: boolean;
    image: string;
  }>;
}

export interface AnalysisResult {
  score: number;
  grade: string;
  line_count?: number;
  errors: Issue[];
  warnings: Issue[];
  suggestions: Issue[];
  securityIssues: Issue[];
  meta?: {
    runnability?: RunnabilityMeta;
    estimate?: ResourceEstimateMeta;
    [key: string]: unknown;
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

export type JobType = "dockerfile" | "compose" | "project";
export type JobStatus = "scanned" | "queued" | "running" | "done" | "failed";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  input_metadata: Record<string, unknown> & {
    filename?: string;
    dockerfiles?: string[];
    compose_files?: string[];
  };
  result: AnalysisResult | { message?: string } | null;
  created_at: string;
}

export interface PublicResearchJob {
  id: string;
  anonymized_submitter: string;
  type: JobType;
  status: JobStatus;
  public_metadata: Record<string, unknown>;
  public_result: Record<string, unknown> | null;
  created_at: string;
  score: number | null;
  grade: string | null;
}

export interface ResearchTimeBucket {
  bucket_date: string;
  count: number;
}

export interface ResearchSummary {
  total_jobs: number;
  count_by_type: Record<string, number>;
  count_by_status: Record<string, number>;
  jobs_last_7_days: number;
  avg_score: number | null;
  grade_distribution: Record<string, number>;
  daily_buckets: ResearchTimeBucket[];
}

export interface PaginatedResearchJobsResponse {
  items: PublicResearchJob[];
  total: number;
  limit: number;
  offset: number;
}

export interface JobEnqueueResponse {
  job_id: string;
  status: string;
}

export interface RuntimeContainerState {
  id: string;
  name?: string | null;
  service?: string | null;
  image?: string | null;
  status?: string | null;
  health_status?: string | null;
  exit_code?: number | null;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  restart_count?: number | null;
  oom_killed?: boolean | null;
  last_logs?: string[] | null;
}

export type DeployRuntimeState =
  | "none"
  | "running"
  | "partial"
  | "exited"
  | "failed"
  | "unhealthy"
  | "stopping"
  | "stopped_by_user"
  | "cleanup_completed";

export interface DeployStatusResponse {
  active: boolean;
  runtime_state?: DeployRuntimeState;
  container_ids: string[];
  project_name: string | null;
  containers?: RuntimeContainerState[];
  running_count?: number;
  exited_count?: number;
  unhealthy_count?: number;
  stopped_by_user?: boolean;
  stop_reason?: string | null;
  exit_reason?: string | null;
  can_retry_runtime?: boolean;
}

export interface DindIpResponse {
  dind_ip: string | null;
}

export interface ImageBuildResult {
  dockerfile_path: string;
  build_context: string;
  image_tag: string;
  image_id?: string | null;
  status: "success" | "failed" | "skipped";
  build_started_at?: string | null;
  build_finished_at?: string | null;
  build_duration_ms?: number | null;
  image_size_bytes?: number | null;
  image_size_human?: string | null;
  layer_count?: number | null;
  base_image?: string | null;
  exposed_ports?: string[];
  env_keys?: string[];
  labels?: Record<string, string>;
  entrypoint?: string[] | null;
  cmd?: string[] | null;
  user?: string | null;
  workdir?: string | null;
  architecture?: string | null;
  os?: string | null;
  created_at?: string | null;
  repo_tags?: string[];
  repo_digests?: string[];
  build_logs?: string[];
  error_message?: string | null;
}

export interface ApiKey {
  id: string;
  key_prefix: string;
  created_at: string;
}

export interface ApiKeyCreated {
  id: string;
  key: string;
  key_prefix: string;
}

export interface DomainEvent {
  event_name: string;
  user_id: string;
  job_id: string | null;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface ContainerMetricsPayload {
  container_id?: string;
  cpu_percent?: number;
  memory_bytes?: number;
  memory_percent?: number;
  uptime_seconds?: number;
  network_rx?: Record<string, unknown>;
  cpu?: {
    percent?: number;
    total_usage?: number;
    system_usage?: number;
    online_cpus?: number;
    throttling?: {
      periods?: number;
      throttled_periods?: number;
      throttled_time?: number;
    };
  };
  memory?: {
    usage_bytes?: number;
    limit_bytes?: number;
    percent?: number;
    cache_bytes?: number;
    rss_bytes?: number;
    mapped_file_bytes?: number;
    failcnt?: number;
  };
  network?: {
    interfaces?: Record<string, unknown>;
    totals?: {
      rx_bytes?: number;
      tx_bytes?: number;
      rx_packets?: number;
      tx_packets?: number;
      rx_errors?: number;
      tx_errors?: number;
      rx_dropped?: number;
      tx_dropped?: number;
    };
  };
  io?: {
    read_bytes?: number;
    write_bytes?: number;
  };
  pids?: {
    current?: number;
  };
  container?: {
    id?: string;
    name?: string;
    image?: string;
    command?: string[];
    created_at?: string;
    started_at?: string;
    status?: string;
    health_status?: string;
    restart_count?: number;
    ip_address?: string;
    ports?: Array<{
      container_port?: string;
      host_bindings?: Array<{
        host_ip?: string;
        host_port?: string;
      }>;
    }>;
    mounts?: Array<{
      type?: string;
      source?: string;
      destination?: string;
      mode?: string;
      rw?: boolean;
    }>;
  };
}

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? ApiError.deriveMessage(status, detail));
    this.status = status;
    this.detail = detail;
    this.name = "ApiError";
  }

  static deriveMessage(status: number, detail: unknown): string {
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail;
    }
    if (detail && typeof detail === "object") {
      const maybeMessage = (detail as { message?: unknown }).message;
      if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
        return maybeMessage;
      }
    }
    return `Request failed with status ${status}`;
  }

  get reasons(): string[] | undefined {
    if (this.detail && typeof this.detail === "object") {
      const reasons = (this.detail as { reasons?: unknown }).reasons;
      if (Array.isArray(reasons)) {
        return reasons.filter((r): r is string => typeof r === "string");
      }
    }
    return undefined;
  }
}

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const API_BASE_URL =
  rawApiBaseUrl === undefined ? "http://localhost:8000" : rawApiBaseUrl.trim();
const ACCESS_TOKEN_KEY = "dpa_access_token";
const REFRESH_TOKEN_KEY = "dpa_refresh_token";
const USER_KEY = "dpa_user";
const UNAUTHORIZED_EVENT = "dpa:unauthorized";

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function persistSession(authResponse: AuthResponse) {
  localStorage.setItem(ACCESS_TOKEN_KEY, authResponse.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, authResponse.refresh_token);
  localStorage.setItem(USER_KEY, JSON.stringify(authResponse.user));
}

export function persistTokens(tokens: { access_token: string; refresh_token: string }) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
}

export function persistUser(user: User) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function readUserFromStorage(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function emitUnauthorized() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
}

export function onUnauthorized(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  skipRefresh?: boolean;
}

let refreshPromise: Promise<AuthResponse> | null = null;

async function rawFetch(path: string, init: RequestOptions): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!init.skipAuth) {
    const token = getAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

async function parseError(response: Response): Promise<ApiError> {
  let detail: unknown = null;
  try {
    const payload = (await response.json()) as { detail?: unknown };
    detail = payload?.detail ?? payload;
  } catch {
    try {
      detail = await response.text();
    } catch {
      detail = null;
    }
  }
  return new ApiError(response.status, detail);
}

async function attemptRefresh(): Promise<AuthResponse | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await rawFetch("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
        skipAuth: true,
        skipRefresh: true,
      });
      if (!response.ok) {
        throw await parseError(response);
      }
      const auth = (await response.json()) as AuthResponse;
      persistSession(auth);
      return auth;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  try {
    return await refreshPromise;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  let response = await rawFetch(path, init);
  if (response.status === 401 && !init.skipRefresh && !init.skipAuth) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      response = await rawFetch(path, { ...init, skipRefresh: true });
    }
  }
  if (!response.ok) {
    const error = await parseError(response);
    if (error.status === 401 && !init.skipAuth) {
      clearSession();
      emitUnauthorized();
    }
    throw error;
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// ---------- auth ----------
export const auth = {
  async register(payload: { email: string; password: string }): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
      skipAuth: true,
    });
  },
  async login(payload: { email: string; password: string }): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
      skipAuth: true,
    });
  },
  async refresh(refreshToken: string): Promise<AuthResponse> {
    return request<AuthResponse>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
      skipAuth: true,
      skipRefresh: true,
    });
  },
  async me(): Promise<User> {
    return request<User>("/auth/me");
  },
};

// ---------- api keys ----------
export const apiKeys = {
  async list(): Promise<ApiKey[]> {
    return request<ApiKey[]>("/api/v1/users/me/api-keys");
  },
  async create(): Promise<ApiKeyCreated> {
    return request<ApiKeyCreated>("/api/v1/users/me/api-keys", { method: "POST" });
  },
  async revoke(keyId: string): Promise<void> {
    return request<void>(`/api/v1/users/me/api-keys/${keyId}`, { method: "DELETE" });
  },
};

// ---------- jobs / history ----------
export const jobs = {
  async list(): Promise<Job[]> {
    return request<Job[]>("/api/v1/users/me/jobs");
  },
  async history(): Promise<Job[]> {
    return request<Job[]>("/api/v1/users/me/history");
  },
  async get(jobId: string): Promise<Job> {
    return request<Job>(`/api/v1/users/me/jobs/${jobId}`);
  },
  async getEvents(jobId: string): Promise<Job> {
    return request<Job>(`/api/v1/users/me/jobs/${jobId}/events`);
  },
  async delete(jobId: string): Promise<void> {
    return request<void>(`/api/v1/users/me/jobs/${jobId}`, { method: "DELETE" });
  },
};

export const research = {
  async summary(chartDays = 90): Promise<ResearchSummary> {
    const q = new URLSearchParams({ chart_days: String(chartDays) });
    return request<ResearchSummary>(`/api/v1/research/summary?${q}`);
  },
  async jobs(params: {
    limit?: number;
    offset?: number;
    job_type?: string;
    status?: string;
    created_after?: string;
    created_before?: string;
  }): Promise<PaginatedResearchJobsResponse> {
    const q = new URLSearchParams();
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.offset != null) q.set("offset", String(params.offset));
    if (params.job_type) q.set("job_type", params.job_type);
    if (params.status) q.set("status", params.status);
    if (params.created_after) q.set("created_after", params.created_after);
    if (params.created_before) q.set("created_before", params.created_before);
    const suffix = q.toString();
    return request<PaginatedResearchJobsResponse>(
      `/api/v1/research/jobs${suffix ? `?${suffix}` : ""}`,
    );
  },
  async get(jobId: string): Promise<PublicResearchJob> {
    return request<PublicResearchJob>(`/api/v1/research/jobs/${jobId}`);
  },
};

// ---------- workflows ----------
export const dockerfile = {
  async analyze(file: File): Promise<JobEnqueueResponse> {
    const formData = new FormData();
    formData.append("file", file);
    return request<JobEnqueueResponse>("/api/v1/dockerfile/analyze", {
      method: "POST",
      body: formData,
    });
  },
};

export const dockcompose = {
  async analyze(file: File): Promise<JobEnqueueResponse> {
    const formData = new FormData();
    formData.append("file", file);
    return request<JobEnqueueResponse>("/api/v1/compose/analyze", {
      method: "POST",
      body: formData,
    });
  },
  async deploy(payload: {
    job_id: string;
    run_stack: boolean;
  }): Promise<JobEnqueueResponse> {
    return request<JobEnqueueResponse>("/api/v1/compose/deploy", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async deployStatus(jobId: string): Promise<DeployStatusResponse> {
    return request<DeployStatusResponse>(`/api/v1/compose/deploy/status/${jobId}`);
  },
  async dindIp(): Promise<DindIpResponse> {
    return request<DindIpResponse>("/api/v1/compose/deploy/dind-ip");
  },
  async stopDeploy(payload: {
    job_id: string;
    remove_volumes?: boolean;
  }): Promise<JobEnqueueResponse> {
    return request<JobEnqueueResponse>("/api/v1/compose/deploy/stop", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};

// ---------- project types ----------

export interface PerFileAnalysisResult {
  file_path: string;
  file_type: "dockerfile" | "compose";
  score: number;
  grade: string;
  errors_count: number;
  warnings_count: number;
  security_count: number;
  suggestions_count: number;
  errors: Issue[];
  warnings: Issue[];
  securityIssues: Issue[];
  suggestions: Issue[];
  meta?: Record<string, unknown>;
  source_preview?: string | null;
}

export interface ServiceBuildMapping {
  service: string;
  compose_file: string;
  build_context?: string | null;
  dockerfile?: string | null;
  resolved_dockerfile?: string | null;
  can_build: boolean;
  can_run: boolean;
  issues: string[];
}

export interface ProjectSummary {
  total_files_analyzed: number;
  dockerfiles_analyzed: number;
  compose_files_analyzed: number;
  total_errors: number;
  total_warnings: number;
  total_security_issues: number;
  total_suggestions: number;
  best_score_file?: string | null;
  worst_score_file?: string | null;
}

export interface ProjectAnalysisResult extends AnalysisResult {
  overall_score: number;
  overall_grade: string;
  per_file_results: PerFileAnalysisResult[];
  service_mappings: ServiceBuildMapping[];
  project_summary: ProjectSummary;
  project_recommendations: string[];
  image_build_results?: ImageBuildResult[];
}

export const project = {
  async upload(file: File): Promise<JobEnqueueResponse> {
    const formData = new FormData();
    formData.append("file", file);
    return request<JobEnqueueResponse>("/api/v1/project/upload", {
      method: "POST",
      body: formData,
    });
  },
  async setPrimaryCompose(projectId: string, primaryComposeFile: string): Promise<JobEnqueueResponse> {
    return request<JobEnqueueResponse>(`/api/v1/project/${projectId}/primary-compose`, {
      method: "PATCH",
      body: JSON.stringify({ primary_compose_file: primaryComposeFile }),
    });
  },
};

// ---------- websockets ----------
function wsBase(): string {
  if (!API_BASE_URL) {
    if (typeof window === "undefined") return "";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }
  return API_BASE_URL.replace(/^http:\/\//, "ws://").replace(/^https:\/\//, "wss://");
}

export const ws = {
  connectJob(jobId: string): WebSocket {
    const token = getAccessToken() ?? "";
    return new WebSocket(`${wsBase()}/ws/jobs/${jobId}?token=${encodeURIComponent(token)}`);
  },
  connectUserContainer(userId: string, containerId: string): WebSocket {
    const token = getAccessToken() ?? "";
    return new WebSocket(
      `${wsBase()}/ws/users/${userId}/containers/${containerId}?token=${encodeURIComponent(token)}`,
    );
  },
};

// ---------- health ----------
export async function checkHealth(): Promise<{ status: string }> {
  return request<{ status: string }>("/health", { skipAuth: true });
}
