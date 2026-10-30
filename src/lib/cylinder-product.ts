import type { Cylinder, CylinderStatus, LineItem, Product } from "../types/index.ts";

/** Serialized cylinder tracking (loan / issue / return). Gas-only products never move. */
export function isCylinderProduct(p?: Pick<Product, "uom" | "productType"> | null) {
  if (!p) return false;
  if (p.productType === "gas" || p.productType === "product") return false;
  if (p.productType === "cylinder") return true;
  return p.uom === "cyl";
}

export type SaleItemType = "gas" | "cylinder" | "product";

export function defaultProductSaleItemType(
  p?: Pick<Product, "uom" | "productType"> | null,
): SaleItemType {
  if (!p) return "gas";
  if (p.productType === "product" || p.uom === "pcs") return "product";
  if (p.productType === "cylinder" || p.uom === "cyl") return "cylinder";
  if (p.productType === "gas" || p.uom === "kg" || p.uom === "ltr") return "gas";
  return isCylinderProduct(p) ? "cylinder" : "gas";
}

/** Line classification. Preserves saved itemType. Falls back to product type (Product, Cylinder, Gas). */
export function saleItemType(
  item?: Pick<LineItem, "itemType"> | null,
  p?: Pick<Product, "uom" | "productType"> | null,
): SaleItemType {
  if (item?.itemType === "gas" || item?.itemType === "cylinder" || item?.itemType === "product") {
    return item.itemType;
  }
  return defaultProductSaleItemType(p);
}

/** Serial/cylinder movement applies only to Cylinder-typed lines (or historical cylinder products). */
export function isCylinderTrackedLine(
  item?: Pick<LineItem, "itemType"> | null,
  p?: Pick<Product, "uom" | "productType"> | null,
) {
  const kind = saleItemType(item, p);
  if (kind === "gas" || kind === "product") return false;
  if (item?.itemType === "cylinder") return true;
  return isCylinderProduct(p);
}

/** Company cylinder on a sales line that should not hit the invoice. */
export function isCylinderMovementOnly(
  item: Pick<LineItem, "price" | "sellCylinder" | "itemType">,
  p?: Pick<Product, "uom" | "productType"> | null,
) {
  if (!isCylinderTrackedLine(item, p)) return false;
  if (item.sellCylinder) return false;
  return !(Number(item.price) > 0);
}

export function isCylinderSaleLine(
  item: Pick<LineItem, "price" | "sellCylinder" | "itemType">,
  p?: Pick<Product, "uom" | "productType"> | null,
) {
  if (!isCylinderTrackedLine(item, p)) return false;
  if (p?.productType !== "cylinder") return false;
  return Boolean(item.sellCylinder) || Number(item.price) > 0;
}

export function lineFromProduct(p: Product, itemType?: SaleItemType): LineItem {
  const kind = itemType ?? defaultProductSaleItemType(p);
  const movementOnly = kind === "cylinder" && p.productType === "cylinder";
  return {
    productId: p.id,
    productName: p.name,
    quantity: 1,
    price: movementOnly ? 0 : p.price,
    taxRate: 0,
    sellCylinder: false,
    itemType: kind,
    category: p.category,
  };
}

export const CYLINDER_SIZE_OPTIONS = [12, 35, 45] as const;

export function cylinderIsEmpty(c: Pick<Cylinder, "status" | "fillLevel">) {
  if (c.fillLevel === "empty") return true;
  if (c.fillLevel === "full") return false;
  // Legacy rows without fillLevel: only refilling is treated as empty.
  return c.status === "refilling";
}

export function cylinderIsFullStock(c: Pick<Cylinder, "status" | "fillLevel" | "supplierId">) {
  return c.status === "in_stock" && !c.supplierId && !cylinderIsEmpty(c);
}

export function cylinderAtCustomer(c: Pick<Cylinder, "status">) {
  return c.status === "at_customer";
}

export function cylinderAtSupplier(c: Pick<Cylinder, "status" | "supplierId">) {
  return (
    Boolean(c.supplierId) &&
    c.status !== "damaged" &&
    c.status !== "lost" &&
    c.status !== "at_customer"
  );
}

