import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function inspectArgonAndIna() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const stockMovements = await db.collection("stockMovements").find({}).toArray();

  console.log("=== Argon 0.98 ===");
  console.log(JSON.stringify(stockMovements.filter(m => m.productId === "azdmoisv" || m.productName?.includes("Argon 0.98")), null, 2));

  console.log("=== Ina Church ===");
  console.log(JSON.stringify(stockMovements.filter(m => m.productId === "4cos6kjk" || m.productName?.includes("Ina Church")), null, 2));

  await client.close();
}

inspectArgonAndIna().catch(console.error);
