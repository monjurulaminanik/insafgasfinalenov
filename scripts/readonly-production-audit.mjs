import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || (process.env.MONGODB_URI || "");
const dbName = "InsafCorporation";

async function audit() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log(`Connected to database: ${dbName}`);

  const products = await db.collection('products').find({}).toArray();
  console.log(`Total products: ${products.length}`);

  const sales = await db.collection('sales').find({}).toArray();
  const purchases = await db.collection('purchases').find({}).toArray();
  const stockMovements = await db.collection('stockMovements').find({}).toArray();
  const movements = await db.collection('movements').find({}).toArray();
  const cylinders = await db.collection('cylinders').find({}).toArray();
  const gasInventory = await db.collection('gasInventory').find({}).toArray();
  const cylinderInventory = await db.collection('cylinderInventory').find({}).toArray();
  const productInventory = await db.collection('productInventory').find({}).toArray();

  console.log('=== MITAR DEEP DIVE ===');
  const mitar = products.find(p => p.name === 'mitar' || p.id === 'mitar' || p.name?.toLowerCase().includes('mitar'));
  console.log('Product doc:', JSON.stringify(mitar, null, 2));

  if (mitar) {
    const mitarPurchases = purchases.filter(po => po.items?.some(it => it.productId === mitar.id || it.productName === mitar.name));
    console.log('Purchases for mitar:', JSON.stringify(mitarPurchases, null, 2));

    const mitarSales = sales.filter(so => so.items?.some(it => it.productId === mitar.id || it.productName === mitar.name));
    console.log('Sales for mitar:', JSON.stringify(mitarSales, null, 2));

    const mitarStockMovements = stockMovements.filter(m => m.productId === mitar.id || m.productName === mitar.name);
    console.log('StockMovements for mitar:', JSON.stringify(mitarStockMovements, null, 2));

    const mitarCylinders = cylinders.filter(c => c.productId === mitar.id);
    console.log(`Cylinders registered with productId ${mitar.id}: ${mitarCylinders.length}`);
  }

  console.log('\n=== ALL PRODUCTS AUDIT ===');
  for (const p of products) {
    console.log(`\n-----------------------------------------`);
    console.log(`Product: "${p.name}" (ID: ${p.id}, Code: ${p.code}, Category: ${p.category}, Type: ${p.productType}, UOM: ${p.uom})`);
    
    // Purchases
    const itemPurchases = purchases.filter(po => po.items?.some(it => it.productId === p.id || it.productName === p.name));
    let totalReceived = 0;
    let totalPOQty = 0;
    for (const po of itemPurchases) {
      if (po.status === 'cancelled') continue;
      for (const it of (po.items || [])) {
        if (it.productId === p.id || it.productName === p.name) {
          totalPOQty += Number(it.quantity) || 0;
          if (po.receivingStatus === 'Received' || po.status === 'received' || po.status === 'paid') {
            totalReceived += (Number(it.receivedQty) || Number(it.quantity) || 0);
          } else if (it.receivedQty) {
            totalReceived += Number(it.receivedQty);
          }
        }
      }
    }

    // Sales
    const itemSales = sales.filter(so => so.items?.some(it => it.productId === p.id || it.productName === p.name));
    let totalSold = 0;
    let totalReserved = 0;
    for (const so of itemSales) {
      if (so.status === 'cancelled') continue;
      for (const it of (so.items || [])) {
        if (it.productId === p.id || it.productName === p.name) {
          const qty = Number(it.quantity) || 0;
          if (so.status === 'confirmed' || so.status === 'invoiced' || so.status === 'paid') {
            totalSold += qty;
          } else if (so.status === 'draft') {
            totalReserved += qty;
          }
        }
      }
    }

    // Stock Movements
    const pMovements = stockMovements.filter(m => m.productId === p.id || m.productName === p.name);
    let movementIn = 0;
    let movementOut = 0;
    for (const m of pMovements) {
      const q = Number(m.quantity) || 0;
      if (m.type === 'in' || m.movementType === 'RECEIPT' || m.movementType === 'PURCHASE_RECEIVED' || m.direction === 'in') {
        movementIn += q;
      } else if (m.type === 'out' || m.movementType === 'SALE_ISSUE' || m.movementType === 'SALE_COMPLETED' || m.direction === 'out') {
        movementOut += q;
      }
    }

    console.log(`PO Qty: ${totalPOQty}, PO Received: ${totalReceived}`);
    console.log(`Sales Sold: ${totalSold}, Reserved: ${totalReserved}`);
    console.log(`Movements In: ${movementIn}, Movements Out: ${movementOut} (Count: ${pMovements.length})`);
    
    const gasDoc = gasInventory.find(g => g.productId === p.id);
    const cylDoc = cylinderInventory.find(c => c.productId === p.id);
    const prodDoc = productInventory.find(pr => pr.productId === p.id);

    if (gasDoc) console.log('gasInventory doc:', JSON.stringify(gasDoc));
    if (cylDoc) console.log('cylinderInventory doc:', JSON.stringify(cylDoc));
    if (prodDoc) console.log('productInventory doc:', JSON.stringify(prodDoc));
  }

  await client.close();
}

audit().catch(console.error);
