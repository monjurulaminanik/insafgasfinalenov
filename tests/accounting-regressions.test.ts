import { it } from "node:test";
import assert from "node:assert/strict";
import type {
  SalesOrder,
  StockMovement,
  Voucher,
  PayrollRun,
  LedgerEntry,
  Product,
} from "../src/types/index.ts";
import {
  computeProfitAndLoss,
  computeBalanceSheet,
  computeCashFlow,
  computeCustomerReceivables,
  computeSupplierPayables,
  type AccountingVoucher,
} from "../src/lib/accounting-engine.ts";
import {
  validateAccountingJournal,
  validateAccountingAsset,
} from "../src/lib/accounting-validation.ts";

const sale = (extra = {}): SalesOrder => ({
  id: "s",
  orderNo: "SO",
  customerId: "c",
  customerName: "C",
  date: "2026-10-01",
  items: [],
  subtotal: 100,
  tax: 0,
  total: 100,
  paid: 0,
  status: "invoiced",
  ...extra,
});
const move = (extra: Partial<StockMovement> = {}): StockMovement => ({
  id: "m",
  date: "2026-10-01",
  productId: "p",
  productName: "P",
  type: "out",
  movementType: "SALE_ISSUE",
  quantity: 2,
  balanceAfter: 8,
  unitCost: 20,
  totalCost: 40,
  cogsAmount: 40,
  refType: "sales",
  refId: "s",
  by: "test",
  ...extra,
});
const voucher = (extra: Partial<Voucher> = {}): Voucher => ({
  id: "v",
  voucherNo: "V",
  type: "journal",
  date: "2026-10-01",
  account: "bank",
  amount: 100,
  createdAt: "2026-10-01",
  ...extra,
});
const run = (extra: Partial<PayrollRun> = {}): PayrollRun => ({
  id: "r",
  employeeId: "e",
  employeeName: "E",
  month: "2026-10",
  basic: 100,
  bonus: 0,
  allowance: 0,
  deduction: 0,
  net: 100,
  status: "paid",
  paidAt: "2026-10-01",
  createdAt: "2026-10-01",
  ...extra,
});
const pnl = (extra = {}) =>
  computeProfitAndLoss({ sales: [], stockMovements: [], expenses: [], ...extra });
const bs = (extra = {}) =>
  computeBalanceSheet({
    ledger: [],
    products: [],
    costLayers: [],
    customers: [],
    suppliers: [],
    sales: [],
    purchases: [],
    assets: [],
    stockMovements: [],
    expenses: [],
    ...extra,
  });
const line = (accountId: string, accountName: string, debit: number, credit: number) => ({
  accountId,
  accountName,
  debit,
  credit,
});

it("adjustment gain/loss derives once from movements, excluding INIT, refill, returns and transfers", () => {
  const gain = move({
    id: "gain",
    refType: "adjustment",
    refId: "request-gain",
    movementType: "ADJUSTMENT_IN",
    type: "in",
    cogsAmount: 60,
    notes: "initial count correction",
  });
  const loss = move({
    id: "loss",
    refType: "adjustment",
    refId: "request-loss",
    movementType: "ADJUSTMENT_OUT",
    cogsAmount: 20,
  });
  const result = pnl({
    stockMovements: [
      gain,
      { ...gain, id: "retry" },
      loss,
      move({ id: "init", movementType: "ADJUSTMENT_IN", refType: "adjustment", refId: "INIT-p" }),
      move({ id: "refill", movementType: "ADJUSTMENT_OUT", refType: "refill" }),
      move({ id: "transfer", movementType: "TRANSFER_OUT" }),
      move({ id: "supplier-return", movementType: "PURCHASE_RETURN", refType: "purchase" }),
    ],
  });
  assert.equal(result.cogs, 0);
  assert.equal(result.totalExpenses, -40);
  assert.equal(result.netProfit, 40);
});

