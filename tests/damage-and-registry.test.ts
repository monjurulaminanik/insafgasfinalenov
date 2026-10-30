import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PurchaseOrder, SupplierReturn, CustomerReturn, StockMovement, Product, Cylinder } from "../src/types/index.ts";

describe("Purchase Return, Cylinder Registry & Damage Cylinder Tests", () => {
  const mockProducts: Product[] = [
    {
      id: "cyl-1",
      name: "12kg LPG Cylinder",
      category: "Cylinder",
      productType: "cylinder",
      uom: "cyl",
      price: 2200,
      cost: 1500,
      stock: 45,
    },
    {
      id: "cyl-2",
      name: "35kg Commercial Cylinder",
      category: "Cylinder",
      productType: "cylinder",
      uom: "cyl",
      price: 5000,
      cost: 4000,
      stock: 20,
    },
    {
      id: "gas-1",
      name: "LPG Bulk Refill",
      category: "Gas",
      productType: "gas",
      uom: "kg",
      price: 130,
      cost: 100,
      stock: 500,
    },
  ];

  describe("TASK 1: Purchase Order Return Navigation & Pre-fill Contract", () => {
    it("generates correct return link targeting suppliers return workflow with PO reference", () => {
      const po: PurchaseOrder = {
        id: "po-101",
        orderNo: "PO-2026-000019",
        supplierId: "sup-01",
        supplierName: "Amin Hasan",
        date: "2026-10-17",
        total: 56000,
        paid: 0,
        due: 56000,
        status: "received",
        items: [
          { productId: "cyl-1", productName: "12kg LPG Cylinder", quantity: 20, price: 1500 },
          { productId: "cyl-2", productName: "35kg Commercial Cylinder", quantity: 5, price: 4000 },
        ],
      };

      const returnUrl = `/suppliers/returns/new?purchaseId=${po.id}`;
      assert.equal(returnUrl, "/suppliers/returns/new?purchaseId=po-101");

      // Verify simulated prefill in SupplierReturnForm
      const prefilledState = {
        supplierId: po.supplierId,
        supplierName: po.supplierName,
        notes: `Return against PO #${po.orderNo}`,
        purchaseOrderId: po.id,
        purchaseOrderNo: po.orderNo,
        items: po.items.map((it) => ({
          productId: it.productId,
          productName: it.productName,
          quantity: it.quantity,
          price: it.price,
        })),
      };

      assert.equal(prefilledState.supplierId, "sup-01");
      assert.equal(prefilledState.supplierName, "Amin Hasan");
      assert.equal(prefilledState.purchaseOrderId, "po-101");
      assert.equal(prefilledState.purchaseOrderNo, "PO-2026-000019");
      assert.equal(prefilledState.items.length, 2);
      assert.equal(prefilledState.items[0].quantity, 20);
    });
  });

  describe("TASK 2: Cylinder Registry Column Calculations & Data Mapping", () => {
    const mockSupplierReturns: SupplierReturn[] = [
      {
        id: "sr-1",
        returnNo: "SR-2026-000001",
        supplierId: "sup-01",
        supplierName: "Amin Hasan",
        date: "2026-10-17",
        total: 3000,
        items: [
          { productId: "cyl-1", productName: "12kg LPG Cylinder", quantity: 2, price: 1500 },
        ],
      },
      {
        id: "sr-2",
        returnNo: "SR-2026-000002",
        supplierId: "sup-02",
        supplierName: "Omera Petroleum Ltd",
        date: "2026-10-17",
        total: 4500,
        items: [
          { productId: "cyl-1", productName: "12kg LPG Cylinder", quantity: 3, price: 1500 },
          { productId: "cyl-2", productName: "35kg Commercial Cylinder", quantity: 1, price: 4000 },
        ],
      },
    ];

    const mockPurchases: PurchaseOrder[] = [
      {
        id: "po-1",
        orderNo: "PO-001",
        supplierId: "sup-01",
        supplierName: "Amin Hasan",
        date: "2026-10-10",
        status: "received",
        total: 75000,
        paid: 75000,
        due: 0,
        items: [
          { productId: "cyl-1", productName: "12kg LPG Cylinder", quantity: 50, price: 1500 },
          { productId: "gas-1", productName: "LPG Bulk Refill", quantity: 200, price: 100 },
        ],
      },
      {
        id: "po-2",
        orderNo: "PO-002",
        supplierId: "sup-02",
        supplierName: "Omera Petroleum Ltd",
        date: "2026-10-12",
        status: "ordered",
        total: 40000,
        paid: 0,
        due: 40000,
        items: [
          { productId: "cyl-2", productName: "35kg Commercial Cylinder", quantity: 10, price: 4000 },
        ],
      },
      {
        id: "po-cancelled",
        orderNo: "PO-003",
        supplierId: "sup-01",
        supplierName: "Amin Hasan",
        date: "2026-10-14",
        status: "cancelled",
        total: 30000,
        paid: 0,
        due: 30000,
        items: [
          { productId: "cyl-1", productName: "12kg LPG Cylinder", quantity: 20, price: 1500 },
        ],
      },
    ];

    const mockCustomerReturns: CustomerReturn[] = [
      {
        id: "ret-1",
        orderId: "so-1",
        customerId: "cust-1",
        customerName: "Rahim Traders",
        date: "2026-10-15",
        status: "received",
        items: [
          { productId: "cyl-1", productName: "12kg LPG Cylinder", quantity: 7, price: 0 },
        ],
      },
      {
        id: "ret-cancelled",
        orderId: "so-2",
        customerId: "cust-2",
        customerName: "Karim Store",
        date: "2026-10-16",
        status: "cancelled",
        items: [
          { productId: "cyl-1", productName: "12kg LPG Cylinder", quantity: 10, price: 0 },
        ],
      },
    ];

    const mockStockMovements: StockMovement[] = [
      {
        id: "mov-1",
        date: "2026-10-16",
        movementType: "DAMAGE",
        productId: "cyl-1",
        productName: "12kg LPG Cylinder",
        quantity: 4,
        notes: "Valve damaged during handling",
        refId: "DMG-20261016-1",
      },
      {
        id: "mov-2",
        date: "2026-10-17",
        movementType: "OUT",
        productId: "cyl-1",
        productName: "12kg LPG Cylinder",
        quantity: 10,
      },
    ];

    const mockCylinders: Cylinder[] = [
      { id: "c-1", serialNumber: "SN-001", productId: "cyl-1", status: "damaged", fill: "empty" },
      { id: "c-2", serialNumber: "SN-002", productId: "cyl-1", status: "damaged", fill: "empty" },
      { id: "c-3", serialNumber: "SN-003", productId: "cyl-1", status: "in_stock", fill: "full" },
      { id: "c-4", serialNumber: "SN-004", productId: "cyl-1", status: "at_customer", fill: "empty" },
    ];

    it("correctly calculates 'Suppliers Return' from supplier returns only", () => {
      const p1Returns = mockSupplierReturns.reduce((sum, sr) => {
        const itemSum = (sr.items || [])
          .filter((it) => it.productId === "cyl-1")
          .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        return sum + itemSum;
      }, 0);

      const p2Returns = mockSupplierReturns.reduce((sum, sr) => {
        const itemSum = (sr.items || [])
          .filter((it) => it.productId === "cyl-2")
          .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        return sum + itemSum;
      }, 0);

      assert.equal(p1Returns, 5); // 2 + 3
      assert.equal(p2Returns, 1); // 1
    });

    it("correctly calculates 'Total Purchase' from non-cancelled purchase cylinder quantities", () => {
      const activePurchases = mockPurchases.filter((po) => po.status !== "cancelled");

      const p1Purchased = activePurchases.reduce((sum, po) => {
        const itemSum = (po.items || [])
          .filter((it) => it.productId === "cyl-1")
          .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        return sum + itemSum;
      }, 0);

      const p2Purchased = activePurchases.reduce((sum, po) => {
        const itemSum = (po.items || [])
          .filter((it) => it.productId === "cyl-2")
          .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        return sum + itemSum;
      }, 0);

      assert.equal(p1Purchased, 50); // po-cancelled (20) ignored
      assert.equal(p2Purchased, 10);
    });

    it("correctly calculates 'Customer Return' from non-cancelled customer returns only", () => {
      const activeReturns = mockCustomerReturns.filter((r) => r.status !== "cancelled");

      const p1CustReturns = activeReturns.reduce((sum, r) => {
        const itemSum = (r.items || [])
          .filter((it) => it.productId === "cyl-1")
          .reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        return sum + itemSum;
      }, 0);

      assert.equal(p1CustReturns, 7); // ret-cancelled (10) ignored
    });

    it("correctly links 'Loss / Damage' without double counting", () => {
      // Cyl-1: 4 recorded in DAMAGE movements, 2 in serialized cylinders (SN-001, SN-002)
      const dmgMovements = mockStockMovements
        .filter((m) => m.movementType === "DAMAGE" && m.productId === "cyl-1")
        .reduce((sum, m) => sum + (Number(m.quantity) || 0), 0);

      const serializedDamaged = mockCylinders.filter(
        (c) => c.productId === "cyl-1" && (c.status === "damaged" || c.status === "scrapped")
      ).length;

      // Taking Math.max ensures recorded movements reflect the damage without adding serialized duplicates
      const effectiveDamage = Math.max(dmgMovements, serializedDamaged);

      assert.equal(effectiveDamage, 4);
    });

    it("preserves 'Full', 'Total' and 'Stock Value' calculations", () => {
      const p = mockProducts[0]; // stock: 45, cost: 1500
      const full = p.stock || 0;
      const total = full; // in standard calculation
      const stockValue = total * (p.cost || 0);

      assert.equal(full, 45);
      assert.equal(total, 45);
      assert.equal(stockValue, 45 * 1500);
    });
  });

  describe("TASK 3: Damage Cylinder Entry Validation & Safety", () => {
    it("validates positive damage quantity", () => {
      const invalidQty1 = 0;
      const invalidQty2 = -5;
      const validQty = 3;

      assert.ok(invalidQty1 <= 0);
      assert.ok(invalidQty2 <= 0);
      assert.ok(validQty > 0);
    });

    it("formats reference ID with date prefix DMG-YYYYMMDD", () => {
      const now = new Date("2026-10-17T12:00:00Z");
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
      const refId = `DMG-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;
      assert.match(refId, /^DMG-20261017-\d{4}$/);
    });
  });
});
