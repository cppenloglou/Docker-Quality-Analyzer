const STORAGE_VERSION = 1;

interface Envelope<T> {
  version: number;
  updatedAt: number;
  value: T;
}

function now() {
  return Date.now();
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadState<T>(key: string, ttlMs: number): T | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  const parsed = safeParse<Envelope<T>>(raw);
  if (!parsed) return null;
  if (parsed.version !== STORAGE_VERSION) return null;
  if (ttlMs > 0 && now() - parsed.updatedAt > ttlMs) return null;
  return parsed.value;
}

export function saveState<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  const payload: Envelope<T> = {
    version: STORAGE_VERSION,
    updatedAt: now(),
    value,
  };
  sessionStorage.setItem(key, JSON.stringify(payload));
}

export function clearState(key: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(key);
}
