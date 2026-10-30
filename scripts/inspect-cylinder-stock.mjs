import { getDb } from '../src/lib/mongo.server.ts';
import { KNOWN_OPENING_STOCKS } from '../src/lib/inventory.server.ts';

async function inspect() {
  const db = await getDb();
  console.log('=== PRODUCTS MATCHING Medical Oxygen or 000201 ===');
  const prods = await db.collection('products').find({
    $or: [
      { code: /000201/i },
      { name: /O2-1.36/i },
      { name: /Medical Oxygen/i }
    ]
  }, { projection: { image: 0 } }).toArray();
  console.log(JSON.stringify(prods, null, 2));

  console.log('\n=== CYLINDER INVENTORY MATCHING ===');
  const prodIds = prods.map(p => p.id);
  const cylInvs = await db.collection('cylinderInventory').find({
    $or: [
      { productName: /O2-1.36/i },
      { productId: { $in: prodIds } }
    ]
  }).toArray();
  console.log(JSON.stringify(cylInvs, null, 2));

  console.log('\n=== STOCK MOVEMENTS FOR THESE PRODUCT IDS ===');
  const moves = await db.collection('stockMovements').find({
    productId: { $in: prodIds }
  }).sort({ date: 1, createdAt: 1 }).toArray();
  console.log(JSON.stringify(moves, null, 2));

  console.log('\n=== KNOWN OPENING STOCKS & PRODUCT STOCK FIELDS ===');
  for (const p of prods) {
    console.log({
      id: p.id,
      code: p.code,
      name: p.name,
      uom: p.uom,
      productType: p.productType,
      stockField: p.stock,
      openingStockField: p.openingStock,
      knownOpeningStock: KNOWN_OPENING_STOCKS[p.id],
    });
  }

  console.log('\n=== CYLINDERS COLLECTION MATCHING THESE PRODUCT IDS ===');
  const cylinders = await db.collection('cylinders').find({
    productId: { $in: prodIds }
  }).toArray();
  console.log(`Found ${cylinders.length} individual cylinders in cylinders collection`);
  const byStatus = {};
  for (const c of cylinders) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  }
  console.log('Cylinders by status:', byStatus);

  console.log('\n=== AUDIT LOGS FOR THESE PRODUCTS ===');
  const audits = await db.collection('auditLogs').find({
    entityId: { $in: prodIds }
  }).sort({ timestamp: -1 }).limit(10).toArray();
  console.log(JSON.stringify(audits, null, 2));
}

inspect().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
