import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const products = await db.collection("products").find({}).toArray();
  const sales = await db.collection("sales").find({}).toArray();
  const purchases = await db.collection("purchases").find({}).toArray();
  const movements = await db.collection("stockMovements").find({}).toArray();
  const deliveries = await db.collection("deliveries").find({}).toArray();
  const cylinders = await db.collection("cylinders").find({}).toArray();

  console.log("=== PRODUCTS ===");
  for (const p of products) {
    console.log(`ID: ${p.id} | Name: ${p.name} | Type: ${p.productType} | UOM: ${p.uom} | Stock: ${p.stock}`);
  }

  console.log("\n=== PURCHASES ===");
  for (const po of purchases) {
    console.log(`PO: ${po.orderNo} | ID: ${po.id} | Status: ${po.status} | ReceivedAt: ${po.receivedAt}`);
    for (const it of po.items || []) {
      console.log(`   Item: ${it.productName} (${it.productId}) | Qty: ${it.quantity} | RcvQty: ${it.receivedQty}`);
    }
  }

  console.log("\n=== SALES ===");
  for (const so of sales) {
    console.log(`SO: ${so.orderNo} | ID: ${so.id} | Status: ${so.status} | Date: ${so.date}`);
    for (const it of so.items || []) {
      console.log(`   Item: ${it.productName} (${it.productId}) | Qty: ${it.quantity} | ItemType: ${it.itemType}`);
    }
  }

  console.log("\n=== MOVEMENTS COUNT ===", movements.length);
  console.log("=== DELIVERIES COUNT ===", deliveries.length);
  console.log("=== CYLINDERS COUNT ===", cylinders.length);

  await client.close();
}

main().catch(console.error);
