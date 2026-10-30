import { createServerFn } from "@tanstack/react-start";
import type { ProductCategoryRecord } from "@/types";

const DEFAULT_CATEGORY_NAMES = ["LPG", "Industrial", "Medical", "Other"];
const IN_USE_MSG = "This category is currently used by products and cannot be deleted.";

const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

function nameKeyOf(name: string) {
  return name.trim().toLowerCase();
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isDuplicateKeyError(e: unknown) {
  const err = e as { code?: number; message?: string };
  return err?.code === 11000 || /E11000|duplicate key/i.test(err?.message || "");
}

async function requireProductsAccess() {
  const { requireUser } = await import("./session.server");
  const { roleCanAccess } = await import("./settings.server");
  const user = await requireUser();
  if (user.role !== "Administrator") {
    const allowed = await roleCanAccess(user.role, "products");
    if (!allowed) throw new Error("Not allowed");
  }
}

async function ensureProductCategories() {
  const { getDb } = await import("./mongo.server");
  const db = await getDb();
  const coll = db.collection("productCategories");
  try {
    await coll.createIndex({ id: 1 }, { unique: true });
  } catch {
    /* index may already exist */
  }
  try {
    await coll.createIndex({ nameKey: 1 }, { unique: true });
  } catch {
    /* index may already exist */
  }

  const products = await db
    .collection("products")
    .find({}, { projection: { category: 1 } })
    .toArray();
  const names = new Set<string>(DEFAULT_CATEGORY_NAMES);
  for (const p of products) {
    const n = String(p.category || "").trim();
    if (n) names.add(n);
  }

  const existing = await coll.find({}).toArray();
  const existingKeys = new Set(
    existing.map((d) => String(d.nameKey || nameKeyOf(String(d.name || "")))),
  );
  const now = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];
  for (const name of names) {
    const nameKey = nameKeyOf(name);
    if (!nameKey || existingKeys.has(nameKey)) continue;
    existingKeys.add(nameKey);
    inserts.push({
      id: newId(),
      name,
      nameKey,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (inserts.length) {
    try {
      await coll.insertMany(inserts, { ordered: false });
    } catch (e) {
      if (!isDuplicateKeyError(e)) throw e;
    }
  }
}

export const listProductCategoriesFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<ProductCategoryRecord[]> => {
    await requireProductsAccess();
    const { getDb } = await import("./mongo.server");
    await ensureProductCategories();
    const db = await getDb();
    const docs = await db.collection("productCategories").find({}).sort({ name: 1 }).toArray();
    return docs.map((d) => clean<ProductCategoryRecord>(d));
  },
);

export const createProductCategoryFn = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string }) => d)
  .handler(async ({ data }): Promise<ProductCategoryRecord> => {
    await requireProductsAccess();
    const { getDb } = await import("./mongo.server");
    await ensureProductCategories();
    const name = String(data.name || "").trim();
    if (!name) throw new Error("Category name is required");
    const nameKey = nameKeyOf(name);
    const now = new Date().toISOString();
    const doc = { id: newId(), name, nameKey, createdAt: now, updatedAt: now };
    const db = await getDb();
    try {
      await db.collection("productCategories").insertOne(doc);
    } catch (e) {
      if (isDuplicateKeyError(e)) throw new Error("A category with this name already exists");
      throw e;
    }
    return clean<ProductCategoryRecord>(doc);
  });

export const updateProductCategoryFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; name: string }) => d)
  .handler(async ({ data }): Promise<ProductCategoryRecord> => {
    await requireProductsAccess();
    const { getDb } = await import("./mongo.server");
    await ensureProductCategories();
    const name = String(data.name || "").trim();
    if (!name) throw new Error("Category name is required");
    const id = String(data.id);
    const db = await getDb();
    const existing = await db.collection("productCategories").findOne({ id });
    if (!existing) throw new Error("Category not found");
    const oldName = String(existing.name || "");
    const nameKey = nameKeyOf(name);
    const now = new Date().toISOString();
    try {
      const result = await db
        .collection("productCategories")
        .updateOne({ id }, { $set: { name, nameKey, updatedAt: now } });
      if (result.matchedCount === 0) throw new Error("Category not found");
    } catch (e) {
      if (isDuplicateKeyError(e)) throw new Error("A category with this name already exists");
      throw e;
    }
    if (oldName && oldName !== name) {
      await db
        .collection("products")
        .updateMany({ category: oldName }, { $set: { category: name } });
    }
    const doc = await db.collection("productCategories").findOne({ id });
    if (!doc) throw new Error("Category not found");
    return clean<ProductCategoryRecord>(doc);
  });

export const removeProductCategoryFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await requireProductsAccess();
    const { getDb } = await import("./mongo.server");
    await ensureProductCategories();
    const id = String(data.id);
    const db = await getDb();
    const existing = await db.collection("productCategories").findOne({ id });
    if (!existing) throw new Error("Category not found");
    const name = String(existing.name || "");
    const used = name ? await db.collection("products").countDocuments({ category: name }) : 0;
    if (used > 0) throw new Error(IN_USE_MSG);
    const result = await db.collection("productCategories").deleteOne({ id });
    if (result.deletedCount === 0) throw new Error("Category not found");
    return { ok: true };
  });
