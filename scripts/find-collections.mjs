import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");
const dbName = "InsafCorporation";

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const collections = await db.listCollections().toArray();
  console.log("Collections:", collections.map(c => c.name));

  // Find which collection has "of4ewfqt" or "SO-2026-000038"
  for (const c of collections) {
    const doc = await db.collection(c.name).findOne({
      $or: [
        { id: "of4ewfqt" },
        { invoiceNo: "SO-2026-000038" },
        { orderNo: "SO-2026-000038" }
      ]
    });
    if (doc) {
      console.log(`Found in collection: ${c.name}`);
      console.log(JSON.stringify(doc, null, 2));
    }
  }

  await client.close();
}

run().catch(console.error);
