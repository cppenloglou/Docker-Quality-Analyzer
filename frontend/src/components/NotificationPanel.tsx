import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, Bell, Check, CheckCircle2, Info, Trash2, X } from "lucide-react";
import {
  useNotifications,
  markAllRead,
  markNotificationRead,
  clearNotifications,
  type AppNotification,
} from "../utils/notifications";

function TypeIcon({ type }: { type: AppNotification["type"] }) {
  switch (type) {
    case "success":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case "warning":
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
    case "error":
      return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
    default:
      return <Info className="w-3.5 h-3.5 text-sky-400" />;
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
  const [activeFilter, setActiveFilter] = useState<"unread" | "all">("all");
  const panelId = "notification-panel";
  const filteredNotifications =
    activeFilter === "unread"
      ? notifications.filter((notification) => !notification.read)
      : notifications;

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setActiveFilter(unreadCount > 0 ? "unread" : "all");
      }
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        className={`relative h-9 w-9 rounded-lg border transition-colors ${
          unreadCount > 0
            ? "text-sky-300 border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/15"
            : "text-slate-300 border-slate-700 bg-slate-900 hover:bg-slate-800"
        } ${open ? "ring-2 ring-sky-500/30" : ""}`}
        title={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <Bell className="w-4 h-4 mx-auto" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-sky-500 text-white text-[10px] font-semibold border-2 border-slate-950 inline-flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
        <span className="sr-only">
          {unreadCount > 0
            ? `${unreadCount} unread notifications`
            : "No unread notifications"}
        </span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            id={panelId}
            role="dialog"
            aria-label="Notifications panel"
            className="absolute right-0 top-11 z-50 w-96 max-w-[calc(100vw-1rem)] max-h-[28rem] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-100">Notifications</div>
                <div className="text-[11px] text-slate-400">
                  {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {notifications.length > 0 && unreadCount > 0 && (
                  <button
                    onClick={() => { markAllRead(); }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-300 hover:text-white hover:bg-slate-800"
                    title="Mark all as read"
                  >
                    <Check className="w-3 h-3" />
                    Mark all
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={() => { clearNotifications(); }}
                    className="p-1.5 rounded-md text-slate-500 hover:text-red-300 hover:bg-red-500/10"
                    title="Clear all notifications"
                    aria-label="Clear all notifications"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                  aria-label="Close notifications"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {notifications.length > 0 && (
              <div className="px-3 py-2 border-b border-slate-800">
                <div className="inline-flex rounded-md bg-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => setActiveFilter("unread")}
                    className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                      activeFilter === "unread"
                        ? "bg-slate-700 text-slate-100"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Unread ({unreadCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveFilter("all")}
                    className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                      activeFilter === "all"
                        ? "bg-slate-700 text-slate-100"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    All ({notifications.length})
                  </button>
                </div>
              </div>
            )}
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-slate-300">No notifications yet</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Updates about analysis and runtime events will appear here.
                  </p>
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Check className="w-7 h-7 text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm text-slate-200">No unread notifications</p>
                  <p className="text-xs text-slate-500 mt-1">
                    You are all caught up. Switch to All to review recent updates.
                  </p>
                </div>
              ) : (
                filteredNotifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 border-b border-slate-800/80 last:border-0 cursor-pointer hover:bg-slate-800/40 ${
                      !n.read ? "bg-slate-800/25 border-l-2 border-l-sky-400" : ""
                    }`}
                    onClick={() => markNotificationRead(n.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        markNotificationRead(n.id);
                      }
                    }}
                    aria-label={`Notification: ${n.title}. ${n.read ? "Read" : "Unread"}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5">
                        <TypeIcon type={n.type} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-100 flex items-center gap-2">
                          <span className="truncate">{n.title}</span>
                          {!n.read && (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" />
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                          {n.message}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1.5">{timeAgo(n.timestamp)}</div>
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
