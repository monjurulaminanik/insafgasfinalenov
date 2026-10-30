import { MongoClient } from "mongodb";
import { buildStockReport } from "../src/lib/stock-report.ts";
import { buildProductInventory } from "../src/lib/cylinder-inventory.ts";

const PROD_DB_URI =
  (process.env.MONGODB_URI || "");

async function verifyLiveFlow() {
  console.log("==========================================================================================");
  console.log("TESTING LIVE INVENTORY PURCHASE & SALE TRANSACTION FLOW");
  console.log("==========================================================================================");

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

  console.log("\n| Product Name | Stored Stock | Report On Hand | Inv UI On Hand | Reserved | Inv UI Available | Reconciled? |");
  console.log("|---|---|---|---|---|---|---|");

  for (const p of products) {
    const sr = stockMap.get(p.id);
    const inv = invMap.get(p.id);
    const onHand = inv ? inv.full : 0;
    const reserved = inv ? inv.reserved : 0;
    const available = inv ? inv.available : 0;
    const stored = p.stock ?? 0;
    const reportOnHand = sr ? sr.inHand : 0;
    const isOk = stored === onHand && reportOnHand === onHand && available === Math.max(0, onHand - reserved);

    console.log(`| ${p.name.padEnd(22)} | ${String(stored).padStart(6)} | ${String(reportOnHand).padStart(6)} | ${String(onHand).padStart(6)} | ${String(reserved).padStart(4)} | ${String(available).padStart(6)} | ${isOk ? "YES (MATCH)" : "NO (DIFF)"} |`);
  }

  console.log("\n--- SIMULATION OF NEW PURCHASE (+50) & NEW SALE (-20) ---");
  const sampleProduct = products.find((p) => p.name.includes("Oxygen") || p.name.includes("LPG"));
  if (sampleProduct) {
    const initialOnHand = invMap.get(sampleProduct.id)?.full ?? 0;
    console.log(`Sample Product: ${sampleProduct.name}`);
    console.log(`Initial On Hand: ${initialOnHand}`);

    // Simulate Purchase of +50
    const mockPurchaseMovement = {
      id: "MOCK-PO-01",
      date: new Date().toISOString(),
      productId: sampleProduct.id,
      productName: sampleProduct.name,
      type: "in",
      direction: "in",
      quantity: 50,
      refType: "purchase",
      notes: "Test Purchase Receipt",
    };
    const afterPurchaseReport = buildStockReport(
      products,
      [...stockMovements, mockPurchaseMovement],
      { preset: "all", from: "", to: "" }
    );
    const purchaseOnHand = afterPurchaseReport.find((r) => r.id === sampleProduct.id)?.inHand ?? 0;
    console.log(`After Purchase (+50): Expected = ${initialOnHand + 50}, Calculated = ${purchaseOnHand} -> ${purchaseOnHand === initialOnHand + 50 ? "PASS" : "FAIL"}`);

    // Simulate Sale of -20
    const mockSaleMovement = {
      id: "MOCK-SO-01",
      date: new Date().toISOString(),
      productId: sampleProduct.id,
      productName: sampleProduct.name,
      type: "out",
      direction: "out",
      quantity: 20,
      refType: "sales",
      notes: "Test Sale Deduction",
    };
    const afterSaleReport = buildStockReport(
      products,
      [...stockMovements, mockPurchaseMovement, mockSaleMovement],
      { preset: "all", from: "", to: "" }
    );
    const saleOnHand = afterSaleReport.find((r) => r.id === sampleProduct.id)?.inHand ?? 0;
    console.log(`After Sale (-20): Expected = ${initialOnHand + 50 - 20}, Calculated = ${saleOnHand} -> ${saleOnHand === initialOnHand + 30 ? "PASS" : "FAIL"}`);
  }

  await client.close();
}

verifyLiveFlow().catch(console.error);
