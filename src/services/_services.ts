import type {
  Customer,
  Supplier,
  Product,
  Cylinder,
  CylinderMovement,
  CylinderStatus,
  CylinderFillLevel,
  SalesOrder,
  SalesStatus,
  Delivery,
  StockAlert,
  DashboardStats,
  LineItem,
  Expense,
  LedgerEntry,
  PaymentMethod,
  PurchaseOrder,
  PurchaseStatus,
  StockMovement,
  MovementTypeKind,
  Voucher,
  VoucherType,
  Employee,
  PayrollRun,
  Account,
  ChartOfAccount,
  BusinessAsset,
  CostLayer,
  CostingMethod,
  LayerConsumption,
  JournalLine,
  ProductCategory,
  ProductType,
  GasInventory,
  CylinderInventory,
  ProductInventory,
  InventorySummary,
} from "@/types";
import { crudFn, dashboardFn, notificationsFn } from "@/lib/data.functions";
import { updateProductFn } from "@/lib/products.functions";
import { getCylinderTrackingFn } from "@/lib/settings.functions";
import { receivePurchaseFn } from "@/lib/purchase.functions";
import {
  getGasInventoryFn,
  getCylinderInventoryFn,
  getProductInventoryFn,
  getInventorySummaryFn,
  reconcileInventoryDbFn,
} from "@/lib/inventory.functions";
import { genOrderNo } from "@/utils/helpers";
import {
  cylinderIsEmpty,
  cylinderIsFullStock,
  isCylinderProduct,
  isCylinderSaleLine,
  isCylinderTrackedLine,
  pickFifo,
  suggestSerials,
} from "@/lib/cylinder-product";
import { remainingOrderQty, buildProductInventory } from "@/lib/cylinder-inventory";
import { issueLockIsActive } from "@/lib/cylinder-lock";
import {
  reconcileQuantityWithSerials,
  type SerialReconciliationItem,
  type StockMeta,
} from "@/lib/inventory-engine";

const call = async <T>(op: any, coll: any, id?: string, payload?: any): Promise<T> => {
  return (await crudFn({ data: { op, coll, id, payload } })) as T;
};

function resolveProductType(
  p: Pick<Product, "productType" | "uom" | "category" | "name"> | null | undefined,
): ProductType {
  if (!p) return "gas";
  const uom = String(p.uom || "").toLowerCase();
  if (uom === "cyl") return "cylinder";
  if (uom === "pcs") return "product";
  if (p.productType === "cylinder" || p.productType === "gas" || p.productType === "product") {
    return p.productType;
  }
  if (uom === "kg" || uom === "ltr") return "gas";
  const cat = String(p.category || "").toLowerCase();
  if (cat.includes("cylinder") || cat === "cylinder") return "cylinder";
  return "gas";
}

async function takeWarehouseFull(productId: string, qty: number, lotNumber?: string) {
  const method = await getCylinderTrackingFn();
  const product = await call<Product | null>("get", "products", productId);
  if (!product) throw new Error("Product not found");
  if (method === "lot" && !lotNumber?.trim()) throw new Error("Lot number required");
  const allCyl = await call<Cylinder[]>("list", "cylinders");
  const hasSerials = allCyl.some((c) => c.productId === productId);
  if (!hasSerials) return [];
  const pool = allCyl
    .filter(
      (c) =>
        c.productId === productId &&
        cylinderIsFullStock(c) &&
        c.ownedBy !== "customer" &&
        !issueLockIsActive(c.issueLock) &&
        (!lotNumber || c.lotNumber === lotNumber),
    )
    .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt));
  if (pool.length < qty) {
    const lotNote = lotNumber ? ` in lot ${lotNumber}` : "";
    throw new Error(
      `Insufficient company-owned cylinder quantity${lotNote}. Available: ${pool.length}, Requested: ${qty}. Please add stock first.`,
    );
  }
  const chosen = pool.slice(0, qty);
  await claimCylinderIds(
    chosen.map((c) => c.id),
    ["in_stock", "in_transit"],
  );
  return chosen;
}

async function releaseIssueLocks(ids: string[]) {
  for (const id of ids) {
    try {
      await call("update", "cylinders", id, { issueLock: null });
    } catch {
      /* keep trying */
    }
  }
}

async function claimCylinderIds(ids: string[], statuses: Cylinder["status"][]) {
  const claimed: string[] = [];
  for (const id of ids) {
    try {
      await call("claim", "cylinders", id, { statuses });
      claimed.push(id);
    } catch {
      await releaseIssueLocks(claimed);
      throw new Error("Cylinder is no longer available. Another transaction may have issued it.");
    }
  }
}

async function afterCylinderClaim<T>(ids: string[], work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    await releaseIssueLocks(ids);
    throw err;
  }
}

