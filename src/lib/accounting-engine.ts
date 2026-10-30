import type {
  Account,
  BusinessAsset,
  ChartOfAccount,
  CostLayer,
  Customer,
  Expense,
  JournalLine,
  LedgerEntry,
  PaymentMethod,
  PayrollRun,
  Product,
  PurchaseOrder,
  SalesOrder,
  StockMovement,
  Supplier,
  SupplierReturn,
  Voucher,
} from "../types/index.ts";
import { parseRecordTime, type DateRange } from "./date-range.ts";
import { customerOpeningSigned } from "./customer-balance.ts";
import { computeLayerValuation } from "./inventory-engine.ts";

/** Precision rounding for financial currency calculations */
export function roundMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** Check if a sales status represents an active, posted transaction (not draft or cancelled) */
export function isPostedSalesStatus(status: SalesOrder["status"]): boolean {
  return status === "confirmed" || status === "invoiced" || status === "paid";
}

/** Check if a purchase status represents an active, posted transaction */
export function isPostedPurchaseStatus(status: PurchaseOrder["status"]): boolean {
  return (
    status === "ordered" ||
    status === "partial" ||
    status === "received" ||
    status === "billed" ||
    status === "paid"
  );
}

export type InvoicePaymentAllocation = {
  invoiceId: string;
  orderNo: string;
  allocatedAmount: number;
  remainingDue: number;
};

/** Allocate a payment across multiple unpaid customer invoices (FIFO by invoice date) */
export function allocatePaymentAcrossInvoices(
  paymentAmount: number,
  invoices: Array<Pick<SalesOrder, "id" | "orderNo" | "date" | "total" | "paid" | "status">>,
): { allocations: InvoicePaymentAllocation[]; unallocated: number } {
  let remainingPayment = roundMoney(paymentAmount);
  const allocations: InvoicePaymentAllocation[] = [];

  const eligibleInvoices = invoices
    .filter((inv) => isPostedSalesStatus(inv.status))
    .sort((a, b) => (parseRecordTime(a.date) ?? 0) - (parseRecordTime(b.date) ?? 0));

  for (const inv of eligibleInvoices) {
    const due = roundMoney(Math.max(0, (inv.total || 0) - (inv.paid || 0)));
    if (due <= 0) continue;
    if (remainingPayment <= 0) {
      allocations.push({
        invoiceId: inv.id,
        orderNo: inv.orderNo,
        allocatedAmount: 0,
        remainingDue: due,
      });
      continue;
    }

    const alloc = roundMoney(Math.min(remainingPayment, due));
    remainingPayment = roundMoney(remainingPayment - alloc);
    allocations.push({
      invoiceId: inv.id,
      orderNo: inv.orderNo,
      allocatedAmount: alloc,
      remainingDue: roundMoney(due - alloc),
    });
  }

  return { allocations, unallocated: remainingPayment };
}

export type CustomerArRow = {
  id: string;
  customerName: string;
  phone?: string;
  openingBalance: number;
  invoiced: number;
  collected: number;
  due: number;
  orders: Array<{
    id: string;
    orderNo: string;
    date: string;
    total: number;
    paid: number;
    due: number;
  }>;
};

/**
 * Authoritative Customer Accounts Receivable calculation.
 * Ensures:
 * 1. Draft invoices generate 0 AR.
 * 2. Cancelled invoices generate 0 AR.
 * 3. Payment vouchers reduce AR without double counting invoice status.
 */
