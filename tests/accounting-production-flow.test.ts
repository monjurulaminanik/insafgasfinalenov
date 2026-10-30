import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { computeProfitAndLoss, computeBalanceSheet } from "../src/lib/accounting-engine.ts";

// Execute the actual production functions, replacing only transport/database boundaries.
// No server, environment credentials, or Mongo connection is loaded.
function fixture() {
  const tables: Record<string, any[]> = {};
  let seq = 0;
  const rows = (name: string) => (tables[name] ??= []);
  const matches = (row: any, query: any) =>
    Object.entries(query).every(([key, value]: any) =>
      value && typeof value === "object"
        ? value.$gt !== undefined
          ? row[key] > value.$gt
          : value.$ne !== undefined
            ? row[key] !== value.$ne
            : false
        : row[key] === value,
    );
  const patch = (row: any, update: any, inserted = false) => {
    Object.assign(row, update.$set ?? {});
    if (inserted) Object.assign(row, update.$setOnInsert ?? {});
    for (const [key, amount] of Object.entries(update.$inc ?? {}))
      row[key] = (row[key] ?? 0) + Number(amount);
    return row;
  };
  const db = {
    collection: (name: string) => ({
      find: (query: any = {}) => ({
        toArray: async () => structuredClone(rows(name).filter((r) => matches(r, query))),
      }),
      findOne: async (query: any) =>
        structuredClone(rows(name).find((r) => matches(r, query)) ?? null),
      insertOne: async (row: any) => {
        rows(name).push(structuredClone(row));
      },
      insertMany: async (data: any[]) => {
        rows(name).push(...structuredClone(data));
      },
      updateOne: async (query: any, update: any, options: any = {}) => {
        let row = rows(name).find((r) => matches(r, query));
        if (!row && options.upsert) {
          row = { ...query };
          rows(name).push(row);
          patch(row, update, true);
        } else if (row) patch(row, update);
      },
      findOneAndUpdate: async (query: any, update: any) => {
        const row = rows(name).find((r) => matches(r, query));
        return row ? structuredClone(patch(row, update)) : null;
      },
    }),
  };
  const crudFn = async ({ data: { op, coll, id, payload } }: any) => {
    if (op === "list") return structuredClone(rows(coll));
    const index = rows(coll).findIndex((r) => r.id === id);
    if (op === "get") return structuredClone(rows(coll)[index] ?? null);
    if (op === "create") {
      const row = { id: `test-${++seq}`, ...structuredClone(payload) };
      rows(coll).push(row);
      return structuredClone(row);
    }
    if (op === "update") {
      Object.assign(rows(coll)[index], structuredClone(payload));
      return structuredClone(rows(coll)[index]);
    }
    if (op === "remove") {
      rows(coll).splice(index, 1);
      return { ok: true };
    }
    throw new Error(`Unexpected operation ${op}`);
  };
  const cache = new Map<string, any>();
  function load(path: string): any {
    const file = resolve(path);
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} as any };
    cache.set(file, module.exports);
    const require = (id: string): any => {
      if (id === "@tanstack/react-start")
        return {
          createServerFn: () => ({
            inputValidator() {
              return this;
            },
            handler(fn: any) {
              return fn;
            },
          }),
        };
      if (id === "@/lib/data.functions") return { crudFn };
      if (/^@\/lib\/(products|settings|inventory)\.functions$/.test(id)) return {};
      if (id === "./inventory.server") return { resolveProductType: (p: any) => p.productType };
      if (id.startsWith("@/")) return load(resolve("src", id.slice(2)) + ".ts");
      if (id.startsWith(".")) return load(resolve(dirname(file), id.replace(/\.ts$/, "")) + ".ts");
      throw new Error(`Unmocked dependency: ${id}`);
    };
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      require,
      module,
      module.exports,
    );
    return module.exports;
  }
  return { rows, db, load };
}

it("production purchase receive -> sale -> delivery issues cost once on issuance date", async () => {
  const f = fixture();
  const item = {
    productId: "p",
    productName: "Gas",
    itemType: "gas",
    quantity: 10,
    price: 40,
    taxRate: 0,
  };
  f.rows("products").push({
    id: "p",
    code: "P",
    name: "Gas",
    productType: "gas",
    category: "Industrial",
    uom: "kg",
    stock: 0,
    cost: 0,
    price: 70,
    createdAt: "2026-01-01",
  });
  f.rows("purchases").push({
    id: "po",
    orderNo: "PO",
    supplierId: "s",
    supplierName: "Supplier",
    date: "2026-01-01",
    status: "ordered",
    items: [item],
    subtotal: 400,
    tax: 0,
    total: 400,
    paid: 0,
  });
  const { executePurchaseReceive } = f.load("src/lib/purchase.functions.ts");
  await executePurchaseReceive(f.db, null, "po", { qtyByItem: [10], requestId: "grn" }, "quantity");
  assert.equal(f.rows("products")[0].stock, 10);
  assert.equal(f.rows("stockMovements").length, 1);
  f.rows("purchases").push({
    ...structuredClone(f.rows("purchases")[0]),
    id: "po-2",
    status: "ordered",
    grns: [],
    items: [{ ...item, price: 100, receivedQty: 0 }],
  });
  await executePurchaseReceive(
    f.db,
    null,
    "po-2",
    { qtyByItem: [10], requestId: "grn-2" },
    "quantity",
  );
  const { salesService, deliveryService } = f.load("src/services/_services.ts");
  const sale = await salesService.create({
    orderNo: "SO",
    customerId: "c",
    customerName: "Customer",
    date: "2026-01-01",
    items: [{ ...item, quantity: 3, price: 70 }],
    subtotal: 210,
    tax: 0,
    total: 210,
    paid: 0,
    status: "confirmed",
  });
  const pnl = () =>
    computeProfitAndLoss({
      sales: f.rows("sales"),
      stockMovements: f.rows("stockMovements"),
      expenses: [],
    });
  assert.equal(pnl().cogs, 0, "confirmation reserves delivery, does not issue stock");
  const delivery = f.rows("deliveries")[0];
  await deliveryService.confirm(delivery.id);
  assert.equal(f.rows("products")[0].stock, 17);
  assert.equal(pnl().cogs, 120);
  await assert.rejects(() => deliveryService.confirm(delivery.id), /Already confirmed/);
  assert.equal(pnl().cogs, 120);
  const issued = f.rows("stockMovements").find((m) => m.movementType === "SALE_ISSUE");
  assert.equal(issued.refType, "delivery");
  assert.equal(issued.refId, delivery.id);
  const oldDay = computeProfitAndLoss({
    sales: [sale],
    stockMovements: f.rows("stockMovements"),
    expenses: [],
    range: { preset: "custom", from: "2026-01-01", to: "2026-01-01" },
  });
  assert.equal(oldDay.cogs, 0, "COGS follows actual issuance rather than invoice date");
  const bs = computeBalanceSheet({
    ledger: [],
    products: f.rows("products"),
    costLayers: f.rows("costLayers"),
    customers: [],
    suppliers: [],
    sales: f.rows("sales"),
    purchases: f.rows("purchases"),
    assets: [],
    stockMovements: f.rows("stockMovements"),
    expenses: [],
  });
  assert.equal(bs.inventoryValue, 1280);
  await salesService.setStatus(sale.id, "cancelled");
  assert.equal(pnl().cogs, 0, "production cancellation reverses the original delivery cost");
  assert.equal(f.rows("products")[0].stock, 20);
});
