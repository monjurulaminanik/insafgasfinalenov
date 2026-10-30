import type {
  Cylinder,
  CylinderInventory,
  Delivery,
  GasInventory,
  InventorySummary,
  LineItem,
  MovementTypeKind,
  Product,
  ProductInventory,
  ProductType,
  PurchaseOrder,
  SalesOrder,
  StockMovement,
} from "../types/index.ts";
import { cylinderIsFullStock, isInactiveCompanyCylinder } from "./cylinder-product.ts";

const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

export function resolveProductType(
  p: Pick<Product, "productType" | "uom" | "category" | "name"> | null | undefined,
): ProductType {
  if (!p) return "gas";
  if (p.productType === "product" || p.productType === "cylinder" || p.productType === "gas") {
    return p.productType;
  }
  const uom = String(p.uom || "").toLowerCase();
  if (uom === "pcs") return "product";
  if (uom === "cyl") return "cylinder";
  if (uom === "kg" || uom === "ltr") return "gas";
  const cat = String(p.category || "").toLowerCase();
  if (cat.includes("cylinder") || cat === "cylinder") return "cylinder";
  return "gas";
}

let seq = 0;
function newId(prefix = "mov"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const KNOWN_OPENING_STOCKS: Record<string, number> = {
  p1: 25,
  p2: 20,
  p3: 28,
  p4: 46,
  p5: 6,
  p6: 22,
  "0n4pn2g1": 20,
  "9jdnwagj": 78,
  "59eaw73l": 0,
  hpgmusaf: 0,
  azdmoisv: 100,
  "4cos6kjk": 33,
};

/**
 * Calculates reserved quantity for cylinder products.
 * Reserved = confirmed/invoiced/paid sales orders ordered quantity - already delivered quantity.
 * Reserved cylinders are NOT deducted from On Hand until actually sold/delivered.
 */
export function computeReservedQty(
  productId: string,
  sales: SalesOrder[],
  deliveries: Delivery[],
  deductedSoIds?: Set<string>,
): number {
  const openStatuses = new Set(["confirmed", "invoiced", "paid"]);
  const doneDeliveryStatuses = new Set(["delivered", "confirmed"]);
  let reserved = 0;

  for (const so of sales) {
    if (!openStatuses.has(so.status)) continue;
    if (deductedSoIds?.has(so.id)) continue;
    const item = (so.items || []).find((it) => it.productId === productId);
    if (!item) continue;
    const orderedQty = Number(item.quantity) || 0;
    if (orderedQty <= 0) continue;

    // Sum delivered quantity for this sales order item
    let deliveredQty = 0;
    for (const d of deliveries) {
      if (d.salesOrderId !== so.id) continue;
      if (!doneDeliveryStatuses.has(d.status)) continue;
      for (const dItem of d.items || []) {
        if (dItem.productId === productId) {
          deliveredQty += Number(dItem.quantity) || 0;
        }
      }
    }

    reserved += Math.max(0, orderedQty - deliveredQty);
  }

  return reserved;
}

/**
 * Audit & reconcile all stock records in MongoDB.
 * Generates and synchronizes gasInventory, cylinderInventory, and productInventory collections.
 */
export async function reconcileDatabaseInventory(db: any, session?: any): Promise<InventorySummary> {
  const opt = session ? { session } : {};
  const now = new Date().toISOString();

  const [productsRaw, movementsRaw, salesRaw, deliveriesRaw, purchasesRaw, cylindersRaw] = await Promise.all([
    db.collection("products").find({}, opt).toArray(),
    db.collection("stockMovements").find({}, opt).toArray(),
    db.collection("sales").find({}, opt).toArray(),
    db.collection("deliveries").find({}, opt).toArray(),
    db.collection("purchases").find({}, opt).toArray(),
    db.collection("cylinders").find({}, opt).toArray(),
  ]);

  const products: Product[] = productsRaw.map((d: any) => clean(d));
  const movements: StockMovement[] = movementsRaw.map((d: any) => clean(d));
  const sales: SalesOrder[] = salesRaw.map((d: any) => clean(d));
  const deliveries: Delivery[] = deliveriesRaw.map((d: any) => clean(d));
  const purchases: PurchaseOrder[] = purchasesRaw.map((d: any) => clean(d));
  const cylinders: Cylinder[] = cylindersRaw.map((d: any) => clean(d));

  const productsTableIdSet = new Set(products.map((p) => p.id));
  const productMap = new Map<string, Product>();
  for (const p of products) {
    productMap.set(p.id, p);
  }

  // Find all referenced product IDs across cylinders, movements, sales, and purchases
  const referencedProductIds = new Set<string>([
    ...cylinders.map((c) => c.productId).filter(Boolean),
    ...movements.map((m) => m.productId).filter(Boolean),
    ...sales.flatMap((s) => (s.items || []).map((i) => i.productId)).filter(Boolean),
    ...purchases.flatMap((p) => (p.items || []).map((i) => i.productId)).filter(Boolean),
  ]);

  const existingNames = new Set(products.map((p) => p.name?.trim().toLowerCase()).filter(Boolean));
  const existingCodes = new Set(products.map((p) => p.code?.trim().toLowerCase()).filter(Boolean));

  const missingProductIds = Array.from(referencedProductIds).filter((id) => !productMap.has(id));

  if (missingProductIds.length > 0) {
    const deleteLogs = await db
      .collection("auditLogs")
      .find(
        {
          entityType: "products",
          entityId: { $in: missingProductIds },
          action: "DELETE",
        },
        opt,
      )
      .sort({ timestamp: -1 })
      .toArray();

    for (const log of deleteLogs) {
      if (log.entityId && !productMap.has(log.entityId) && log.before) {
        const item = clean<Product>(log.before);
        const nameKey = (item.name || "").trim().toLowerCase();
        const codeKey = (item.code || "").trim().toLowerCase();
        // Do not resurrect deleted duplicate products if an active product already exists with that name/code
        if (existingNames.has(nameKey) || (codeKey && existingCodes.has(codeKey))) {
          continue;
        }
        productMap.set(log.entityId, item);
      }
    }

    // Fallback reconstruction for any referenced ID still not found
    for (const pid of missingProductIds) {
      if (!productMap.has(pid)) {
        const sm = movements.find((m) => m.productId === pid);
        const soItem = sales.flatMap((s) => s.items || []).find((i) => i.productId === pid);
        const poItem = purchases.flatMap((p) => p.items || []).find((i) => i.productId === pid);
        const cyl = cylinders.find((c) => c.productId === pid);
        const name = sm?.productName || soItem?.productName || poItem?.productName || `Product ${pid}`;
        const nameKey = name.trim().toLowerCase();
        const codeKey = pid.trim().toLowerCase();
        if (existingNames.has(nameKey) || existingCodes.has(codeKey)) {
          continue;
        }
        const isCyl = Boolean(cyl) || sm?.productType === "cylinder" || soItem?.itemType === "cylinder";

        productMap.set(pid, {
          id: pid,
          code: pid.toUpperCase(),
          name,
          productType: (sm?.productType as ProductType) || (soItem?.itemType as ProductType) || (isCyl ? "cylinder" : "product"),
          uom: (cyl ? "cyl" : isCyl ? "cyl" : "pcs") as any,
          category: cyl?.gasCategory || "General",
          stock: 0,
          cost: sm?.unitCost || poItem?.price || 0,
          price: soItem?.price || 0,
          reorderLevel: 0,
          createdAt: now,
        });
      }
    }
  }

  const allProducts = Array.from(productMap.values());

  const deductedSoIds = new Set(
    movements
      .filter((m) => m.refType === "sales" && m.type === "out" && m.refId)
      .map((m) => m.refId as string),
  );

  const gasList: GasInventory[] = [];
  const cylinderList: CylinderInventory[] = [];
  const productList: ProductInventory[] = [];

  for (const p of allProducts) {
    const pType = resolveProductType(p);
    const pMoves = movements.filter((m) => m.productId === p.id);

    // Identify opening stock
    const initMove = pMoves.find(
      (m) =>
        m.refType === "adjustment" &&
        (m.refId?.startsWith("INIT-") || /initial/i.test(m.notes || "")),
    );
    const openingStock =
      initMove?.quantity ??
      KNOWN_OPENING_STOCKS[p.id] ??
      (p.openingStock != null ? Number(p.openingStock) : 0);

    // Calculate Stock In: valid receipts + valid returns + valid adjustment-in (excluding initial opening)
    let stockIn = 0;
    let stockOut = 0;

    for (const m of pMoves) {
      if (m.id === initMove?.id) continue; // opening handled separately
      const qty = Number(m.quantity) || 0;
      if (qty <= 0) continue;
      if (m.refType === "refill") continue;

      const isReverse = /Reverse/i.test(m.notes || "");
      if (isReverse) {
        if ((m.refType === "sales" || m.refType === "delivery") && (m.type === "in" || m.type === "return")) {
          stockOut = Math.max(0, stockOut - qty);
          continue;
        }
        if (m.refType === "purchase" && m.type === "out") {
          stockIn = Math.max(0, stockIn - qty);
          continue;
        }
      }

      const isIn =
        m.type === "in" ||
        m.direction === "in" ||
        m.type === "return" ||
        m.movementType === "RECEIPT" ||
        m.movementType === "PURCHASE_RECEIVED" ||
        m.movementType === "ADJUSTMENT_IN" ||
        m.movementType === "RETURN" ||
        m.movementType === "SALES_RETURN";

      const isOut =
        m.type === "out" ||
        m.direction === "out" ||
        m.movementType === "SALE_ISSUE" ||
        m.movementType === "ADJUSTMENT_OUT" ||
        m.movementType === "DAMAGE" ||
        m.movementType === "LOSS" ||
        m.movementType === "PURCHASE_RETURN";

      if (isIn) {
        stockIn += qty;
      } else if (isOut) {
        stockOut += qty;
      }
    }

    // FORMULA: ON HAND = OPENING STOCK + STOCK IN - STOCK OUT
    const onHand = Math.max(0, openingStock + stockIn - stockOut);
    const unitPrice = Number(p.price) || 0;
    const costPrice = Number(p.cost) || 0;
    const totalValue = onHand * (costPrice > 0 ? costPrice : unitPrice);

    const cylsForP = cylinders.filter((c) => c.productId === p.id && !isInactiveCompanyCylinder(c));
    const effectiveStock =
      pType === "cylinder" && cylsForP.length > 0
        ? cylsForP.filter(cylinderIsFullStock).length
        : onHand;

    // Ensure product master collection has this product and synchronized stock
    if (!productsTableIdSet.has(p.id)) {
      await db.collection("products").insertOne(
        {
          id: p.id,
          code: p.code || p.id.toUpperCase(),
          name: p.name,
          category: p.category || (pType === "cylinder" ? "Cylinder" : pType === "gas" ? "Gas" : "General"),
          productType: pType,
          uom: p.uom || (pType === "cylinder" ? "cyl" : pType === "gas" ? "kg" : "pcs"),
          price: unitPrice,
          cost: costPrice,
          stock: effectiveStock,
          reorderLevel: 0,
          costingMethod: "fifo",
          createdAt: now,
        },
        opt,
      );
      productsTableIdSet.add(p.id);
    } else if (p.stock !== effectiveStock || p.productType !== pType) {
      await db.collection("products").updateOne(
        { id: p.id },
        { $set: { stock: effectiveStock, productType: pType } },
        opt,
      );
    }

    if (pType === "gas") {
      const gasRow: GasInventory = {
        id: `gas-${p.id}`,
        productId: p.id,
        productName: p.name,
        productType: "gas",
        uom: p.uom || "kg",
        openingStock,
        stockIn,
        stockOut,
        onHand,
        unitPrice,
        costPrice,
        totalValue,
        updatedAt: now,
      };
      gasList.push(gasRow);
      await db.collection("gasInventory").updateOne(
        { productId: p.id },
        { $set: gasRow },
        { upsert: true, ...opt },
      );
    } else if (pType === "cylinder") {
      const reserved = computeReservedQty(p.id, sales, deliveries, deductedSoIds);
      const effectiveOnHand = cylsForP.length > 0 ? cylsForP.filter(cylinderIsFullStock).length : onHand;
      // AVAILABLE = ON HAND - RESERVED (available cannot be negative)
      const available = Math.max(0, effectiveOnHand - reserved);
      const cylRow: CylinderInventory = {
        id: `cyl-${p.id}`,
        productId: p.id,
        productName: p.name,
        productType: "cylinder",
        uom: p.uom || "cyl",
        openingStock,
        stockIn,
        stockOut,
        reserved,
        available,
        onHand: effectiveOnHand,
        unitPrice,
        costPrice,
        totalValue: effectiveOnHand * (costPrice > 0 ? costPrice : unitPrice),
        updatedAt: now,
      };
      cylinderList.push(cylRow);
      await db.collection("cylinderInventory").updateOne(
        { productId: p.id },
        { $set: cylRow },
        { upsert: true, ...opt },
      );
    } else {
      const displayStockIn = openingStock > 0 && stockIn === 0 ? openingStock : stockIn;
      const prodRow: ProductInventory = {
        id: `prod-${p.id}`,
        productId: p.id,
        productName: p.name,
        productType: "product",
        uom: p.uom || "pcs",
        openingStock,
        stockIn: displayStockIn,
        stockOut,
        onHand,
        unitPrice,
        costPrice,
        totalValue,
        updatedAt: now,
      };
      productList.push(prodRow);
      await db.collection("productInventory").updateOne(
        { productId: p.id },
        { $set: prodRow },
        { upsert: true, ...opt },
      );
    }
  }

  const gasProductIds = gasList.map((g) => g.productId);
  const cylProductIds = cylinderList.map((c) => c.productId);
  const prodProductIds = productList.map((p) => p.productId);

  await Promise.all([
    db.collection("gasInventory").deleteMany({ productId: { $nin: gasProductIds } }, opt),
    db.collection("cylinderInventory").deleteMany({ productId: { $nin: cylProductIds } }, opt),
    db.collection("productInventory").deleteMany({ productId: { $nin: prodProductIds } }, opt),
  ]);

  const totals = {
    gasOnHand: gasList.reduce((sum, g) => sum + g.onHand, 0),
    cylinderOnHand: cylinderList.reduce((sum, c) => sum + c.onHand, 0),
    cylinderReserved: cylinderList.reduce((sum, c) => sum + c.reserved, 0),
    cylinderAvailable: cylinderList.reduce((sum, c) => sum + c.available, 0),
    productOnHand: productList.reduce((sum, p) => sum + p.onHand, 0),
    totalValue:
      gasList.reduce((sum, g) => sum + g.totalValue, 0) +
      cylinderList.reduce((sum, c) => sum + c.totalValue, 0) +
      productList.reduce((sum, p) => sum + p.totalValue, 0),
  };

  return {
    gas: gasList,
    cylinders: cylinderList,
    products: productList,
    totals,
  };
}

/**
 * Idempotently post purchase receiving to the correct inventory type.
 */
export async function postPurchaseReceiptToInventory(
  db: any,
  session: any,
  po: PurchaseOrder,
  grnNo: string,
  receivedItems: Array<{ productId: string; quantity: number; price?: number }>,
  by = "Warehouse",
) {
  const opt = session ? { session } : {};
  const now = new Date().toISOString();

  for (const item of receivedItems) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    // Idempotency: verify if this exact receipt (po.id + grnNo + productId) was already posted
    const existing = await db.collection("stockMovements").findOne(
      {
        refType: "purchase",
        refId: po.id,
        productId: item.productId,
        type: "in",
        notes: { $regex: new RegExp(grnNo, "i") },
      },
      opt,
    );
    if (existing) continue; // Already posted, skip

    const pDoc = await db.collection("products").findOne({ id: item.productId }, opt);
    if (!pDoc) continue;
    const product: Product = clean(pDoc);
    const pType = resolveProductType(product);
    const cost = Number.isFinite(item.price) ? Number(item.price) : Number(product.cost || 0);

    const prevStock = Number(product.stock) || 0;
    const newStock = prevStock + qty;

    // Create auditable StockMovement
    const movement: StockMovement = {
      id: newId("rec"),
      movementId: newId("mov"),
      date: now,
      productId: product.id,
      productName: product.name,
      productType: pType,
      type: "in",
      movementType: "PURCHASE_RECEIVED",
      direction: "in",
      quantity: qty,
      previousBalance: prevStock,
      balanceAfter: newStock,
      newBalance: newStock,
      unitCost: cost,
      totalCost: qty * cost,
      cogsAmount: qty * cost,
      costingMethod: product.costingMethod || "fifo",
      refType: "purchase",
      refId: po.id,
      sourceType: "purchase_order",
      sourceId: po.id,
      notes: `${po.orderNo} (GRN ${grnNo})`,
      by,
    };
    await db.collection("stockMovements").insertOne(movement, opt);

    // Update Product Master
    await db
      .collection("products")
      .updateOne({ id: product.id }, { $set: { stock: newStock } }, opt);

    // Update dedicated inventory table with atomic separation
    if (pType === "gas") {
      await db.collection("gasInventory").updateOne(
        { productId: product.id },
        {
          $inc: { stockIn: qty, onHand: qty },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );
    } else if (pType === "cylinder") {
      await db.collection("cylinderInventory").updateOne(
        { productId: product.id },
        {
          $inc: { stockIn: qty, onHand: qty, available: qty },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );
    } else {
      await db.collection("productInventory").updateOne(
        { productId: product.id },
        {
          $inc: { stockIn: qty, onHand: qty },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );
    }
  }
}

/**
 * Idempotently post sales order stock issue with strict inventory separation.
 */
export async function postSaleIssueToInventory(
  db: any,
  session: any,
  so: SalesOrder,
  items: LineItem[],
  by = "Sales",
) {
  const opt = session ? { session } : {};
  const now = new Date().toISOString();

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;

    // Idempotency: verify if this exact sale issue was already posted
    const existing = await db.collection("stockMovements").findOne(
      {
        refType: "sales",
        refId: so.id,
        productId: item.productId,
        type: "out",
      },
      opt,
    );
    if (existing) continue; // Already posted, skip

    const pDoc = await db.collection("products").findOne({ id: item.productId }, opt);
    if (!pDoc) throw new Error(`Product not found: ${item.productId}`);
    const product: Product = clean(pDoc);

    // Resolve item type: item explicitly selected in UI takes precedence, otherwise product type
    const itemType: ProductType =
      item.itemType === "cylinder" || item.itemType === "gas" || item.itemType === "product"
        ? item.itemType
        : resolveProductType(product);

    // Stock validation against authoritative inventory
    let currentStock = Number(product.stock) || 0;
    if (itemType === "cylinder") {
      const cylInv = await db.collection("cylinderInventory").findOne({ productId: product.id }, opt);
      if (cylInv) {
        currentStock = Number(cylInv.onHand) || 0;
      }
    } else if (itemType === "gas") {
      const gasInv = await db.collection("gasInventory").findOne({ productId: product.id }, opt);
      if (gasInv) {
        currentStock = Number(gasInv.onHand) || 0;
      }
    } else {
      const prodInv = await db.collection("productInventory").findOne({ productId: product.id }, opt);
      if (prodInv) {
        currentStock = Number(prodInv.onHand) || 0;
      }
    }

    if (currentStock < qty) {
      throw new Error(
        `Insufficient stock for ${product.name} (${itemType.toUpperCase()}). Available on hand: ${currentStock}, Requested: ${qty}.`,
      );
    }

    const newStock = currentStock - qty;
    const unitCost = Number(product.cost) || 0;

    // Create auditable StockMovement
    const movement: StockMovement = {
      id: newId("sale"),
      movementId: newId("mov"),
      date: now,
      productId: product.id,
      productName: product.name,
      productType: itemType,
      type: "out",
      movementType: "SALE_ISSUE",
      direction: "out",
      quantity: qty,
      previousBalance: currentStock,
      balanceAfter: newStock,
      newBalance: newStock,
      unitCost,
      totalCost: qty * unitCost,
      cogsAmount: qty * unitCost,
      costingMethod: product.costingMethod || "fifo",
      refType: "sales",
      refId: so.id,
      sourceType: "sales_order",
      sourceId: so.id,
      notes: so.orderNo,
      by,
    };
    await db.collection("stockMovements").insertOne(movement, opt);

    // Update Product Master
    await db
      .collection("products")
      .updateOne({ id: product.id }, { $set: { stock: newStock } }, opt);

    // Update the SPECIFIC inventory structure ONLY — STRICT ISOLATION
    if (itemType === "gas") {
      await db.collection("gasInventory").updateOne(
        { productId: product.id },
        {
          $inc: { stockOut: qty, onHand: -qty },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );
    } else if (itemType === "cylinder") {
      await db.collection("cylinderInventory").updateOne(
        { productId: product.id },
        {
          $inc: { stockOut: qty, onHand: -qty, available: -qty },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );
    } else {
      await db.collection("productInventory").updateOne(
        { productId: product.id },
        {
          $inc: { stockOut: qty, onHand: -qty },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );
    }
  }
}

/**
 * Reverse a sales order stock issue (e.g. on order cancellation, deletion, or quantity edit).
 */
export async function reverseSaleIssueFromInventory(
  db: any,
  session: any,
  soId: string,
  by = "Sales",
) {
  const opt = session ? { session } : {};
  const now = new Date().toISOString();

  const outMoves = await db
    .collection("stockMovements")
    .find({ refType: "sales", refId: soId, type: "out" }, opt)
    .toArray();

  for (const m of outMoves) {
    const qty = Number(m.quantity) || 0;
    if (qty <= 0) continue;

    // Check if already reversed
    const alreadyReversed = await db.collection("stockMovements").findOne(
      {
        refType: "sales",
        refId: soId,
        productId: m.productId,
        type: "in",
        notes: { $regex: /Reverse/i },
      },
      opt,
    );
    if (alreadyReversed) continue;

    const pDoc = await db.collection("products").findOne({ id: m.productId }, opt);
    if (!pDoc) continue;
    const product: Product = clean(pDoc);
    const pType = (m.productType as ProductType) || resolveProductType(product);
    const currentStock = Number(product.stock) || 0;
    const newStock = currentStock + qty;

    const revMove: StockMovement = {
      id: newId("rev"),
      movementId: newId("mov"),
      date: now,
      productId: product.id,
      productName: product.name,
      productType: pType,
      type: "in",
      movementType: "SALES_RETURN",
      direction: "in",
      quantity: qty,
      previousBalance: currentStock,
      balanceAfter: newStock,
      newBalance: newStock,
      unitCost: m.unitCost || 0,
      totalCost: qty * (m.unitCost || 0),
      cogsAmount: qty * (m.unitCost || 0),
      costingMethod: product.costingMethod || "fifo",
      refType: "sales",
      refId: soId,
      sourceType: "sales_order",
      sourceId: soId,
      notes: `Reverse ${m.notes || soId}`,
      by,
    };
    await db.collection("stockMovements").insertOne(revMove, opt);

    await db
      .collection("products")
      .updateOne({ id: product.id }, { $set: { stock: newStock } }, opt);

    if (pType === "gas") {
      await db.collection("gasInventory").updateOne(
        { productId: product.id },
        {
          $inc: { stockOut: -qty, onHand: qty },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );
    } else if (pType === "cylinder") {
      await db.collection("cylinderInventory").updateOne(
        { productId: product.id },
        {
          $inc: { stockOut: -qty, onHand: qty, available: qty },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );
    } else {
      await db.collection("productInventory").updateOne(
        { productId: product.id },
        {
          $inc: { stockOut: -qty, onHand: qty },
          $set: { updatedAt: now },
        },
        { upsert: true, ...opt },
      );
    }
  }
}
