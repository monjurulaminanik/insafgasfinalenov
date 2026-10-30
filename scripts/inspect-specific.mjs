import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function inspectMovements() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const stockMovements = await db.collection("stockMovements").find({}).toArray();
  const products = await db.collection("products").find({}).toArray();

  for (const name of ["Argon 0.98", "Ina Church", "Nitrogen Industrial", "Oxygen", "Argan"]) {
    const p = products.find(prod => prod.name === name);
    if (!p) continue;
    console.log(`\n================== ${name} (${p.id}) ==================`);
    const pMovs = stockMovements.filter(m => m.productId === p.id || m.productName === p.name);
    console.log(JSON.stringify(pMovs, null, 2));
  }

  await client.close();
}

inspectMovements().catch(console.error);