function lastCustomerPurpose(
  movements: CylinderMovement[],
  cylinderId: string,
  customerId: string,
) {
  return movements
    .filter((m) => m.cylinderId === cylinderId && m.customerId === customerId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .at(-1)?.purpose;
}

async function postStockMovement(data: Omit<StockMovement, "id">) {
  return call<StockMovement>("create", "stockMovements", undefined, data);
}

function productMethod(p: Product): CostingMethod {
  return p.costingMethod === "lifo" || p.costingMethod === "average" ? p.costingMethod : "fifo";
}

async function listOpenLayers(productId: string): Promise<CostLayer[]> {
  const all = await call<CostLayer[]>("list", "costLayers");
  return all.filter((l) => l.productId === productId && (l.qtyRemaining || 0) > 0);
}

async function remainingValue(
  productId: string,
): Promise<{ qty: number; value: number; avg: number }> {
  const layers = await listOpenLayers(productId);
  const qty = layers.reduce((a, l) => a + l.qtyRemaining, 0);
  const value = layers.reduce((a, l) => a + l.qtyRemaining * (l.unitCost || 0), 0);
  return { qty, value, avg: qty > 0 ? value / qty : 0 };
}

async function ensureOpeningLayer(product: Product) {
  const open = await listOpenLayers(product.id);
  const layerQty = open.reduce((a, l) => a + l.qtyRemaining, 0);
  const stock = product.stock ?? 0;
  if (stock > 0 && layerQty <= 0) {
    await call("create", "costLayers", undefined, {
      productId: product.id,
      qtyRemaining: stock,
      unitCost: product.cost ?? 0,
      receivedAt: product.createdAt || new Date().toISOString(),
      refType: "adjustment",
    });
  }
}

async function consumeLayers(
  productId: string,
  qty: number,
  method: "fifo" | "lifo",
): Promise<LayerConsumption[]> {
  const layers = await listOpenLayers(productId);
  layers.sort((a, b) => {
    const ta = new Date(a.receivedAt).getTime();
    const tb = new Date(b.receivedAt).getTime();
    return method === "fifo" ? ta - tb : tb - ta;
  });
  let need = qty;
  const consumptions: LayerConsumption[] = [];
  for (const layer of layers) {
    if (need <= 0) break;
    const take = Math.min(layer.qtyRemaining, need);
    await call("update", "costLayers", layer.id, { qtyRemaining: layer.qtyRemaining - take });
    consumptions.push({ layerId: layer.id, qty: take, unitCost: layer.unitCost || 0 });
    need -= take;
  }
  if (need > 0) {
    consumptions.push({ layerId: "", qty: need, unitCost: 0 });
  }
  return consumptions;
}

async function receiveStock(productId: string, qty: number, unitCost: number, meta?: StockMeta) {
  const product = await call<Product | null>("get", "products", productId);
  if (!product || qty <= 0) return;
  if (
    meta?.refType &&
    meta?.refId &&
    (await hasPostedStock(meta.refType, meta.refId, productId, "in"))
  )
    return;
  await ensureOpeningLayer(product);
  const cost = Number.isFinite(unitCost) ? unitCost : (product.cost ?? 0);
  await call("create", "costLayers", undefined, {
    productId: product.id,
    qtyRemaining: qty,
    unitCost: cost,
    receivedAt: meta?.date || new Date().toISOString(),
    refType: meta?.refType,
    refId: meta?.refId,
  });
  const oldStock = product.stock ?? 0;
  const oldCost = product.cost ?? cost;
  const nextStock = oldStock + qty;
  const method = productMethod(product);
  let nextCost: number;
  if (method === "average") {
    nextCost = nextStock > 0 ? (oldStock * oldCost + qty * cost) / nextStock : cost;
  } else {
    const leftover = await remainingValue(product.id);
    nextCost = leftover.avg || cost;
  }
  const pType: ProductType = resolveProductType(product);

  await call("update", "products", product.id, { stock: nextStock, cost: nextCost });
  await postStockMovement({
    date: meta?.date || new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    productType: pType,
    type: "in",
    movementType:
      meta?.movementType ||
      (meta?.refType === "purchase"
        ? "PURCHASE_RECEIVED"
        : meta?.refType === "adjustment"
          ? "ADJUSTMENT_IN"
          : "RECEIPT"),
    direction: "in",
    quantity: qty,
    previousBalance: oldStock,
    balanceAfter: nextStock,
    newBalance: nextStock,
    unitCost: cost,
    totalCost: qty * cost,
    cogsAmount: qty * cost,
    costingMethod: method,
    refType: meta?.refType,
    refId: meta?.refId,
    sourceType: meta?.refType,
    sourceId: meta?.refId,
    notes: meta?.notes,
    by: meta?.by ?? "System",
  });
}

async function issueStock(productId: string, qty: number, meta?: StockMeta) {
  const product = await call<Product | null>("get", "products", productId);
  if (!product || qty <= 0) return;
  if (
    meta?.refType &&
    meta?.refId &&
    (await hasPostedStock(meta.refType, meta.refId, productId, "out"))
  )
    return;
  await ensureOpeningLayer(product);
  const available = product.stock ?? 0;
  if (available < qty) {
    throw new Error(`Insufficient stock. Available: ${available}, Requested: ${qty}.`);
  }
  const take = qty;
  const method = productMethod(product);
  let consumptions: LayerConsumption[];
  let unitCost: number;
  let cogsAmount: number;
  if (method === "average") {
    unitCost = product.cost ?? 0;
    cogsAmount = take * unitCost;
    consumptions = await consumeLayers(product.id, take, "fifo");
  } else {
    consumptions = await consumeLayers(product.id, take, method);
    cogsAmount = consumptions.reduce((a, c) => a + c.qty * c.unitCost, 0);
    unitCost = take > 0 ? cogsAmount / take : 0;
  }
  const nextStock = available - take;
  const leftover = await remainingValue(product.id);
  const pType: ProductType = resolveProductType(product);

  await call("update", "products", product.id, {
    stock: nextStock,
    cost: method === "average" ? (nextStock > 0 ? (product.cost ?? 0) : 0) : leftover.avg,
  });
  await postStockMovement({
    date: meta?.date || new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    productType: pType,
    type: "out",
    movementType:
      meta?.movementType ||
      (meta?.refType === "sales"
        ? "SALE_ISSUE"
        : meta?.refType === "adjustment"
          ? "ADJUSTMENT_OUT"
          : "SALE_ISSUE"),
    direction: "out",
    quantity: take,
    previousBalance: available,
    balanceAfter: nextStock,
    newBalance: nextStock,
    unitCost,
    totalCost: cogsAmount,
    cogsAmount,
    costingMethod: method,
    consumptions,
    refType: meta?.refType,
    refId: meta?.refId,
    sourceType: meta?.refType,
    sourceId: meta?.refId,
    notes: meta?.notes,
    by: meta?.by ?? "System",
  });
}

async function restoreStock(
  productId: string,
  qty: number,
  meta?: StockMeta,
  fallbackUnitCost?: number,
) {
  const product = await call<Product | null>("get", "products", productId);
  if (!product || qty <= 0) return;
  let consumptions: LayerConsumption[] | undefined;
  if (meta?.refId) {
    const moves = await call<StockMovement[]>("list", "stockMovements");
    const out = moves
      .filter(
        (m) =>
          m.productId === productId &&
          m.refType === meta.refType &&
          m.refId === meta.refId &&
          m.type === "out",
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    consumptions = out?.consumptions;
    if (fallbackUnitCost == null && out?.unitCost != null) fallbackUnitCost = out.unitCost;
  }
  if (consumptions?.length) {
    for (const c of consumptions) {
      await call("create", "costLayers", undefined, {
        productId,
        qtyRemaining: c.qty,
        unitCost: c.unitCost,
        receivedAt: new Date().toISOString(),
        refType: meta?.refType,
        refId: meta?.refId,
      });
    }
  } else {
    await call("create", "costLayers", undefined, {
      productId,
      qtyRemaining: qty,
      unitCost: fallbackUnitCost ?? product.cost ?? 0,
      receivedAt: new Date().toISOString(),
      refType: meta?.refType,
      refId: meta?.refId,
    });
  }
  const nextStock = (product.stock ?? 0) + qty;
  const leftover = await remainingValue(productId);
  await call("update", "products", product.id, { stock: nextStock, cost: leftover.avg });
  const pType: ProductType = resolveProductType(product);
  await postStockMovement({
    date: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    productType: pType,
    type: "in",
    quantity: qty,
    balanceAfter: nextStock,
    unitCost: leftover.avg,
    costingMethod: productMethod(product),
    refType: meta?.refType,
    refId: meta?.refId,
    notes: meta?.notes,
    by: meta?.by ?? "System",
  });
}

async function hasPostedStock(
  refType: NonNullable<StockMovement["refType"]>,
  refId: string,
  productId: string,
  type: "in" | "out",
) {
  const all = await call<StockMovement[]>("list", "stockMovements");
  if (type === "out") {
    const outQty = all
      .filter(
        (m) =>
          m.refType === refType &&
          m.refId === refId &&
          m.productId === productId &&
          m.type === "out",
      )
      .reduce((sum, m) => sum + (Number(m.quantity) || 0), 0);
    const revInQty = all
      .filter(
        (m) =>
          m.refType === refType &&
          m.refId === refId &&
          m.productId === productId &&
          (m.type === "in" || m.type === "return") &&
          /Reverse/i.test(m.notes || ""),
      )
      .reduce((sum, m) => sum + (Number(m.quantity) || 0), 0);
    return outQty - revInQty > 0;
  }
  return all.some(
    (m) =>
      m.refType === refType && m.refId === refId && m.productId === productId && m.type === type,
  );
}

async function hasStockOut(refType: NonNullable<StockMovement["refType"]>, refId: string) {
  const all = await call<StockMovement[]>("list", "stockMovements");
  return all.some((m) => m.refType === refType && m.refId === refId && m.type === "out");
}

async function hasStockIn(refType: NonNullable<StockMovement["refType"]>, refId: string) {
  const all = await call<StockMovement[]>("list", "stockMovements");
  return all.some(
    (m) => m.refType === refType && m.refId === refId && (m.type === "in" || m.type === "return"),
  );
}

function productStockLines(items: LineItem[], products: Product[], treatAllAsGas: boolean) {
  return items.filter((item) => {
    if (!(Number(item.quantity) > 0)) return false;
    if (treatAllAsGas) return true;
    const p = products.find((x) => x.id === item.productId);
    if (!isCylinderTrackedLine(item, p)) return true;
    return isCylinderSaleLine(item, p);
  });
}

async function reversePostedStock(
  refType: NonNullable<StockMovement["refType"]>,
  refId: string,
  notes: string,
  by: string,
) {
  const all = await call<StockMovement[]>("list", "stockMovements");
  if (
    all.some(
      (m) =>
        m.refType === refType &&
        m.refId === refId &&
        (m.type === "in" || m.type === "return") &&
        /Reverse/i.test(m.notes || ""),
    )
  )
    return;
  const outs = all.filter((m) => m.refType === refType && m.refId === refId && m.type === "out");
  for (const m of outs) {
    await restoreStock(m.productId, m.quantity, { refType, refId, notes, by }, m.unitCost);
  }
}

async function assertSalesStock(
  items: LineItem[],
  opts?: { sellGasOnly?: boolean; excludeOrderId?: string },
) {
  const [products, sales, deliveries, movements, cylinders] = await Promise.all([
    call<Product[]>("list", "products"),
    call<SalesOrder[]>("list", "sales"),
    call<Delivery[]>("list", "deliveries"),
    call<StockMovement[]>("list", "stockMovements"),
    call<Cylinder[]>("list", "cylinders"),
  ]);

  const relevantSales = opts?.excludeOrderId
    ? sales.filter((s) => s.id !== opts.excludeOrderId)
    : sales;

  const stockRows = buildProductInventory(products, cylinders, relevantSales, deliveries, movements);

  let existingOrderItems: LineItem[] = [];
  let existingOrderAlreadyOut = false;
  if (opts?.excludeOrderId) {
    const existingOrder = sales.find((s) => s.id === opts.excludeOrderId);
    if (existingOrder && isOpenSalesStatus(existingOrder.status)) {
      existingOrderItems = existingOrder.items || [];
      existingOrderAlreadyOut = await hasStockOut("sales", opts.excludeOrderId);
    }
  }

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const p = products.find((x) => x.id === item.productId);
    if (!p) throw new Error(`Product not found (${item.productId})`);

    const row = stockRows.find((r) => r.productId === item.productId);
    const baseAvail = opts?.sellGasOnly
      ? Math.max(0, p.stock ?? 0)
      : (row?.available ?? p.stock ?? 0);

    const heldByThisOrder = existingOrderAlreadyOut
      ? existingOrderItems
          .filter((it) => it.productId === item.productId)
          .reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
      : 0;

    const available = Math.max(0, baseAvail + heldByThisOrder);
    if (qty > available) {
      throw new Error(`Insufficient stock for ${p.name}. Available: ${available}, Requested: ${qty}.`);
    }
  }
}

function isOpenSalesStatus(status: SalesStatus) {
  return status === "confirmed" || status === "invoiced" || status === "paid";
}

function defaultExpectedReturnAt() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

async function gasLineItems(items: LineItem[]) {
  const products = await call<Product[]>("list", "products");
  return items.filter(
    (item) =>
      !isCylinderTrackedLine(
        item,
        products.find((p) => p.id === item.productId),
      ),
  );
}

async function hasCylinderLines(items: LineItem[]) {
  const products = await call<Product[]>("list", "products");
  return items.some((item) =>
    isCylinderTrackedLine(
      item,
      products.find((p) => p.id === item.productId),
    ),
  );
}

async function deliveredForSales(salesOrderId: string, excludeDeliveryId?: string) {
  const deliveries = await call<Delivery[]>("list", "deliveries");
  return deliveries.filter(
    (d) =>
      d.salesOrderId === salesOrderId &&
      d.id !== excludeDeliveryId &&
      (d.status === "delivered" || d.status === "confirmed"),
  );
}

async function salesAlreadyFulfilled(order: SalesOrder, excludeDeliveryId?: string) {
  const delivered = await deliveredForSales(order.id, excludeDeliveryId);
  if (delivered.length === 0) return false;
  return order.items.every((item) => remainingOrderQty(order, delivered, item.productId) <= 0);
}

async function fulfillSalesOrder(order: SalesOrder) {
  if (!isOpenSalesStatus(order.status)) return;
  if (await salesAlreadyFulfilled(order)) return;
  const deliveries = await call<Delivery[]>("list", "deliveries");
  const open = deliveries.find(
    (d) => d.salesOrderId === order.id && (d.status === "pending" || d.status === "in_transit"),
  );
  if (open) return;
  await call<Delivery>("create", "deliveries", undefined, {
    challanNo: genOrderNo("DC"),
    salesOrderId: order.id,
    customerId: order.customerId,
    customerName: order.customerName,
    driverName: order.driverName || "",
    vehicleNo: "",
    items: order.items,
    status: "pending",
    date: order.date || new Date().toISOString(),
    receiverName: order.receiverName,
  });
}

async function unfulfillSalesOrder(order: SalesOrder) {
  const deliveries = await call<Delivery[]>("list", "deliveries");
  const linked = deliveries.filter((d) => d.salesOrderId === order.id);
  for (const d of linked) {
    if (d.status === "pending" || d.status === "in_transit") {
      await call("remove", "deliveries", d.id);
      continue;
    }
    if (d.status !== "delivered" && d.status !== "confirmed") continue;
    if (await hasStockOut("delivery", d.id)) {
      await reversePostedStock("delivery", d.id, `Reverse ${d.challanNo}`, "Sales");
    }
    for (const item of d.items) {
      for (const cid of item.cylinderIds || []) {
        await cylinderService.addMovement({
          cylinderId: cid,
          type: "received",
          customerId: d.customerId,
          fromLocation: d.customerName,
          toLocation: "Warehouse",
          notes: `Reverse ${d.challanNo}`,
          by: "Sales",
          sold: false,
        });
      }
    }
    await call("update", "deliveries", d.id, { status: "returned" });
  }
  if (await hasStockOut("sales", order.id)) {
    await reversePostedStock("sales", order.id, `Reverse ${order.orderNo}`, "Sales");
  }
}

async function hasReservation(orderId: string) {
  const all = await call<StockMovement[]>("list", "stockMovements");
  return all.some(
    (m) => m.refType === "sales" && m.refId === orderId && /^Reserved\b/i.test(m.notes || ""),
  );
}

async function postReservationMoves(order: SalesOrder, verb: "Reserved" | "Reservation released") {
  if (verb === "Reserved" && (await hasReservation(order.id))) return;
  const products = await call<Product[]>("list", "products");
  const byId = new Map(products.map((p) => [p.id, p]));
  await Promise.all(
    order.items.map((item) => {
      const product = byId.get(item.productId);
      return call("create", "stockMovements", undefined, {
        date: new Date().toISOString(),
        productId: item.productId,
        productName: item.productName,
        type: verb === "Reserved" ? "adjust" : "return",
        quantity: item.quantity,
        balanceAfter: product?.stock ?? 0,
        refType: "sales",
        refId: order.id,
        notes: `${verb} ${item.quantity} × ${item.productName} for ${order.orderNo}`,
        by: order.receiverName || "Sales",
      });
    }),
  );
}

async function adjustStock(items: LineItem[], direction: 1 | -1, meta?: StockMeta) {
  for (const item of items) {
    if (direction < 0) {
      await issueStock(item.productId, item.quantity, meta);
    } else if (meta?.refType === "purchase") {
      await receiveStock(item.productId, item.quantity, item.price, meta);
    } else {
      await restoreStock(item.productId, item.quantity, meta, item.price);
    }
  }
}

function statusFromMovement(type: CylinderMovement["type"]): CylinderStatus {
  switch (type) {
    case "issued":
      return "at_customer";
    case "returned":
      return "in_stock";
    case "received":
    case "refilled":
      return "in_stock";
    case "transferred":
      return "in_transit";
    case "damaged":
      return "damaged";
    case "lost":
      return "lost";
    case "stock_out":
      return "stock_out";
    case "scrapped":
      return "scrapped";
    case "written_off":
      return "written_off";
    default:
      return "in_stock";
  }
}

function fillLevelFromMovement(type: CylinderMovement["type"]): CylinderFillLevel | undefined {
  if (type === "returned") return "empty";
  if (type === "issued" || type === "received" || type === "refilled") return "full";
  return undefined;
}

async function postLedger(entry: Omit<LedgerEntry, "id">) {
  return call<LedgerEntry>("create", "ledger", undefined, entry);
}

function toVoucherDate(date?: string) {
  if (!date) return new Date().toISOString();
  if (date.includes("T")) return new Date(date).toISOString();
  const t = new Date(`${date}T12:00:00`);
  return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
}

function journalPairLines(drAccount?: string, crAccount?: string, amount?: number): JournalLine[] {
  const amt = amount ?? 0;
  if (!drAccount || !crAccount || amt <= 0) return [];
  return [
    { accountId: drAccount, accountName: drAccount, debit: amt, credit: 0 },
    { accountId: crAccount, accountName: crAccount, debit: 0, credit: amt },
  ];
}

function assertJournalLines(raw: JournalLine[]) {
  const lines = raw
    .map((l) => ({
      accountId: String(l.accountId || "").trim(),
      accountName: String(l.accountName || l.accountId || "").trim(),
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      notes: l.notes?.trim() || undefined,
    }))
    .filter((l) => l.accountName && (l.debit > 0 || l.credit > 0));
  if (lines.length < 2) throw new Error("Journal needs at least two lines");
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (line.debit > 0 && line.credit > 0)
      throw new Error("A line cannot have both debit and credit");
    debit += line.debit;
    credit += line.credit;
  }
  if (debit <= 0) throw new Error("Amount must be positive");
  if (Math.abs(debit - credit) > 0.009) throw new Error("Debit and credit must be equal");
  return { total: debit, lines };
}

