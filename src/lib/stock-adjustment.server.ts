import { createHash, randomUUID } from "node:crypto";
import type { CostLayer, Cylinder, Product, StockMovement } from "../types/index.ts";
import { consumeCostLayers, productMethod } from "./inventory-engine.ts";
import { cylinderIsFullStock, isCompanyOwned } from "./cylinder-product.ts";
import { resolveProductType } from "./inventory.server.ts";
import { issueLockIsActive } from "./cylinder-lock.ts";
import { stockAdjustmentSchema, type StockAdjustmentInput } from "./stock-adjustment-input.ts";
export type { StockAdjustmentInput } from "./stock-adjustment-input.ts";

export function adjustmentDelta(current: number, input: StockAdjustmentInput): number {
  if (!["in", "out", "adjust"].includes(input.type)) throw new Error("Invalid adjustment type");
  if (
    !Number.isFinite(input.quantity) ||
    input.quantity < 0 ||
    input.quantity > 1e9 ||
    (input.type !== "adjust" && input.quantity === 0)
  ) {
    throw new Error("Enter a valid stock quantity");
  }
  if (!input.notes?.trim() || input.notes.length > 2000)
    throw new Error("Stock adjustment reason is required (maximum 2000 characters)");
  if (!/^[\w-]{8,100}$/.test(input.requestId || "")) throw new Error("Invalid adjustment request");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(Date.parse(input.date)) ||
    new Date(input.date).toISOString().slice(0, 10) !== input.date
  ) {
    throw new Error("A valid adjustment date is required");
  }
  const delta =
    input.type === "in"
      ? input.quantity
      : input.type === "out"
        ? -input.quantity
        : input.quantity - current;
  if (current + delta < 0) throw new Error("Insufficient stock for adjustment");
  return delta;
}

