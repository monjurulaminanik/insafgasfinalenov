import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");
const dbName = "InsafCorporation";

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const movements = await db.collection("stockMovements").find({ productId: "p6" }).toArray();
  console.log("Movements for p6:");
  for (const m of movements) {
    console.log(`id: ${m.id}, type: ${m.type}, dir: ${m.direction}, mType: ${m.movementType}, qty: ${m.quantity}, refType: ${m.refType}, refId: ${m.refId}, notes: ${m.notes}`);
  }

  // Check sales collection
  const allSales = await db.collection("sales").find({}).toArray();
  const soWithP6 = allSales.filter(s => (s.items || []).some(i => i.productId === "p6"));
  console.log("\nSales with p6:", soWithP6.map(s => ({ id: s.id, orderNo: s.orderNo, status: s.status, items: s.items })));

  // Check deliveries collection
  const allDeliv = await db.collection("deliveries").find({}).toArray();
  const delivWithP6 = allDeliv.filter(d => (d.items || []).some(i => i.productId === "p6"));
  console.log("\nDeliveries with p6:", delivWithP6.map(d => ({ id: d.id, challanNo: d.challanNo, status: d.status, items: d.items })));

  // Check cylinderInventory doc
  const cylDoc = await db.collection("cylinderInventory").findOne({ productId: "p6" });
  console.log("\ncylinderInventory doc for p6:", cylDoc);

  await client.close();
}

run().catch(console.error);
