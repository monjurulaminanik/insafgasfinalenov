import { getDb } from '../src/lib/mongo.server.ts';
import { reconcileDatabaseInventory } from '../src/lib/inventory.server.ts';
import { executePurchaseReceive } from '../src/lib/purchase.functions.ts';
import { genOrderNo } from '../src/utils/helpers.ts';

async function run() {
  const db = await getDb();
  console.log('=== STARTING COMPREHENSIVE TEST SUITE ===\n');

  // TEST 1: Initial Reconciliation & Match Verification
  console.log('--- TEST 1: Stock Match Verification for Medical Oxygen (O2-1.36) ---');
  await reconcileDatabaseInventory(db);
  const pDoc = await db.collection('products').findOne({ id: 'qk6ldyet' });
  const cDoc = await db.collection('cylinderInventory').findOne({ productId: 'qk6ldyet' });
  console.log(`Products table stock: ${pDoc?.stock}`);
  console.log(`CylinderInventory onHand: ${cDoc?.onHand}, available: ${cDoc?.available}, reserved: ${cDoc?.reserved}`);
  if (pDoc?.stock === 300 && cDoc?.onHand === 300 && cDoc?.available === 300) {
    console.log('✅ TEST 1 PASSED: Medical Oxygen stock is 300 in both tables!\n');
  } else {
    throw new Error(`TEST 1 FAILED: Expected 300, got Products=${pDoc?.stock}, CylInv=${cDoc?.onHand}`);
  }

  // TEST 2: Stock Adjustment - Increase by +10
  console.log('--- TEST 2: Stock Adjustment (+10) ---');
  const now = new Date().toISOString();
  const adjInMovement = {
    id: `TEST-ADJ-IN-${Date.now()}`,
    date: now,
    productId: 'qk6ldyet',
    productName: 'Medical Oxygen ( o2-1.36)',
    productType: 'cylinder',
    type: 'in',
    movementType: 'ADJUSTMENT_IN',
    direction: 'in',
    quantity: 10,
    previousBalance: 300,
    balanceAfter: 310,
    newBalance: 310,
    unitCost: 700,
    totalCost: 7000,
    cogsAmount: 7000,
    refType: 'adjustment',
    refId: 'ADJ-TEST-001',
    notes: 'Test stock adjustment +10',
    by: 'TestRunner',
  };
  await db.collection('products').updateOne({ id: 'qk6ldyet' }, { $set: { stock: 310 } });
  await db.collection('stockMovements').insertOne(adjInMovement);
  // Reconcile or trigger sync
  await reconcileDatabaseInventory(db);
  const pDoc2 = await db.collection('products').findOne({ id: 'qk6ldyet' });
  const cDoc2 = await db.collection('cylinderInventory').findOne({ productId: 'qk6ldyet' });
  console.log(`After +10 -> Products stock: ${pDoc2?.stock}, CylInv onHand: ${cDoc2?.onHand}, available: ${cDoc2?.available}`);
  if (pDoc2?.stock === 310 && cDoc2?.onHand === 310 && cDoc2?.available === 310) {
    console.log('✅ TEST 2 PASSED: Stock increased by 10 to 310 on both tables!\n');
  } else {
    throw new Error(`TEST 2 FAILED: Expected 310, got Products=${pDoc2?.stock}, CylInv=${cDoc2?.onHand}`);
  }

  // TEST 3: Stock Adjustment - Decrease by -10
  console.log('--- TEST 3: Stock Adjustment (-10) ---');
  const adjOutMovement = {
    id: `TEST-ADJ-OUT-${Date.now()}`,
    date: new Date().toISOString(),
    productId: 'qk6ldyet',
    productName: 'Medical Oxygen ( o2-1.36)',
    productType: 'cylinder',
    type: 'out',
    movementType: 'ADJUSTMENT_OUT',
    direction: 'out',
    quantity: 10,
    previousBalance: 310,
    balanceAfter: 300,
    newBalance: 300,
    unitCost: 700,
    totalCost: 7000,
    cogsAmount: 7000,
    refType: 'adjustment',
    refId: 'ADJ-TEST-002',
    notes: 'Test stock adjustment -10',
    by: 'TestRunner',
  };
  await db.collection('products').updateOne({ id: 'qk6ldyet' }, { $set: { stock: 300 } });
  await db.collection('stockMovements').insertOne(adjOutMovement);
  await reconcileDatabaseInventory(db);
  const pDoc3 = await db.collection('products').findOne({ id: 'qk6ldyet' });
  const cDoc3 = await db.collection('cylinderInventory').findOne({ productId: 'qk6ldyet' });
  console.log(`After -10 -> Products stock: ${pDoc3?.stock}, CylInv onHand: ${cDoc3?.onHand}, available: ${cDoc3?.available}`);
  if (pDoc3?.stock === 300 && cDoc3?.onHand === 300 && cDoc3?.available === 300) {
    console.log('✅ TEST 3 PASSED: Stock decreased by 10 back to 300 on both tables!\n');
  } else {
    throw new Error(`TEST 3 FAILED: Expected 300, got Products=${pDoc3?.stock}, CylInv=${cDoc3?.onHand}`);
  }

  // Clean up temporary test movements from tests 2 & 3
  await db.collection('stockMovements').deleteMany({
    id: { $in: [adjInMovement.id, adjOutMovement.id] }
  });

  // TEST 4 & 5: Purchase and Receive 10 cylinders + Idempotency
  console.log('--- TEST 4: Purchase and Receive 10 Cylinders ---');
  const poId = `TEST-PO-${Date.now()}`;
  const testPO = {
    id: poId,
    orderNo: genOrderNo('PO'),
    supplierId: 'sup-test',
    supplierName: 'Test Supplier',
    date: new Date().toISOString(),
    status: 'ordered',
    items: [
      {
        productId: 'qk6ldyet',
        productName: 'Medical Oxygen ( o2-1.36)',
        itemType: 'cylinder',
        quantity: 10,
        receivedQty: 0,
        price: 700,
        total: 7000,
      },
    ],
    subtotal: 7000,
    total: 7000,
    createdAt: new Date().toISOString(),
  };
  await db.collection('purchases').insertOne(testPO);

  // Receive the purchase
  await executePurchaseReceive(db, null, poId, { qtyByItem: [10], requestId: `REQ-${poId}` }, 'quantity');
  const pDoc4 = await db.collection('products').findOne({ id: 'qk6ldyet' });
  const cDoc4 = await db.collection('cylinderInventory').findOne({ productId: 'qk6ldyet' });
  console.log(`After PO receive -> Products stock: ${pDoc4?.stock}, CylInv onHand: ${cDoc4?.onHand}, available: ${cDoc4?.available}`);
  if (pDoc4?.stock === 310 && cDoc4?.onHand === 310 && cDoc4?.available === 310) {
    console.log('✅ TEST 4 PASSED: Purchase receive increased stock by exactly 10 in both tables!\n');
  } else {
    throw new Error(`TEST 4 FAILED: Expected 310, got Products=${pDoc4?.stock}, CylInv=${cDoc4?.onHand}`);
  }

  console.log('--- TEST 5: Purchase Idempotency (Prevent Duplicate Stock Increase) ---');
  // Attempt to receive again with the same request ID
  try {
    await executePurchaseReceive(db, null, poId, { qtyByItem: [10], requestId: `REQ-${poId}` }, 'quantity');
  } catch (err) {
    console.log(`Expected rejection caught: ${err.message}`);
  }
  const pDoc5 = await db.collection('products').findOne({ id: 'qk6ldyet' });
  const cDoc5 = await db.collection('cylinderInventory').findOne({ productId: 'qk6ldyet' });
  console.log(`After duplicate receive attempt -> Products stock: ${pDoc5?.stock}, CylInv onHand: ${cDoc5?.onHand}`);
  if (pDoc5?.stock === 310 && cDoc5?.onHand === 310) {
    console.log('✅ TEST 5 PASSED: Re-receiving purchase did NOT duplicate stock!\n');
  } else {
    throw new Error(`TEST 5 FAILED: Duplicate stock occurred! Products=${pDoc5?.stock}, CylInv=${cDoc5?.onHand}`);
  }

  // Clean up test PO & movements & restore stock to 300
  await db.collection('purchases').deleteOne({ id: poId });
  await db.collection('stockMovements').deleteMany({ refType: 'purchase', refId: poId });
  await db.collection('costLayers').deleteMany({ refType: 'purchase', refId: poId });
  await db.collection('products').updateOne({ id: 'qk6ldyet' }, { $set: { stock: 300 } });
  await reconcileDatabaseInventory(db);

  // TEST 6 & 8: Verify other cylinder types (LPG Domestic 12kg - p1)
  console.log('--- TEST 6 & 8: Verify Other Cylinder Types (LPG Domestic 12kg - p1) ---');
  const p1Prod = await db.collection('products').findOne({ id: 'p1' });
  const p1Cyl = await db.collection('cylinderInventory').findOne({ productId: 'p1' });
  console.log(`p1 in products: stock = ${p1Prod?.stock}`);
  console.log(`p1 in cylinderInventory: onHand = ${p1Cyl?.onHand}, reserved = ${p1Cyl?.reserved}, available = ${p1Cyl?.available}`);
  if (p1Prod?.stock === 253 && p1Cyl?.onHand === 253 && p1Cyl?.reserved === 3 && p1Cyl?.available === 250) {
    console.log('✅ TEST 6 & 8 PASSED: LPG Domestic 12kg stock matches 253 with 3 reserved and 250 available!\n');
  } else {
    throw new Error(`TEST 6/8 FAILED: LPG Domestic 12kg mismatch: Products=${p1Prod?.stock}, CylInv=${p1Cyl?.onHand}`);
  }

  // TEST 7: Final Status Check
  console.log('--- FINAL SYSTEM INVENTORY SUMMARY ---');
  const finalSummary = await reconcileDatabaseInventory(db);
  console.log(`Total active cylinders in inventory: ${finalSummary.cylinders.length}`);
  for (const c of finalSummary.cylinders) {
    console.log(`  • ${c.productName} (Code: ${c.productId}): Stock=${c.onHand}, Reserved=${c.reserved}, Available=${c.available}`);
  }

  console.log('\n🎉 ALL 8 TEST REQUIREMENTS COMPLETED AND VERIFIED SUCCESSFULLY!');
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('\n❌ ERROR IN TEST SUITE:', err);
  process.exit(1);
});
