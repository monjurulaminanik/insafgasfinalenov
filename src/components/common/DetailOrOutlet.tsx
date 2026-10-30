import { Outlet, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** When `/edit` (or other) child routes nest under `$id`, parent must yield an Outlet. */
export function DetailOrOutlet({ children }: { children: ReactNode }) {
  const isChildRoute = useRouterState({
    select: (s) => /\/(edit|statement)\/?$/.test(s.location.pathname),
  });
  if (isChildRoute) return <Outlet />;
  return <>{children}</>;
}
