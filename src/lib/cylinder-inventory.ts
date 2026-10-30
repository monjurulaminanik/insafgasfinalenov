import type { Cylinder, Delivery, Product, SalesOrder, StockMovement } from "../types/index.ts";
import {
  cylinderAtCustomer,
  cylinderAtSupplier,
  cylinderIsEmpty,
  cylinderIsFullStock,
  cylinderWarehouseEmpty,
  isCylinderProduct,
  isInactiveCompanyCylinder,
} from "./cylinder-product.ts";
import { buildStockReport } from "./stock-report.ts";

export type InventoryStockStatus = "normal" | "low" | "out";

export type ProductInventoryRow = {
  id: string;
  sl: number;
  productId: string;
  name: string;
  category?: string;
  total: number;
  full: number;
  reserved: number;
  delivered: number;
  empty: number;
  refillPending: number;
  withCustomer: number;
  withSupplier: number;
  damaged: number;
  lost: number;
  available: number;
  reorderLevel: number;
  status: InventoryStockStatus;
};

const OPEN_SO = new Set(["confirmed", "invoiced", "paid"]);
const DONE_DELIVERY = new Set(["delivered", "confirmed"]);

export function deliveredQtyByProduct(
  deliveries: Delivery[],
  productId: string,
  salesOrderId?: string,
) {
  let qty = 0;
  for (const d of deliveries) {
    if (!DONE_DELIVERY.has(d.status)) continue;
    if (salesOrderId && d.salesOrderId !== salesOrderId) continue;
    for (const it of d.items) {
      if (it.productId === productId) qty += Number(it.quantity) || 0;
    }
  }
  return qty;
}

/** Open SO qty not yet delivered, excluding orders that already deducted product stock (legacy). */
export function reservedQtyForProduct(
  productId: string,
  sales: SalesOrder[],
  deliveries: Delivery[],
  movements: StockMovement[],
) {
  const deductedSo = new Set(
    movements
      .filter((m) => m.refType === "sales" && m.type === "out" && m.refId)
      .map((m) => m.refId as string),
  );
  let reserved = 0;
  for (const so of sales) {
    if (!OPEN_SO.has(so.status)) continue;
    if (deductedSo.has(so.id)) continue;
    const ordered = so.items
      .filter((it) => it.productId === productId)
      .reduce((a, it) => a + (Number(it.quantity) || 0), 0);
    if (ordered <= 0) continue;
    const delivered = deliveredQtyByProduct(deliveries, productId, so.id);
    reserved += Math.max(0, ordered - delivered);
  }
  return reserved;
}

export function remainingOrderQty(so: SalesOrder, deliveries: Delivery[], productId: string) {
  const ordered = so.items
    .filter((i) => i.productId === productId)
    .reduce((a, i) => a + (Number(i.quantity) || 0), 0);
  return Math.max(0, ordered - deliveredQtyByProduct(deliveries, productId, so.id));
}

export function buildProductInventory(
  products: Product[],
  cylinders: Cylinder[],
  sales: SalesOrder[],
  deliveries: Delivery[],
  movements: StockMovement[],
): ProductInventoryRow[] {
  const stockReport = buildStockReport(products, movements, { preset: "all", from: "", to: "" });
  const stockMap = new Map(stockReport.map((r) => [r.id, r]));

  return products.map((p, idx) => {
    const all = cylinders.filter((c) => c.productId === p.id && !isInactiveCompanyCylinder(c));
    const isCyl = isCylinderProduct(p) || (p.productType !== "gas" && all.length > 0);
    const reserved = reservedQtyForProduct(p.id, sales, deliveries, movements);
    const sr = stockMap.get(p.id);
    const onHand = sr ? sr.inHand : (p.stock ?? 0);

    let total: number;
    let full = onHand;
    let delivered: number;
    let empty: number;
    let refillPending: number;
    let withCustomer = 0;
    let withSupplier = 0;
    let damaged = 0;
    let lost = 0;

    if (isCyl && all.length > 0) {
      withCustomer = all.filter(cylinderAtCustomer).length;
      withSupplier = all.filter(cylinderAtSupplier).length;
      damaged = all.filter((c) => c.status === "damaged").length;
      lost = all.filter((c) => c.status === "lost").length;
      total = all.length;
      delivered = withCustomer;
      empty = all.filter(cylinderWarehouseEmpty).length;
      refillPending = all.filter((c) => cylinderAtSupplier(c)).length;
      full = all.filter(cylinderIsFullStock).length;
    } else {
      total = onHand + reserved;
      delivered = deliveredQtyByProduct(deliveries, p.id);
      empty = 0;
      refillPending = 0;
      full = onHand;
    }

    const available = Math.max(0, (isCyl && all.length > 0 ? full : onHand) - reserved);
    const status: InventoryStockStatus =
      available <= 0 ? "out" : available <= (p.reorderLevel || 0) ? "low" : "normal";

    return {
      id: p.id,
      sl: idx + 1,
      productId: p.id,
      name: p.name,
      category: p.category,
      total,
      full,
      reserved,
      delivered,
      empty,
      refillPending,
      withCustomer,
      withSupplier,
      damaged,
      lost,
      available,
      reorderLevel: p.reorderLevel || 0,
      status,
    };
  });
}

export function sumInventory(rows: ProductInventoryRow[]) {
  return rows.reduce(
    (a, r) => ({
      total: a.total + r.total,
      full: a.full + r.full,
      reserved: a.reserved + r.reserved,
      delivered: a.delivered + r.delivered,
      empty: a.empty + r.empty,
      refillPending: a.refillPending + r.refillPending,
      withCustomer: a.withCustomer + r.withCustomer,
      withSupplier: a.withSupplier + r.withSupplier,
      damaged: a.damaged + r.damaged,
      lost: a.lost + r.lost,
      available: a.available + r.available,
    }),
    {
      total: 0,
      full: 0,
      reserved: 0,
      delivered: 0,
      empty: 0,
      refillPending: 0,
      withCustomer: 0,
      withSupplier: 0,
      damaged: 0,
      lost: 0,
      available: 0,
    },
  );
}
