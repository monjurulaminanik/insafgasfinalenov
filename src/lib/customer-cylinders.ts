import type { Cylinder, CylinderMovement, Product } from "../types/index.ts";

export type PartyCylinderKind = "customer" | "supplier";

export type PartyCylinderBalance = {
  sent: number;
  returned: number;
  remaining: number;
  overdue: number;
  lost: number;
  damaged: number;
};

export type PartyCylinderEvent = {
  id: string;
  date: string;
  type: CylinderMovement["type"];
  typeKey:
    | "cyl.move.fullToCustomer"
    | "cyl.move.emptyFromCustomer"
    | "cyl.move.toSupplier"
    | "cyl.move.fromSupplier"
    | "cyl.move.damaged"
    | "cyl.move.lost";
  productName: string;
  serial?: string;
  sent: number;
  returned: number;
  remaining: number;
  lost: number;
  notes?: string;
};

function forParty(m: CylinderMovement, kind: PartyCylinderKind, id: string) {
  return kind === "customer" ? m.customerId === id : m.supplierId === id;
}

function isSend(kind: PartyCylinderKind, m: CylinderMovement) {
  if (kind === "customer")
    return (m.type === "issued" && !m.sold) || m.purpose === "sent" || m.purpose === "loan";
  return m.type === "transferred" || m.purpose === "refill_sent" || m.purpose === "sent";
}

function isReturn(kind: PartyCylinderKind, m: CylinderMovement) {
  if (kind === "customer") return m.type === "returned" || m.purpose === "return";
  // For suppliers: receiving a purchase order is stock-in, NOT a return of loaned/transferred refill cylinders.
  // Refill return / return from supplier must have purpose refill_return or return, or type refilled/returned without being a purchase receipt.
  if (m.type === "received" && m.purpose !== "refill_return") return false;
  return (
    m.type === "refilled" ||
    m.type === "returned" ||
    m.purpose === "refill_return" ||
    m.purpose === "return"
  );
}

function isLost(m: CylinderMovement) {
  return m.type === "lost" || m.purpose === "lost";
}

function isDamaged(m: CylinderMovement) {
  return m.type === "damaged";
}

function typeKey(kind: PartyCylinderKind, m: CylinderMovement): PartyCylinderEvent["typeKey"] {
  if (isLost(m)) return "cyl.move.lost";
  if (isDamaged(m)) return "cyl.move.damaged";
  if (kind === "supplier") {
    if (isSend(kind, m)) return "cyl.move.toSupplier";
    return "cyl.move.fromSupplier";
  }
  if (isReturn(kind, m)) return "cyl.move.emptyFromCustomer";
  return "cyl.move.fullToCustomer";
}

const movesByCylinder = new WeakMap<CylinderMovement[], Map<string, CylinderMovement[]>>();

function movementsForCylinder(movements: CylinderMovement[], cylinderId: string) {
  let index = movesByCylinder.get(movements);
  if (!index) {
    index = new Map();
    for (const m of movements) {
      if (!m.cylinderId) continue;
      const bucket = index.get(m.cylinderId);
      if (bucket) bucket.push(m);
      else index.set(m.cylinderId, [m]);
    }
    movesByCylinder.set(movements, index);
  }
  return index.get(cylinderId) || [];
}

function overdueCount(
  kind: PartyCylinderKind,
  id: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
) {
  const now = Date.now();
  let n = 0;
  for (const c of cylinders) {
    const held =
      kind === "customer"
        ? c.status === "at_customer" && c.customerId === id
        : Boolean(c.supplierId === id) &&
          c.status !== "damaged" &&
          c.status !== "lost" &&
          c.status !== "at_customer";
    if (!held) continue;
    const last = movementsForCylinder(movements, c.id)
      .filter((m) => forParty(m, kind, id) && m.expectedReturnAt)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .at(-1);
    if (last?.expectedReturnAt && new Date(last.expectedReturnAt).getTime() < now) n += 1;
  }
  return n;
}

/** Transaction-based. Remaining is derived from transactions: Remaining = Sent − Returned − Lost. */
export function partyCylinderBalance(
  kind: PartyCylinderKind,
  id: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
): PartyCylinderBalance {
  let sent = 0;
  let returned = 0;
  let lost = 0;
  let damaged = 0;

  for (const m of movements) {
    if (!forParty(m, kind, id)) continue;
    if (isSend(kind, m)) sent += 1;
    else if (isReturn(kind, m)) returned += 1;
    if (isLost(m)) lost += 1;
    if (isDamaged(m)) damaged += 1;
  }

  return {
    sent,
    returned,
    remaining: sent - returned - lost,
    overdue: overdueCount(kind, id, cylinders, movements),
    lost,
    damaged,
  };
}

export function partyCylinderHistory(
  kind: PartyCylinderKind,
  id: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
  products: Product[],
): PartyCylinderEvent[] {
  const cylMap = new Map(cylinders.map((c) => [c.id, c]));
  const rows = movements
    .filter(
      (m) =>
        forParty(m, kind, id) &&
        (isSend(kind, m) || isReturn(kind, m) || isLost(m) || isDamaged(m)),
    )
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  let runSent = 0;
  let runReturned = 0;
  let runLost = 0;
  return rows
    .map((m) => {
      const cyl = cylMap.get(m.cylinderId);
      const sent = isSend(kind, m) ? 1 : 0;
      const returned = isReturn(kind, m) ? 1 : 0;
      const lost = isLost(m) ? 1 : 0;
      runSent += sent;
      runReturned += returned;
      runLost += lost;
      return {
        id: m.id,
        date: m.timestamp,
        type: m.type,
        typeKey: typeKey(kind, m),
        productName:
          products.find((p) => p.id === cyl?.productId)?.name || cyl?.serialNumber || "Cylinder",
        serial: cyl?.serialNumber,
        sent,
        returned,
        remaining: runSent - runReturned - runLost,
        lost,
        notes: m.notes,
      };
    })
    .reverse();
}

/** Cylinders physically with a party that have no matching send movement. Never used to inflate Sent. */
export function partyCylinderMissingMoves(
  kind: PartyCylinderKind,
  id: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
) {
  let n = 0;
  for (const c of cylinders) {
    if (kind === "customer") {
      if (c.status !== "at_customer" || c.customerId !== id) continue;
      const hasIssued = movements.some(
        (m) => m.cylinderId === c.id && m.type === "issued" && m.customerId === id && !m.sold,
      );
      if (!hasIssued) n += 1;
    } else if (
      c.supplierId === id &&
      c.status !== "damaged" &&
      c.status !== "lost" &&
      c.status !== "scrapped" &&
      c.status !== "written_off"
    ) {
      const hasSend = movements.some(
        (m) => m.cylinderId === c.id && m.supplierId === id && m.type === "transferred",
      );
      if (!hasSend) n += 1;
    }
  }
  return n;
}

export const customerCylinderBalance = (
  customerId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
) => partyCylinderBalance("customer", customerId, cylinders, movements);

export const customerCylinderHistory = (
  customerId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
  products: Product[],
) => partyCylinderHistory("customer", customerId, cylinders, movements, products);

export const supplierCylinderBalance = (
  supplierId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
) => partyCylinderBalance("supplier", supplierId, cylinders, movements);

export const supplierCylinderHistory = (
  supplierId: string,
  cylinders: Cylinder[],
  movements: CylinderMovement[],
  products: Product[],
) => partyCylinderHistory("supplier", supplierId, cylinders, movements, products);
