// Run: npx tsx --test tests/business-day.test.ts (Node >= 22.15).
// Real purchase/adjustment/payroll code and real client sales/delivery services;
// only the services' CRUD and settings RPC boundaries are replaced. No live DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { MemoryDb } from "./helpers/memory-db.ts";
import { executePurchaseReceive } from "../src/lib/purchase.functions.ts";
import { adjustStockInDb, type StockAdjustmentInput } from "../src/lib/stock-adjustment.server.ts";
import { executePayrollTransaction } from "../src/lib/payroll.server.ts";
import { computeProfitAndLoss, computeBalanceSheet } from "../src/lib/accounting-engine.ts";
import { buildStockReport } from "../src/lib/stock-report.ts";
import { reconcileDatabaseInventory } from "../src/lib/inventory.server.ts";
import type { Product, PurchaseOrder } from "../src/types/index.ts";

const date = "2026-10-01";
const at = `${date}T12:00:00+06:00`;
const product: Product = {
  id: "business-regulator",
  code: "REG",
  name: "Regulator",
  productType: "product",
  category: "General",
  uom: "pcs",
  stock: 0,
  openingStock: 0,
  cost: 0,
  price: 200,
  reorderLevel: 0,
  costingMethod: "fifo",
  createdAt: "2026-09-01T00:00:00Z",
};
const po = (id: string, quantity = 10, price = 100): PurchaseOrder => ({
  id,
  orderNo: id,
  supplierId: "supplier",
  supplierName: "Supplier",
  date,
  items: [
    {
      productId: product.id,
      productName: product.name,
      itemType: "product",
      quantity,
      orderedQty: quantity,
      receivedQty: 0,
      price,
    },
  ],
  subtotal: quantity * price,
  tax: 0,
  total: quantity * price,
  paid: 0,
  status: "ordered",
});
const fresh = () =>
  new MemoryDb({
    products: [product],
    purchases: [po("PO-A"), po("PO-B", 5, 160)],
    employees: [{ id: "employee", name: "Driver", status: "active", joiningDate: "2026-01-01" }],
  });
const value = (db: MemoryDb) =>
  db.rows("costLayers").reduce((sum, layer) => sum + layer.qtyRemaining * layer.unitCost, 0);
const stock = (db: MemoryDb) => db.rows("products")[0].stock;
const adjustment = (overrides: Partial<StockAdjustmentInput> = {}): StockAdjustmentInput => ({
  productId: product.id,
  quantity: 1,
  type: "out",
  notes: "Physical stock count",
  date,
  requestId: "adjust-request-001",
  ...overrides,
});
const adjust = (db: MemoryDb, input: StockAdjustmentInput) =>
  adjustStockInDb(db, null, input, "Tester");
const payroll = (db: MemoryDb, data: Parameters<typeof executePayrollTransaction>[2]) =>
  executePayrollTransaction(db as any, db.client as any, data, { username: "tester" });

// Node hooks intercept only the client service RPC module imports. The stock,
// delivery, costing and reporting implementations themselves are never mocked.
let activeDb: MemoryDb;
const boundaryKey = Symbol.for("insaf.business-day.memory-crud");
(globalThis as any)[boundaryKey] = (args: any) => activeDb.crud(args);
const rpcModule = `export const crudFn = args => globalThis[Symbol.for('insaf.business-day.memory-crud')](args); export const dashboardFn = () => { throw Error('Unexpected dashboard RPC'); }; export const notificationsFn = () => { throw Error('Unexpected notification RPC'); };`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.replaceAll("\\", "/").includes("/src/services/_services.ts")) {
      if (specifier === "@/lib/data.functions")
        return { url: `data:text/javascript,${encodeURIComponent(rpcModule)}`, shortCircuit: true };
      if (specifier === "@/lib/settings.functions")
        return {
          url: "data:text/javascript,export const getCylinderTrackingFn = async () => 'quantity'",
          shortCircuit: true,
        };
    }
    return next(specifier, context);
  },
});
const { salesService, deliveryService } = await import("../src/services/_services.ts");
hooks.deregister();

