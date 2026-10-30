import { MongoClient } from "mongodb";
import { buildStockReport } from "../src/lib/stock-report.ts";
import { buildProductInventory } from "../src/lib/cylinder-inventory.ts";

const PROD_DB_URI =
  (process.env.MONGODB_URI || "");

async function checkAlignment() {
  const client = new MongoClient(PROD_DB_URI);
  await client.connect();
  const db = client.db("InsafCorporation");

  const products = await db.collection("products").find({}).toArray();
  const stockMovements = await db.collection("stockMovements").find({}).toArray();
  const cylinders = await db.collection("cylinders").find({}).toArray();
  const sales = await db.collection("sales").find({}).toArray();
  const deliveries = await db.collection("deliveries").find({}).toArray();

  const stockReport = buildStockReport(products, stockMovements, { preset: "all", from: "", to: "" });
  const stockMap = new Map(stockReport.map((r) => [r.id, r]));
  const invRows = buildProductInventory(products, cylinders, sales, deliveries, stockMovements);
  const invMap = new Map(invRows.map((r) => [r.productId, r]));

  console.log("==========================================================================================");
  console.log("DETAILED PRODUCT BY PRODUCT TRACE & ALIGNMENT CHECK");
  console.log("==========================================================================================");

  let mismatchCount = 0;

  for (const p of products) {
    const sr = stockMap.get(p.id);
    const inv = invMap.get(p.id);

    const storedStock = p.stock ?? 0;
    const reportOnHand = sr ? sr.inHand : 0;
    const invOnHand = inv ? inv.full : 0;
    const invReserved = inv ? inv.reserved : 0;
    const invAvailable = inv ? inv.available : 0;

    const match = storedStock === reportOnHand && reportOnHand === invOnHand;
    if (!match) mismatchCount++;

    console.log(`Product: ${p.name.padEnd(24)} (ID: ${p.id})`);
    console.log(`  Stored Stock:          ${storedStock}`);
    console.log(`  Report Opening:        ${sr?.openingQty ?? 0}`);
    console.log(`  Report Qty In:         ${sr?.qtyIn ?? 0}`);
    console.log(`  Report Qty Out:        ${sr?.qtyOut ?? 0}`);
    console.log(`  Report On Hand:        ${reportOnHand}`);
    console.log(`  Inventory Page OnHand: ${invOnHand}`);
    console.log(`  Inventory Page Rsvd:   ${invReserved}`);
    console.log(`  Inventory Page Avail:  ${invAvailable}`);
    console.log(`  Status:                ${match ? "MATCH" : "MISMATCH"}`);
    console.log("------------------------------------------------------------------------------------------");
  }

  console.log(`TOTAL MISMATCHES: ${mismatchCount}`);
  await client.close();
}

checkAlignment().catch(console.error);
