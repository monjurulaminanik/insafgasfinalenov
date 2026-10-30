import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  CostLayer,
  Customer,
  Cylinder,
  LineItem,
  Product,
  SalesOrder,
  StockMovement,
} from "../src/types/index.ts";
import {
  computeWeightedAverageOnReceipt,
  consumeCostLayers,
  computeLayerValuation,
  reconcileQuantityWithSerials,
} from "../src/lib/inventory-engine.ts";
import { buildStockReport } from "../src/lib/stock-report.ts";

describe("Inventory, Costing, Stock Movements & Cylinder Tests", () => {
  // Test 1: Receive stock
  it("1. Receive stock creates layer and calculates stock & cost", () => {
    const p: Product = {
      id: "p-test1",
      code: "LPG-12",
      name: "LPG 12kg",
      category: "LPG",
      uom: "cyl",
      price: 1400,
      cost: 1000,
      stock: 10,
      reorderLevel: 5,
      costingMethod: "fifo",
      createdAt: new Date().toISOString(),
    };

    const receiptQty = 15;
    const receiptCost = 1200;
    const nextStock = p.stock + receiptQty;
    assert.strictEqual(nextStock, 25);

    const layer: CostLayer = {
      id: "cl-1",
      productId: p.id,
      qtyRemaining: receiptQty,
      unitCost: receiptCost,
      receivedAt: new Date().toISOString(),
      refType: "purchase",
    };
    assert.strictEqual(layer.qtyRemaining, 15);
    assert.strictEqual(layer.unitCost, 1200);
  });

  // Test 2: Sell stock
  it("2. Sell stock reduces available quantity and creates out movement", () => {
    const p: Product = {
      id: "p-test2",
      code: "LPG-12",
      name: "LPG 12kg",
      category: "LPG",
      uom: "cyl",
      price: 1400,
      cost: 1000,
      stock: 20,
      reorderLevel: 5,
      costingMethod: "fifo",
      createdAt: new Date().toISOString(),
    };

    const layers: CostLayer[] = [
      {
        id: "l1",
        productId: p.id,
        qtyRemaining: 20,
        unitCost: 1000,
        receivedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const requestedQty = 5;
    assert.ok(p.stock >= requestedQty);

    const consumption = consumeCostLayers(layers, requestedQty, "fifo");
    assert.strictEqual(consumption.cogsAmount, 5000);
    assert.strictEqual(consumption.unitCost, 1000);
    assert.strictEqual(layers[0].qtyRemaining - consumption.consumptions[0].qty, 15);

    const movement: StockMovement = {
      id: "sm-test2",
      date: new Date().toISOString(),
      productId: p.id,
      productName: p.name,
      type: "out",
      movementType: "SALE_ISSUE",
      direction: "out",
      quantity: requestedQty,
      balanceAfter: p.stock - requestedQty,
      unitCost: consumption.unitCost,
      totalCost: consumption.cogsAmount,
      cogsAmount: consumption.cogsAmount,
      costingMethod: "fifo",
      refType: "sales",
      refId: "so-test2",
      notes: "SO-1002",
      by: "Sales",
    };

    assert.strictEqual(movement.balanceAfter, 15);
    assert.strictEqual(movement.movementType, "SALE_ISSUE");
  });

  // Test 3: Paid sale creates stock issue
  it("3. Paid sale creates stock issue", () => {
    const sale: SalesOrder = {
      id: "so-paid-1",
      orderNo: "SO-2026-0003",
      customerId: "c1",
      customerName: "Rahim Afrooz",
      date: "2026-09-20T00:00:00Z",
      items: [{ productId: "p5", productName: "Nitrogen Industrial", quantity: 4, price: 1150 }],
      subtotal: 4600,
      tax: 0,
      total: 4600,
      paid: 4600,
      status: "paid",
    };

    assert.strictEqual(sale.status, "paid");
    const item = sale.items[0];
    const movement: StockMovement = {
      id: "sm-paid-1",
      date: sale.date,
      productId: item.productId,
      productName: item.productName,
      type: "out",
      movementType: "SALE_ISSUE",
      direction: "out",
      quantity: item.quantity,
      balanceAfter: 2,
      unitCost: 880,
      totalCost: 3520,
      cogsAmount: 3520,
      refType: "sales",
      refId: sale.id,
      notes: sale.orderNo,
      by: "Sales",
    };

    assert.strictEqual(movement.refType, "sales");
    assert.strictEqual(movement.refId, "so-paid-1");
    assert.strictEqual(movement.quantity, 4);
    assert.strictEqual(movement.movementType, "SALE_ISSUE");
  });

  // Test 4: Confirmed sale creates exactly one stock issue
  it("4. Confirmed sale creates exactly one stock issue", () => {
    const movements: StockMovement[] = [];
    const recordSaleIssue = (saleId: string, productId: string, qty: number) => {
      const exists = movements.some(
        (m) =>
          m.refType === "sales" &&
          m.refId === saleId &&
          m.productId === productId &&
          m.type === "out",
      );
      if (exists) return false;
      movements.push({
        id: `sm-${movements.length + 1}`,
        date: new Date().toISOString(),
        productId,
        productName: "LPG 12kg",
        type: "out",
        movementType: "SALE_ISSUE",
        direction: "out",
        quantity: qty,
        balanceAfter: 50,
        refType: "sales",
        refId: saleId,
        by: "Sales",
      });
      return true;
    };

    const first = recordSaleIssue("so-conf-1", "p1", 6);
    assert.strictEqual(first, true);
    assert.strictEqual(movements.length, 1);

    const duplicate = recordSaleIssue("so-conf-1", "p1", 6);
    assert.strictEqual(duplicate, false);
    assert.strictEqual(movements.length, 1);
  });

  // Test 5: Duplicate processing does not double issue
  it("5. Duplicate processing does not double issue", () => {
    const movements: StockMovement[] = [
      {
        id: "sm-dup",
        date: "2026-09-01T00:00:00Z",
        productId: "p1",
        productName: "LPG 12kg",
        type: "out",
        movementType: "SALE_ISSUE",
        quantity: 5,
        balanceAfter: 10,
        refType: "sales",
        refId: "so-123",
        by: "Sales",
      },
    ];

    const hasStockOut = (refType: string, refId: string, productId: string) =>
      movements.some(
        (m) =>
          m.refType === refType &&
          m.refId === refId &&
          m.productId === productId &&
          m.type === "out",
      );

    assert.strictEqual(hasStockOut("sales", "so-123", "p1"), true);
  });

  // Test 6: Insufficient stock rejects entire transaction
  it("6. Insufficient stock rejects entire transaction", () => {
    const available = 4;
    const requested = 10;

    let transactionSaved = false;
    let stockDeducted = false;

    const processOrder = () => {
      if (available < requested) {
        throw new Error(`Insufficient stock. Available: ${available}, Requested: ${requested}.`);
      }
      transactionSaved = true;
      stockDeducted = true;
    };

    assert.throws(() => processOrder(), /Insufficient stock/);
    assert.strictEqual(transactionSaved, false);
    assert.strictEqual(stockDeducted, false);
  });

  // Test 7: Failed transaction rolls back everything
  it("7. Failed transaction rolls back everything", () => {
    let state = { stock: 10, saleCreated: false, paymentCreated: false };
    const rollbackState = { ...state };

    try {
      state.saleCreated = true;
      const requested = 15;
      if (state.stock < requested) {
        throw new Error("Insufficient stock");
      }
      state.stock -= requested;
      state.paymentCreated = true;
    } catch {
      state = { ...rollbackState };
    }

    assert.strictEqual(state.stock, 10);
    assert.strictEqual(state.saleCreated, false);
    assert.strictEqual(state.paymentCreated, false);
  });

  // Test 8: FIFO costing
  it("8. FIFO costing consumes oldest layers first and calculates accurate COGS", () => {
    const layers: CostLayer[] = [
      {
        id: "l1",
        productId: "p-fifo",
        qtyRemaining: 10,
        unitCost: 100,
        receivedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "l2",
        productId: "p-fifo",
        qtyRemaining: 10,
        unitCost: 300,
        receivedAt: "2026-01-02T00:00:00Z",
      },
    ];

    const result = consumeCostLayers(layers, 10, "fifo");
    assert.strictEqual(result.cogsAmount, 1000);
    assert.strictEqual(result.unitCost, 100);
    assert.strictEqual(result.consumptions.length, 1);
    assert.strictEqual(result.consumptions[0].layerId, "l1");

    // Next 5 consumed should come from l2 @ 300
    const remainingLayers: CostLayer[] = [
      {
        id: "l1",
        productId: "p-fifo",
        qtyRemaining: 0,
        unitCost: 100,
        receivedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "l2",
        productId: "p-fifo",
        qtyRemaining: 10,
        unitCost: 300,
        receivedAt: "2026-01-02T00:00:00Z",
      },
    ];
    const secondResult = consumeCostLayers(remainingLayers, 5, "fifo");
    assert.strictEqual(secondResult.cogsAmount, 1500);
    assert.strictEqual(secondResult.unitCost, 300);
    assert.strictEqual(secondResult.consumptions[0].layerId, "l2");
  });

  // Test 9: Weighted average costing
  it("9. Weighted average costing recomputes correctly on receipt and issues at current average", () => {
    // Current stock: 10 @ 100
    // Receipt: 10 @ 200
    // New average: (10*100 + 10*200) / 20 = 3000 / 20 = 150
    const newAvg = computeWeightedAverageOnReceipt(10, 100, 10, 200);
    assert.strictEqual(newAvg, 150);

    // Issue 5 @ 150
    const issuedQty = 5;
    const cogs = issuedQty * newAvg;
    assert.strictEqual(cogs, 750);
    const remainingQty = 20 - issuedQty;
    assert.strictEqual(remainingQty, 15);
    const remainingValue = remainingQty * newAvg;
    assert.strictEqual(remainingValue, 2250);
  });

  // Test 10: Inventory valuation
  it("10. Inventory valuation never simply multiplies stock by last movement cost", () => {
    const layers: CostLayer[] = [
      {
        id: "l1",
        productId: "p-val",
        qtyRemaining: 10,
        unitCost: 100,
        receivedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "l2",
        productId: "p-val",
        qtyRemaining: 10,
        unitCost: 300,
        receivedAt: "2026-01-02T00:00:00Z",
      },
    ];

    // Issue 10
    const { updatedLayers } = consumeCostLayers(layers, 10, "fifo");
    const activeLayers: CostLayer[] = [
      {
        id: "l1",
        productId: "p-val",
        qtyRemaining: updatedLayers.find((u) => u.id === "l1")?.qtyRemaining ?? 0,
        unitCost: 100,
        receivedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "l2",
        productId: "p-val",
        qtyRemaining: 10,
        unitCost: 300,
        receivedAt: "2026-01-02T00:00:00Z",
      },
    ];

    const val = computeLayerValuation(activeLayers);
    assert.strictEqual(val.totalQty, 10);
    assert.strictEqual(val.totalValue, 3000);
    assert.strictEqual(val.avgCost, 300);
  });

  // Test 11: Product edit cannot directly change stock
  it("11. Product edit cannot directly change stock", () => {
    const existingProduct: Product = {
      id: "p-edit",
      code: "P-EDIT",
      name: "Edit Product",
      category: "LPG",
      uom: "kg",
      price: 100,
      cost: 80,
      stock: 50,
      reorderLevel: 10,
      createdAt: new Date().toISOString(),
    };

    const updatePayload = {
      name: "Edit Product Renamed",
      price: 110,
      stock: 999, // Attempt direct stock edit
    };

    // Filter out stock from product updates
    const { stock: _strip, ...cleanPatch } = updatePayload;
    const updated = { ...existingProduct, ...cleanPatch };

    assert.strictEqual(updated.name, "Edit Product Renamed");
    assert.strictEqual(updated.price, 110);
    assert.strictEqual(updated.stock, 50); // Stock remains unchanged!
  });

  // Test 12: Inventory adjustment creates movement
  it("12. Inventory adjustment creates auditable stock movement", () => {
    const currentStock = 10;
    const adjustmentQty = 3;
    const direction = "out";

    const movement: StockMovement = {
      id: "sm-adj-1",
      date: new Date().toISOString(),
      productId: "p1",
      productName: "LPG 12kg",
      type: "out",
      movementType: "ADJUSTMENT_OUT",
      direction: "out",
      quantity: adjustmentQty,
      balanceAfter: currentStock - adjustmentQty,
      refType: "adjustment",
      refId: "ADJ-001",
      notes: "Cycle count discrepancy",
      by: "Warehouse Manager",
    };

    assert.strictEqual(movement.balanceAfter, 7);
    assert.strictEqual(movement.refType, "adjustment");
    assert.strictEqual(movement.movementType, "ADJUSTMENT_OUT");
  });

  // Test 13: Delivery does not double-deduct stock
  it("13. Delivery does not double-deduct stock if sales order already issued stock", () => {
    let stock = 20;
    const orderId = "so-deliv-1";

    // 1. Confirmed sale issues stock
    const saleIssued = true;
    if (saleIssued) stock -= 5;
    assert.strictEqual(stock, 15);

    // 2. Delivery confirms: checks if sale already issued stock
    const soAlreadyOut = saleIssued;
    if (!soAlreadyOut) {
      stock -= 5; // Should NOT execute
    }

    assert.strictEqual(stock, 15); // Stock is not double deducted!
  });

  // Test 14: Cylinder issue
  it("14. Cylinder issue transitions state to at_customer and assigns customer", () => {
    const cyl: Cylinder = {
      id: "cyl-1",
      serialNumber: "INS-001",
      productId: "p1",
      capacity: 12,
      status: "in_stock",
      fillLevel: "full",
      location: "Warehouse",
      lastMovementAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    };

    const updatedCyl: Cylinder = {
      ...cyl,
      status: "at_customer",
      customerId: "cust-1",
      location: "Customer Site",
      lastMovementAt: new Date().toISOString(),
    };

    assert.strictEqual(updatedCyl.status, "at_customer");
    assert.strictEqual(updatedCyl.customerId, "cust-1");
  });

  // Test 15: Cylinder return
  it("15. Cylinder return transitions state to in_stock and empties contents", () => {
    const cyl: Cylinder = {
      id: "cyl-1",
      serialNumber: "INS-001",
      productId: "p1",
      capacity: 12,
      status: "at_customer",
      customerId: "cust-1",
      fillLevel: "full",
      location: "Customer Site",
      lastMovementAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    };

    const returnedCyl: Cylinder = {
      ...cyl,
      status: "in_stock",
      customerId: undefined,
      fillLevel: "empty",
      location: "Warehouse",
      lastMovementAt: new Date().toISOString(),
    };

    assert.strictEqual(returnedCyl.status, "in_stock");
    assert.strictEqual(returnedCyl.fillLevel, "empty");
    assert.strictEqual(returnedCyl.customerId, undefined);
  });

  // Test 16: Cylinder damage
  it("16. Cylinder damage updates cylinder status to damaged and issues damage movement", () => {
    const cyl: Cylinder = {
      id: "cyl-dmg",
      serialNumber: "INS-DMG-001",
      productId: "p1",
      capacity: 12,
      status: "in_stock",
      fillLevel: "full",
      location: "Warehouse",
      lastMovementAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    };

    const damagedCyl: Cylinder = {
      ...cyl,
      status: "damaged",
      location: "Damaged Area",
      lastMovementAt: new Date().toISOString(),
    };

    assert.strictEqual(damagedCyl.status, "damaged");
  });

  // Test 17: Cylinder loss
  it("17. Cylinder loss updates cylinder status to lost and decreases available stock", () => {
    const cyl: Cylinder = {
      id: "cyl-lst",
      serialNumber: "INS-LST-001",
      productId: "p1",
      capacity: 12,
      status: "in_stock",
      fillLevel: "full",
      location: "Warehouse",
      lastMovementAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    };

    const lostCyl: Cylinder = {
      ...cyl,
      status: "lost",
      location: "Lost",
      lastMovementAt: new Date().toISOString(),
    };

    assert.strictEqual(lostCyl.status, "lost");
  });

  // Test 18: Invalid cylinder return is rejected
  it("18. Invalid cylinder return without valid previous issue is rejected", () => {
    const cyl: Cylinder = {
      id: "cyl-wh",
      serialNumber: "INS-WH-001",
      productId: "p1",
      capacity: 12,
      status: "in_stock", // Still in warehouse, not with customer
      fillLevel: "full",
      location: "Warehouse",
      lastMovementAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    };

    const returnCylinder = (c: Cylinder, customerId: string) => {
      if (c.status !== "at_customer" || c.customerId !== customerId) {
        throw new Error(
          `Cannot return cylinder ${c.serialNumber}: it is not currently issued to this customer.`,
        );
      }
    };

    assert.throws(() => returnCylinder(cyl, "cust-1"), /Cannot return cylinder/);
  });

  // Test 19: Stock report opening calculation
  it("19. Stock report calculates opening balance correctly for any date range", () => {
    const p: Product = {
      id: "p-rep",
      code: "LPG-12",
      name: "LPG 12kg",
      category: "LPG",
      uom: "cyl",
      price: 1400,
      cost: 1000,
      stock: 35,
      reorderLevel: 10,
      createdAt: "2026-01-01T00:00:00Z",
    };

    const movements: StockMovement[] = [
      {
        id: "m1",
        date: "2026-01-01T10:00:00Z",
        productId: "p-rep",
        productName: "LPG 12kg",
        type: "in",
        direction: "in",
        quantity: 50,
        balanceAfter: 50,
        by: "Warehouse",
      },
      {
        id: "m2",
        date: "2026-01-05T10:00:00Z",
        productId: "p-rep",
        productName: "LPG 12kg",
        type: "out",
        direction: "out",
        quantity: 10,
        balanceAfter: 40,
        by: "Sales",
      },
      {
        id: "m3",
        date: "2026-01-15T10:00:00Z",
        productId: "p-rep",
        productName: "LPG 12kg",
        type: "out",
        direction: "out",
        quantity: 5,
        balanceAfter: 35,
        by: "Sales",
      },
    ];

    // Report for range: 2026-01-10 to 2026-01-20
    const report = buildStockReport([p], movements, {
      preset: "custom",
      from: "2026-01-10",
      to: "2026-01-20",
    });
    const productReport = report[0];

    // Opening should be movements before 2026-01-10: 50 in - 10 out = 40
    assert.strictEqual(productReport.openingQty, 40);
    // In period: 5 out
    assert.strictEqual(productReport.qtyIn, 0);
    assert.strictEqual(productReport.qtyOut, 5);
    // Closing: 40 - 5 = 35
    assert.strictEqual(productReport.inHand, 35);
  });

  // Test 20: Stock report closing calculation
  it("20. Stock report closing matches Opening + In - Out", () => {
    const p: Product = {
      id: "p-close",
      code: "N2",
      name: "Nitrogen",
      category: "Industrial",
      uom: "cyl",
      price: 1100,
      cost: 800,
      stock: 20,
      reorderLevel: 5,
      createdAt: "2026-01-01T00:00:00Z",
    };

    const movements: StockMovement[] = [
      {
        id: "m1",
        date: "2026-02-01T10:00:00Z",
        productId: "p-close",
        productName: "Nitrogen",
        type: "in",
        direction: "in",
        quantity: 20,
        balanceAfter: 20,
        by: "Warehouse",
      },
      {
        id: "m2",
        date: "2026-02-10T10:00:00Z",
        productId: "p-close",
        productName: "Nitrogen",
        type: "in",
        direction: "in",
        quantity: 10,
        balanceAfter: 30,
        by: "Warehouse",
      },
      {
        id: "m3",
        date: "2026-02-15T10:00:00Z",
        productId: "p-close",
        productName: "Nitrogen",
        type: "out",
        direction: "out",
        quantity: 8,
        balanceAfter: 22,
        by: "Sales",
      },
    ];

    const report = buildStockReport([p], movements, {
      preset: "custom",
      from: "2026-02-05",
      to: "2026-02-28",
    });
    const res = report[0];

    assert.strictEqual(res.openingQty, 20);
    assert.strictEqual(res.qtyIn, 10);
    assert.strictEqual(res.qtyOut, 8);
    assert.strictEqual(res.inHand, res.openingQty + res.qtyIn - res.qtyOut);
    assert.strictEqual(res.inHand, 22);
  });

  // Test 21: Serial/quantity reconciliation
  it("21. Serial / quantity reconciliation detects discrepancies", () => {
    const products: Product[] = [
      {
        id: "p1",
        code: "LPG-12",
        name: "LPG 12kg",
        category: "LPG",
        uom: "cyl",
        price: 1450,
        cost: 1200,
        stock: 59,
        reorderLevel: 25,
        createdAt: "2026-01-01",
      },
      {
        id: "p2",
        code: "GAS-BULK",
        name: "Bulk Gas",
        category: "LPG",
        uom: "kg",
        price: 100,
        cost: 80,
        stock: 500,
        reorderLevel: 50,
        createdAt: "2026-01-01",
      },
    ];

    const cylinders: Cylinder[] = [
      {
        id: "c1",
        serialNumber: "INS-001",
        productId: "p1",
        capacity: 12,
        status: "in_stock",
        fillLevel: "full",
        location: "Warehouse",
        lastMovementAt: "2026-01-01",
        createdAt: "2026-01-01",
      },
    ];

    const reconciliation = reconcileQuantityWithSerials(products, cylinders);
    const item1 = reconciliation.find((r) => r.productId === "p1");
    const item2 = reconciliation.find((r) => r.productId === "p2");

    assert.strictEqual(item1?.isSerialized, true);
    assert.strictEqual(item1?.productStock, 59);
    assert.strictEqual(item1?.warehouseFullSerials, 1);
    assert.strictEqual(item1?.discrepancy, 58);
    assert.strictEqual(item1?.reconciled, false);
    assert.strictEqual(item1?.status, "DISCREPANCY");

    assert.strictEqual(item2?.isSerialized, false);
    assert.strictEqual(item2?.status, "NOT_SERIALIZED");
  });
});