test("actual purchase partial receipt, replay, final receipt replay and mixed-price valuation", async () => {
  const db = fresh();
  assert.equal(stock(db), 0, "PO creation must not receive stock");
  const first = await executePurchaseReceive(
    db,
    null,
    "PO-A",
    { qtyByItem: [4], requestId: "receipt-partial" },
    "quantity",
  );
  assert.equal(first.status, "partial");
  assert.equal(first.items[0].receivedQty, 4);
  assert.equal(stock(db), 4);
  assert.equal(value(db), 400);
  const beforeRetry = db.snapshot();
  assert.deepEqual(
    await executePurchaseReceive(
      db,
      null,
      "PO-A",
      { qtyByItem: [4], requestId: "receipt-partial" },
      "quantity",
    ),
    first,
  );
  assert.deepEqual(db.snapshot(), beforeRetry);
  const beforeInvalid = db.snapshot();
  await assert.rejects(
    executePurchaseReceive(db, null, "PO-A", { qtyByItem: [7], requestId: "too-much" }, "quantity"),
    /exceeds/,
  );
  assert.deepEqual(db.snapshot(), beforeInvalid);
  const final = await executePurchaseReceive(
    db,
    null,
    "PO-A",
    { qtyByItem: [6], requestId: "receipt-final" },
    "quantity",
  );
  assert.equal(final.status, "received");
  const beforeFinalRetry = db.snapshot();
  assert.deepEqual(
    await executePurchaseReceive(
      db,
      null,
      "PO-A",
      { qtyByItem: [6], requestId: "receipt-final" },
      "quantity",
    ),
    final,
  );
  assert.deepEqual(db.snapshot(), beforeFinalRetry);
  await executePurchaseReceive(db, null, "PO-B", { requestId: "receipt-cost-160" }, "quantity");
  assert.equal(stock(db), 15);
  assert.equal(value(db), 1800);
  assert.equal(db.rows("products")[0].cost, 120);
  assert.equal(db.rows("productInventory")[0].totalValue, 1800);
  assert.equal(db.rows("productInventory")[0].costPrice, 120);
  assert.equal(db.rows("stockMovements").length, 3);
  assert.equal(db.rows("costLayers").length, 3);
});

