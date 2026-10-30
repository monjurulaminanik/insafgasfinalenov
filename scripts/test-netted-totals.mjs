import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");
const dbName = "InsafCorporation";

function computeNettedTotals(movements) {
  let totalIn = 0;
  let totalOut = 0;

  for (const m of movements) {
    const qty = Number(m.quantity) || 0;
    if (qty <= 0) continue;
    if (m.refType === "adjustment" && (m.refId?.startsWith("INIT-") || /initial/i.test(m.notes || ""))) continue;

    const isReverse = /Reverse/i.test(m.notes || "");
    if (isReverse) {
      if (m.refType === "sales" && (m.type === "in" || m.type === "return")) {
        totalOut = Math.max(0, totalOut - qty);
        continue;
      }
      if (m.refType === "purchase" && m.type === "out") {
        totalIn = Math.max(0, totalIn - qty);
        continue;
      }
    }

    const isIn = m.type === "in" || m.direction === "in" || m.type === "return" || m.movementType === "RECEIPT";
    const isOut = m.type === "out" || m.direction === "out" || m.movementType === "SALE_ISSUE";

    if (isIn) totalIn += qty;
    else if (isOut) totalOut += qty;
  }

  return { totalIn, totalOut };
}

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const moves = await db.collection("stockMovements").find({ productId: "p6" }).toArray();
  const result = computeNettedTotals(moves);
  console.log("Netted totals for Carbon Dioxide (p6):", result);

  await client.close();
}

run().catch(console.error);