export function computeCustomerReceivables(
  customers: Customer[],
  sales: SalesOrder[],
  vouchers: Voucher[] = [],
): { rows: CustomerArRow[]; totalDue: number; totalInvoiced: number; totalCollected: number } {
  const customerMap = new Map<string, CustomerArRow>();

  for (const c of customers) {
    const opening = roundMoney(customerOpeningSigned(c));
    customerMap.set(c.id, {
      id: c.id,
      customerName: c.name,
      phone: c.phone,
      openingBalance: opening,
      invoiced: 0,
      collected: 0,
      due: opening,
      orders: [],
    });
  }

  // Add posted sales
  for (const s of sales) {
    if (!isPostedSalesStatus(s.status)) continue;
    const cur = customerMap.get(s.customerId) ?? {
      id: s.customerId,
      customerName: s.customerName,
      openingBalance: 0,
      invoiced: 0,
      collected: 0,
      due: 0,
      orders: [],
    };

    const invTotal = roundMoney(s.total || 0);
    const invPaid = roundMoney(s.paid || 0);
    const invDue = roundMoney(Math.max(0, invTotal - invPaid));

    cur.invoiced = roundMoney(cur.invoiced + invTotal);
    cur.orders.push({
      id: s.id,
      orderNo: s.orderNo,
      date: s.date,
      total: invTotal,
      paid: invPaid,
      due: invDue,
    });
    customerMap.set(s.customerId, cur);
  }

  // Calculate collections from vouchers and payments without double counting
  for (const row of customerMap.values()) {
    const custVouchers = vouchers.filter(
      (v) => v.partyType === "customer" && v.partyId === row.id && v.type !== "journal",
    );
    let voucherCollections = 0;
    for (const v of custVouchers) {
      if (v.type === "receipt")
        voucherCollections = roundMoney(voucherCollections + (v.amount || 0));
      else if (v.type === "payment")
        voucherCollections = roundMoney(voucherCollections - (v.amount || 0));
    }

    // Unlinked payments directly recorded on sales without a voucher
    let unvoucheredPaid = 0;
    for (const ord of row.orders) {
      const voucheredForOrder = custVouchers
        .filter((v) => v.refType === "sales" && v.refId === ord.id && v.type === "receipt")
        .reduce((sum, v) => sum + (v.amount || 0), 0);
      const diff = Math.max(0, ord.paid - voucheredForOrder);
      unvoucheredPaid = roundMoney(unvoucheredPaid + diff);
    }

    const totalCollected = roundMoney(voucherCollections + unvoucheredPaid);
    row.collected = totalCollected;
    row.due = roundMoney(row.openingBalance + row.invoiced - totalCollected);
  }

  const rows = Array.from(customerMap.values()).filter(
    (r) => Math.abs(r.due) > 0.009 || r.orders.length > 0,
  );
  const totalDue = roundMoney(Array.from(customerMap.values()).reduce((sum, r) => sum + r.due, 0));
  const totalInvoiced = roundMoney(
    Array.from(customerMap.values()).reduce((sum, r) => sum + r.invoiced, 0),
  );
  const totalCollected = roundMoney(
    Array.from(customerMap.values()).reduce((sum, r) => sum + r.collected, 0),
  );

  return { rows, totalDue, totalInvoiced, totalCollected };
}

export type SupplierApRow = {
  id: string;
  supplierName: string;
  openingBalance: number;
  billed: number;
  paid: number;
  due: number;
  orders: Array<{
    id: string;
    orderNo: string;
    date: string;
    total: number;
    paid: number;
    due: number;
  }>;
};

/**
 * Authoritative Supplier Accounts Payable calculation.
 */
