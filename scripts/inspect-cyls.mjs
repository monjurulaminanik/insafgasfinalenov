import { MongoClient } from "mongodb";

const PROD_URI =
  (process.env.MONGODB_URI || "");

async function inspectCyls() {
  const client = new MongoClient(PROD_URI);
  await client.connect();
  const db = client.db("InsafCorporation");

  console.log("CYLINDERS GROUPED BY PRODUCT ID:");
  const cyls = await db
    .collection("cylinders")
    .aggregate([
      {
        $group: {
          _id: "$productId",
          total: { $sum: 1 },
          in_stock: { $sum: { $cond: [{ $eq: ["$status", "in_stock"] }, 1, 0] } },
          in_transit: { $sum: { $cond: [{ $eq: ["$status", "in_transit"] }, 1, 0] } },
          at_customer: { $sum: { $cond: [{ $eq: ["$status", "at_customer"] }, 1, 0] } },
          refilling: { $sum: { $cond: [{ $eq: ["$status", "refilling"] }, 1, 0] } },
        },
      },
    ])
    .toArray();
  console.log(cyls);

  console.log("\nALL CYLINDERS LIST (status, serialNumber, productId):");
  const allCyls = await db.collection("cylinders").find({}).toArray();
  for (const c of allCyls) {
    if (c.productId === "p1" || c.productId === "p5") {
      console.log(
        `Cyl ${c.serialNumber || c.id} | Product: ${c.productId} | Status: ${c.status} | Fill: ${c.fillLevel} | Loc: ${c.location}`,
      );
    }
  }

  await client.close();
}

inspectCyls().catch(console.error);