it("adjustment P&L date is the adjustment date and zero COGS does not fall through", () => {
  const result = pnl({
    stockMovements: [
      move({ cogsAmount: 0, totalCost: 50 }),
      move({
        id: "later",
        date: "2026-10-02",
        refType: "adjustment",
        movementType: "ADJUSTMENT_OUT",
      }),
    ],
    range: { preset: "custom", from: "2026-10-01", to: "2026-10-01" },
  });
  assert.equal(result.cogs, 0);
  assert.equal(result.totalExpenses, 0);
});

it("sales returns reverse cost, damage/loss are separate expenses and duplicate movements are ignored", () => {
  const issued = move();
  const result = pnl({
    stockMovements: [
      issued,
      issued,
      move({ id: "return", movementType: "SALES_RETURN", type: "in", cogsAmount: 10 }),
      move({ id: "damage", movementType: "DAMAGE", cogsAmount: 5 }),
      move({ id: "loss", movementType: "LOSS", cogsAmount: 3 }),
    ],
  });
  assert.equal(result.cogs, 30);
  assert.equal(result.totalExpenses, 8);
});

it("legacy delivery reversal uses original issuance cost rather than remaining average", () => {
  const issued = move({ refType: "delivery", refId: "dc" });
  const reverse = move({
    id: "reverse",
    refType: "delivery",
    refId: "dc",
    type: "in",
    movementType: undefined,
    unitCost: 99,
    cogsAmount: undefined,
    totalCost: undefined,
    notes: "Reverse DC",
  });
  assert.equal(pnl({ stockMovements: [issued, reverse] }).cogs, 0);
});

it("daily range includes final milliseconds, excludes invalid dates and preserves zero revenue", () => {
  const last = "2026-10-01T23:59:59.999+06:00";
  const result = pnl({
    sales: [
      sale({ date: last }),
      sale({ id: "bad", date: "bad" }),
      sale({ id: "zero", subtotal: 0, total: 50 }),
    ],
    range: { preset: "custom", from: "2026-10-01", to: "2026-10-01" },
  });
  assert.equal(result.revenue, 100);
});

it("journal expense credits reverse expenses and payable credits are not expenses", () => {
  const result = pnl({
    vouchers: [
      voucher({
        lines: [
          line("salary", "Salary Expense", 100, 0),
          line("payable", "Salary Payable", 0, 100),
        ],
      }),
      voucher({ id: "reversal", lines: [line("salary", "Salary Expense", 0, 20)] }),
    ],
  });
  assert.equal(result.totalExpenses, 80);
});

it("chart-of-account type overrides name heuristics", () => {
  assert.equal(
    pnl({
      chartOfAccounts: [
        { id: "custom", name: "Office overhead", type: "Expense", createdAt: "2026-01-01" },
      ],
      vouchers: [voucher({ lines: [line("custom", "Office overhead", 15, 0)] })],
    }).totalExpenses,
    15,
  );
});

it("linked payroll journal excludes later cash payment without month-specific exceptions", () => {
  const journal = voucher({
    refType: "payroll",
    refId: "r",
    lines: [line("salary", "Salary Expense", 100, 0), line("payable", "Salary Payable", 0, 100)],
  });
  const payment = voucher({
    id: "payment",
    type: "payment",
    refType: "payroll",
    refId: "r",
    date: "2026-11-01",
  });
  const args = { payroll: [run({ paidAt: "2026-11-01" })], vouchers: [journal, payment] };
  assert.equal(pnl(args).totalExpenses, 100);
  assert.equal(
    pnl({ ...args, range: { preset: "custom", from: "2026-11-01", to: "2026-11-30" } })
      .totalExpenses,
    0,
  );
});

