import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "./session.server.ts";
import { getDb } from "./mongo.server.ts";
import {
  reconcileDatabaseInventory,
} from "./inventory.server.ts";
import type {
  CylinderInventory,
  GasInventory,
  InventorySummary,
  ProductInventory,
} from "@/types";

const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

// Coalescing in-flight reconciliation promise to eliminate redundant parallel 6-collection scans
let activeReconcilePromise: Promise<InventorySummary> | null = null;
let lastReconcileTime = 0;
const RECONCILE_COOLDOWN_MS = 30_000;

export async function safeCoalescedReconcile(db: any, force = false): Promise<InventorySummary> {
  const now = Date.now();
  if (!force && lastReconcileTime > 0 && now - lastReconcileTime < RECONCILE_COOLDOWN_MS) {
    return computeSummaryFromCollections(db);
  }
  if (activeReconcilePromise) {
    return activeReconcilePromise;
  }
  activeReconcilePromise = (async () => {
    try {
      const summary = await reconcileDatabaseInventory(db);
      lastReconcileTime = Date.now();
      return summary;
    } finally {
      activeReconcilePromise = null;
    }
  })();
  return activeReconcilePromise;
}

export async function computeSummaryFromCollections(db: any): Promise<InventorySummary> {
  const [gasDocs, cylDocs, prodDocs] = await Promise.all([
    db.collection("gasInventory").find({}).toArray(),
    db.collection("cylinderInventory").find({}).toArray(),
    db.collection("productInventory").find({}).toArray(),
  ]);

  const gas = gasDocs.map((d: any) => clean<GasInventory>(d));
  const cylinders = cylDocs.map((d: any) => clean<CylinderInventory>(d));
  const products = prodDocs.map((d: any) => clean<ProductInventory>(d));

  const totals = {
    gasOnHand: gas.reduce((sum: number, g: GasInventory) => sum + (Number(g.onHand) || 0), 0),
    cylinderOnHand: cylinders.reduce((sum: number, c: CylinderInventory) => sum + (Number(c.onHand) || 0), 0),
    cylinderReserved: cylinders.reduce((sum: number, c: CylinderInventory) => sum + (Number(c.reserved) || 0), 0),
    cylinderAvailable: cylinders.reduce((sum: number, c: CylinderInventory) => sum + (Number(c.available) || 0), 0),
    productOnHand: products.reduce((sum: number, p: ProductInventory) => sum + (Number(p.onHand) || 0), 0),
    totalValue:
      gas.reduce((sum: number, g: GasInventory) => sum + (Number(g.totalValue) || 0), 0) +
      cylinders.reduce((sum: number, c: CylinderInventory) => sum + (Number(c.totalValue) || 0), 0) +
      products.reduce((sum: number, p: ProductInventory) => sum + (Number(p.totalValue) || 0), 0),
  };

  return { gas, cylinders, products, totals };
}

export const getGasInventoryFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<GasInventory[]> => {
    await requireUser();
    const db = await getDb();
    let docs = await db.collection("gasInventory").find({}).toArray();

    const activeProducts = await db.collection("products").find({}).toArray();
    const activeGasProducts = activeProducts.filter((p: any) => {
      const uom = String(p.uom || "").toLowerCase();
      const type = String(p.productType || "").toLowerCase();
      return type === "gas" || uom === "kg" || uom === "ltr";
    });

    const docPids = new Set(docs.map((d: any) => d.productId));
    const activePids = new Set(activeProducts.map((p: any) => p.id));
    const hasMissing = activeGasProducts.some((p: any) => !docPids.has(p.id));
    const hasGhost = docs.some((d: any) => !activePids.has(d.productId));

    if (docs.length === 0 || hasMissing || hasGhost) {
      const summary = await safeCoalescedReconcile(db, true);
      return summary.gas;
    }
    return docs.map((d: any) => clean<GasInventory>(d));
  },
);

export const getCylinderInventoryFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<CylinderInventory[]> => {
    await requireUser();
    const db = await getDb();
    let docs = await db.collection("cylinderInventory").find({}).toArray();

    const activeProducts = await db.collection("products").find({}).toArray();
    const activeCylProducts = activeProducts.filter((p: any) => {
      const uom = String(p.uom || "").toLowerCase();
      const type = String(p.productType || "").toLowerCase();
      const cat = String(p.category || "").toLowerCase();
      return type === "cylinder" || uom === "cyl" || cat.includes("cylinder");
    });

    const docPids = new Set(docs.map((d: any) => d.productId));
    const activePids = new Set(activeProducts.map((p: any) => p.id));
    const hasMissing = activeCylProducts.some((p: any) => !docPids.has(p.id));
    const hasGhost = docs.some((d: any) => !activePids.has(d.productId));

    if (docs.length === 0 || hasMissing || hasGhost) {
      const summary = await safeCoalescedReconcile(db, true);
      return summary.cylinders;
    }
    return docs.map((d: any) => clean<CylinderInventory>(d));
  },
);

export const getProductInventoryFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProductInventory[]> => {
    await requireUser();
    const db = await getDb();
    let docs = await db.collection("productInventory").find({}).toArray();

    const activeProducts = await db.collection("products").find({}).toArray();
    const activeGeneralProducts = activeProducts.filter((p: any) => {
      const uom = String(p.uom || "").toLowerCase();
      const type = String(p.productType || "").toLowerCase();
      const cat = String(p.category || "").toLowerCase();
      const isCyl = type === "cylinder" || uom === "cyl" || cat.includes("cylinder");
      const isGas = type === "gas" || uom === "kg" || uom === "ltr";
      return !isCyl && !isGas;
    });

    const docPids = new Set(docs.map((d: any) => d.productId));
    const activePids = new Set(activeProducts.map((p: any) => p.id));
    const hasMissing = activeGeneralProducts.some((p: any) => !docPids.has(p.id));
    const hasGhost = docs.some((d: any) => !activePids.has(d.productId));

    if (docs.length === 0 || hasMissing || hasGhost) {
      const summary = await safeCoalescedReconcile(db, true);
      return summary.products;
    }
    return docs.map((d: any) => clean<ProductInventory>(d));
  },
);

export const getInventorySummaryFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<InventorySummary> => {
    await requireUser();
    const db = await getDb();
    const summary = await computeSummaryFromCollections(db);
    if (summary.gas.length === 0 && summary.cylinders.length === 0 && summary.products.length === 0) {
      return safeCoalescedReconcile(db);
    }
    return summary;
  },
);

export const reconcileInventoryDbFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<InventorySummary> => {
    await requireUser();
    const db = await getDb();
    return safeCoalescedReconcile(db, true);
  },
);
