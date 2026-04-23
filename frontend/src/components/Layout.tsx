import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { FileCode, History, Home, LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "./ui/button";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <FileCode className="w-6 h-6 text-blue-500" />
              <span className="text-xl font-semibold text-white">
                Docker Analyzer
              </span>
            </Link>

            <nav className="flex items-center gap-6">
              <Link
                to="/"
                className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                  location.pathname === "/"
                    ? "bg-blue-500/10 text-blue-400"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Home className="w-4 h-4" />
                <span>Home</span>
              </Link>
              <Link
                to="/history"
                className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                  location.pathname === "/history"
                    ? "bg-blue-500/10 text-blue-400"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <History className="w-4 h-4" />
                <span>History</span>
              </Link>
              <div className="text-xs text-slate-400 hidden md:block">{user?.email}</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={logout}
                className="text-slate-400 hover:text-slate-200"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Logout
              </Button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">{children}</main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-16 py-6">
        <div className="container mx-auto px-4 text-center text-slate-500 text-sm">
          Docker Analyzer - Lint and analyze your Docker configurations
        </div>
      </footer>
    </div>
  );
}