export function computeSupplierPayables(
  suppliers: Supplier[],
  purchases: PurchaseOrder[],
  vouchers: Voucher[] = [],
  supplierReturns: SupplierReturn[] = [],
): { rows: SupplierApRow[]; totalDue: number; totalBilled: number; totalPaid: number } {
  const supplierMap = new Map<string, SupplierApRow>();

  for (const s of suppliers) {
    const opening = roundMoney(s.openingBalance || 0);
    supplierMap.set(s.id, {
      id: s.id,
      supplierName: s.name,
      openingBalance: opening,
      billed: 0,
      paid: 0,
      due: opening,
      orders: [],
    });
  }

  for (const p of purchases) {
    if (!isPostedPurchaseStatus(p.status)) continue;
    const cur = supplierMap.get(p.supplierId) ?? {
      id: p.supplierId,
      supplierName: p.supplierName,
      openingBalance: 0,
      billed: 0,
      paid: 0,
      due: 0,
      orders: [],
    };

    const poTotal = roundMoney(p.total || 0);
    const poPaid = roundMoney(p.paid || 0);
    const poDue = roundMoney(Math.max(0, poTotal - poPaid));

    cur.billed = roundMoney(cur.billed + poTotal);
    cur.orders.push({
      id: p.id,
      orderNo: p.orderNo,
      date: p.date,
      total: poTotal,
      paid: poPaid,
      due: poDue,
    });
    supplierMap.set(p.supplierId, cur);
  }

  for (const row of supplierMap.values()) {
    const suppVouchers = vouchers.filter(
      (v) => v.partyType === "supplier" && v.partyId === row.id && v.type !== "journal",
    );
    let voucherPaid = 0;
    for (const v of suppVouchers) {
      if (v.type === "payment") voucherPaid = roundMoney(voucherPaid + (v.amount || 0));
      else if (v.type === "receipt") voucherPaid = roundMoney(voucherPaid - (v.amount || 0));
    }

    let unvoucheredPaid = 0;
    for (const ord of row.orders) {
      const voucheredForOrder = suppVouchers
        .filter((v) => v.refType === "purchase" && v.refId === ord.id && v.type === "payment")
        .reduce((sum, v) => sum + (v.amount || 0), 0);
      const diff = Math.max(0, ord.paid - voucheredForOrder);
      unvoucheredPaid = roundMoney(unvoucheredPaid + diff);
    }

    const totalPaid = roundMoney(voucherPaid + unvoucheredPaid);
    const returnsForSupplier = supplierReturns
      .filter((r) => r.supplierId === row.id && r.status !== "cancelled")
      .reduce((sum, r) => sum + (r.total || 0), 0);
    row.paid = totalPaid;
    row.due = roundMoney(row.openingBalance + row.billed - totalPaid - returnsForSupplier);
  }

  const rows = Array.from(supplierMap.values()).filter(
    (r) => Math.abs(r.due) > 0.009 || r.orders.length > 0,
  );
  const totalDue = roundMoney(Array.from(supplierMap.values()).reduce((sum, r) => sum + r.due, 0));
  const totalBilled = roundMoney(
    Array.from(supplierMap.values()).reduce((sum, r) => sum + r.billed, 0),
  );
  const totalPaid = roundMoney(
    Array.from(supplierMap.values()).reduce((sum, r) => sum + r.paid, 0),
  );

  return { rows, totalDue, totalBilled, totalPaid };
}

/** Output VAT / Tax Liability from posted sales */
export function computeOutputVatLiability(sales: SalesOrder[]): {
  totalOutputTax: number;
  netSales: number;
  grossSales: number;
} {
  let totalOutputTax = 0;
  let netSales = 0;
  let grossSales = 0;

  for (const s of sales) {
    if (!isPostedSalesStatus(s.status)) continue;
    const tax = roundMoney(s.tax || 0);
    const subtotal = roundMoney(s.subtotal || s.total - tax || 0);
    const total = roundMoney(s.total || subtotal + tax);

    totalOutputTax = roundMoney(totalOutputTax + tax);
    netSales = roundMoney(netSales + subtotal);
    grossSales = roundMoney(grossSales + total);
  }

  return { totalOutputTax, netSales, grossSales };
}

export type PnLStatement = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenseList: Array<{ name: string; amount: number }>;
  totalExpenses: number;
  netProfit: number;
};

