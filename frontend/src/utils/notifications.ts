import { useEffect, useState } from "react";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

const STORAGE_KEY = "dqa:notifications";
const MAX_NOTIFICATIONS = 50;

let listeners: Array<() => void> = [];

function notifyListeners() {
  listeners.forEach((fn) => fn());
}

function loadNotifications(): AppNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AppNotification[];
  } catch {
    return [];
  }
}

function saveNotifications(notifications: AppNotification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
}

export function pushNotification(type: NotificationType, title: string, message: string) {
  const notifications = loadNotifications();
  const entry: AppNotification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    message,
    timestamp: Date.now(),
    read: false,
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

export function clearNotifications() {
  localStorage.removeItem(STORAGE_KEY);
  notifyListeners();
}

export function useNotifications(): { notifications: AppNotification[]; unreadCount: number } {
  const [notifications, setNotifications] = useState<AppNotification[]>(loadNotifications);

  useEffect(() => {
    const update = () => setNotifications(loadNotifications());
    listeners.push(update);
    return () => {
      listeners = listeners.filter((fn) => fn !== update);
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;
  return { notifications, unreadCount };
}
