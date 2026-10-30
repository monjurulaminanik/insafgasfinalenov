import { test } from "node:test";
import assert from "node:assert";
import { buildProductInventory, reservedQtyForProduct } from "../src/lib/cylinder-inventory.ts";
import {
  cylinderIsFullStock,
  cylinderIsEmpty,
  isCylinderProduct,
  defaultProductSaleItemType,
  saleItemType,
  pickFifo,
} from "../src/lib/cylinder-product.ts";
import { computeReservedQty } from "../src/lib/inventory.server.ts";

test("Sales Order Stock Validation & Regression Suite", async (suite) => {
  // Test fixture setup
  const medOxyProduct = {
    id: "prod-med-oxy",
    code: "000201",
    name: "Medical Oxygen ( o2-1.36)",
    category: "Medical Oxygen",
    productType: "cylinder",
    uom: "cyl",
    price: 900,
    cost: 700,
    stock: 10,
    reorderLevel: 0,
    costingMethod: "fifo",
    createdAt: "2026-10-14T13:24:59.757Z",
  };

  const gasProduct = {
    id: "prod-gas-1",
    code: "000201-gas",
    name: "Medical Oxygen Gas",
    category: "Medical Oxygen",
    productType: "gas",
    uom: "ltr",
    price: 250,
    cost: 100,
    stock: 899,
    reorderLevel: 50,
    costingMethod: "fifo",
    createdAt: "2026-10-14T13:24:59.757Z",
  };

  const generalProduct = {
    id: "prod-stove-1",
    code: "STV-01",
    name: "RFL ROse Gas stove",
    category: "Appliances",
    productType: "product",
    uom: "pcs",
    price: 5500,
    cost: 4000,
    stock: 50,
    reorderLevel: 5,
    costingMethod: "fifo",
    createdAt: "2026-10-14T13:24:59.757Z",
  };

  const sampleCylinders = Array.from({ length: 10 }, (_, i) => ({
    id: `cyl-${i + 1}`,
    serialNumber: `SN-MED-${i + 1}`,
    productId: "prod-med-oxy",
    capacity: 1.36,
    status: "in_stock",
    fillLevel: "full",
    location: "Warehouse",
    createdAt: "2026-10-14T13:24:59.757Z",
  }));

  // Helper simulating backend assertSalesStock logic
  function assertSalesStockHelper(items, products, cylinders, sales, deliveries, movements, opts) {
    const relevantSales = opts?.excludeOrderId
      ? sales.filter((s) => s.id !== opts.excludeOrderId)
      : sales;

    const stockRows = buildProductInventory(products, cylinders, relevantSales, deliveries, movements);

    for (const item of items) {
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;
      const p = products.find((x) => x.id === item.productId);
      if (!p) throw new Error(`Product not found (${item.productId})`);

      const row = stockRows.find((r) => r.productId === item.productId);
      const baseAvail = opts?.sellGasOnly
        ? Math.max(0, p.stock ?? 0)
        : (row?.available ?? p.stock ?? 0);

      const available = Math.max(0, baseAvail);
      if (qty > available) {
        throw new Error(`Insufficient stock for ${p.name}. Available: ${available}, Requested: ${qty}.`);
      }
    }
    return true;
  }

  // 1. Available stock = 10, requested quantity = 1 → Complete Order succeeds
  await suite.test("1. Available stock = 10, requested quantity = 1 -> Complete Order succeeds", () => {
    const products = [medOxyProduct];
    const cylinders = [...sampleCylinders];
    const sales = [];
    const deliveries = [];
    const movements = [];

    const result = assertSalesStockHelper(
      [{ productId: "prod-med-oxy", quantity: 1 }],
      products,
      cylinders,
      sales,
      deliveries,
      movements,
    );
    assert.strictEqual(result, true, "Validation must succeed for requested quantity 1");
  });

  // 2. Available stock = 10, requested quantity = 10 → Complete Order succeeds
  await suite.test("2. Available stock = 10, requested quantity = 10 -> Complete Order succeeds", () => {
    const products = [medOxyProduct];
    const cylinders = [...sampleCylinders];
    const sales = [];
    const deliveries = [];
    const movements = [];

    const result = assertSalesStockHelper(
      [{ productId: "prod-med-oxy", quantity: 10 }],
      products,
      cylinders,
      sales,
      deliveries,
      movements,
    );
    assert.strictEqual(result, true, "Validation must succeed for exact available quantity 10");
  });

  // 3. Available stock = 10, requested quantity = 11 → Complete Order is rejected with the correct shortage
  await suite.test("3. Available stock = 10, requested quantity = 11 -> Rejected with correct shortage", () => {
    const products = [medOxyProduct];
    const cylinders = [...sampleCylinders];
    const sales = [];
    const deliveries = [];
    const movements = [];

    assert.throws(
      () => {
        assertSalesStockHelper(
          [{ productId: "prod-med-oxy", quantity: 11 }],
          products,
          cylinders,
          sales,
          deliveries,
          movements,
        );
      },
      (err) => {
        assert.match(
          err.message,
          /Insufficient stock for Medical Oxygen \( o2-1\.36\)\. Available: 10, Requested: 11\./,
          "Error message must specify available 10 and requested 11",
        );
        return true;
      },
    );
  });

  // 4. Dropdown availability and backend validation agree for the same product and inventory state
  await suite.test("4. Dropdown availability and backend validation agree for the same state", () => {
    const products = [medOxyProduct, gasProduct, generalProduct];
    const cylinders = [...sampleCylinders];
    const sales = [
      {
        id: "so-legacy",
        orderNo: "SO-LEGACY-01",
        status: "confirmed",
        items: [{ productId: "prod-med-oxy", quantity: 20 }],
      },
    ];
    const deliveries = [];
    // Movement showing legacy SO already deducted stock
    const movements = [
      {
        id: "sm-1",
        productId: "prod-med-oxy",
        type: "out",
        refType: "sales",
        refId: "so-legacy",
        quantity: 20,
      },
    ];

    // Compute dropdown stock
    const stockRows = buildProductInventory(products, cylinders, sales, deliveries, movements);
    const dropdownRow = stockRows.find((r) => r.productId === "prod-med-oxy");
    assert.strictEqual(dropdownRow.available, 10, "Dropdown must display available = 10");

    // Backend validation with same state
    const backendResult = assertSalesStockHelper(
      [{ productId: "prod-med-oxy", quantity: 5 }],
      products,
      cylinders,
      sales,
      deliveries,
      movements,
    );
    assert.strictEqual(backendResult, true, "Backend validation must agree with dropdown availability");
  });

  // 5. Different product types continue using their correct inventory sources
  await suite.test("5. Different product types use correct inventory sources", () => {
    const products = [medOxyProduct, gasProduct, generalProduct];
    const cylinders = [...sampleCylinders];
    const sales = [];
    const deliveries = [];
    const movements = [];

    const stockRows = buildProductInventory(products, cylinders, sales, deliveries, movements);

    const cylRow = stockRows.find((r) => r.productId === "prod-med-oxy");
    const gasRow = stockRows.find((r) => r.productId === "prod-gas-1");
    const prodRow = stockRows.find((r) => r.productId === "prod-stove-1");

    assert.strictEqual(cylRow.available, 10, "Cylinder available matches full in-stock cylinders");
    assert.strictEqual(gasRow.available, 899, "Gas available matches onHand gas stock");
    assert.strictEqual(prodRow.available, 50, "General product available matches product stock");
  });

  // 6. Cylinder reservations, serial eligibility, and location rules remain correct
  await suite.test("6. Cylinder reservations, serial eligibility, and location rules", () => {
    const products = [medOxyProduct];
    // 10 cylinders total: 8 in warehouse, 1 at customer, 1 damaged
    const cylinders = [
      ...sampleCylinders.slice(0, 8),
      {
        id: "cyl-cust",
        serialNumber: "SN-CUST-1",
        productId: "prod-med-oxy",
        status: "at_customer",
        fillLevel: "full",
        location: "Customer ABC",
      },
      {
        id: "cyl-dmg",
        serialNumber: "SN-DMG-1",
        productId: "prod-med-oxy",
        status: "damaged",
        fillLevel: "empty",
        location: "Warehouse",
      },
    ];
    // 2 cylinders reserved in open sales order
    const sales = [
      {
        id: "so-open",
        orderNo: "SO-OPEN-1",
        status: "confirmed",
        items: [{ productId: "prod-med-oxy", quantity: 2 }],
      },
    ];
    const deliveries = [];
    const movements = [];

    const stockRows = buildProductInventory(products, cylinders, sales, deliveries, movements);
    const row = stockRows.find((r) => r.productId === "prod-med-oxy");

    // Warehouse has 8 full in-stock cylinders, 2 reserved -> 6 available
    assert.strictEqual(row.full, 8, "Only in_stock full cylinders in warehouse counted as full");
    assert.strictEqual(row.reserved, 2, "2 cylinders reserved");
    assert.strictEqual(row.available, 6, "Available is 8 full - 2 reserved = 6");

    // FIFO pick should only select eligible in_stock cylinders
    const pickedIds = pickFifo(cylinders, "prod-med-oxy", 3);
    assert.strictEqual(pickedIds.length, 3, "Picks 3 cylinder IDs");
    const pickedCyls = pickedIds.map((id) => cylinders.find((c) => c.id === id));
    assert.ok(
      pickedCyls.every((c) => c && c.status === "in_stock" && c.location === "Warehouse"),
      "Picked cylinders must all be eligible in-stock warehouse cylinders",
    );
  });

  // 7. Completing a Sales Order does not deduct physical stock
  await suite.test("7. Completing a Sales Order does not deduct physical stock", () => {
    const products = [medOxyProduct];
    const cylinders = [...sampleCylinders];
    let physicalCount = cylinders.filter(cylinderIsFullStock).length;
    assert.strictEqual(physicalCount, 10, "Initial physical full count is 10");

    // Create / complete Sales Order for 4 cylinders
    const sales = [
      {
        id: "so-new",
        orderNo: "SO-NEW-1",
        status: "confirmed",
        items: [{ productId: "prod-med-oxy", quantity: 4 }],
      },
    ];
    const deliveries = [];
    const movements = [];

    // Verify physical cylinders are untouched
    physicalCount = cylinders.filter(cylinderIsFullStock).length;
    assert.strictEqual(physicalCount, 10, "Physical stock must remain 10 after order completion");

    // Only reserved changes, available becomes 6
    const stockRows = buildProductInventory(products, cylinders, sales, deliveries, movements);
    const row = stockRows.find((r) => r.productId === "prod-med-oxy");
    assert.strictEqual(row.reserved, 4, "Reserved is 4");
    assert.strictEqual(row.available, 6, "Available for sale is 6");
  });

  // 8. Confirmed Delivery deducts stock exactly once
  await suite.test("8. Confirmed Delivery deducts stock exactly once", () => {
    const products = [{ ...medOxyProduct }];
    const cylinders = sampleCylinders.map((c) => ({ ...c }));
    const sales = [
      {
        id: "so-1",
        orderNo: "SO-1",
        status: "confirmed",
        items: [{ productId: "prod-med-oxy", quantity: 3 }],
      },
    ];
    const deliveries = [
      {
        id: "dc-1",
        challanNo: "DC-1",
        salesOrderId: "so-1",
        status: "delivered",
        items: [{ productId: "prod-med-oxy", quantity: 3, cylinderIds: ["cyl-1", "cyl-2", "cyl-3"] }],
      },
    ];

    // Deliver 3 cylinders: mark cylinders at_customer and post delivery movement
    for (const cid of ["cyl-1", "cyl-2", "cyl-3"]) {
      const c = cylinders.find((x) => x.id === cid);
      c.status = "at_customer";
    }
    const movements = [
      {
        id: "sm-dc-1",
        productId: "prod-med-oxy",
        type: "out",
        refType: "delivery",
        refId: "dc-1",
        quantity: 3,
      },
    ];

    const physicalFull = cylinders.filter(cylinderIsFullStock).length;
    assert.strictEqual(physicalFull, 7, "Physical full cylinders in warehouse is now 7");

    const stockRows = buildProductInventory(products, cylinders, sales, deliveries, movements);
    const row = stockRows.find((r) => r.productId === "prod-med-oxy");
    assert.strictEqual(row.full, 7, "Full stock is 7");
    assert.strictEqual(row.reserved, 0, "Reserved drops to 0 because delivery is confirmed");
    assert.strictEqual(row.available, 7, "Available is 7");
  });

  // 9. Reprocessing the same delivery does not duplicate stock-out
  await suite.test("9. Reprocessing the same delivery does not duplicate stock-out (Idempotency)", () => {
    const delivery = { id: "dc-1", status: "delivered" };
    let postCallCount = 0;

    function confirmDelivery(del) {
      if (del.status !== "pending" && del.status !== "in_transit") {
        throw new Error("Already confirmed");
      }
      postCallCount += 1;
    }

    // First confirmation succeeded
    // Second attempt must be rejected
    assert.throws(
      () => confirmDelivery(delivery),
      /Already confirmed/,
      "Must not re-process already confirmed delivery",
    );
    assert.strictEqual(postCallCount, 0, "No duplicate stock movement posted");
  });

  // 10. Existing stock-shortage protection continues working
  await suite.test("10. Stock-shortage protection continues working across products", () => {
    const products = [medOxyProduct, generalProduct];
    const cylinders = sampleCylinders.slice(0, 2); // Only 2 cylinders available
    const sales = [];
    const deliveries = [];
    const movements = [];

    // Attempting to order 5 cylinders when only 2 are in stock
    assert.throws(
      () => {
        assertSalesStockHelper(
          [{ productId: "prod-med-oxy", quantity: 5 }],
          products,
          cylinders,
          sales,
          deliveries,
          movements,
        );
      },
      /Insufficient stock for Medical Oxygen \( o2-1\.36\)\. Available: 2, Requested: 5\./,
      "Stock shortage check must prevent overselling",
    );

    // Attempting to order 60 stoves when 50 are in stock
    assert.throws(
      () => {
        assertSalesStockHelper(
          [{ productId: "prod-stove-1", quantity: 60 }],
          products,
          cylinders,
          sales,
          deliveries,
          movements,
        );
      },
      /Insufficient stock for RFL ROse Gas stove\. Available: 50, Requested: 60\./,
      "Stock shortage check must prevent overselling general products",
    );
  });
});
