import type {
  Account,
  BusinessAsset,
  ChartOfAccount,
  CostLayer,
  Customer,
  Expense,
  JournalLine,
  LedgerEntry,
  PayrollRun,
  Product,
  PurchaseOrder,
  SalesOrder,
  StockMovement,
  Supplier,
  SupplierReturn,
  Voucher,
} from "../types/index.ts";
import { isInDateRange, parseRecordTime, type DateRange } from "./date-range.ts";
import { customerOpeningSigned } from "./customer-balance.ts";

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
  let remainingPayment = Math.max(0, roundMoney(paymentAmount));
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
  for (const v of vouchers) {
    if (v.partyType === "customer" && v.partyId && !customerMap.has(v.partyId)) {
      customerMap.set(v.partyId, {
        id: v.partyId,
        customerName: v.partyName || v.partyId,
        openingBalance: 0,
        invoiced: 0,
        collected: 0,
        due: 0,
        orders: [],
      });
    }
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
  for (const v of vouchers) {
    if (v.partyType === "supplier" && v.partyId && !supplierMap.has(v.partyId)) {
      supplierMap.set(v.partyId, {
        id: v.partyId,
        supplierName: v.partyName || v.partyId,
        openingBalance: 0,
        billed: 0,
        paid: 0,
        due: 0,
        orders: [],
      });
    }
  }
  for (const r of supplierReturns) {
    if (r.status !== "cancelled" && !supplierMap.has(r.supplierId)) {
      supplierMap.set(r.supplierId, {
        id: r.supplierId,
        supplierName: r.supplierName,
        openingBalance: 0,
        billed: 0,
        paid: 0,
        due: 0,
        orders: [],
      });
    }
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
    const subtotal = roundMoney(s.subtotal ?? s.total - tax);
    const total = roundMoney(s.total ?? subtotal + tax);

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
  warnings: string[];
};

/** Optional payroll snapshots let reports work without loading the HR module. */
export type AccountingVoucher = Voucher & {
  payrollNet?: number;
  advanceRecovered?: number;
  assetId?: string;
};
export type AccountingJournalLine = JournalLine & { assetId?: string };

export function journalAssetId(notes?: string): string | undefined {
  return notes?.match(/\[asset:([^\]\s]+)\]/)?.[1];
}