export const customerService = {
  list: () => call<Customer[]>("list", "customers"),
  get: (id: string) => call<Customer | null>("get", "customers", id),
  create: (data: Omit<Customer, "id" | "createdAt">) =>
    call<Customer>("create", "customers", undefined, {
      ...data,
      createdAt: new Date().toISOString(),
    }),
  update: (id: string, data: Partial<Customer>) => {
    const { createdAt: _createdAt, ...rest } = data;
    return call<Customer>("update", "customers", id, rest);
  },
  remove: (id: string) => call<{ ok: true }>("remove", "customers", id),
};

export const supplierService = {
  list: () => call<Supplier[]>("list", "suppliers"),
  get: (id: string) => call<Supplier | null>("get", "suppliers", id),
  create: (data: Omit<Supplier, "id" | "createdAt">) =>
    call<Supplier>("create", "suppliers", undefined, {
      ...data,
      createdAt: new Date().toISOString(),
    }),
  update: (id: string, data: Partial<Supplier>) => call<Supplier>("update", "suppliers", id, data),
  remove: (id: string) => call<{ ok: true }>("remove", "suppliers", id),
};

export const productService = {
  list: () => call<Product[]>("list", "products"),
  get: (id: string) => call<Product | null>("get", "products", id),
  create: async (data: Omit<Product, "id" | "createdAt">) => {
    const initialStock = Number(data.stock) || 0;
    const initialCost = Number(data.cost) || 0;
    const created = await call<Product>("create", "products", undefined, {
      ...data,
      stock: initialStock,
      cost: initialCost,
      costingMethod: data.costingMethod || "fifo",
      createdAt: new Date().toISOString(),
    });
    if (initialStock > 0) {
      await call("create", "costLayers", undefined, {
        productId: created.id,
        qtyRemaining: initialStock,
        unitCost: initialCost,
        receivedAt: created.createdAt,
        refType: "adjustment",
      });
      await postStockMovement({
        date: created.createdAt,
        productId: created.id,
        productName: created.name,
        type: "in",
        movementType: "ADJUSTMENT_IN",
        direction: "in",
        quantity: initialStock,
        balanceAfter: initialStock,
        unitCost: initialCost,
        totalCost: initialStock * initialCost,
        cogsAmount: initialStock * initialCost,
        costingMethod: productMethod(created),
        refType: "adjustment",
        refId: `INIT-${created.id}`,
        notes: "Initial opening stock",
        by: "System",
      });
    }
    return created;
  },
  update: async (id: string, data: Partial<Product>) => {
    const { stock: _ignoreStock, id: _ignoreId, createdAt: _ignoreCreated, ...rest } = data;
    return updateProductFn({ data: { id, payload: rest } });
  },
  remove: (id: string) => call<{ ok: true }>("remove", "products", id),
  stockAlerts: async (): Promise<StockAlert[]> => {
    const list = await call<Product[]>("list", "products");
    return list
      .filter((p) => (p.stock ?? 0) <= (p.reorderLevel ?? 0))
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        stock: p.stock,
        reorderLevel: p.reorderLevel,
      }));
  },
};

