import type { Product, StockMovement } from "../types/index.ts";
import { parseRecordTime, type DateRange } from "./date-range.ts";

export type StockLedgerLine = {
  id: string;
  date: string;
  particulars: string;
  qtyIn: number;
  qtyOut: number;
  inHand: number;
  unitCost: number;
  valuation: number;
};

export type ProductStockReport = {
  id: string;
  code: string;
  name: string;
  openingQty: number;
  qtyIn: number;
  qtyOut: number;
  inHand: number;
  unitCost: number;
  valuation: number;
  lines: StockLedgerLine[];
};

export function isMovementIn(m: StockMovement): boolean {
  // Pure reservation notes should not affect physical on hand
  if (/^Reserved\b/i.test(m.notes || "")) return false;
  if (m.direction === "in") return true;
  if (m.direction === "out") return false;
  // Supplier return means company stock is returned to supplier (outbound from company)
  if (m.refType === "purchase" && (m.type === "return" || m.movementType === "RETURN" || m.movementType === "PURCHASE_RETURN")) {
    return false;
  }
  if (m.movementType) {
    return (
      m.movementType === "RECEIPT" ||
      m.movementType === "PURCHASE_RECEIVED" ||
      m.movementType === "RETURN" ||
      m.movementType === "SALES_RETURN" ||
      m.movementType === "ADJUSTMENT_IN" ||
      m.movementType === "TRANSFER_IN"
    );
  }
  if (m.type === "in" || m.type === "return") return true;
  if (m.type === "out") return false;
  if (m.type === "adjust") {
    return (m.quantity || 0) >= 0;
  }
  return false;
}

export function isMovementOut(m: StockMovement): boolean {
  // Pure reservation notes should not affect physical on hand
  if (/^Reserved\b/i.test(m.notes || "")) return false;
  if (m.direction === "out") return true;
  if (m.direction === "in") return false;
  // Supplier return means company stock is returned to supplier (outbound from company)
  if (m.refType === "purchase" && (m.type === "return" || m.movementType === "RETURN" || m.movementType === "PURCHASE_RETURN")) {
    return true;
  }
  if (m.movementType) {
    return (
      m.movementType === "SALE_ISSUE" ||
      m.movementType === "PURCHASE_RETURN" ||
      m.movementType === "ADJUSTMENT_OUT" ||
      m.movementType === "DAMAGE" ||
      m.movementType === "LOSS" ||
      m.movementType === "TRANSFER_OUT"
    );
  }
  if (m.type === "out") return true;
  if (m.type === "in" || m.type === "return") return false;
  if (m.type === "adjust") {
    return (m.quantity || 0) < 0;
  }
  return false;
}

export function getMovementQtyIn(m: StockMovement): number {
  if (isMovementIn(m)) return Math.abs(m.quantity || 0);
  return 0;
}

export function getMovementQtyOut(m: StockMovement): number {
  if (isMovementOut(m)) return Math.abs(m.quantity || 0);
  return 0;
}

function refLabel(m: StockMovement) {
  const bits = [m.notes, m.refType, m.refId].filter(Boolean);
  if (bits.length) return bits[0] as string;
  if (isMovementIn(m)) return "Stock In";
  if (isMovementOut(m)) return "Stock Out";
  return m.type;
}

