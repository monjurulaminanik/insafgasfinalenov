import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

function resolveProductType(p) {
  if (!p) return "gas";
  if (p.productType === "cylinder" || p.productType === "gas" || p.productType === "product") {
    return p.productType;
  }
  const uom = String(p.uom || "").toLowerCase();
  if (uom === "pcs") return "product";
  if (uom === "cyl") return "cylinder";
  if (uom === "kg" || uom === "ltr") return "gas";
  const cat = String(p.category || "").toLowerCase();
  if (cat.includes("cylinder")) return "cylinder";
  return "gas";
}

const KNOWN_OPENING_STOCKS = {
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
  "4cos6kjk": 33,
};

function computeReservedQty(productId, sales, deliveries) {
  const openStatuses = new Set(["confirmed", "invoiced", "paid"]);
  const doneDeliveryStatuses = new Set(["delivered", "confirmed"]);
  let reserved = 0;

  for (const so of sales) {
    if (!openStatuses.has(so.status)) continue;
    const item = (so.items || []).find((it) => it.productId === productId);
    if (!item) continue;
    const orderedQty = Number(item.quantity) || 0;
    if (orderedQty <= 0) continue;

    let deliveredQty = 0;
    for (const d of deliveries) {
      if (d.salesOrderId !== so.id) continue;
      if (!doneDeliveryStatuses.has(d.status)) continue;
      for (const dItem of d.items || []) {
        if (dItem.productId === productId) {
          deliveredQty += Number(dItem.quantity) || 0;
        }
      }
    }

    reserved += Math.max(0, orderedQty - deliveredQty);
  }

  return reserved;
}

async function main() {
  console.log("Connecting to MongoDB...");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const [products, movements, sales, deliveries, purchases] = await Promise.all([
    db.collection("products").find({}).toArray(),
    db.collection("stockMovements").find({}).toArray(),
    db.collection("sales").find({}).toArray(),
    db.collection("deliveries").find({}).toArray(),
    db.collection("purchases").find({}).toArray(),
  ]);

  console.log(`Found ${products.length} products, ${movements.length} movements, ${sales.length} sales, ${purchases.length} purchases.`);

  const now = new Date().toISOString();
  const gasList = [];
  const cylinderList = [];
  const productList = [];

  for (const p of products) {
    const pType = resolveProductType(p);
    const pMoves = movements.filter((m) => m.productId === p.id);

    const initMove = pMoves.find(
      (m) =>
        m.refType === "adjustment" &&
        (m.refId?.startsWith("INIT-") || /initial/i.test(m.notes || "")),
    );
    const openingStock =
      initMove?.quantity ??
      KNOWN_OPENING_STOCKS[p.id] ??
      (p.openingStock != null ? Number(p.openingStock) : 0);

    let stockIn = 0;
    let stockOut = 0;

    for (const m of pMoves) {
      if (m.id === initMove?.id) continue;
      const qty = Number(m.quantity) || 0;
      if (qty <= 0) continue;

      const isIn =
        m.type === "in" ||
        m.direction === "in" ||
        m.type === "return" ||
        m.movementType === "RECEIPT" ||
        m.movementType === "PURCHASE_RECEIVED" ||
        m.movementType === "ADJUSTMENT_IN" ||
        m.movementType === "RETURN" ||
        m.movementType === "SALES_RETURN";

      const isOut =
        m.type === "out" ||
        m.direction === "out" ||
        m.movementType === "SALE_ISSUE" ||
        m.movementType === "ADJUSTMENT_OUT" ||
        m.movementType === "DAMAGE" ||
        m.movementType === "LOSS" ||
        m.movementType === "PURCHASE_RETURN";

      if (isIn) stockIn += qty;
      else if (isOut) stockOut += qty;
    }

    const onHand = openingStock + stockIn - stockOut;
    const unitPrice = Number(p.price) || 0;
    const costPrice = Number(p.cost) || 0;
    const totalValue = onHand * (costPrice > 0 ? costPrice : unitPrice);

    await db.collection("products").updateOne(
      { id: p.id },
      { $set: { stock: onHand, productType: pType } },
    );

    if (pType === "gas") {
      const row = {
        id: `gas-${p.id}`,
        productId: p.id,
        productName: p.name,
        productType: "gas",
        uom: p.uom || "kg",
        openingStock,
        stockIn,
        stockOut,
        onHand,
        unitPrice,
        costPrice,
        totalValue,
        updatedAt: now,
      };
      gasList.push(row);
      await db.collection("gasInventory").updateOne(
        { productId: p.id },
        { $set: row },
        { upsert: true },
      );
    } else if (pType === "cylinder") {
      const reserved = computeReservedQty(p.id, sales, deliveries);
      const available = Math.max(0, onHand - reserved);
      const row = {
        id: `cyl-${p.id}`,
        productId: p.id,
        productName: p.name,
        productType: "cylinder",
        uom: p.uom || "cyl",
        openingStock,
        stockIn,
        stockOut,
        reserved,
        available,
        onHand,
        unitPrice,
        costPrice,
        totalValue,
        updatedAt: now,
      };
      cylinderList.push(row);
      await db.collection("cylinderInventory").updateOne(
        { productId: p.id },
        { $set: row },
        { upsert: true },
      );
    } else {
      const row = {
        id: `prod-${p.id}`,
        productId: p.id,
        productName: p.name,
        productType: "product",
        uom: p.uom || "pcs",
        openingStock,
        stockIn,
        stockOut,
        onHand,
        unitPrice,
        costPrice,
        totalValue,
        updatedAt: now,
      };
      productList.push(row);
      await db.collection("productInventory").updateOne(
        { productId: p.id },
        { $set: row },
        { upsert: true },
      );
    }
  }

  console.log("\n==================================================");
  console.log("GAS INVENTORY (Authoritative)");
  console.log("==================================================");
  console.table(gasList.map(g => ({
    name: g.productName,
    opening: g.openingStock,
    in: g.stockIn,
    out: g.stockOut,
    onHand: g.onHand,
    calcCheck: `${g.openingStock} + ${g.stockIn} - ${g.stockOut} = ${g.openingStock + g.stockIn - g.stockOut} (OnHand: ${g.onHand})`,
    cost: g.costPrice,
    value: g.totalValue
  })));

  console.log("\n==================================================");
  console.log("CYLINDER INVENTORY (Authoritative)");
  console.log("==================================================");
  console.table(cylinderList.map(c => ({
    name: c.productName,
    opening: c.openingStock,
    in: c.stockIn,
    out: c.stockOut,
    onHand: c.onHand,
    reserved: c.reserved,
    available: c.available,
    calcCheck: `${c.openingStock} + ${c.stockIn} - ${c.stockOut} = ${c.onHand} | Available: ${c.onHand} - ${c.reserved} = ${c.available}`,
    cost: c.costPrice,
    value: c.totalValue
  })));

  console.log("\n==================================================");
  console.log("PRODUCT INVENTORY (Authoritative)");
  console.log("==================================================");
  console.table(productList.map(p => ({
    name: p.productName,
    opening: p.openingStock,
    in: p.stockIn,
    out: p.stockOut,
    onHand: p.onHand,
    cost: p.costPrice,
    value: p.totalValue
  })));

  await client.close();
  console.log("\nDatabase reconciliation complete!");
}

main().catch(console.error);
