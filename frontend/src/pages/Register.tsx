import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
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

export function Register() {
  const navigate = useNavigate();
  const { registerWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<ExplainedAuthError | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [success, setSuccess] = useState(false);
  const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
  const canSubmit = useMemo(
    () => email.trim().length > 3 && password.length >= 8 && password === confirmPassword,
    [email, password, confirmPassword],
  );
  const submitHint = useMemo(() => {
    if (email.trim().length <= 3) return "Enter a valid email address.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (password !== confirmPassword) return "Password and confirmation must match.";
    return null;
  }, [email, password, confirmPassword]);

  useEffect(() => {
    void import("./Login");
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (passwordMismatch) {
      setError({
        title: "Passwords do not match",
        message: "Please make sure password and confirmation are identical.",
        tips: ["Double-check both fields and try again."],
      });
      return;
    }
    setSuccess(false);
    setError(null);
    try {
      await registerWithPassword(email, password);
      setSuccess(true);
      toast.success("Account created");
      await new Promise((resolve) => setTimeout(resolve, AUTH_REDIRECT_DELAY_MS));
      navigate("/", { replace: true });
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
          <h1 className="mt-2 text-2xl font-semibold text-white">Create your account</h1>
          <p className="mt-2 text-sm text-slate-400">
            Set up your secure workspace to run Dockerfile, Compose, and project quality checks.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Work email
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
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                onKeyDown={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                onBlur={() => setCapsLockOn(false)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
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
            <p className="text-[11px] text-slate-500">
              Use a strong password with letters, numbers, and symbols.
            </p>
            {capsLockOn && (
              <p className="text-xs text-amber-400">Caps Lock is on.</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
              Confirm password
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyUp={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                onKeyDown={(e) => setCapsLockOn(e.getModifierState("CapsLock"))}
                onBlur={() => setCapsLockOn(false)}
                autoComplete="new-password"
                placeholder="Repeat password"
                className={`${authInputClass} pl-9 pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label={showConfirmPassword ? "Hide password confirmation" : "Show password confirmation"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {passwordMismatch && (
              <p className="text-xs text-red-400">Passwords do not match yet.</p>
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
                <span>Account created successfully. Redirecting...</span>
              </div>
            </div>
          )}
          <Button type="submit" disabled={success || !canSubmit} className="w-full">
            {success ? "Account created" : "Create account"}
            {!success && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
          {!canSubmit && !success && submitHint && (
            <p className="text-xs text-amber-400" aria-live="polite">
              {submitHint}
            </p>
          )}
        </form>
        <p className="mt-5 text-sm text-slate-400">
          Already have an account?{" "}
          <Link className="text-sky-400 hover:text-sky-300" to="/login">
            Sign in
          </Link>
        </p>
      </Card>
    </motion.div>
  );
}
