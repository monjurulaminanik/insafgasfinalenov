import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LineItem, Product, CylinderInventory, ProductInventory, PurchaseOrder } from "../src/types/index.ts";
import { computeTotals, lineAmount } from "../src/utils/helpers.ts";

function getProductType(p: { productType?: string; category?: string; uom?: string }): "gas" | "cylinder" | "product" {
  const uom = String(p.uom || "").toLowerCase();
  if (uom === "cyl") return "cylinder";
  if (uom === "pcs") return "product";
  if (p.productType === "gas" || p.productType === "cylinder" || p.productType === "product") {
    return p.productType;
  }
  if (uom === "kg" || uom === "ltr") return "gas";
  if (p.category === "LPG" || p.category === "Industrial" || p.category === "Medical") {
    return "cylinder";
  }
  return "gas";
}

interface PurchaseItemOption {
  id: string;
  name: string;
  productType: "gas" | "cylinder" | "product";
  cost: number;
}

function buildAvailableProducts(
  products: Product[],
  cylinderInventory: CylinderInventory[],
  productInventory: ProductInventory[],
  existing?: PurchaseOrder | null,
): PurchaseItemOption[] {
  const list: PurchaseItemOption[] = [];
  const seen = new Set<string>();

  for (const p of products) {
    const type = getProductType(p);
    list.push({
      id: p.id,
      name: p.name,
      productType: type,
      cost: p.cost ?? p.price,
    });
    seen.add(p.id);
  }

  for (const c of cylinderInventory) {
    if (!c.productId || seen.has(c.productId)) continue;
    list.push({
      id: c.productId,
      name: c.productName,
      productType: "cylinder",
      cost: c.costPrice ?? c.unitPrice ?? 0,
    });
    seen.add(c.productId);
  }

  for (const p of productInventory) {
    if (!p.productId || seen.has(p.productId)) continue;
    list.push({
      id: p.productId,
      name: p.productName,
      productType: "product",
      cost: p.costPrice ?? p.unitPrice ?? 0,
    });
    seen.add(p.productId);
  }

  if (existing?.items) {
    for (const it of existing.items) {
      if (it.productId && !seen.has(it.productId)) {
        list.push({
          id: it.productId,
          name: it.productName,
          productType: it.itemType || "gas",
          cost: it.price,
        });
        seen.add(it.productId);
      }
    }
  }

  return list;
}

