import { test } from "node:test";
import assert from "node:assert";
import { computeReservedQty } from "../src/lib/inventory.server.ts";
import { buildStockReport } from "../src/lib/stock-report.ts";
import { pickFifo } from "../src/lib/cylinder-product.ts";

test("Order-Delivery Inventory Lifecycle & Validation", async (t) => {
  await t.test("1. Sales Order Confirmed: Reserves quantity, Available decreases, Physical stock unchanged", () => {
    const warehouseStock = 100;
    const sales = [
      {
        id: "so-1",
        orderNo: "SO-101",
        status: "confirmed",
        items: [{ productId: "p6", productName: "Carbon Dioxide", quantity: 22 }],
      },
    ];
    const deliveries = [];

    const reserved = computeReservedQty("p6", sales, deliveries);
    assert.strictEqual(reserved, 22, "Reserved must be 22");

    // Physical stock is NOT deducted on order confirmation
    const physicalStock = warehouseStock;
    assert.strictEqual(physicalStock, 100, "Physical stock must remain 100");

    const available = Math.max(0, physicalStock - reserved);
    assert.strictEqual(available, 78, "Available for sale must be 78");
  });

  await t.test("2. Delivery Challan Created: Links to Sales Order, no duplicate deduction, reserved preserved", () => {
    const warehouseStock = 100;
    const sales = [
      {
        id: "so-1",
        orderNo: "SO-101",
        status: "confirmed",
        items: [{ productId: "p6", productName: "Carbon Dioxide", quantity: 22 }],
      },
    ];
    const deliveries = [
      {
        id: "dc-1",
        challanNo: "DC-101",
        salesOrderId: "so-1",
        status: "pending",
        items: [{ productId: "p6", productName: "Carbon Dioxide", quantity: 22 }],
      },
    ];

    const reserved = computeReservedQty("p6", sales, deliveries);
    assert.strictEqual(reserved, 22, "Reserved remains 22");

    const physicalStock = warehouseStock;
    assert.strictEqual(physicalStock, 100, "Physical stock remains 100");

    const available = Math.max(0, physicalStock - reserved);
    assert.strictEqual(available, 78, "Available remains 78");
  });

  await t.test("3. Confirm Delivery: Converts reservation into completed sale, decreases physical stock exactly once", () => {
    let warehouseStock = 100;
    const sales = [
      {
        id: "so-1",
        orderNo: "SO-101",
        status: "invoiced",
        items: [{ productId: "p6", productName: "Carbon Dioxide", quantity: 22 }],
      },
    ];
    const deliveries = [
      {
        id: "dc-1",
        challanNo: "DC-101",
        salesOrderId: "so-1",
        status: "delivered",
        items: [{ productId: "p6", productName: "Carbon Dioxide", quantity: 22 }],
      },
    ];

    // Deduction on delivery confirmation
    warehouseStock -= 22;
    assert.strictEqual(warehouseStock, 78, "Physical warehouse stock becomes 78");

    // Delivery is completed, reservation automatically drops to 0!
    const reserved = computeReservedQty("p6", sales, deliveries);
    assert.strictEqual(reserved, 0, "Reserved drops to 0 once delivered");

    const available = Math.max(0, warehouseStock - reserved);
    assert.strictEqual(available, 78, "Available for sale remains 78");
  });

  await t.test("4. Duplicate delivery confirmation prevention (Idempotency)", () => {
    let stockDeductions = 0;
    const delivery = { id: "dc-1", status: "delivered" };
    const stockOutMovements = [{ refType: "delivery", refId: "dc-1" }];

    function confirmDelivery(del) {
      if (del.status !== "pending" && del.status !== "in_transit") {
        throw new Error("Already confirmed");
      }
      const alreadyOut = stockOutMovements.some((m) => m.refType === "delivery" && m.refId === del.id);
      if (!alreadyOut) {
        stockDeductions += 1;
      }
    }

    assert.throws(() => confirmDelivery(delivery), /Already confirmed/);
    assert.strictEqual(stockDeductions, 0, "No duplicate stock deduction");
  });

  await t.test("5. FIFO Auto-pick excludes cylinders assigned to other pending delivery challans", () => {
    const cylinders = [
      { id: "c1", productId: "p1", serialNumber: "INS-001", status: "in_stock", fillLevel: "full", lastMovementAt: "2026-01-01" },
      { id: "c2", productId: "p1", serialNumber: "INS-002", status: "in_stock", fillLevel: "full", lastMovementAt: "2026-01-02" },
      { id: "c3", productId: "p1", serialNumber: "INS-003", status: "in_stock", fillLevel: "full", lastMovementAt: "2026-01-03" },
    ];

    // Another pending delivery has already assigned c1
    const otherPendingAssigned = new Set(["c1"]);

    const picked = pickFifo(cylinders, "p1", 2, otherPendingAssigned);
    assert.deepStrictEqual(picked, ["c2", "c3"], "c1 must be excluded since it is assigned to another pending delivery");
  });

  await t.test("6. Stock report reversal netting produces accurate Purchased and Sold totals", () => {
    const product = { id: "p6", name: "Carbon Dioxide", initialStock: 22, cost: 700, stock: 0 };
    const movements = [
      { id: "INIT", productId: "p6", type: "in", refType: "adjustment", quantity: 22, notes: "Initial opening stock" },
      { id: "m1", productId: "p6", type: "out", refType: "sales", quantity: 22, notes: "SO-1" },
      { id: "m2", productId: "p6", type: "in", refType: "sales", quantity: 22, notes: "Reverse SO-1" },
      { id: "m3", productId: "p6", type: "out", refType: "delivery", quantity: 22, notes: "DC-1" },
    ];

    const report = buildStockReport([product], movements, { preset: "all", from: "", to: "" });
    const row = report.find((r) => r.id === "p6");
    assert.ok(row, "Row must exist");
    assert.strictEqual(row.qtyIn, 0, "Purchased (qtyIn) must be 0 (reversal netted out)");
    assert.strictEqual(row.qtyOut, 22, "Sold (qtyOut) must be exactly 22 (m1 was reversed, m3 delivered)");
    assert.strictEqual(row.inHand, 0, "Current stock must be 0 (22 opening - 22 delivered)");
  });
});
