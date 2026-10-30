import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const products = await db.collection("products").find({}).toArray();
  const gasInv = await db.collection("gasInventory").find({}).toArray();
  const cylInv = await db.collection("cylinderInventory").find({}).toArray();
  const prodInv = await db.collection("productInventory").find({}).toArray();

  console.log("=== GAS INVENTORY DOCS ===");
  for (const g of gasInv) {
    console.log(`productId: ${g.productId} | name: ${g.productName} | onHand: ${g.onHand} | stockIn: ${g.stockIn} | stockOut: ${g.stockOut}`);
  }

  console.log("\n=== CYLINDER INVENTORY DOCS ===");
  for (const c of cylInv) {
    console.log(`productId: ${c.productId} | name: ${c.productName} | onHand: ${c.onHand} | reserved: ${c.reserved} | available: ${c.available}`);
  }

  console.log("\n=== PRODUCT INVENTORY DOCS ===");
  for (const p of prodInv) {
    console.log(`productId: ${p.productId} | name: ${p.productName} | onHand: ${p.onHand}`);
  }

  console.log("\n=== PRODUCTS ===");
  for (const p of products) {
    const g = gasInv.find(x => x.productId === p.id);
    const c = cylInv.find(x => x.productId === p.id);
    const pr = prodInv.find(x => x.productId === p.id);
    console.log(`ID: ${p.id} | Name: ${p.name} | Type: ${p.productType} | UOM: ${p.uom} | p.stock: ${p.stock} | gasOnHand: ${g?.onHand} | cylOnHand: ${c?.onHand} (avail:${c?.available}) | prodOnHand: ${pr?.onHand}`);
  }

  await client.close();
}

main().catch(console.error);
