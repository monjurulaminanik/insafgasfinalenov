import { MongoClient } from "mongodb";
const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");
  const cyls = await db.collection("cylinderInventory").find({}).toArray();
  for (const c of cyls) {
    const totalCylDocs = await db.collection("cylinders").countDocuments({ productId: c.productId });
    const fullCylDocs = await db.collection("cylinders").countDocuments({ productId: c.productId, status: "in_stock", fillLevel: { $ne: "empty" } });
    console.log(`${c.productId} | ${c.productName} | onHand: ${c.onHand} | avail: ${c.available} | res: ${c.reserved} | cylDocs: ${totalCylDocs} | fullInStock: ${fullCylDocs}`);
  }
  await client.close();
}
main().catch(console.error);