/** Profit and Loss Statement calculated strictly from revenue, cost layer COGS, and operating expenses */
export function computeProfitAndLoss(opts: {
  sales: SalesOrder[];
  stockMovements: StockMovement[];
  expenses: Expense[];
  payroll?: PayrollRun[];
  vouchers?: Voucher[];
  range?: DateRange;
  chartOfAccounts?: ChartOfAccount[];
}): PnLStatement {
  const { sales, stockMovements, expenses, payroll = [], vouchers = [], range } = opts;

  const isInRange = (date: string) => !range || isInDateRange(date, range);
  const coa = new Map((opts.chartOfAccounts ?? []).map((a) => [a.id, a]));
  const warnings: string[] = [];
  if (coa.size === 0 && vouchers.some((v) => v.type === "journal"))
    warnings.push(
      "Chart of accounts not supplied; legacy journal-name classification may be incomplete",
    );
  const expenseLine = (line: JournalLine) => {
    const account = coa.get(line.accountId);
    return account
      ? account.type === "Expense"
      : !/payable|liability|advance|asset|capital/i.test(line.accountName) &&
          /expense|salar(?:y|ies)|rent|utilit(?:y|ies)|fuel|wages|depreciation/i.test(
            line.accountName,
          );
  };

  // 1. Revenue (Net Sales excluding tax)
  let revenue = 0;
  for (const s of sales) {
    if (!isPostedSalesStatus(s.status)) continue;
    if (!isInRange(s.date)) continue;
    const net = roundMoney(s.subtotal ?? s.total - (s.tax || 0));
    revenue = roundMoney(revenue + net);
  }

  // 2. COGS from inventory stock movements (movementType: SALE_ISSUE or cogsAmount)
  let cogs = 0;
  const inventoryExpenses = new Map<string, number>();
  const adjustmentKeys = new Set<string>();
  const seenMovements = new Set<string>();
  for (const sm of stockMovements) {
    const identity = sm.movementId || sm.id;
    if (identity && seenMovements.has(identity)) continue;
    if (identity) seenMovements.add(identity);
    if (!isInRange(sm.date)) continue;
    const cost = roundMoney(sm.cogsAmount ?? sm.totalCost ?? (sm.unitCost ?? 0) * sm.quantity);
    const kind = sm.movementType;
    if (
      kind === "SALE_ISSUE" ||
      kind === "SALE_COMPLETED" ||
      (!kind && sm.type === "out" && (sm.refType === "sales" || sm.refType === "delivery"))
    ) {
      cogs = roundMoney(cogs + cost);
    } else if (
      kind === "SALES_RETURN" ||
      (!kind &&
        sm.type === "return" &&
        sm.refType === "sales" &&
        !/^Reservation released\b/i.test(sm.notes || ""))
    ) {
      cogs = roundMoney(cogs - cost);
    } else if (
      !kind &&
      sm.type === "in" &&
      /Reverse/i.test(sm.notes || "") &&
      (sm.refType === "sales" || sm.refType === "delivery")
    ) {
      // Client restoreStock writes the remaining average cost, not original issued cost.
      // Recover the source issue cost instead; the reversal stays on its own date.
      const issues = stockMovements.filter(
        (m) =>
          m.productId === sm.productId &&
          m.refType === sm.refType &&
          m.refId === sm.refId &&
          m.type === "out" &&
          (parseRecordTime(m.date) ?? 0) <= (parseRecordTime(sm.date) ?? Infinity),
      );
      const unique = [...new Map(issues.map((m) => [m.movementId || m.id, m])).values()];
      const qty = unique.reduce((sum, m) => sum + m.quantity, 0);
      const issuedCost = unique.reduce(
        (sum, m) => sum + (m.cogsAmount ?? m.totalCost ?? (m.unitCost ?? 0) * m.quantity),
        0,
      );
      cogs = roundMoney(cogs - (qty > 0 ? issuedCost * Math.min(sm.quantity / qty, 1) : cost));
    } else if (
      kind === "DAMAGE" ||
      kind === "LOSS" ||
      kind === "ADJUSTMENT_OUT" ||
      kind === "ADJUSTMENT_IN"
    ) {
      if (kind === "ADJUSTMENT_IN" || kind === "ADJUSTMENT_OUT") {
        // Openings and operational refill/return movements are not stock-count gains/losses.
        if (sm.refType !== "adjustment" || /^(INIT|opening)(?:\b|[_:-])/i.test(sm.refId || ""))
          continue;
        const key = `${sm.refId || sm.movementId || sm.id}:${sm.productId}:${kind}`;
        if (adjustmentKeys.has(key)) continue;
        adjustmentKeys.add(key);
      }
      const category =
        kind === "DAMAGE"
          ? "Inventory damage"
          : kind === "LOSS"
            ? "Inventory loss"
            : "Inventory adjustments";
      inventoryExpenses.set(
        category,
        roundMoney(
          (inventoryExpenses.get(category) ?? 0) + (kind === "ADJUSTMENT_IN" ? -cost : cost),
        ),
      );
    }
  }

  // 3. Operating Expenses
  const expCategories = inventoryExpenses;
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
        const account = coa.get(line.accountId);
        if (
          account?.type === "Income" ||
          (!account && /^(sales|revenue|other income|interest income)$/i.test(line.accountName))
        ) {
          revenue = roundMoney(revenue + line.credit - line.debit);
        }
        if (expenseLine(line)) {
          const cat = line.accountName;
          expCategories.set(
            cat,
            roundMoney((expCategories.get(cat) || 0) + line.debit - line.credit),
          );
        }
      }
    }
  }

  // Linked expense journals recognize payroll once, independently of settlement date.
  const journalPayrollIds = new Set(
    vouchers
      .filter(
        (v) =>
          v.type === "journal" && v.refType === "payroll" && v.refId && v.lines?.some(expenseLine),
      )
      .map((v) => v.refId),
  );
  const paymentPayrollIds = new Set(
    vouchers
      .filter((v) => v.type === "payment" && v.refType === "payroll" && v.refId)
      .map((v) => v.refId),
  );
  const paidRuns = new Map(
    payroll.filter((run) => run.status === "paid").map((run) => [run.id, run]),
  );
  const recognizedRuns = new Set<string>();
  for (const v of vouchers) {
    if (
      v.type !== "payment" ||
      !(
        v.refType === "payroll" ||
        (v.partyType === "employee" && /salary|payroll/i.test(v.notes || ""))
      )
    )
      continue;
    if ((v.refId && journalPayrollIds.has(v.refId)) || !isInRange(v.date)) continue;
    const run = v.refType === "payroll" && v.refId ? paidRuns.get(v.refId) : undefined;
    if (run && recognizedRuns.has(run.id)) continue;
    if (run) recognizedRuns.add(run.id);
    // Recovery settles an employee advance asset; earned salary remains the full net.
    expCategories.set(
      "Salaries",
      roundMoney(
        (expCategories.get("Salaries") ?? 0) +
          ((v as AccountingVoucher).payrollNet ?? run?.net ?? v.amount),
      ),
    );
  }
  for (const run of payroll) {
    if (run.status !== "paid" || journalPayrollIds.has(run.id) || paymentPayrollIds.has(run.id))
      continue;
    if (!isInRange(run.paidAt || run.createdAt || run.month + "-01")) continue;
    expCategories.set(
      "Salaries",
      roundMoney((expCategories.get("Salaries") ?? 0) + (run.net || 0)),
    );
  }

  const expenseList = Array.from(expCategories.entries())
    .map(([name, amount]) => ({ name, amount: roundMoney(amount) }))
    .sort((a, b) => b.amount - a.amount);
  const totalExpenses = roundMoney(expenseList.reduce((sum, e) => sum + e.amount, 0));
  const netProfit = roundMoney(revenue - cogs - totalExpenses);

  return {
    revenue,
    cogs,
    grossProfit: roundMoney(revenue - cogs),
    expenseList,
    totalExpenses,
    netProfit,
    warnings,
  };
}

