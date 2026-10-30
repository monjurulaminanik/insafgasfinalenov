import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");
const dbName = "InsafCorporation";

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const distinctProductsInCyls = await db.collection("cylinders").distinct("productId");
  console.log("Distinct productIds in cylinders collection:", distinctProductsInCyls);

  for (const pid of distinctProductsInCyls) {
    const p = await db.collection("products").findOne({ id: pid });
    const count = await db.collection("cylinders").countDocuments({ productId: pid });
    console.log(`Product: ${p?.name || pid} (${pid}) -> ${count} cylinders in 'cylinders' collection`);
  }

  const trackingSetting = await db.collection("appSettings").findOne({ key: "cylinderTracking" });
  console.log("Cylinder Tracking Setting:", trackingSetting);

  await client.close();
}

run().catch(console.error);
