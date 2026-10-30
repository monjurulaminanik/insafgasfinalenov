import type {
  Customer,
  Cylinder,
  CylinderMovement,
  Product,
  StockMovement,
  Supplier,
} from "@/types";
import { parseRecordTime, type DateRange } from "@/lib/date-range";

export type CylinderHeadKind = "customer" | "supplier" | "warehouse";

export type CylinderLedgerLine = {
  id: string;
  date: string;
  productName: string;
  serial?: string;
  delivered: number;
  received: number;
  balance: number;
};

export type CylinderHeadReport = {
  id: string;
  kind: CylinderHeadKind;
  name: string;
  delivered: number;
  received: number;
  balance: number;
  lines: CylinderLedgerLine[];
};

type RawHit = {
  date: string;
  productName: string;
  serial?: string;
  delivered: number;
  received: number;
  sort: number;
  key: string;
};

const SUPPLIER_LOC = /supplier|plant|bashundhara|linde|omera|refill/i;
const WAREHOUSE_LOC = /warehouse|gudam|\bwh\b/i;

export const SINGLE_WAREHOUSE_NAME = "Warehouse";
export const SINGLE_WAREHOUSE_ID = "wh:Warehouse";

export function isWarehouseLocation(loc?: string): boolean {
  const name = (loc || "").trim();
  if (!name) return false;
  if (SUPPLIER_LOC.test(name)) return false;
  return WAREHOUSE_LOC.test(name) || name.toLowerCase() === "warehouse";
}

export function isCylinderProduct(p?: Product): boolean {
  if (!p) return false;
  if (p.productType === "cylinder") return true;
  if (p.productType === "gas" || p.productType === "product") return false;
  const uom = String(p.uom || "").toLowerCase();
  if (uom === "cyl") return true;
  if (uom === "kg" || uom === "ltr" || uom === "pcs") return false;
  const cat = String(p.category || "").toLowerCase();
  return cat.includes("cylinder") || cat === "cylinder";
}

function productNameOf(cyl: Cylinder | undefined, products: Product[]) {
  if (!cyl) return "Cylinder";
  return products.find((p) => p.id === cyl.productId)?.name ?? cyl.serialNumber;
}

function matchByName<T extends { id: string; name: string }>(
  loc: string | undefined,
  parties: T[],
): T | undefined {
  const n = (loc || "").trim().toLowerCase();
  if (!n) return undefined;
  return parties.find((p) => {
    const pn = p.name.toLowerCase();
    if (n === pn || n.includes(pn) || pn.includes(n)) return true;
    return pn
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
      .some((w) => n.includes(w));
  });
}

function warehouseName(loc?: string) {
  return isWarehouseLocation(loc) ? SINGLE_WAREHOUSE_NAME : "";
}

/** Party heads: still with them. Warehouse: in hand. */
function applyDelta(kind: CylinderHeadKind, delivered: number, received: number) {
  return kind === "warehouse" ? received - delivered : delivered - received;
}

