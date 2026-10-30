import { createServerFn } from "@tanstack/react-start";
import type { CostingMethod, Product, ProductType, UnitOfMeasure } from "@/types";

const clean = <T>(doc: any): T => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
};

const UOMS = new Set<UnitOfMeasure>(["kg", "cyl", "ltr", "pcs"]);
const TYPES = new Set<ProductType>(["gas", "cylinder", "product"]);
const COSTING = new Set<CostingMethod>(["fifo", "lifo", "average"]);

async function findProductDoc(id: string) {
  const { getDb } = await import("./mongo.server");
  const db = await getDb();
  const key = String(id || "").trim();
  if (!key) return null;
  return db.collection("products").findOne({ id: key });
}

export const updateProductFn = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; payload: Record<string, unknown> }) => d)
  .handler(async ({ data }): Promise<Product> => {
    const { requireUser } = await import("./session.server");
    const { roleCanAccess } = await import("./settings.server");
    const user = await requireUser();
    if (user.role !== "Administrator") {
      const allowed = await roleCanAccess(user.role, "products");
      if (!allowed) throw new Error("Not allowed");
    }

    const id = String(data.id || "").trim();
    if (!id) throw new Error("Missing product id");
    const existing = await findProductDoc(id);
    if (!existing) throw new Error("Product not found");

    const src = data.payload && typeof data.payload === "object" ? data.payload : {};
    const patch: Record<string, unknown> = {};

    if (src.code != null) {
      const code = String(src.code).trim();
      patch.code = code;
    }
    if (src.name != null) {
      const name = String(src.name).trim();
      if (name.length < 2) throw new Error("Name required");
      patch.name = name;
    }
    if (src.category != null) {
      const category = String(src.category).trim();
      if (!category) throw new Error("Category required");
      patch.category = category;
    }
    if (src.productType != null) {
      const productType = String(src.productType).trim();
      if (!productType) throw new Error("Product type required");
      patch.productType = productType;
    }
    if (src.uom != null) {
      const uom = String(src.uom) as UnitOfMeasure;
      if (!UOMS.has(uom)) throw new Error("Invalid unit");
      patch.uom = uom;
    }
    if (src.price != null) {
      const price = Number(src.price);
      if (!Number.isFinite(price) || price < 0) throw new Error("Invalid selling price");
      patch.price = price;
    }
    if (src.cost != null) {
      const cost = Number(src.cost);
      if (!Number.isFinite(cost) || cost < 0) throw new Error("Invalid purchase price");
      patch.cost = cost;
    }
    if (src.reorderLevel != null) {
      const reorderLevel = Number(src.reorderLevel);
      if (!Number.isFinite(reorderLevel) || reorderLevel < 0)
        throw new Error("Invalid reorder level");
      patch.reorderLevel = reorderLevel;
    }
    if ("image" in src) {
      patch.image = src.image ? String(src.image) : "";
    }
    if ("incomeAccountId" in src) {
      patch.incomeAccountId = src.incomeAccountId ? String(src.incomeAccountId) : "";
    }
    if ("expenseAccountId" in src) {
      patch.expenseAccountId = src.expenseAccountId ? String(src.expenseAccountId) : "";
    }
    if (src.costingMethod != null) {
      const costingMethod = String(src.costingMethod) as CostingMethod;
      if (!COSTING.has(costingMethod)) throw new Error("Invalid costing method");
      patch.costingMethod = costingMethod;
    }
    if (src.taxRate != null) {
      const taxRate = Number(src.taxRate);
      if (Number.isFinite(taxRate) && taxRate >= 0) patch.taxRate = taxRate;
    }

    patch.updatedAt = new Date().toISOString();

    const { getDb } = await import("./mongo.server");
    const db = await getDb();
    const result = await db
      .collection("products")
      .updateOne({ id: String(existing.id) }, { $set: patch });
    if (result.matchedCount === 0) {
      throw new Error(`Record not found (products/${existing.id})`);
    }
    const next = await findProductDoc(String(existing.id));
    if (!next) throw new Error("Update failed — record missing after write");
    return clean<Product>(next);
  });