/** Called inside a Mongo transaction: movement, valuation and serials commit together. */
export async function adjustStockInDb(
  db: any,
  session: any,
  input: StockAdjustmentInput,
  username: string,
): Promise<StockMovement | null> {
  input = stockAdjustmentSchema.parse(input);
  const opt = session ? { session } : {};
  const id = `stock-adj-${input.requestId}`;
  const signature = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const request = await db.collection("stockAdjustmentRequests").findOne({ id }, opt);
  if (request) {
    if (request.signature !== signature)
      throw new Error("Adjustment request was already used for different data");
    return request.result;
  }
  const previous = await db.collection("stockMovements").findOne({ id }, opt);
  if (previous) {
    if (
      previous.productId !== input.productId ||
      previous.adjustmentType !== input.type ||
      previous.requestedQuantity !== input.quantity ||
      previous.adjustmentDate !== input.date ||
      previous.reason !== input.notes.trim()
    ) {
      throw new Error("Adjustment request was already used for different data");
    }
    const { _id, ...movement } = previous;
    return movement;
  }
  const product = (await db
    .collection("products")
    .findOne({ id: input.productId }, opt)) as Product | null;
  if (!product) throw new Error("Product not found");
  const current = Number(product.stock) || 0;
  const delta = adjustmentDelta(current, input);
  if (delta === 0) {
    // Remember even no-ops: retrying a prior stock count must not undo a later receipt.
    await db
      .collection("products")
      .updateOne({ id: product.id }, { $inc: { stockAdjustmentRevision: 1 } }, opt);
    await db
      .collection("stockAdjustmentRequests")
      .insertOne({ _id: id, id, signature, result: null }, opt);
    return null;
  }
  const kind = resolveProductType(product);
  const collection =
    kind === "gas"
      ? "gasInventory"
      : kind === "cylinder"
        ? "cylinderInventory"
        : "productInventory";
  const inventory = await db.collection(collection).findOne({ productId: product.id }, opt);
  const reserved = kind === "cylinder" ? Number(inventory?.reserved) || 0 : 0;
  if (delta < 0 && current + delta < reserved)
    throw new Error("Adjustment would consume stock reserved for orders");
  let serials: Cylinder[] = [];
  let serialized = false;
  if (kind === "cylinder") {
    if (!Number.isInteger(input.quantity))
      throw new Error("Cylinder quantity must be a whole number");
    if (Math.abs(delta) > 10000) throw new Error("Adjust at most 10000 cylinders at a time");
    const all = (await db
      .collection("cylinders")
      .find({ productId: product.id }, opt)
      .toArray()) as Cylinder[];
    serialized = all.length > 0;
    const warehouse = all.filter((c) => isCompanyOwned(c) && cylinderIsFullStock(c));
    if (serialized && warehouse.length !== current)
      throw new Error(
        "Cylinder stock differs from serial records. Reconcile inventory before adjusting.",
      );
    serials = warehouse.filter((c) => !issueLockIsActive(c.issueLock));
    if (serialized && delta < 0 && serials.length < -delta)
      throw new Error("Not enough unlocked full cylinders to adjust");
  }
  const date = `${input.date}T12:00:00+06:00`;
  const now = new Date().toISOString();
  const qty = Math.abs(delta);
  const layers = (await db
    .collection("costLayers")
    .find({ productId: product.id }, opt)
    .toArray()) as CostLayer[];
  const method = productMethod(product);
  const fallbackCost = Math.max(0, Number(product.cost) || 0);
  const represented = layers.reduce((sum, l) => sum + Math.max(0, l.qtyRemaining || 0), 0);
  if (represented < current) {
    const opening: CostLayer = {
      id: randomUUID(),
      productId: product.id,
      qtyRemaining: current - represented,
      unitCost: fallbackCost,
      receivedAt: product.createdAt || date,
      refType: "adjustment",
      refId: `OPEN-${id}`,
    };
    await db.collection("costLayers").insertOne(opening, opt);
    layers.push(opening);
  }
  if (method === "average") {
    // Open layers represent the weighted-average pool, not historical receipt costs.
    for (const layer of layers.filter((l) => l.qtyRemaining > 0)) {
      layer.unitCost = fallbackCost;
      await db
        .collection("costLayers")
        .updateOne({ id: layer.id }, { $set: { unitCost: fallbackCost } }, opt);
    }
  }
  const consumed = delta < 0 ? consumeCostLayers(layers, qty, method, fallbackCost) : null;
  const unitCost = consumed?.unitCost ?? fallbackCost;
  const value = consumed?.cogsAmount ?? qty * unitCost;
  const movement: StockMovement = {
    id,
    date,
    productId: product.id,
    productName: product.name,
    productType: kind,
    type: delta > 0 ? "in" : "out",
    direction: delta > 0 ? "in" : "out",
    movementType: delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
    quantity: qty,
    previousBalance: current,
    balanceAfter: current + delta,
    newBalance: current + delta,
    unitCost,
    totalCost: value,
    cogsAmount: value,
    costingMethod: method,
    consumptions: consumed?.consumptions,
    refType: "adjustment",
    refId: id,
    notes: input.notes.trim(),
    by: username,
  };
  await db.collection("stockMovements").insertOne(
    {
      ...movement,
      adjustmentType: input.type,
      requestedQuantity: input.quantity,
      adjustmentDate: input.date,
      reason: input.notes.trim(),
    },
    opt,
  );
  if (consumed) {
    for (const update of consumed.updatedLayers)
      await db
        .collection("costLayers")
        .updateOne({ id: update.id }, { $set: { qtyRemaining: update.qtyRemaining } }, opt);
  } else {
    await db.collection("costLayers").insertOne(
      {
        id: randomUUID(),
        productId: product.id,
        qtyIn: qty,
        qtyRemaining: qty,
        unitCost,
        receivedAt: date,
        refType: "adjustment",
        refId: id,
      },
      opt,
    );
  }
  const layerValue = layers.reduce(
    (sum, l) => sum + Math.max(0, l.qtyRemaining || 0) * l.unitCost,
    0,
  );
  const inventoryValue = Math.max(
    0,
    (method === "average" ? current * fallbackCost : layerValue) + (delta > 0 ? value : -value),
  );
  const nextCost = current + delta > 0 ? inventoryValue / (current + delta) : 0;
  await db
    .collection("products")
    .updateOne({ id: product.id }, { $set: { stock: current + delta, cost: nextCost } }, opt);
  await db.collection(collection).updateOne(
    { productId: product.id },
    {
      $inc: delta > 0 ? { stockIn: qty } : { stockOut: qty },
      $set: {
        onHand: current + delta,
        totalValue: inventoryValue,
        costPrice: nextCost,
        updatedAt: now,
        ...(kind === "cylinder" ? { reserved, available: current + delta - reserved } : {}),
      },
      $setOnInsert: {
        id: `${kind}-${product.id}`,
        productId: product.id,
        productName: product.name,
        productType: kind,
        uom: product.uom,
        openingStock: product.openingStock ?? current,
        unitPrice: product.price,
      },
    },
    { upsert: true, ...opt },
  );
  if (kind === "cylinder" && serialized) {
    if (delta > 0) {
      for (let i = 0; i < qty; i++) {
        const cid = randomUUID();
        const serialNumber = `ADJ-${product.code}-${cid}`;
        await db.collection("cylinders").insertOne(
          {
            id: cid,
            serialNumber,
            serialKey: serialNumber.toUpperCase(),
            productId: product.id,
            capacity: 0,
            status: "in_stock",
            fillLevel: "full",
            ownedBy: "company",
            location: "Warehouse",
            lastMovementAt: date,
            createdAt: now,
          },
          opt,
        );
        await db.collection("movements").insertOne(
          {
            id: randomUUID(),
            cylinderId: cid,
            type: "received",
            toLocation: "Warehouse",
            timestamp: date,
            notes: `Stock adjustment: ${input.notes.trim()}`,
            by: username,
          },
          opt,
        );
      }
    } else {
      for (const cylinder of serials.slice(0, qty)) {
        await db
          .collection("cylinders")
          .updateOne(
            { id: cylinder.id },
            { $set: { status: "stock_out", location: "Stock adjustment", lastMovementAt: date } },
            opt,
          );
        await db.collection("movements").insertOne(
          {
            id: randomUUID(),
            cylinderId: cylinder.id,
            type: "stock_out",
            purpose: "stock_out",
            fromLocation: cylinder.location,
            toLocation: "Stock adjustment",
            timestamp: date,
            notes: input.notes.trim(),
            by: username,
          },
          opt,
        );
      }
    }
  }
  await db.collection("auditLogs").insertOne(
    {
      id: randomUUID(),
      userId: username,
      username,
      action: "ADJUST",
      entityType: "inventory",
      entityId: product.id,
      before: { stock: current },
      after: { stock: current + delta },
      timestamp: now,
      details: input.notes.trim(),
    },
    opt,
  );
  await db
    .collection("stockAdjustmentRequests")
    .insertOne({ _id: id, id, signature, result: movement }, opt);
  return movement;
}
