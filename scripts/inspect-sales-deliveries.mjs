import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function inspectSalesAndDeliveries() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const sales = await db.collection("sales").find({}).toArray();
  const deliveries = await db.collection("deliveries").find({}).toArray();
  const stockMovements = await db.collection("stockMovements").find({}).toArray();

  console.log("=== ALL SALES ORDERS & THEIR STATUS / STOCK MOVEMENTS ===");
  for (const so of sales) {
    const soMoves = stockMovements.filter(m => m.refId === so.id || m.notes?.includes(so.orderNo));
    const soDeliveries = deliveries.filter(d => d.salesOrderId === so.id);
    console.log(`SO: ${so.orderNo} (${so.id}) | Status: ${so.status} | Items: ${JSON.stringify(so.items.map(i => ({ p: i.productName || i.productId, q: i.quantity })))}`);
    console.log(`   StockMovements: ${soMoves.map(m => `${m.id} (${m.type}/${m.movementType} qty:${m.quantity})`).join(", ") || "None"}`);
    console.log(`   Deliveries: ${soDeliveries.map(d => `${d.deliveryNo || d.id} (status:${d.status})`).join(", ") || "None"}`);
  }

  await client.close();
}

inspectSalesAndDeliveries().catch(console.error);
