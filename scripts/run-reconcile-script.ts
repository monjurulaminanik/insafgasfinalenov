import { MongoClient } from "mongodb";
import { reconcileDatabaseInventory } from "../src/lib/inventory.server.ts";

const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  console.log("Triggering reconcileDatabaseInventory...");
  const res = await reconcileDatabaseInventory(db);
  console.log("Reconciliation complete!");
  console.log("Totals:", res.totals);

  const pArgan = await db.collection("products").findOne({ id: "hpgmusaf" });
  console.log("Argan stock in products:", pArgan?.stock);
  const cylArgan = await db.collection("cylinderInventory").findOne({ productId: "hpgmusaf" });
  console.log("Argan in cylinderInventory:", {
    onHand: cylArgan?.onHand,
    available: cylArgan?.available,
    reserved: cylArgan?.reserved,
    stockIn: cylArgan?.stockIn,
    stockOut: cylArgan?.stockOut,
  });

  const pStove = await db.collection("products").findOne({ id: "3eing5fd" });
  console.log("Stove stock in products:", pStove?.stock);
  const prodStove = await db.collection("productInventory").findOne({ productId: "3eing5fd" });
  console.log("Stove in productInventory:", {
    onHand: prodStove?.onHand,
    stockIn: prodStove?.stockIn,
    stockOut: prodStove?.stockOut,
  });

  await client.close();
}

main().catch(console.error);