test("business day: actual purchase → client sales/delivery FIFO → count loss/gain → payroll → statements", async () => {
  const db = fresh();
  activeDb = db;
  await executePurchaseReceive(db, null, "PO-A", { requestId: "day-receipt-A" }, "quantity");
  await executePurchaseReceive(db, null, "PO-B", { requestId: "day-receipt-B" }, "quantity");
  const order = await salesService.create({
    orderNo: "SO-DAY",
    customerId: "customer",
    customerName: "Customer",
    date,
    items: [
      {
        productId: product.id,
        productName: product.name,
        itemType: "product",
        quantity: 6,
        price: 200,
      },
    ],
    subtotal: 1200,
    tax: 0,
    total: 1200,
    paid: 0,
    status: "confirmed",
  });
  // Production currently reserves/creates a pending delivery on sale creation.
  assert.equal(stock(db), 15);
  const delivery = db.rows("deliveries")[0];
  await deliveryService.confirm(delivery.id);
  assert.equal(stock(db), 9);
  assert.equal(value(db), 1200);
  const issues = db.rows("stockMovements").filter((m) => m.type === "out");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].cogsAmount, 600);
  assert.equal(issues[0].refType, "delivery");
  await salesService.update(order.id, { status: "invoiced" });
  const beforeRepeat = db.snapshot();
  await assert.rejects(deliveryService.confirm(delivery.id), /Already confirmed/);
  assert.deepEqual(db.snapshot(), beforeRepeat, "delivery retry must not deduct twice");
  const loss = await adjust(db, adjustment({ quantity: 2, requestId: "day-count-loss" }));
  assert.equal(loss?.totalCost, 200);
  assert.equal(stock(db), 7);
  assert.equal(value(db), 1000);
  assert.equal(db.rows("productInventory")[0].totalValue, 1000);
  const gain = await adjust(
    db,
    adjustment({ type: "in", quantity: 1, requestId: "day-count-gain" }),
  );
  assert.ok(Math.abs(gain!.totalCost! - 1000 / 7) < 1e-8);
  assert.equal(stock(db), 8);
  const advance = {
    action: "advance" as const,
    employeeId: "employee",
    amount: 100,
    date: at,
    paymentMethod: "cash" as const,
    requestId: "00000000-0000-4000-8000-000000000001",
  };
  await payroll(db, advance);
  await payroll(db, advance);
  const run = (await payroll(db, {
    action: "save",
    employeeId: "employee",
    month: "2026-10",
    basic: 300,
    bonus: 0,
    allowance: 0,
    deduction: 0,
  })) as any;
  const payment = {
    action: "pay" as const,
    id: run.id,
    method: "cash" as const,
    paymentDate: at,
    advanceRecovery: 100,
    requestId: "00000000-0000-4000-8000-000000000002",
  };
  const paid = (await payroll(db, payment)) as any;
  assert.equal(paid.cashPaid, 200);
  assert.deepEqual(paid.advanceSettlements, [
    { advanceId: `advance-${advance.requestId}`, amount: 100 },
  ]);
  const beforePaymentRetry = db.snapshot();
  await payroll(db, payment);
  // The employee revision is a real lock touch even on an idempotent retry.
  for (const name of ["payroll", "salaryAdvances", "vouchers", "ledger"])
    assert.deepEqual(db.rows(name), beforePaymentRetry[name]);
  assert.equal(
    db.rows("ledger").reduce((sum, row) => sum + row.amount, 0),
    300,
  );
  const inputs = {
    sales: db.rows("sales"),
    stockMovements: db.rows("stockMovements"),
    expenses: [],
    payroll: db.rows("payroll"),
    vouchers: db.rows("vouchers"),
  } as any;
  const pnl = computeProfitAndLoss(inputs);
  assert.equal(pnl.revenue, 1200);
  assert.equal(pnl.cogs, 600);
  assert.equal(pnl.expenseList.find((row) => row.name === "Salaries")?.amount, 300);
  assert.equal(pnl.netProfit, 242.86);
  // Opening funding is a fixture; every operating entry comes from real helpers.
  const sheet = computeBalanceSheet({
    ...inputs,
    ledger: [
      {
        id: "capital",
        date,
        account: "cash",
        direction: "in",
        amount: 1000,
        category: "receipt",
        refType: "equity",
        notes: "Owner capital",
      },
      ...db.rows("ledger"),
    ],
    products: db.rows("products"),
    costLayers: db.rows("costLayers"),
    customers: [],
    suppliers: [],
    purchases: db.rows("purchases"),
    assets: [],
  });
  assert.equal(sheet.inventoryValue, 1142.86);
  assert.equal(sheet.cash, 700);
  assert.equal(sheet.ar, 1200);
  assert.equal(sheet.ap, 1800);
  assert.equal(sheet.retainedEarnings, pnl.netProfit);
  assert.equal(sheet.isBalanced, true, `Balance discrepancy: ${sheet.discrepancy}`);
});

