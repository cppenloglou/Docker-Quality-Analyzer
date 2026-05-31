import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FileCode, History, Home, KeyRound, LogOut, BarChart3 } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { NotificationEventBridge } from "./NotificationEventBridge";
import { NotificationPanel } from "./NotificationPanel";
import { Button } from "./ui/button";
import { checkHealth } from "../utils/api";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        await checkHealth();
        if (!cancelled) setApiHealthy(true);
      } catch {
        if (!cancelled) setApiHealthy(false);
      }
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const navLinkClass = (path: string) =>
    `flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
      location.pathname === path || location.pathname.startsWith(`${path}/`)
        ? "bg-blue-500/10 text-blue-400"
        : "text-slate-400 hover:text-slate-200"
    }`;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <NotificationEventBridge />
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <FileCode className="w-6 h-6 text-blue-500" />
              <span className="text-xl font-semibold text-white">
                Docker Analyzer
              </span>
            </Link>

            <nav className="flex items-center gap-4">
              <Link to="/" className={navLinkClass("/")}>
                <Home className="w-4 h-4" />
                <span className="hidden sm:inline">Home</span>
              </Link>
              <Link to="/history" className={navLinkClass("/history")}>
                <History className="w-4 h-4" />
                <span className="hidden sm:inline">History</span>
              </Link>
              <Link to="/research" className={navLinkClass("/research")}>
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">Research</span>
              </Link>
              <Link to="/settings/api-keys" className={navLinkClass("/settings/api-keys")}>
                <KeyRound className="w-4 h-4" />
                <span className="hidden sm:inline">API Keys</span>
              </Link>
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <NotificationPanel />
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    apiHealthy === null
                      ? "bg-slate-500"
                      : apiHealthy
                        ? "bg-emerald-500"
                        : "bg-red-500"
                  }`}
                  title={
                    apiHealthy === null
                      ? "Checking API..."
                      : apiHealthy
                        ? "API reachable"
                        : "API unreachable"
                  }
                />
                <span className="text-xs text-slate-400 hidden md:inline truncate max-w-[160px]">
                  {user?.email}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={logout}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <LogOut className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Logout</span>
                </Button>
              </div>
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 flex-1">{children}</main>

      <footer className="border-t border-slate-800 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-slate-400">
          Docker Analyzer - Lint and analyze your Docker configurations
        </div>
      </footer>
    </div>
  );
}
