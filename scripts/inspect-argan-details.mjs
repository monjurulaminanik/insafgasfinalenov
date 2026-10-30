import { MongoClient } from "mongodb";
const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");
  const p = await db.collection("products").findOne({ id: "hpgmusaf" });
  console.log("PRODUCT:", p);
  const cyls = await db.collection("cylinders").find({ productId: "hpgmusaf" }).toArray();
  console.log("CYLINDERS COUNT:", cyls.length);
  console.log("CYLINDERS:", cyls.map(c => ({ id: c.id, serial: c.serialNumber, status: c.status, fill: c.fillLevel, wh: c.warehouse })));
  const cylInv = await db.collection("cylinderInventory").findOne({ productId: "hpgmusaf" });
  console.log("CYLINDER INVENTORY:", cylInv);
  const gasInv = await db.collection("gasInventory").findOne({ productId: "hpgmusaf" });
  console.log("GAS INVENTORY:", gasInv);
  const prodInv = await db.collection("productInventory").findOne({ productId: "hpgmusaf" });
  console.log("PRODUCT INVENTORY:", prodInv);
  const moves = await db.collection("stockMovements").find({ productId: "hpgmusaf" }).toArray();
  console.log("MOVEMENTS:", moves);
  await client.close();
}
main().catch(console.error);
