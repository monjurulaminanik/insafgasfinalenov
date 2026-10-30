import type { AppModule, AppRole, PowerMatrix } from "./settings-store";
import { APP_MODULES, APP_ROLES, defaultMatrix } from "./settings-store";

/** Map URL path prefix → app module for RBAC */
export const PATH_MODULE_MAP: { prefix: string; module: AppModule }[] = [
  { prefix: "/settings", module: "settings" },
  { prefix: "/reports", module: "reports" },
  { prefix: "/customers", module: "customers" },
  { prefix: "/suppliers", module: "suppliers" },
  { prefix: "/products", module: "products" },
  { prefix: "/sales", module: "sales" },
  { prefix: "/purchases", module: "purchases" },
  { prefix: "/inventory", module: "inventory" },
  { prefix: "/cylinders", module: "cylinders" },
  { prefix: "/deliveries", module: "deliveries" },
  { prefix: "/returns", module: "returns" },
  { prefix: "/accounting", module: "accounting" },
  { prefix: "/expenses", module: "expenses" },
  { prefix: "/hr", module: "hr" },
  { prefix: "/", module: "dashboard" },
];

export function pathToModule(pathname: string): AppModule | null {
  if (pathname === "/" || pathname === "") return "dashboard";
  const hit = PATH_MODULE_MAP.find(
    (p) => p.prefix !== "/" && (pathname === p.prefix || pathname.startsWith(`${p.prefix}/`)),
  );
  return hit?.module ?? null;
}

export function urlToModule(url: string): AppModule {
  return pathToModule(url) ?? "dashboard";
}

export function canRoleAccess(
  matrix: PowerMatrix | undefined,
  role: string | undefined,
  moduleId: AppModule,
): boolean {
  if (!role) return false;
  if (role === "Administrator") return true;
  if (!APP_ROLES.includes(role as AppRole)) return false;
  if (!matrix) return false;
  return Boolean(matrix[role as AppRole]?.[moduleId]);
}

export { APP_MODULES, APP_ROLES, defaultMatrix };
export type { AppModule, AppRole };