it("payroll advance recovery preserves earned net salary while cash remains actual disbursement", () => {
  const payment = voucher({ type: "payment", refType: "payroll", refId: "r", amount: 60 });
  assert.equal(pnl({ payroll: [run()], vouchers: [payment] }).totalExpenses, 100);
  assert.equal(pnl({ payroll: [run()], vouchers: [{ ...payment, amount: 0 }] }).totalExpenses, 100);
});

it("draft payroll and advance payments alone never create salary expense", () => {
  assert.equal(
    pnl({
      payroll: [run({ status: "draft" })],
      vouchers: [
        voucher({ type: "payment", partyType: "employee", notes: "Employee advance", amount: 50 }),
      ],
    }).totalExpenses,
    0,
  );
});

it("exhausted cost layers value inventory at zero and missing capital remains discrepant", () => {
  const result = bs({
    products: [{ id: "p", stock: 5, cost: 20 } as Product],
    costLayers: [
      { id: "l", productId: "p", qtyRemaining: 0, unitCost: 20, receivedAt: "2026-01-01" },
    ],
    ledger: [
      {
        id: "cash",
        date: "2026-01-01",
        account: "cash",
        direction: "in",
        amount: 100,
        category: "opening",
      },
    ],
  });
  assert.equal(result.inventoryValue, 0);
  assert.equal(result.ownerCapital, 0);
  assert.equal(result.isBalanced, false);
  assert.equal(result.discrepancy, 100);
});

it("recorded capital and drawings keep correct debit/credit signs", () => {
  const result = bs({
    ledger: [
      {
        id: "capital",
        date: "2026-01-01",
        account: "Owner Capital",
        direction: "out",
        amount: 100,
        category: "journal",
      },
      {
        id: "drawing",
        date: "2026-01-01",
        account: "Drawings",
        direction: "in",
        amount: 20,
        category: "journal",
      },
      {
        id: "cash",
        date: "2026-01-01",
        account: "cash",
        direction: "in",
        amount: 80,
        category: "opening",
      },
    ],
  });
  assert.equal(result.ownerCapital, 100);
  assert.equal(result.ownerDrawings, 20);
  assert.equal(result.isBalanced, true);
});

it("voucher-only parties preserve customer credit and supplier advance balances", () => {
  assert.equal(
    computeCustomerReceivables(
      [],
      [],
      [voucher({ type: "receipt", partyType: "customer", partyId: "c", amount: 50 })],
    ).totalDue,
    -50,
  );
  assert.equal(
    computeSupplierPayables(
      [],
      [],
      [voucher({ type: "payment", partyType: "supplier", partyId: "s", amount: 60 })],
    ).totalDue,
    -60,
  );
});

it("cash flow recognizes asset journals and in-range opening float", () => {
  const ledger: LedgerEntry[] = [
    {
      id: "opening",
      date: "2026-10-01",
      account: "cash",
      direction: "in",
      amount: 100,
      category: "opening",
    },
    {
      id: "cash",
      date: "2026-10-01",
      account: "cash",
      direction: "out",
      amount: 40,
      category: "journal",
      refType: "voucher",
      refId: "asset",
    },
    {
      id: "asset",
      date: "2026-10-01",
      account: "Equipment",
      direction: "in",
      amount: 40,
      category: "journal",
      refType: "voucher",
      refId: "asset",
    },
  ];
  const result = computeCashFlow({
    ledger,
    range: { preset: "custom", from: "2026-10-01", to: "2026-10-01" },
  });
  assert.equal(result.assetPurchases, 40);
  assert.equal(result.openingCash, 100);
  assert.equal(result.closingCash, 60);
  assert.equal(result.reconcilesWithLedger, true);
});

it("cash/bank journal transfers are excluded from activity", () => {
  const result = computeCashFlow({
    ledger: [
      {
        id: "cash",
        date: "2026-10-01",
        account: "cash",
        direction: "out",
        amount: 40,
        category: "journal",
        refType: "voucher",
        refId: "transfer",
      },
      {
        id: "bank",
        date: "2026-10-01",
        account: "bank",
        direction: "in",
        amount: 40,
        category: "journal",
        refType: "voucher",
        refId: "transfer",
      },
    ],
  });
  assert.equal(result.netCashFlow, 0);
  assert.equal(result.customerReceipts, 0);
  assert.equal(result.operatingExpenses, 0);
});

