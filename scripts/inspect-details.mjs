import { MongoClient } from "mongodb";

const PROD_DB_URI =
  (process.env.MONGODB_URI || "");

async function inspectDetails() {
  const client = new MongoClient(PROD_DB_URI);
  await client.connect();
  const db = client.db("InsafCorporation");

  console.log("APP USERS IN PROD DB:");
  const users = await db.collection("appUsers").find({}).toArray();
  for (const u of users) {
    console.log(
      `User: ${u.username} | Role: ${u.role} | Active: ${u.active} | Pass Prefix: ${u.password ? u.password.slice(0, 10) : "NONE"}`,
    );
  }

  console.log("\nSTOCK MOVEMENTS IN PROD DB:");
  const sm = await db.collection("stockMovements").find({}).toArray();
  for (const m of sm) {
    console.log(
      `SM ID: ${m.id} | ProdId: ${m.productId} | ProdName: ${m.productName} | Type: ${m.type} | Qty: ${m.quantity} | RefType: ${m.refType} | RefId: ${m.refId} | Notes: ${m.notes}`,
    );
  }

  console.log("\nCYLINDERS FOR P1:");
  const p1Cyls = await db.collection("cylinders").find({ productId: "p1" }).toArray();
  console.log(`Count of p1 cylinders: ${p1Cyls.length}`);
  const serials = p1Cyls.map((c) => c.serialNumber || c.id);
  console.log("P1 Serials sample:", serials.slice(0, 5), "...", serials.slice(-5));

  await client.close();
}

inspectDetails().catch(console.error);
