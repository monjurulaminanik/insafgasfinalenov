import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");
const dbName = "InsafCorporation";

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log("=== SO-2026-000038 / of4ewfqt ===");
  const order = await db.collection("salesOrders").findOne({
    $or: [{ orderNo: "SO-2026-000038" }, { invoiceNo: "SO-2026-000038" }, { id: "of4ewfqt" }]
  });
  console.log("Order:", JSON.stringify(order, null, 2));

  console.log("\n=== DC-2026-000029 / 2fycptfz ===");
  const delivery = await db.collection("deliveries").findOne({
    $or: [{ challanNo: "DC-2026-000029" }, { id: "2fycptfz" }]
  });
  console.log("Delivery:", JSON.stringify(delivery, null, 2));

  await client.close();
}

run().catch(console.error);