export function cylinderWarehouseEmpty(c: Pick<Cylinder, "status" | "fillLevel" | "supplierId">) {
  return (
    !c.supplierId &&
    c.status !== "at_customer" &&
    c.status !== "damaged" &&
    c.status !== "lost" &&
    c.status !== "in_transit" &&
    cylinderIsEmpty(c)
  );
}

/** Map existing cylinder statuses into overview buckets. */
export function isCompanyOwned(c: Pick<Cylinder, "ownedBy">) {
  return c.ownedBy !== "customer";
}

/** Scrap / write-off / stock-out — no longer active company inventory. */
export function isInactiveCompanyCylinder(c: Pick<Cylinder, "status">) {
  return c.status === "scrapped" || c.status === "written_off" || c.status === "stock_out";
}

/** Company-owned cylinders by location — never typed in. */
export function companyOwnedLocations(
  cylinders: Pick<Cylinder, "status" | "fillLevel" | "supplierId" | "ownedBy">[],
) {
  const company = cylinders.filter((c) => isCompanyOwned(c) && !isInactiveCompanyCylinder(c));
  let warehouse = 0;
  let customers = 0;
  let suppliers = 0;
  let inRefill = 0;
  let lost = 0;
  let damaged = 0;
  for (const c of company) {
    if (c.status === "lost") lost += 1;
    else if (c.status === "damaged") damaged += 1;
    else if (cylinderAtSupplier(c)) {
      suppliers += 1;
      inRefill += 1;
    } else if (c.status === "at_customer") customers += 1;
    else warehouse += 1;
  }
  return { owned: company.length, warehouse, customers, suppliers, inRefill, lost, damaged };
}

export function cylinderOverviewCounts(
  cylinders: Pick<Cylinder, "status" | "fillLevel" | "supplierId">[],
) {
  let full = 0;
  let empty = 0;
  let refillPending = 0;
  let inTransit = 0;
  const active = cylinders.filter((c) => !isInactiveCompanyCylinder(c));
  for (const c of active) {
    if (c.status === "in_transit") inTransit += 1;
    if (cylinderAtSupplier(c)) refillPending += 1;
    if (cylinderIsFullStock(c)) full += 1;
    else if (
      cylinderIsEmpty(c) &&
      c.status !== "at_customer" &&
      c.status !== "in_transit" &&
      !cylinderAtSupplier(c)
    )
      empty += 1;
  }
  return { total: active.length, full, empty, refillPending, inTransit };
}

/** @deprecated use cylinderOverviewCounts */
export function cylinderStatusCounts(cylinders: Pick<Cylinder, "status">[]) {
  const c = cylinderOverviewCounts(cylinders);
  return { total: c.total, filled: c.full, empty: c.empty, refillPending: c.refillPending };
}

export function cylinderFillBucket(
  status: CylinderStatus,
): "filled" | "empty" | "refill" | "transit" {
  if (status === "refilling") return "refill";
  if (status === "in_transit") return "transit";
  if (status === "in_stock") return "filled";
  return "empty";
}

export function matchesCylinderSize(capacity: number, size: number) {
  return Math.abs((capacity || 0) - size) < 0.5;
}

export function parseSerials(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]+/)) {
    const s = raw.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function pickFifo(
  cylinders: Cylinder[],
  productId: string,
  qty: number,
  exclude = new Set<string>(),
) {
  return cylinders
    .filter(
      (c) =>
        c.productId === productId &&
        (c.status === "in_stock" || c.status === "in_transit") &&
        !cylinderIsEmpty(c) &&
        !exclude.has(c.id),
    )
    .sort((a, b) => (a.lastMovementAt || "").localeCompare(b.lastMovementAt || ""))
    .slice(0, qty)
    .map((c) => c.id);
}

export function suggestSerials(code: string, qty: number, existingSerials: string[] = []) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = (code || "CYL").replace(/\s+/g, "").toUpperCase();
  const namespace = `${prefix}-${stamp}-`;
  let max = 0;
  for (const raw of existingSerials) {
    const serial = String(raw || "")
      .trim()
      .toUpperCase();
    if (!serial.startsWith(namespace)) continue;
    const n = Number.parseInt(serial.slice(namespace.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Array.from(
    { length: qty },
    (_, i) => `${prefix}-${stamp}-${String(max + i + 1).padStart(3, "0")}`,
  );
}
