import { createServerFn } from "@tanstack/react-start";
import { allSeed } from "./seed-data";
import { isDemoLoginEnabled, requireUser } from "./session.server";
import { issueLockExpiredBefore } from "./cylinder-lock";
import { isKnownCrudCollection, modulesForCrud } from "./crud-access";
import { normalizeSerialKey, trackingEnforcesSerialUnique } from "./cylinder-serial";
import type {
  Customer,
  Supplier,
  Product,
  SalesOrder,
  DashboardStats,
  StockAlert,
  Expense,
  LedgerEntry,
  Cylinder,
  PurchaseOrder,
  Voucher,
  Account,
  Delivery,
  StockMovement,
} from "@/types";
import { isBankBookAccount, isCashBookAccount } from "@/lib/money-accounts";
import { creditReminderNotice, customerOpeningSigned } from "@/lib/customer-balance";
import { computeCustomerReceivables, computeSupplierPayables } from "@/lib/accounting-engine";

async function getDb() {
  const { getDb: loadDb } = await import("./mongo.server");
  return loadDb();
}

type CollName =
  | "customers"
  | "suppliers"
  | "products"
  | "cylinders"
  | "movements"
  | "sales"
  | "deliveries"
  | "returns"
  | "expenses"
  | "ledger"
  | "purchases"
  | "stockMovements"
  | "vouchers"
  | "employees"
  | "payroll"
  | "appUsers"
  | "accounts"
  | "chartOfAccounts"
  | "assets"
  | "costLayers"
  | "gasInventory"
  | "cylinderInventory"
  | "productInventory"
  | "supplierReturns";

// Strip Mongo's _id so returned docs are plain and serializable.
const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

let seedPromise: Promise<void> | null = null; // cached seed promise
async function ensureSeeded() {
  if (seedPromise) return seedPromise;
  seedPromise = (async () => {
    const db = await getDb();
    const collections = Object.keys(allSeed) as CollName[];
    await Promise.all(
      collections.map(async (name) => {
        if (name === "appUsers" && !isDemoLoginEnabled()) return;
        const coll = db.collection(name);
        // Unique index on business `id` prevents duplicate seed rows across races.
        try {
          await coll.createIndex({ id: 1 }, { unique: true });
        } catch {}
        if (name === "cylinders") await ensureCylinderSerialIndex(db);
        if (name === "stockMovements") {
          try {
            await coll.createIndex({ refType: 1, refId: 1, productId: 1, type: 1 });
          } catch {}
        }
        if (name === "sales") {
          try {
            await coll.createIndex({ orderNo: 1 }, { unique: true, sparse: true });
          } catch {}
          try {
            await coll.createIndex({ status: 1, date: -1 });
          } catch {}
        }
        if (name === "purchases") {
          try {
            await coll.createIndex({ orderNo: 1 }, { unique: true, sparse: true });
          } catch {}
          try {
            await coll.createIndex({ status: 1, date: -1 });
          } catch {}
        }
        if (name === "vouchers") {
          try {
            await coll.createIndex({ voucherNo: 1 }, { unique: true, sparse: true });
          } catch {}
          try {
            await coll.createIndex({ partyType: 1, partyId: 1, type: 1 });
          } catch {}
        }
        if (name === "deliveries") {
          try {
            await coll.createIndex({ challanNo: 1 }, { unique: true, sparse: true });
          } catch {}
          try {
            await coll.createIndex({ status: 1, date: -1 });
          } catch {}
        }
        if (name === "supplierReturns") {
          try {
            await coll.createIndex({ returnNo: 1 }, { unique: true, sparse: true });
          } catch {}
        }
        if (name === "products") {
          try {
            await coll.createIndex({ stock: 1, reorderLevel: 1 });
          } catch {}
        }
        if (name === "cylinders") {
          try {
            await coll.createIndex({ status: 1, customerId: 1, supplierId: 1 });
          } catch {}
        }
        if (name === "movements") {
          try {
            await coll.createIndex({ cylinderId: 1, timestamp: -1 });
          } catch {}
        }
        const count = await coll.estimatedDocumentCount();
        if (count === 0) {
          const docs = (allSeed as any)[name] as any[];
          if (docs.length > 0) {
            try {
              await coll.insertMany(
                docs.map((d) => ({ ...d })),
                { ordered: false },
              );
            } catch {}
          }
        }
      }),
    );

    // Reconcile only when the split inventory collections are still empty.
    // Writes already reconcile; repeating it on every page load re-reads the whole database.
    const [gasCount, cylinderCount, productCount] = await Promise.all([
      db.collection("gasInventory").estimatedDocumentCount(),
      db.collection("cylinderInventory").estimatedDocumentCount(),
      db.collection("productInventory").estimatedDocumentCount(),
    ]);
    if (gasCount === 0 || cylinderCount === 0 || productCount === 0) {
      try {
        const { reconcileDatabaseInventory } = await import("./inventory.server");
        await reconcileDatabaseInventory(db);
      } catch {
        /* ignore migration race */
      }
    }
  })().catch((e) => {
    seedPromise = null;
    throw e;
  });
  return seedPromise;
}