test("adjustment direct: FIFO decrease, increase, same-key replay, changed-key payload rejection and set zero", async () => {
  const db = fresh();
  await executePurchaseReceive(db, null, "PO-A", { requestId: "adjust-receipt-A" }, "quantity");
  await executePurchaseReceive(db, null, "PO-B", { requestId: "adjust-receipt-B" }, "quantity");
  const input = adjustment({ quantity: 12 });
  const loss = await adjust(db, input);
  assert.equal(loss?.totalCost, 1320);
  assert.equal(stock(db), 3);
  assert.equal(value(db), 480);
  assert.equal(db.rows("productInventory")[0].totalValue, 480);
  assert.deepEqual(
    db.rows("costLayers").map((layer) => layer.qtyRemaining),
    [0, 3],
  );
  const before = db.snapshot();
  const replay = await adjust(db, input);
  assert.equal(replay?.id, loss?.id);
  assert.deepEqual(db.snapshot(), before);
  await assert.rejects(adjust(db, { ...input, quantity: 1 }), /different data/);
  assert.deepEqual(db.snapshot(), before);
  await adjust(db, adjustment({ type: "in", quantity: 2, requestId: "adjust-gain-002" }));
  assert.equal(stock(db), 5);
  assert.equal(value(db), 800);
  assert.equal(db.rows("productInventory")[0].totalValue, 800);
  await adjust(db, adjustment({ type: "adjust", quantity: 0, requestId: "adjust-zero-003" }));
  assert.equal(stock(db), 0);
  assert.equal(value(db), 0);
  assert.equal(db.rows("productInventory")[0].totalValue, 0);
  const zero = db.snapshot();
  assert.equal(
    await adjust(db, adjustment({ type: "adjust", quantity: 0, requestId: "adjust-noop-004" })),
    null,
  );
  for (const table of ["stockMovements", "costLayers", "auditLogs"])
    assert.deepEqual(db.rows(table), zero[table]);
  assert.equal(stock(db), 0);
  assert.equal(db.rows("auditLogs").length, 3);
});

test("zero-delta stock count retry does not undo a subsequent receipt", async () => {
  const db = fresh();
  const input = adjustment({ type: "adjust", quantity: 0, requestId: "zero-count-retry-001" });
  assert.equal(await adjust(db, input), null);
  await executePurchaseReceive(db, null, "PO-A", { requestId: "later-receipt" }, "quantity");
  const before = db.snapshot();
  assert.equal(await adjust(db, input), null);
  assert.deepEqual(db.snapshot(), before);
  assert.equal(stock(db), 10);
});

test("weighted-average stock adjustment keeps layer, inventory and balance-sheet valuations equal", async () => {
  const db = fresh();
  await db
    .collection("products")
    .updateOne({ id: product.id }, { $set: { costingMethod: "average" } });
  await executePurchaseReceive(db, null, "PO-A", { requestId: "average-receipt-A" }, "quantity");
  await executePurchaseReceive(db, null, "PO-B", { requestId: "average-receipt-B" }, "quantity");
  const movement = await adjust(db, adjustment({ quantity: 5, requestId: "average-loss-001" }));
  assert.equal(movement?.totalCost, 600);
  assert.equal(value(db), 1200);
  assert.equal(db.rows("productInventory")[0].totalValue, 1200);
  assert.equal(stock(db) * db.rows("products")[0].cost, 1200);
});

test("stock adjustment schema rejects Mongo operator-shaped identifiers before reading or writing", async () => {
  const db = fresh();
  const before = db.snapshot();
  let dbCalls = 0;
  const collection = db.collection.bind(db);
  db.collection = (name: string) => {
    dbCalls++;
    return collection(name);
  };
  await assert.rejects(adjust(db, adjustment({ productId: { $ne: null } as any, type: "in" })));
  await assert.rejects(adjust(db, adjustment({ quantity: "5" as any, type: "in" })));
  assert.equal(dbCalls, 0, "invalid input must fail before accessing Mongo collections");
  assert.deepEqual(db.snapshot(), before);
});