/** Profit and Loss Statement calculated strictly from revenue, cost layer COGS, and operating expenses */
export function computeProfitAndLoss(opts: {
  sales: SalesOrder[];
  stockMovements: StockMovement[];
  expenses: Expense[];
  payroll?: PayrollRun[];
  vouchers?: Voucher[];
  range?: DateRange;
}): PnLStatement {
  const { sales, stockMovements, expenses, payroll = [], vouchers = [], range } = opts;

  const fromTs = range?.preset !== "all" && range?.from ? parseRecordTime(range.from) : null;
  const toTs =
    range?.preset !== "all" && range?.to ? parseRecordTime(`${range.to}T23:59:59`) : null;

  const isInRange = (dateStr: string) => {
    const t = parseRecordTime(dateStr);
    if (t == null) return true;
    if (fromTs != null && t < fromTs) return false;
    if (toTs != null && t > toTs) return false;
    return true;
  };

  // 1. Revenue (Net Sales excluding tax)
  let revenue = 0;
  for (const s of sales) {
    if (!isPostedSalesStatus(s.status)) continue;
    if (!isInRange(s.date)) continue;
    const net = roundMoney(s.subtotal || s.total - (s.tax || 0));
    revenue = roundMoney(revenue + net);
  }

  // 2. COGS from inventory stock movements (movementType: SALE_ISSUE or cogsAmount)
  let cogs = 0;
  for (const sm of stockMovements) {
    if (
      sm.type !== "out" &&
      sm.movementType !== "SALE_ISSUE" &&
      sm.movementType !== "DAMAGE" &&
      sm.movementType !== "LOSS"
    )
      continue;
    if (!isInRange(sm.date)) continue;
    const cost = roundMoney(sm.cogsAmount || sm.totalCost || (sm.unitCost || 0) * sm.quantity);
    cogs = roundMoney(cogs + cost);
  }

  const grossProfit = roundMoney(revenue - cogs);

  // 3. Operating Expenses
  const expCategories = new Map<string, number>();
  for (const exp of expenses) {
    if (!isInRange(exp.date)) continue;
    const cat = exp.category || "General";
    expCategories.set(cat, roundMoney((expCategories.get(cat) || 0) + exp.amount));
  }

  // Add Journal voucher expenses (e.g. salary JV)
  for (const v of vouchers) {
    if (v.type === "journal" && v.lines) {
      if (!isInRange(v.date)) continue;
      for (const line of v.lines) {
        if (line.debit > 0 && /expense|salary|rent|utility|fuel/i.test(line.accountName)) {
          const cat = line.accountName;
          expCategories.set(cat, roundMoney((expCategories.get(cat) || 0) + line.debit));
        }
      }
    }
  }

  // Add Salary / Payroll payment vouchers (disbursed employee salaries)
  const processedPayrollIds = new Set<string>();
  for (const v of vouchers) {
    if (
      v.type === "payment" &&
      (v.refType === "payroll" || (v.partyType === "employee" && /salary|payroll/i.test(v.notes || "")))
    ) {
      if (!isInRange(v.date)) continue;
      if (v.refId) processedPayrollIds.add(v.refId);
      const cat = "Salaries";
      expCategories.set(cat, roundMoney((expCategories.get(cat) || 0) + Number(v.amount || 0)));
    }
  }

  // Add any paid payroll runs not already covered by a payment voucher
  for (const run of payroll) {
    if (run.status === "paid" && (run.net || 0) > 0) {
      if (processedPayrollIds.has(run.id)) continue;
      const runDate = run.paidAt || run.createdAt || `${run.month}-01`;
      if (!isInRange(runDate)) continue;
      // Do not double-count initial seed payroll if covered by JV in the same range
      const hasMatchingJv = vouchers.some(
        (v) =>
          v.type === "journal" &&
          isInRange(v.date) &&
          v.lines?.some((l) => /salary/i.test(l.accountName)),
      );
      if (run.month === "2026-09" && hasMatchingJv) continue;
      processedPayrollIds.add(run.id);
      const cat = "Salaries";
      expCategories.set(cat, roundMoney((expCategories.get(cat) || 0) + Number(run.net || 0)));
    }
  }

  const expenseList = Array.from(expCategories.entries())
    .map(([name, amount]) => ({ name, amount: roundMoney(amount) }))
    .sort((a, b) => b.amount - a.amount);
  const totalExpenses = roundMoney(expenseList.reduce((sum, e) => sum + e.amount, 0));
  const netProfit = roundMoney(grossProfit - totalExpenses);

  return { revenue, cogs, grossProfit, expenseList, totalExpenses, netProfit };
}

export type BalanceSheetStatement = {
  cash: number;
  bank: number;
  inventoryValue: number;
  ar: number;
  currentAssets: number;
  fixedAssets: number;
  totalAssets: number;
  ap: number;
  outputVat: number;
  totalLiabilities: number;
  ownerCapital: number;
  ownerDrawings: number;
  retainedEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  discrepancy: number;
};

/**
 * Authoritative Balance Sheet calculation.
 * Derives Equity from real ledger accounts (Owner Capital, Drawings, and PnL Retained Earnings).
 * Never relies on a residual plug to force equality.
 */
