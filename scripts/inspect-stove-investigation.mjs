import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  console.log("--- ALL PURCHASES WITH STOVE OR 3eing5fd ---");
  const pos = await db.collection("purchases").find({
    $or: [
      { "items.productId": "3eing5fd" },
      { "items.productName": /stove/i }
    ]
  }).toArray();
  console.log("POs count:", pos.length);
  for (const p of pos) {
    console.log(p.id, p.orderNo, p.status, JSON.stringify(p.items));
  }

  console.log("\n--- ALL MOVEMENTS WITH 3eing5fd ---");
  const movs = await db.collection("stockMovements").find({ productId: "3eing5fd" }).toArray();
  console.log("Movements count:", movs.length);
  for (const m of movs) {
    console.log(m.id, m.date, m.type, m.direction, m.movementType, m.quantity, m.refType, m.refId, m.notes);
  }

  console.log("\n--- ALL SALES WITH 3eing5fd ---");
  const sales = await db.collection("sales").find({ "items.productId": "3eing5fd" }).toArray();
  console.log("Sales count:", sales.length);
  for (const s of sales) {
    console.log(s.id, s.orderNo, s.status, JSON.stringify(s.items));
  }

  console.log("\n--- ALL DELIVERIES WITH 3eing5fd ---");
  const dels = await db.collection("deliveries").find({ "items.productId": "3eing5fd" }).toArray();
  console.log("Deliveries count:", dels.length);
  for (const d of dels) {
    console.log(d.id, d.challanNo, d.status, d.salesOrderId, JSON.stringify(d.items));
  }

  console.log("\n--- ALL RETURNS WITH 3eing5fd ---");
  const rets = await db.collection("returns").find({ "items.productId": "3eing5fd" }).toArray();
  console.log("Returns count:", rets.length);
  for (const r of rets) {
    console.log(r.id, r.returnNo, r.status, JSON.stringify(r.items));
  }

  console.log("\n--- ANY COLLECTION CONTAINING 200 FOR STOVE ---");
  const allProds = await db.collection("products").find({}).toArray();
  for (const p of allProds) {
    if (p.stock === 200 || p.initialStock === 200 || p.openingStock === 200) {
      console.log("Product with 200:", p.id, p.name, p.stock, p.openingStock);
    }
  }

  await client.close();
}

main().catch(console.error);