export const cylinderService = {
  list: () => call<Cylinder[]>("list", "cylinders"),
  get: (id: string) => call<Cylinder | null>("get", "cylinders", id),
  create: async (
    data: Omit<Cylinder, "id" | "createdAt" | "lastMovementAt"> & { skipIntakeMovement?: boolean },
  ) => {
    const now = new Date().toISOString();
    const { skipIntakeMovement, ...rest } = data;
    if (!skipIntakeMovement) {
      rest.status = "in_stock";
    } else if (rest.status && rest.status !== "in_stock" && rest.status !== "in_transit") {
      throw new Error(
        "New cylinders must start in warehouse. Use Inventory movements to change status.",
      );
    }
    const fillLevel = rest.fillLevel ?? "full";
    const created = await call<Cylinder>("create", "cylinders", undefined, {
      ...rest,
      fillLevel,
      createdAt: now,
      lastMovementAt: now,
    });
    if (!skipIntakeMovement) {
      await cylinderService.addMovement({
        cylinderId: created.id,
        type: "received",
        fromLocation: rest.location || "Intake",
        toLocation: rest.location || "Warehouse",
        notes: "Cylinder record created",
        by: "Warehouse",
      });
    }
    return created;
  },
  update: async (id: string, data: Partial<Cylinder>) => {
    const existing = await call<Cylinder | null>("get", "cylinders", id);
    if (!existing) throw new Error("Cylinder not found");
    if (data.status && data.status !== existing.status) {
      throw new Error("Change cylinder status through Inventory or Delivery movements.");
    }
    const { createdAt: _createdAt, status: _status, ...rest } = data;
    return call<Cylinder>("update", "cylinders", id, rest);
  },
  remove: (id: string) => call<{ ok: true }>("remove", "cylinders", id),
  listMovements: () => call<CylinderMovement[]>("list", "movements"),
  getMovements: async (cylinderId: string) => {
    const all = await call<CylinderMovement[]>("list", "movements");
    return all
      .filter((m) => m.cylinderId === cylinderId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
  addMovement: async (data: Omit<CylinderMovement, "id" | "timestamp">) => {
    const current = await call<Cylinder | null>("get", "cylinders", data.cylinderId);
    if (!current) throw new Error("Cylinder not found");
    if (data.type === "lost" && current.status === "lost") {
      throw new Error("Cylinder is already marked lost");
    }
    if (data.type === "returned" && data.customerId) {
      if (
        current.status !== "at_customer" ||
        (current.customerId && current.customerId !== data.customerId)
      ) {
        throw new Error(
          `Cannot return cylinder ${current.serialNumber}: it is not currently issued to this customer.`,
        );
      }
    }
    const now = new Date().toISOString();
    const mv = await call<CylinderMovement>("create", "movements", undefined, {
      ...data,
      timestamp: now,
    });
    const status = statusFromMovement(data.type);
    const fillLevel = fillLevelFromMovement(data.type);
    const patch: Record<string, unknown> = {
      lastMovementAt: mv.timestamp,
      status,
      issueLock: null,
    };
    if (fillLevel) patch.fillLevel = fillLevel;
    if (data.toLocation) patch.location = data.toLocation;
    if (data.sold === false) patch.ownedBy = "company";
    else if (data.sold || data.purpose === "sale") patch.ownedBy = "customer";
    if (data.type === "issued") {
      patch.customerId = data.customerId;
      patch.supplierId = null;
    } else if (data.type === "transferred" && data.supplierId) {
      patch.supplierId = data.supplierId;
      patch.customerId = null;
    } else if (data.type === "returned" || data.type === "received" || data.type === "refilled") {
      patch.customerId = null;
      if (data.supplierId || data.type === "received" || data.type === "refilled")
        patch.supplierId = null;
    } else if (
      data.type === "damaged" ||
      data.type === "lost" ||
      data.type === "stock_out" ||
      data.type === "scrapped" ||
      data.type === "written_off"
    ) {
      patch.customerId = null;
      patch.supplierId = null;
    } else if (data.customerId) patch.customerId = data.customerId;
    if (data.supplierId && data.type === "transferred") patch.supplierId = data.supplierId;
    await call("update", "cylinders", data.cylinderId, patch);
    return mv;
  },
};

export const salesService = {
  list: () => call<SalesOrder[]>("list", "sales"),
  get: (id: string) => call<SalesOrder | null>("get", "sales", id),
  create: async (data: Omit<SalesOrder, "id">) => {
    if (isOpenSalesStatus(data.status)) {
      await assertSalesStock(data.items, { sellGasOnly: data.sellGasOnly });
    }
    const order = await call<SalesOrder>("create", "sales", undefined, {
      ...data,
      createdAt: data.createdAt ?? new Date().toISOString(),
    });
    if (isOpenSalesStatus(order.status)) {
      await fulfillSalesOrder(order);
    }
    return (await call<SalesOrder | null>("get", "sales", order.id)) ?? order;
  },
  update: async (id: string, data: Partial<SalesOrder>) => {
    const existing = await call<SalesOrder | null>("get", "sales", id);
    if (!existing) throw new Error("Order not found");
    if (existing.status === "cancelled") throw new Error("Cancelled orders cannot be edited");
    if (data.items) {
      const deliveries = await call<Delivery[]>("list", "deliveries");
      const pendingDc = deliveries.find(
        (d) => d.salesOrderId === id && (d.status === "pending" || d.status === "in_transit"),
      );
      if (pendingDc) {
        await call("update", "deliveries", pendingDc.id, { items: data.items });
      } else {
        await unfulfillSalesOrder(existing);
      }
    }
    const paid = existing.paid || 0;
    const total = data.total != null ? Number(data.total) : existing.total;
    if (total + 0.009 < paid) {
      throw new Error("Order total cannot be less than amount already paid");
    }
    let status = data.status ?? existing.status;
    const becomingOpen = isOpenSalesStatus(status) && !isOpenSalesStatus(existing.status);
    if (becomingOpen || (data.items && isOpenSalesStatus(status))) {
      await assertSalesStock(data.items || existing.items, {
        sellGasOnly: data.sellGasOnly ?? existing.sellGasOnly,
        excludeOrderId: id,
      });
    }
    if (status !== "draft" && status !== "cancelled") {
      if (paid + 0.009 >= total && total > 0) status = "paid";
      else if (paid > 0 && status === "paid") status = "invoiced";
    }
    const { paid: _ignorePaid, ...rest } = data;
    const updated = await call<SalesOrder>("update", "sales", id, {
      ...rest,
      paid,
      status,
      tax: 0,
    });
    if (isOpenSalesStatus(updated.status)) {
      await fulfillSalesOrder(updated);
    }
    return updated;
  },
  remove: async (id: string) => {
    const existing = await call<SalesOrder | null>("get", "sales", id);
    if (!existing) throw new Error("Order not found");
    await unfulfillSalesOrder(existing);
    const ledger = await call<LedgerEntry[]>("list", "ledger");
    for (const entry of ledger.filter((e) => e.refType === "sales" && e.refId === id)) {
      await call("remove", "ledger", entry.id);
    }
    const vouchers = await call<Voucher[]>("list", "vouchers");
    for (const v of vouchers.filter((x) => x.refType === "sales" && x.refId === id)) {
      await call("remove", "vouchers", v.id);
    }
    return call<{ ok: true }>("remove", "sales", id);
  },
  setStatus: async (id: string, status: SalesStatus) => {
    const order = await call<SalesOrder | null>("get", "sales", id);
    if (!order) throw new Error("Order not found");
    if (order.status === "cancelled" || order.status === "paid") {
      throw new Error(`Cannot change status from ${order.status}`);
    }
    if (
      order.status === "draft" &&
      (status === "confirmed" || status === "invoiced" || status === "paid")
    ) {
      await assertSalesStock(order.items, { sellGasOnly: order.sellGasOnly, excludeOrderId: id });
    }
    if ((order.status === "confirmed" || order.status === "invoiced") && status === "cancelled") {
      await unfulfillSalesOrder(order);
    }
    const updated = await call<SalesOrder>("update", "sales", id, { status });
    if (order.status === "draft" && isOpenSalesStatus(status)) {
      await fulfillSalesOrder({ ...updated, status });
    }
    return updated;
  },
  convertQuotation: async (id: string) => {
    const order = await call<SalesOrder | null>("get", "sales", id);
    if (!order) throw new Error("Quotation not found");
    if (order.status !== "draft") throw new Error("Only draft quotations can be converted");
    await assertSalesStock(order.items, { sellGasOnly: order.sellGasOnly, excludeOrderId: id });
    const updated = await call<SalesOrder>("update", "sales", id, {
      status: "confirmed",
      orderNo: order.orderNo.startsWith("QT") ? order.orderNo.replace(/^QT/, "SO") : order.orderNo,
    });
    await fulfillSalesOrder(updated);
    return updated;
  },
  recordPayment: async (
    id: string,
    amount: number,
    method: PaymentMethod = "cash",
    accountName?: string,
  ) => {
    const order = await call<SalesOrder | null>("get", "sales", id);
    if (!order) throw new Error("order not found");
    if (order.status === "cancelled") throw new Error("Cannot pay a cancelled order");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be positive");
    const due = Math.max(0, (order.total || 0) - (order.paid || 0));
    if (amount > due + 0.009) throw new Error("Amount exceeds due balance");
    const payMethod = method === "bank" ? "bank" : "cash";
    if (payMethod === "bank" && !accountName) throw new Error("Select a bank account");
    const account = payMethod === "cash" ? "cash" : accountName!;
    const paid = (order.paid || 0) + amount;
    let status: SalesStatus = order.status;
    if (paid >= order.total) status = "paid";
    else if (order.status === "confirmed" || order.status === "draft") status = "invoiced";

    const updated = await call<SalesOrder>("update", "sales", id, { paid, status });
    const payDate = new Date().toISOString();
    const receipt = await call<Voucher>("create", "vouchers", undefined, {
      voucherNo: genOrderNo("MR"),
      type: "receipt",
      date: toVoucherDate(payDate),
      account,
      amount,
      partyType: "customer",
      partyId: order.customerId,
      partyName: order.customerName,
      notes: `Payment for ${order.orderNo}`,
      refType: "sales",
      refId: id,
      refNo: order.orderNo,
      createdAt: payDate,
    });
    await postLedger({
      date: payDate,
      account,
      direction: "in",
      amount,
      category: "collection",
      refType: "sales",
      refId: id,
      notes: `Payment for ${order.orderNo} (${receipt.voucherNo})`,
    });
    return { order: updated, receipt };
  },
  dashboard: async (): Promise<DashboardStats & { stockAlerts: StockAlert[] }> => {
    return await dashboardFn();
  },
};

export const notificationsService = {
  getNotifications: async () => {
    return await notificationsFn();
  },
};

export const deliveryService = {
  list: () => call<Delivery[]>("list", "deliveries"),
  get: (id: string) => call<Delivery | null>("get", "deliveries", id),
  create: (data: Omit<Delivery, "id">) => call<Delivery>("create", "deliveries", undefined, data),
  update: async (id: string, data: Partial<Delivery>) => {
    const existing = await call<Delivery | null>("get", "deliveries", id);
    if (!existing) throw new Error("Delivery not found");
    if (existing.status !== "pending") {
      // Delivered challans: allow editing delivery & customer notes/driver/receiver/vehicle without altering stock items
      const {
        items: _ignoreItems,
        status: _ignoreStatus,
        id: _ignoreId,
        challanNo: _ignoreNo,
        confirmedAt: _ignoreConfirmedAt,
        ...allowedFields
      } = data;
      return call<Delivery>("update", "deliveries", id, allowedFields);
    }
    return call<Delivery>("update", "deliveries", id, data);
  },
  remove: async (id: string) => {
    const existing = await call<Delivery | null>("get", "deliveries", id);
    if (!existing) throw new Error("Delivery not found");
    if (existing.status !== "pending") throw new Error("Only pending deliveries can be deleted");
    return call<{ ok: true }>("remove", "deliveries", id);
  },
  confirm: async (
    id: string,
    payload?: {
      issuedIdsByItem?: string[][];
      returnedIds?: string[];
      lotNumber?: string;
      expectedReturnAt?: string;
      skipCylinders?: boolean;
      asExchange?: boolean;
    },
  ) => {
    const delivery = await call<Delivery | null>("get", "deliveries", id);
    if (!delivery) throw new Error("Delivery not found");
    if (delivery.status !== "pending" && delivery.status !== "in_transit") {
      throw new Error("Already confirmed");
    }

    const productsEarly = await call<Product[]>("list", "products");
    const hasCylLines = delivery.items.some((item) =>
      isCylinderTrackedLine(
        item,
        productsEarly.find((p) => p.id === item.productId),
      ),
    );
    const confirmPayload = !hasCylLines ? { ...payload, skipCylinders: true as const } : payload;
    const expectedReturnAt = confirmPayload?.expectedReturnAt || defaultExpectedReturnAt();

    if (delivery.salesOrderId) {
      const so = await call<SalesOrder | null>("get", "sales", delivery.salesOrderId);
      if (so && (await salesAlreadyFulfilled(so, id))) {
        return call<Delivery>("update", "deliveries", id, {
          status: "delivered",
          confirmedAt: new Date().toISOString(),
          expectedReturnAt: confirmPayload?.expectedReturnAt || undefined,
          items: delivery.items,
        });
      }
    }

    const products = productsEarly;
    const allCyl = await call<Cylinder[]>("list", "cylinders");
    const nextItems = delivery.items.map((item, i) => {
      const assigned = confirmPayload?.issuedIdsByItem?.[i];
      return assigned ? { ...item, cylinderIds: assigned } : item;
    });

    if (confirmPayload?.skipCylinders) {
      const alreadyOut = await hasStockOut("delivery", id);
      const soAlreadyOut = delivery.salesOrderId
        ? await hasStockOut("sales", delivery.salesOrderId)
        : false;
      const stockItems = productStockLines(nextItems, products, true);
      if (!alreadyOut && !soAlreadyOut && stockItems.length) {
        await adjustStock(stockItems, -1, {
          refType: "delivery",
          refId: id,
          notes: delivery.challanNo,
          by: delivery.receiverName || "Delivery",
        });
      }
      if (delivery.salesOrderId) {
        const so = await call<SalesOrder | null>("get", "sales", delivery.salesOrderId);
        if (so && so.status === "confirmed") {
          await call("update", "sales", so.id, { status: "invoiced" });
        }
      }
      return call<Delivery>("update", "deliveries", id, {
        status: "delivered",
        confirmedAt: new Date().toISOString(),
        expectedReturnAt: confirmPayload?.expectedReturnAt || undefined,
        emptyReturned: 0,
        items: nextItems,
      });
    }

    const used = new Set<string>();
    const isSerializedProduct = (productId: string) =>
      allCyl.some((c) => c.productId === productId);

    for (let i = 0; i < nextItems.length; i += 1) {
      const item = nextItems[i];
      const p = products.find((x) => x.id === item.productId);
      if (!isCylinderTrackedLine(item, p)) continue;
      if (!isSerializedProduct(item.productId)) continue;

      const sold = isCylinderSaleLine(item, p);
      if (!sold && item.quantity > 0 && !expectedReturnAt) {
        throw new Error("Expected return date is required for customer cylinder send");
      }
      const ids = item.cylinderIds || [];
      if (ids.length === item.quantity) {
        for (const cid of ids) {
          if (used.has(cid)) throw new Error("Duplicate cylinder selected");
          used.add(cid);
          const cyl = allCyl.find((c) => c.id === cid);
          if (!cyl) throw new Error("Cylinder not found");
          if (cyl.productId !== item.productId) {
            throw new Error(`${cyl.serialNumber} does not match ${item.productName}`);
          }
          if (cyl.status !== "in_stock" && cyl.status !== "in_transit") {
            throw new Error(`${cyl.serialNumber} is ${cyl.status}, not available to issue`);
          }
          if (cylinderIsEmpty(cyl)) {
            throw new Error(`${cyl.serialNumber} is empty and must be refilled before issue`);
          }
        }
      }
    }

    const claimedIds: string[] = [];
    try {
      const soAlreadyOut = delivery.salesOrderId
        ? await hasStockOut("sales", delivery.salesOrderId)
        : false;

      for (let i = 0; i < nextItems.length; i += 1) {
        const item = nextItems[i];
        const p = products.find((x) => x.id === item.productId);
        if (!isCylinderTrackedLine(item, p)) continue;

        if (!isSerializedProduct(item.productId)) {
          // Quantity-based cylinder product
          nextItems[i] = { ...item, cylinderIds: [] };
          if (!soAlreadyOut && (p?.stock ?? 0) < item.quantity) {
            throw new Error(
              `Insufficient warehouse stock for ${item.productName}. Available: ${p?.stock ?? 0}, Required: ${item.quantity}. Please add stock first.`,
            );
          }
          continue;
        }

        let ids = item.cylinderIds || [];
        if (ids.length !== item.quantity) {
          const picked = await takeWarehouseFull(
            item.productId,
            item.quantity,
            confirmPayload?.lotNumber,
          );
          ids = picked.map((c) => c.id);
          nextItems[i] = { ...item, cylinderIds: ids };
        } else {
          await claimCylinderIds(ids, ["in_stock", "in_transit"]);
        }
        claimedIds.push(...ids);
      }

      const alreadyOut = await hasStockOut("delivery", id);
      const stockItems = productStockLines(nextItems, products, false);
      if (!alreadyOut && !soAlreadyOut && stockItems.length) {
        await adjustStock(stockItems, -1, {
          refType: "delivery",
          refId: id,
          movementType: "SALE_ISSUE",
          notes: delivery.challanNo,
          by: delivery.receiverName || "Delivery",
        });
      }
      if (delivery.salesOrderId) {
        const so = await call<SalesOrder | null>("get", "sales", delivery.salesOrderId);
        if (so && so.status === "confirmed") {
          await call("update", "sales", so.id, { status: "invoiced" });
        }
      }

      const issuedCount = nextItems.reduce((n, item) => n + (item.cylinderIds?.length || 0), 0);
      const returnedCount = confirmPayload?.returnedIds?.length || 0;
      if (confirmPayload?.asExchange) {
        const totalDeliveredQty = nextItems.reduce((n, item) => n + (item.quantity || 0), 0);
        const exchangeIssueCount = issuedCount > 0 ? issuedCount : totalDeliveredQty;
        if (exchangeIssueCount <= 0 || returnedCount <= 0) {
          throw new Error("Exchange requires empty returns and full issues");
        }
        if (exchangeIssueCount !== returnedCount) {
          throw new Error("Exchange requires equal empty returns and full issues");
        }
      }
      const exchange = confirmPayload?.asExchange === true;

      for (const item of nextItems) {
        const p = products.find((x) => x.id === item.productId);
        const sold = isCylinderSaleLine(item, p);
        for (const cid of item.cylinderIds || []) {
          await cylinderService.addMovement({
            cylinderId: cid,
            type: "issued",
            customerId: delivery.customerId,
            fromLocation: "Warehouse",
            toLocation: delivery.customerName,
            notes: sold
              ? `Sold — ownership transferred (${delivery.challanNo})`
              : exchange
                ? `Exchange in from Delivery ${delivery.challanNo}`
                : `Auto-issued from Delivery ${delivery.challanNo}`,
            by: "Delivery",
            sold,
            purpose: sold ? "sale" : exchange ? "exchange_out" : "sent",
            expectedReturnAt: sold ? undefined : expectedReturnAt,
          });
        }
      }

      const priorMoves = await call<CylinderMovement[]>("list", "movements");
      for (const cid of confirmPayload?.returnedIds || []) {
        const cyl = allCyl.find((c) => c.id === cid);
        if (!cyl) throw new Error("Return cylinder not found");
        if (cyl.customerId && cyl.customerId !== delivery.customerId) {
          throw new Error(`${cyl.serialNumber} belongs to another customer`);
        }
        const loaned = lastCustomerPurpose(priorMoves, cid, delivery.customerId) === "loan";
        await cylinderService.addMovement({
          cylinderId: cid,
          type: "returned",
          customerId: delivery.customerId,
          fromLocation: delivery.customerName,
          toLocation: "Warehouse",
          notes: exchange
            ? `Exchange return with Delivery ${delivery.challanNo}`
            : `Empty returned with Delivery ${delivery.challanNo}`,
          by: "Delivery",
          purpose: exchange ? "exchange_in" : loaned ? "loan_return" : "return",
        });
      }

      return call<Delivery>("update", "deliveries", id, {
        status: "delivered",
        confirmedAt: new Date().toISOString(),
        expectedReturnAt: confirmPayload?.expectedReturnAt || undefined,
        emptyReturned: confirmPayload?.returnedIds?.length || 0,
        items: nextItems,
      });
    } catch (err) {
      for (const cid of claimedIds) {
        try {
          const cyl = await call<Cylinder | null>("get", "cylinders", cid);
          if (cyl?.status === "at_customer") {
            await cylinderService.addMovement({
              cylinderId: cid,
              type: "received",
              fromLocation: delivery.customerName,
              toLocation: "Warehouse",
              notes: `Rollback ${delivery.challanNo}`,
              by: "Delivery",
              sold: false,
            });
          }
        } catch {
          /* keep trying remaining cylinders */
        }
      }
      await releaseIssueLocks(claimedIds);
      throw err;
    }
  },
};

export const expenseService = {
  list: () => call<Expense[]>("list", "expenses"),
  get: (id: string) => call<Expense | null>("get", "expenses", id),
  create: async (data: Omit<Expense, "id" | "createdAt">) => {
    const now = new Date().toISOString();
    const expense = await call<Expense>("create", "expenses", undefined, {
      ...data,
      createdAt: now,
    });
    const account =
      data.paymentMethod === "cheque" || data.paymentMethod === "mobile"
        ? "bank"
        : data.paymentMethod;
    await postLedger({
      date: data.date || now,
      account,
      direction: "out",
      amount: data.amount,
      category: "expense",
      refType: "expense",
      refId: expense.id,
      notes: data.description,
    });
    return expense;
  },
  remove: async (id: string) => {
    const expense = await call<Expense | null>("get", "expenses", id);
    if (expense) {
      const ledger = await call<LedgerEntry[]>("list", "ledger");
      const linked = ledger.filter((e) => e.refType === "expense" && e.refId === id);
      for (const entry of linked) {
        await call("remove", "ledger", entry.id);
      }
    }
    return call<{ ok: true }>("remove", "expenses", id);
  },
  update: async (id: string, data: Partial<Expense>) => {
    const existing = await call<Expense | null>("get", "expenses", id);
    if (!existing) throw new Error("Expense not found");
    const ledger = await call<LedgerEntry[]>("list", "ledger");
    const linked = ledger.filter((e) => e.refType === "expense" && e.refId === id);
    for (const entry of linked) {
      await call("remove", "ledger", entry.id);
    }
    const updated = await call<Expense>("update", "expenses", id, data);
    const paymentMethod = updated.paymentMethod ?? existing.paymentMethod;
    const account =
      paymentMethod === "cheque" || paymentMethod === "mobile" ? "bank" : paymentMethod;
    await postLedger({
      date: updated.date || existing.date,
      account,
      direction: "out",
      amount: updated.amount,
      category: "expense",
      refType: "expense",
      refId: id,
      notes: updated.description,
    });
    return updated;
  },
};

export const purchaseService = {
  list: () => call<PurchaseOrder[]>("list", "purchases"),
  get: (id: string) => call<PurchaseOrder | null>("get", "purchases", id),
  create: async (data: Omit<PurchaseOrder, "id">) => {
    return call<PurchaseOrder>("create", "purchases", undefined, {
      ...data,
      paid: 0,
      tax: 0,
      status: "ordered",
    });
  },
  update: async (id: string, data: Partial<PurchaseOrder>) => {
    const existing = await call<PurchaseOrder | null>("get", "purchases", id);
    if (!existing) throw new Error("Purchase order not found");
    if (existing.status === "cancelled")
      throw new Error("Cancelled purchase orders cannot be edited");
    const paid = existing.paid || 0;
    const total = data.total != null ? Number(data.total) : existing.total;
    if (total + 0.009 < paid) {
      throw new Error("Purchase total cannot be less than amount already paid");
    }
    let status = data.status ?? existing.status;
    if (status === "paid" && paid + 0.009 < total) {
      status =
        existing.status === "partial" || existing.status === "received"
          ? existing.status
          : "ordered";
    }
    const { paid: _ignorePaid, ...rest } = data;
    return call<PurchaseOrder>("update", "purchases", id, { ...rest, paid, status, tax: 0 });
  },
  remove: async (id: string) => {
    const existing = await call<PurchaseOrder | null>("get", "purchases", id);
    if (!existing) throw new Error("Purchase order not found");
    if (existing.status !== "draft" && existing.status !== "cancelled") {
      throw new Error("Only draft or cancelled POs can be deleted");
    }
    const ledger = await call<LedgerEntry[]>("list", "ledger");
    for (const entry of ledger.filter((e) => e.refType === "purchase" && e.refId === id)) {
      await call("remove", "ledger", entry.id);
    }
    const vouchers = await call<Voucher[]>("list", "vouchers");
    for (const v of vouchers.filter((x) => x.refType === "purchase" && x.refId === id)) {
      await call("remove", "vouchers", v.id);
    }
    return call<{ ok: true }>("remove", "purchases", id);
  },
  setStatus: async (id: string, status: PurchaseStatus) => {
    const po = await call<PurchaseOrder | null>("get", "purchases", id);
    if (!po) throw new Error("Purchase order not found");
    if (po.status === "cancelled") {
      throw new Error(`Cannot change status from ${po.status}`);
    }
    if (
      status === "cancelled" &&
      (po.status === "received" || po.status === "billed" || po.status === "partial")
    ) {
      throw new Error("Cannot cancel after goods received");
    }
    return call<PurchaseOrder>("update", "purchases", id, { status });
  },
  receive: async (
    id: string,
    payload?: {
      serialsByItem?: string[][];
      lotNumber?: string;
      qtyByItem?: number[];
      requestId?: string;
    },
  ) => {
    return receivePurchaseFn({ data: { id, payload } });
  },
  recordPayment: async (
    id: string,
    amount: number,
    method: PaymentMethod = "cash",
    accountName?: string,
  ) => {
    const po = await call<PurchaseOrder | null>("get", "purchases", id);
    if (!po) throw new Error("Purchase order not found");
    if (po.status === "cancelled") throw new Error("Cannot pay a cancelled purchase order");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be positive");
    const due = Math.max(0, (po.total || 0) - (po.paid || 0));
    if (amount > due + 0.009) throw new Error("Amount exceeds due balance");
    const payMethod = method === "bank" ? "bank" : "cash";
    if (payMethod === "bank" && !accountName) throw new Error("Select a bank account");
    const account = payMethod === "cash" ? "cash" : accountName!;
    const paid = (po.paid || 0) + amount;
    const status: PurchaseStatus = po.status === "draft" ? "ordered" : po.status;
    const updated = await call<PurchaseOrder>("update", "purchases", id, { paid, status });
    const payDate = new Date().toISOString();
    const voucher = await call<Voucher>("create", "vouchers", undefined, {
      voucherNo: genOrderNo("PV"),
      type: "payment",
      date: toVoucherDate(payDate),
      account,
      amount,
      partyType: "supplier",
      partyId: po.supplierId,
      partyName: po.supplierName,
      notes: `Payment for ${po.orderNo}`,
      refType: "purchase",
      refId: id,
      refNo: po.orderNo,
      createdAt: payDate,
    });
    await postLedger({
      date: payDate,
      account,
      direction: "out",
      amount,
      category: "purchase",
      refType: "purchase",
      refId: id,
      notes: `Payment for ${po.orderNo} (${voucher.voucherNo})`,
    });
    return { order: updated, voucher };
  },
};

export const inventoryService = {
  listMovements: () => call<StockMovement[]>("list", "stockMovements"),
  completeRefill: async (
    productId: string,
    quantity: number,
    by?: string,
    refillDate?: string,
  ) => {
    const product = await call<Product | null>("get", "products", productId);
    if (!product) throw new Error("Product not found");
    if (quantity <= 0) throw new Error("Quantity must be positive");
    const cylinders = await call<Cylinder[]>("list", "cylinders");
    const empties = cylinders
      .filter(
        (c) =>
          c.productId === productId &&
          !c.supplierId &&
          (c.status === "refilling" ||
            (cylinderIsEmpty(c) && c.status !== "at_customer" && c.status !== "in_transit")),
      )
      .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt));
    if (empties.length < quantity)
      throw new Error(`Only ${empties.length} empty cylinder(s) ready to refill`);

    const now = new Date().toISOString();

    // Idempotency guard: prevent duplicate submission within 3s for same product & quantity
    const recentMovements = await call<StockMovement[]>("list", "stockMovements");
    const isDup = recentMovements.find(
      (m) =>
        m.refType === "refill" &&
        m.productId === product.id &&
        m.quantity === quantity &&
        Math.abs(new Date(now).getTime() - new Date(m.date).getTime()) < 3000,
    );
    if (isDup) return;

    const picked = empties.slice(0, quantity);
    for (const c of picked) {
      await cylinderService.addMovement({
        cylinderId: c.id,
        type: "refilled",
        fromLocation: c.location,
        toLocation: "Warehouse",
        notes: `Refill complete for ${product.name}`,
        by: by || "Warehouse",
      });
    }

    const actualRefillDate = refillDate
      ? (refillDate.includes("T") ? refillDate : `${refillDate}T00:00:00.000Z`)
      : now;

    await call("create", "stockMovements", undefined, {
      date: now,
      refillDate: actualRefillDate,
      productId: product.id,
      productName: product.name,
      productType: "cylinder",
      type: "in",
      movementType: "RECEIPT",
      quantity,
      balanceAfter: product.stock,
      refType: "refill",
      notes: `Refill complete × ${quantity}`,
      by: by || "Warehouse",
    });
  },
  sendToSupplier: async (data: {
    supplierId: string;
    productId: string;
    quantity: number;
    date?: string;
    expectedReturnDate?: string;
    notes?: string;
  }) => {
    const product = await call<Product | null>("get", "products", data.productId);
    if (!product) throw new Error("Product not found");
    const supplier = await call<Supplier | null>("get", "suppliers", data.supplierId);
    if (!supplier) throw new Error("Supplier not found");
    const qty = Number(data.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantity must be positive");
    const cylinders = await call<Cylinder[]>("list", "cylinders");
    const pool = cylinders
      .filter(
        (c) =>
          c.productId === data.productId &&
          !c.supplierId &&
          !issueLockIsActive(c.issueLock) &&
          c.status !== "at_customer" &&
          c.status !== "damaged" &&
          c.status !== "lost" &&
          (c.status === "refilling" || cylinderIsEmpty(c)),
      )
      .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt));
    if (pool.length < qty)
      throw new Error(`Only ${pool.length} empty cylinder(s) available to send`);
    const chosen = pool.slice(0, qty);
    const claimedIds = chosen.map((c) => c.id);
    await claimCylinderIds(claimedIds, ["in_stock", "refilling", "in_transit"]);
    const expectedReturnAt = data.expectedReturnDate || undefined;
    const when = data.date
      ? new Date(`${data.date}T12:00:00`).toISOString()
      : new Date().toISOString();
    await afterCylinderClaim(claimedIds, async () => {
      for (const c of chosen) {
        await cylinderService.addMovement({
          cylinderId: c.id,
          type: "transferred",
          supplierId: supplier.id,
          fromLocation: "Warehouse",
          toLocation: supplier.name,
          notes: data.notes?.trim() || `Sent to supplier for refill · ${product.name}`,
          by: "Warehouse",
          expectedReturnAt,
          purpose: "refill_sent",
        });
      }
      await call("create", "stockMovements", undefined, {
        date: when,
        productId: product.id,
        productName: product.name,
        type: "out",
        quantity: qty,
        balanceAfter: product.stock,
        refType: "refill",
        notes: `Sent to ${supplier.name} × ${qty}${data.notes ? ` · ${data.notes}` : ""}`,
        by: "Warehouse",
      });
    });
  },
  receiveFromSupplier: async (data: {
    supplierId: string;
    productId: string;
    quantity: number;
    condition: "full" | "empty" | "damaged";
    notes?: string;
  }) => {
    const product = await call<Product | null>("get", "products", data.productId);
    if (!product) throw new Error("Product not found");
    const supplier = await call<Supplier | null>("get", "suppliers", data.supplierId);
    if (!supplier) throw new Error("Supplier not found");
    const qty = Number(data.quantity);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantity must be positive");
    const cylinders = await call<Cylinder[]>("list", "cylinders");
    const pool = cylinders
      .filter(
        (c) =>
          c.productId === data.productId &&
          c.supplierId === supplier.id &&
          c.status !== "damaged" &&
          c.status !== "lost",
      )
      .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt));
    if (pool.length < qty)
      throw new Error(`Only ${pool.length} cylinder(s) still with ${supplier.name}`);
    const mvType =
      data.condition === "damaged"
        ? "damaged"
        : data.condition === "empty"
          ? "returned"
          : "refilled";
    for (const c of pool.slice(0, qty)) {
      await cylinderService.addMovement({
        cylinderId: c.id,
        type: mvType,
        supplierId: supplier.id,
        fromLocation: supplier.name,
        toLocation: "Warehouse",
        notes: data.notes?.trim() || `Returned from supplier (${data.condition}) · ${product.name}`,
        by: "Warehouse",
        purpose: "refill_return",
      });
    }
    await call("create", "stockMovements", undefined, {
      date: new Date().toISOString(),
      productId: product.id,
      productName: product.name,
      type: data.condition === "full" ? "in" : "return",
      quantity: qty,
      balanceAfter: product.stock,
      refType: "refill",
      notes: `Received from ${supplier.name} × ${qty} · ${data.condition}`,
      by: "Warehouse",
    });
  },
  markLost: async (data: {
    partyKind: "customer" | "supplier" | "warehouse";
    partyId: string;
    productId: string;
    quantity: number;
    lostDate?: string;
    reason?: string;
    penaltyAmount?: number;
    accountingTreatment?: "charge" | "writeoff" | "none";
  }) => {
    const product = await call<Product | null>("get", "products", data.productId);
    if (!product) throw new Error("Product not found");
    const qty = Number(data.quantity);
    if (qty <= 0) throw new Error("Quantity must be positive");
    const cylinders = await call<Cylinder[]>("list", "cylinders");
    const pool = cylinders
      .filter((c) => {
        if (c.productId !== data.productId || c.status === "lost" || c.ownedBy === "customer")
          return false;
        if (data.partyKind === "warehouse") {
          return c.status === "in_stock" && !c.supplierId;
        }
        if (data.partyKind === "customer")
          return c.status === "at_customer" && c.customerId === data.partyId;
        return Boolean(data.partyId) && c.supplierId === data.partyId && c.status !== "damaged";
      })
      .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt));
    if (pool.length < qty) {
      throw new Error(
        data.partyKind === "warehouse"
          ? `Only ${pool.length} warehouse cylinder(s) available to mark lost`
          : `Only ${pool.length} cylinder(s) outstanding with this party`,
      );
    }
    let partyName = "Warehouse";
    if (data.partyKind !== "warehouse") {
      if (!data.partyId) throw new Error("Select the customer or supplier who holds the cylinder");
      const party =
        data.partyKind === "customer"
          ? await call<Customer | null>("get", "customers", data.partyId)
          : await call<Supplier | null>("get", "suppliers", data.partyId);
      if (!party) throw new Error("Party not found");
      partyName = party.name;
    }
    for (const c of pool.slice(0, qty)) {
      await cylinderService.addMovement({
        cylinderId: c.id,
        type: "lost",
        customerId: data.partyKind === "customer" ? data.partyId : undefined,
        supplierId: data.partyKind === "supplier" ? data.partyId : undefined,
        fromLocation: partyName,
        toLocation: "Lost",
        notes: data.reason?.trim() || `Marked lost · ${product.name}`,
        by: "Warehouse",
        purpose: "lost",
        reason: data.reason,
        penaltyAmount: data.penaltyAmount,
        accountingTreatment: data.accountingTreatment || "none",
      });
    }
    const penalty = Number(data.penaltyAmount) || 0;
    if (data.partyKind !== "warehouse" && penalty > 0 && data.accountingTreatment === "charge") {
      const now = data.lostDate
        ? new Date(`${data.lostDate}T12:00:00`).toISOString()
        : new Date().toISOString();
      if (data.partyKind === "customer") {
        await call("create", "sales", undefined, {
          orderNo: genOrderNo("SO"),
          customerId: data.partyId,
          customerName: partyName,
          date: now,
          items: [
            {
              productId: product.id,
              productName: `Lost cylinder penalty · ${product.name}`,
              quantity: 1,
              price: penalty,
              taxRate: 0,
              sellCylinder: false,
            },
          ],
          subtotal: penalty,
          tax: 0,
          total: penalty,
          paid: 0,
          status: "invoiced",
          notes: data.reason?.trim() || `Lost cylinder penalty · ${product.name}`,
          createdAt: now,
        });
      } else {
        await call("create", "vouchers", undefined, {
          voucherNo: genOrderNo("JV"),
          type: "journal",
          date: now,
          account: "adjustment",
          amount: penalty,
          partyType: "supplier",
          partyId: data.partyId,
          partyName,
          notes: data.reason?.trim() || `Lost cylinder charge · ${product.name}`,
          createdAt: now,
        });
      }
    } else if (penalty > 0 && data.accountingTreatment === "writeoff") {
      await postLedger({
        date: new Date().toISOString(),
        account: "cash",
        direction: "out",
        amount: penalty,
        category: "expense",
        notes: `Lost cylinder write-off · ${partyName} · ${product.name}`,
      });
    }
  },
  markDamaged: async (productId: string, quantity: number, notes?: string, date?: string) => {
    const product = await call<Product | null>("get", "products", productId);
    if (!product) throw new Error("Product not found");
    const qty = Number(quantity);
    if (qty <= 0) throw new Error("Quantity must be positive");
    const isCyl = isCylinderProduct(product);
    if (isCyl) {
      const cylinders = await call<Cylinder[]>("list", "cylinders");
      const pool = cylinders
        .filter(
          (c) =>
            c.productId === productId &&
            c.ownedBy !== "customer" &&
            c.status !== "damaged" &&
            c.status !== "lost" &&
            c.status !== "scrapped" &&
            c.status !== "written_off",
        )
        .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt));
      const toMark = pool.slice(0, Math.min(qty, pool.length));
      for (const c of toMark) {
        await cylinderService.addMovement({
          cylinderId: c.id,
          type: "damaged",
          fromLocation: c.location || "Warehouse",
          toLocation: "Damaged",
          notes: notes?.trim() || `Damaged · ${product.name}`,
          by: "Warehouse",
          purpose: "damaged",
        });
      }
    }
    const refId = genOrderNo("DMG");
    await issueStock(productId, qty, {
      refType: "adjustment",
      refId,
      movementType: "DAMAGE",
      notes: `Damaged · ${product.name}${notes ? ` · ${notes}` : ""}`,
      date: date || new Date().toISOString(),
      by: "Warehouse",
    });
  },
  resolveDamage: async (
    productId: string,
    quantity: number,
    action: "repair" | "scrap" | "writeoff",
    notes?: string,
  ) => {
    const product = await call<Product | null>("get", "products", productId);
    if (!product) throw new Error("Product not found");
    const qty = Number(quantity);
    if (qty <= 0) throw new Error("Quantity must be positive");
    const cylinders = await call<Cylinder[]>("list", "cylinders");
    const pool = cylinders
      .filter((c) => c.productId === productId && c.status === "damaged")
      .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt));
    if (pool.length < qty) throw new Error(`Only ${pool.length} damaged cylinder(s)`);
    for (const c of pool.slice(0, qty)) {
      if (action === "repair") {
        await cylinderService.addMovement({
          cylinderId: c.id,
          type: "refilled",
          fromLocation: "Damaged",
          toLocation: "Warehouse",
          notes: notes?.trim() || `Repaired · ${product.name}`,
          by: "Warehouse",
          purpose: "repair",
        });
      } else {
        await cylinderService.addMovement({
          cylinderId: c.id,
          type: action === "scrap" ? "scrapped" : "written_off",
          fromLocation: "Damaged",
          toLocation: action === "scrap" ? "Scrap" : "Write-off",
          notes: notes?.trim() || `${action} · ${product.name}`,
          by: "Warehouse",
          purpose: action,
        });
      }
    }
    if (action === "repair") {
      const refId = genOrderNo("RPR");
      await receiveStock(productId, qty, product.cost ?? 0, {
        refType: "adjustment",
        refId,
        movementType: "ADJUSTMENT_IN",
        notes: `Repaired · ${product.name}${notes ? ` · ${notes}` : ""}`,
        by: "Warehouse",
      });
    }
  },
  returnEmpty: async (data: {
    customerId: string;
    productId: string;
    quantity: number;
    notes?: string;
  }) => {
    const product = await call<Product | null>("get", "products", data.productId);
    if (!product) throw new Error("Product not found");
    const customer = await call<Customer | null>("get", "customers", data.customerId);
    if (!customer) throw new Error("Customer not found");
    const qty = Number(data.quantity);
    if (qty <= 0) throw new Error("Quantity must be positive");
    const cylinders = await call<Cylinder[]>("list", "cylinders");
    const pool = cylinders
      .filter(
        (c) =>
          c.productId === data.productId &&
          c.status === "at_customer" &&
          c.customerId === data.customerId &&
          c.ownedBy !== "customer" &&
          !issueLockIsActive(c.issueLock),
      )
      .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt));
    if (pool.length === 0)
      throw new Error(
        `Cannot return cylinder: customer has no issued cylinders for ${product.name}`,
      );
    if (pool.length < qty) throw new Error(`Only ${pool.length} cylinder(s) with this customer`);
    const chosen = pool.slice(0, qty);
    const claimedIds = chosen.map((c) => c.id);
    await claimCylinderIds(claimedIds, ["at_customer"]);
    const priorMoves = await call<CylinderMovement[]>("list", "movements");
    await afterCylinderClaim(claimedIds, async () => {
      for (const c of chosen) {
        const loaned = lastCustomerPurpose(priorMoves, c.id, customer.id) === "loan";
        await cylinderService.addMovement({
          cylinderId: c.id,
          type: "returned",
          customerId: customer.id,
          fromLocation: customer.name,
          toLocation: "Warehouse",
          notes:
            data.notes?.trim() ||
            (loaned ? `Loan return · ${product.name}` : `Return empty only · ${product.name}`),
          by: "Warehouse",
          purpose: loaned ? "loan_return" : "return",
        });
      }
    });
  },
  exchangeWithCustomer: async (data: {
    customerId: string;
    productId: string;
    quantity: number;
    lotNumber?: string;
    expectedReturnDate?: string;
    notes?: string;
  }) => {
    const product = await call<Product | null>("get", "products", data.productId);
    if (!product) throw new Error("Product not found");
    const customer = await call<Customer | null>("get", "customers", data.customerId);
    if (!customer) throw new Error("Customer not found");
    const qty = Number(data.quantity);
    if (qty <= 0) throw new Error("Quantity must be positive");
    if (!data.expectedReturnDate) throw new Error("Expected return date is required");
    const cylinders = await call<Cylinder[]>("list", "cylinders");
    const empties = cylinders
      .filter(
        (c) =>
          c.productId === data.productId &&
          c.status === "at_customer" &&
          c.customerId === customer.id &&
          c.ownedBy !== "customer" &&
          !issueLockIsActive(c.issueLock),
      )
      .sort((a, b) => a.lastMovementAt.localeCompare(b.lastMovementAt));
    if (empties.length < qty)
      throw new Error(`Only ${empties.length} empty cylinder(s) with this customer to exchange`);
    const back = empties.slice(0, qty);
    const claimedIds = back.map((c) => c.id);
    await claimCylinderIds(claimedIds, ["at_customer"]);
    try {
      for (const c of back) {
        await cylinderService.addMovement({
          cylinderId: c.id,
          type: "returned",
          customerId: customer.id,
          fromLocation: customer.name,
          toLocation: "Warehouse",
          notes: data.notes?.trim() || `Exchange return · ${product.name}`,
          by: "Warehouse",
          purpose: "exchange_in",
        });
      }
      const fulls = await takeWarehouseFull(data.productId, qty, data.lotNumber);
      claimedIds.push(...fulls.map((c) => c.id));
      for (const c of fulls) {
        await cylinderService.addMovement({
          cylinderId: c.id,
          type: "issued",
          customerId: customer.id,
          fromLocation: "Warehouse",
          toLocation: customer.name,
          notes: data.notes?.trim() || `Exchange issue · ${product.name}`,
          by: "Warehouse",
          purpose: "exchange_out",
          expectedReturnAt: data.expectedReturnDate,
          lotNumber: data.lotNumber,
        });
      }
    } catch (err) {
      await releaseIssueLocks(claimedIds);
      throw err;
    }
  },
  loanToCustomer: async (data: {
    customerId: string;
    productId: string;
    quantity: number;
    issueDate?: string;
    expectedReturnDate?: string;
    notes?: string;
  }) => {
    const product = await call<Product | null>("get", "products", data.productId);
    if (!product) throw new Error("Product not found");
    const customer = await call<Customer | null>("get", "customers", data.customerId);
    if (!customer) throw new Error("Customer not found");
    const qty = Number(data.quantity);
    if (qty <= 0) throw new Error("Quantity must be positive");
    if (!data.expectedReturnDate) throw new Error("Expected return date is required");
    const pool = await takeWarehouseFull(data.productId, qty);
    const claimedIds = pool.slice(0, qty).map((c) => c.id);
    await afterCylinderClaim(claimedIds, async () => {
      for (const c of pool.slice(0, qty)) {
        await cylinderService.addMovement({
          cylinderId: c.id,
          type: "issued",
          customerId: customer.id,
          fromLocation: "Warehouse",
          toLocation: customer.name,
          notes: data.notes?.trim() || `Loan · ${product.name}`,
          by: "Warehouse",
          purpose: "loan",
          expectedReturnAt: data.expectedReturnDate,
        });
      }
    });
  },
  sendToCustomer: async (data: {
    customerId: string;
    productId: string;
    quantity: number;
    lotNumber?: string;
    notes?: string;
    expectedReturnDate?: string;
  }) => {
    const product = await call<Product | null>("get", "products", data.productId);
    if (!product) throw new Error("Product not found");
    const customer = await call<Customer | null>("get", "customers", data.customerId);
    if (!customer) throw new Error("Customer not found");
    const qty = Number(data.quantity);
    if (qty <= 0) throw new Error("Quantity must be positive");
    if (!data.expectedReturnDate) throw new Error("Expected return date is required");
    const pool = await takeWarehouseFull(data.productId, qty, data.lotNumber);
    const claimedIds = pool.map((c) => c.id);
    await afterCylinderClaim(claimedIds, async () => {
      for (const c of pool) {
        await cylinderService.addMovement({
          cylinderId: c.id,
          type: "issued",
          customerId: customer.id,
          fromLocation: "Warehouse",
          toLocation: customer.name,
          notes: data.notes?.trim() || `Customer sent · ${product.name}`,
          by: "Warehouse",
          purpose: "sent",
          lotNumber: data.lotNumber,
          expectedReturnAt: data.expectedReturnDate,
        });
      }
    });
  },
  sellCylinders: async (data: {
    customerId: string;
    productId: string;
    quantity: number;
    notes?: string;
  }) => {
    const product = await call<Product | null>("get", "products", data.productId);
    if (!product) throw new Error("Product not found");
    const customer = await call<Customer | null>("get", "customers", data.customerId);
    if (!customer) throw new Error("Customer not found");
    const qty = Number(data.quantity);
    if (qty <= 0) throw new Error("Quantity must be positive");
    const pool = await takeWarehouseFull(data.productId, qty);
    const soldIds = pool.slice(0, qty).map((c) => c.id);
    const price = Number(product.price) || 0;
    const total = price * qty;
    const now = new Date().toISOString();
    const orderNo = genOrderNo("SO");
    const items = [
      {
        productId: product.id,
        productName: product.name,
        quantity: qty,
        price,
        taxRate: 0,
        sellCylinder: true,
        cylinderIds: soldIds,
      },
    ];
    let createdSaleId: string | undefined;
    try {
      const created = await call<SalesOrder>("create", "sales", undefined, {
        orderNo,
        customerId: customer.id,
        customerName: customer.name,
        date: now,
        items,
        subtotal: total,
        tax: 0,
        total,
        paid: 0,
        status: "invoiced",
        notes: data.notes?.trim() || `Cylinder sale · ${product.name}`,
        createdAt: now,
      });
      createdSaleId = created.id;
      for (const cid of soldIds) {
        await cylinderService.addMovement({
          cylinderId: cid,
          type: "issued",
          customerId: customer.id,
          fromLocation: "Warehouse",
          toLocation: customer.name,
          notes: data.notes?.trim() || `Cylinder sale · ${product.name} · ${orderNo}`,
          by: "Warehouse",
          purpose: "sale",
          sold: true,
        });
      }
    } catch (err) {
      await releaseIssueLocks(soldIds);
      if (createdSaleId) {
        try {
          await call("remove", "sales", createdSaleId);
        } catch {
          /* compensating this attempt only */
        }
      }
      throw err;
    }
  },
  adjust: async (
    productId: string,
    quantity: number,
    type: "in" | "out" | "adjust",
    notes?: string,
  ) => {
    const product = await call<Product | null>("get", "products", productId);
    if (!product) throw new Error("Product not found");
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Quantity cannot be negative");
    if (type !== "adjust" && quantity <= 0) throw new Error("Quantity must be positive");
    const current = product.stock ?? 0;
    let delta = 0;
    if (type === "in") delta = quantity;
    else if (type === "out") delta = -quantity;
    else delta = quantity - current;
    if (delta === 0) return;
    if (current + delta < 0)
      throw new Error(
        `Insufficient stock for ${product.name} (available ${current}, delta ${delta})`,
      );
    const refId = genOrderNo("ADJ");
    const meta: StockMeta = {
      refType: "adjustment",
      refId,
      movementType: delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
      notes: `ADJ ${refId} · ${product.name} · previous ${current} · qty ${delta > 0 ? "+" : ""}${delta} · updated ${current + delta}${notes ? ` · ${notes}` : ""}`,
      by: notes?.trim() || "Warehouse",
    };
    if (delta > 0) {
      await receiveStock(productId, delta, product.cost ?? 0, meta);
    } else {
      await issueStock(productId, -delta, meta);
    }
    const isCyl = isCylinderProduct(product);
    if (isCyl) {
      const cylinders = await call<Cylinder[]>("list", "cylinders");
      if (delta > 0) {
        const serials = suggestSerials(product.code, delta).map(
          (s) => `${s}-${Math.random().toString(36).slice(2, 6)}`,
        );
        for (const serial of serials) {
          await cylinderService.create({
            serialNumber: serial,
            productId: product.id,
            capacity: product.category === "LPG" ? Number(product.name.match(/\d+/)?.[0] || 0) : 0,
            status: "in_stock",
            fillLevel: "full",
            location: "Warehouse",
            gasCategory: product.category as ProductCategory,
          });
        }
      } else {
        const ids = pickFifo(
          cylinders.filter((c) => !issueLockIsActive(c.issueLock)),
          productId,
          -delta,
        );
        if (ids.length < -delta)
          throw new Error(`Only ${ids.length} full cylinder(s) available to decrease`);
        await claimCylinderIds(ids, ["in_stock", "in_transit"]);
        await afterCylinderClaim(ids, async () => {
          for (const cid of ids) {
            await cylinderService.addMovement({
              cylinderId: cid,
              type: "stock_out",
              fromLocation: "Warehouse",
              toLocation: "Stock Out",
              notes: `Stock adjustment ${refId}`,
              by: meta.by || "Warehouse",
              purpose: "stock_out",
            });
          }
        });
      }
    }
  },
  reconciliationReport: async (): Promise<SerialReconciliationItem[]> => {
    const products = await call<Product[]>("list", "products");
    const cylinders = await call<Cylinder[]>("list", "cylinders");
    return reconcileQuantityWithSerials(products, cylinders);
  },
  listStockMovements: () => call<StockMovement[]>("list", "stockMovements"),
  listCostLayers: () => call<CostLayer[]>("list", "costLayers"),
  getGasInventory: () => getGasInventoryFn(),
  getCylinderInventory: () => getCylinderInventoryFn(),
  getProductInventory: () => getProductInventoryFn(),
  getSummary: () => getInventorySummaryFn(),
  reconcile: () => reconcileInventoryDbFn(),
};

