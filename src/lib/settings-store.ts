export type AppRole =
  "Administrator" | "Manager" | "Sales" | "Warehouse" | "Accounts" | "HR" | "Delivery" | "Auditor";

export type AppModule =
  | "dashboard"
  | "customers"
  | "suppliers"
  | "products"
  | "sales"
  | "purchases"
  | "inventory"
  | "cylinders"
  | "deliveries"
  | "returns"
  | "accounting"
  | "expenses"
  | "hr"
  | "reports"
  | "settings";

export type AppUserRecord = {
  id: string;
  username: string;
  displayName: string;
  role: AppRole;
  active: boolean;
};

export const APP_ROLES: AppRole[] = [
  "Administrator",
  "Manager",
  "Sales",
  "Warehouse",
  "Accounts",
  "HR",
  "Delivery",
  "Auditor",
];

export const APP_MODULES: { id: AppModule; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "customers", label: "Customers" },
  { id: "suppliers", label: "Suppliers" },
  { id: "products", label: "Products" },
  { id: "sales", label: "Sales" },
  { id: "purchases", label: "Purchases" },
  { id: "inventory", label: "Inventory" },
  { id: "cylinders", label: "Cylinders" },
  { id: "deliveries", label: "Deliveries" },
  { id: "returns", label: "Returns" },
  { id: "accounting", label: "Accounting" },
  { id: "expenses", label: "Expenses" },
  { id: "hr", label: "HR & Payroll" },
  { id: "reports", label: "Reports" },
  { id: "settings", label: "Settings" },
];

const USERS_KEY = "insaf-app-users";
const MATRIX_KEY = "insaf-power-matrix";

const defaultUsers: AppUserRecord[] = [
  { id: "u1", username: "operator", displayName: "Operator", role: "Administrator", active: true },
  { id: "u2", username: "sales1", displayName: "Sales Desk", role: "Sales", active: true },
  {
    id: "u3",
    username: "warehouse",
    displayName: "Warehouse Lead",
    role: "Warehouse",
    active: true,
  },
  {
    id: "u4",
    username: "accounts",
    displayName: "Accounts Officer",
    role: "Accounts",
    active: true,
  },
];

function blankAccess(value: boolean): Record<AppModule, boolean> {
  return Object.fromEntries(APP_MODULES.map((m) => [m.id, value])) as Record<AppModule, boolean>;
}

/** Fail-closed matrix: only Administrator has access until a saved Power Matrix exists. */
export function closedMatrix(): Record<AppRole, Record<AppModule, boolean>> {
  return {
    Administrator: blankAccess(true),
    Manager: blankAccess(false),
    Sales: blankAccess(false),
    Warehouse: blankAccess(false),
    Accounts: blankAccess(false),
    HR: blankAccess(false),
    Delivery: blankAccess(false),
    Auditor: blankAccess(false),
  };
}

export function defaultMatrix(): Record<AppRole, Record<AppModule, boolean>> {
  return {
    Administrator: blankAccess(true),
    Manager: blankAccess(true),
    Sales: {
      ...blankAccess(false),
      dashboard: true,
      customers: true,
      products: true,
      sales: true,
      deliveries: true,
      returns: true,
      reports: true,
    },
    Warehouse: {
      ...blankAccess(false),
      dashboard: true,
      suppliers: true,
      products: true,
      inventory: true,
      cylinders: true,
      deliveries: true,
      returns: true,
      purchases: true,
    },
    Accounts: {
      ...blankAccess(false),
      dashboard: true,
      customers: true,
      suppliers: true,
      accounting: true,
      expenses: true,
      reports: true,
      sales: true,
      purchases: true,
    },
    HR: {
      ...blankAccess(false),
      dashboard: true,
      hr: true,
      reports: true,
    },
    Delivery: {
      ...blankAccess(false),
      dashboard: true,
      customers: true,
      deliveries: true,
      returns: true,
      cylinders: true,
    },
    Auditor: {
      ...blankAccess(false),
      dashboard: true,
      customers: true,
      suppliers: true,
      products: true,
      reports: true,
      accounting: true,
      sales: true,
      purchases: true,
    },
  };
}

function sanitizeMatrix(raw: Record<string, Record<string, boolean>>) {
  const base = defaultMatrix();
  for (const role of APP_ROLES) {
    const row = raw[role] ?? base[role];
    base[role] = Object.fromEntries(APP_MODULES.map((m) => [m.id, Boolean(row[m.id])])) as Record<
      AppModule,
      boolean
    >;
  }
  return base;
}

export function loadUsers(): AppUserRecord[] {
  if (typeof window === "undefined") return defaultUsers;
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return defaultUsers;
    const parsed = JSON.parse(raw) as AppUserRecord[];
    return Array.isArray(parsed) && parsed.length ? parsed : defaultUsers;
  } catch {
    return defaultUsers;
  }
}

export function saveUsers(users: AppUserRecord[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

export function loadPowerMatrix(): Record<AppRole, Record<AppModule, boolean>> {
  if (typeof window === "undefined") return defaultMatrix();
  try {
    const raw = localStorage.getItem(MATRIX_KEY);
    if (!raw) return defaultMatrix();
    return sanitizeMatrix(JSON.parse(raw));
  } catch {
    return defaultMatrix();
  }
}

export function savePowerMatrix(matrix: Record<AppRole, Record<AppModule, boolean>>) {
  localStorage.setItem(MATRIX_KEY, JSON.stringify(matrix));
}

export type PowerMatrix = Record<AppRole, Record<AppModule, boolean>>;