async function collAll<T>(name: CollName): Promise<T[]> {
  const db = await getDb();
  await ensureSeeded();
  const docs = await db
    .collection(name)
    .find({})
    .sort({ createdAt: -1, date: -1, timestamp: -1 })
    .toArray();
  return docs.map((d) => {
    const c = clean<any>(d);
    if (name === "appUsers") {
      delete c.password;
      delete c.passwordHash;
    }
    return c as T;
  });
}

async function findById(name: CollName, id: string) {
  const db = await getDb();
  return db.collection(name).findOne({ id: String(id) });
}

async function collGet<T>(name: CollName, id: string): Promise<T | null> {
  const db = await getDb();
  await ensureSeeded();
  const doc = await findById(name, id);
  if (!doc) return null;
  const c = clean<any>(doc);
  if (name === "appUsers") {
    delete c.password;
    delete c.passwordHash;
  }
  return c as T;
}

async function ensureCylinderSerialIndex(db?: Awaited<ReturnType<typeof getDb>>) {
  const database = db ?? (await getDb());
  try {
    await database.collection("cylinders").createIndex(
      { serialKey: 1 },
      {
        unique: true,
        name: "cylinders_serialKey_unique",
        partialFilterExpression: { serialKey: { $type: "string", $gt: "" } },
      },
    );
  } catch {
    /* Existing duplicate serials are left in place; new serial-mode writes still hit E11000 if the index exists. */
  }
}

function isDuplicateKeyError(e: unknown) {
  const err = e as { code?: number; message?: string };
  return err?.code === 11000 || /E11000|duplicate key/i.test(err?.message || "");
}

async function serialTaken(serial: string, excludeId?: string) {
  const key = normalizeSerialKey(serial);
  if (!key) return false;
  const db = await getDb();
  const docs = await db
    .collection("cylinders")
    .find(excludeId ? { id: { $ne: excludeId } } : {}, {
      projection: { id: 1, serialNumber: 1, serialKey: 1 },
    })
    .toArray();
  return docs.some((d) => {
    const stored =
      typeof d.serialKey === "string" && d.serialKey
        ? d.serialKey
        : normalizeSerialKey(d.serialNumber);
    return stored === key;
  });
}