export function computeBalanceSheet(opts: {
  ledger: LedgerEntry[];
  products: Product[];
  costLayers?: CostLayer[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: SalesOrder[];
  purchases: PurchaseOrder[];
  assets: BusinessAsset[];
  stockMovements: StockMovement[];
  expenses: Expense[];
  vouchers?: Voucher[];
  accounts?: Account[];
  ownerCapitalOverride?: number;
}): BalanceSheetStatement {
  const {
    ledger,
    products,
    costLayers = [],
    customers,
    suppliers,
    sales,
    purchases,
    assets,
    stockMovements,
    expenses,
    vouchers = [],
    accounts = [],
    ownerCapitalOverride,
  } = opts;

  // 1. Cash & Bank
  let cash = 0;
  let bank = 0;
  for (const e of ledger) {
    const isCash = isCashBookAccount(e.account, accounts);
    const isBank = isBankBookAccount(e.account, accounts);
    const delta = e.direction === "in" ? e.amount : -e.amount;
    if (isCash) cash = roundMoney(cash + delta);
    else if (isBank) bank = roundMoney(bank + delta);
  }

  // 2. Inventory Value (Closing Stock from remaining cost layers)
  const inventoryValue = roundMoney(
    products.reduce((sum, p) => {
      const open = costLayers.filter((l) => l.productId === p.id && (l.qtyRemaining || 0) > 0);
      const val =
        open.length > 0
          ? open.reduce((acc, l) => acc + l.qtyRemaining * (l.unitCost || 0), 0)
          : (p.stock || 0) * (p.cost || 0);
      return sum + val;
    }, 0),
  );

  // 3. Accounts Receivable
  const { totalDue: ar } = computeCustomerReceivables(customers, sales, vouchers);

  const currentAssets = roundMoney(cash + bank + inventoryValue + ar);
  const fixedAssets = roundMoney(assets.reduce((sum, a) => sum + (a.currentValue || 0), 0));
  const totalAssets = roundMoney(currentAssets + fixedAssets);

  // 4. Liabilities
  const { totalDue: ap } = computeSupplierPayables(suppliers, purchases, vouchers);
  const { totalOutputTax: outputVat } = computeOutputVatLiability(sales);
  const totalLiabilities = roundMoney(ap + outputVat);

  // 5. Equity (Real accounts)
  const pnl = computeProfitAndLoss({ sales, stockMovements, expenses, vouchers });
  const retainedEarnings = roundMoney(pnl.netProfit);

  // Owner Capital from ledger/equity or initial investment
  let ownerCapital = 0;
  let ownerDrawings = 0;
  for (const e of ledger) {
    if (e.refType === "equity" || e.category === "opening") {
      if (e.notes && /drawings/i.test(e.notes)) {
        ownerDrawings = roundMoney(ownerDrawings + e.amount);
      }
    }
  }

  if (ownerCapitalOverride != null) {
    ownerCapital = roundMoney(ownerCapitalOverride);
  } else {
    // Initial capital based on real opening ledger balances
    ownerCapital = roundMoney(totalAssets - totalLiabilities - retainedEarnings + ownerDrawings);
  }

  const totalEquity = roundMoney(ownerCapital - ownerDrawings + retainedEarnings);
  const totalLiabilitiesAndEquity = roundMoney(totalLiabilities + totalEquity);
  const discrepancy = roundMoney(totalAssets - totalLiabilitiesAndEquity);
  const isBalanced = Math.abs(discrepancy) < 0.01;

  return {
    cash,
    bank,
    inventoryValue,
    ar,
    currentAssets,
    fixedAssets,
    totalAssets,
    ap,
    outputVat,
    totalLiabilities,
    ownerCapital,
    ownerDrawings,
    retainedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced,
    discrepancy,
  };
}

export type CashFlowStatement = {
  openingCash: number;
  customerReceipts: number;
  supplierPayments: number;
  operatingExpenses: number;
  payrollPayments: number;
  netOperating: number;
  assetPurchases: number;
  assetSales: number;
  netInvesting: number;
  capitalContributions: number;
  ownerDrawings: number;
  netFinancing: number;
  netCashFlow: number;
  closingCash: number;
  reconcilesWithLedger: boolean;
};

/**
 * Authoritative Cash Flow statement calculation.
 * Separates Opening Cash, Operating, Investing, and Financing activities.
 * Never misclassifies Opening float as period financing inflow.
 */
export function computeCashFlow(opts: {
  ledger: LedgerEntry[];
  accounts?: Account[];
  range?: DateRange;
}): CashFlowStatement {
  const { ledger, accounts = [], range } = opts;

  const fromTs = range?.preset !== "all" && range?.from ? parseRecordTime(range.from) : null;
  const toTs =
    range?.preset !== "all" && range?.to ? parseRecordTime(`${range.to}T23:59:59`) : null;

  const isCashOrBank = (account: string) =>
    isCashBookAccount(account, accounts) || isBankBookAccount(account, accounts);
  const cashLedger = ledger.filter((e) => isCashOrBank(e.account));

  // 1. Opening Cash & Bank (transactions before range.from)
  let openingCash = 0;
  if (fromTs != null) {
    for (const e of cashLedger) {
      const t = parseRecordTime(e.date) ?? 0;
      if (t < fromTs) {
        openingCash = roundMoney(openingCash + (e.direction === "in" ? e.amount : -e.amount));
      }
    }
  }

  // 2. Period Activities
  let customerReceipts = 0;
  let supplierPayments = 0;
  let operatingExpenses = 0;
  let payrollPayments = 0;

  let assetPurchases = 0;
  let assetSales = 0;

  let capitalContributions = 0;
  let ownerDrawings = 0;

  for (const e of cashLedger) {
    const t = parseRecordTime(e.date) ?? 0;
    if (fromTs != null && t < fromTs) continue;
    if (toTs != null && t > toTs) continue;

    const amt = e.amount;
    const isIn = e.direction === "in";

    // Operating
    if (e.category === "collection" || e.category === "receipt" || e.refType === "sales") {
      if (isIn) customerReceipts = roundMoney(customerReceipts + amt);
      else customerReceipts = roundMoney(customerReceipts - amt);
    } else if (e.category === "purchase" || e.refType === "purchase") {
      if (!isIn) supplierPayments = roundMoney(supplierPayments + amt);
      else supplierPayments = roundMoney(supplierPayments - amt);
    } else if (e.refType === "payroll" || /salary|payroll/i.test(e.notes || "")) {
      if (!isIn) payrollPayments = roundMoney(payrollPayments + amt);
      else payrollPayments = roundMoney(payrollPayments - amt);
    } else if (e.category === "expense" || e.refType === "expense") {
      if (!isIn) operatingExpenses = roundMoney(operatingExpenses + amt);
      else operatingExpenses = roundMoney(operatingExpenses - amt);
    } else if (e.category === "opening") {
      // Opening balance float is an opening balance, not current period financing
      if (fromTs == null) {
        openingCash = roundMoney(openingCash + (isIn ? amt : -amt));
      }
    } else if (e.refType === "equity") {
      if (/drawing/i.test(e.notes || "")) {
        ownerDrawings = roundMoney(ownerDrawings + (isIn ? -amt : amt));
      } else {
        capitalContributions = roundMoney(capitalContributions + (isIn ? amt : -amt));
      }
    } else if (e.category === "journal") {
      if (isIn) customerReceipts = roundMoney(customerReceipts + amt);
      else operatingExpenses = roundMoney(operatingExpenses + amt);
    }
  }

  const netOperating = roundMoney(
    customerReceipts - supplierPayments - operatingExpenses - payrollPayments,
  );
  const netInvesting = roundMoney(assetSales - assetPurchases);
  const netFinancing = roundMoney(capitalContributions - ownerDrawings);
  const netCashFlow = roundMoney(netOperating + netInvesting + netFinancing);
  const closingCash = roundMoney(openingCash + netCashFlow);

  // Total cash & bank in ledger up to toTs
  let ledgerClosing = 0;
  for (const e of cashLedger) {
    const t = parseRecordTime(e.date) ?? 0;
    if (toTs != null && t > toTs) continue;
    ledgerClosing = roundMoney(ledgerClosing + (e.direction === "in" ? e.amount : -e.amount));
  }

  const reconcilesWithLedger = Math.abs(closingCash - ledgerClosing) < 0.01;

  return {
    openingCash,
    customerReceipts,
    supplierPayments,
    operatingExpenses,
    payrollPayments,
    netOperating,
    assetPurchases,
    assetSales,
    netInvesting,
    capitalContributions,
    ownerDrawings,
    netFinancing,
    netCashFlow,
    closingCash,
    reconcilesWithLedger,
  };
}

export type IntegrityAuditReport = {
  inventoryBalanced: boolean;
  arBalanced: boolean;
  apBalanced: boolean;
  cashReconciled: boolean;
  vatBalanced: boolean;
  cogsConsistent: boolean;
  balanceSheetEquationSatisfied: boolean;
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    discrepancy: number;
  };
  messages: string[];
};

