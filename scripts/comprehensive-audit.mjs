import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");

async function runComprehensiveAudit() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  const products = await db.collection("products").find({}).toArray();
  const stockMovements = await db.collection("stockMovements").find({}).toArray();
  const sales = await db.collection("sales").find({}).toArray();
  const purchases = await db.collection("purchases").find({}).toArray();
  const gasInventory = await db.collection("gasInventory").find({}).toArray();
  const cylinderInventory = await db.collection("cylinderInventory").find({}).toArray();
  const productInventory = await db.collection("productInventory").find({}).toArray();

  console.log("================================================================================");
  console.log("READ-ONLY COMPREHENSIVE PRODUCTION INVENTORY AUDIT");
  console.log("================================================================================\n");

  const results = [];

  for (const p of products) {
    const pMovements = stockMovements.filter(m => m.productId === p.id || m.productName === p.name);
    
    // 1. Opening Stock from INIT movement or product definition
    const initMovement = pMovements.find(m => m.id?.startsWith("INIT-") || m.notes?.toLowerCase().includes("initial opening"));
    const openingStock = initMovement ? Number(initMovement.quantity) || 0 : (p.openingStock || 0);

    // 2. Valid Purchase Receiving
    let purchaseReceivedQty = 0;
    const itemPurchases = purchases.filter(po => po.status !== 'cancelled' && po.items?.some(it => it.productId === p.id || it.productName === p.name));
    for (const po of itemPurchases) {
      for (const it of (po.items || [])) {
        if (it.productId === p.id || it.productName === p.name) {
          if (po.receivingStatus === 'Received' || po.status === 'received' || po.status === 'paid') {
            purchaseReceivedQty += (Number(it.receivedQty) || Number(it.quantity) || 0);
          } else if (it.receivedQty) {
            purchaseReceivedQty += Number(it.receivedQty);
          }
        }
      }
    }

    // 3. Valid Sales Out
    let completedSalesQty = 0;
    let reservedSalesQty = 0;
    const itemSales = sales.filter(so => so.status !== 'cancelled' && so.items?.some(it => it.productId === p.id || it.productName === p.name));
    for (const so of itemSales) {
      for (const it of (so.items || [])) {
        if (it.productId === p.id || it.productName === p.name) {
          const qty = Number(it.quantity) || 0;
          if (so.status === 'confirmed' || so.status === 'invoiced' || so.status === 'paid') {
            completedSalesQty += qty;
          } else if (so.status === 'draft') {
            reservedSalesQty += qty;
          }
        }
      }
    }

    // 4. Ledger Movements Analysis
    let grossMovementIn = 0;
    let grossMovementOut = 0;
    let reversalIn = 0;
    let validReturns = 0;
    let validAdjustments = 0;

    for (const m of pMovements) {
      if (m.id?.startsWith("INIT-")) continue;
      const q = Number(m.quantity) || 0;
      
      if (m.notes?.toLowerCase().includes("reverse")) {
        reversalIn += q;
      } else if (m.movementType === "RECEIPT" || m.movementType === "PURCHASE_RECEIVED" || (m.type === "in" && m.refType === "purchase")) {
        grossMovementIn += q;
      } else if (m.movementType === "SALES_RETURN" || (m.type === "return" && m.refType === "sales")) {
        validReturns += q;
      } else if (m.movementType === "ADJUSTMENT_IN") {
        validAdjustments += q;
      } else if (m.movementType === "ADJUSTMENT_OUT") {
        validAdjustments -= q;
      } else if (m.movementType === "SALE_COMPLETED" || m.movementType === "SALE_ISSUE" || (m.type === "out" && m.refType === "sales")) {
        grossMovementOut += q;
      } else if (m.type === "in" || m.direction === "in") {
        grossMovementIn += q;
      } else if (m.type === "out" || m.direction === "out") {
        grossMovementOut += q;
      }
    }

    // Net Stock In & Net Stock Out
    // Note: If an out movement of 2498 was reversed by an in movement of 2498, net stockOut is grossOut - reversalIn
    const netStockIn = grossMovementIn + validReturns;
    const netStockOut = grossMovementOut - reversalIn;
    const expectedOnHand = openingStock + netStockIn - netStockOut + validAdjustments;

    // Determine target inventory collection
    const type = (p.productType || (p.category === 'LPG' || p.category === 'Industrial' || p.category === 'Medical' ? 'cylinder' : 'product')).toLowerCase();
    
    let storedDoc = null;
    let collectionName = "";
    if (type === "gas") {
      storedDoc = gasInventory.find(g => g.productId === p.id);
      collectionName = "gasInventory";
    } else if (type === "cylinder") {
      storedDoc = cylinderInventory.find(c => c.productId === p.id);
      collectionName = "cylinderInventory";
    } else {
      storedDoc = productInventory.find(pr => pr.productId === p.id);
      collectionName = "productInventory";
    }

    const storedOnHand = storedDoc ? storedDoc.onHand : null;
    const storedStockIn = storedDoc ? storedDoc.stockIn : null;
    const storedStockOut = storedDoc ? storedDoc.stockOut : null;
    const storedReserved = storedDoc ? (storedDoc.reserved || 0) : 0;
    const storedAvailable = storedDoc ? (storedDoc.available ?? storedOnHand) : storedOnHand;

    const expectedAvailable = type === "cylinder" ? (expectedOnHand - reservedSalesQty) : expectedOnHand;

    const isOnHandConsistent = expectedOnHand === storedOnHand;
    const isAvailableConsistent = type === "cylinder" ? (storedAvailable === storedOnHand - storedReserved) : true;

    results.push({
      productId: p.id,
      productName: p.name,
      productType: type,
      collection: collectionName,
      openingStock,
      purchaseReceivedQty,
      completedSalesQty,
      reservedSalesQty,
      grossMovementIn,
      grossMovementOut,
      reversalIn,
      netStockIn,
      netStockOut,
      expectedOnHand,
      storedOnHand,
      storedStockIn,
      storedStockOut,
      storedReserved,
      storedAvailable,
      expectedAvailable,
      isOnHandConsistent,
      isAvailableConsistent
    });
  }

  console.table(results.map(r => ({
    Product: r.productName,
    Type: r.productType,
    Opening: r.openingStock,
    NetIn: r.netStockIn,
    NetOut: r.netStockOut,
    ExpOnHand: r.expectedOnHand,
    StoredOnHand: r.storedOnHand,
    StoredReserved: r.storedReserved,
    StoredAvail: r.storedAvailable,
    ExpAvail: r.expectedAvailable,
    Consistent: r.isOnHandConsistent && r.isAvailableConsistent ? 'YES' : 'NO'
  })));

  await client.close();
}

runComprehensiveAudit().catch(console.error);
