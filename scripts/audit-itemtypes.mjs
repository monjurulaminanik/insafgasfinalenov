import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const products = await db.collection("products").find({}).toArray();
  const pMap = new Map(products.map(p => [p.id, p]));

  console.log("--- SALES WITH MISMATCHED ITEMTYPE ---");
  const sales = await db.collection("sales").find({}).toArray();
  for (const s of sales) {
    for (const it of s.items || []) {
      const p = pMap.get(it.productId);
      if (p && it.itemType !== p.productType) {
        console.log(`SO ${s.orderNo} (${s.id}): item "${it.productName}" (${it.productId}) has itemType='${it.itemType}' but product has '${p.productType}'`);
      }
    }
  }

  console.log("\n--- DELIVERIES WITH MISMATCHED ITEMTYPE ---");
  const dels = await db.collection("deliveries").find({}).toArray();
  for (const d of dels) {
    for (const it of d.items || []) {
      const p = pMap.get(it.productId);
      if (p && it.itemType !== p.productType) {
        console.log(`DC ${d.challanNo} (${d.id}): item "${it.productName}" (${it.productId}) has itemType='${it.itemType}' but product has '${p.productType}'`);
      }
    }
  }

  await client.close();
}

main().catch(console.error);
