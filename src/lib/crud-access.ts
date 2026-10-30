import type { AppModule } from "./settings-store";
import type { AppPermission } from "./rbac";

export type CrudCollName =
  | "customers"
  | "suppliers"
  | "products"
  | "cylinders"
  | "movements"
  | "sales"
  | "deliveries"
  | "returns"
  | "expenses"
  | "ledger"
  | "purchases"
  | "stockMovements"
  | "vouchers"
  | "employees"
  | "payroll"
  | "appUsers"
  | "accounts"
  | "chartOfAccounts"
  | "assets"
  | "costLayers"
  | "supplierReturns";

export type CrudOp = "list" | "get" | "create" | "update" | "remove" | "claim";

const WRITE: Record<CrudCollName, AppModule[]> = {
  customers: ["customers"],
  suppliers: ["suppliers"],
  products: ["products", "inventory", "sales", "deliveries", "purchases"],
  cylinders: ["cylinders", "inventory", "deliveries", "sales", "purchases"],
  movements: ["cylinders", "inventory", "deliveries", "sales", "purchases"],
  sales: ["sales", "deliveries", "inventory"],
  deliveries: ["deliveries", "sales"],
  returns: ["returns", "deliveries", "sales", "inventory"],
  expenses: ["expenses", "accounting"],
  ledger: ["accounting"],
  purchases: ["purchases", "inventory"],
  stockMovements: ["inventory", "purchases", "sales", "deliveries", "cylinders"],
  vouchers: ["accounting"],
  employees: ["hr"],
  payroll: ["hr"],
  appUsers: ["settings"],
  accounts: ["accounting"],
  chartOfAccounts: ["accounting"],
  assets: ["accounting"],
  costLayers: ["inventory"],
  supplierReturns: ["suppliers", "purchases", "inventory"],
};

const READ: Record<CrudCollName, AppModule[]> = {
  customers: ["customers", "sales", "deliveries", "accounting", "reports"],
  suppliers: ["suppliers", "purchases", "accounting", "reports", "inventory"],
  products: ["products", "sales", "purchases", "inventory", "cylinders", "deliveries", "reports"],
  cylinders: [
    "cylinders",
    "inventory",
    "deliveries",
    "sales",
    "purchases",
    "reports",
    "customers",
    "suppliers",
  ],
  movements: [
    "cylinders",
    "inventory",
    "deliveries",
    "sales",
    "purchases",
    "reports",
    "customers",
    "suppliers",
  ],
  sales: ["sales", "accounting", "reports", "deliveries", "dashboard"],
  deliveries: ["deliveries", "sales", "reports"],
  returns: ["returns", "deliveries", "sales", "inventory", "reports"],
  expenses: ["expenses", "accounting", "reports", "dashboard"],
  ledger: ["accounting", "reports"],
  purchases: ["purchases", "accounting", "reports", "inventory"],
  stockMovements: ["inventory", "purchases", "sales", "deliveries", "reports", "cylinders"],
  vouchers: ["accounting", "reports"],
  employees: ["hr", "reports"],
  payroll: ["hr", "reports"],
  appUsers: ["settings"],
  accounts: ["accounting", "reports"],
  chartOfAccounts: ["accounting", "reports"],
  assets: ["accounting", "reports"],
  costLayers: ["inventory", "purchases", "sales", "reports"],
  supplierReturns: ["suppliers", "purchases", "inventory", "accounting", "reports"],
};

const WRITE_OPS = new Set<CrudOp>(["create", "update", "remove", "claim"]);

export function isKnownCrudCollection(coll: string): coll is CrudCollName {
  return Object.prototype.hasOwnProperty.call(WRITE, coll);
}

export function modulesForCrud(coll: CrudCollName, op: CrudOp): AppModule[] {
  return WRITE_OPS.has(op) ? WRITE[coll] : READ[coll];
}

export function permissionForCrud(coll: CrudCollName, op: CrudOp): AppPermission {
  const isRead = op === "list" || op === "get";
  switch (coll) {
    case "sales":
      if (isRead) return "sales.read";
      if (op === "create") return "sales.create";
      if (op === "update") return "sales.update";
      return "sales.delete";

    case "products":
    case "stockMovements":
    case "costLayers":
      if (isRead) return "inventory.read";
      if (op === "create") return "inventory.create";
      if (op === "remove") return "inventory.delete";
      return "inventory.adjust";

    case "ledger":
    case "vouchers":
    case "accounts":
    case "chartOfAccounts":
    case "assets":
    case "expenses":
      if (isRead) return "accounting.read";
      if (op === "create") return "accounting.create";
      if (op === "update") return "accounting.update";
      return "accounting.delete";

    case "payroll":
    case "employees":
      if (isRead) return "payroll.read";
      if (op === "create") return "payroll.create";
      if (op === "update") return "payroll.update";
      return "payroll.delete";

    case "appUsers":
      if (isRead) return "users.read";
      if (op === "create") return "users.create";
      if (op === "update") return "users.update";
      return "users.delete";

    case "customers":
      return isRead ? "customers.read" : "customers.write";

    case "suppliers":
      return isRead ? "suppliers.read" : "suppliers.write";

    case "purchases":
      return isRead ? "suppliers.read" : "inventory.create";

    case "supplierReturns":
      return isRead ? "suppliers.read" : "suppliers.write";

    case "deliveries":
      return isRead ? "deliveries.read" : "deliveries.write";

    case "cylinders":
    case "movements":
      return isRead ? "cylinders.read" : "cylinders.write";

    default:
      return isRead ? "reports.read" : "settings.write";
  }
}
