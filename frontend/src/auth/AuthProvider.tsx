import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  auth as authApi,
  clearSession,
  getAccessToken,
  onUnauthorized,
  persistSession,
  persistUser,
  readUserFromStorage,
  type User,
} from "../utils/api";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isBooting: boolean;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  registerWithPassword: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readUserFromStorage());
  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [isBooting, setIsBooting] = useState<boolean>(() => !!getAccessToken());

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setToken(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const stored = getAccessToken();
    if (!stored) {
      setIsBooting(false);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const current = await authApi.me();
        if (cancelled) return;
        persistUser(current);
        setUser(current);
        setToken(getAccessToken());
      } catch {
        if (cancelled) return;
        clearSession();
        setUser(null);
        setToken(null);
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return onUnauthorized(() => {
      logout();
    });
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!user && !!token,
      isBooting,
      loginWithPassword: async (email: string, password: string) => {
        const response = await authApi.login({ email, password });
        persistSession(response);
        setUser(response.user);
        setToken(response.access_token);
      },
      registerWithPassword: async (email: string, password: string) => {
        const response = await authApi.register({ email, password });
        persistSession(response);
        setUser(response.user);
        setToken(response.access_token);
      },
      logout,
      refreshMe: async () => {
        const current = await authApi.me();
        persistUser(current);
        setUser(current);
      },
    }),
    [user, token, isBooting, logout],
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
