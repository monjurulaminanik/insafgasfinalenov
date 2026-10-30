import { createServerFn } from "@tanstack/react-start";
import type { DateRange } from "@/lib/date-range";
import type { PartyCylinderKind } from "@/lib/customer-cylinders";

export type CylinderPartyBalanceRow = {
  id: string;
  partner: string;
  kind: PartyCylinderKind;
  sent: number;
  returned: number;
  remaining: number;
  overdue: number;
  lost: number;
  damaged: number;
  missingMoves: number;
};

export type CylinderSnapshot = {
  owned: number;
  warehouse: number;
  customers: number;
  suppliers: number;
  inRefill: number;
  lost: number;
  damaged: number;
  full: number;
  empty: number;
  total: number;
  inTransit: number;
  customerOverdue: number;
  supplierOverdue: number;
};

export type CylinderAccountability = {
  snapshot: CylinderSnapshot;
  parties: CylinderPartyBalanceRow[];
};

export type CylinderBalanceStatus =
  "all" | "outstanding" | "overdue" | "lost" | "damaged" | "refill" | "full" | "empty";

export const getCylinderAccountabilityFn = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      kind?: "all" | PartyCylinderKind;
      partyId?: string;
      productId?: string;
      range?: DateRange;
      status?: CylinderBalanceStatus;
      snapshotOnly?: boolean;
    }) => d,
  )
  .handler(async ({ data }): Promise<CylinderAccountability> => {
    const { requireUser } = await import("./session.server");
    await requireUser();
    const { getDb } = await import("./mongo.server");
    const { filterByDateRange } = await import("./date-range");
    const { partyCylinderBalance, partyCylinderMissingMoves } =
      await import("./customer-cylinders");
    const {
      companyOwnedLocations,
      cylinderOverviewCounts,
      cylinderIsEmpty,
      cylinderIsFullStock,
      cylinderAtSupplier,
    } = await import("./cylinder-product");
    const { buildCylinderOverdueRows } = await import("./cylinder-reports");
    const db = await getDb();
    const clean = <T>(doc: any): T => {
      if (!doc) return doc;
      const { _id, ...rest } = doc;
      return rest as T;
    };

    if (data.snapshotOnly) {
      const cylinderProjection = {
        id: 1,
        status: 1,
        fillLevel: 1,
        supplierId: 1,
        ownedBy: 1,
        customerId: 1,
        productId: 1,
        serialNumber: 1,
      };
      const [cylinders, movements] = await Promise.all([
        db
          .collection("cylinders")
          .find({}, { projection: cylinderProjection })
          .toArray()
          .then((rows) => rows.map((d) => clean<any>(d))),
        db
          .collection("movements")
          .find(
            { expectedReturnAt: { $exists: true, $nin: [null, ""] } },
            {
              projection: {
                id: 1,
                cylinderId: 1,
                timestamp: 1,
                expectedReturnAt: 1,
                customerId: 1,
                supplierId: 1,
              },
            },
          )
          .toArray()
          .then((rows) => rows.map((d) => clean<any>(d))),
      ]);
      const overdueRows = buildCylinderOverdueRows({
        cylinders,
        movements,
        products: [],
        customers: [],
        suppliers: [],
      });
      const owned = companyOwnedLocations(cylinders);
      const counts = cylinderOverviewCounts(cylinders);
      const snapshot: CylinderSnapshot = {
        ...owned,
        full: counts.full,
        empty: counts.empty,
        total: owned.owned,
        inTransit: counts.inTransit,
        customerOverdue: overdueRows
          .filter((r) => r.partyKind === "customer")
          .reduce((a, r) => a + r.quantity, 0),
        supplierOverdue: overdueRows
          .filter((r) => r.partyKind === "supplier")
          .reduce((a, r) => a + r.quantity, 0),
      };
      return { snapshot, parties: [] };
    }

    const [cylinders, movements, customers, suppliers, products] = await Promise.all([
      db
        .collection("cylinders")
        .find({})
        .toArray()
        .then((rows) => rows.map((d) => clean<any>(d))),
      db
        .collection("movements")
        .find({})
        .toArray()
        .then((rows) => rows.map((d) => clean<any>(d))),
      db
        .collection("customers")
        .find({})
        .toArray()
        .then((rows) => rows.map((d) => clean<any>(d))),
      db
        .collection("suppliers")
        .find({})
        .toArray()
        .then((rows) => rows.map((d) => clean<any>(d))),
      db
        .collection("products")
        .find({})
        .toArray()
        .then((rows) => rows.map((d) => clean<any>(d))),
    ]);

    const range = data.range ?? { preset: "all" as const, from: "", to: "" };
    let moves =
      range.preset === "all"
        ? movements
        : filterByDateRange(movements, range, (m: any) => m.timestamp);
    if (data.productId && data.productId !== "all") {
      const ids = new Set(
        cylinders.filter((c: any) => c.productId === data.productId).map((c: any) => c.id),
      );
      moves = moves.filter((m: any) => ids.has(m.cylinderId));
    }

    const kind = data.kind ?? "all";
    const parties: CylinderPartyBalanceRow[] = [];
    if (kind !== "supplier") {
      for (const c of customers) {
        if (data.partyId && c.id !== data.partyId) continue;
        const b = partyCylinderBalance("customer", c.id, cylinders, moves);
        const missingMoves = partyCylinderMissingMoves("customer", c.id, cylinders, movements);
        if (b.sent || b.returned || b.lost || b.damaged || missingMoves || data.partyId) {
          parties.push({ id: `c:${c.id}`, partner: c.name, kind: "customer", ...b, missingMoves });
        }
      }
    }
    if (kind !== "customer") {
      for (const s of suppliers) {
        if (data.partyId && s.id !== data.partyId) continue;
        const b = partyCylinderBalance("supplier", s.id, cylinders, moves);
        const missingMoves = partyCylinderMissingMoves("supplier", s.id, cylinders, movements);
        if (b.sent || b.returned || b.lost || b.damaged || missingMoves || data.partyId) {
          parties.push({ id: `s:${s.id}`, partner: s.name, kind: "supplier", ...b, missingMoves });
        }
      }
    }

    const overdueRows = buildCylinderOverdueRows({
      cylinders,
      movements,
      products,
      customers,
      suppliers,
    });
    const owned = companyOwnedLocations(cylinders);
    const counts = cylinderOverviewCounts(cylinders);
    const snapshot: CylinderSnapshot = {
      ...owned,
      full: counts.full,
      empty: counts.empty,
      total: owned.owned,
      inTransit: counts.inTransit,
      customerOverdue: overdueRows
        .filter((r) => r.partyKind === "customer")
        .reduce((a, r) => a + r.quantity, 0),
      supplierOverdue: overdueRows
        .filter((r) => r.partyKind === "supplier")
        .reduce((a, r) => a + r.quantity, 0),
    };

    const status = data.status ?? "all";
    const filtered = parties
      .filter((p) => {
        if (status === "all") return true;
        if (status === "outstanding") return p.remaining > 0;
        if (status === "overdue") return p.overdue > 0;
        if (status === "lost") return p.lost > 0;
        if (status === "damaged") return p.damaged > 0;
        if (status === "refill") return p.kind === "supplier" && p.remaining > 0;
        if (status === "full" || status === "empty") {
          const partyId = p.id.slice(2);
          return cylinders.some((c: any) => {
            if (c.ownedBy === "customer") return false;
            const atParty =
              p.kind === "customer"
                ? c.status === "at_customer" && c.customerId === partyId
                : c.supplierId === partyId && cylinderAtSupplier(c);
            if (!atParty) return false;
            return status === "full"
              ? cylinderIsFullStock(c) || (!cylinderIsEmpty(c) && c.status === "at_customer")
              : cylinderIsEmpty(c);
          });
        }
        return true;
      })
      .sort((a, b) => a.partner.localeCompare(b.partner));

    return { snapshot, parties: filtered };
  });