export function buildCylinderLedger(opts: {
  cylinders: Cylinder[];
  movements: CylinderMovement[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  range: DateRange;
  productId?: string;
  stockMovements?: StockMovement[];
}): CylinderHeadReport[] {
  const {
    cylinders,
    movements,
    products,
    customers,
    suppliers,
    range,
    productId,
    stockMovements = [],
  } = opts;
  const cylMap = new Map(cylinders.map((c) => [c.id, c]));
  const fromTs = range.preset !== "all" && range.from ? parseRecordTime(range.from) : null;
  const toTs =
    range.preset !== "all" && range.to ? parseRecordTime(`${range.to}T23:59:59.999`) : null;

  const buckets = new Map<string, { kind: CylinderHeadKind; name: string; hits: RawHit[] }>();

  const ensure = (id: string, kind: CylinderHeadKind, name: string) => {
    if (!buckets.has(id)) buckets.set(id, { kind, name, hits: [] });
    return buckets.get(id)!;
  };

  const push = (
    id: string,
    kind: CylinderHeadKind,
    name: string,
    m: Partial<CylinderMovement> | Record<string, any>,
    delivered: number,
    received: number,
    customDate?: string,
    customProduct?: string,
    customSerial?: string,
  ) => {
    if (!id || (!delivered && !received)) return;
    const cyl = m.cylinderId ? cylMap.get(m.cylinderId) : undefined;
    const pId = (m as any).productId || cyl?.productId;
    if (productId && pId !== productId) return;

    const hitDate =
      customDate ||
      (m as any).timestamp ||
      (m as any).date ||
      (m as any).createdAt ||
      new Date().toISOString();

    const pName = customProduct || productNameOf(cyl, products);
    const sn = customSerial !== undefined ? customSerial : cyl?.serialNumber;

    ensure(id, kind, name).hits.push({
      date: hitDate,
      productName: pName,
      serial: sn,
      delivered,
      received,
      sort: parseRecordTime(hitDate) ?? 0,
      key: `${(m as any).id || Date.now()}:${id}:${delivered}:${received}:${hitDate}`,
    });
  };

  const selectedProduct = productId ? products.find((p) => p.id === productId) : undefined;
  const isNonCylinderProduct =
    selectedProduct &&
    !isCylinderProduct(selectedProduct) &&
    stockMovements &&
    stockMovements.length > 0;

  if (isNonCylinderProduct) {
    // Synchronize Warehouse stock with existing Gas/Product Inventory using authoritative stockMovements
    const pMoves = stockMovements
      .filter((m) => m.productId === productId)
      .slice()
      .sort((a, b) => (parseRecordTime(a.date) ?? 0) - (parseRecordTime(b.date) ?? 0));

    for (const sm of pMoves) {
      const qty = Number(sm.quantity) || 0;
      if (qty <= 0) continue;
      // Do not count drafts, quotations, unconfirmed deliveries, or reservations as physical stock movements
      if (/^Reserved\b/i.test(sm.notes || "")) continue;

      const hitDate = sm.date || (sm as any).createdAt || new Date().toISOString();
      const cust = matchByName(sm.notes, customers);
      const supp = matchByName(sm.notes, suppliers);

      const isReverse = /Reverse/i.test(sm.notes || "");
      if (isReverse) {
        if (
          (sm.refType === "sales" || sm.refType === "delivery") &&
          (sm.type === "in" || sm.type === "return")
        ) {
          push(
            SINGLE_WAREHOUSE_ID,
            "warehouse",
            SINGLE_WAREHOUSE_NAME,
            sm,
            -qty,
            0,
            hitDate,
            selectedProduct.name,
          );
          if (cust)
            push(`c:${cust.id}`, "customer", cust.name, sm, -qty, 0, hitDate, selectedProduct.name);
          continue;
        }
        if (sm.refType === "purchase" && sm.type === "out") {
          push(
            SINGLE_WAREHOUSE_ID,
            "warehouse",
            SINGLE_WAREHOUSE_NAME,
            sm,
            0,
            -qty,
            hitDate,
            selectedProduct.name,
          );
          if (supp)
            push(`s:${supp.id}`, "supplier", supp.name, sm, 0, -qty, hitDate, selectedProduct.name);
          continue;
        }
      }

      const isIn =
        sm.type === "in" ||
        sm.direction === "in" ||
        sm.type === "return" ||
        sm.movementType === "RECEIPT" ||
        sm.movementType === "PURCHASE_RECEIVED" ||
        sm.movementType === "ADJUSTMENT_IN" ||
        sm.movementType === "RETURN" ||
        sm.movementType === "SALES_RETURN";

      const isOut =
        sm.type === "out" ||
        sm.direction === "out" ||
        sm.movementType === "SALE_ISSUE" ||
        sm.movementType === "ADJUSTMENT_OUT" ||
        sm.movementType === "DAMAGE" ||
        sm.movementType === "LOSS" ||
        sm.movementType === "PURCHASE_RETURN";

      if (isIn) {
        push(
          SINGLE_WAREHOUSE_ID,
          "warehouse",
          SINGLE_WAREHOUSE_NAME,
          sm,
          0,
          qty,
          hitDate,
          selectedProduct.name,
        );
        if (sm.type === "return" || sm.movementType === "SALES_RETURN") {
          if (cust)
            push(`c:${cust.id}`, "customer", cust.name, sm, 0, qty, hitDate, selectedProduct.name);
        }
      } else if (isOut) {
        push(
          SINGLE_WAREHOUSE_ID,
          "warehouse",
          SINGLE_WAREHOUSE_NAME,
          sm,
          qty,
          0,
          hitDate,
          selectedProduct.name,
        );
        if (sm.movementType === "PURCHASE_RETURN") {
          if (supp)
            push(`s:${supp.id}`, "supplier", supp.name, sm, qty, 0, hitDate, selectedProduct.name);
        } else if (cust) {
          push(`c:${cust.id}`, "customer", cust.name, sm, qty, 0, hitDate, selectedProduct.name);
        }
      }
    }
  } else {
    // Cylinder tracking movements
    const sorted = movements.slice().sort((a, b) => {
      const ta = a.timestamp || (a as any).date || (a as any).createdAt;
      const tb = b.timestamp || (b as any).date || (b as any).createdAt;
      return (parseRecordTime(ta) ?? 0) - (parseRecordTime(tb) ?? 0);
    });

    for (const m of sorted) {
      const cust =
        (m.customerId ? customers.find((c) => c.id === m.customerId) : undefined) ||
        matchByName(m.toLocation, customers) ||
        matchByName(m.fromLocation, customers);
      const supp =
        (m.supplierId ? suppliers.find((s) => s.id === m.supplierId) : undefined) ||
        matchByName(m.fromLocation, suppliers) ||
        matchByName(m.toLocation, suppliers);
      const fromWh = warehouseName(m.fromLocation);
      const toWh = warehouseName(m.toLocation);
      const hitDate =
        m.timestamp || (m as any).date || (m as any).createdAt || new Date().toISOString();

      if (m.type === "issued") {
        if (cust) push(`c:${cust.id}`, "customer", cust.name, m, 1, 0, hitDate);
        if (fromWh || !m.fromLocation)
          push(SINGLE_WAREHOUSE_ID, "warehouse", SINGLE_WAREHOUSE_NAME, m, 1, 0, hitDate);
      } else if (m.type === "returned") {
        if (cust) push(`c:${cust.id}`, "customer", cust.name, m, 0, 1, hitDate);
        if (toWh) push(SINGLE_WAREHOUSE_ID, "warehouse", SINGLE_WAREHOUSE_NAME, m, 0, 1, hitDate);
        if (supp) push(`s:${supp.id}`, "supplier", supp.name, m, 1, 0, hitDate);
      } else if (m.type === "received") {
        if (supp) push(`s:${supp.id}`, "supplier", supp.name, m, 0, 1, hitDate);
        if (toWh || !m.toLocation)
          push(SINGLE_WAREHOUSE_ID, "warehouse", SINGLE_WAREHOUSE_NAME, m, 0, 1, hitDate);
      } else if (m.type === "refilled" || m.type === "transferred") {
        if (fromWh && !toWh)
          push(SINGLE_WAREHOUSE_ID, "warehouse", SINGLE_WAREHOUSE_NAME, m, 1, 0, hitDate);
        if (toWh && !fromWh)
          push(SINGLE_WAREHOUSE_ID, "warehouse", SINGLE_WAREHOUSE_NAME, m, 0, 1, hitDate);
        if (supp && SUPPLIER_LOC.test(m.toLocation || ""))
          push(`s:${supp.id}`, "supplier", supp.name, m, 1, 0, hitDate);
        if (supp && SUPPLIER_LOC.test(m.fromLocation || ""))
          push(`s:${supp.id}`, "supplier", supp.name, m, 0, 1, hitDate);
      }
    }

    for (const cyl of cylinders) {
      if (productId && cyl.productId !== productId) continue;
      const hasMv = movements.some((m) => m.cylinderId === cyl.id);
      if (hasMv) continue;
      const hitDate = cyl.lastMovementAt || cyl.createdAt || new Date().toISOString();
      const fake: CylinderMovement = {
        id: `snap-${cyl.id}`,
        cylinderId: cyl.id,
        type: cyl.status === "at_customer" ? "issued" : "received",
        timestamp: hitDate,
        by: "System",
        customerId: cyl.customerId,
        toLocation: cyl.location,
        fromLocation: cyl.location,
      };
      if (cyl.status === "at_customer" && cyl.customerId) {
        const cust = customers.find((c) => c.id === cyl.customerId);
        push(`c:${cyl.customerId}`, "customer", cust?.name || cyl.location, fake, 1, 0, hitDate);
      } else if (cyl.status === "in_stock") {
        push(SINGLE_WAREHOUSE_ID, "warehouse", SINGLE_WAREHOUSE_NAME, fake, 0, 1, hitDate);
      } else if (SUPPLIER_LOC.test(cyl.location || "")) {
        const supp = matchByName(cyl.location, suppliers);
        if (supp) push(`s:${supp.id}`, "supplier", supp.name, fake, 1, 0, hitDate);
        else push(`suploc:${cyl.location}`, "supplier", cyl.location, fake, 1, 0, hitDate);
      }
    }
  }

  const kindOrder: CylinderHeadKind[] = ["warehouse", "customer", "supplier"];
  const reports: CylinderHeadReport[] = [];

  for (const [id, bucket] of buckets) {
    bucket.hits.sort((a, b) => a.sort - b.sort);
    let opening = 0;
    const period: RawHit[] = [];
    for (const h of bucket.hits) {
      const t = h.sort;
      if (fromTs != null && t < fromTs) {
        opening += applyDelta(bucket.kind, h.delivered, h.received);
        continue;
      }
      if (toTs != null && t > toTs) continue;
      period.push(h);
    }

    const lines: CylinderLedgerLine[] = [];
    let run = opening;
    lines.push({
      id: `${id}-open`,
      date: range.from || bucket.hits[0]?.date || new Date().toISOString(),
      productName: "Opening",
      delivered: 0,
      received: 0,
      balance: opening,
    });

    let del = 0;
    let rec = 0;
    for (const h of period) {
      del += h.delivered;
      rec += h.received;
      run += applyDelta(bucket.kind, h.delivered, h.received);
      lines.push({
        id: h.key,
        date: h.date,
        productName: h.productName,
        serial: h.serial,
        delivered: h.delivered,
        received: h.received,
        balance: run,
      });
    }

    reports.push({
      id,
      kind: bucket.kind,
      name: bucket.name,
      delivered: del,
      received: rec,
      balance: run,
      lines,
    });
  }

  reports.sort((a, b) => {
    const ko = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);
    if (ko !== 0) return ko;
    return a.name.localeCompare(b.name);
  });

  return reports;
}
