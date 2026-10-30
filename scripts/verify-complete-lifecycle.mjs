import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");
const dbName = "InsafCorporation";

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log("=== Testing Complete Order-Delivery Lifecycle in Database ===");

  // 1. Pick a test product
  const testProduct = await db.collection("products").findOne({ id: "p6" });
  console.log("Product:", testProduct.name, "Initial stock:", testProduct.stock);

  // 2. Check Cylinder Inventory before test
  const cylInvBefore = await db.collection("cylinderInventory").findOne({ productId: "p6" });
  console.log("Cylinder Inventory before:", {
    onHand: cylInvBefore?.onHand,
    reserved: cylInvBefore?.reserved,
    available: cylInvBefore?.available,
    stockOut: cylInvBefore?.stockOut,
  });

  // Verify that deliveries has 2fycptfz as delivered
  const del = await db.collection("deliveries").findOne({ id: "2fycptfz" });
  console.log("Delivery 2fycptfz status:", del.status, "confirmedAt:", del.confirmedAt);

  // Verify SO of4ewfqt
  const so = await db.collection("sales").findOne({ id: "of4ewfqt" });
  console.log("Sales order of4ewfqt status:", so.status);

  await client.close();
  console.log("Lifecycle verification check completed.");
}

main().catch(console.error);
