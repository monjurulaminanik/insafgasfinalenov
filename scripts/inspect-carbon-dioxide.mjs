import { MongoClient } from "mongodb";

const uri = (process.env.MONGODB_URI || "");
const dbName = "InsafCorporation";

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log("=== 1. PRODUCT: Carbon Dioxide ===");
  const products = await db.collection("products").find({ name: /Carbon Dioxide/i }).toArray();
  console.log("Products found:", JSON.stringify(products, null, 2));

  const prodId = products[0]?.id;
  console.log("Product ID:", prodId);

  console.log("\n=== 2. CYLINDER INVENTORY COLLECTION ===");
  const cylInv = await db.collection("cylinderInventory").find({ 
    $or: [{ productId: prodId }, { cylinderName: /Carbon Dioxide/i }, { name: /Carbon Dioxide/i }] 
  }).toArray();
  console.log("Cylinder Inventory docs:", JSON.stringify(cylInv, null, 2));

  console.log("\n=== 3. SERIALIZED CYLINDERS (collection: cylinders) ===");
  const cylinders = await db.collection("cylinders").find({ 
    $or: [{ productId: prodId }, { cylinderType: /Carbon Dioxide/i }] 
  }).toArray();
  console.log(`Found ${cylinders.length} cylinders:`);
  console.log(cylinders.map(c => ({ id: c.id, serialNumber: c.serialNumber, status: c.status, assignedOrderId: c.assignedOrderId, currentCustomer: c.currentCustomer })));

  console.log("\n=== 4. PURCHASES FOR THIS PRODUCT ===");
  const purchases = await db.collection("purchases").find({
    "items.productId": prodId
  }).toArray();
  console.log(`Found ${purchases.length} purchases:`);
  console.log(purchases.map(p => ({
    id: p.id,
    purchaseNo: p.purchaseNo,
    status: p.status,
    date: p.date,
    items: p.items.filter(i => i.productId === prodId)
  })));

  console.log("\n=== 5. SALES ORDERS FOR THIS PRODUCT ===");
  const sales = await db.collection("salesOrders").find({
    "items.productId": prodId
  }).toArray();
  console.log(`Found ${sales.length} sales orders:`);
  console.log(sales.map(s => ({
    id: s.id,
    orderNo: s.orderNo,
    invoiceNo: s.invoiceNo,
    status: s.status,
    deliveryStatus: s.deliveryStatus,
    date: s.date,
    items: s.items.filter(i => i.productId === prodId)
  })));

  console.log("\n=== 6. DELIVERIES (CHALLANS) FOR THIS PRODUCT ===");
  const deliveries = await db.collection("deliveries").find({
    $or: [
      { "items.productId": prodId },
      { orderId: { $in: sales.map(s => s.id) } }
    ]
  }).toArray();
  console.log(`Found ${deliveries.length} deliveries:`);
  console.log(deliveries.map(d => ({
    id: d.id,
    challanNo: d.challanNo,
    orderId: d.orderId,
    status: d.status,
    date: d.date,
    cylinderIds: d.cylinderIds,
    items: d.items
  })));

  console.log("\n=== 7. STOCK MOVEMENTS FOR THIS PRODUCT ===");
  const movements = await db.collection("stockMovements").find({
    productId: prodId
  }).sort({ timestamp: 1 }).toArray();
  console.log(`Found ${movements.length} stock movements:`);
  console.log(movements.map(m => ({
    id: m.id,
    type: m.type,
    movementType: m.movementType,
    direction: m.direction,
    quantity: m.quantity,
    refType: m.refType,
    refId: m.refId,
    notes: m.notes,
    timestamp: m.timestamp
  })));

  console.log("\n=== 8. SUPPLIER RETURNS OR CUSTOMER RETURNS ===");
  const suppReturns = await db.collection("supplierReturns").find({ "items.productId": prodId }).toArray();
  console.log("Supplier returns:", suppReturns.map(r => ({ id: r.id, returnNo: r.returnNo, status: r.status, items: r.items })));

  const custReturns = await db.collection("customerReturns").find({ "items.productId": prodId }).toArray();
  console.log("Customer returns:", custReturns.map(r => ({ id: r.id, returnNo: r.returnNo, status: r.status, items: r.items })));

  await client.close();
}

run().catch(console.error);
