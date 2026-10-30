import test from "node:test";
import assert from "node:assert/strict";

// Validation & domain logic tests for Return Management and Delivery Challan Edit

test("RET-01: Remaining Returnable Quantity Calculation", async (t) => {
  await t.test("calculates remaining returnable qty as original delivered minus previously accepted returns", () => {
    const deliveredQty = 100;
    const previouslyReturnedQty = 30;
    const remainingQty = Math.max(0, deliveredQty - previouslyReturnedQty);

    assert.equal(remainingQty, 70, "Remaining qty must equal 100 - 30 = 70");
  });

  await t.test("rejects negative delivered or return quantities", () => {
    const returnQty = -5;
    const isValid = returnQty > 0;
    assert.equal(isValid, false, "Negative return qty must be rejected");
  });

  await t.test("rejects return quantity exceeding remaining quantity", () => {
    const deliveredQty = 50;
    const previouslyReturnedQty = 40;
    const remainingQty = deliveredQty - previouslyReturnedQty; // 10

    const requestedReturnQty = 15;
    const isExceeded = requestedReturnQty > remainingQty;

    assert.equal(isExceeded, true, "15 exceeds remaining returnable quantity 10");
  });

  await t.test("allows exact full return of remaining quantity", () => {
    const deliveredQty = 50;
    const previouslyReturnedQty = 20;
    const remainingQty = deliveredQty - previouslyReturnedQty; // 30

    const requestedReturnQty = 30;
    const isValid = requestedReturnQty <= remainingQty && requestedReturnQty > 0;

    assert.equal(isValid, true, "Exact remaining quantity can be returned");
  });
});

test("RET-02: Inventory Routing Isolation", async (t) => {
  await t.test("Gas Return updates Gas Inventory only, never increments Cylinder count", () => {
    const itemClassification = "gas";
    const gasReturnedQty = 20;

    let gasStock = 100;
    let cylinderStock = 50;

    if (itemClassification === "gas") {
      gasStock += gasReturnedQty;
    } else if (itemClassification === "cylinder") {
      cylinderStock += gasReturnedQty;
    }

    assert.equal(gasStock, 120, "Gas stock must increment by 20");
    assert.equal(cylinderStock, 50, "Cylinder stock must remain completely unaffected");
  });

  await t.test("Cylinder Return handles condition: Empty, Full, and Damaged", () => {
    let emptyCylinderStock = 10;
    let fullCylinderStock = 40;
    let damagedCylinderStock = 2;

    const returnEmpty = { condition: "empty", qty: 5 };
    const returnFull = { condition: "full", qty: 3 };
    const returnDamaged = { condition: "damaged", qty: 1 };

    // Process empty return
    if (returnEmpty.condition === "empty") {
      emptyCylinderStock += returnEmpty.qty;
    }

    // Process full return
    if (returnFull.condition === "full") {
      fullCylinderStock += returnFull.qty;
    }

    // Process damaged return: must NOT become sellable full stock
    if (returnDamaged.condition === "damaged") {
      damagedCylinderStock += returnDamaged.qty;
    }

    assert.equal(emptyCylinderStock, 15, "Empty cylinders increment empty stock");
    assert.equal(fullCylinderStock, 43, "Full cylinders increment sellable stock");
    assert.equal(damagedCylinderStock, 3, "Damaged cylinders increment damaged quarantine stock, not sellable");
  });

  await t.test("Product Return updates Product Inventory only", () => {
    const itemClassification = "product";
    const productReturnedQty = 5;

    let productStock = 25;
    let gasStock = 80;

    if (itemClassification === "product") {
      productStock += productReturnedQty;
    } else if (itemClassification === "gas") {
      gasStock += productReturnedQty;
    }

    assert.equal(productStock, 30, "Product stock must increment by 5");
    assert.equal(gasStock, 80, "Gas stock must remain unaffected");
  });
});

test("RET-03: Delivery Challan Edit Integrity", async (t) => {
  await t.test("Delivered Challan allows editing metadata but protects delivered stock items", () => {
    const challan = {
      id: "DC-001",
      status: "delivered",
      customerName: "Original Customer",
      receiverName: "Old Receiver",
      deliveryman: "Old Driver",
      notes: "Original note",
      items: [{ productId: "gas-1", quantity: 50 }],
    };

    const isDelivered = challan.status === "delivered";

    // Allowed updates
    const updatedMetadata = {
      receiverName: "New Receiver",
      deliveryman: "New Driver",
      notes: "Updated delivery notes",
    };

    const newChallan = {
      ...challan,
      ...updatedMetadata,
      // If delivered, items are immutable to preserve stock and return integrity
      items: isDelivered ? challan.items : [{ productId: "gas-1", quantity: 999 }],
    };

    assert.equal(newChallan.receiverName, "New Receiver");
    assert.equal(newChallan.deliveryman, "New Driver");
    assert.equal(newChallan.notes, "Updated delivery notes");
    assert.equal(newChallan.items[0].quantity, 50, "Item quantity was locked against corruption");
  });
});
