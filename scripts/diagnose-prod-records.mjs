import { MongoClient } from "mongodb";

const PROD_DB_URI =
  (process.env.MONGODB_URI || "");

async function diagnose() {
  const client = new MongoClient(PROD_DB_URI);
  await client.connect();
  const db = client.db("InsafCorporation");

  const products = await db.collection("products").find({}).toArray();
  const stockMovements = await db.collection("stockMovements").find({}).toArray();
  const cylinders = await db.collection("cylinders").find({}).toArray();
  const sales = await db.collection("sales").find({}).toArray();
  const purchases = await db.collection("purchases").find({}).toArray();

  for (const p of products) {
    console.log("====================================================");
    console.log(`PRODUCT: ${p.name} (ID: ${p.id})`);
    console.log(`Stored stock: ${p.stock}, initialStock: ${p.initialStock}, openingStock: ${p.openingStock}, uom: ${p.uom}`);
    const pCyls = cylinders.filter((c) => c.productId === p.id);
    console.log(`Physical Cylinders count: ${pCyls.length}`);
    const pMovements = stockMovements.filter((m) => m.productId === p.id);
    console.log(`StockMovements count: ${pMovements.length}`);
    for (const m of pMovements) {
      console.log(
        `  - Movement: id=${m.id}, type=${m.type}, qty=${m.quantity}, balanceAfter=${m.balanceAfter}, refType=${m.refType}, refId=${m.refId}, notes=${m.notes}`
      );
    }
    const pSales = sales.filter((s) => s.items?.some((i) => i.productId === p.id));
    console.log(`Sales with this product: ${pSales.length}`);
    for (const s of pSales) {
      const item = s.items.find((i) => i.productId === p.id);
      console.log(`  - Sale: ${s.orderNo} status=${s.status} qty=${item.quantity}`);
    }
    const pPurchases = purchases.filter((po) => po.items?.some((i) => i.productId === p.id));
    console.log(`Purchases with this product: ${pPurchases.length}`);
    for (const po of pPurchases) {
      const item = po.items.find((i) => i.productId === p.id);
      console.log(`  - Purchase: ${po.poNumber || po.id} status=${po.status} qty=${item.quantity}`);
    }
  }

  await client.close();
}

diagnose().catch(console.error);
