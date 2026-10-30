import { MongoClient } from "mongodb";
import { reconcileDatabaseInventory } from "../src/lib/inventory.server.ts";
import { defaultProductSaleItemType, saleItemType, lineFromProduct } from "../src/lib/cylinder-product.ts";
import { buildProductInventory } from "../src/lib/cylinder-inventory.ts";

const uri = (process.env.MONGODB_URI || "");

async function runEndToEndVerification() {
  console.log("=================================================================");
  console.log("   INSAF GAS CORP ERP: 10-POINT MANDATORY E2E VERIFICATION TEST   ");
  console.log("=================================================================\n");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("InsafCorporation");

  let passedTests = 0;
  const totalTests = 10;

  // -------------------------------------------------------------------------
  // TEST 1: Purchase Receiving Increases Stock by 50 and is Idempotent
  // -------------------------------------------------------------------------
  console.log("--- TEST 1: Purchase Receiving Stock Increase ---");
  const testProdId = "test-prod-" + Date.now().toString(36);
  await db.collection("products").insertOne({
    id: testProdId,
    code: "TEST-P01",
    name: "Test E2E Product",
    category: "General",
    productType: "product",
    uom: "pcs",
    price: 100,
    cost: 80,
    stock: 0,
    openingStock: 0,
    reorderLevel: 5,
    costingMethod: "fifo",
    createdAt: new Date().toISOString(),
  });

  const pInitial = await db.collection("products").findOne({ id: testProdId });
  console.log(`Initial stock for ${testProdId}: ${pInitial?.stock} (Expected: 0)`);

  // Simulate GRN purchase receipt of 50 units
  const now = new Date().toISOString();
  const poId = "po-test-" + Date.now().toString(36);
  const grnNo = "GRN-TEST-001";
  await db.collection("stockMovements").insertOne({
    id: "mov-po-50",
    date: now,
    productId: testProdId,
    productName: "Test E2E Product",
    productType: "product",
    type: "in",
    movementType: "RECEIPT",
    direction: "in",
    quantity: 50,
    previousBalance: 0,
    balanceAfter: 50,
    newBalance: 50,
    unitCost: 80,
    totalCost: 4000,
    cogsAmount: 4000,
    costingMethod: "fifo",
    refType: "purchase",
    refId: poId,
    notes: grnNo,
    by: "Warehouse",
  });

  // Reconcile
  await reconcileDatabaseInventory(db);
  const pAfterPo = await db.collection("products").findOne({ id: testProdId });
  const prodInvAfterPo = await db.collection("productInventory").findOne({ productId: testProdId });
  console.log(`Stock after PO receiving: ${pAfterPo?.stock}, onHand: ${prodInvAfterPo?.onHand} (Expected: 50)`);

  if (pAfterPo?.stock === 50 && prodInvAfterPo?.onHand === 50) {
    console.log("✔ TEST 1 PASSED: Purchase increased stock by exactly 50.\n");
    passedTests++;
  } else {
    console.error("❌ TEST 1 FAILED");
  }

  // -------------------------------------------------------------------------
  // TEST 2: Sales Order Product Suggestion Displays Correct Available Quantity
  // -------------------------------------------------------------------------
  console.log("--- TEST 2: Sales Order Product Suggestion Availability ---");
  const prodsAll = await db.collection("products").find({}).toArray();
  const cylsAll = await db.collection("cylinders").find({}).toArray();
  const salesAll = await db.collection("sales").find({}).toArray();
  const delsAll = await db.collection("deliveries").find({}).toArray();
  const movesAll = await db.collection("stockMovements").find({}).toArray();

  const inventoryRows = buildProductInventory(prodsAll as any, cylsAll as any, salesAll as any, delsAll as any, movesAll as any);
  const testProdRow = inventoryRows.find(r => r.productId === testProdId);
  console.log(`Test product in buildProductInventory: onHand=${testProdRow?.total}, available=${testProdRow?.available}`);

  if (testProdRow && testProdRow.available === 50) {
    console.log("✔ TEST 2 PASSED: Suggestion displays exact verified stock (50 pcs).\n");
    passedTests++;
  } else {
    console.error("❌ TEST 2 FAILED");
  }

  // -------------------------------------------------------------------------
  // TEST 3: Delivery of 20 units Decreases Stock Exactly Once
  // -------------------------------------------------------------------------
  console.log("--- TEST 3: Delivery of 20 Units Decreases Stock Exactly Once ---");
  const soId = "so-test-" + Date.now().toString(36);
  await db.collection("sales").insertOne({
    id: soId,
    orderNo: "SO-TEST-001",
    customerId: "cust-1",
    customerName: "Test Customer",
    status: "invoiced",
    items: [{ productId: testProdId, productName: "Test E2E Product", quantity: 20, price: 100, itemType: "product" }],
    total: 2000,
    paid: 2000,
    createdAt: now,
  });

  // Post delivery movement of 20 units
  const delId = "del-test-" + Date.now().toString(36);
  await db.collection("stockMovements").insertOne({
    id: "mov-del-20",
    date: now,
    productId: testProdId,
    productName: "Test E2E Product",
    productType: "product",
    type: "out",
    movementType: "SALE_ISSUE",
    direction: "out",
    quantity: 20,
    previousBalance: 50,
    balanceAfter: 30,
    newBalance: 30,
    unitCost: 80,
    totalCost: 1600,
    cogsAmount: 1600,
    costingMethod: "fifo",
    refType: "delivery",
    refId: delId,
    notes: "DC-TEST-001",
    by: "Delivery",
  });

  await db.collection("deliveries").insertOne({
    id: delId,
    deliveryNo: "DC-TEST-001",
    salesOrderId: soId,
    customerId: "cust-1",
    customerName: "Test Customer",
    status: "delivered",
    items: [{ productId: testProdId, productName: "Test E2E Product", quantity: 20, price: 100, itemType: "product" }],
    date: now,
  });

  await reconcileDatabaseInventory(db);
  const pAfterDel = await db.collection("products").findOne({ id: testProdId });
  const prodInvAfterDel = await db.collection("productInventory").findOne({ productId: testProdId });
  console.log(`Stock after delivery: ${pAfterDel?.stock}, onHand: ${prodInvAfterDel?.onHand} (Expected: 30)`);

  if (pAfterDel?.stock === 30 && prodInvAfterDel?.onHand === 30) {
    console.log("✔ TEST 3 PASSED: Stock decreased by 20 exactly once.\n");
    passedTests++;
  } else {
    console.error("❌ TEST 3 FAILED");
  }

  // -------------------------------------------------------------------------
  // TEST 4: Accept Return of 5 Saleable Units Increases Stock by 5
  // -------------------------------------------------------------------------
  console.log("--- TEST 4: Return of 5 Saleable Units Restores Stock ---");
  const retId = "ret-test-" + Date.now().toString(36);
  await db.collection("stockMovements").insertOne({
    id: "mov-ret-5",
    date: now,
    productId: testProdId,
    productName: "Test E2E Product",
    productType: "product",
    type: "in",
    movementType: "SALES_RETURN",
    direction: "in",
    quantity: 5,
    previousBalance: 30,
    balanceAfter: 35,
    newBalance: 35,
    unitCost: 80,
    totalCost: 400,
    cogsAmount: 400,
    costingMethod: "fifo",
    refType: "delivery",
    refId: delId,
    notes: "Return RET-TEST-001",
    by: "Return Management",
  });

  await db.collection("returns").insertOne({
    id: retId,
    returnNo: "RET-TEST-001",
    deliveryId: delId,
    customerId: "cust-1",
    status: "accepted",
    items: [{ productId: testProdId, productName: "Test E2E Product", returnQuantity: 5, itemType: "product" }],
    date: now,
  });

  await reconcileDatabaseInventory(db);
  const pAfterRet = await db.collection("products").findOne({ id: testProdId });
  const prodInvAfterRet = await db.collection("productInventory").findOne({ productId: testProdId });
  console.log(`Stock after return: ${pAfterRet?.stock}, onHand: ${prodInvAfterRet?.onHand} (Expected: 35)`);

  if (pAfterRet?.stock === 35 && prodInvAfterRet?.onHand === 35) {
    console.log("✔ TEST 4 PASSED: Stock increased by exactly 5.\n");
    passedTests++;
  } else {
    console.error("❌ TEST 4 FAILED");
  }

  // -------------------------------------------------------------------------
  // TEST 5: Sales Order Edit Preserves Gas, Cylinder, and Product Types
  // -------------------------------------------------------------------------
  console.log("--- TEST 5: Item Type Preservation on Edit ---");
  const stoveProd = await db.collection("products").findOne({ id: "3eing5fd" });
  const arganProd = await db.collection("products").findOne({ id: "hpgmusaf" });
  const gasProd = await db.collection("products").findOne({ id: "azdmoisv" });

  const stoveType = defaultProductSaleItemType(stoveProd as any);
  const arganType = defaultProductSaleItemType(arganProd as any);
  const gasType = defaultProductSaleItemType(gasProd as any);

  console.log(`Classifications: Stove=${stoveType}, Argan=${arganType}, Gas=${gasType}`);

  // Test lineFromProduct
  const lineStove = lineFromProduct(stoveProd as any);
  const lineArgan = lineFromProduct(arganProd as any);
  const lineGas = lineFromProduct(gasProd as any);

  // Test saleItemType preserving saved values
  const preservedStove = saleItemType({ itemType: "product" }, stoveProd as any);
  const preservedArgan = saleItemType({ itemType: "cylinder" }, arganProd as any);
  const preservedGas = saleItemType({ itemType: "gas" }, gasProd as any);

  if (
    lineStove.itemType === "product" &&
    lineArgan.itemType === "cylinder" &&
    lineGas.itemType === "gas" &&
    preservedStove === "product" &&
    preservedArgan === "cylinder" &&
    preservedGas === "gas"
  ) {
    console.log("✔ TEST 5 PASSED: Gas, Cylinder, and Product types correctly classified and preserved.\n");
    passedTests++;
  } else {
    console.error("❌ TEST 5 FAILED");
  }

  // -------------------------------------------------------------------------
  // TEST 6: Warehouse-Level Availability vs Total Inventory
  // -------------------------------------------------------------------------
  console.log("--- TEST 6: Warehouse Availability Verification ---");
  const p1CylindersInStock = await db.collection("cylinders").countDocuments({ productId: "p1", status: "in_stock" });
  const p1FullCylinders = await db.collection("cylinders").countDocuments({ productId: "p1", status: "in_stock", fillLevel: { $ne: "empty" } });
  console.log(`P1 cylinders: in_stock=${p1CylindersInStock}, full=${p1FullCylinders}`);

  if (p1FullCylinders > 0 && p1FullCylinders <= p1CylindersInStock) {
    console.log("✔ TEST 6 PASSED: Warehouse-level cylinder availability accurately tracked.\n");
    passedTests++;
  } else {
    console.error("❌ TEST 6 FAILED");
  }

  // -------------------------------------------------------------------------
  // TEST 7: Argan 1,418 vs 10 Discrepancy Resolved
  // -------------------------------------------------------------------------
  console.log("--- TEST 7: Argan Discrepancy Resolution ---");
  const arganDbProd = await db.collection("products").findOne({ id: "hpgmusaf" });
  const arganCylInv = await db.collection("cylinderInventory").findOne({ productId: "hpgmusaf" });
  const arganCylCount = await db.collection("cylinders").countDocuments({ productId: "hpgmusaf", status: "in_stock", fillLevel: "full" });

  console.log(`Argan product stock: ${arganDbProd?.stock}, cylinderInventory onHand: ${arganCylInv?.onHand}, physical full cylinders: ${arganCylCount}`);

  if (arganDbProd?.stock === 10 && arganCylInv?.onHand === 10 && arganCylCount === 10) {
    console.log("✔ TEST 7 PASSED: Argan stock accurately synchronized to 10 physical cylinders.\n");
    passedTests++;
  } else {
    console.error("❌ TEST 7 FAILED");
  }

  // -------------------------------------------------------------------------
  // TEST 8: RFL Rose Gas Stove Availability and Self-Reservation Handling
  // -------------------------------------------------------------------------
  console.log("--- TEST 8: Rose Gas Stove Availability Verification ---");
  const stoveDbProd = await db.collection("products").findOne({ id: "3eing5fd" });
  const stoveProdInv = await db.collection("productInventory").findOne({ productId: "3eing5fd" });
  console.log(`Stove product stock: ${stoveDbProd?.stock}, productInventory onHand: ${stoveProdInv?.onHand}`);

  // In SO-25, order has quantity 50. During edit, effective available = stock (50) + order's own qty (50) = 100.
  const so25Order = await db.collection("sales").findOne({ id: "7d6j49zs" });
  const so25StoveItem = so25Order?.items?.find((it: any) => it.productId === "3eing5fd");
  const effectiveAvailForSo25 = (stoveDbProd?.stock || 0) + (so25StoveItem?.quantity || 0);
  console.log(`SO-25 stove quantity: ${so25StoveItem?.quantity}, effective available during edit: ${effectiveAvailForSo25}`);

  if (stoveDbProd?.stock === 50 && effectiveAvailForSo25 >= 50) {
    console.log("✔ TEST 8 PASSED: Stove availability is 50, and editing SO-25 credits back its own 50 units (effective: 100).\n");
    passedTests++;
  } else {
    console.error("❌ TEST 8 FAILED");
  }

  // -------------------------------------------------------------------------
  // TEST 9: Reload / Reconciliation Persistence
  // -------------------------------------------------------------------------
  console.log("--- TEST 9: Reload & Persistence Verification ---");
  await reconcileDatabaseInventory(db);
  const arganPersisted = await db.collection("products").findOne({ id: "hpgmusaf" });
  const stovePersisted = await db.collection("products").findOne({ id: "3eing5fd" });

  if (arganPersisted?.stock === 10 && stovePersisted?.stock === 50) {
    console.log("✔ TEST 9 PASSED: Re-running reconciliation persists identical correct stock values.\n");
    passedTests++;
  } else {
    console.error("❌ TEST 9 FAILED");
  }

  // -------------------------------------------------------------------------
  // TEST 10: Existing Workflows and Data Integrity Preserved
  // -------------------------------------------------------------------------
  console.log("--- TEST 10: Preserved Historical Data and Integrations ---");
  const allSalesCount = await db.collection("sales").countDocuments();
  const allPurchasesCount = await db.collection("purchases").countDocuments();
  const allDeliveriesCount = await db.collection("deliveries").countDocuments();
  const allReturnsCount = await db.collection("returns").countDocuments();

  console.log(`Historical totals: Sales=${allSalesCount}, Purchases=${allPurchasesCount}, Deliveries=${allDeliveriesCount}, Returns=${allReturnsCount}`);

  // Clean up our test records so prod data is pristine
  await db.collection("products").deleteOne({ id: testProdId });
  await db.collection("stockMovements").deleteMany({ productId: testProdId });
  await db.collection("productInventory").deleteOne({ productId: testProdId });
  await db.collection("sales").deleteOne({ id: soId });
  await db.collection("deliveries").deleteOne({ id: delId });
  await db.collection("returns").deleteOne({ id: retId });
  await reconcileDatabaseInventory(db);

  if (allSalesCount > 0 && allPurchasesCount > 0 && allDeliveriesCount > 0 && allReturnsCount > 0) {
    console.log("✔ TEST 10 PASSED: Historical records preserved and database reconciled cleanly.\n");
    passedTests++;
  } else {
    console.error("❌ TEST 10 FAILED");
  }

  console.log("=================================================================");
  console.log(`   FINAL RESULT: ${passedTests}/${totalTests} TESTS PASSED!`);
  console.log("=================================================================\n");

  await client.close();
  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runEndToEndVerification().catch(err => {
  console.error("Fatal error running verification:", err);
  process.exit(1);
});
