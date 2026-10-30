import type { Customer, Cylinder, CylinderMovement, Product, Supplier } from "@/types";
import { parseRecordTime, type DateRange } from "@/lib/date-range";
import { partyCylinderBalance, type PartyCylinderKind } from "@/lib/customer-cylinders";

export type CylinderLedgerRow = {
  id: string;
  date: string;
  party: string;
  partyKind: PartyCylinderKind | "warehouse";
  movement: string;
  movementKey: string;
  cylinder: string;
  qty: number;
  from: string;
  to: string;
};

export type CylinderOverdueRow = {
  id: string;
  party: string;
  partyKind: PartyCylinderKind;
  cylinder: string;
  sentDate: string;
  expectedReturn: string;
  daysOverdue: number;
  quantity: number;
};

const PURPOSE_KEY: Record<string, string> = {
  sent: "cyl.ledger.sent",
  return: "cyl.ledger.return",
  refill_sent: "cyl.ledger.refillSent",
  refill_return: "cyl.ledger.refillReturn",
  exchange_out: "cyl.ledger.exchangeOut",
  exchange_in: "cyl.ledger.exchangeIn",
  loan: "cyl.ledger.loan",
  loan_return: "cyl.ledger.loanReturn",
  lost: "cyl.ledger.lost",
  damaged: "cyl.ledger.damaged",
  repair: "cyl.ledger.repair",
  scrap: "cyl.ledger.scrap",
  writeoff: "cyl.ledger.writeoff",
  sale: "cyl.ledger.sale",
  stock_out: "cyl.ledger.stockOut",
};

function purposeOf(m: CylinderMovement) {
  if (m.purpose) return m.purpose;
  if (m.type === "stock_out") return "stock_out";
  if (m.type === "scrapped") return "scrap";
  if (m.type === "written_off") return "writeoff";
  if (m.sold) return "sale";
  if (m.type === "lost") return "lost";
  if (m.type === "damaged") return "damaged";
  if (m.type === "transferred" && m.supplierId) return "refill_sent";
  if ((m.type === "refilled" || m.type === "received" || m.type === "returned") && m.supplierId)
    return "refill_return";
  if (m.type === "returned") return "return";
  if (m.type === "issued") return "sent";
  return m.type;
}

export function buildCylinderMovementLedger(opts: {
  cylinders: Cylinder[];
  movements: CylinderMovement[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  range: DateRange;
}): CylinderLedgerRow[] {
  const { cylinders, movements, products, customers, suppliers, range } = opts;
  const cylMap = new Map(cylinders.map((c) => [c.id, c]));
  const fromTs = range.preset !== "all" && range.from ? parseRecordTime(range.from) : null;
  const toTs = range.preset !== "all" && range.to ? parseRecordTime(`${range.to}T23:59:59`) : null;

  return movements
    .slice()
    .sort((a, b) => (parseRecordTime(b.timestamp) ?? 0) - (parseRecordTime(a.timestamp) ?? 0))
    .filter((m) => {
      const t = parseRecordTime(m.timestamp) ?? 0;
      if (fromTs != null && t < fromTs) return false;
      if (toTs != null && t > toTs) return false;
      return true;
    })
    .map((m) => {
      const cyl = cylMap.get(m.cylinderId);
      const product = products.find((p) => p.id === cyl?.productId);
      const cust = m.customerId ? customers.find((c) => c.id === m.customerId) : undefined;
      const supp = m.supplierId ? suppliers.find((s) => s.id === m.supplierId) : undefined;
      const purpose = purposeOf(m);
      return {
        id: m.id,
        date: m.timestamp,
        party: cust?.name || supp?.name || "Warehouse",
        partyKind: cust ? "customer" : supp ? "supplier" : "warehouse",
        movement: purpose,
        movementKey: PURPOSE_KEY[purpose] || "cyl.ledger.sent",
        cylinder: product?.name || cyl?.serialNumber || "Cylinder",
        qty: 1,
        from: m.fromLocation || "—",
        to: m.toLocation || "—",
      };
    });
}

export function buildCylinderOverdueRows(opts: {
  cylinders: Cylinder[];
  movements: CylinderMovement[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
}): CylinderOverdueRow[] {
  const { cylinders, movements, products, customers, suppliers } = opts;
  const now = Date.now();
  const rows: CylinderOverdueRow[] = [];
  const movesByCylinder = new Map<string, typeof movements>();
  for (const m of movements) {
    if (!m.cylinderId || !m.expectedReturnAt) continue;
    const bucket = movesByCylinder.get(m.cylinderId);
    if (bucket) bucket.push(m);
    else movesByCylinder.set(m.cylinderId, [m]);
  }

  for (const c of cylinders) {
    if (
      c.status === "lost" ||
      c.status === "damaged" ||
      c.status === "scrapped" ||
      c.status === "written_off" ||
      c.status === "stock_out" ||
      c.ownedBy === "customer"
    )
      continue;
    const heldCustomer = c.status === "at_customer" && c.customerId;
    const heldSupplier = c.supplierId && c.status !== "at_customer";
    if (!heldCustomer && !heldSupplier) continue;
    const kind: PartyCylinderKind = heldCustomer ? "customer" : "supplier";
    const partyId = heldCustomer ? c.customerId! : c.supplierId!;
    const last = (movesByCylinder.get(c.id) || [])
      .filter((m) => (kind === "customer" ? m.customerId === partyId : m.supplierId === partyId))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .at(-1);
    if (!last?.expectedReturnAt) continue;
    const due = new Date(last.expectedReturnAt).getTime();
    if (Number.isNaN(due) || due >= now) continue;
    const days = Math.floor((now - due) / 86_400_000);
    const party =
      kind === "customer"
        ? customers.find((x) => x.id === partyId)?.name || "Customer"
        : suppliers.find((x) => x.id === partyId)?.name || "Supplier";
    rows.push({
      id: `${c.id}-${last.id}`,
      party,
      partyKind: kind,
      cylinder: products.find((p) => p.id === c.productId)?.name || c.serialNumber,
      sentDate: last.timestamp,
      expectedReturn: last.expectedReturnAt,
      daysOverdue: days,
      quantity: 1,
    });
  }

  const grouped = new Map<string, CylinderOverdueRow>();
  for (const r of rows) {
    const key = `${r.partyKind}:${r.party}:${r.cylinder}:${r.expectedReturn}`;
    const cur = grouped.get(key);
    if (cur) cur.quantity += 1;
    else grouped.set(key, { ...r });
  }
  return [...grouped.values()].sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export function buildCylinderBalanceReport(opts: {
  cylinders: Cylinder[];
  movements: CylinderMovement[];
  customers: Customer[];
  suppliers: Supplier[];
  kind?: "all" | PartyCylinderKind;
}) {
  const { cylinders, movements, customers, suppliers, kind = "all" } = opts;
  const rows = [];
  if (kind !== "supplier") {
    for (const c of customers) {
      const b = partyCylinderBalance("customer", c.id, cylinders, movements);
      if (b.sent || b.returned || b.lost || b.damaged) {
        rows.push({ id: `c:${c.id}`, partner: c.name, kind: "customer" as const, ...b });
      }
    }
  }
  if (kind !== "customer") {
    for (const s of suppliers) {
      const b = partyCylinderBalance("supplier", s.id, cylinders, movements);
      if (b.sent || b.returned || b.lost || b.damaged) {
        rows.push({ id: `s:${s.id}`, partner: s.name, kind: "supplier" as const, ...b });
      }
    }
  }
  return rows.sort((a, b) => a.partner.localeCompare(b.partner));
}
