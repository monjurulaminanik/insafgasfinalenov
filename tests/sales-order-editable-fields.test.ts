import test from "node:test";
import assert from "node:assert/strict";
import { salesOrderSchema, lineItemSchema } from "../src/utils/validators";
import type { LineItem, SalesOrder } from "../src/types";

test("SO-EDITABLE-01: Deliveryman Field - Selected vs Custom Manually Typed", async (t) => {
  const baseItem: LineItem = {
    productId: "prod-1",
    productName: "12kg LPG Refill",
    quantity: 5,
    price: 1400,
    category: "LPG",
  };

  await t.test("Validates and accepts selected Deliveryman name from existing staff list", () => {
    const selectedStaffName = "Jahangir Alam";
    const result = salesOrderSchema.safeParse({
      customerName: "Green Valley Resort",
      items: [baseItem],
      driverName: selectedStaffName,
    });

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.driverName, "Jahangir Alam");
    }
  });

  await t.test("Validates and accepts custom manually typed Deliveryman name", () => {
    const customDriverName = "Habib Express Logistics";
    const result = salesOrderSchema.safeParse({
      customerName: "Green Valley Resort",
      items: [baseItem],
      driverName: customDriverName.trim(),
    });

    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.driverName, "Habib Express Logistics");
    }
  });

  await t.test("Allows omitting or clearing Deliveryman (optional / —)", () => {
    const clearedResult = salesOrderSchema.safeParse({
      customerName: "Green Valley Resort",
      items: [baseItem],
      driverName: undefined,
    });

    assert.equal(clearedResult.success, true);
    if (clearedResult.success) {
      assert.equal(clearedResult.data.driverName, undefined);
    }
  });
});

test("SO-EDITABLE-02: Category Field - Selected vs Custom Manually Typed", async (t) => {
  await t.test("Validates and accepts selected Category from existing categories list", () => {
    const item: LineItem = {
      productId: "prod-1",
      productName: "12kg LPG Refill",
      quantity: 2,
      price: 1400,
      category: "LPG",
    };

    const lineResult = lineItemSchema.safeParse(item);
    assert.equal(lineResult.success, true);
    if (lineResult.success) {
      assert.equal(lineResult.data.category, "LPG");
    }

    const orderResult = salesOrderSchema.safeParse({
      customerName: "Industrial Zone Alpha",
      items: [item],
    });
    assert.equal(orderResult.success, true);
    if (orderResult.success) {
      assert.equal(orderResult.data.items[0].category, "LPG");
    }
  });

  await t.test("Validates and accepts custom manually typed Category", () => {
    const customCategory = "Custom Auto Gas Special";
    const item: LineItem = {
      productId: "prod-1",
      productName: "12kg LPG Refill",
      quantity: 10,
      price: 1450,
      category: customCategory,
    };

    const lineResult = lineItemSchema.safeParse(item);
    assert.equal(lineResult.success, true);
    if (lineResult.success) {
      assert.equal(lineResult.data.category, "Custom Auto Gas Special");
    }

    const orderResult = salesOrderSchema.safeParse({
      customerName: "Industrial Zone Alpha",
      items: [item],
    });
    assert.equal(orderResult.success, true);
    if (orderResult.success) {
      assert.equal(orderResult.data.items[0].category, "Custom Auto Gas Special");
    }
  });

  await t.test("Allows clearing Category to undefined or optional", () => {
    const item: LineItem = {
      productId: "prod-2",
      productName: "Oxygen Cylinder",
      quantity: 1,
      price: 2500,
      category: undefined,
    };

    const lineResult = lineItemSchema.safeParse(item);
    assert.equal(lineResult.success, true);
    if (lineResult.success) {
      assert.equal(lineResult.data.category, undefined);
    }
  });
});

test("SO-EDITABLE-03: Order Edit and Persistence Flow", async (t) => {
  await t.test("Simulates creating an order with custom fields, then reloading and modifying them", () => {
    // 1. Initial creation with custom Deliveryman and custom Category
    const createdOrder: SalesOrder = {
      id: "so-test-101",
      orderNo: "SO-2026-9999",
      customerId: "cust-1",
      customerName: "Delta Mills Ltd",
      date: new Date().toISOString(),
      driverName: "Custom Driver Rashid",
      items: [
        {
          productId: "prod-gas-1",
          productName: "Medical Oxygen Refill",
          quantity: 4,
          price: 1800,
          category: "Medical Grade 99.5%",
        },
      ],
      subtotal: 7200,
      tax: 0,
      total: 7200,
      paid: 0,
      status: "confirmed",
    };

    // 2. Reopening for edit (Hydration check):
    const loadedDriverName = createdOrder.driverName ?? "";
    const loadedCategory = createdOrder.items[0].category ?? "";

    assert.equal(loadedDriverName, "Custom Driver Rashid", "Custom driver name must persist on reload");
    assert.equal(loadedCategory, "Medical Grade 99.5%", "Custom category must persist on reload");

    // 3. User edits custom category to an existing category, and updates driver name to another custom name:
    const updatedOrder: Partial<SalesOrder> = {
      ...createdOrder,
      driverName: "North Delivery Fleet B",
      items: [
        {
          ...createdOrder.items[0],
          category: "Medical", // switched to existing category
        },
      ],
    };

    const editValidate = salesOrderSchema.safeParse({
      customerId: updatedOrder.customerId,
      customerName: updatedOrder.customerName,
      driverName: updatedOrder.driverName,
      items: updatedOrder.items,
    });

    assert.equal(editValidate.success, true);
    if (editValidate.success) {
      assert.equal(editValidate.data.driverName, "North Delivery Fleet B");
      assert.equal(editValidate.data.items[0].category, "Medical");
    }
  });

  await t.test("Backward compatibility: legacy orders without driverName or category load cleanly", () => {
    const legacyOrder: Partial<SalesOrder> = {
      id: "so-legacy-01",
      orderNo: "SO-2025-0001",
      customerId: "cust-legacy",
      customerName: "Old Factory Client",
      date: "2025-01-10T00:00:00.000Z",
      items: [
        {
          productId: "prod-old-1",
          productName: "Old Cylinder Stock",
          quantity: 2,
          price: 1200,
        },
      ],
      subtotal: 2400,
      tax: 0,
      total: 2400,
      paid: 2400,
      status: "paid",
    };

    const parsed = salesOrderSchema.safeParse({
      customerId: legacyOrder.customerId,
      customerName: legacyOrder.customerName,
      driverName: legacyOrder.driverName || undefined,
      items: legacyOrder.items,
    });

    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.data.driverName, undefined);
      assert.equal(parsed.data.items[0].category, undefined);
    }
  });
});