it("journal form rejects subcent rounding imbalance and non-finite amounts", () => {
  assert.equal(validateAccountingJournal([line("a", "A", 1, 0), line("b", "B", 0, 1)]), true);
  assert.equal(validateAccountingJournal([line("a", "A", 1.004, 0), line("b", "B", 0, 1)]), false);
  assert.equal(
    validateAccountingJournal([line("a", "A", Infinity, 0), line("b", "B", 0, Infinity)]),
    false,
  );
});

it("asset form rejects negative/non-finite values and rollover dates", () => {
  assert.equal(validateAccountingAsset("Van", "2026-10-01", 100, 0), true);
  assert.equal(validateAccountingAsset("Van", "2026-02-30", 100, 50), false);
  assert.equal(validateAccountingAsset("Van", "2026-10-01", -1, 0), false);
  assert.equal(validateAccountingAsset("Van", "2026-10-01", 1, NaN), false);
});

it("employee advances less recovered salary remain a current asset, cash voucher and ledger count once", () => {
  const advance = {
    ...voucher({ type: "payment", amount: 40, refId: "advance" }),
    refType: "salaryAdvance",
  } as unknown as Voucher;
  const paid: AccountingVoucher = {
    ...voucher({ id: "paid", type: "payment", amount: 60, refType: "payroll", refId: "r" }),
    payrollNet: 100,
    advanceRecovered: 40,
  };
  const ledger = [
    {
      id: "capital",
      date: "2026-10-01",
      account: "Owner Capital",
      category: "journal",
      direction: "out",
      amount: 200,
    },
    {
      id: "opening",
      date: "2026-10-01",
      account: "cash",
      category: "opening",
      direction: "in",
      amount: 200,
    },
    {
      id: "advance",
      date: "2026-10-01",
      account: "cash",
      category: "payment",
      direction: "out",
      amount: 40,
      refType: "salaryAdvance",
      refId: "advance",
    },
    {
      id: "paid",
      date: "2026-10-01",
      account: "cash",
      category: "expense",
      direction: "out",
      amount: 60,
      refType: "payroll",
      refId: "r",
    },
  ];
  const before = bs({ ledger: ledger.slice(0, 3), vouchers: [advance] });
  assert.equal(before.employeeAdvance, 40);
  assert.equal(before.totalAssets, 200);
  const after = bs({ ledger, vouchers: [advance, paid] });
  assert.equal(after.employeeAdvance, 0);
  assert.equal(after.cash, 100);
  assert.equal(after.retainedEarnings, -100);
  assert.equal(after.isBalanced, true);
  assert.equal(pnl({ vouchers: [paid] }).totalExpenses, 100);
});

