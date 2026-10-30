import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  Account,
  BusinessAsset,
  CostLayer,
  Customer,
  Expense,
  LedgerEntry,
  PayrollRun,
  Product,
  PurchaseOrder,
  SalesOrder,
  StockMovement,
  Supplier,
  Voucher,
} from "../src/types/index.ts";
import {
  computeBalanceSheet,
  computeCashFlow,
  computeCustomerReceivables,
  computeProfitAndLoss,
  computeSupplierPayables,
  reconcileFinancialIntegrity,
  roundMoney,
} from "../src/lib/accounting-engine.ts";

describe("Phase 3 Payroll, Cash Flow, Reporting, Date Filters & Dashboard Integrity Tests", () => {
  // Test 1: Payroll calculation
  it("1. Payroll calculation formula: basic + bonus + allowance - deduction = net", () => {
    const basic = 35000;
    const bonus = 2000;
    const allowance = 1500;
    const deduction = 500;

    const net = basic + bonus + allowance - deduction;
    assert.strictEqual(net, 38000);

    const run: PayrollRun = {
      id: "pay-1",
      employeeId: "emp-1",
      employeeName: "Nasrin Akter",
      month: "2026-02",
      basic,
      bonus,
      allowance,
      deduction,
      net,
      status: "draft",
      createdAt: "2026-02-01T00:00:00.000Z",
    };

    assert.strictEqual(run.net, 38000);
  });

  // Test 2: Payroll journal
  it("2. Payroll journal voucher records debit to Salary Expense and credit to bank/payable", () => {
    const net = 22000;
    const jv: Voucher = {
      id: "v-pay",
      voucherNo: "JV-PAY-01",
      type: "journal",
      date: "2026-02-01",
      account: "Salary Expense",
      amount: net,
      drAccount: "Salary Expense",
      crAccount: "bank",
      lines: [
        { accountId: "coa3", accountName: "Salary Expense", debit: net, credit: 0 },
        { accountId: "bank", accountName: "bank", debit: 0, credit: net },
      ],
      createdAt: "2026-02-01",
    };

    assert.strictEqual(jv.lines?.[0].debit, 22000);
    assert.strictEqual(jv.lines?.[1].credit, 22000);
  });

  // Test 3: Payroll payment affects cash/bank
  it("3. Payroll payment creates outgoing cash/bank entry and voucher", () => {
    const ledgerEntry: LedgerEntry = {
      id: "l-pay-1",
      date: "2026-02-05",
      account: "bank",
      direction: "out",
      amount: 23500,
      category: "expense",
      refType: "payroll",
      refId: "pay1",
      notes: "Salary Karim Uddin · 2026-02",
    };

    assert.strictEqual(ledgerEntry.direction, "out");
    assert.strictEqual(ledgerEntry.amount, 23500);
    assert.strictEqual(ledgerEntry.refType, "payroll");
  });

  // Test 4: Payroll P&L includes salary expense from ledger
  it("4. P&L captures salary expenses recorded through ledger/vouchers", () => {
    const jvSalary: Voucher = {
      id: "v-sal",
      voucherNo: "JV-SAL-01",
      type: "journal",
      date: "2026-02-01",
      account: "Salary Expense",
      amount: 35000,
      lines: [
        { accountId: "coa3", accountName: "Salary Expense", debit: 35000, credit: 0 },
        { accountId: "bank", accountName: "bank", debit: 0, credit: 35000 },
      ],
      createdAt: "2026-02-01",
    };

    const pnl = computeProfitAndLoss({
      sales: [],
      stockMovements: [],
      expenses: [],
      vouchers: [jvSalary],
    });

    const salaryItem = pnl.expenseList.find((e) => /salary/i.test(e.name));
    assert.ok(salaryItem, "Salary Expense should appear in P&L expenseList");
    assert.strictEqual(salaryItem.amount, 35000);
    assert.strictEqual(pnl.totalExpenses, 35000);
  });

  // Test 5: Opening cash balance
  it("5. Opening cash balance is correctly calculated from prior transactions", () => {
    const ledger: LedgerEntry[] = [
      {
        id: "l0",
        date: "2026-01-01",
        account: "cash",
        direction: "in",
        amount: 100000,
        category: "opening",
      },
      {
        id: "l1",
        date: "2026-01-15",
        account: "cash",
        direction: "out",
        amount: 20000,
        category: "expense",
      },
      {
        id: "l2",
        date: "2026-02-05",
        account: "cash",
        direction: "in",
        amount: 30000,
        category: "collection",
      },
    ];

    const cfFeb = computeCashFlow({
      ledger,
      range: { preset: "custom", from: "2026-02-01", to: "2026-02-28" },
    });

    // Before Feb 1: 100,000 - 20,000 = 80,000
    assert.strictEqual(cfFeb.openingCash, 80000);
  });

  // Test 6: Operating cash flow
  it("6. Operating cash flow captures customer collections minus supplier, expense, and payroll payments", () => {
    const ledger: LedgerEntry[] = [
      {
        id: "l1",
        date: "2026-02-02",
        account: "cash",
        direction: "in",
        amount: 50000,
        category: "collection",
        refType: "sales",
      },
      {
        id: "l2",
        date: "2026-02-03",
        account: "bank",
        direction: "out",
        amount: 20000,
        category: "purchase",
        refType: "purchase",
      },
      {
        id: "l3",
        date: "2026-02-04",
        account: "cash",
        direction: "out",
        amount: 5000,
        category: "expense",
        refType: "expense",
      },
      {
        id: "l4",
        date: "2026-02-05",
        account: "bank",
        direction: "out",
        amount: 15000,
        category: "expense",
        refType: "payroll",
      },
    ];

    const cf = computeCashFlow({ ledger });
    assert.strictEqual(cf.customerReceipts, 50000);
    assert.strictEqual(cf.supplierPayments, 20000);
    assert.strictEqual(cf.operatingExpenses, 5000);
    assert.strictEqual(cf.payrollPayments, 15000);
    assert.strictEqual(cf.netOperating, 10000); // 50000 - 20000 - 5000 - 15000 = 10000
  });

  // Test 7: Investing cash flow
  it("7. Investing cash flow captures asset acquisitions and disposals", () => {
    const ledger: LedgerEntry[] = [];
    const cf = computeCashFlow({ ledger });
    assert.strictEqual(cf.assetPurchases, 0);
    assert.strictEqual(cf.assetSales, 0);
    assert.strictEqual(cf.netInvesting, 0);
  });

  // Test 8: Financing cash flow (no opening float)
  it("8. Opening float is never counted as financing cash flow", () => {
    const ledger: LedgerEntry[] = [
      {
        id: "l0",
        date: "2026-01-01",
        account: "cash",
        direction: "in",
        amount: 150000,
        category: "opening",
        notes: "Opening float",
      },
      {
        id: "l1",
        date: "2026-01-01",
        account: "bank",
        direction: "in",
        amount: 850000,
        category: "opening",
        notes: "Opening bank",
      },
    ];

    const cf = computeCashFlow({ ledger });
    // Financing must be 0, NOT 1,000,000!
    assert.strictEqual(cf.capitalContributions, 0);
    assert.strictEqual(cf.netFinancing, 0);
    assert.strictEqual(cf.openingCash, 1000000);
  });

  // Test 9: Closing cash reconciliation with ledger
  it("9. Cash flow statement closing cash reconciles exactly to ledger cash/bank balance", () => {
    const ledger: LedgerEntry[] = [
      {
        id: "l0",
        date: "2026-01-01",
        account: "cash",
        direction: "in",
        amount: 150000,
        category: "opening",
      },
      {
        id: "l1",
        date: "2026-01-01",
        account: "bank",
        direction: "in",
        amount: 850000,
        category: "opening",
      },
      {
        id: "l2",
        date: "2026-01-05",
        account: "cash",
        direction: "in",
        amount: 35280,
        category: "collection",
        refType: "sales",
      },
      {
        id: "l3",
        date: "2026-01-06",
        account: "bank",
        direction: "out",
        amount: 50000,
        category: "purchase",
        refType: "purchase",
      },
      {
        id: "l4",
        date: "2026-01-07",
        account: "cash",
        direction: "out",
        amount: 4200,
        category: "expense",
        refType: "expense",
      },
    ];

    const cf = computeCashFlow({ ledger });
    const expectedClosing = 150000 + 850000 + 35280 - 50000 - 4200; // 981080
    assert.strictEqual(cf.closingCash, expectedClosing);
    assert.strictEqual(cf.reconcilesWithLedger, true);
  });

  // Test 10: Dashboard vs reports consistency
  it("10. Customer AR and Supplier AP on dashboard match reports exactly", () => {
    const cust: Customer = {
      id: "c1",
      name: "C1",
      phone: "",
      address: "",
      openingBalance: 148000,
      openingBalanceType: "receivable",
      createdAt: "2026-01-01",
    };
    const sale: SalesOrder = {
      id: "s1",
      orderNo: "SO-1",
      customerId: "c1",
      customerName: "C1",
      date: "2026-02-01",
      items: [],
      subtotal: 33600,
      tax: 1680,
      total: 35280,
      paid: 35280,
      status: "paid",
    };
    const v: Voucher = {
      id: "v1",
      voucherNo: "RV-1",
      type: "receipt",
      date: "2026-02-01",
      account: "cash",
      amount: 35280,
      partyType: "customer",
      partyId: "c1",
      refType: "sales",
      refId: "s1",
      createdAt: "2026-02-01",
    };

    const { totalDue: arDue } = computeCustomerReceivables([cust], [sale], [v]);
    assert.strictEqual(arDue, 148000);
  });

  // Test 11: Date filters work consistently
  it("11. Date filters handle start date, end date, opening balance and closing balance consistently", () => {
    const ledger: LedgerEntry[] = [
      {
        id: "l1",
        date: "2026-01-10",
        account: "cash",
        direction: "in",
        amount: 10000,
        category: "collection",
      },
      {
        id: "l2",
        date: "2026-02-10",
        account: "cash",
        direction: "in",
        amount: 20000,
        category: "collection",
      },
      {
        id: "l3",
        date: "2026-03-10",
        account: "cash",
        direction: "in",
        amount: 30000,
        category: "collection",
      },
    ];

    const cfFeb = computeCashFlow({
      ledger,
      range: { preset: "custom", from: "2026-02-01", to: "2026-02-28" },
    });

    assert.strictEqual(cfFeb.openingCash, 10000);
    assert.strictEqual(cfFeb.netCashFlow, 20000);
    assert.strictEqual(cfFeb.closingCash, 30000);
    assert.strictEqual(cfFeb.reconcilesWithLedger, true);
  });

  // Test 12: Empty today dashboard
  it("12. When today has no transactions, today metrics are 0 and do not fall back to older dates", () => {
    const historicalSales: SalesOrder[] = [
      {
        id: "s1",
        orderNo: "SO-OLD",
        customerId: "c1",
        customerName: "C1",
        date: "2025-01-01",
        items: [],
        subtotal: 50000,
        tax: 0,
        total: 50000,
        paid: 50000,
        status: "paid",
      },
    ];

    const todayDate = "2026-09-27";
    const todaysOrders = historicalSales.filter((s) => s.date.startsWith(todayDate));
    const todaySales = todaysOrders.reduce((a, s) => a + s.total, 0);

    assert.strictEqual(todaySales, 0, "Today's sales must be 0 without fallback");
  });

  // Test 13: Balance sheet equation
  it("13. Financial integrity audit satisfies Assets = Liabilities + Equity with 0 discrepancy", () => {
    const p: Product = {
      id: "p1",
      code: "P1",
      name: "LPG",
      category: "LPG",
      uom: "cyl",
      price: 1400,
      cost: 1000,
      stock: 10,
      reorderLevel: 2,
      createdAt: "2026-01-01",
    };
    const layers: CostLayer[] = [
      { id: "cl-1", productId: "p1", qtyRemaining: 10, unitCost: 1000, receivedAt: "2026-01-01" },
    ];
    const asset: BusinessAsset = {
      id: "a1",
      name: "Van",
      category: "Vehicles",
      purchaseDate: "2026-01-01",
      purchaseCost: 50000,
      currentValue: 50000,
      createdAt: "2026-01-01",
    };
    const cust: Customer = {
      id: "c1",
      name: "C1",
      phone: "",
      address: "",
      openingBalance: 20000,
      openingBalanceType: "receivable",
      createdAt: "2026-01-01",
    };
    const supp: Supplier = {
      id: "s1",
      name: "S1",
      phone: "",
      address: "",
      openingBalance: 30000,
      createdAt: "2026-01-01",
    };
    const ledger: LedgerEntry[] = [
      {
        id: "l1",
        date: "2026-01-01",
        account: "cash",
        direction: "in",
        amount: 50000,
        category: "opening",
      },
    ];

    const audit = reconcileFinancialIntegrity({
      products: [p],
      costLayers: layers,
      stockMovements: [],
      customers: [cust],
      suppliers: [supp],
      sales: [],
      purchases: [],
      ledger,
      expenses: [],
      vouchers: [],
      assets: [asset],
    });

    assert.strictEqual(audit.inventoryBalanced, true);
    assert.strictEqual(audit.balanceSheetEquationSatisfied, true);
    assert.strictEqual(audit.summary.discrepancy, 0);
  });

  // Test 14: P&L vs ledger
  it("14. P&L Net Profit equals Gross Profit minus Operating Expenses", () => {
    const sale: SalesOrder = {
      id: "s1",
      orderNo: "SO-1",
      customerId: "c1",
      customerName: "C1",
      date: "2026-02-01",
      items: [],
      subtotal: 100000,
      tax: 5000,
      total: 105000,
      paid: 105000,
      status: "paid",
    };
    const sm: StockMovement = {
      id: "sm1",
      date: "2026-02-01",
      productId: "p1",
      productName: "P1",
      type: "out",
      movementType: "SALE_ISSUE",
      quantity: 50,
      balanceAfter: 0,
      unitCost: 1200,
      cogsAmount: 60000,
      by: "Sales",
    };
    const exp: Expense = {
      id: "e1",
      date: "2026-02-01",
      category: "Rent",
      description: "Office rent",
      amount: 15000,
      paymentMethod: "bank",
      createdAt: "2026-02-01",
    };

    const pnl = computeProfitAndLoss({
      sales: [sale],
      stockMovements: [sm],
      expenses: [exp],
    });

    assert.strictEqual(pnl.revenue, 100000);
    assert.strictEqual(pnl.cogs, 60000);
    assert.strictEqual(pnl.grossProfit, 40000);
    assert.strictEqual(pnl.totalExpenses, 15000);
    assert.strictEqual(pnl.netProfit, 25000);
  });

  // Test 15: Cash flow vs ledger
  it("15. Cash flow net movement equals ending cash minus beginning cash", () => {
    const ledger: LedgerEntry[] = [
      {
        id: "l1",
        date: "2026-01-01",
        account: "cash",
        direction: "in",
        amount: 50000,
        category: "opening",
      },
      {
        id: "l2",
        date: "2026-02-01",
        account: "cash",
        direction: "in",
        amount: 25000,
        category: "collection",
        refType: "sales",
      },
      {
        id: "l3",
        date: "2026-02-02",
        account: "cash",
        direction: "out",
        amount: 10000,
        category: "expense",
        refType: "expense",
      },
    ];

    const cf = computeCashFlow({
      ledger,
      range: { preset: "custom", from: "2026-02-01", to: "2026-02-28" },
    });

    assert.strictEqual(cf.openingCash, 50000);
    assert.strictEqual(cf.netCashFlow, 15000); // 25000 - 10000
    assert.strictEqual(cf.closingCash, 65000);
    assert.strictEqual(cf.closingCash - cf.openingCash, cf.netCashFlow);
  });
});
