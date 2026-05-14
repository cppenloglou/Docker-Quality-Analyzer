import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";

import { useAuth } from "../auth/AuthProvider";
import { ApiError } from "../utils/api";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { authCardVariants, authCardTransition, pageVariantsReduced, pageTransitionReduced } from "../components/motion/variants";

const authInputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function Register() {
  const navigate = useNavigate();
  const { registerWithPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await registerWithPassword(email, password);
      toast.success("Account created");
      navigate("/", { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Registration failed.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const reducedMotion = useReducedMotion();

  return (
    <div className="min-h-screen bg-slate-950 grid place-items-center px-4">
      <motion.div
        initial="initial"
        animate="animate"
        variants={reducedMotion ? pageVariantsReduced : authCardVariants}
        transition={reducedMotion ? pageTransitionReduced : authCardTransition}
        className="w-full max-w-md"
      >
      <Card className="w-full p-6 bg-slate-900 border-slate-800">
        <h1 className="text-2xl font-semibold text-white mb-2">Create account</h1>
        <p className="text-slate-400 mb-6">Start analyzing your Docker workflows.</p>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="flex flex-col gap-3">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className={authInputClass}
            />
          </div>
          <div className="flex flex-col gap-3">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <input
              id="password"
              type="password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={authInputClass}
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>
        <p className="text-sm text-slate-400 mt-4">
          Already have an account?{" "}
          <Link className="text-blue-400 hover:text-blue-300" to="/login">
            Sign in
          </Link>
        </p>
      </Card>
      </motion.div>
    </div>
  );
}