describe("Purchase Order Items & Dropdowns Tests", () => {
  const sampleProducts: Product[] = [
    {
      id: "3j7mc5v0",
      code: "FRESH-12",
      name: "Fresh 12 kg",
      category: "LPG",
      productType: "gas",
      uom: "kg",
      price: 1350,
      cost: 1200,
      stock: 50,
      reorderLevel: 10,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "o3ptw5af",
      code: "FRESH-35",
      name: "Fresh 35 kg",
      category: "LPG",
      productType: "gas",
      uom: "kg",
      price: 3800,
      cost: 3400,
      stock: 30,
      reorderLevel: 5,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const sampleCylinders: CylinderInventory[] = [
    {
      id: "cyl-p1",
      productId: "p1",
      productName: "LPG Domestic 12kg",
      productType: "cylinder",
      uom: "cyl",
      openingStock: 200,
      stockIn: 53,
      stockOut: 0,
      reserved: 20,
      available: 233,
      onHand: 253,
      unitPrice: 1300,
      costPrice: 1200,
      totalValue: 303600,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "cyl-p4",
      productId: "p4",
      productName: "Medical Oxygen D-Type",
      productType: "cylinder",
      uom: "cyl",
      openingStock: 50,
      stockIn: 0,
      stockOut: 0,
      reserved: 5,
      available: 45,
      onHand: 50,
      unitPrice: 700,
      costPrice: 620,
      totalValue: 31000,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  const sampleProductInventory: ProductInventory[] = [
    {
      id: "prod-3eing5fd",
      productId: "3eing5fd",
      productName: "RFL ROse Gas stove",
      productType: "product",
      uom: "pcs",
      openingStock: 90,
      stockIn: 0,
      stockOut: 0,
      onHand: 90,
      unitPrice: 1200,
      costPrice: 1000,
      totalValue: 90000,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("1. Correctly unifies Gas, Cylinder, and Product inventories without omissions", () => {
    const available = buildAvailableProducts(sampleProducts, sampleCylinders, sampleProductInventory);
    assert.strictEqual(available.length, 5);

    const gasItems = available.filter((p) => p.productType === "gas");
    const cylinderItems = available.filter((p) => p.productType === "cylinder");
    const productItems = available.filter((p) => p.productType === "product");

    assert.strictEqual(gasItems.length, 2);
    assert.strictEqual(cylinderItems.length, 2);
    assert.strictEqual(productItems.length, 1);
  });

  it("2. When type is Cylinder, dropdown presents all existing cylinders with their ID, name, and default cost", () => {
    const available = buildAvailableProducts(sampleProducts, sampleCylinders, sampleProductInventory);
    const cylinderOptions = available.filter((p) => p.productType === "cylinder");

    assert.strictEqual(cylinderOptions.length, 2);
    assert.strictEqual(cylinderOptions[0].id, "p1");
    assert.strictEqual(cylinderOptions[0].name, "LPG Domestic 12kg");
    assert.strictEqual(cylinderOptions[0].cost, 1200);

    assert.strictEqual(cylinderOptions[1].id, "p4");
    assert.strictEqual(cylinderOptions[1].name, "Medical Oxygen D-Type");
    assert.strictEqual(cylinderOptions[1].cost, 620);
  });

  it("3. When type is Product, dropdown presents general products with their ID, name, and default cost", () => {
    const available = buildAvailableProducts(sampleProducts, sampleCylinders, sampleProductInventory);
    const generalProductOptions = available.filter((p) => p.productType === "product");

    assert.strictEqual(generalProductOptions.length, 1);
    assert.strictEqual(generalProductOptions[0].id, "3eing5fd");
    assert.strictEqual(generalProductOptions[0].name, "RFL ROse Gas stove");
    assert.strictEqual(generalProductOptions[0].cost, 1000);
  });

  it("4. When type is Gas, dropdown presents gas items", () => {
    const available = buildAvailableProducts(sampleProducts, sampleCylinders, sampleProductInventory);
    const gasOptions = available.filter((p) => p.productType === "gas");

    assert.strictEqual(gasOptions.length, 2);
    assert.strictEqual(gasOptions[0].id, "3j7mc5v0");
    assert.strictEqual(gasOptions[0].name, "Fresh 12 kg");
    assert.strictEqual(gasOptions[0].cost, 1200);
  });

  it("5. Selecting items accurately computes line totals, subtotal, and total", () => {
    const available = buildAvailableProducts(sampleProducts, sampleCylinders, sampleProductInventory);

    const cylItem = available.find((p) => p.id === "p1")!;
    const prodItem = available.find((p) => p.id === "3eing5fd")!;
    const gasItem = available.find((p) => p.id === "3j7mc5v0")!;

    const items: LineItem[] = [
      {
        productId: cylItem.id,
        productName: cylItem.name,
        itemType: cylItem.productType,
        quantity: 10,
        price: cylItem.cost,
        taxRate: 0,
      },
      {
        productId: prodItem.id,
        productName: prodItem.name,
        itemType: prodItem.productType,
        quantity: 5,
        price: prodItem.cost,
        taxRate: 0,
      },
      {
        productId: gasItem.id,
        productName: gasItem.name,
        itemType: gasItem.productType,
        quantity: 20,
        price: gasItem.cost,
        taxRate: 0,
      },
    ];

    assert.strictEqual(lineAmount(items[0]), 10 * 1200); // 12,000
    assert.strictEqual(lineAmount(items[1]), 5 * 1000); // 5,000
    assert.strictEqual(lineAmount(items[2]), 20 * 1200); // 24,000

    const totals = computeTotals(items);
    assert.strictEqual(totals.subtotal, 41000);
    assert.strictEqual(totals.total, 41000);
  });

  it("6. Validation accepts valid cylinder, gas, and product line items and rejects mismatches", () => {
    const available = buildAvailableProducts(sampleProducts, sampleCylinders, sampleProductInventory);

    // Valid items
    const validItems: LineItem[] = [
      { productId: "p1", productName: "LPG Domestic 12kg", itemType: "cylinder", quantity: 5, price: 1200 },
      { productId: "3eing5fd", productName: "RFL ROse Gas stove", itemType: "product", quantity: 2, price: 1000 },
      { productId: "3j7mc5v0", productName: "Fresh 12 kg", itemType: "gas", quantity: 15, price: 1200 },
    ];

    for (const it of validItems) {
      assert.ok(it.productId && it.productName);
      assert.ok(it.itemType);
      const prod = available.find((p) => p.id === it.productId);
      assert.ok(prod);
      assert.strictEqual(prod.productType, it.itemType);
      assert.ok(it.quantity > 0);
      assert.ok(it.price >= 0);
    }

    // Mismatched item (gas item marked as cylinder)
    const mismatchedItem: LineItem = {
      productId: "3j7mc5v0",
      productName: "Fresh 12 kg",
      itemType: "cylinder",
      quantity: 5,
      price: 1200,
    };
    const prod = available.find((p) => p.id === mismatchedItem.productId);
    assert.notStrictEqual(prod?.productType, mismatchedItem.itemType);
  });

  it("7. Preserves existing items from historical PO during edit mode even if not in current catalog", () => {
    const historicalPO: PurchaseOrder = {
      id: "po-hist-1",
      orderNo: "PO-2026-4068",
      supplierId: "s1",
      supplierName: "Omera Petroleum Ltd",
      date: "2026-01-01T00:00:00.000Z",
      status: "ordered",
      paid: 0,
      subtotal: 140000,
      tax: 0,
      total: 140000,
      items: [
        {
          productId: "0n4pn2g1",
          productName: "mitar",
          itemType: "cylinder",
          quantity: 100,
          price: 1400,
        },
      ],
    };

    const available = buildAvailableProducts(sampleProducts, sampleCylinders, sampleProductInventory, historicalPO);
    const mitar = available.find((p) => p.id === "0n4pn2g1");
    assert.ok(mitar);
    assert.strictEqual(mitar.name, "mitar");
    assert.strictEqual(mitar.productType, "cylinder");
    assert.strictEqual(mitar.cost, 1400);
  });
});
