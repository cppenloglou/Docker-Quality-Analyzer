import { useEffect, useState } from "react";
import { readUserFromStorage } from "./api";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  dedupe_key?: string;
}

const STORAGE_KEY_PREFIX = "dqa:notifications";
const MAX_NOTIFICATIONS = 50;

let listeners: Array<() => void> = [];

function storageKeyForUser(userId: string | null | undefined): string {
  return userId ? `${STORAGE_KEY_PREFIX}:${userId}` : STORAGE_KEY_PREFIX;
}

function activeStorageKey(): string {
  const user = readUserFromStorage();
  return storageKeyForUser(user?.id);
}

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

function loadNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(activeStorageKey());
    if (!raw) return [];
    return JSON.parse(raw) as AppNotification[];
  } catch {
    return [];
  }
}

function saveNotifications(notifications: AppNotification[]) {
  localStorage.setItem(activeStorageKey(), JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
}

export interface NotificationOptions {
  dedupeKey?: string;
  dedupeWindowMs?: number;
}

export function pushNotification(
  type: NotificationType,
  title: string,
  message: string,
  options?: NotificationOptions,
) {
  const notifications = loadNotifications();
  const dedupeWindowMs = options?.dedupeWindowMs ?? 60_000;
  if (options?.dedupeKey) {
    const now = Date.now();
    const existing = notifications.find(
      (n) => n.dedupe_key === options.dedupeKey && now - n.timestamp <= dedupeWindowMs,
    );
    if (existing) {
      notifyListeners();
      return;
    }
  }
  const entry: AppNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    message,
    timestamp: Date.now(),
    read: false,
    dedupe_key: options?.dedupeKey,
  };
  notifications.unshift(entry);
  saveNotifications(notifications);
  notifyListeners();
}

export function markAllRead() {
  const notifications = loadNotifications();
  notifications.forEach((n) => { n.read = true; });
  saveNotifications(notifications);
  notifyListeners();
}

export function markNotificationRead(notificationId: string) {
  const notifications = loadNotifications();
  const target = notifications.find((n) => n.id === notificationId);
  if (!target || target.read) return;
  target.read = true;
  saveNotifications(notifications);
  notifyListeners();
}

export function clearNotifications() {
  localStorage.removeItem(activeStorageKey());
  notifyListeners();
}

export function clearNotificationsForUser(userId: string | null | undefined) {
  localStorage.removeItem(storageKeyForUser(userId));
  notifyListeners();
}

export function useNotifications(): { notifications: AppNotification[]; unreadCount: number } {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadNotifications);

  useEffect(() => {
    const update = () => setNotifications(loadNotifications());
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === activeStorageKey() ||
        event.key.startsWith(`${STORAGE_KEY_PREFIX}:`) ||
        event.key === STORAGE_KEY_PREFIX
      ) {
        update();
      }
    };

    listeners.push(update);
    window.addEventListener("storage", handleStorage);

    return () => {
      listeners = listeners.filter((fn) => fn !== update);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;
  return { notifications, unreadCount };
}
