import type { AppRole } from "./settings-store";

export type AppPermission =
  // Sales
  | "sales.read"
  | "sales.create"
  | "sales.update"
  | "sales.delete"
  // Inventory
  | "inventory.read"
  | "inventory.create"
  | "inventory.adjust"
  | "inventory.delete"
  // Accounting
  | "accounting.read"
  | "accounting.create"
  | "accounting.update"
  | "accounting.delete"
  // Payroll
  | "payroll.read"
  | "payroll.create"
  | "payroll.update"
  | "payroll.delete"
  // Users
  | "users.read"
  | "users.create"
  | "users.update"
  | "users.delete"
  // Customers & Suppliers
  | "customers.read"
  | "customers.write"
  | "suppliers.read"
  | "suppliers.write"
  // Deliveries & Cylinders
  | "deliveries.read"
  | "deliveries.write"
  | "returns.read"
  | "returns.write"
  | "cylinders.read"
  | "cylinders.write"
  // Reports & Settings
  | "reports.read"
  | "settings.read"
  | "settings.write";

const ROLE_PERMISSIONS: Record<AppRole, Set<AppPermission>> = {
  Administrator: new Set<AppPermission>([
    "sales.read",
    "sales.create",
    "sales.update",
    "sales.delete",
    "inventory.read",
    "inventory.create",
    "inventory.adjust",
    "inventory.delete",
    "accounting.read",
    "accounting.create",
    "accounting.update",
    "accounting.delete",
    "payroll.read",
    "payroll.create",
    "payroll.update",
    "payroll.delete",
    "users.read",
    "users.create",
    "users.update",
    "users.delete",
    "customers.read",
    "customers.write",
    "suppliers.read",
    "suppliers.write",
    "deliveries.read",
    "deliveries.write",
    "returns.read",
    "returns.write",
    "cylinders.read",
    "cylinders.write",
    "reports.read",
    "settings.read",
    "settings.write",
  ]),

  Manager: new Set<AppPermission>([
    "sales.read",
    "sales.create",
    "sales.update",
    "inventory.read",
    "inventory.create",
    "inventory.adjust",
    "accounting.read",
    "accounting.create",
    "accounting.update",
    "payroll.read",
    "payroll.create",
    "payroll.update",
    "customers.read",
    "customers.write",
    "suppliers.read",
    "suppliers.write",
    "deliveries.read",
    "deliveries.write",
    "returns.read",
    "returns.write",
    "cylinders.read",
    "cylinders.write",
    "reports.read",
  ]),

  Sales: new Set<AppPermission>([
    "sales.read",
    "sales.create",
    "sales.update",
    "customers.read",
    "customers.write",
    "deliveries.read",
    "returns.read",
    "returns.write",
    "cylinders.read",
    "reports.read",
  ]),

  Warehouse: new Set<AppPermission>([
    "inventory.read",
    "inventory.create",
    "inventory.adjust",
    "suppliers.read",
    "deliveries.read",
    "deliveries.write",
    "returns.read",
    "returns.write",
    "cylinders.read",
    "cylinders.write",
    "reports.read",
  ]),

  Accounts: new Set<AppPermission>([
    "accounting.read",
    "accounting.create",
    "accounting.update",
    "accounting.delete",
    "sales.read",
    "inventory.read",
    "customers.read",
    "suppliers.read",
    "reports.read",
  ]),

  HR: new Set<AppPermission>(["payroll.read", "payroll.create", "payroll.update", "reports.read"]),

  Delivery: new Set<AppPermission>([
    "deliveries.read",
    "deliveries.write",
    "returns.read",
    "returns.write",
    "customers.read",
    "cylinders.read",
    "cylinders.write",
  ]),

  Auditor: new Set<AppPermission>([
    "sales.read",
    "inventory.read",
    "accounting.read",
    "payroll.read",
    "customers.read",
    "suppliers.read",
    "deliveries.read",
    "returns.read",
    "cylinders.read",
    "reports.read",
  ]),
};

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "Forbidden: Insufficient permissions") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function hasPermission(role: string | undefined | null, permission: AppPermission): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as AppRole];
  if (!perms) return false;
  return perms.has(permission);
}

export function assertPermission(
  user: { role?: string | null } | undefined | null,
  permission: AppPermission,
): void {
  if (!user || !user.role) {
    throw new ForbiddenError("Unauthorized: Authentication required");
  }
  if (!hasPermission(user.role, permission)) {
    throw new ForbiddenError(`Forbidden: Role '${user.role}' lacks '${permission}' permission`);
  }
}
