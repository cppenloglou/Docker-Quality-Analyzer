import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Mail } from "lucide-react";

import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { authCardVariants, authCardTransition, pageVariantsReduced, pageTransitionReduced } from "../components/motion/variants";
import { explainAuthError, type ExplainedAuthError } from "../utils/authErrors";

const authInputClass =
  "w-full rounded-lg border border-slate-700/80 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 shadow-inner shadow-black/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60";
const AUTH_REDIRECT_DELAY_MS = 250;

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ExplainedAuthError | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [success, setSuccess] = useState(false);

  const redirect = (location.state as { from?: string } | null)?.from || "/";
  const canSubmit = useMemo(
    () => email.trim().length > 3 && password.length >= 8,
    [email, password],
  );
  const submitHint = useMemo(() => {
    if (email.trim().length <= 3) return "Enter a valid email address.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  }, [email, password]);

  useEffect(() => {
    void import("./Register");
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSuccess(false);
    setError(null);
    try {
      await loginWithPassword(email, password);
      setSuccess(true);
      toast.success("Signed in");
      await new Promise((resolve) => setTimeout(resolve, AUTH_REDIRECT_DELAY_MS));
      navigate(redirect, { replace: true });
    } catch (err) {
      const explained = explainAuthError(err);
      setError(explained);
      toast.error(explained.message);
    }
  };

  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial="initial"
      animate="animate"
      variants={reducedMotion ? pageVariantsReduced : authCardVariants}
      transition={reducedMotion ? pageTransitionReduced : authCardTransition}
    >
      <Card className="w-full p-7 bg-slate-900/95 border-slate-800">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wide text-slate-500">Docker Quality Analyzer</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Sign in to your workspace</h1>
          <p className="mt-2 text-sm text-slate-400">
            Continue where you left off with analysis history, real-time runtime updates, and research insights.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Email address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@company.com"
                className={`${authInputClass} pl-9`}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                onKeyDown={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                onBlur={() => setCapsLockOn(false)}
                autoComplete="current-password"
                placeholder="Your secure password"
                className={`${authInputClass} pl-9 pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {capsLockOn && (
              <p className="text-xs text-amber-400">Caps Lock is on.</p>
            )}
          </div>
          {error && (
            <div className="rounded-lg border border-red-800/60 bg-red-950/30 p-3">
              <p className="text-sm font-medium text-red-300">{error.title}</p>
              <p className="mt-1 text-sm text-red-200/90">{error.message}</p>
              {error.tips.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-red-200/80">
                  {error.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-3 text-sm text-emerald-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>Signed in successfully. Redirecting...</span>
              </div>
            </div>
          )}
          <Button type="submit" disabled={success || !canSubmit} className="w-full">
            {success ? "Signed in" : "Sign in"}
            {!success && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
          {!canSubmit && !success && submitHint && (
            <p className="text-xs text-amber-400" aria-live="polite">
              {submitHint}
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            Tip: use the same account you used for prior analysis jobs to keep your history and notifications.
          </p>
        </form>
        <p className="mt-5 text-sm text-slate-400">
          New to Docker Quality Analyzer?{" "}
          <Link className="text-sky-400 hover:text-sky-300" to="/register">
            Create an account
          </Link>
        </p>
      </Card>
    </motion.div>
  );
}
