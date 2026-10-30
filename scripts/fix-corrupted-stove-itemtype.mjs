import { MongoClient } from "mongodb";
const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  // Fix SO-2026-000025
  const so = await db.collection("sales").findOne({ id: "7d6j49zs" });
  if (so && so.items) {
    const updatedItems = so.items.map(it => {
      if (it.productId === "3eing5fd" && it.itemType !== "product") {
        return { ...it, itemType: "product" };
      }
      return it;
    });
    await db.collection("sales").updateOne({ id: "7d6j49zs" }, { $set: { items: updatedItems } });
    console.log("Updated SO-2026-000025 stove itemType to product");
  }

  // Fix DC-2026-000023
  const dc = await db.collection("deliveries").findOne({ id: "3st5ywxd" });
  if (dc && dc.items) {
    const updatedItems = dc.items.map(it => {
      if (it.productId === "3eing5fd" && it.itemType !== "product") {
        return { ...it, itemType: "product" };
      }
      return it;
    });
    await db.collection("deliveries").updateOne({ id: "3st5ywxd" }, { $set: { items: updatedItems } });
    console.log("Updated DC-2026-000023 stove itemType to product");
  }

  await client.close();
}

main().catch(console.error);