async function collCreate<T extends { id?: string }>(
  name: CollName,
  data: any,
  user?: { username?: string },
): Promise<T> {
  const db = await getDb();
  await ensureSeeded();
  const { getNextSequence } = await import("./document-sequence");
  const id = data.id ?? Math.random().toString(36).slice(2, 10);
  const doc: Record<string, unknown> = {
    ...data,
    id,
    createdAt: data.createdAt ?? new Date().toISOString(),
  };

  // Database-backed collision-safe sequence numbering
  if (name === "sales" && (!doc.orderNo || String(doc.orderNo).startsWith("SO-"))) {
    if (!doc.orderNo || String(doc.orderNo).length < 15) {
      doc.orderNo = await getNextSequence(db, "SO");
    }
  } else if (name === "purchases" && (!doc.orderNo || String(doc.orderNo).startsWith("PO-"))) {
    if (!doc.orderNo || String(doc.orderNo).length < 15) {
      doc.orderNo = await getNextSequence(db, "PO");
    }
  } else if (
    name === "vouchers" &&
    (!doc.voucherNo ||
      String(doc.voucherNo).startsWith("RV-") ||
      String(doc.voucherNo).startsWith("PV-") ||
      String(doc.voucherNo).startsWith("JV-"))
  ) {
    const pfx = String(doc.voucherNo || "").slice(0, 2) || "RV";
    if (!doc.voucherNo || String(doc.voucherNo).length < 15) {
      doc.voucherNo = await getNextSequence(db, pfx);
    }
  } else if (name === "deliveries" && (!doc.challanNo || String(doc.challanNo).startsWith("DC-"))) {
    if (!doc.challanNo || String(doc.challanNo).length < 15) {
      doc.challanNo = await getNextSequence(db, "DC");
    }
  } else if (name === "returns" && (!doc.returnNo || String(doc.returnNo).startsWith("RET-"))) {
    if (!doc.returnNo || String(doc.returnNo).length < 15) {
      doc.returnNo = await getNextSequence(db, "RET");
    }
  } else if (name === "supplierReturns" && (!doc.returnNo || String(doc.returnNo).startsWith("SR-"))) {
    if (!doc.returnNo || String(doc.returnNo).length < 15) {
      doc.returnNo = await getNextSequence(db, "SR");
    }
  }

  if (name === "cylinders") {
    await ensureCylinderSerialIndex(db);
    const { getCylinderTracking } = await import("./settings.server");
    const method = await getCylinderTracking();
    const serial = String(data?.serialNumber || "");
    if (trackingEnforcesSerialUnique(method)) {
      const serialKey = normalizeSerialKey(serial);
      if (serialKey && (await serialTaken(serial))) {
        throw new Error(`Serial number ${serial} is already assigned`);
      }
      if (serialKey) doc.serialKey = serialKey;
    } else {
      delete doc.serialKey;
    }
  }
  try {
    await db.collection(name).insertOne(doc);
  } catch (e) {
    if (name === "cylinders" && isDuplicateKeyError(e)) {
      throw new Error(`Serial number ${data?.serialNumber} is already assigned`);
    }
    if (isDuplicateKeyError(e)) {
      throw new Error(`Duplicate document key error in ${name}`);
    }
    throw e;
  }

  try {
    const { logAudit } = await import("./audit");
    await logAudit(db, {
      userId: user?.username || "system",
      username: user?.username || "system",
      action: "CREATE",
      entityType: name as any,
      entityId: id,
      after: doc,
      details: `Created record in ${name} (id: ${id})`,
    });
  } catch {}

  if (name === "products") {
    try {
      const { resolveProductType } = await import("./inventory.server");
      const pType = (doc.productType as string) || resolveProductType(doc as any);
      const now = new Date().toISOString();
      const stockVal = Number(doc.stock) || 0;
      const unitPrice = Number(doc.price) || 0;
      const costPrice = Number(doc.cost) || 0;
      const totalVal = stockVal * (costPrice > 0 ? costPrice : unitPrice);

      if (pType === "cylinder") {
        await db.collection("cylinderInventory").updateOne(
          { productId: id },
          {
            $set: {
              id: `cyl-${id}`,
              productId: id,
              productName: doc.name,
              productType: "cylinder",
              uom: doc.uom || "cyl",
              openingStock: stockVal,
              stockIn: 0,
              stockOut: 0,
              reserved: 0,
              available: stockVal,
              onHand: stockVal,
              unitPrice,
              costPrice,
              totalValue: totalVal,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      } else if (pType === "gas") {
        await db.collection("gasInventory").updateOne(
          { productId: id },
          {
            $set: {
              id: `gas-${id}`,
              productId: id,
              productName: doc.name,
              productType: "gas",
              uom: doc.uom || "kg",
              openingStock: stockVal,
              stockIn: 0,
              stockOut: 0,
              onHand: stockVal,
              unitPrice,
              costPrice,
              totalValue: totalVal,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      } else {
        await db.collection("productInventory").updateOne(
          { productId: id },
          {
            $set: {
              id: `prod-${id}`,
              productId: id,
              productName: doc.name,
              productType: "product",
              uom: doc.uom || "pcs",
              openingStock: stockVal,
              stockIn: 0,
              stockOut: 0,
              onHand: stockVal,
              unitPrice,
              costPrice,
              totalValue: totalVal,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      }
    } catch {
      /* ignore sync error */
    }
  }

  if (name === "stockMovements" && doc.productId) {
    try {
      const pDoc = await db.collection("products").findOne({ id: doc.productId });
      const { resolveProductType } = await import("./inventory.server");
      const pType = (doc.productType as string) || resolveProductType(pDoc as any);
      const qty = Number(doc.quantity) || 0;
      const type = doc.type; // "in" | "out"
      const now = new Date().toISOString();
      const pStock = pDoc ? Number(pDoc.stock) || 0 : undefined;
      const unitPrice = pDoc ? Number(pDoc.price) || 0 : 0;
      const costPrice = pDoc ? Number(pDoc.cost) || 0 : 0;
      const valUnit = costPrice > 0 ? costPrice : unitPrice;

      if (qty > 0) {
        if (pType === "cylinder") {
          const cylDoc = await db.collection("cylinderInventory").findOne({ productId: doc.productId });
          const reserved = cylDoc ? Number(cylDoc.reserved) || 0 : 0;
          const currentOnHand = cylDoc ? Number(cylDoc.onHand) || 0 : (pStock ?? 0);
          const nextOnHand = pStock !== undefined ? pStock : Math.max(0, currentOnHand + (type === "in" ? qty : -qty));
          const available = Math.max(0, nextOnHand - reserved);
          const incFields: Record<string, number> = type === "in" ? { stockIn: qty } : { stockOut: qty };

          await db.collection("cylinderInventory").updateOne(
            { productId: doc.productId },
            {
              $inc: incFields,
              $set: {
                onHand: nextOnHand,
                available,
                totalValue: nextOnHand * valUnit,
                updatedAt: now,
              },
              $setOnInsert: {
                id: `cyl-${doc.productId}`,
                productId: doc.productId,
                productName: doc.productName || pDoc?.name || "Cylinder",
                productType: "cylinder",
                uom: pDoc?.uom || "cyl",
                openingStock: 0,
                reserved: 0,
                unitPrice,
                costPrice,
              },
            },
            { upsert: true },
          );
        } else if (pType === "gas") {
          const gasDoc = await db.collection("gasInventory").findOne({ productId: doc.productId });
          const currentOnHand = gasDoc ? Number(gasDoc.onHand) || 0 : (pStock ?? 0);
          const nextOnHand = pStock !== undefined ? pStock : Math.max(0, currentOnHand + (type === "in" ? qty : -qty));
          const incFields: Record<string, number> = type === "in" ? { stockIn: qty } : { stockOut: qty };

          await db.collection("gasInventory").updateOne(
            { productId: doc.productId },
            {
              $inc: incFields,
              $set: {
                onHand: nextOnHand,
                totalValue: nextOnHand * valUnit,
                updatedAt: now,
              },
              $setOnInsert: {
                id: `gas-${doc.productId}`,
                productId: doc.productId,
                productName: doc.productName || pDoc?.name || "Gas",
                productType: "gas",
                uom: pDoc?.uom || "kg",
                openingStock: 0,
                unitPrice,
                costPrice,
              },
            },
            { upsert: true },
          );
        } else {
          const prodDoc = await db.collection("productInventory").findOne({ productId: doc.productId });
          const currentOnHand = prodDoc ? Number(prodDoc.onHand) || 0 : (pStock ?? 0);
          const nextOnHand = pStock !== undefined ? pStock : Math.max(0, currentOnHand + (type === "in" ? qty : -qty));
          const incFields: Record<string, number> = type === "in" ? { stockIn: qty } : { stockOut: qty };

          await db.collection("productInventory").updateOne(
            { productId: doc.productId },
            {
              $inc: incFields,
              $set: {
                onHand: nextOnHand,
                totalValue: nextOnHand * valUnit,
                updatedAt: now,
              },
              $setOnInsert: {
                id: `prod-${doc.productId}`,
                productId: doc.productId,
                productName: doc.productName || pDoc?.name || "Product",
                productType: "product",
                uom: pDoc?.uom || "pcs",
                openingStock: 0,
                unitPrice,
                costPrice,
              },
            },
            { upsert: true },
          );
        }
      }
    } catch {
      /* ignore sync error */
    }
  }

  return clean<T>(doc);
}

async function collUpdate<T>(
  name: CollName,
  id: string,
  patch: any,
  user?: { username?: string },
): Promise<T> {
  const db = await getDb();
  await ensureSeeded();
  if (!id) throw new Error("Missing record id");
  if (!patch || typeof patch !== "object") throw new Error("Missing update payload");
  const { _id, id: _ignore, createdAt: _createdAt, ...rest } = patch;
  const update: { $set: Record<string, unknown>; $unset?: Record<string, string> } = { $set: rest };
  if (name === "cylinders" && rest.serialNumber != null) {
    await ensureCylinderSerialIndex(db);
    const { getCylinderTracking } = await import("./settings.server");
    const method = await getCylinderTracking();
    if (trackingEnforcesSerialUnique(method)) {
      if (await serialTaken(String(rest.serialNumber), String(id))) {
        throw new Error(`Serial number ${rest.serialNumber} is already assigned`);
      }
      const serialKey = normalizeSerialKey(String(rest.serialNumber));
      if (serialKey) rest.serialKey = serialKey;
      else {
        delete rest.serialKey;
        update.$unset = { ...(update.$unset || {}), serialKey: "" };
      }
    } else {
      delete rest.serialKey;
      update.$unset = { ...(update.$unset || {}), serialKey: "" };
    }
  }
  const existing = await findById(name, id);
  if (!existing) throw new Error(`Record not found (${name}/${id})`);
  const filter = existing.id != null ? { id: String(existing.id) } : { _id: existing._id };
  try {
    const result = await db.collection(name).updateOne(filter, update);
    if (result.matchedCount === 0) {
      throw new Error(`Record not found (${name}/${id})`);
    }
  } catch (e) {
    if (name === "cylinders" && isDuplicateKeyError(e)) {
      throw new Error(`Serial number ${rest.serialNumber} is already assigned`);
    }
    if (isDuplicateKeyError(e)) {
      throw new Error(`Duplicate document key error in ${name}`);
    }
    throw e;
  }
  const doc = await findById(name, String(existing.id ?? id));
  if (!doc) throw new Error("Update failed — record missing after write");

  try {
    const { logAudit } = await import("./audit");
    await logAudit(db, {
      userId: user?.username || "system",
      username: user?.username || "system",
      action: "UPDATE",
      entityType: name as any,
      entityId: id,
      before: clean(existing),
      after: clean(doc),
      details: `Updated record in ${name} (id: ${id})`,
    });
  } catch {}

  if (name === "products") {
    try {
      const stockVal = rest.stock != null ? Number(rest.stock) : undefined;
      const costVal = rest.cost != null ? Number(rest.cost) : undefined;
      const priceVal = rest.price != null ? Number(rest.price) : undefined;
      const nameVal = rest.name != null ? String(rest.name) : undefined;

      const cylDoc = await db.collection("cylinderInventory").findOne({ productId: id });
      if (cylDoc) {
        const currentStock = stockVal !== undefined ? stockVal : Number(cylDoc.onHand) || 0;
        const reserved = Number(cylDoc.reserved) || 0;
        const costPrice = costVal !== undefined ? costVal : (Number(cylDoc.costPrice) || 0);
        const unitPrice = priceVal !== undefined ? priceVal : (Number(cylDoc.unitPrice) || 0);
        const valUnit = costPrice > 0 ? costPrice : unitPrice;
        await db.collection("cylinderInventory").updateOne(
          { productId: id },
          {
            $set: {
              ...(stockVal !== undefined ? { onHand: stockVal, available: Math.max(0, stockVal - reserved) } : {}),
              ...(costVal !== undefined ? { costPrice: costVal } : {}),
              ...(priceVal !== undefined ? { unitPrice: priceVal } : {}),
              ...(nameVal !== undefined ? { productName: nameVal } : {}),
              totalValue: currentStock * valUnit,
              updatedAt: new Date().toISOString(),
            },
          },
        );
      }

      const gasDoc = await db.collection("gasInventory").findOne({ productId: id });
      if (gasDoc) {
        const currentStock = stockVal !== undefined ? stockVal : Number(gasDoc.onHand) || 0;
        const costPrice = costVal !== undefined ? costVal : (Number(gasDoc.costPrice) || 0);
        const unitPrice = priceVal !== undefined ? priceVal : (Number(gasDoc.unitPrice) || 0);
        const valUnit = costPrice > 0 ? costPrice : unitPrice;
        await db.collection("gasInventory").updateOne(
          { productId: id },
          {
            $set: {
              ...(stockVal !== undefined ? { onHand: stockVal } : {}),
              ...(costVal !== undefined ? { costPrice: costVal } : {}),
              ...(priceVal !== undefined ? { unitPrice: priceVal } : {}),
              ...(nameVal !== undefined ? { productName: nameVal } : {}),
              totalValue: currentStock * valUnit,
              updatedAt: new Date().toISOString(),
            },
          },
        );
      }

      const prodDoc = await db.collection("productInventory").findOne({ productId: id });
      if (prodDoc) {
        const currentStock = stockVal !== undefined ? stockVal : Number(prodDoc.onHand) || 0;
        const costPrice = costVal !== undefined ? costVal : (Number(prodDoc.costPrice) || 0);
        const unitPrice = priceVal !== undefined ? priceVal : (Number(prodDoc.unitPrice) || 0);
        const valUnit = costPrice > 0 ? costPrice : unitPrice;
        await db.collection("productInventory").updateOne(
          { productId: id },
          {
            $set: {
              ...(stockVal !== undefined ? { onHand: stockVal } : {}),
              ...(costVal !== undefined ? { costPrice: costVal } : {}),
              ...(priceVal !== undefined ? { unitPrice: priceVal } : {}),
              ...(nameVal !== undefined ? { productName: nameVal } : {}),
              totalValue: currentStock * valUnit,
              updatedAt: new Date().toISOString(),
            },
          },
        );
      }
    } catch {
      /* ignore sync error */
    }
  }

  return clean<T>(doc);
}

async function collClaim(name: CollName, id: string, payload?: { statuses?: string[] }) {
  if (name !== "cylinders") throw new Error("Claim is only supported for cylinders");
  const statuses = payload?.statuses?.length ? payload.statuses : ["in_stock"];
  const db = await getDb();
  await ensureSeeded();
  const staleBefore = issueLockExpiredBefore();
  const result = await db.collection("cylinders").findOneAndUpdate(
    {
      id: String(id),
      status: { $in: statuses },
      $or: [
        { issueLock: { $exists: false } },
        { issueLock: null },
        { issueLock: "" },
        { issueLock: { $lt: staleBefore } },
      ],
    },
    { $set: { issueLock: new Date().toISOString() } },
    { returnDocument: "after" },
  );
  const doc = (result as { value?: unknown } | null)?.value ?? result;
  if (!doc || typeof doc !== "object" || !("id" in doc)) {
    throw new Error("Cylinder is no longer available");
  }
  return clean(doc);
}

async function collRemove(name: CollName, id: string, user?: { username?: string }): Promise<void> {
  const db = await getDb();
  await ensureSeeded();
  if (!id) throw new Error("Missing record id");
  const existing = await findById(name, id);
  const result = await db.collection(name).deleteOne({ id: String(id) });
  if (result.deletedCount === 0) {
    throw new Error(`Record not found (${name}/${id})`);
  }

  try {
    const { logAudit } = await import("./audit");
    await logAudit(db, {
      userId: user?.username || "system",
      username: user?.username || "system",
      action: "DELETE",
      entityType: name as any,
      entityId: id,
      before: existing ? clean(existing) : null,
      details: `Deleted record in ${name} (id: ${id})`,
    });
  } catch {}

  if (name === "products") {
    try {
      await Promise.all([
        db.collection("cylinderInventory").deleteMany({ productId: id }),
        db.collection("gasInventory").deleteMany({ productId: id }),
        db.collection("productInventory").deleteMany({ productId: id }),
      ]);
    } catch {
      /* ignore sync error */
    }
  }
}

// ---------- Generic CRUD server functions ----------
type CrudInput = {
  op: "list" | "get" | "create" | "update" | "remove" | "claim";
  coll: CollName;
  id?: string;
  /** Record body for create/update — avoid naming this `data` (conflicts with server-fn wrapper). */
  payload?: any;
};

export const crudFn = createServerFn({ method: "POST" })
  .inputValidator((d: CrudInput) => d)
  .handler(async ({ data }): Promise<any> => {
    const user = await requireUser();
    if (!isKnownCrudCollection(data.coll)) {
      throw new Error("Not allowed");
    }
    const { permissionForCrud } = await import("./crud-access");
    const { assertPermission } = await import("./rbac");
    const requiredPermission = permissionForCrud(data.coll, data.op);
    assertPermission(user, requiredPermission);

    const id = data.id != null ? String(data.id) : undefined;
    switch (data.op) {
      case "list":
        return await collAll(data.coll);
      case "get":
        return await collGet(data.coll, id!);
      case "create":
        return await collCreate(data.coll, data.payload, user);
      case "update":
        return await collUpdate(data.coll, id!, data.payload, user);
      case "remove":
        await collRemove(data.coll, id!, user);
        return { ok: true };
      case "claim":
        return await collClaim(data.coll, id!, data.payload);
      default:
        return null;
    }
  });

function dhakaDay(d: Date) {
  const shifted = new Date(d.getTime() + 6 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function balanceFor(ledger: LedgerEntry[], account: "cash" | "bank", named: Account[] = []) {
  return ledger
    .filter((e) =>
      account === "bank"
        ? isBankBookAccount(e.account, named)
        : isCashBookAccount(e.account, named),
    )
    .reduce((a, e) => a + (e.direction === "in" ? e.amount : -e.amount), 0);
}

// ---------- Dashboard aggregation ----------
export const dashboardFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardStats & { stockAlerts: StockAlert[] }> => {
    await requireUser();
    const db = await getDb();
    await ensureSeeded();

    const sales = (await db.collection("sales").find({}).toArray()) as unknown as SalesOrder[];
    const products = (await db.collection("products").find({}).toArray()) as unknown as Product[];
    const suppliers = (await db
      .collection("suppliers")
      .find({})
      .toArray()) as unknown as Supplier[];
    const customers = (await db
      .collection("customers")
      .find({})
      .toArray()) as unknown as Customer[];
    const expenses = (await db.collection("expenses").find({}).toArray()) as unknown as Expense[];
    const ledger = (await db.collection("ledger").find({}).toArray()) as unknown as LedgerEntry[];
    const cylinders = (await db
      .collection("cylinders")
      .find({})
      .toArray()) as unknown as Cylinder[];
    const purchases = (await db
      .collection("purchases")
      .find({})
      .toArray()) as unknown as PurchaseOrder[];

    const todayStr = dhakaDay(new Date());
    const todaysOrders = sales.filter(
      (s) =>
        s.date &&
        dhakaDay(new Date(s.date)) === todayStr &&
        s.status !== "cancelled" &&
        s.status !== "draft",
    );
    const todaySales = todaysOrders.reduce((a, o) => a + (o.total || 0), 0);
    const todayCollection = todaysOrders.reduce((a, o) => a + (o.paid || 0), 0);

    const todaysExpenses = expenses.filter(
      (e) => e.date && dhakaDay(new Date(e.date)) === todayStr,
    );
    const todayExpense = todaysExpenses.reduce((a, e) => a + (e.amount || 0), 0);

    const vouchers = (await db.collection("vouchers").find({}).toArray()) as unknown as Voucher[];
    const namedAccounts = (await db
      .collection("accounts")
      .find({})
      .toArray()) as unknown as Account[];

    const { totalDue: customerDue } = computeCustomerReceivables(customers, sales, vouchers);
    const { totalDue: supplierPayable } = computeSupplierPayables(suppliers, purchases, vouchers);

    const monthPrefix = todayStr.slice(0, 7);
    const monthlySales = sales
      .filter(
        (s) =>
          s.date &&
          dhakaDay(new Date(s.date)).startsWith(monthPrefix) &&
          s.status !== "cancelled" &&
          s.status !== "draft",
      )
      .reduce((a, o) => a + (o.total || 0), 0);

    const stockAlerts: StockAlert[] = products
      .filter((p) => (p.stock ?? 0) <= (p.reorderLevel ?? 0))
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        stock: p.stock,
        reorderLevel: p.reorderLevel,
      }));

    const countStatus = (status: Cylinder["status"]) =>
      cylinders.filter((c) => c.status === status).length;

    return {
      todaySales,
      todayCollection,
      todayExpense,
      customerDue,
      supplierPayable,
      cashBalance: Math.round(balanceFor(ledger, "cash", namedAccounts)),
      bankBalance: Math.round(balanceFor(ledger, "bank", namedAccounts)),
      availableStock: products.reduce((a, p) => a + (p.stock || 0), 0),
      cylindersInWarehouse: countStatus("in_stock"),
      cylindersWithCustomers: countStatus("at_customer"),
      cylindersUnderRefill: countStatus("refilling"),
      damagedCylinders: countStatus("damaged"),
      lostCylinders: countStatus("lost"),
      monthlySales,
      stockAlerts,
    };
  },
);

// ---------- Notifications aggregation ----------
export const notificationsFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const db = await getDb();
  await ensureSeeded();

  const [products, pendingDeliveries, pendingPurchases, pendingSales, customers, sales, vouchers] =
    await Promise.all([
      db
        .collection<Product>("products")
        .find({}, { projection: { _id: 0, id: 1, name: 1, stock: 1, reorderLevel: 1 } })
        .toArray() as Promise<Product[]>,
      db
        .collection<Delivery>("deliveries")
        .find(
          { status: "pending" },
          { projection: { _id: 0, id: 1, challanNo: 1, customerName: 1 } },
        )
        .toArray() as Promise<Delivery[]>,
      db
        .collection<PurchaseOrder>("purchases")
        .find(
          { status: { $in: ["ordered", "partial"] } },
          { projection: { _id: 0, id: 1, orderNo: 1, supplierName: 1 } },
        )
        .toArray() as Promise<PurchaseOrder[]>,
      db
        .collection<SalesOrder>("sales")
        .find(
          { status: "confirmed" },
          { projection: { _id: 0, id: 1, orderNo: 1, customerName: 1 } },
        )
        .toArray() as Promise<SalesOrder[]>,
      db
        .collection<Customer>("customers")
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              name: 1,
              creditReminderEnabled: 1,
              creditReminderDays: 1,
              openingBalance: 1,
              openingBalanceType: 1,
              createdAt: 1,
            },
          },
        )
        .toArray() as Promise<Customer[]>,
      db
        .collection<SalesOrder>("sales")
        .find(
          { status: { $nin: ["cancelled", "draft"] } },
          { projection: { _id: 0, id: 1, customerId: 1, status: 1, total: 1, paid: 1, date: 1 } },
        )
        .toArray() as Promise<SalesOrder[]>,
      db
        .collection<Voucher>("vouchers")
        .find(
          { partyType: "customer", type: { $ne: "journal" } },
          {
            projection: {
              _id: 0,
              partyType: 1,
              partyId: 1,
              type: 1,
              amount: 1,
              refType: 1,
              refId: 1,
            },
          },
        )
        .toArray() as Promise<Voucher[]>,
    ]);
  const lowStock = products.filter((p) => (p.stock || 0) <= (p.reorderLevel || 0));
  const creditReminders = customers
    .map((c) => creditReminderNotice(c, sales, vouchers))
    .filter((n): n is NonNullable<typeof n> => n != null);

  return {
    lowStock: lowStock.map((p) => ({
      id: p.id,
      name: p.name,
      stock: p.stock,
      reorderLevel: p.reorderLevel,
    })),
    pendingDeliveries: pendingDeliveries.map((d) => ({
      id: d.id,
      challanNo: d.challanNo,
      customerName: d.customerName,
    })),
    pendingPurchases: pendingPurchases.map((p) => ({
      id: p.id,
      orderNo: p.orderNo,
      supplierName: p.supplierName,
    })),
    pendingSales: pendingSales.map((s) => ({
      id: s.id,
      orderNo: s.orderNo,
      customerName: s.customerName,
    })),
    creditReminders,
  };
});

// ---------- Health check ----------
export const mongoHealthFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    await requireUser();
    const db = await getDb();
    await db.command({ ping: 1 });
    await ensureSeeded();
    const counts: Record<string, number> = {};
    for (const name of [
      "customers",
      "suppliers",
      "products",
      "cylinders",
      "movements",
      "sales",
      "deliveries",
      "expenses",
      "ledger",
      "purchases",
      "stockMovements",
      "vouchers",
      "employees",
      "payroll",
      "accounts",
      "chartOfAccounts",
      "assets",
    ] as const) {
      counts[name] = await db.collection(name).countDocuments();
    }
    return { ok: true, db: process.env.MONGODB_DB || "insaf_gas_corp", counts };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
});
