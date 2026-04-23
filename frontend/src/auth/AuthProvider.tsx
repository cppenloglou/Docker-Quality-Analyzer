import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  clearSession,
  login,
  persistSession,
  readUserFromStorage,
  register,
  type User,
} from "../utils/api";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  registerWithPassword: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readUserFromStorage());

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      loginWithPassword: async (email: string, password: string) => {
        const auth = await login({ email, password });
        persistSession(auth);
        setUser(auth.user);
      },
      registerWithPassword: async (email: string, password: string) => {
        const auth = await register({ email, password });
        persistSession(auth);
        setUser(auth.user);
      },
      logout: () => {
        clearSession();
        setUser(null);
      },
    }),
    [user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
