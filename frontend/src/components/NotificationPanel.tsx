import { useState } from "react";
import { Bell, Check, Trash2, X } from "lucide-react";
import {
  useNotifications,
  markAllRead,
  clearNotifications,
  type AppNotification,
} from "../utils/notifications";

function typeIcon(type: AppNotification["type"]) {
  switch (type) {
    case "success":
      return "🟢";
    case "warning":
      return "🟡";
    case "error":
      return "🔴";
    default:
      return "🔵";
  }
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function NotificationPanel() {
  const { notifications, unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);

  const handleToggle = () => {
    if (!open && unreadCount > 0) {
      markAllRead();
    }
    setOpen(!open);
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        className="relative p-1.5 rounded-md text-slate-400 hover:text-white transition-colors"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-8 z-50 w-80 max-h-96 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
              <span className="text-xs font-semibold text-slate-300">Notifications</span>
              <div className="flex items-center gap-1">
                {notifications.length > 0 && (
                  <>
                    <button
                      onClick={() => { markAllRead(); }}
                      className="p-1 text-slate-500 hover:text-slate-300"
                      title="Mark all read"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => { clearNotifications(); }}
                      className="p-1 text-slate-500 hover:text-red-400"
                      title="Clear all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-slate-500">
                  No notifications yet
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-3 py-2 border-b border-slate-800 last:border-0 ${
                      !n.read ? "bg-slate-800/50" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-xs mt-0.5">{typeIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-200">{n.title}</div>
                        <div className="text-xs text-slate-400 truncate">{n.message}</div>
                        <div className="text-[10px] text-slate-600 mt-0.5">{timeAgo(n.timestamp)}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
