import type {
  Customer,
  Supplier,
  Product,
  Cylinder,
  CylinderMovement,
  SalesOrder,
  Delivery,
  Expense,
  LedgerEntry,
  PurchaseOrder,
  StockMovement,
  Voucher,
  Employee,
  PayrollRun,
  Account,
  ChartOfAccount,
  BusinessAsset,
  CostLayer,
} from "@/types";

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

// Zero Demo / Dummy records - software initialized clean for real business operations
export const seedCustomers: Customer[] = [];
export const seedSuppliers: Supplier[] = [];
export const seedProducts: Product[] = [];
export const seedCylinders: Cylinder[] = [];
export const seedMovements: CylinderMovement[] = [];
export const seedSales: SalesOrder[] = [];
export const seedDeliveries: Delivery[] = [];
export const seedExpenses: Expense[] = [];
export const seedLedger: LedgerEntry[] = [];
export const seedPurchases: PurchaseOrder[] = [];
export const seedStockMovements: StockMovement[] = [];
export const seedVouchers: Voucher[] = [];
export const seedEmployees: Employee[] = [];
export const seedPayroll: PayrollRun[] = [];

// Essential System Login Accounts (Protected)
export const seedAppUsers = [
  {
    id: "u1",
    username: "operator",
    password: "insaf123",
    displayName: "Operator",
    role: "Administrator",
    active: true,
    createdAt: daysAgo(200),
  },
  {
    id: "u2",
    username: "manager",
    password: "insaf123",
    displayName: "Plant Manager",
    role: "Manager",
    active: true,
    createdAt: daysAgo(200),
  },
  {
    id: "u3",
    username: "sales1",
    password: "insaf123",
    displayName: "Sales Desk",
    role: "Sales",
    active: true,
    createdAt: daysAgo(200),
  },
  {
    id: "u4",
    username: "warehouse",
    password: "insaf123",
    displayName: "Warehouse Lead",
    role: "Warehouse",
    active: true,
    createdAt: daysAgo(200),
  },
  {
    id: "u5",
    username: "accounts",
    password: "insaf123",
    displayName: "Accounts Officer",
    role: "Accounts",
    active: true,
    createdAt: daysAgo(200),
  },
  {
    id: "u6",
    username: "hr1",
    password: "insaf123",
    displayName: "HR Officer",
    role: "HR",
    active: true,
    createdAt: daysAgo(200),
  },
  {
    id: "u7",
    username: "delivery1",
    password: "insaf123",
    displayName: "Delivery Lead",
    role: "Delivery",
    active: true,
    createdAt: daysAgo(200),
  },
  {
    id: "u8",
    username: "auditor",
    password: "insaf123",
    displayName: "Internal Auditor",
    role: "Auditor",
    active: true,
    createdAt: daysAgo(200),
  },
];

// Master financial accounts (real accounts to be added by company in settings)
export const seedAccounts: Account[] = [];

// Essential Accounting Master Configurations (Protected)
export const seedChartOfAccounts: ChartOfAccount[] = [
  { id: "coa1", name: "Sales Revenue", type: "Income", code: "INC-01", createdAt: daysAgo(200) },
  { id: "coa2", name: "Delivery Charges", type: "Income", code: "INC-02", createdAt: daysAgo(200) },
  { id: "coa3", name: "Salary Expense", type: "Expense", code: "EXP-01", createdAt: daysAgo(200) },
  { id: "coa4", name: "Office Rent", type: "Expense", code: "EXP-02", createdAt: daysAgo(200) },
  { id: "coa5", name: "Transport Fuel", type: "Expense", code: "EXP-03", createdAt: daysAgo(200) },
  {
    id: "coa6",
    name: "Warehouse Equipment",
    type: "Asset",
    code: "AST-01",
    createdAt: daysAgo(200),
  },
  { id: "coa7", name: "Bank Loan", type: "Liability", code: "LIA-01", createdAt: daysAgo(200) },
  {
    id: "coa8",
    name: "Cost of Goods Sold",
    type: "Expense",
    code: "EXP-04",
    createdAt: daysAgo(200),
  },
  { id: "coa9", name: "Inventory Asset", type: "Asset", code: "AST-02", createdAt: daysAgo(200) },
  {
    id: "coa10",
    name: "Accounts Receivable",
    type: "Asset",
    code: "AST-03",
    createdAt: daysAgo(200),
  },
  {
    id: "coa11",
    name: "Accounts Payable",
    type: "Liability",
    code: "LIA-02",
    createdAt: daysAgo(200),
  },
  {
    id: "coa12",
    name: "Output VAT Liability",
    type: "Liability",
    code: "LIA-03",
    createdAt: daysAgo(200),
  },
  { id: "coa13", name: "Owner Capital", type: "Equity", code: "EQU-01", createdAt: daysAgo(200) },
  { id: "coa14", name: "Owner Drawings", type: "Equity", code: "EQU-02", createdAt: daysAgo(200) },
  {
    id: "coa15",
    name: "Retained Earnings",
    type: "Equity",
    code: "EQU-03",
    createdAt: daysAgo(200),
  },
];

export const seedAssets: BusinessAsset[] = [];
export const seedCostLayers: CostLayer[] = [];

export const allSeed = {
  customers: seedCustomers,
  suppliers: seedSuppliers,
  products: seedProducts,
  cylinders: seedCylinders,
  movements: seedMovements,
  sales: seedSales,
  deliveries: seedDeliveries,
  expenses: seedExpenses,
  ledger: seedLedger,
  purchases: seedPurchases,
  stockMovements: seedStockMovements,
  vouchers: seedVouchers,
  employees: seedEmployees,
  payroll: seedPayroll,
  appUsers: seedAppUsers,
  accounts: seedAccounts,
  chartOfAccounts: seedChartOfAccounts,
  assets: seedAssets,
  costLayers: seedCostLayers,
};
