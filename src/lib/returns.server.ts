import type {
  Cylinder,
  CylinderMovement,
  Delivery,
  LineItem,
  Product,
  ReturnItem,
  ReturnRecord,
  StockMovement,
  UnitOfMeasure,
} from "../types/index.ts";
import { getNextSequence } from "./document-sequence.ts";
import { resolveProductType, reconcileDatabaseInventory } from "./inventory.server.ts";
import { logAudit } from "./audit.ts";

const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

let seq = 0;
function newId(prefix = "ret"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export type DeliveryItemReturnStatus = {
  productId: string;
  productName: string;
  category?: string;
  itemType: "gas" | "cylinder" | "product";
  deliveredQuantity: number;
  previouslyReturnedQuantity: number;
  remainingReturnableQuantity: number;
  price: number;
  cylinderIds?: string[];
  unit?: UnitOfMeasure;
};

export type DeliveryReturnSummary = {
  delivery: Delivery;
  items: DeliveryItemReturnStatus[];
  totalDelivered: number;
  totalReturned: number;
  totalRemaining: number;
  returns: ReturnRecord[];
  isFullyReturned: boolean;
};

/**
 * Calculates remaining returnable quantities and return history for a specific delivery.
 * Formula: Remaining Returnable Quantity = Original Delivered Quantity - Previously Accepted Return Quantity
 */
export async function getDeliveryReturnSummaryInDb(
  db: any,
  deliveryId: string,
): Promise<DeliveryReturnSummary> {
  const dDoc = await db.collection("deliveries").findOne({
    $or: [{ id: deliveryId }, { challanNo: deliveryId }],
  });
  if (!dDoc) throw new Error("Delivery challan not found");
  const delivery: Delivery = clean(dDoc);

  const returnDocs = await db
    .collection("returns")
    .find({ deliveryId: delivery.id, status: { $ne: "cancelled" } })
    .toArray();
  const returns: ReturnRecord[] = returnDocs.map((r: any) => clean(r));

  // Compute previously returned quantity per product
  const returnedByProduct: Record<string, number> = {};
  for (const r of returns) {
    for (const it of r.items || []) {
      const q = Number(it.returnQuantity) || 0;
      returnedByProduct[it.productId] = (returnedByProduct[it.productId] || 0) + q;
    }
  }

  // Fetch product definitions for metadata (categories, units, types)
  const productDocs = await db.collection("products").find({}).toArray();
  const products: Product[] = productDocs.map((p: any) => clean(p));

  const items: DeliveryItemReturnStatus[] = (delivery.items || []).map((it) => {
    const p = products.find((x) => x.id === it.productId);
    const delivered = Number(it.quantity) || 0;
    const previouslyReturned = returnedByProduct[it.productId] || 0;
    const remaining = Math.max(0, delivered - previouslyReturned);
    const itemType =
      it.itemType === "gas" || it.itemType === "cylinder" || it.itemType === "product"
        ? it.itemType
        : resolveProductType(p);

    return {
      productId: it.productId,
      productName: it.productName || p?.name || "Unknown Product",
      category: it.category || p?.category || "",
      itemType,
      deliveredQuantity: delivered,
      previouslyReturnedQuantity: previouslyReturned,
      remainingReturnableQuantity: remaining,
      price: Number(it.price) || Number(p?.price) || 0,
      cylinderIds: it.cylinderIds ? [...it.cylinderIds] : undefined,
      unit: p?.uom,
    };
  });

  const totalDelivered = items.reduce((sum, it) => sum + it.deliveredQuantity, 0);
  const totalReturned = items.reduce((sum, it) => sum + it.previouslyReturnedQuantity, 0);
  const totalRemaining = items.reduce((sum, it) => sum + it.remainingReturnableQuantity, 0);
  const isFullyReturned = totalDelivered > 0 && totalRemaining === 0;

  return {
    delivery,
    items,
    totalDelivered,
    totalReturned,
    totalRemaining,
    returns,
    isFullyReturned,
  };
}

export type ProcessReturnPayload = {
  deliveryId: string;
  returnDate?: string;
  reason?: string;
  notes?: string;
  items: Array<{
    productId: string;
    returnQuantity: number;
    cylinderCondition?: "empty" | "full" | "damaged";
    cylinderIds?: string[];
  }>;
};

/**
 * Atomically process customer return, record return document,
 * post inventory movements to respective inventories, and prevent over-returning.
 */
export async function processReturnInDb(
  db: any,
  session: any,
  payload: ProcessReturnPayload,
  user?: { username?: string },
): Promise<ReturnRecord> {
  const opt = session ? { session } : {};
  const now = new Date().toISOString();
  const returnDate = payload.returnDate || now;

  if (!payload.deliveryId) throw new Error("Missing delivery challan ID");
  const dDoc = await db.collection("deliveries").findOne({
    $or: [{ id: payload.deliveryId }, { challanNo: payload.deliveryId }],
  }, opt);
  if (!dDoc) throw new Error("Delivery challan not found");
  const delivery: Delivery = clean(dDoc);

  if ((delivery.status as string) === "cancelled") {
    throw new Error("Cancelled delivery challans cannot accept returns");
  }

  // Filter items that have positive return quantities
  const positiveItems = (payload.items || []).filter((it) => Number(it.returnQuantity) > 0);
  if (positiveItems.length === 0) {
    throw new Error("Please specify return quantities for at least one delivered item");
  }

  // Recalculate authoritative remaining quantities under this transaction
  const prevReturnsRaw = await db
    .collection("returns")
    .find({ deliveryId: delivery.id, status: { $ne: "cancelled" } }, opt)
    .toArray();
  const prevReturns: ReturnRecord[] = prevReturnsRaw.map((r: any) => clean(r));

  const previouslyReturnedMap: Record<string, number> = {};
  for (const r of prevReturns) {
    for (const it of r.items || []) {
      const q = Number(it.returnQuantity) || 0;
      previouslyReturnedMap[it.productId] = (previouslyReturnedMap[it.productId] || 0) + q;
    }
  }

  const productDocsRaw = await db.collection("products").find({}, opt).toArray();
  const products: Product[] = productDocsRaw.map((p: any) => clean(p));

  const finalReturnItems: ReturnItem[] = [];
  const movementIds: string[] = [];

  for (const requested of positiveItems) {
    const returnQty = Number(requested.returnQuantity);
    if (!Number.isFinite(returnQty) || returnQty <= 0) {
      throw new Error(`Invalid return quantity for product ${requested.productId}`);
    }

    const delItem = (delivery.items || []).find((it) => it.productId === requested.productId);
    if (!delItem) {
      throw new Error(`Product ${requested.productId} was not delivered on Challan ${delivery.challanNo}`);
    }

    const deliveredQty = Number(delItem.quantity) || 0;
    const prevReturned = previouslyReturnedMap[requested.productId] || 0;
    const remaining = Math.max(0, deliveredQty - prevReturned);

    if (returnQty > remaining) {
      throw new Error(
        `Cannot return ${returnQty} of ${delItem.productName}. Maximum remaining returnable quantity is ${remaining}.`,
      );
    }

    const p = products.find((x) => x.id === requested.productId);
    const itemType =
      delItem.itemType === "gas" || delItem.itemType === "cylinder" || delItem.itemType === "product"
        ? delItem.itemType
        : resolveProductType(p);
    const price = Number(delItem.price) || Number(p?.price) || 0;
    const subtotal = returnQty * price;

    finalReturnItems.push({
      productId: requested.productId,
      productName: delItem.productName || p?.name || "Product",
      category: delItem.category || p?.category || "",
      itemType,
      deliveredQuantity: deliveredQty,
      previouslyReturnedQuantity: prevReturned,
      returnQuantity: returnQty,
      price,
      subtotal,
      cylinderCondition: itemType === "cylinder" ? (requested.cylinderCondition || "empty") : undefined,
      cylinderIds: requested.cylinderIds && requested.cylinderIds.length ? [...requested.cylinderIds] : undefined,
      unit: p?.uom,
    });
  }

  // Generate unique Return Sequence and ID
  const returnNo = await getNextSequence(db, "RET");
  const returnId = newId("ret");
  const totalQuantity = finalReturnItems.reduce((sum, it) => sum + it.returnQuantity, 0);
  const totalAmount = finalReturnItems.reduce((sum, it) => sum + it.subtotal, 0);

  // Determine item classification
  const hasGas = finalReturnItems.some((it) => it.itemType === "gas");
  const hasCyl = finalReturnItems.some((it) => it.itemType === "cylinder");
  const hasProd = finalReturnItems.some((it) => it.itemType === "product");
  const itemClassification =
    hasGas && !hasCyl && !hasProd
      ? "gas"
      : hasCyl && !hasGas && !hasProd
        ? "cylinder"
        : hasProd && !hasGas && !hasCyl
          ? "product"
          : "mixed";

  const returnRecord: ReturnRecord = {
    id: returnId,
    returnNo,
    deliveryId: delivery.id,
    challanNo: delivery.challanNo,
    salesOrderId: delivery.salesOrderId,
    customerId: delivery.customerId,
    customerName: delivery.customerName,
    customerPhone: delivery.customerPhone,
    customerAddress: delivery.customerAddress,
    driverName: delivery.driverName,
    receiverName: delivery.receiverName,
    vehicleNo: delivery.vehicleNo,
    returnDate,
    items: finalReturnItems,
    itemClassification,
    totalQuantity,
    totalAmount,
    reason: payload.reason?.trim() || undefined,
    notes: payload.notes?.trim() || undefined,
    status: "completed",
    createdBy: user?.username || "Operator",
    createdAt: now,
    movementIds: [],
  };

  // POST INVENTORY MOVEMENTS BASED ON CLASSIFICATION (STRICT SEPARATION)
  for (const it of finalReturnItems) {
    const p = products.find((x) => x.id === it.productId);
    const cost = Number(p?.cost) || 0;
    const currentProductStock = Number(p?.stock) || 0;
    const moveId = newId("mov");
    movementIds.push(moveId);

    if (it.itemType === "gas") {
      // GAS RETURN -> GAS INVENTORY ONLY
      const newStock = currentProductStock + it.returnQuantity;
      const movement: StockMovement = {
        id: newId("sm"),
        movementId: moveId,
        date: returnDate,
        productId: it.productId,
        productName: it.productName,
        productType: "gas",
        type: "in",
        movementType: "SALES_RETURN",
        direction: "in",
        quantity: it.returnQuantity,
        previousBalance: currentProductStock,
        balanceAfter: newStock,
        newBalance: newStock,
        unitCost: cost,
        totalCost: it.returnQuantity * cost,
        cogsAmount: it.returnQuantity * cost,
        costingMethod: p?.costingMethod || "fifo",
        refType: "delivery",
        refId: delivery.id,
        sourceType: "return",
        sourceId: returnId,
        notes: `Gas Return ${returnNo} (Delivery ${delivery.challanNo})`,
        by: user?.username || "Return Management",
      };
      await db.collection("stockMovements").insertOne(movement, opt);

      // Increase Gas Inventory onHand and stockIn
      await db.collection("gasInventory").updateOne(
        { productId: it.productId },
        {
          $inc: { stockIn: it.returnQuantity, onHand: it.returnQuantity },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );

      // Update product master stock
      await db.collection("products").updateOne(
        { id: it.productId },
        { $inc: { stock: it.returnQuantity } },
        opt,
      );
    } else if (it.itemType === "cylinder") {
      // CYLINDER RETURN -> CYLINDER INVENTORY ONLY
      const isDamaged = it.cylinderCondition === "damaged";
      const isFull = it.cylinderCondition === "full";
      const isEmpty = !isDamaged && !isFull; // default is empty

      // Create StockMovement
      const movement: StockMovement = {
        id: newId("sm"),
        movementId: moveId,
        date: returnDate,
        productId: it.productId,
        productName: it.productName,
        productType: "cylinder",
        type: isDamaged ? "out" : "in",
        movementType: isDamaged ? "DAMAGE" : "SALES_RETURN",
        direction: isDamaged ? "out" : "in",
        quantity: it.returnQuantity,
        previousBalance: currentProductStock,
        balanceAfter: isFull ? currentProductStock + it.returnQuantity : currentProductStock,
        newBalance: isFull ? currentProductStock + it.returnQuantity : currentProductStock,
        unitCost: cost,
        totalCost: it.returnQuantity * cost,
        cogsAmount: it.returnQuantity * cost,
        costingMethod: p?.costingMethod || "fifo",
        refType: "delivery",
        refId: delivery.id,
        sourceType: "return",
        sourceId: returnId,
        notes: `Cylinder Return (${it.cylinderCondition}) ${returnNo} (Delivery ${delivery.challanNo})`,
        by: user?.username || "Return Management",
      };
      await db.collection("stockMovements").insertOne(movement, opt);

      // Update cylinder inventory
      if (isFull) {
        // Full cylinder: increases onHand and available stock
        await db.collection("cylinderInventory").updateOne(
          { productId: it.productId },
          {
            $inc: { stockIn: it.returnQuantity, onHand: it.returnQuantity, available: it.returnQuantity },
            $set: { updatedAt: now },
          },
          { upsert: true, ...opt },
        );
        await db.collection("products").updateOne(
          { id: it.productId },
          { $inc: { stock: it.returnQuantity } },
          opt,
        );
      } else if (isEmpty) {
        // Empty cylinder: increases onHand / empties pool, but NOT available for sale
        await db.collection("cylinderInventory").updateOne(
          { productId: it.productId },
          {
            $inc: { stockIn: it.returnQuantity, onHand: it.returnQuantity },
            $set: { updatedAt: now },
          },
          { upsert: true, ...opt },
        );
      } else if (isDamaged) {
        // Damaged cylinder: tracked as damaged, not available for sale
        await db.collection("cylinderInventory").updateOne(
          { productId: it.productId },
          {
            $inc: { stockIn: it.returnQuantity },
            $set: { updatedAt: now },
          },
          { upsert: true, ...opt },
        );
      }

      // If specific cylinder IDs were returned, update individual cylinder assets
      if (it.cylinderIds && it.cylinderIds.length) {
        for (const cid of it.cylinderIds) {
          const cylPatch: Record<string, unknown> = {
            status: isDamaged ? "damaged" : "in_stock",
            fillLevel: isFull ? "full" : "empty",
            location: "Warehouse",
            customerId: null,
            lastMovementAt: now,
          };
          await db.collection("cylinders").updateOne({ id: cid }, { $set: cylPatch }, opt);

          const cylMove: CylinderMovement = {
            id: newId("cmov"),
            cylinderId: cid,
            type: isDamaged ? "damaged" : "returned",
            customerId: delivery.customerId,
            fromLocation: delivery.customerName,
            toLocation: "Warehouse",
            notes: `Return ${returnNo} (${it.cylinderCondition || "empty"}) from Challan ${delivery.challanNo}`,
            timestamp: now,
            by: user?.username || "Return Management",
            purpose: isDamaged ? "damaged" : "return",
          };
          await db.collection("movements").insertOne(cylMove, opt);
        }
      }
    } else {
      // PRODUCT RETURN -> PRODUCT INVENTORY ONLY
      const newStock = currentProductStock + it.returnQuantity;
      const movement: StockMovement = {
        id: newId("sm"),
        movementId: moveId,
        date: returnDate,
        productId: it.productId,
        productName: it.productName,
        productType: "product",
        type: "in",
        movementType: "SALES_RETURN",
        direction: "in",
        quantity: it.returnQuantity,
        previousBalance: currentProductStock,
        balanceAfter: newStock,
        newBalance: newStock,
        unitCost: cost,
        totalCost: it.returnQuantity * cost,
        cogsAmount: it.returnQuantity * cost,
        costingMethod: p?.costingMethod || "fifo",
        refType: "delivery",
        refId: delivery.id,
        sourceType: "return",
        sourceId: returnId,
        notes: `Product Return ${returnNo} (Delivery ${delivery.challanNo})`,
        by: user?.username || "Return Management",
      };
      await db.collection("stockMovements").insertOne(movement, opt);

      // Increase Product Inventory
      await db.collection("productInventory").updateOne(
        { productId: it.productId },
        {
          $inc: { stockIn: it.returnQuantity, onHand: it.returnQuantity },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );

      // Update product master stock
      await db.collection("products").updateOne(
        { id: it.productId },
        { $inc: { stock: it.returnQuantity } },
        opt,
      );
    }
  }

  returnRecord.movementIds = movementIds;
  await db.collection("returns").insertOne(returnRecord, opt);

  // Check if Delivery Challan is now completely returned
  let isAllReturned = true;
  for (const delItem of delivery.items || []) {
    const totalReturnedSoFar =
      (previouslyReturnedMap[delItem.productId] || 0) +
      (finalReturnItems.find((it) => it.productId === delItem.productId)?.returnQuantity || 0);
    if (totalReturnedSoFar < (Number(delItem.quantity) || 0)) {
      isAllReturned = false;
      break;
    }
  }

  if (isAllReturned) {
    await db.collection("deliveries").updateOne(
      { id: delivery.id },
      { $set: { status: "returned", updatedAt: now } },
      opt,
    );
  } else if (delivery.status === "pending" || delivery.status === "in_transit") {
    await db.collection("deliveries").updateOne(
      { id: delivery.id },
      { $set: { status: "delivered", updatedAt: now } },
      opt,
    );
  }

  // Run background reconciliation without blocking the return confirmation
  reconcileDatabaseInventory(db).catch(() => {});

  // Audit log
  try {
    await logAudit(db, {
      userId: user?.username || "system",
      username: user?.username || "system",
      action: "CREATE",
      entityType: "deliveries" as any,
      entityId: returnId,
      after: returnRecord as any,
      details: `Processed return ${returnNo} for Delivery Challan ${delivery.challanNo} (${totalQuantity} items)`,
    });
  } catch {}

  delete (returnRecord as any)._id;
  return clean<ReturnRecord>(returnRecord);
}

/**
 * List returns with optional filter by item classification (gas, cylinder, product).
 */
export async function listReturnsInDb(
  db: any,
  classification?: "gas" | "cylinder" | "product",
): Promise<ReturnRecord[]> {
  const query: Record<string, unknown> = {};
  if (classification) {
    // Either the return's overall classification matches or it contains items of this classification
    query.$or = [
      { itemClassification: classification },
      { "items.itemType": classification },
    ];
  }

  const docs = await db.collection("returns").find(query).sort({ returnDate: -1, createdAt: -1 }).toArray();
  return docs.map((d: any) => clean<ReturnRecord>(d));
}

/**
 * Get single return record by ID.
 */
export async function getReturnByIdInDb(db: any, id: string): Promise<ReturnRecord | null> {
  const doc = await db.collection("returns").findOne({ id });
  return clean<ReturnRecord | null>(doc);
}