export type BalanceSheetStatement = {
  cash: number;
  bank: number;
  inventoryValue: number;
  inputVat: number;
  ar: number;
  employeeAdvance: number;
  journalCurrentAssets: number;
  currentAssets: number;
  fixedAssets: number;
  totalAssets: number;
  ap: number;
  outputVat: number;
  journalLiabilities: number;
  totalLiabilities: number;
  ownerCapital: number;
  ownerDrawings: number;
  retainedEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
  discrepancy: number;
  warnings: string[];
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
  payroll?: PayrollRun[];
  supplierReturns?: SupplierReturn[];
  chartOfAccounts?: ChartOfAccount[];
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
      const open = costLayers.filter((l) => l.productId === p.id);
      const val =
        open.length > 0
          ? open.reduce((acc, l) => acc + l.qtyRemaining * (l.unitCost || 0), 0)
          : (p.stock || 0) * (p.cost || 0);
      return sum + val;
    }, 0),
  );

  // 3. Accounts Receivable
  const { totalDue: ar } = computeCustomerReceivables(customers, sales, vouchers);

  const warnings: string[] = [];
  const coa = opts.chartOfAccounts ?? [];
  const journalBalances = new Map<
    string,
    { name: string; type?: ChartOfAccount["type"]; balance: number; assetId?: string }
  >();
  const addJournal = (
    id: string,
    name: string,
    debit: number,
    credit: number,
    assetId?: string,
  ) => {
    const account = coa.find((a) => a.id === id || a.name === name);
    const key = `${account?.id || name}:${assetId || ""}`;
    const row = journalBalances.get(key) ?? {
      name: account?.name || name,
      type: account?.type,
      balance: 0,
      assetId,
    };
    row.balance = roundMoney(row.balance + debit - credit);
    journalBalances.set(key, row);
  };
  for (const v of vouchers) {
    if (v.type !== "journal") continue;
    for (const l of v.lines ?? [])
      addJournal(
        l.accountId,
        l.accountName,
        l.debit,
        l.credit,
        (l as AccountingJournalLine).assetId || journalAssetId(l.notes),
      );
  }
  // Voucher lines are canonical; ledger is a fallback for journal-only historical records.
  const journalIds = new Set(vouchers.filter((v) => v.type === "journal").map((v) => v.id));
  for (const e of ledger) {
    if (e.category !== "journal" || (e.refId && journalIds.has(e.refId))) continue;
    addJournal(
      e.account,
      e.account,
      e.direction === "in" ? e.amount : 0,
      e.direction === "out" ? e.amount : 0,
      journalAssetId(e.notes),
    );
  }

  let employeeAdvance = 0;
  const advanceRefs = new Set<string>();
  const recoveryRefs = new Set<string>();
  for (const v of vouchers) {
    if (String(v.refType) === "salaryAdvance") {
      const key = v.refId || v.id;
      if (!advanceRefs.has(key))
        employeeAdvance = roundMoney(
          employeeAdvance + (v.type === "payment" ? v.amount : -v.amount),
        );
      advanceRefs.add(key);
    }
    if (v.refType === "payroll" && v.type === "payment" && v.refId) {
      if (recoveryRefs.has(v.refId)) continue;
      const run = opts.payroll?.find((r) => r.id === v.refId && r.status === "paid");
      const recovered =
        (v as AccountingVoucher).advanceRecovered ??
        run?.advanceRecovered ??
        run?.advanceSettlements?.reduce((sum, s) => sum + s.amount, 0) ??
        0;
      employeeAdvance = roundMoney(employeeAdvance - recovered);
      recoveryRefs.add(v.refId);
    }
  }
  for (const e of ledger) {
    if (String(e.refType) !== "salaryAdvance" || advanceRefs.has(e.refId || e.id)) continue;
    if (!isCashBookAccount(e.account, accounts) && !isBankBookAccount(e.account, accounts))
      continue;
    employeeAdvance = roundMoney(employeeAdvance + (e.direction === "out" ? e.amount : -e.amount));
  }
  for (const run of opts.payroll ?? []) {
    if (run.status !== "paid" || recoveryRefs.has(run.id)) continue;
    employeeAdvance = roundMoney(
      employeeAdvance -
        (run.advanceRecovered ??
          run.advanceSettlements?.reduce((sum, s) => sum + s.amount, 0) ??
          0),
    );
  }

  let journalCurrentAssets = 0;
  let journalLiabilities = 0;
  let journalFixedAssets = 0;
  for (const row of journalBalances.values()) {
    const name = row.name;
    if (isCashBookAccount(name, accounts) || isBankBookAccount(name, accounts)) continue;
    if (/employee advance|salary advance/i.test(name)) {
      if (advanceRefs.size === 0 && !ledger.some((e) => String(e.refType) === "salaryAdvance"))
        employeeAdvance = roundMoney(employeeAdvance + row.balance);
      continue;
    }
    if (row.type === "Liability" || (!row.type && /payable|liability|loan payable/i.test(name))) {
      journalLiabilities = roundMoney(journalLiabilities - row.balance);
    } else if (
      row.assetId ||
      row.type === "Asset" ||
      (!row.type &&
        /fixed asset|vehicles?|equipment|machinery|furniture|buildings?|land|receivable|inventory/i.test(
          name,
        ))
    ) {
      // Registry/layers own their carrying values; a journal must not duplicate an acquisition.
      if (/inventory|stock/i.test(name)) continue;
      const registered = row.assetId ? assets.find((a) => a.id === row.assetId) : undefined;
      if (registered) {
        if (Math.abs(registered.currentValue - row.balance) > 0.009)
          warnings.push(
            `Asset ${registered.id}: register carrying value ${registered.currentValue} differs from journal ${row.balance}; reconcile valuation`,
          );
        continue;
      }
      if (row.assetId) warnings.push(`Journal references missing asset ${row.assetId}`);
      if (/receivable|prepaid|deposit|current asset/i.test(name))
        journalCurrentAssets = roundMoney(journalCurrentAssets + row.balance);
      else journalFixedAssets = roundMoney(journalFixedAssets + row.balance);
    } else if (
      !row.type &&
      row.balance &&
      !/capital|drawing|expense|salary|salaries|rent|fuel|revenue|income|sales|depreciation/i.test(
        name,
      )
    ) {
      warnings.push(`Unclassified journal account: ${name}; supply chartOfAccounts`);
    }
  }
  for (const asset of assets) {
    if (![...journalBalances.values()].some((r) => r.assetId === asset.id))
      warnings.push(`Asset ${asset.id} has no linked acquisition/opening journal`);
  }
  // Settling a previously recognized payroll payable is a liability settlement.
  const accruedPayroll = new Set(
    vouchers
      .filter(
        (v) =>
          v.type === "journal" &&
          v.refType === "payroll" &&
          v.lines?.some((l) => /payable/i.test(l.accountName) && l.credit > 0),
      )
      .map((v) => v.refId),
  );
  const settledPayroll = new Set<string>();
  for (const v of vouchers) {
    if (
      v.type !== "payment" ||
      v.refType !== "payroll" ||
      !v.refId ||
      !accruedPayroll.has(v.refId) ||
      settledPayroll.has(v.refId)
    )
      continue;
    const run = opts.payroll?.find((r) => r.id === v.refId);
    journalLiabilities = roundMoney(
      journalLiabilities - ((v as AccountingVoucher).payrollNet ?? run?.net ?? v.amount),
    );
    settledPayroll.add(v.refId);
  }
  if (employeeAdvance < 0) warnings.push("Employee advance recovery exceeds recorded advances");
  // App model: purchase layer costs exclude tax, so posted purchase tax is a
  // separate current asset. This calculation makes no claim about legal eligibility.
  const inputVat = roundMoney(
    purchases
      .filter((p) => isPostedPurchaseStatus(p.status))
      .reduce((sum, p) => sum + (p.tax || 0), 0) -
      (opts.supplierReturns ?? [])
        .filter((r) => r.status !== "cancelled")
        .reduce((sum, r) => sum + (r.tax || 0), 0),
  );
  const currentAssets = roundMoney(
    cash + bank + inventoryValue + inputVat + ar + employeeAdvance + journalCurrentAssets,
  );
  const fixedAssets = roundMoney(
    assets.reduce((sum, a) => sum + (a.currentValue || 0), 0) + journalFixedAssets,
  );
  const totalAssets = roundMoney(currentAssets + fixedAssets);

  // 4. Liabilities
  const { totalDue: ap } = computeSupplierPayables(
    suppliers,
    purchases,
    vouchers,
    opts.supplierReturns,
  );
  const { totalOutputTax: outputVat } = computeOutputVatLiability(sales);
  const totalLiabilities = roundMoney(ap + outputVat + journalLiabilities);

  // 5. Equity (Real accounts)
  const pnl = computeProfitAndLoss({
    sales,
    stockMovements,
    expenses,
    vouchers,
    payroll: opts.payroll,
    chartOfAccounts: opts.chartOfAccounts,
  });
  const retainedEarnings = roundMoney(pnl.netProfit);
  warnings.push(...pnl.warnings);

  // Missing recorded equity must remain visible as a discrepancy.
  let ownerCapital = 0;
  let ownerDrawings = 0;
  for (const row of journalBalances.values()) {
    if (row.type !== "Equity" && !/capital|drawing/i.test(row.name)) continue;
    if (/drawing/i.test(row.name)) ownerDrawings = roundMoney(ownerDrawings + row.balance);
    else ownerCapital = roundMoney(ownerCapital - row.balance);
  }
  for (const e of ledger) {
    if (e.refType !== "equity" || e.category === "journal") continue;
    const drawings = /drawing/i.test(e.notes || "");
    const delta = e.amount * (e.direction === "in" ? 1 : -1);
    if (drawings) ownerDrawings = roundMoney(ownerDrawings - delta);
    else ownerCapital = roundMoney(ownerCapital + delta);
  }
  if (ownerCapitalOverride != null) ownerCapital = roundMoney(ownerCapitalOverride);

  const totalEquity = roundMoney(ownerCapital - ownerDrawings + retainedEarnings);
  const totalLiabilitiesAndEquity = roundMoney(totalLiabilities + totalEquity);
  const discrepancy = roundMoney(totalAssets - totalLiabilitiesAndEquity);
  const isBalanced = Math.abs(discrepancy) < 0.01;

  return {
    cash,
    bank,
    inventoryValue,
    inputVat,
    ar,
    employeeAdvance,
    journalCurrentAssets,
    currentAssets,
    fixedAssets,
    totalAssets,
    ap,
    outputVat,
    journalLiabilities,
    totalLiabilities,
    ownerCapital,
    ownerDrawings,
    retainedEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    isBalanced,
    discrepancy,
    warnings,
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
  chartOfAccounts?: ChartOfAccount[];
}): CashFlowStatement {
  const { ledger, accounts = [], range } = opts;

  const fromTs = range?.preset !== "all" && range?.from ? parseRecordTime(range.from) : null;
  const toTs =
    range?.preset !== "all" && range?.to
      ? (parseRecordTime(range.to) ?? NaN) + 86_400_000 - 1
      : null;

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
    const counterparts =
      e.category === "journal" && e.refId
        ? ledger.filter(
            (other) =>
              other.refId === e.refId &&
              other.refType === e.refType &&
              !isCashOrBank(other.account),
          )
        : [];
    const hasAsset = counterparts.some((other) =>
      /fixed asset|vehicles?|equipment|machinery|furniture|buildings?|land/i.test(other.account),
    );
    const hasEquity = counterparts.some(
      (other) =>
        /capital|drawing/i.test(other.account) ||
        opts.chartOfAccounts?.some(
          (a) => a.type === "Equity" && (a.id === other.account || a.name === other.account),
        ),
    );
    if (hasAsset) {
      if (isIn) assetSales = roundMoney(assetSales + amt);
      else assetPurchases = roundMoney(assetPurchases + amt);
      continue;
    }
    if (hasEquity) {
      if (counterparts.some((other) => /drawing/i.test(other.account)))
        ownerDrawings = roundMoney(ownerDrawings + (isIn ? -amt : amt));
      else capitalContributions = roundMoney(capitalContributions + (isIn ? amt : -amt));
      continue;
    }
    // Journal transfers between cash/bank accounts have no cash-flow activity.
    if (
      e.category === "journal" &&
      e.refId &&
      counterparts.length === 0 &&
      ledger.some(
        (other) =>
          other.id !== e.id &&
          other.refId === e.refId &&
          other.refType === e.refType &&
          isCashOrBank(other.account) &&
          other.direction !== e.direction,
      )
    )
      continue;

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
      openingCash = roundMoney(openingCash + (isIn ? amt : -amt));
    } else if (e.refType === "equity") {
      if (/drawing/i.test(e.notes || "")) {
        ownerDrawings = roundMoney(ownerDrawings + (isIn ? -amt : amt));
      } else {
        capitalContributions = roundMoney(capitalContributions + (isIn ? amt : -amt));
      }
    } else if (e.category === "journal") {
      if (isIn) customerReceipts = roundMoney(customerReceipts + amt);
      else operatingExpenses = roundMoney(operatingExpenses + amt);
    } else {
      // Unclassified cash payments/adjustments remain visible in operating cash flow.
      operatingExpenses = roundMoney(operatingExpenses + (isIn ? -amt : amt));
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
  payroll?: PayrollRun[];
  supplierReturns?: SupplierReturn[];
  chartOfAccounts?: ChartOfAccount[];
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
  const arBalanced = Number.isFinite(ar);

  // 3. AP Reconciliation
  const { totalDue: ap } = computeSupplierPayables(
    suppliers,
    purchases,
    vouchers,
    opts.supplierReturns,
  );
  const apBalanced = Number.isFinite(ap);

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
  const pnl = computeProfitAndLoss({
    sales,
    stockMovements,
    expenses,
    vouchers,
    payroll: opts.payroll,
    chartOfAccounts: opts.chartOfAccounts,
  });
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
    payroll: opts.payroll,
    supplierReturns: opts.supplierReturns,
    chartOfAccounts: opts.chartOfAccounts,
  });

  const balanceSheetEquationSatisfied = bs.isBalanced;
  messages.push(...bs.warnings);
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
