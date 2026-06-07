import { Github } from "lucide-react";

const GITHUB_PROFILE_URL = "https://github.com/cppenloglou";
const GITHUB_USERNAME = "cppenloglou";

export function AppFooter() {
  return (
    <footer className="border-t border-slate-800 py-6">
      <div className="container mx-auto px-4 flex flex-col items-center gap-2 text-center text-sm text-slate-400">
        <p>Docker Analyzer — Lint and analyze your Docker configurations</p>
        <p className="flex flex-wrap items-center justify-center gap-x-1">
          <span>© {new Date().getFullYear()}</span>
          <a
            href={GITHUB_PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-slate-300 hover:text-blue-400 transition-colors"
          >
            <Github className="w-4 h-4" aria-hidden />
            {GITHUB_USERNAME}
          </a>
        </p>
      </div>
    </footer>
  );
}
