import { Outlet, useLocation } from "react-router-dom";

import { AuthShell } from "../components/auth/AuthShell";

export function AuthLayout() {
  const location = useLocation();
  const mode = location.pathname === "/register" ? "register" : "login";

  return (
    <AuthShell mode={mode}>
      <Outlet />
    </AuthShell>
  );
}
