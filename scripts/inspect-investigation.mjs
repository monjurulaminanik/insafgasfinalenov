import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  console.log("=== PRODUCTS ===");
  const products = await db.collection("products").find({}).toArray();
  for (const p of products) {
    console.log(`[${p.id}] "${p.name}" (Code: ${p.code}) Type: ${p.productType} UOM: ${p.uom} Cat: ${p.category} Stock: ${p.stock}`);
  }

  console.log("\n=== ARGAN & ROSE STOVE SPECIFICS ===");
  const targets = products.filter(p => /argan|argon|rose|stove/i.test(p.name) || /argan|argon|rose|stove/i.test(p.code));
  for (const t of targets) {
    console.log(JSON.stringify(t, null, 2));

    console.log(`--- Inventory collections for ${t.id} (${t.name}) ---`);
    const gasInv = await db.collection("gasInventory").findOne({ productId: t.id });
    const cylInv = await db.collection("cylinderInventory").findOne({ productId: t.id });
    const prodInv = await db.collection("productInventory").findOne({ productId: t.id });
    console.log("gasInventory:", gasInv);
    console.log("cylinderInventory:", cylInv);
    console.log("productInventory:", prodInv);

    const cylCount = await db.collection("cylinders").countDocuments({ productId: t.id });
    const cylInStock = await db.collection("cylinders").countDocuments({ productId: t.id, status: "in_stock" });
    const cylInStockFull = await db.collection("cylinders").countDocuments({ productId: t.id, status: "in_stock", fillLevel: { $ne: "empty" } });
    console.log(`Cylinders in DB: Total=${cylCount}, in_stock=${cylInStock}, in_stock_full=${cylInStockFull}`);

    // By warehouse
    const cyls = await db.collection("cylinders").find({ productId: t.id }).toArray();
    const byWh = {};
    for (const c of cyls) {
      const wh = c.warehouse || c.location || "UNKNOWN";
      byWh[wh] = (byWh[wh] || 0) + 1;
    }
    console.log("Cylinders by warehouse:", byWh);

    const movs = await db.collection("stockMovements").find({ productId: t.id }).toArray();
    console.log(`Stock movements count: ${movs.length}`);
    for (const m of movs) {
      console.log(`  Move: id=${m.id} date=${m.date} type=${m.type} dir=${m.direction} movType=${m.movementType} qty=${m.quantity} ref=${m.refType}/${m.refId} notes=${m.notes}`);
    }
  }

  console.log("\n=== SALES ORDERS WITH ARGAN OR ROSE ===");
  const sales = await db.collection("sales").find({}).toArray();
  for (const s of sales) {
    const hasTarget = s.items?.some(it => /argan|argon|rose|stove/i.test(it.productName) || targets.some(t => t.id === it.productId));
    if (hasTarget) {
      console.log(`SO: ${s.id} (${s.orderNo}) status=${s.status} customer=${s.customerName}`);
      for (const it of s.items || []) {
        console.log(`   Item: prodId=${it.productId} name="${it.productName}" itemType=${it.itemType} qty=${it.quantity} price=${it.price}`);
      }
    }
  }

  console.log("\n=== DELIVERIES WITH ARGAN OR ROSE ===");
  const deliveries = await db.collection("deliveries").find({}).toArray();
  for (const d of deliveries) {
    const hasTarget = d.items?.some(it => /argan|argon|rose|stove/i.test(it.productName) || targets.some(t => t.id === it.productId));
    if (hasTarget) {
      console.log(`Delivery: ${d.id} (${d.challanNo || d.deliveryNo}) status=${d.status} soId=${d.salesOrderId}`);
      for (const it of d.items || []) {
        console.log(`   Item: prodId=${it.productId} name="${it.productName}" itemType=${it.itemType} qty=${it.quantity} cylIds=${it.cylinderIds?.length || 0}`);
      }
    }
  }

  await client.close();
}

main().catch(console.error);
