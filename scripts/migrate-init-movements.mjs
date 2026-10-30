import { MongoClient } from "mongodb";
import { getMovementQtyIn, getMovementQtyOut } from "../src/lib/stock-report.ts";

const PROD_DB_URI =
  (process.env.MONGODB_URI || "");

async function migrate() {
  const client = new MongoClient(PROD_DB_URI);
  await client.connect();
  const db = client.db("InsafCorporation");

  const prods = await db.collection("products").find({}).toArray();
  const moves = await db.collection("stockMovements").find({}).toArray();

  const openingStockMap = {
    p1: 25,
    p2: 20,
    p3: 28,
    p4: 46,
    p5: 6,
    p6: 22,
    "0n4pn2g1": 20,
    "9jdnwagj": 78,
    "59eaw73l": 0,
    hpgmusaf: 0,
    azdmoisv: 100,
  };

  for (const p of prods) {
    const hasInit = moves.some(
      (m) =>
        m.productId === p.id &&
        (m.refId?.startsWith("INIT-") || /initial/i.test(m.notes || "")),
    );
    if (!hasInit) {
      const nonInit = moves.filter((m) => m.productId === p.id);
      const totalIn = nonInit.reduce((sum, m) => sum + getMovementQtyIn(m), 0);
      const totalOut = nonInit.reduce((sum, m) => sum + getMovementQtyOut(m), 0);
      const openQty =
        openingStockMap[p.id] ?? Math.max(0, (p.stock ?? 0) + totalOut - totalIn);
      if (openQty > 0) {
        const initMovement = {
          id: `INIT-${p.id}`,
          date: p.createdAt || "2026-03-01T00:00:00.000Z",
          productId: p.id,
          productName: p.name,
          type: "in",
          movementType: "ADJUSTMENT_IN",
          direction: "in",
          quantity: openQty,
          balanceAfter: openQty,
          unitCost: p.cost || 0,
          totalCost: openQty * (p.cost || 0),
          cogsAmount: openQty * (p.cost || 0),
          costingMethod: "fifo",
          refType: "adjustment",
          refId: `INIT-${p.id}`,
          notes: "Initial opening stock",
          by: "System",
        };
        await db.collection("stockMovements").insertOne(initMovement);
        console.log(`Inserted INIT movement for ${p.name} (Qty: ${openQty})`);
        moves.push(initMovement);
      }
    }
  }

  await client.close();
  console.log("Migration finished.");
}

migrate().catch(console.error);