it("asset acquisition journal affects asset balance once and never creates another cash posting", () => {
  const ledger = [
    {
      id: "opening",
      date: "2026-10-01",
      account: "cash",
      category: "opening",
      direction: "in",
      amount: 200,
    },
    {
      id: "capital",
      date: "2026-10-01",
      account: "Owner Capital",
      category: "journal",
      direction: "out",
      amount: 200,
    },
    {
      id: "cash",
      date: "2026-10-01",
      account: "cash",
      category: "journal",
      direction: "out",
      amount: 80,
      refType: "voucher",
      refId: "asset",
    },
    {
      id: "equipment",
      date: "2026-10-01",
      account: "Equipment",
      category: "journal",
      direction: "in",
      amount: 80,
      refType: "voucher",
      refId: "asset",
    },
  ];
  const jv = voucher({
    id: "asset",
    lines: [
      { ...line("equipment", "Equipment", 80, 0), notes: "[asset:a]" },
      line("cash", "cash", 0, 80),
    ],
  });
  const original = structuredClone(ledger);
  const journalOnly = bs({ ledger, vouchers: [jv] });
  assert.equal(journalOnly.fixedAssets, 80);
  assert.equal(journalOnly.cash, 120);
  assert.equal(journalOnly.isBalanced, true);
  const registered = bs({
    ledger,
    vouchers: [jv],
    assets: [
      {
        id: "a",
        name: "Drill",
        category: "Equipment",
        purchaseCost: 80,
        currentValue: 80,
        purchaseDate: "2026-10-01",
        createdAt: "2026-10-01",
      },
    ],
  });
  assert.equal(registered.fixedAssets, 80);
  assert.equal(registered.isBalanced, true);
  const unlinked = bs({
    ledger,
    vouchers: [
      { ...jv, lines: [line("equipment", "Equipment", 80, 0), line("cash", "cash", 0, 80)] },
    ],
    assets: [
      {
        id: "another",
        name: "Equipment",
        category: "Equipment",
        purchaseCost: 80,
        currentValue: 80,
        purchaseDate: "2026-10-01",
        createdAt: "2026-10-01",
      },
    ],
  });
  assert.equal(
    unlinked.fixedAssets,
    160,
    "a shared name must never silently establish an asset association",
  );
  assert.equal(unlinked.isBalanced, false);
  assert.match(unlinked.warnings.join(" "), /no linked acquisition/);
  assert.deepEqual(ledger, original);
});

it("payroll payable journal and later advance-settled payment balance without duplicate salary", () => {
  const journal = voucher({
    refType: "payroll",
    refId: "r",
    lines: [line("expense", "Salary Expense", 100, 0), line("payable", "Salary Payable", 0, 100)],
  });
  const result = bs({ vouchers: [journal] });
  assert.equal(result.journalLiabilities, 100);
  assert.equal(result.retainedEarnings, -100);
  assert.equal(result.isBalanced, true);
});

it("unknown journal accounts remain visible as warnings rather than fabricated equity", () => {
  const result = bs({
    vouchers: [
      voucher({
        lines: [line("unknown", "Mystery", 100, 0), line("capital", "Owner Capital", 0, 100)],
      }),
    ],
  });
  assert.equal(result.isBalanced, false);
  assert.match(result.warnings.join(" "), /Unclassified journal account/);
});

it("purchase VAT excluded from layers is a separate input VAT asset and reverses with supplier return", () => {
  const purchase = {
    id: "po-vat",
    orderNo: "PO-VAT",
    date: "2026-01-01",
    supplierId: "s",
    supplierName: "S",
    items: [],
    subtotal: 1000,
    tax: 100,
    total: 1100,
    paid: 0,
    status: "received",
  };
  const result = bs({
    products: [{ id: "p", stock: 10, cost: 100 }],
    costLayers: [{ id: "l", productId: "p", qtyRemaining: 10, unitCost: 100 }],
    purchases: [purchase],
  });
  assert.equal(result.inventoryValue, 1000);
  assert.equal(result.inputVat, 100);
  assert.equal(result.ap, 1100);
  assert.equal(result.isBalanced, true);
  assert.equal(bs({ purchases: [{ ...purchase, status: "draft" }] }).inputVat, 0);
  const returned = bs({
    purchases: [purchase],
    products: [{ id: "p", stock: 8, cost: 100 }],
    costLayers: [{ id: "l", productId: "p", qtyRemaining: 8, unitCost: 100 }],
    supplierReturns: [
      {
        id: "sr",
        supplierId: "s",
        supplierName: "S",
        status: "confirmed",
        subtotal: 200,
        tax: 20,
        total: 220,
      },
    ],
  });
  assert.equal(returned.inputVat, 80);
  assert.equal(returned.ap, 880);
  assert.equal(returned.isBalanced, true);
});