export const accountingService = {
  listAccounts: () => call<Account[]>("list", "accounts"),
  createAccount: (data: Omit<Account, "id" | "createdAt">) =>
    call<Account>("create", "accounts", undefined, {
      ...data,
      createdAt: new Date().toISOString(),
    }),
  updateAccount: (id: string, data: Partial<Account>) =>
    call<Account>("update", "accounts", id, data),
  removeAccount: (id: string) => call<{ ok: true }>("remove", "accounts", id),
  listLedger: () => call<LedgerEntry[]>("list", "ledger"),
  listVouchers: () => call<Voucher[]>("list", "vouchers"),
  createVoucher: async (data: {
    type: VoucherType;
    account: PaymentMethod;
    amount: number;
    date?: string;
    partyType?: "customer" | "supplier" | "employee";
    partyId?: string;
    partyName?: string;
    drAccount?: string;
    crAccount?: string;
    lines?: JournalLine[];
    notes?: string;
    refType?: "sales" | "purchase" | "expense" | "payroll";
    refId?: string;
    refNo?: string;
  }) => {
    if (data.type === "journal") {
      const lines = data.lines?.length
        ? data.lines
        : journalPairLines(data.drAccount, data.crAccount, data.amount);
      return accountingService.postJournal({ date: data.date, notes: data.notes, lines });
    }
    if (data.amount <= 0) throw new Error("Amount must be positive");
    const prefix = data.type === "receipt" ? "RV" : "PV";
    const voucher = await call<Voucher>("create", "vouchers", undefined, {
      voucherNo: genOrderNo(prefix),
      type: data.type,
      date: toVoucherDate(data.date),
      account: data.account,
      amount: data.amount,
      partyType: data.partyType,
      partyId: data.partyId,
      partyName: data.partyName,
      notes: data.notes,
      refType: data.refType,
      refId: data.refId,
      refNo: data.refNo,
      createdAt: new Date().toISOString(),
    });
    await postLedger({
      date: voucher.date,
      account: data.account,
      direction: data.type === "receipt" ? "in" : "out",
      amount: data.amount,
      category: data.type === "receipt" ? "receipt" : "payment",
      refType: "voucher",
      refId: voucher.id,
      notes: data.notes || voucher.voucherNo,
    });
    return voucher;
  },
  postJournal: async (data: { date?: string; notes?: string; lines: JournalLine[] }) => {
    const { total, lines } = assertJournalLines(data.lines);
    const firstDr = lines.find((l) => l.debit > 0);
    const firstCr = lines.find((l) => l.credit > 0);
    const voucher = await call<Voucher>("create", "vouchers", undefined, {
      voucherNo: genOrderNo("JV"),
      type: "journal",
      date: toVoucherDate(data.date),
      account: firstDr?.accountName || "journal",
      amount: total,
      drAccount: firstDr?.accountName,
      crAccount: firstCr?.accountName,
      lines,
      notes: data.notes,
      createdAt: new Date().toISOString(),
    });
    for (const line of lines) {
      const note = line.notes || data.notes || voucher.voucherNo;
      if (line.debit > 0) {
        await postLedger({
          date: voucher.date,
          account: line.accountName as PaymentMethod,
          direction: "in",
          amount: line.debit,
          category: "journal",
          refType: "voucher",
          refId: voucher.id,
          notes: note,
        });
      }
      if (line.credit > 0) {
        await postLedger({
          date: voucher.date,
          account: line.accountName as PaymentMethod,
          direction: "out",
          amount: line.credit,
          category: "journal",
          refType: "voucher",
          refId: voucher.id,
          notes: note,
        });
      }
    }
    return voucher;
  },
  removeVoucher: async (id: string) => {
    const voucher = await call<Voucher | null>("get", "vouchers", id);
    if (!voucher) throw new Error("Voucher not found");

    // Money receipts created from invoice payment: reverse sales paid + matching ledger
    if (voucher.type === "receipt" && voucher.refType === "sales" && voucher.refId) {
      const order = await call<SalesOrder | null>("get", "sales", voucher.refId);
      if (order) {
        const paid = Math.max(0, (order.paid || 0) - voucher.amount);
        let status: SalesStatus = order.status;
        if (order.status === "paid" && paid < order.total) {
          status = paid > 0 ? "invoiced" : "confirmed";
        }
        await call("update", "sales", order.id, { paid, status });
      }
      const ledger = await call<LedgerEntry[]>("list", "ledger");
      const byVoucherNo = ledger.filter(
        (e) =>
          e.refType === "sales" &&
          e.refId === voucher.refId &&
          e.direction === "in" &&
          e.amount === voucher.amount &&
          (e.notes || "").includes(voucher.voucherNo),
      );
      const byOrderNo = ledger
        .filter(
          (e) =>
            e.refType === "sales" &&
            e.refId === voucher.refId &&
            e.direction === "in" &&
            e.amount === voucher.amount &&
            (e.notes || "").includes(voucher.refNo || ""),
        )
        .sort((a, b) => b.date.localeCompare(a.date));
      const toRemove = byVoucherNo.length
        ? byVoucherNo.slice(0, 1)
        : byOrderNo.length
          ? byOrderNo.slice(0, 1)
          : ledger.filter((e) => e.refType === "voucher" && e.refId === id);
      for (const entry of toRemove) {
        await call("remove", "ledger", entry.id);
      }
      return call<{ ok: true }>("remove", "vouchers", id);
    }

    const ledger = await call<LedgerEntry[]>("list", "ledger");
    for (const entry of ledger.filter((e) => e.refType === "voucher" && e.refId === id)) {
      await call("remove", "ledger", entry.id);
    }
    return call<{ ok: true }>("remove", "vouchers", id);
  },
  listCoa: () => call<ChartOfAccount[]>("list", "chartOfAccounts"),
  createCoa: (data: Omit<ChartOfAccount, "id" | "createdAt">) =>
    call<ChartOfAccount>("create", "chartOfAccounts", undefined, {
      ...data,
      createdAt: new Date().toISOString(),
    }),
  updateCoa: (id: string, data: Partial<ChartOfAccount>) =>
    call<ChartOfAccount>("update", "chartOfAccounts", id, data),
  removeCoa: (id: string) => call<{ ok: true }>("remove", "chartOfAccounts", id),

  listAssets: () => call<BusinessAsset[]>("list", "assets"),
  createAsset: (data: Omit<BusinessAsset, "id" | "createdAt">) =>
    call<BusinessAsset>("create", "assets", undefined, {
      ...data,
      createdAt: new Date().toISOString(),
    }),
  updateAsset: (id: string, data: Partial<BusinessAsset>) =>
    call<BusinessAsset>("update", "assets", id, data),
  removeAsset: (id: string) => call<{ ok: true }>("remove", "assets", id),
};