test("serialized adjustment consumes expired issue locks while preserving actively locked cylinders", async () => {
  const db = new MemoryDb({
    products: [{ ...product, productType: "cylinder", uom: "cyl", stock: 2, cost: 100 }],
    cylinders: [
      { id: "expired-lock", issueLock: new Date(Date.now() - 600_000).toISOString() },
      { id: "active-lock", issueLock: new Date(Date.now() + 60_000).toISOString() },
    ].map((c) => ({
      ...c,
      serialNumber: c.id,
      productId: product.id,
      status: "in_stock",
      fillLevel: "full",
      ownedBy: "company",
      location: "Warehouse",
    })),
  });
  const before = db.snapshot();
  await assert.rejects(
    adjust(db, adjustment({ quantity: 2, requestId: "locked-count-reject" })),
    /unlocked/,
  );
  assert.deepEqual(db.snapshot(), before);
  const movement = await adjust(db, adjustment({ quantity: 1, requestId: "expired-lock-count" }));
  assert.equal(movement?.totalCost, 100);
  assert.equal(stock(db), 1);
  assert.equal(value(db), 100);
  assert.equal(db.rows("cylinderInventory")[0].totalValue, 100);
  assert.equal(db.rows("cylinders").find((c) => c.id === "expired-lock")?.status, "stock_out");
  assert.deepEqual(
    db.rows("cylinders").find((c) => c.id === "active-lock"),
    before.cylinders.find((c) => c.id === "active-lock"),
  );
  assert.equal(db.rows("movements").length, 1);
  assert.equal(db.rows("movements")[0].cylinderId, "expired-lock");
});

test("adjustment rejects invalid requests without any mutation, including invalid zero-delta requests", async () => {
  const db = fresh();
  for (const patch of [
    { notes: " " },
    { quantity: -1 },
    { quantity: NaN },
    { quantity: Infinity },
    { quantity: 0 },
    { date: "invalid" },
    { date: "2026-02-31" },
    { requestId: "bad" },
    { quantity: 1 },
    { type: "adjust", quantity: 0, notes: "" },
  ] as Partial<StockAdjustmentInput>[]) {
    const before = db.snapshot();
    await assert.rejects(adjust(db, adjustment(patch)));
    assert.deepEqual(db.snapshot(), before);
  }
});

test("count adjustment notes containing initial do not replace historical opening stock", async () => {
  const db = fresh();
  await executePurchaseReceive(db, null, "PO-A", { requestId: "count-receipt" }, "quantity");
  await adjust(
    db,
    adjustment({ type: "in", quantity: 2, notes: "Initial physical stock count correction" }),
  );
  const before = stock(db);
  await reconcileDatabaseInventory(db);
  assert.equal(stock(db), before);
  const report = buildStockReport(
    db.rows("products") as Product[],
    db.rows("stockMovements") as any,
    { preset: "all", from: "", to: "" },
  );
  assert.equal(report[0].openingQty, 0);
  assert.equal(report[0].qtyIn, 12);
  assert.equal(report[0].inHand, 12);
});

test("quantity-only cylinders stay unserialized; serialized cylinders require integers and preserve serial counts", async () => {
  for (const serialized of [false, true]) {
    const db = new MemoryDb({
      products: [{ ...product, productType: "cylinder", uom: "cyl", stock: 2, cost: 100 }],
      cylinders: serialized
        ? [1, 2].map((i) => ({
            id: `c${i}`,
            serialNumber: `SER-${i}`,
            productId: product.id,
            status: "in_stock",
            fillLevel: "full",
            ownedBy: "company",
            location: "Warehouse",
          }))
        : [],
    });
    const before = db.snapshot();
    await assert.rejects(adjust(db, adjustment({ type: "in", quantity: 0.5 })), /whole number/);
    assert.deepEqual(db.snapshot(), before);
    await adjust(db, adjustment({ type: "in", quantity: 1 }));
    assert.equal(stock(db), 3);
    assert.equal(db.rows("cylinders").length, serialized ? 3 : 0);
    await adjust(db, adjustment({ type: "out", quantity: 2, requestId: "cylinder-loss-002" }));
    assert.equal(stock(db), 1);
    assert.equal(db.rows("cylinderInventory")[0].onHand, 1);
    assert.equal(db.rows("cylinderInventory")[0].totalValue, 100);
    assert.equal(
      db.rows("cylinders").filter((c) => c.status === "in_stock").length,
      serialized ? 1 : 0,
    );
  }
});
