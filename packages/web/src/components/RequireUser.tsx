import { Navigate, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useMe } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import type { MeUser } from "../api/client.ts";

type Props = {
  children: (user: MeUser) => ReactNode;
  requireAdmin?: boolean;
};

export function RequireUser({ children, requireAdmin = false }: Props) {
  const meQuery = useMe();
  const location = useLocation();

  if (meQuery.isLoading) {
    return <p className="text-sm text-muted">{STR.common.loading}</p>;
  }

  const user = meQuery.data ?? null;
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next || "/")}`} replace />;
  }

  if (requireAdmin && user.role !== "admin") {
    return (
      <div
        data-testid="admin-forbidden"
        className="rounded-sf border border-line bg-surface px-4 py-6 text-sm text-ink-2"
      >
        {STR.admin.forbidden}
      </div>
    );
  }

  return <>{children(user)}</>;
}
