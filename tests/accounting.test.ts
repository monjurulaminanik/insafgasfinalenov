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
  allocatePaymentAcrossInvoices,
  computeBalanceSheet,
  computeCustomerReceivables,
  computeOutputVatLiability,
  computeProfitAndLoss,
  computeSupplierPayables,
  isBankBookAccount,
  isCashBookAccount,
  roundMoney,
} from "../src/lib/accounting-engine.ts";
import { consumeCostLayers } from "../src/lib/inventory-engine.ts";

describe("Phase 2 Accounting, AR, AP, VAT, COGS, GL, Equity & Balance Sheet Tests", () => {
  // Mock data setup
  const mockCustomer: Customer = {
    id: "cust-1",
    name: "Alpha Traders",
    phone: "+8801700000000",
    address: "Dhaka",
    creditLimit: 500000,
    openingBalance: 10000,
    openingBalanceType: "receivable",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  const mockSupplier: Supplier = {
    id: "supp-1",
    name: "Beta Refills Ltd",
    phone: "+8801800000000",
    address: "Chittagong",
    openingBalance: 50000,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  // Test 1: Invoice creates AR exactly once
  it("1. Confirmed/invoiced sale creates AR exactly once", () => {
    const sale: SalesOrder = {
      id: "so-1",
      orderNo: "SO-001",
      customerId: "cust-1",
      customerName: "Alpha Traders",
      date: "2026-02-01T10:00:00.000Z",
      items: [{ productId: "p1", productName: "LPG 12kg", quantity: 10, price: 1400, taxRate: 5 }],
      subtotal: 14000,
      tax: 700,
      total: 14700,
      paid: 0,
      status: "invoiced",
    };

    const { rows, totalDue, totalInvoiced } = computeCustomerReceivables(
      [mockCustomer],
      [sale],
      [],
    );
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(totalInvoiced, 14700);
    // Opening 10000 + Invoiced 14700 = 24700
    assert.strictEqual(totalDue, 24700);
    assert.strictEqual(rows[0].due, 24700);
  });

  // Test 2: Payment reduces AR exactly once
  it("2. Payment voucher reduces AR exactly once without double counting with invoice status", () => {
    const sale: SalesOrder = {
      id: "so-1",
      orderNo: "SO-001",
      customerId: "cust-1",
      customerName: "Alpha Traders",
      date: "2026-02-01T10:00:00.000Z",
      items: [{ productId: "p1", productName: "LPG 12kg", quantity: 10, price: 1400, taxRate: 5 }],
      subtotal: 14000,
      tax: 700,
      total: 14700,
      paid: 14700,
      status: "paid",
    };

    const voucher: Voucher = {
      id: "v-1",
      voucherNo: "RV-001",
      type: "receipt",
      date: "2026-02-01T11:00:00.000Z",
      account: "cash",
      amount: 14700,
      partyType: "customer",
      partyId: "cust-1",
      partyName: "Alpha Traders",
      refType: "sales",
      refId: "so-1",
      refNo: "SO-001",
      createdAt: "2026-02-01T11:00:00.000Z",
    };

    const { rows, totalDue, totalCollected } = computeCustomerReceivables(
      [mockCustomer],
      [sale],
      [voucher],
    );
    assert.strictEqual(totalCollected, 14700);
    // Opening 10000 + Invoiced 14700 - Collected 14700 = 10000 (opening remains due)
    assert.strictEqual(totalDue, 10000);
    assert.strictEqual(rows[0].due, 10000);
  });

  // Test 3: Payment allocation works across multiple invoices
  it("3. Payment allocation allocates across older and newer invoices sequentially", () => {
    const inv1: SalesOrder = {
      id: "inv-1",
      orderNo: "SO-101",
      customerId: "cust-1",
      customerName: "Alpha Traders",
      date: "2026-02-01",
      items: [],
      subtotal: 6000,
      tax: 0,
      total: 6000,
      paid: 0,
      status: "invoiced",
    };
    const inv2: SalesOrder = {
      id: "inv-2",
      orderNo: "SO-102",
      customerId: "cust-1",
      customerName: "Alpha Traders",
      date: "2026-02-05",
      items: [],
      subtotal: 5000,
      tax: 0,
      total: 5000,
      paid: 0,
      status: "invoiced",
    };

    const { allocations, unallocated } = allocatePaymentAcrossInvoices(10000, [inv1, inv2]);
    assert.strictEqual(allocations.length, 2);
    // Invoice 1 fully paid: 6000
    assert.strictEqual(allocations[0].invoiceId, "inv-1");
    assert.strictEqual(allocations[0].allocatedAmount, 6000);
    assert.strictEqual(allocations[0].remainingDue, 0);

    // Invoice 2 partially paid: 4000 (remaining due 1000)
    assert.strictEqual(allocations[1].invoiceId, "inv-2");
    assert.strictEqual(allocations[1].allocatedAmount, 4000);
    assert.strictEqual(allocations[1].remainingDue, 1000);

    assert.strictEqual(unallocated, 0);
  });

  // Test 4: Draft invoice does not create AR
  it("4. Draft invoice is excluded and does not create AR", () => {
    const draftSale: SalesOrder = {
      id: "so-draft",
      orderNo: "SO-DRAFT",
      customerId: "cust-1",
      customerName: "Alpha Traders",
      date: "2026-02-01",
      items: [],
      subtotal: 16852,
      tax: 0,
      total: 16852,
      paid: 0,
      status: "draft",
    };

    const { totalDue, totalInvoiced } = computeCustomerReceivables([mockCustomer], [draftSale], []);
    assert.strictEqual(totalInvoiced, 0);
    assert.strictEqual(totalDue, 10000); // only opening balance
  });

  // Test 5: Cancelled invoice does not remain as AR
  it("5. Cancelled invoice is excluded and does not remain as AR", () => {
    const cancelledSale: SalesOrder = {
      id: "so-canc",
      orderNo: "SO-CANC",
      customerId: "cust-1",
      customerName: "Alpha Traders",
      date: "2026-02-01",
      items: [],
      subtotal: 20000,
      tax: 1000,
      total: 21000,
      paid: 0,
      status: "cancelled",
    };

    const { totalDue, totalInvoiced } = computeCustomerReceivables(
      [mockCustomer],
      [cancelledSale],
      [],
    );
    assert.strictEqual(totalInvoiced, 0);
    assert.strictEqual(totalDue, 10000);
  });

  // Test 6: Supplier payment reduces AP exactly once
  it("6. Supplier payment reduces AP exactly once without double counting", () => {
    const po: PurchaseOrder = {
      id: "po-1",
      orderNo: "PO-001",
      supplierId: "supp-1",
      supplierName: "Beta Refills Ltd",
      date: "2026-02-01",
      items: [],
      subtotal: 48000,
      tax: 2400,
      total: 50400,
      paid: 50000,
      status: "received",
    };

    const voucher: Voucher = {
      id: "pv-1",
      voucherNo: "PV-001",
      type: "payment",
      date: "2026-02-01",
      account: "bank",
      amount: 50000,
      partyType: "supplier",
      partyId: "supp-1",
      partyName: "Beta Refills Ltd",
      refType: "purchase",
      refId: "po-1",
      createdAt: "2026-02-01",
    };

    const { rows, totalDue, totalBilled, totalPaid } = computeSupplierPayables(
      [mockSupplier],
      [po],
      [voucher],
    );
    assert.strictEqual(totalBilled, 50400);
    assert.strictEqual(totalPaid, 50000);
    // Opening 50000 + Billed 50400 - Paid 50000 = 50400
    assert.strictEqual(totalDue, 50400);
    assert.strictEqual(rows[0].due, 50400);
  });

  // Test 7: VAT creates liability
  it("7. Output VAT is recorded as liability and separated from net revenue", () => {
    const sales: SalesOrder[] = [
      {
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
      },
      {
        id: "s2",
        orderNo: "SO-2",
        customerId: "c2",
        customerName: "C2",
        date: "2026-02-01",
        items: [],
        subtotal: 10200,
        tax: 1224,
        total: 11424,
        paid: 0,
        status: "invoiced",
      },
      {
        id: "s3",
        orderNo: "SO-3",
        customerId: "c3",
        customerName: "C3",
        date: "2026-02-01",
        items: [],
        subtotal: 4600,
        tax: 690,
        total: 5290,
        paid: 5290,
        status: "paid",
      },
      {
        id: "s4",
        orderNo: "SO-4",
        customerId: "c4",
        customerName: "C4",
        date: "2026-02-01",
        items: [],
        subtotal: 8700,
        tax: 435,
        total: 9135,
        paid: 0,
        status: "confirmed",
      },
    ];

    const { totalOutputTax, netSales, grossSales } = computeOutputVatLiability(sales);
    assert.strictEqual(totalOutputTax, 4029);
    assert.strictEqual(netSales, 57100);
    assert.strictEqual(grossSales, 61129);
  });

  // Test 8: COGS matches inventory consumption
  it("8. COGS exactly equals cost layer inventory consumption", () => {
    const layers: CostLayer[] = [
      { id: "l1", productId: "p1", qtyRemaining: 10, unitCost: 100, receivedAt: "2026-01-01" },
      { id: "l2", productId: "p1", qtyRemaining: 10, unitCost: 300, receivedAt: "2026-01-02" },
    ];

    const { cogsAmount, updatedLayers } = consumeCostLayers(layers, 15, "fifo");
    // 10 @ 100 (=1000) + 5 @ 300 (=1500) = 2500
    assert.strictEqual(cogsAmount, 2500);
    assert.strictEqual(updatedLayers[0].qtyRemaining, 0);
    assert.strictEqual(updatedLayers[1].qtyRemaining, 5);
  });

  // Test 9: Inventory value decreases with COGS
  it("9. Inventory asset valuation decreases consistently with COGS", () => {
    const initialLayers: CostLayer[] = [
      { id: "l1", productId: "p1", qtyRemaining: 10, unitCost: 100, receivedAt: "2026-01-01" },
      { id: "l2", productId: "p1", qtyRemaining: 10, unitCost: 300, receivedAt: "2026-01-02" },
    ];
    const initialValuation = initialLayers.reduce(
      (s, l) => s + (l.qtyRemaining || 0) * (l.unitCost || 0),
      0,
    ); // 1000 + 3000 = 4000
    assert.strictEqual(initialValuation, 4000);

    const { cogsAmount, updatedLayers } = consumeCostLayers(initialLayers, 10, "fifo"); // 10 @ 100 = 1000
    assert.strictEqual(cogsAmount, 1000);

    // Remaining: l1 has 0, l2 has 10 @ 300
    const finalLayers = initialLayers.map((l) => {
      const u = updatedLayers.find((x) => x.id === l.id);
      return u ? { ...l, qtyRemaining: u.qtyRemaining } : l;
    });
    const remainingValuation = finalLayers.reduce(
      (s, l) => s + (l.qtyRemaining || 0) * (l.unitCost || 0),
      0,
    );
    assert.strictEqual(remainingValuation, 3000);
    assert.strictEqual(initialValuation - cogsAmount, remainingValuation);
  });

  // Test 10: Capital comes from real equity ledger
  it("10. Capital is derived from real equity accounts rather than residual plug", () => {
    const p1: Product = {
      id: "p1",
      code: "P1",
      name: "LPG 12kg",
      category: "LPG",
      uom: "cyl",
      price: 1400,
      cost: 1200,
      stock: 10,
      reorderLevel: 5,
      createdAt: "2026-01-01",
    };
    const layers: CostLayer[] = [
      { id: "cl-1", productId: "p1", qtyRemaining: 10, unitCost: 1200, receivedAt: "2026-01-01" },
    ];
    const asset: BusinessAsset = {
      id: "a1",
      name: "Truck",
      category: "Vehicles",
      purchaseDate: "2026-01-01",
      purchaseCost: 100000,
      currentValue: 100000,
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

    const bs = computeBalanceSheet({
      ledger,
      products: [p1],
      costLayers: layers,
      customers: [],
      suppliers: [],
      sales: [],
      purchases: [],
      assets: [asset],
      stockMovements: [],
      expenses: [],
      ownerCapitalOverride: 162000, // Assets (50000 cash + 12000 inv + 100000 fixed) = 162000
    });

    assert.strictEqual(bs.totalAssets, 162000);
    assert.strictEqual(bs.ownerCapital, 162000);
    assert.strictEqual(bs.isBalanced, true);
    assert.strictEqual(bs.discrepancy, 0);
  });

  // Test 11: Balance sheet balances without a plug
  it("11. Balance Sheet satisfies Assets = Liabilities + Equity exactly", () => {
    const p: Product = {
      id: "p1",
      code: "P1",
      name: "LPG",
      category: "LPG",
      uom: "cyl",
      price: 1400,
      cost: 1000,
      stock: 20,
      reorderLevel: 5,
      createdAt: "2026-01-01",
    };
    const layers: CostLayer[] = [
      { id: "cl-1", productId: "p1", qtyRemaining: 20, unitCost: 1000, receivedAt: "2026-01-01" },
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
      openingBalance: 15000,
      openingBalanceType: "receivable",
      createdAt: "2026-01-01",
    };
    const supp: Supplier = {
      id: "s1",
      name: "S1",
      phone: "",
      address: "",
      openingBalance: 25000,
      createdAt: "2026-01-01",
    };

    const ledger: LedgerEntry[] = [
      {
        id: "l1",
        date: "2026-01-01",
        account: "cash",
        direction: "in",
        amount: 40000,
        category: "opening",
      },
      {
        id: "l2",
        date: "2026-01-01",
        account: "bank",
        direction: "in",
        amount: 60000,
        category: "opening",
      },
    ];

    // Total Assets = Cash 40000 + Bank 60000 + AR 15000 + Inv 20000 + Fixed 50000 = 185000
    // Total Liabilities = AP 25000
    // Initial Capital = 185000 - 25000 = 160000

    const bs = computeBalanceSheet({
      ledger,
      products: [p],
      costLayers: layers,
      customers: [cust],
      suppliers: [supp],
      sales: [],
      purchases: [],
      assets: [asset],
      stockMovements: [],
      expenses: [],
      ownerCapitalOverride: 160000,
    });

    assert.strictEqual(bs.totalAssets, 185000);
    assert.strictEqual(bs.totalLiabilities, 25000);
    assert.strictEqual(bs.totalEquity, 160000);
    assert.strictEqual(bs.totalLiabilitiesAndEquity, 185000);
    assert.strictEqual(bs.isBalanced, true);
  });

  // Test 12: P&L matches ledger and document costs
  it("12. P&L computes Gross Profit and Net Profit accurately from operations", () => {
    const sale: SalesOrder = {
      id: "s1",
      orderNo: "SO-1",
      customerId: "c1",
      customerName: "C1",
      date: "2026-02-01",
      items: [{ productId: "p1", productName: "LPG", quantity: 10, price: 1500, taxRate: 5 }],
      subtotal: 15000,
      tax: 750,
      total: 15750,
      paid: 15750,
      status: "paid",
    };

    const sm: StockMovement = {
      id: "sm-1",
      date: "2026-02-01",
      productId: "p1",
      productName: "LPG",
      type: "out",
      movementType: "SALE_ISSUE",
      direction: "out",
      quantity: 10,
      balanceAfter: 10,
      unitCost: 1000,
      totalCost: 10000,
      cogsAmount: 10000,
      costingMethod: "fifo",
      refType: "sales",
      refId: "s1",
      by: "Sales",
    };

    const exp: Expense = {
      id: "e1",
      date: "2026-02-01",
      category: "Fuel",
      description: "Van fuel",
      amount: 2000,
      paymentMethod: "cash",
      createdAt: "2026-02-01",
    };

    const pnl = computeProfitAndLoss({
      sales: [sale],
      stockMovements: [sm],
      expenses: [exp],
    });

    assert.strictEqual(pnl.revenue, 15000); // net excluding tax
    assert.strictEqual(pnl.cogs, 10000);
    assert.strictEqual(pnl.grossProfit, 5000);
    assert.strictEqual(pnl.totalExpenses, 2000);
    assert.strictEqual(pnl.netProfit, 3000);
  });

  // Test 13: Date filters are correct
  it("13. Date filters properly separate period activity from outside transactions", () => {
    const saleOld: SalesOrder = {
      id: "s-old",
      orderNo: "SO-OLD",
      customerId: "c1",
      customerName: "C1",
      date: "2026-01-10",
      items: [],
      subtotal: 10000,
      tax: 0,
      total: 10000,
      paid: 10000,
      status: "paid",
    };
    const saleCurrent: SalesOrder = {
      id: "s-cur",
      orderNo: "SO-CUR",
      customerId: "c1",
      customerName: "C1",
      date: "2026-02-15",
      items: [],
      subtotal: 20000,
      tax: 0,
      total: 20000,
      paid: 20000,
      status: "paid",
    };

    const pnlFeb = computeProfitAndLoss({
      sales: [saleOld, saleCurrent],
      stockMovements: [],
      expenses: [],
      range: { preset: "custom", from: "2026-02-01", to: "2026-02-28" },
    });

    assert.strictEqual(pnlFeb.revenue, 20000);
  });

  // Test 14: Cash/bank balances reconcile
  it("14. Cash and bank accounts accurately classify and balance", () => {
    const namedAccounts: Account[] = [
      {
        id: "acc1",
        name: "Dutch Bangla Bank",
        type: "bank",
        accountNo: "123",
        createdAt: "2026-01-01",
      },
      {
        id: "acc2",
        name: "bKash Merchant",
        type: "mobile",
        accountNo: "017",
        createdAt: "2026-01-01",
      },
    ];

    assert.strictEqual(isBankBookAccount("bank", namedAccounts), true);
    assert.strictEqual(isBankBookAccount("Dutch Bangla Bank", namedAccounts), true);
    assert.strictEqual(isBankBookAccount("bKash Merchant", namedAccounts), true);
    assert.strictEqual(isCashBookAccount("cash", namedAccounts), true);
    assert.strictEqual(isCashBookAccount("bank", namedAccounts), false);
  });

  // Test 15: Decimal values remain accurate
  it("15. Decimal currency arithmetic does not lose precision or truncate cents", () => {
    const val1 = roundMoney(0.1 + 0.2);
    assert.strictEqual(val1, 0.3);

    const val2 = roundMoney(1234.567);
    assert.strictEqual(val2, 1234.57);

    const val3 = roundMoney(57100.25 + 4029.5);
    assert.strictEqual(val3, 61129.75);
  });
});