export const hrService = {
  listEmployees: () => call<Employee[]>("list", "employees"),
  getEmployee: (id: string) => call<Employee | null>("get", "employees", id),
  createEmployee: (data: Omit<Employee, "id" | "createdAt" | "employeeNo">) =>
    call<Employee>("create", "employees", undefined, {
      ...data,
      employeeNo: genOrderNo("EMP"),
      createdAt: new Date().toISOString(),
    }),
  updateEmployee: (id: string, data: Partial<Employee>) => {
    const { createdAt: _createdAt, ...rest } = data;
    return call<Employee>("update", "employees", id, rest);
  },
  removeEmployee: (id: string) => call<{ ok: true }>("remove", "employees", id),
  listPayroll: () => call<PayrollRun[]>("list", "payroll"),
  createPayroll: async (data: Omit<PayrollRun, "id" | "createdAt" | "net" | "status">) => {
    const net = data.basic + data.bonus + data.allowance - data.deduction;
    return call<PayrollRun>("create", "payroll", undefined, {
      ...data,
      net,
      status: "draft",
      createdAt: new Date().toISOString(),
    });
  },
  updatePayroll: async (
    id: string,
    data: Partial<Pick<PayrollRun, "bonus" | "allowance" | "deduction" | "basic" | "month">>,
  ) => {
    const run = await call<PayrollRun | null>("get", "payroll", id);
    if (!run) throw new Error("Payroll not found");
    if (run.status !== "draft") throw new Error("Only draft payslips can be edited");
    const basic = data.basic ?? run.basic;
    const bonus = data.bonus ?? run.bonus;
    const allowance = data.allowance ?? run.allowance;
    const deduction = data.deduction ?? run.deduction;
    return call<PayrollRun>("update", "payroll", id, {
      ...data,
      net: basic + bonus + allowance - deduction,
    });
  },
  removePayroll: async (id: string) => {
    const run = await call<PayrollRun | null>("get", "payroll", id);
    if (!run) throw new Error("Payroll not found");
    if (run.status !== "draft") throw new Error("Only draft payslips can be deleted");
    const ledger = await call<LedgerEntry[]>("list", "ledger");
    for (const entry of ledger.filter((e) => e.refType === "payroll" && e.refId === id)) {
      await call("remove", "ledger", entry.id);
    }
    const vouchers = await call<Voucher[]>("list", "vouchers");
    for (const v of vouchers.filter((x) => x.refType === "payroll" && x.refId === id)) {
      await call("remove", "vouchers", v.id);
    }
    return call<{ ok: true }>("remove", "payroll", id);
  },
  payPayroll: async (id: string, method: PaymentMethod = "bank") => {
    const run = await call<PayrollRun | null>("get", "payroll", id);
    if (!run) throw new Error("Payroll not found");
    if (run.status === "paid") throw new Error("Already paid");
    const account = method === "cheque" || method === "mobile" ? "bank" : method;
    const payDate = new Date().toISOString();
    const voucher = await call<Voucher>("create", "vouchers", undefined, {
      voucherNo: genOrderNo("PV"),
      type: "payment",
      date: toVoucherDate(payDate),
      account,
      amount: run.net,
      partyType: "employee",
      partyId: run.employeeId,
      partyName: run.employeeName,
      notes: `Salary ${run.employeeName} · ${run.month}`,
      refType: "payroll",
      refId: id,
      createdAt: payDate,
    });
    await postLedger({
      date: payDate,
      account,
      direction: "out",
      amount: run.net,
      category: "expense",
      refType: "payroll",
      refId: id,
      notes: `Salary ${run.employeeName} · ${run.month} (${voucher.voucherNo})`,
    });
    return call<PayrollRun>("update", "payroll", id, {
      status: "paid",
      paidAt: payDate,
      paymentMethod: method,
    });
  },
};
