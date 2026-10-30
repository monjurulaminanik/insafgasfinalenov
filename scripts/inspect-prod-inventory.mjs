import { MongoClient } from "mongodb";

const PROD_URI =
  (process.env.MONGODB_URI || "");

async function inspectProd() {
  console.log("Connecting to production MongoDB Atlas...");
  const client = new MongoClient(PROD_URI);
  await client.connect();
  const db = client.db("InsafCorporation");

  console.log("\n=======================================================");
  console.log("1. PRODUCTS IN PRODUCTION DATABASE:");
  console.log("=======================================================");
  const products = await db.collection("products").find({}).toArray();
  for (const p of products) {
    console.log(
      `ID: ${p.id} | Code: ${p.code} | Name: ${p.name} | Stock (On Hand): ${p.stock} | Cost: ${p.cost} | Price: ${p.price} | Type: ${p.productType} | UOM: ${p.uom}`,
    );
  }

  console.log("\n=======================================================");
  console.log("2. CYLINDERS SUMMARY IN PRODUCTION DATABASE:");
  console.log("=======================================================");
  const totalCylinders = await db.collection("cylinders").countDocuments();
  const cylindersByStatus = await db
    .collection("cylinders")
    .aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
    .toArray();
  console.log(`Total Cylinders in collection: ${totalCylinders}`);
  console.log("Cylinders by Status:", cylindersByStatus);

  const cylindersByOwnership = await db
    .collection("cylinders")
    .aggregate([{ $group: { _id: "$ownedBy", count: { $sum: 1 } } }])
    .toArray();
  console.log("Cylinders by Ownership:", cylindersByOwnership);

  console.log("\n=======================================================");
  console.log("3. STOCK MOVEMENTS FOR LPG 12KG & NITROGEN:");
  console.log("=======================================================");
  // Find LPG 12kg product
  const lpgProd = products.find(
    (p) => p.code === "LPG-12" || p.id === "p1" || /12kg/i.test(p.name),
  );
  const n2Prod = products.find(
    (p) => p.code === "N2-B" || p.id === "p5" || /nitrogen/i.test(p.name),
  );

  if (lpgProd) {
    console.log(
      `\n--- Movements for ${lpgProd.name} (ID: ${lpgProd.id}, Code: ${lpgProd.code}) ---`,
    );
    const lpgMoves = await db
      .collection("stockMovements")
      .find({
        $or: [{ productId: lpgProd.id }, { productName: { $regex: /12kg/i } }],
      })
      .sort({ date: 1, _id: 1 })
      .toArray();
    console.log(`Found ${lpgMoves.length} movements:`);
    let calcBalance = 0;
    for (const m of lpgMoves) {
      const qty = m.quantity || 0;
      const dir = m.direction || (m.type === "in" ? "in" : "out");
      if (dir === "in") calcBalance += qty;
      else calcBalance -= qty;
      console.log(
        `  [${m.date}] ID: ${m.id} | Type: ${m.type}/${m.movementType} | Qty: ${qty} (${dir}) | BalAfterStored: ${m.balanceAfter} | CalcBal: ${calcBalance} | Ref: ${m.refType}/${m.refId} | Notes: ${m.notes}`,
      );
    }
  }

  if (n2Prod) {
    console.log(`\n--- Movements for ${n2Prod.name} (ID: ${n2Prod.id}, Code: ${n2Prod.code}) ---`);
    const n2Moves = await db
      .collection("stockMovements")
      .find({
        $or: [{ productId: n2Prod.id }, { productName: { $regex: /nitrogen/i } }],
      })
      .sort({ date: 1, _id: 1 })
      .toArray();
    console.log(`Found ${n2Moves.length} movements:`);
    let calcBalance = 0;
    for (const m of n2Moves) {
      const qty = m.quantity || 0;
      const dir = m.direction || (m.type === "in" ? "in" : "out");
      if (dir === "in") calcBalance += qty;
      else calcBalance -= qty;
      console.log(
        `  [${m.date}] ID: ${m.id} | Type: ${m.type}/${m.movementType} | Qty: ${qty} (${dir}) | BalAfterStored: ${m.balanceAfter} | CalcBal: ${calcBalance} | Ref: ${m.refType}/${m.refId} | Notes: ${m.notes}`,
      );
    }
  }

  console.log("\n=======================================================");
  console.log("4. COST LAYERS IN PRODUCTION DATABASE:");
  console.log("=======================================================");
  const costLayers = await db.collection("costLayers").find({}).toArray();
  for (const cl of costLayers) {
    console.log(
      `ID: ${cl.id} | ProductId: ${cl.productId} | Remaining: ${cl.qtyRemaining} | Cost: ${cl.unitCost} | Date: ${cl.receivedAt}`,
    );
  }

  console.log("\n=======================================================");
  console.log("5. SALES & PURCHASES RECENT ACTIVITY IN PRODUCTION:");
  console.log("=======================================================");
  const sales = await db.collection("sales").find({}).sort({ createdAt: -1 }).limit(10).toArray();
  console.log(`Total Sales Count in DB: ${await db.collection("sales").countDocuments()}`);
  for (const s of sales) {
    console.log(
      `  Sale: ${s.orderNo || s.id} | Status: ${s.status} | Customer: ${s.customerName} | Items: ${JSON.stringify(s.items?.map((i) => ({ p: i.productName, q: i.quantity })))} | Total: ${s.total}`,
    );
  }

  const purchases = await db
    .collection("purchases")
    .find({})
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();
  console.log(`Total Purchases Count in DB: ${await db.collection("purchases").countDocuments()}`);
  for (const p of purchases) {
    console.log(
      `  PO: ${p.orderNo || p.id} | Status: ${p.status} | Supplier: ${p.supplierName} | Items: ${JSON.stringify(p.items?.map((i) => ({ p: i.productName, q: i.quantity, rcv: i.receivedQty })))} | Total: ${p.total}`,
    );
  }

  await client.close();
}

inspectProd().catch(console.error);
