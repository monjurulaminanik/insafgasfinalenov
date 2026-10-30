import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function detailedAudit() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const products = await db.collection("products").find({}).toArray();
  const stockMovements = await db.collection("stockMovements").find({}).toArray();
  const sales = await db.collection("sales").find({}).toArray();
  const purchases = await db.collection("purchases").find({}).toArray();

  const mitar = products.find(p => p.id === "0n4pn2g1");
  const mitarMovements = stockMovements.filter(m => m.productId === "0n4pn2g1" || m.productName === "mitar");

  console.log("=== MITAR MOVEMENTS BREAKDOWN ===");
  let cumulative = 0;
  for (const [idx, m] of mitarMovements.entries()) {
    const qty = Number(m.quantity) || 0;
    const isDirectionIn = m.type === "in" || m.movementType === "RECEIPT" || m.movementType === "PURCHASE_RECEIVED" || m.movementType === "ADJUSTMENT_IN" || m.direction === "in";
    const delta = isDirectionIn ? qty : -qty;
    cumulative += delta;
    console.log(`[${idx + 1}] ID: ${m.id} | Date: ${m.date} | Type: ${m.type}/${m.movementType} | Qty: ${qty} (${delta > 0 ? '+' : ''}${delta}) | StoredBalAfter: ${m.balanceAfter} | CalculatedCumulative: ${cumulative} | Notes: ${m.notes || ''}`);
  }

  console.log("\n=== SUMMARY RECONCILIATION FOR ALL PRODUCTS ===");
  for (const p of products) {
    const pMovements = stockMovements.filter(m => m.productId === p.id || m.productName === p.name);
    let opening = 0;
    let purchaseIn = 0;
    let salesReturnIn = 0;
    let adjustIn = 0;
    let salesOut = 0;
    let purchaseReturnOut = 0;
    let adjustOut = 0;

    for (const m of pMovements) {
      const q = Number(m.quantity) || 0;
      if (m.id?.startsWith("INIT-") || m.notes?.toLowerCase().includes("initial") || m.refType === "adjustment" && m.id?.startsWith("INIT-")) {
        opening += q;
      } else if (m.movementType === "PURCHASE_RECEIVED" || m.movementType === "RECEIPT" || (m.type === "in" && m.refType === "purchase")) {
        purchaseIn += q;
      } else if (m.movementType === "SALES_RETURN" || (m.type === "return" && m.refType === "sales")) {
        salesReturnIn += q;
      } else if (m.movementType === "ADJUSTMENT_IN" || (m.type === "adjust" && q > 0)) {
        adjustIn += q;
      } else if (m.movementType === "SALE_COMPLETED" || m.movementType === "SALE_ISSUE" || (m.type === "out" && m.refType === "sales")) {
        salesOut += q;
      } else if (m.movementType === "PURCHASE_RETURN" || (m.type === "return" && m.refType === "purchase")) {
        purchaseReturnOut += q;
      } else if (m.movementType === "ADJUSTMENT_OUT" || (m.type === "adjust" && q < 0)) {
        adjustOut += Math.abs(q);
      } else if (m.type === "in" || m.direction === "in") {
        purchaseIn += q;
      } else if (m.type === "out" || m.direction === "out") {
        salesOut += q;
      }
    }

    const expectedOnHand = opening + purchaseIn + salesReturnIn + adjustIn - salesOut - purchaseReturnOut - adjustOut;
    console.log(`Product: "${p.name}" (${p.id}) [${p.productType}]`);
    console.log(`  Opening: ${opening} | PurchaseIn: ${purchaseIn} | SalesReturn: ${salesReturnIn} | AdjustIn: ${adjustIn}`);
    console.log(`  SalesOut: ${salesOut} | PurchReturnOut: ${purchaseReturnOut} | AdjustOut: ${adjustOut}`);
    console.log(`  => Formula: ${opening} + ${purchaseIn + salesReturnIn + adjustIn} - ${salesOut + purchaseReturnOut + adjustOut} = ${expectedOnHand}`);
  }

  await client.close();
}

detailedAudit().catch(console.error);