export function buildStockReport(
  products: Product[],
  movements: StockMovement[],
  range: DateRange,
): ProductStockReport[] {
  const fromTs =
    range.preset !== "all" && range.from ? parseRecordTime(`${range.from}T00:00:00`) : null;
  const toTs = range.preset !== "all" && range.to ? parseRecordTime(`${range.to}T23:59:59`) : null;

  const byProduct = new Map<string, StockMovement[]>();
  for (const m of movements) {
    const list = byProduct.get(m.productId) ?? [];
    list.push(m);
    byProduct.set(m.productId, list);
  }

  return products
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const all = (byProduct.get(p.id) ?? [])
        .slice()
        .sort((a, b) => (parseRecordTime(a.date) ?? 0) - (parseRecordTime(b.date) ?? 0));

      // Check if an explicit initial stock adjustment exists
      const initMovement = all.find(
        (m) =>
          m.refType === "adjustment" &&
          (m.refId?.startsWith("INIT-") || /initial/i.test(m.notes || "")),
      );

      const nonInitMovements = all.filter((m) => m !== initMovement);
      let totalIn = 0;
      let totalOut = 0;
      for (const m of nonInitMovements) {
        const qty = Number(m.quantity) || 0;
        if (qty <= 0) continue;
        const isReverse = /Reverse/i.test(m.notes || "");
        if (isReverse) {
          if ((m.refType === "sales" || m.refType === "delivery") && (m.type === "in" || m.type === "return")) {
            totalOut = Math.max(0, totalOut - qty);
            continue;
          }
          if (m.refType === "purchase" && m.type === "out") {
            totalIn = Math.max(0, totalIn - qty);
            continue;
          }
        }
        if (isMovementIn(m)) {
          totalIn += qty;
        } else if (isMovementOut(m)) {
          totalOut += qty;
        }
      }

      const baseOpening = initMovement
        ? Math.abs(initMovement.quantity || 0)
        : p.initialStock != null
          ? p.initialStock
          : nonInitMovements.length === 0
            ? (p.stock ?? 0)
            : Math.max(0, (p.stock ?? 0) + totalOut - totalIn);

      let openingQty = baseOpening;
      let effectiveCost = p.cost ?? 0;
      const period: StockMovement[] = [];

      for (const m of nonInitMovements) {
        const t = parseRecordTime(m.date) ?? 0;
        const qIn = getMovementQtyIn(m);
        const qOut = getMovementQtyOut(m);

        const isReverse = /Reverse/i.test(m.notes || "");
        const qty = Number(m.quantity) || 0;

        if (fromTs != null && t < fromTs) {
          if (isReverse) {
            if ((m.refType === "sales" || m.refType === "delivery") && (m.type === "in" || m.type === "return")) {
              openingQty += qty;
            } else if (m.refType === "purchase" && m.type === "out") {
              openingQty = Math.max(0, openingQty - qty);
            }
          } else {
            openingQty += qIn - qOut;
          }
          if (m.unitCost != null && m.unitCost > 0) effectiveCost = m.unitCost;
          continue;
        }

        if (toTs != null && t > toTs) {
          continue;
        }

        period.push(m);
      }

      const lines: StockLedgerLine[] = [];
      let run = openingQty;
      const openingDate = range.from || p.createdAt || new Date().toISOString();

      lines.push({
        id: `${p.id}-open`,
        date: openingDate,
        particulars: "Opening",
        qtyIn: 0,
        qtyOut: 0,
        inHand: openingQty,
        unitCost: effectiveCost,
        valuation: openingQty * effectiveCost,
      });

      let periodIn = 0;
      let periodOut = 0;

      for (const m of period) {
        const qty = Number(m.quantity) || 0;
        const isReverse = /Reverse/i.test(m.notes || "");
        let qIn = 0;
        let qOut = 0;

        if (isReverse) {
          if ((m.refType === "sales" || m.refType === "delivery") && (m.type === "in" || m.type === "return")) {
            periodOut = Math.max(0, periodOut - qty);
            run = run + qty;
            qIn = qty;
          } else if (m.refType === "purchase" && m.type === "out") {
            periodIn = Math.max(0, periodIn - qty);
            run = Math.max(0, run - qty);
            qOut = qty;
          }
        } else {
          qIn = getMovementQtyIn(m);
          qOut = getMovementQtyOut(m);
          periodIn += qIn;
          periodOut += qOut;
          run = run + qIn - qOut;
        }

        if (m.unitCost != null && m.unitCost > 0) effectiveCost = m.unitCost;

        const lineCost = m.unitCost ?? effectiveCost;
        lines.push({
          id: m.id,
          date: m.date,
          particulars: refLabel(m),
          qtyIn: qIn,
          qtyOut: qOut,
          inHand: run,
          unitCost: lineCost,
          valuation: run * lineCost,
        });
      }

      const inHand = openingQty + periodIn - periodOut;
      const unitCost = p.cost ?? effectiveCost;
      const valuation = inHand * unitCost;

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        openingQty,
        qtyIn: periodIn,
        qtyOut: periodOut,
        inHand,
        unitCost,
        valuation,
        lines,
      };
    });
}
