import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function inspectNitrogen() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const stockMovements = await db.collection("stockMovements").find({}).toArray();
  const sales = await db.collection("sales").find({}).toArray();
  const cylinders = await db.collection("cylinders").find({ productId: "p5" }).toArray();
  const cylInv = await db.collection("cylinderInventory").findOne({ productId: "p5" });

  console.log("=== Nitrogen Industrial (p5) ===");
  console.log("Stock movements:", JSON.stringify(stockMovements.filter(m => m.productId === "p5"), null, 2));
  console.log("Sales with p5:", JSON.stringify(sales.filter(s => s.items?.some(it => it.productId === "p5")), null, 2));
  console.log("Registered cylinders with p5:", cylinders.length);
  console.log("Cylinder inventory doc:", JSON.stringify(cylInv, null, 2));

  await client.close();
}

inspectNitrogen().catch(console.error);
