import type {
  LineItem,
  Product,
  StockMovement,
  SupplierReturn,
} from "../types/index.ts";
import { getNextSequence } from "./document-sequence.ts";
import { resolveProductType, reconcileDatabaseInventory } from "./inventory.server.ts";
import { logAudit } from "./audit.ts";

const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

export async function listSupplierReturnsInDb(db: any): Promise<SupplierReturn[]> {
  const docs = await db
    .collection("supplierReturns")
    .find({})
    .sort({ createdAt: -1, date: -1 })
    .toArray();
  return docs.map((d: any) => clean<SupplierReturn>(d));
}

export async function getSupplierReturnByIdInDb(
  db: any,
  id: string,
): Promise<SupplierReturn | null> {
  const doc = await db.collection("supplierReturns").findOne({ id: String(id) });
  return clean<SupplierReturn | null>(doc);
}

export type CreateSupplierReturnPayload = {
  supplierId?: string;
  supplierName: string;
  date?: string;
  notes?: string;
  items: LineItem[];
  purchaseOrderId?: string;
  purchaseOrderNo?: string;
};

export async function createSupplierReturnInDb(
  db: any,
  payload: CreateSupplierReturnPayload,
  user?: { username?: string },
): Promise<SupplierReturn> {
  if (!payload.items || payload.items.length === 0) {
    throw new Error("Add at least one item to return");
  }

  // 1. Validate sufficient stock for every returned item
  for (const item of payload.items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) {
      throw new Error(`Invalid return quantity for "${item.productName || item.productId}"`);
    }
    const pDoc = await db.collection("products").findOne({ id: item.productId });
    if (!pDoc) {
      throw new Error(`Product not found: "${item.productName || item.productId}"`);
    }
    const currentStock = Number(pDoc.stock) || 0;
    if (currentStock < qty) {
      throw new Error(
        `Insufficient stock for "${pDoc.name}". Available: ${currentStock}, Requested: ${qty}.`,
      );
    }
  }

  // 2. Generate sequence number & unique ID
  const returnNo = await getNextSequence(db, "SR");
  const returnId = Math.random().toString(36).slice(2, 10);
  const now = new Date().toISOString();
  const returnDate = payload.date || now;

  let subtotal = 0;

  // 3. Apply stock deduction and generate StockMovements
  for (const item of payload.items) {
    const qty = Number(item.quantity) || 0;
    const pDoc = await db.collection("products").findOne({ id: item.productId });
    const currentStock = Number(pDoc.stock) || 0;
    const nextStock = Math.max(0, currentStock - qty);
    const unitPrice = Number(item.price) || Number(pDoc.cost) || Number(pDoc.price) || 0;
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;

    // Deduct stock in products collection
    await db.collection("products").updateOne(
      { id: item.productId },
      { $set: { stock: nextStock } },
    );

    const pType = item.itemType || resolveProductType(pDoc);

    // Create outbound StockMovement
    const movement: StockMovement = {
      id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      date: returnDate,
      productId: item.productId,
      productName: item.productName || pDoc.name,
      productType: pType,
      type: "out",
      direction: "out",
      movementType: "PURCHASE_RETURN",
      quantity: qty,
      previousBalance: currentStock,
      balanceAfter: nextStock,
      newBalance: nextStock,
      unitCost: unitPrice,
      totalCost: lineTotal,
      cogsAmount: lineTotal,
      refType: "purchase",
      refId: returnId,
      notes: `Supplier Return ${returnNo} to ${payload.supplierName}`,
      by: user?.username || "system",
    };
    await db.collection("stockMovements").insertOne(movement);

    // Update separated inventory collections
    const costPrice = Number(pDoc.cost) || 0;
    const salesPrice = Number(pDoc.price) || 0;
    const valUnit = costPrice > 0 ? costPrice : salesPrice;

    if (pType === "gas") {
      await db.collection("gasInventory").updateOne(
        { productId: item.productId },
        {
          $inc: { stockOut: qty },
          $set: {
            onHand: nextStock,
            totalValue: nextStock * valUnit,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    } else if (pType === "cylinder") {
      const cylDoc = await db.collection("cylinderInventory").findOne({ productId: item.productId });
      const reserved = cylDoc ? Number(cylDoc.reserved) || 0 : 0;
      await db.collection("cylinderInventory").updateOne(
        { productId: item.productId },
        {
          $inc: { stockOut: qty },
          $set: {
            onHand: nextStock,
            available: Math.max(0, nextStock - reserved),
            totalValue: nextStock * valUnit,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    } else {
      await db.collection("productInventory").updateOne(
        { productId: item.productId },
        {
          $inc: { stockOut: qty },
          $set: {
            onHand: nextStock,
            totalValue: nextStock * valUnit,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }
  }

  // 4. Create and save supplier return document
  const returnDoc: SupplierReturn = {
    id: returnId,
    returnNo,
    supplierId: payload.supplierId || "",
    supplierName: payload.supplierName,
    date: returnDate,
    items: payload.items,
    subtotal,
    tax: 0,
    total: subtotal,
    status: "confirmed",
    notes: payload.notes || "",
    purchaseOrderId: payload.purchaseOrderId || undefined,
    purchaseOrderNo: payload.purchaseOrderNo || undefined,
    createdAt: now,
  };

  await db.collection("supplierReturns").insertOne(returnDoc);

  // 5. Audit log
  try {
    await logAudit(db, {
      userId: user?.username || "system",
      username: user?.username || "system",
      action: "CREATE",
      entityType: "supplierReturns" as any,
      entityId: returnId,
      after: returnDoc as any,
      details: `Created supplier return ${returnNo} to ${payload.supplierName}`,
    });
  } catch {}

  // 6. Centralized inventory reconciliation
  await reconcileDatabaseInventory(db).catch(() => {});

  return clean<SupplierReturn>(returnDoc);
}

export async function updateSupplierReturnInDb(
  db: any,
  id: string,
  payload: Partial<CreateSupplierReturnPayload>,
  user?: { username?: string },
): Promise<SupplierReturn> {
  const existingDoc = await db.collection("supplierReturns").findOne({ id });
  if (!existingDoc) throw new Error("Supplier return not found");
  const existing: SupplierReturn = clean(existingDoc);

  if (existing.status === "cancelled") {
    throw new Error("Cancelled supplier returns cannot be edited");
  }

  const items = payload.items || existing.items;
  if (!items || items.length === 0) {
    throw new Error("Add at least one item to return");
  }

  // Find previous stock movements for this return
  const prevMovements = await db
    .collection("stockMovements")
    .find({ refId: id, movementType: "PURCHASE_RETURN" })
    .toArray();

  // Temporarily revert stock from previous movements to check availability
  for (const m of prevMovements) {
    await db.collection("products").updateOne(
      { id: m.productId },
      { $inc: { stock: m.quantity } },
    );
  }

  // Validate new items against available stock
  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) {
      // Revert temporary restore
      for (const m of prevMovements) {
        await db.collection("products").updateOne(
          { id: m.productId },
          { $inc: { stock: -m.quantity } },
        );
      }
      throw new Error(`Invalid return quantity for "${item.productName || item.productId}"`);
    }
    const pDoc = await db.collection("products").findOne({ id: item.productId });
    if (!pDoc) {
      for (const m of prevMovements) {
        await db.collection("products").updateOne(
          { id: m.productId },
          { $inc: { stock: -m.quantity } },
        );
      }
      throw new Error(`Product not found: "${item.productName || item.productId}"`);
    }
    const currentStock = Number(pDoc.stock) || 0;
    if (currentStock < qty) {
      // Revert temporary restore
      for (const m of prevMovements) {
        await db.collection("products").updateOne(
          { id: m.productId },
          { $inc: { stock: -m.quantity } },
        );
      }
      throw new Error(
        `Insufficient stock for "${pDoc.name}". Available: ${currentStock}, Requested: ${qty}.`,
      );
    }
  }

  // Stock is valid! Delete previous movements and apply new deductions
  await db.collection("stockMovements").deleteMany({ refId: id, movementType: "PURCHASE_RETURN" });

  const now = new Date().toISOString();
  const returnDate = payload.date || existing.date || now;
  let subtotal = 0;

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const pDoc = await db.collection("products").findOne({ id: item.productId });
    const currentStock = Number(pDoc.stock) || 0;
    const nextStock = Math.max(0, currentStock - qty);
    const unitPrice = Number(item.price) || Number(pDoc.cost) || Number(pDoc.price) || 0;
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;

    await db.collection("products").updateOne(
      { id: item.productId },
      { $set: { stock: nextStock } },
    );

    const pType = item.itemType || resolveProductType(pDoc);

    const movement: StockMovement = {
      id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      date: returnDate,
      productId: item.productId,
      productName: item.productName || pDoc.name,
      productType: pType,
      type: "out",
      direction: "out",
      movementType: "PURCHASE_RETURN",
      quantity: qty,
      previousBalance: currentStock,
      balanceAfter: nextStock,
      newBalance: nextStock,
      unitCost: unitPrice,
      totalCost: lineTotal,
      cogsAmount: lineTotal,
      refType: "purchase",
      refId: id,
      notes: `Supplier Return ${existing.returnNo} to ${payload.supplierName || existing.supplierName}`,
      by: user?.username || "system",
    };
    await db.collection("stockMovements").insertOne(movement);
  }

  const updatedDoc: SupplierReturn = {
    ...existing,
    supplierId: payload.supplierId !== undefined ? payload.supplierId : existing.supplierId,
    supplierName: payload.supplierName || existing.supplierName,
    date: returnDate,
    items,
    subtotal,
    tax: 0,
    total: subtotal,
    notes: payload.notes !== undefined ? payload.notes : existing.notes,
    purchaseOrderId: payload.purchaseOrderId !== undefined ? payload.purchaseOrderId : existing.purchaseOrderId,
    purchaseOrderNo: payload.purchaseOrderNo !== undefined ? payload.purchaseOrderNo : existing.purchaseOrderNo,
    updatedAt: now,
  };

  await db.collection("supplierReturns").updateOne({ id }, { $set: updatedDoc });

  try {
    await logAudit(db, {
      userId: user?.username || "system",
      username: user?.username || "system",
      action: "UPDATE",
      entityType: "supplierReturns" as any,
      entityId: id,
      before: existing as any,
      after: updatedDoc as any,
      details: `Updated supplier return ${existing.returnNo}`,
    });
  } catch {}

  await reconcileDatabaseInventory(db).catch(() => {});

  return clean<SupplierReturn>(updatedDoc);
}

export async function removeSupplierReturnInDb(
  db: any,
  id: string,
  user?: { username?: string },
): Promise<{ ok: true }> {
  const existingDoc = await db.collection("supplierReturns").findOne({ id });
  if (!existingDoc) throw new Error("Supplier return not found");
  const existing: SupplierReturn = clean(existingDoc);

  // Revert stock adjustments
  const movements = await db
    .collection("stockMovements")
    .find({ refId: id, movementType: "PURCHASE_RETURN" })
    .toArray();

  for (const m of movements) {
    await db.collection("products").updateOne(
      { id: m.productId },
      { $inc: { stock: m.quantity } },
    );
  }

  await db.collection("stockMovements").deleteMany({ refId: id, movementType: "PURCHASE_RETURN" });
  await db.collection("supplierReturns").deleteOne({ id });

  try {
    await logAudit(db, {
      userId: user?.username || "system",
      username: user?.username || "system",
      action: "DELETE",
      entityType: "supplierReturns" as any,
      entityId: id,
      before: existing as any,
      details: `Deleted supplier return ${existing.returnNo}`,
    });
  } catch {}

  await reconcileDatabaseInventory(db).catch(() => {});

  return { ok: true };
}

export type ReceiveSupplierReturnPayload = {
  id: string;
  requestId?: string;
  date?: string;
  notes?: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
};

export async function receiveSupplierReturnDeliveryInDb(
  db: any,
  payload: ReceiveSupplierReturnPayload,
  user?: { username?: string },
): Promise<SupplierReturn> {
  const returnDoc = await db.collection("supplierReturns").findOne({ id: String(payload.id) });
  if (!returnDoc) {
    throw new Error("Supplier return not found");
  }
  if (returnDoc.status === "cancelled") {
    throw new Error("Cannot receive delivery for a cancelled supplier return.");
  }

  // Idempotency check: if already processed with this requestId, return existing doc
  if (
    payload.requestId &&
    (returnDoc.deliveries || []).some((d: any) => d.id === payload.requestId)
  ) {
    return clean<SupplierReturn>(returnDoc);
  }

  const existingItems: LineItem[] = returnDoc.items || [];
  if (existingItems.length === 0) {
    throw new Error("This supplier return has no items.");
  }

  // 1. Recalculate outstanding quantity from persisted DB records and validate
  const itemsToReceive: Array<{ item: LineItem; qty: number }> = [];
  let totalReceivingQty = 0;

  for (const item of existingItems) {
    const ordered = Number(item.quantity) || 0;
    const received = Number(item.receivedQty) || 0;
    const remaining = Math.max(0, ordered - received);

    const reqItem = (payload.items || []).find((p) => String(p.productId) === String(item.productId));
    const rawQty = reqItem ? Number(reqItem.quantity) : 0;
    const qty = Number.isFinite(rawQty) ? Math.max(0, rawQty) : 0;

    if (qty > remaining + 1e-9) {
      throw new Error(
        `Received quantity (${qty}) exceeds remaining pending quantity (${remaining}) for "${item.productName || item.productId}".`,
      );
    }

    if (qty > 0) {
      itemsToReceive.push({ item, qty });
      totalReceivingQty += qty;
    }
  }

  if (totalReceivingQty <= 0) {
    throw new Error("Received quantity must be greater than 0.");
  }

  const receiptNo = await getNextSequence(db, "SRD");
  const now = new Date().toISOString();
  const deliveryDate = payload.date || now;
  const receiptId =
    payload.requestId ||
    `srd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // 2. Add received quantity back into existing inventory
  for (const { item, qty } of itemsToReceive) {
    const pDoc = await db.collection("products").findOne({ id: item.productId });
    const currentStock = pDoc ? Number(pDoc.stock) || 0 : 0;
    const nextStock = currentStock + qty;
    const unitPrice =
      Number(item.price) || (pDoc ? Number(pDoc.cost) || Number(pDoc.price) || 0 : 0);
    const lineTotal = qty * unitPrice;

    // Check duplicate stockMovement
    const dup = await db.collection("stockMovements").findOne({
      refType: "purchase",
      refId: returnDoc.id,
      productId: item.productId,
      type: "in",
      notes: { $regex: receiptNo },
    });
    if (dup) continue;

    // Update stock in products collection
    if (pDoc) {
      await db.collection("products").updateOne(
        { id: item.productId },
        { $set: { stock: nextStock } },
      );
    }

    const pType = item.itemType || (pDoc ? resolveProductType(pDoc) : "cylinder");

    // Create inbound StockMovement
    const movement: StockMovement = {
      id: `sm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      date: deliveryDate,
      productId: item.productId,
      productName: item.productName || (pDoc ? pDoc.name : "Product"),
      productType: pType,
      type: "in",
      direction: "in",
      movementType: "RECEIPT",
      quantity: qty,
      previousBalance: currentStock,
      balanceAfter: nextStock,
      newBalance: nextStock,
      unitCost: unitPrice,
      totalCost: lineTotal,
      cogsAmount: lineTotal,
      refType: "purchase",
      refId: returnDoc.id,
      notes: `Delivery Received for Supplier Return ${returnDoc.returnNo} (${receiptNo})${payload.notes ? ` · ${payload.notes}` : ""}`,
      by: user?.username || "Warehouse",
    };
    await db.collection("stockMovements").insertOne(movement);

    // Update separated inventory collections
    const costPrice = pDoc ? Number(pDoc.cost) || 0 : 0;
    const salesPrice = pDoc ? Number(pDoc.price) || 0 : 0;
    const valUnit = costPrice > 0 ? costPrice : salesPrice;

    if (pType === "gas") {
      await db.collection("gasInventory").updateOne(
        { productId: item.productId },
        {
          $inc: { stockIn: qty },
          $set: {
            onHand: nextStock,
            totalValue: nextStock * valUnit,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    } else if (pType === "cylinder") {
      const cylDoc = await db.collection("cylinderInventory").findOne({ productId: item.productId });
      const reserved = cylDoc ? Number(cylDoc.reserved) || 0 : 0;
      await db.collection("cylinderInventory").updateOne(
        { productId: item.productId },
        {
          $inc: { stockIn: qty },
          $set: {
            onHand: nextStock,
            available: Math.max(0, nextStock - reserved),
            totalValue: nextStock * valUnit,
            updatedAt: now,
          },
        },
        { upsert: true },
      );

      // If serialized cylinders exist with location = supplier, return them to warehouse
      try {
        const atSupplier = await db
          .collection("cylinders")
          .find({
            productId: item.productId,
            status: { $in: ["refilling", "in_transit"] },
          })
          .limit(qty)
          .toArray();

        for (const c of atSupplier) {
          await db.collection("cylinders").updateOne(
            { id: c.id },
            {
              $set: {
                status: "in_stock",
                fillLevel: "full",
                location: "Warehouse",
                lastMovementAt: now,
              },
            },
          );
          await db.collection("movements").insertOne({
            id: `mov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            cylinderId: c.id,
            type: "refilled",
            fromLocation: c.location || returnDoc.supplierName,
            toLocation: "Warehouse",
            date: deliveryDate,
            notes: `Delivery Received (${receiptNo})`,
            by: user?.username || "Warehouse",
          });
        }
      } catch {}
    } else {
      await db.collection("productInventory").updateOne(
        { productId: item.productId },
        {
          $inc: { stockIn: qty },
          $set: {
            onHand: nextStock,
            totalValue: nextStock * valUnit,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }

    // Cost layer tracking
    try {
      await db.collection("costLayers").insertOne({
        id: `cl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        productId: item.productId,
        qtyRemaining: qty,
        unitCost: unitPrice,
        receivedAt: deliveryDate,
        refType: "purchase",
        refId: returnDoc.id,
      });
    } catch {}
  }

  // 3. Update SupplierReturn items and status
  const updatedItems = existingItems.map((item) => {
    const receivedNowItem = itemsToReceive.find(
      (x) => String(x.item.productId) === String(item.productId),
    );
    const addQty = receivedNowItem ? receivedNowItem.qty : 0;
    const prevReceived = Number(item.receivedQty) || 0;
    return {
      ...item,
      receivedQty: prevReceived + addQty,
    };
  });

  const allFullyReceived = updatedItems.every(
    (it) => (Number(it.receivedQty) || 0) >= (Number(it.quantity) || 0),
  );
  const nextStatus = allFullyReceived ? "received" : "partial";
  const nextReceivingStatus = allFullyReceived ? "received" : "partial";

  const deliveryEntry = {
    id: receiptId,
    receiptNo,
    date: deliveryDate,
    receivedAt: now,
    items: itemsToReceive.map((x) => ({
      productId: x.item.productId,
      productName: x.item.productName,
      quantity: x.qty,
    })),
    notes: payload.notes || "",
    by: user?.username || "Warehouse",
  };

  await db.collection("supplierReturns").updateOne(
    { id: returnDoc.id },
    {
      $set: {
        items: updatedItems,
        status: nextStatus,
        receivingStatus: nextReceivingStatus,
        updatedAt: now,
      },
      $push: {
        deliveries: deliveryEntry,
      },
    },
  );

  try {
    await logAudit(db, {
      userId: user?.username || "system",
      username: user?.username || "system",
      action: "UPDATE",
      entityType: "supplierReturns" as any,
      entityId: returnDoc.id,
      details: `Received delivery (${receiptNo}) for supplier return ${returnDoc.returnNo} (${totalReceivingQty} units)`,
    });
  } catch {}

  const finalDoc = await db.collection("supplierReturns").findOne({ id: returnDoc.id });
  return clean<SupplierReturn>(finalDoc);
}