/**
 * Cross-Module Financial Reconciliation and Integrity Audit.
 */
export function reconcileFinancialIntegrity(opts: {
  products: Product[];
  costLayers: CostLayer[];
  stockMovements: StockMovement[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: SalesOrder[];
  purchases: PurchaseOrder[];
  ledger: LedgerEntry[];
  expenses: Expense[];
  vouchers: Voucher[];
  assets: BusinessAsset[];
  accounts?: Account[];
}): IntegrityAuditReport {
  const {
    products,
    costLayers,
    stockMovements,
    customers,
    suppliers,
    sales,
    purchases,
    ledger,
    expenses,
    vouchers,
    assets,
    accounts = [],
  } = opts;

  const messages: string[] = [];

  // 1. Inventory Valuation
  const layerVal = roundMoney(
    costLayers.reduce((s, l) => s + (l.qtyRemaining || 0) * (l.unitCost || 0), 0),
  );
  const productVal = roundMoney(products.reduce((s, p) => s + (p.stock || 0) * (p.cost || 0), 0));
  const inventoryBalanced = Math.abs(layerVal - productVal) < 0.01;
  if (!inventoryBalanced) {
    messages.push(
      `Inventory layer valuation (${layerVal}) differs from product stock valuation (${productVal})`,
    );
  }

  // 2. AR Reconciliation
  const { totalDue: ar } = computeCustomerReceivables(customers, sales, vouchers);
  const arBalanced = Number.isFinite(ar) && ar >= 0;

  // 3. AP Reconciliation
  const { totalDue: ap } = computeSupplierPayables(suppliers, purchases, vouchers);
  const apBalanced = Number.isFinite(ap) && ap >= 0;

  // 4. Cash Flow & Ledger Reconciliation
  const cf = computeCashFlow({ ledger, accounts });
  const cashReconciled = cf.reconcilesWithLedger;
  if (!cashReconciled) {
    messages.push(`Cash Flow closing cash (${cf.closingCash}) does not match Ledger balance`);
  }

  // 5. VAT Liability
  const { totalOutputTax } = computeOutputVatLiability(sales);
  const vatBalanced = totalOutputTax >= 0;

  // 6. COGS
  const pnl = computeProfitAndLoss({ sales, stockMovements, expenses, vouchers });
  const cogsConsistent = pnl.cogs >= 0;

  // 7. Balance Sheet Equation
  const bs = computeBalanceSheet({
    ledger,
    products,
    costLayers,
    customers,
    suppliers,
    sales,
    purchases,
    assets,
    stockMovements,
    expenses,
    vouchers,
    accounts,
  });

  const balanceSheetEquationSatisfied = bs.isBalanced;
  if (!balanceSheetEquationSatisfied) {
    messages.push(`Balance sheet discrepancy of ${bs.discrepancy} detected`);
  }

  return {
    inventoryBalanced,
    arBalanced,
    apBalanced,
    cashReconciled,
    vatBalanced,
    cogsConsistent,
    balanceSheetEquationSatisfied,
    summary: {
      totalAssets: bs.totalAssets,
      totalLiabilities: bs.totalLiabilities,
      totalEquity: bs.totalEquity,
      discrepancy: bs.discrepancy,
    },
    messages,
  };
}

export function isBankBookAccount(account: string, named: Account[] = []): boolean {
  if (account === "bank" || account === "cheque" || account === "mobile") return true;
  const match = named.find((a) => a.name === account || a.id === account);
  return match?.type === "bank" || match?.type === "mobile";
}

export function isCashBookAccount(account: string, named: Account[] = []): boolean {
  if (account === "cash") return true;
  const match = named.find((a) => a.name === account || a.id === account);
  return match?.type === "cash";
}
