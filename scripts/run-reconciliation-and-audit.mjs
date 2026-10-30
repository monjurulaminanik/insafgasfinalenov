import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  console.log("=== RUNNING DIRECT RECONCILIATION TEST ===");
  // We can import the actual function from built code or inspect the direct calculation
  const pArgan = await db.collection("products").findOne({ id: "hpgmusaf" });
  const pStove = await db.collection("products").findOne({ id: "3eing5fd" });
  console.log("Argan Product:", pArgan?.name, "Type:", pArgan?.productType, "Stock:", pArgan?.stock);
  console.log("Stove Product:", pStove?.name, "Type:", pStove?.productType, "Stock:", pStove?.stock);

  const cylInvArgan = await db.collection("cylinderInventory").findOne({ productId: "hpgmusaf" });
  console.log("Argan CylinderInventory:", cylInvArgan);

  const prodInvStove = await db.collection("productInventory").findOne({ productId: "3eing5fd" });
  console.log("Stove ProductInventory:", prodInvStove);

  // Check SO-25 items
  const so25 = await db.collection("sales").findOne({ id: "7d6j49zs" });
  console.log("\nSO-25 items:");
  for (const it of so25?.items || []) {
    console.log(`- ${it.productName} (${it.productId}): qty=${it.quantity}, type=${it.itemType}`);
  }

  // Check DC-23 items
  const dc23 = await db.collection("deliveries").findOne({ id: "3st5ywxd" });
  console.log("\nDC-23 items:");
  for (const it of dc23?.items || []) {
    console.log(`- ${it.productName} (${it.productId}): qty=${it.quantity}, type=${it.itemType}`);
  }

  await client.close();
}

main().catch(console.error);
