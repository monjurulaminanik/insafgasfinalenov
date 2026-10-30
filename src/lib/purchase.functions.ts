import { createServerFn } from "@tanstack/react-start";
import type { CostLayer, Cylinder, LineItem, Product, PurchaseOrder, StockMovement } from "@/types";
import { isCylinderProduct } from "@/lib/cylinder-product";
import { normalizeSerialKey, trackingEnforcesSerialUnique } from "@/lib/cylinder-serial";
import {
  lineOrderedQty,
  lineReceivedQty,
  nextPurchaseStatus,
  poCanReceive,
} from "@/lib/purchase-qty";
import { genOrderNo } from "@/utils/helpers";

export type ReceivePayload = {
  serialsByItem?: string[][];
  lotNumber?: string;
  qtyByItem?: number[];
  requestId?: string;
};

const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

let idSeq = 0;
function newId() {
  idSeq += 1;
  return `${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isDuplicateKeyError(e: unknown) {
  const err = e as { code?: number; message?: string };
  return err?.code === 11000 || /E11000|duplicate key/i.test(err?.message || "");
}

function asError(e: unknown, fallback: string) {
  if (e instanceof Error && e.message) {
    if (/Class extends value undefined/i.test(e.message)) return new Error(fallback);
    return e;
  }
  if (isDuplicateKeyError(e)) return new Error("Serial number already exists.");
  return new Error(fallback);
}

function productMethod(p: Product) {
  return p.costingMethod === "lifo" || p.costingMethod === "average" ? p.costingMethod : "fifo";
}

export const receivePurchaseFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; payload?: ReceivePayload }) => d)
  .handler(async ({ data }): Promise<PurchaseOrder> => {
    const { requireUser } = await import("./session.server");
    const { roleCanAccess, getCylinderTracking } = await import("./settings.server");
    const { getDb, getMongoClient } = await import("./mongo.server");
    const user = await requireUser();
    if (user.role !== "Administrator") {
      const allowed = await roleCanAccess(user.role, "purchases");
      if (!allowed) throw new Error("Not allowed");
    }

    const client = await getMongoClient();
    const db = await getDb();
    const method = await getCylinderTracking();
    try {
      await db.collection("cylinders").createIndex(
        { serialKey: 1 },
        {
          unique: true,
          name: "cylinders_serialKey_unique",
          partialFilterExpression: { serialKey: { $type: "string", $gt: "" } },
        },
      );
    } catch {
      /* Existing duplicate serials are left in place. */
    }

    const session = client.startSession();
    try {
      let result: PurchaseOrder | undefined;
      const run = async (tx: unknown) => {
        result = await receivePurchaseInDb(db, tx, data.id, data.payload, method);
      };
      try {
        await session.withTransaction(async () => {
          await run(session);
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          /Transaction numbers are only allowed|replica set member|Transactions are not supported/i.test(
            msg,
          )
        ) {
          await run(null);
        } else {
          throw asError(e, "Could not complete goods receipt.");
        }
      }
      if (!result) throw new Error("Could not complete goods receipt.");
      return result;
    } catch (e) {
      throw asError(e, "Could not complete goods receipt.");
    } finally {
      await session.endSession();
    }
  });

async function receivePurchaseInDb(
  db: { collection: (name: string) => any },
  session: unknown,
  id: string,
  payload: ReceivePayload | undefined,
  method: "quantity" | "lot" | "serial",
): Promise<PurchaseOrder> {
  const opt = session ? ({ session } as { session: object }) : {};
  const poDoc = await db.collection("purchases").findOne({ id: String(id) }, opt);
  const po = poDoc ? clean<PurchaseOrder>(poDoc) : null;
  if (!po) throw new Error("Purchase order not found");
  if (po.status === "cancelled") {
    throw new Error("Cannot receive a cancelled purchase order.");
  }
  if (!poCanReceive(po.items, po)) {
    throw new Error("This purchase order has no remaining quantity to receive.");
  }
  if (payload?.requestId && (po.grns || []).some((g) => g.id === payload.requestId)) {
    return po;
  }

  const products = (await db.collection("products").find({}, opt).toArray()).map((d: Product) =>
    clean<Product>(d),
  );
  const cylinders = (await db.collection("cylinders").find({}, opt).toArray()).map((d: Cylinder) =>
    clean<Cylinder>(d),
  );
  const nextItems = [...po.items];
  const receiveNow = nextItems.map((item, i) => {
    const remaining = Math.max(0, lineOrderedQty(item) - lineReceivedQty(item, po));
    const raw = payload?.qtyByItem?.[i];
    const qty = raw == null || raw === undefined ? remaining : Number(raw);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new Error("Received quantity must be a valid number.");
    }
    if (qty > remaining + 1e-9) {
      throw new Error("Received quantity exceeds remaining PO quantity.");
    }
    return qty;
  });
  if (!receiveNow.some((q) => q > 0)) {
    throw new Error("Received quantity must be greater than 0.");
  }

  const stamp = Date.now().toString(36);
  const now = new Date().toISOString();
  const newCylinders: Record<string, unknown>[] = [];
  const movements: Record<string, unknown>[] = [];
  const cylinderPatches: { id: string; patch: Record<string, unknown> }[] = [];
  const liveCylinders = [...cylinders];

  for (let i = 0; i < nextItems.length; i++) {
    const item = nextItems[i];
    const qty = receiveNow[i];
    if (qty <= 0) continue;
    const p = products.find((x: Product) => x.id === item.productId);
    if (!isCylinderProduct(p) && item.itemType !== "cylinder") continue;
    const ids: string[] = [...(item.cylinderIds || [])];

    if (method === "quantity" || method === "lot") {
      if (method === "lot" && !payload?.lotNumber?.trim()) throw new Error("Lot number required");
      for (let n = 0; n < qty; n += 1) {
        const serial =
          method === "lot"
            ? `${payload!.lotNumber!.trim()}-${stamp}-${String(n + 1).padStart(3, "0")}`
            : `QTY-${(p?.code || "CYL").replace(/\s+/g, "")}-${stamp}-${n + 1}`;
        const created = stageNewCylinder(
          item,
          po,
          serial,
          payload?.lotNumber?.trim(),
          now,
          newCylinders,
        );
        liveCylinders.push(created);
        ids.push(created.id);
        stageReceiveMovement(created.id, po, now, movements, cylinderPatches);
      }
      nextItems[i] = { ...item, cylinderIds: ids, receivedQty: lineReceivedQty(item, po) + qty };
      continue;
    }

    const serials = (payload?.serialsByItem?.[i] || []).map((s) => s.trim()).filter(Boolean);
    // Serials are optional. Empty list = quantity GRN only (no cylinder records, no fake serials).
    if (serials.length === 0) {
      nextItems[i] = { ...item, receivedQty: lineReceivedQty(item, po) + qty };
      continue;
    }
    if (serials.length !== qty) {
      throw new Error("Serial quantity does not match received quantity.");
    }
    const seen = new Set<string>();
    for (const serial of serials) {
      const key = normalizeSerialKey(serial);
      if (!key) throw new Error("Serial numbers cannot be empty.");
      if (seen.has(key)) throw new Error("Duplicate serial numbers detected.");
      seen.add(key);
      let found = liveCylinders.find((c) => normalizeSerialKey(c.serialNumber) === key);
      if (!found) {
        found = stageNewCylinder(item, po, serial, undefined, now, newCylinders);
        liveCylinders.push(found);
      } else {
        if (found.productId !== item.productId) {
          throw new Error(`Cylinder ${serial} does not match ${item.productName}`);
        }
        if (
          found.status === "in_stock" ||
          found.status === "at_customer" ||
          found.ownedBy === "customer"
        ) {
          throw new Error("Serial number already exists.");
        }
      }
      ids.push(found.id);
      stageReceiveMovement(found.id, po, now, movements, cylinderPatches);
    }
    nextItems[i] = { ...item, cylinderIds: ids, receivedQty: lineReceivedQty(item, po) + qty };
  }

  for (let i = 0; i < nextItems.length; i++) {
    const item = nextItems[i];
    const qty = receiveNow[i];
    if (qty <= 0) continue;
    const p = products.find((x: Product) => x.id === item.productId);
    if (isCylinderProduct(p) || item.itemType === "cylinder") continue;
    nextItems[i] = { ...item, receivedQty: lineReceivedQty(item, po) + qty };
  }

  if (trackingEnforcesSerialUnique(method) && newCylinders.length) {
    const existingKeys = new Set(
      liveCylinders
        .filter((c) => !newCylinders.some((n) => n.id === c.id))
        .map((c) => normalizeSerialKey(c.serialNumber))
        .filter(Boolean),
    );
    for (const doc of newCylinders) {
      const key = String(doc.serialKey || "");
      if (key && existingKeys.has(key)) {
        throw new Error("Serial number already exists.");
      }
      if (key) existingKeys.add(key);
    }
  }

  const grnNo = genOrderNo("GRN");
  const grnId = payload?.requestId?.trim() || newId();
  const notes = `Auto-received from PO ${po.orderNo} (GRN ${grnNo})`;
  for (const mv of movements) mv.notes = notes;

  if (newCylinders.length) {
    try {
      await db.collection("cylinders").insertMany(newCylinders, { ordered: true, ...opt });
    } catch (e) {
      if (isDuplicateKeyError(e)) throw new Error("Serial number already exists.");
      throw e;
    }
  }
  if (movements.length) {
    await db.collection("movements").insertMany(movements, { ordered: true, ...opt });
  }
  for (const row of cylinderPatches) {
    await db.collection("cylinders").updateOne({ id: row.id }, { $set: row.patch }, opt);
  }

  for (let i = 0; i < nextItems.length; i++) {
    const qty = receiveNow[i];
    if (qty <= 0) continue;
    const item = nextItems[i];
    const dup = await db
      .collection("stockMovements")
      .findOne(
        { refType: "purchase", refId: id, productId: item.productId, type: "in", notes: grnNo },
        opt,
      );
    if (dup) continue;
    await receiveStockInDb(
      db,
      opt,
      { ...item, quantity: qty },
      { refType: "purchase", refId: id, notes: grnNo, by: "Warehouse" },
      now,
    );
  }

  const status = nextPurchaseStatus(nextItems, { ...po, status: "ordered" });
  const grn = {
    id: grnId,
    grnNo,
    receivedAt: now,
    items: nextItems
      .map((it, i) => ({ productId: it.productId, quantity: receiveNow[i] }))
      .filter((r) => r.quantity > 0),
  };

  const updated = await db.collection("purchases").findOneAndUpdate(
    { id: String(id), status: { $ne: "cancelled" } },
    {
      $set: {
        status,
        grnNo,
        receivedAt: now,
        items: nextItems,
        grns: [...(po.grns || []), grn],
      },
    },
    { ...opt, returnDocument: "after" },
  );
  const doc = (updated as { value?: unknown } | null)?.value ?? updated;
  if (!doc || typeof doc !== "object" || !("id" in doc)) {
    throw new Error("This purchase order was already received.");
  }
  return clean<PurchaseOrder>(doc);
}

function stageNewCylinder(
  item: LineItem,
  po: PurchaseOrder,
  serial: string,
  lotNumber: string | undefined,
  now: string,
  bucket: Record<string, unknown>[],
): Cylinder {
  const id = newId();
  const serialKey = normalizeSerialKey(serial);
  const created: Cylinder = {
    id,
    serialNumber: serial,
    productId: item.productId,
    capacity: 0,
    status: "in_transit",
    location: po.supplierName,
    lotNumber,
    ownedBy: "company",
    fillLevel: "full",
    createdAt: now,
    lastMovementAt: now,
  };
  bucket.push({
    ...created,
    ...(serialKey ? { serialKey } : {}),
  });
  return created;
}

function stageReceiveMovement(
  cylinderId: string,
  po: PurchaseOrder,
  now: string,
  movements: Record<string, unknown>[],
  patches: { id: string; patch: Record<string, unknown> }[],
) {
  movements.push({
    id: newId(),
    cylinderId,
    type: "received",
    supplierId: po.supplierId,
    fromLocation: po.supplierName,
    toLocation: "Warehouse",
    notes: "",
    by: "Purchase",
    timestamp: now,
  });
  patches.push({
    id: cylinderId,
    patch: {
      lastMovementAt: now,
      status: "in_stock",
      fillLevel: "full",
      location: "Warehouse",
      issueLock: null,
      customerId: null,
      supplierId: null,
    },
  });
}

async function receiveStockInDb(
  db: { collection: (name: string) => any },
  opt: object,
  item: LineItem,
  meta: { refType: "purchase"; refId: string; notes: string; by: string },
  now: string,
) {
  const qty = item.quantity;
  if (qty <= 0) return;
  const productDoc = await db.collection("products").findOne({ id: item.productId }, opt);
  let product = productDoc ? clean<Product>(productDoc) : null;
  if (!product) {
    if (item.itemType === "cylinder") {
      const cylDoc = await db.collection("cylinderInventory").findOne({ productId: item.productId }, opt);
      if (cylDoc) {
        product = {
          id: cylDoc.productId,
          code: cylDoc.productId,
          name: cylDoc.productName || item.productName,
          category: "Cylinder",
          productType: "cylinder",
          uom: cylDoc.uom || "cyl",
          price: cylDoc.unitPrice ?? 0,
          cost: cylDoc.costPrice ?? 0,
          stock: cylDoc.onHand ?? 0,
          reorderLevel: 0,
          createdAt: cylDoc.createdAt || now,
        };
      }
    } else if (item.itemType === "product") {
      const pInvDoc = await db.collection("productInventory").findOne({ productId: item.productId }, opt);
      if (pInvDoc) {
        product = {
          id: pInvDoc.productId,
          code: pInvDoc.productId,
          name: pInvDoc.productName || item.productName,
          category: "Product",
          productType: "product",
          uom: pInvDoc.uom || "pcs",
          price: pInvDoc.unitPrice ?? 0,
          cost: pInvDoc.costPrice ?? 0,
          stock: pInvDoc.onHand ?? 0,
          reorderLevel: 0,
          createdAt: pInvDoc.createdAt || now,
        };
      }
    }
  }
  if (!product) return;
  const { resolveProductType } = await import("./inventory.server");
  const pType = (item.itemType as "gas" | "cylinder" | "product") || resolveProductType(product);
  const cost = Number.isFinite(item.price) ? item.price : (product.cost ?? 0);

  const openLayers = (
    await db
      .collection("costLayers")
      .find({ productId: product.id, qtyRemaining: { $gt: 0 } }, opt)
      .toArray()
  ).map((d: CostLayer) => clean<CostLayer>(d));
  const layerQty = openLayers.reduce((a: number, l: CostLayer) => a + (l.qtyRemaining || 0), 0);
  const stock = product.stock ?? 0;
  if (stock > 0 && layerQty <= 0) {
    await db.collection("costLayers").insertOne(
      {
        id: newId(),
        productId: product.id,
        qtyRemaining: stock,
        unitCost: product.cost ?? 0,
        receivedAt: product.createdAt || now,
        refType: "adjustment",
      },
      opt,
    );
  }

  await db.collection("costLayers").insertOne(
    {
      id: newId(),
      productId: product.id,
      qtyRemaining: qty,
      unitCost: cost,
      receivedAt: now,
      refType: meta.refType,
      refId: meta.refId,
    },
    opt,
  );

  const oldStock = product.stock ?? 0;
  const oldCost = product.cost ?? cost;
  const nextStock = oldStock + qty;
  const nextCost = nextStock > 0 ? (oldStock * oldCost + qty * cost) / nextStock : cost;
  if (productDoc) {
    await db
      .collection("products")
      .updateOne({ id: product.id }, { $set: { stock: nextStock, cost: nextCost } }, opt);
  }

  const movement: StockMovement = {
    id: newId(),
    date: now,
    productId: product.id,
    productName: product.name,
    productType: pType,
    type: "in",
    movementType: "RECEIPT",
    direction: "in",
    quantity: qty,
    previousBalance: oldStock,
    balanceAfter: nextStock,
    newBalance: nextStock,
    unitCost: cost,
    totalCost: qty * cost,
    cogsAmount: qty * cost,
    costingMethod: productMethod(product),
    refType: meta.refType,
    refId: meta.refId,
    notes: meta.notes,
    by: meta.by,
  };
  await db.collection("stockMovements").insertOne(movement, opt);

  // Update separated inventory collection
  if (pType === "gas") {
    const unitPrice = Number(product.price) || 0;
    const costPrice = cost > 0 ? cost : (Number(product.cost) || 0);
    const valUnit = costPrice > 0 ? costPrice : unitPrice;
    await db.collection("gasInventory").updateOne(
      { productId: product.id },
      {
        $inc: { stockIn: qty },
        $set: { onHand: nextStock, costPrice, unitPrice, totalValue: nextStock * valUnit, updatedAt: now },
        $setOnInsert: {
          id: `gas-${product.id}`,
          productId: product.id,
          productName: product.name,
          productType: "gas",
          uom: product.uom || "kg",
          openingStock: 0,
          stockOut: 0,
        },
      },
      { upsert: true, ...opt },
    );
  } else if (pType === "cylinder") {
    const cylDoc = await db.collection("cylinderInventory").findOne({ productId: product.id }, opt);
    const reserved = cylDoc ? Number(cylDoc.reserved) || 0 : 0;
    const unitPrice = Number(product.price) || 0;
    const costPrice = cost > 0 ? cost : (Number(product.cost) || 0);
    const valUnit = costPrice > 0 ? costPrice : unitPrice;
    await db.collection("cylinderInventory").updateOne(
      { productId: product.id },
      {
        $inc: { stockIn: qty },
        $set: {
          onHand: nextStock,
          available: Math.max(0, nextStock - reserved),
          costPrice,
          unitPrice,
          totalValue: nextStock * valUnit,
          updatedAt: now,
        },
        $setOnInsert: {
          id: `cyl-${product.id}`,
          productId: product.id,
          productName: product.name,
          productType: "cylinder",
          uom: product.uom || "cyl",
          openingStock: 0,
          stockOut: 0,
          reserved: 0,
        },
      },
      { upsert: true, ...opt },
    );
  } else {
    const unitPrice = Number(product.price) || 0;
    const costPrice = cost > 0 ? cost : (Number(product.cost) || 0);
    const valUnit = costPrice > 0 ? costPrice : unitPrice;
    await db.collection("productInventory").updateOne(
      { productId: product.id },
      {
        $inc: { stockIn: qty },
        $set: { onHand: nextStock, costPrice, unitPrice, totalValue: nextStock * valUnit, updatedAt: now },
        $setOnInsert: {
          id: `prod-${product.id}`,
          productId: product.id,
          productName: product.name,
          productType: "product",
          uom: product.uom || "pcs",
          openingStock: 0,
          stockOut: 0,
        },
      },
      { upsert: true, ...opt },
    );
  }
}

export async function issueStockInDb(
  db: { collection: (name: string) => any },
  session: unknown,
  productId: string,
  qty: number,
  meta: { refType: StockMovement["refType"]; refId: string; notes: string; by: string },
) {
  if (qty <= 0) return;
  const opt = session ? ({ session } as { session: object }) : {};
  const dup = await db
    .collection("stockMovements")
    .findOne({ refType: meta.refType, refId: meta.refId, productId, type: "out" }, opt);
  if (dup) return;
  const productDoc = await db.collection("products").findOne({ id: productId }, opt);
  const product = productDoc ? clean<Product>(productDoc) : null;
  if (!product) throw new Error("Product not found");
  const { resolveProductType } = await import("./inventory.server");
  const pType = resolveProductType(product);
  const available = product.stock ?? 0;
  if (available < qty) {
    throw new Error(`Insufficient stock. Available: ${available}, Requested: ${qty}.`);
  }
  const nextStock = available - qty;
  await db.collection("products").updateOne({ id: productId }, { $set: { stock: nextStock } }, opt);
  const now = new Date().toISOString();
  const unitCost = product.cost ?? 0;
  const movement: StockMovement = {
    id: newId(),
    date: now,
    productId,
    productName: product.name,
    productType: pType,
    type: "out",
    movementType: meta.refType === "sales" ? "SALE_ISSUE" : "ADJUSTMENT_OUT",
    direction: "out",
    quantity: qty,
    previousBalance: available,
    balanceAfter: nextStock,
    newBalance: nextStock,
    unitCost,
    totalCost: qty * unitCost,
    cogsAmount: qty * unitCost,
    costingMethod: productMethod(product),
    refType: meta.refType,
    refId: meta.refId,
    notes: meta.notes,
    by: meta.by,
  };
  await db.collection("stockMovements").insertOne(movement, opt);

  // Update separated inventory collection
  if (pType === "gas") {
    const unitPrice = Number(product.price) || 0;
    const costPrice = Number(product.cost) || 0;
    const valUnit = costPrice > 0 ? costPrice : unitPrice;
    await db.collection("gasInventory").updateOne(
      { productId: product.id },
      {
        $inc: { stockOut: qty },
        $set: { onHand: nextStock, totalValue: nextStock * valUnit, updatedAt: now },
      },
      { upsert: true, ...opt },
    );
  } else if (pType === "cylinder") {
    const cylDoc = await db.collection("cylinderInventory").findOne({ productId: product.id }, opt);
    const reserved = cylDoc ? Number(cylDoc.reserved) || 0 : 0;
    const unitPrice = Number(product.price) || 0;
    const costPrice = Number(product.cost) || 0;
    const valUnit = costPrice > 0 ? costPrice : unitPrice;
    await db.collection("cylinderInventory").updateOne(
      { productId: product.id },
      {
        $inc: { stockOut: qty },
        $set: {
          onHand: nextStock,
          available: Math.max(0, nextStock - reserved),
          totalValue: nextStock * valUnit,
          updatedAt: now,
        },
      },
      { upsert: true, ...opt },
    );
  } else {
    const unitPrice = Number(product.price) || 0;
    const costPrice = Number(product.cost) || 0;
    const valUnit = costPrice > 0 ? costPrice : unitPrice;
    await db.collection("productInventory").updateOne(
      { productId: product.id },
      {
        $inc: { stockOut: qty },
        $set: { onHand: nextStock, totalValue: nextStock * valUnit, updatedAt: now },
      },
      { upsert: true, ...opt },
    );
  }
}

export { receivePurchaseInDb as executePurchaseReceive };
