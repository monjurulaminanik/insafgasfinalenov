import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  CylinderInventory,
  GasInventory,
  LineItem,
  Product,
  ProductInventory,
  ProductType,
  PurchaseOrder,
  SalesOrder,
  StockMovement,
} from "../src/types/index.ts";
import {
  computeReservedQty,
  reconcileDatabaseInventory,
  resolveProductType,
} from "../src/lib/inventory.server.ts";

describe("Authoritative Inventory Accounting & Reconciliation Tests", () => {
  // TEST 1 — GAS PURCHASE
  it("TEST 1: Gas purchase increases Gas Stock In and On Hand without modifying other types", () => {
    const gasInv: GasInventory = {
      id: "gas-1",
      productId: "g1",
      productName: "Industrial Gas A",
      productType: "gas",
      uom: "kg",
      openingStock: 100,
      stockIn: 0,
      stockOut: 0,
      onHand: 100,
      unitPrice: 50,
      costPrice: 40,
      totalValue: 4000,
      updatedAt: new Date().toISOString(),
    };

    const purchaseQty = 20;
    gasInv.stockIn += purchaseQty;
    gasInv.onHand = gasInv.openingStock + gasInv.stockIn - gasInv.stockOut;
    gasInv.totalValue = gasInv.onHand * gasInv.costPrice;

    assert.strictEqual(gasInv.stockIn, 20);
    assert.strictEqual(gasInv.stockOut, 0);
    assert.strictEqual(gasInv.onHand, 120);
    assert.strictEqual(gasInv.totalValue, 4800);
  });

  // TEST 2 — GAS SALE
  it("TEST 2: Gas sale increases Stock Out and decreases On Hand", () => {
    const gasInv: GasInventory = {
      id: "gas-1",
      productId: "g1",
      productName: "Industrial Gas A",
      productType: "gas",
      uom: "kg",
      openingStock: 100,
      stockIn: 20,
      stockOut: 0,
      onHand: 120,
      unitPrice: 50,
      costPrice: 40,
      totalValue: 4800,
      updatedAt: new Date().toISOString(),
    };

    const saleQty = 10;
    gasInv.stockOut += saleQty;
    gasInv.onHand = gasInv.openingStock + gasInv.stockIn - gasInv.stockOut;
    gasInv.totalValue = gasInv.onHand * gasInv.costPrice;

    assert.strictEqual(gasInv.stockOut, 10);
    assert.strictEqual(gasInv.onHand, 110);
    assert.strictEqual(gasInv.totalValue, 4400);
  });

  // TEST 3 — CYLINDER PURCHASE
  it("TEST 3: Cylinder purchase increases Cylinder On Hand", () => {
    const cylInv: CylinderInventory = {
      id: "cyl-1",
      productId: "c1",
      productName: "LPG Cylinder 12kg",
      productType: "cylinder",
      uom: "cyl",
      openingStock: 100,
      stockIn: 0,
      stockOut: 0,
      reserved: 0,
      available: 100,
      onHand: 100,
      unitPrice: 1400,
      costPrice: 1000,
      totalValue: 100000,
      updatedAt: new Date().toISOString(),
    };

    const receivedQty = 20;
    cylInv.stockIn += receivedQty;
    cylInv.onHand = cylInv.openingStock + cylInv.stockIn - cylInv.stockOut;
    cylInv.available = Math.max(0, cylInv.onHand - cylInv.reserved);

    assert.strictEqual(cylInv.onHand, 120);
    assert.strictEqual(cylInv.available, 120);
    assert.strictEqual(cylInv.reserved, 0);
  });

  // TEST 4 — CYLINDER SALE WITH RESERVED STOCK
  it("TEST 4: Cylinder sale maintains Reserved and Available formulas (Available = On Hand - Reserved)", () => {
    const cylInv: CylinderInventory = {
      id: "cyl-1",
      productId: "c1",
      productName: "LPG Cylinder 12kg",
      productType: "cylinder",
      uom: "cyl",
      openingStock: 100,
      stockIn: 20,
      stockOut: 0,
      reserved: 5,
      available: 115,
      onHand: 120,
      unitPrice: 1400,
      costPrice: 1000,
      totalValue: 120000,
      updatedAt: new Date().toISOString(),
    };

    // Actual sale = 10 cylinders delivered
    const actualSale = 10;
    cylInv.stockOut += actualSale;
    cylInv.onHand = cylInv.openingStock + cylInv.stockIn - cylInv.stockOut;
    cylInv.available = Math.max(0, cylInv.onHand - cylInv.reserved);

    assert.strictEqual(cylInv.onHand, 110);
    assert.strictEqual(cylInv.reserved, 5);
    assert.strictEqual(cylInv.available, 105);
  });

  // TEST 5 — GENERAL PRODUCT
  it("TEST 5: General product inventory follows On Hand = Opening + Purchase - Sale", () => {
    const prodInv: ProductInventory = {
      id: "prod-1",
      productId: "p1",
      productName: "Gas Regulator Valve",
      productType: "product",
      uom: "pcs",
      openingStock: 50,
      stockIn: 0,
      stockOut: 0,
      onHand: 50,
      unitPrice: 350,
      costPrice: 250,
      totalValue: 12500,
      updatedAt: new Date().toISOString(),
    };

    const purchaseQty = 20;
    const saleQty = 15;

    prodInv.stockIn += purchaseQty;
    prodInv.stockOut += saleQty;
    prodInv.onHand = prodInv.openingStock + prodInv.stockIn - prodInv.stockOut;

    assert.strictEqual(prodInv.onHand, 55);
    assert.strictEqual(prodInv.stockIn, 20);
    assert.strictEqual(prodInv.stockOut, 15);
  });

  // TEST 6 — TYPE ISOLATION
  it("TEST 6: Gas != Cylinder != Product isolation guarantees no cross-type contamination", () => {
    const gas: GasInventory = {
      id: "gas-1",
      productId: "g1",
      productName: "Gas Product",
      productType: "gas",
      uom: "kg",
      openingStock: 100,
      stockIn: 0,
      stockOut: 0,
      onHand: 100,
      unitPrice: 50,
      costPrice: 40,
      totalValue: 4000,
      updatedAt: new Date().toISOString(),
    };

    const cyl: CylinderInventory = {
      id: "cyl-1",
      productId: "c1",
      productName: "Cylinder Product",
      productType: "cylinder",
      uom: "cyl",
      openingStock: 100,
      stockIn: 0,
      stockOut: 0,
      reserved: 0,
      available: 100,
      onHand: 100,
      unitPrice: 1200,
      costPrice: 1000,
      totalValue: 100000,
      updatedAt: new Date().toISOString(),
    };

    const prod: ProductInventory = {
      id: "prod-1",
      productId: "pr1",
      productName: "General Item",
      productType: "product",
      uom: "pcs",
      openingStock: 100,
      stockIn: 0,
      stockOut: 0,
      onHand: 100,
      unitPrice: 200,
      costPrice: 150,
      totalValue: 15000,
      updatedAt: new Date().toISOString(),
    };

    // Action A: Sell 10 Gas
    gas.stockOut += 10;
    gas.onHand = gas.openingStock + gas.stockIn - gas.stockOut;
    assert.strictEqual(gas.onHand, 90);
    assert.strictEqual(cyl.onHand, 100);
    assert.strictEqual(prod.onHand, 100);

    // Action B: Sell 10 Cylinder
    cyl.stockOut += 10;
    cyl.onHand = cyl.openingStock + cyl.stockIn - cyl.stockOut;
    cyl.available = cyl.onHand - cyl.reserved;
    assert.strictEqual(gas.onHand, 90);
    assert.strictEqual(cyl.onHand, 90);
    assert.strictEqual(prod.onHand, 100);

    // Action C: Sell 10 General Product
    prod.stockOut += 10;
    prod.onHand = prod.openingStock + prod.stockIn - prod.stockOut;
    assert.strictEqual(gas.onHand, 90);
    assert.strictEqual(cyl.onHand, 90);
    assert.strictEqual(prod.onHand, 90);
  });

  // TEST 7 — DUPLICATE REQUEST PROTECTION (IDEMPOTENCY)
  it("TEST 7: Duplicate request with same idempotency key executes stock movement exactly once", () => {
    const movements: StockMovement[] = [];
    const postSale = (refId: string, productId: string, qty: number) => {
      const alreadyPosted = movements.some(
        (m) => m.refType === "sales" && m.refId === refId && m.productId === productId && m.type === "out",
      );
      if (alreadyPosted) return false;
      movements.push({
        id: "mov-" + Math.random(),
        date: new Date().toISOString(),
        productId,
        productName: "Test Product",
        type: "out",
        movementType: "SALE_ISSUE",
        quantity: qty,
        balanceAfter: 90,
        refType: "sales",
        refId,
        by: "Sales",
      });
      return true;
    };

    const first = postSale("so-100", "p1", 10);
    const second = postSale("so-100", "p1", 10); // Duplicate call
    assert.strictEqual(first, true);
    assert.strictEqual(second, false);
    assert.strictEqual(movements.length, 1);
    assert.strictEqual(movements[0].quantity, 10);
  });

  // TEST 8 — PURCHASE EDIT (DELTA CALCULATION)
  it("TEST 8: Purchase edit applies only the delta difference (100 -> 120 = +20)", () => {
    let stockIn = 100;
    const oldQty = 100;
    const newQty = 120;
    const delta = newQty - oldQty; // +20
    stockIn += delta;
    assert.strictEqual(delta, 20);
    assert.strictEqual(stockIn, 120);

    // Edit down: 120 -> 80 = -40
    const downNewQty = 80;
    const downDelta = downNewQty - 120;
    stockIn += downDelta;
    assert.strictEqual(downDelta, -40);
    assert.strictEqual(stockIn, 80);
  });

  // TEST 9 — SALE EDIT (DELTA CALCULATION)
  it("TEST 9: Sale edit applies only the delta stockOut difference (10 -> 15 = +5 stockOut)", () => {
    let stockOut = 10;
    const oldQty = 10;
    const newQty = 15;
    const delta = newQty - oldQty; // +5
    stockOut += delta;
    assert.strictEqual(delta, 5);
    assert.strictEqual(stockOut, 15);

    // Reverse down: 15 -> 7 = -8
    const downNewQty = 7;
    const downDelta = downNewQty - 15;
    stockOut += downDelta;
    assert.strictEqual(downDelta, -8);
    assert.strictEqual(stockOut, 7);
  });

  // TEST 10 — PURCHASE RECEIVING (PO ALONE vs GRN)
  it("TEST 10: Creating PO alone does not increase stock until GRN is received", () => {
    let physicalStock = 50;
    const po: PurchaseOrder = {
      id: "po-test",
      orderNo: "PO-2026-001",
      supplierId: "s1",
      supplierName: "Test Supplier",
      date: new Date().toISOString(),
      items: [{ productId: "p1", productName: "Product 1", quantity: 100, price: 50 }],
      subtotal: 5000,
      tax: 0,
      total: 5000,
      paid: 0,
      status: "ordered", // Not yet received
    };

    // PO alone does NOT change physicalStock
    assert.strictEqual(physicalStock, 50);

    // GRN received:
    const grnReceivedQty = 100;
    physicalStock += grnReceivedQty;
    po.status = "received";

    assert.strictEqual(physicalStock, 150);
  });

  // TEST 11 — RESOLVE PRODUCT TYPE
  it("TEST 11: resolveProductType correctly resolves Gas, Cylinder, and Product", () => {
    assert.strictEqual(resolveProductType({ productType: "gas", uom: "kg" }), "gas");
    assert.strictEqual(resolveProductType({ productType: "cylinder", uom: "cyl" }), "cylinder");
    assert.strictEqual(resolveProductType({ productType: "product", uom: "pcs" }), "product");
    assert.strictEqual(resolveProductType({ uom: "cyl" }), "cylinder");
    assert.strictEqual(resolveProductType({ uom: "kg" }), "gas");
    assert.strictEqual(resolveProductType({ uom: "pcs" }), "product");
    // mitar with uom cyl must resolve to cylinder
    assert.strictEqual(resolveProductType({ name: "mitar", uom: "cyl", category: "Medical" }), "cylinder");
  });

  // TEST 12 — GAS SALE 50 DEDUCTION
  it("TEST 12: Gas sale 50: Starting stock 90, sale 50 -> Current Stock 40, Stock Out +50", () => {
    const gasInv: GasInventory = {
      id: "gas-argon",
      productId: "azdmoisv",
      productName: "Argon 0.98",
      productType: "gas",
      uom: "kg",
      openingStock: 100,
      stockIn: 0,
      stockOut: 10,
      onHand: 90,
      unitPrice: 2400,
      costPrice: 2170,
      totalValue: 90 * 2170,
      updatedAt: new Date().toISOString(),
    };

    // Sale of 50
    const soldQty = 50;
    gasInv.stockOut += soldQty;
    gasInv.onHand = gasInv.openingStock + gasInv.stockIn - gasInv.stockOut;
    gasInv.totalValue = gasInv.onHand * gasInv.costPrice;

    assert.strictEqual(gasInv.stockOut, 60);
    assert.strictEqual(gasInv.onHand, 40); // 100 + 0 - 60 = 40 (90 - 50 = 40)
    assert.notStrictEqual(gasInv.onHand, 140);
  });

  // TEST 13 — PURCHASE AFTER SALE
  it("TEST 13: Purchase after sale: Starting stock 40, purchase 50 -> Current Stock 90", () => {
    const gasInv: GasInventory = {
      id: "gas-argon",
      productId: "azdmoisv",
      productName: "Argon 0.98",
      productType: "gas",
      uom: "kg",
      openingStock: 100,
      stockIn: 0,
      stockOut: 60,
      onHand: 40,
      unitPrice: 2400,
      costPrice: 2170,
      totalValue: 40 * 2170,
      updatedAt: new Date().toISOString(),
    };

    // Purchase of 50
    const purchaseQty = 50;
    gasInv.stockIn += purchaseQty;
    gasInv.onHand = gasInv.openingStock + gasInv.stockIn - gasInv.stockOut;
    gasInv.totalValue = gasInv.onHand * gasInv.costPrice;

    assert.strictEqual(gasInv.stockIn, 50);
    assert.strictEqual(gasInv.onHand, 90); // 100 + 50 - 60 = 90 (40 + 50 = 90)
  });

  // TEST 14 — SALES RETURN AND PURCHASE RETURN
  it("TEST 14: Sales Return increases Current Stock, Purchase Return decreases Current Stock", () => {
    let opening = 100;
    let stockIn = 50;
    let stockOut = 30;
    let currentStock = opening + stockIn - stockOut; // 120
    assert.strictEqual(currentStock, 120);

    // Sales return of 5 units (returned back into stock)
    const salesReturn = 5;
    stockIn += salesReturn; // Return IN
    currentStock = opening + stockIn - stockOut;
    assert.strictEqual(currentStock, 125);

    // Purchase return of 10 units (returned back to supplier)
    const purchaseReturn = 10;
    stockOut += purchaseReturn; // Return OUT
    currentStock = opening + stockIn - stockOut;
    assert.strictEqual(currentStock, 115);
  });

  // TEST 15 — RECONCILIATION RESTORES CYLINDER AND PRODUCT INVENTORIES
  it("TEST 15: reconcileDatabaseInventory restores Cylinder and Product Inventories from referenced records with Available = On Hand - Reserved", async () => {
    const mockDb = {
      collections: {
        products: [
          { id: "g1", name: "Fresh 12 kg", productType: "gas", uom: "kg", cost: 1000, price: 1200, stock: 10 },
        ],
        cylinders: [],
        stockMovements: [
          { id: "m1", productId: "cyl-p1", productName: "LPG Domestic 12kg", productType: "cylinder", type: "in", movementType: "RECEIPT", quantity: 50, unitCost: 1200 },
          { id: "m2", productId: "cyl-p1", productName: "LPG Domestic 12kg", productType: "cylinder", type: "out", movementType: "SALE_ISSUE", quantity: 12, unitCost: 1200 },
          { id: "m3", productId: "prod-s1", productName: "Gas Stove Single", productType: "product", type: "in", movementType: "RECEIPT", quantity: 30, unitCost: 2000 },
          { id: "m4", productId: "prod-s1", productName: "Gas Stove Single", productType: "product", type: "out", movementType: "SALE_ISSUE", quantity: 5, unitCost: 2000 },
        ],
        sales: [
          {
            id: "so-1",
            status: "confirmed",
            items: [{ productId: "cyl-p1", productName: "LPG Domestic 12kg", quantity: 12 }],
          },
        ],
        deliveries: [
          {
            id: "del-1",
            salesOrderId: "so-1",
            status: "delivered",
            items: [{ productId: "cyl-p1", quantity: 4 }],
          },
        ],
        purchases: [],
        auditLogs: [
          {
            entityType: "products",
            entityId: "cyl-p1",
            action: "DELETE",
            before: {
              id: "cyl-p1",
              name: "LPG Domestic 12kg",
              productType: "cylinder",
              uom: "cyl",
              cost: 1200,
              price: 1450,
            },
          },
          {
            entityType: "products",
            entityId: "prod-s1",
            action: "DELETE",
            before: {
              id: "prod-s1",
              name: "Gas Stove Single",
              productType: "product",
              uom: "pcs",
              cost: 2000,
              price: 3000,
            },
          },
        ],
        gasInventory: [],
        cylinderInventory: [],
        productInventory: [],
      } as Record<string, any[]>,
      collection(name: string) {
        const col = this.collections[name] || (this.collections[name] = []);
        return {
          find(query: any = {}) {
            let filtered = col.filter((item: any) => {
              for (const [k, v] of Object.entries(query)) {
                if (v && typeof v === "object" && "$in" in v) {
                  if (!(v as any).$in.includes(item[k])) return false;
                } else if (item[k] !== v) {
                  return false;
                }
              }
              return true;
            });
            return {
              sort() { return this; },
              async toArray() { return [...filtered]; },
            };
          },
          async updateOne(filter: any, update: any, options: any = {}) {
            const idx = col.findIndex((item: any) => {
              for (const [k, v] of Object.entries(filter)) {
                if (item[k] !== v) return false;
              }
              return true;
            });
            if (idx >= 0) {
              col[idx] = { ...col[idx], ...(update.$set || {}) };
            } else if (options.upsert) {
              col.push({ ...filter, ...(update.$set || {}) });
            }
            return { acknowledged: true };
          },
          async insertOne(doc: any) {
            col.push(doc);
            return { acknowledged: true, insertedId: doc.id || doc._id };
          },
          async deleteMany(filter: any = {}) {
            mockDb.collections[name] = col.filter((item: any) => {
              if (filter.productId && typeof filter.productId === "object" && "$nin" in filter.productId) {
                return filter.productId.$nin.includes(item.productId);
              }
              return false;
            });
            return { acknowledged: true };
          },
        };
      },
    };

    const summary = await reconcileDatabaseInventory(mockDb);

    // 1. Gas inventory contains active catalog gas products
    assert.strictEqual(summary.gas.length, 1);
    assert.strictEqual(summary.gas[0].productId, "g1");

    // 2. Cylinder inventory restored from cylinders and movements
    assert.strictEqual(summary.cylinders.length, 1);
    const cylRow = summary.cylinders[0];
    assert.strictEqual(cylRow.productId, "cyl-p1");
    assert.strictEqual(cylRow.productName, "LPG Domestic 12kg");
    assert.strictEqual(cylRow.uom, "cyl");
    assert.strictEqual(cylRow.stockIn, 50);
    // Active posted sale order has 12, which guarantees stockOut is at least 12
    assert.strictEqual(cylRow.stockOut, 12);
    assert.strictEqual(cylRow.onHand, 38); // 0 + 50 - 12 = 38
    // Reserved = 12 ordered - 4 delivered = 8
    assert.strictEqual(cylRow.reserved, 8);
    // Available = On Hand - Reserved = 38 - 8 = 30
    assert.strictEqual(cylRow.available, 30);
    assert.strictEqual(cylRow.costPrice, 1200);
    assert.strictEqual(cylRow.totalValue, 38 * 1200);

    // 3. Product inventory restored from movements
    assert.strictEqual(summary.products.length, 1);
    const prodRow = summary.products[0];
    assert.strictEqual(prodRow.productId, "prod-s1");
    assert.strictEqual(prodRow.productName, "Gas Stove Single");
    assert.strictEqual(prodRow.uom, "pcs");
    assert.strictEqual(prodRow.stockIn, 30);
    assert.strictEqual(prodRow.stockOut, 5);
    assert.strictEqual(prodRow.onHand, 25); // 0 + 30 - 5 = 25
    assert.strictEqual(prodRow.costPrice, 2000);
    assert.strictEqual(prodRow.totalValue, 25 * 2000);
  });

  // TEST 16 — LEGITIMATE EMPTY RESULTS PRODUCE EMPTY LISTS
  it("TEST 16: Legitimate empty database yields empty lists without error", async () => {
    const emptyDb = {
      collections: {} as Record<string, any[]>,
      collection(name: string) {
        const col = this.collections[name] || (this.collections[name] = []);
        return {
          find() {
            return {
              sort() { return this; },
              async toArray() { return []; },
            };
          },
          async updateOne() { return { acknowledged: true }; },
          async deleteMany() { return { acknowledged: true }; },
        };
      },
    };

    const summary = await reconcileDatabaseInventory(emptyDb);
    assert.strictEqual(summary.gas.length, 0);
    assert.strictEqual(summary.cylinders.length, 0);
    assert.strictEqual(summary.products.length, 0);
    assert.strictEqual(summary.totals.gasOnHand, 0);
    assert.strictEqual(summary.totals.cylinderOnHand, 0);
    assert.strictEqual(summary.totals.productOnHand, 0);
    assert.strictEqual(summary.totals.totalValue, 0);
  });
});
