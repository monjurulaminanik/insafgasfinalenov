import {
  seedProducts,
  seedSales,
  seedCostLayers,
  seedStockMovements,
  seedCustomers,
  seedPurchases,
  seedVouchers,
  seedExpenses,
  seedLedger,
  seedEmployees,
  seedPayroll,
  seedAccounts,
  seedCylinders,
  seedSuppliers,
  seedAssets,
} from "../src/lib/seed-data.ts";
import {
  computeCustomerReceivables,
  computeSupplierPayables,
  computeOutputVatLiability,
  computeProfitAndLoss,
  computeBalanceSheet,
  computeCashFlow,
  reconcileFinancialIntegrity,
  allocatePaymentAcrossInvoices,
} from "../src/lib/accounting-engine.ts";
import {
  consumeCostLayers,
  computeLayerValuation,
  computeWeightedAverageOnReceipt,
  reconcileQuantityWithSerials,
} from "../src/lib/inventory-engine.ts";
import { hashPassword, verifyPassword, isHashedPassword } from "../src/lib/password.server.ts";
import { hasPermission, assertPermission, ForbiddenError } from "../src/lib/rbac.ts";
import { permissionForCrud } from "../src/lib/crud-access.ts";
import { validateSessionSecret } from "../src/lib/session.server.ts";
import { getNextSequence, resetSequenceCounter } from "../src/lib/document-sequence.ts";
import { logAudit, getAuditLogs, clearInMemoryAuditLogs } from "../src/lib/audit.ts";

async function runAudit() {
  console.log("==================================================");
  console.log("STARTING FINAL INDEPENDENT AUDIT OF INSAF FUEL KEEPER");
  console.log("==================================================\n");

  // -------------------------------------------------------------
  // 1. INVENTORY RECONCILIATION
  // -------------------------------------------------------------
  console.log("--- 1. INVENTORY RECONCILIATION ---");

  // Check LPG 12kg (p1)
  const lpgLayers = [
    { id: "l1", productId: "p1", qtyRemaining: 25, unitCost: 1200, receivedAt: "2026-01-01" },
    { id: "l2", productId: "p1", qtyRemaining: 40, unitCost: 1200, receivedAt: "2026-01-05" },
  ];
  const lpgIssue = consumeCostLayers(lpgLayers, 6, "fifo", 1200);
  const lpgRemainingQty = lpgLayers.reduce((s, l) => {
    const upd = lpgIssue.updatedLayers.find((u) => u.id === l.id);
    return s + (upd ? upd.qtyRemaining : l.qtyRemaining);
  }, 0);
  const lpgRemainingVal = lpgLayers.reduce((s, l) => {
    const upd = lpgIssue.updatedLayers.find((u) => u.id === l.id);
    const qty = upd ? upd.qtyRemaining : l.qtyRemaining;
    return s + qty * l.unitCost;
  }, 0);
  console.log(
    `LPG 12kg: Remaining Qty = ${lpgRemainingQty} (Expected: 59), Valuation = ${lpgRemainingVal} (Expected: 70800), COGS = ${lpgIssue.cogsAmount}`,
  );

  // Check Nitrogen (p5)
  const n2Layers = [
    { id: "l3", productId: "p5", qtyRemaining: 6, unitCost: 880, receivedAt: "2026-01-01" },
  ];
  const n2Issue = consumeCostLayers(n2Layers, 4, "fifo", 880);
  const n2RemainingQty = n2Layers.reduce((s, l) => {
    const upd = n2Issue.updatedLayers.find((u) => u.id === l.id);
    return s + (upd ? upd.qtyRemaining : l.qtyRemaining);
  }, 0);
  const n2RemainingVal = n2Layers.reduce((s, l) => {
    const upd = n2Issue.updatedLayers.find((u) => u.id === l.id);
    const qty = upd ? upd.qtyRemaining : l.qtyRemaining;
    return s + qty * l.unitCost;
  }, 0);
  console.log(
    `Nitrogen: Remaining Qty = ${n2RemainingQty} (Expected: 2), Valuation = ${n2RemainingVal} (Expected: 1760), COGS = ${n2Issue.cogsAmount}`,
  );

  // Total seed inventory valuation
  const allValuation = computeLayerValuation(seedCostLayers);
  console.log(
    `Total Seed Layers Count: ${seedCostLayers.length}, Total Inventory Value: ${allValuation.totalValue}, Total Units: ${allValuation.totalQty}`,
  );

  // Serial reconciliation
  const serialRecon = reconcileQuantityWithSerials(seedProducts, seedCylinders);
  console.log(`Serial Reconciliation Items Count: ${serialRecon.length}`);
  for (const item of serialRecon) {
    console.log(
      ` - Product ${item.productName} (${item.productCode}): Stock=${item.productStock}, Serials=${item.warehouseFullSerials}, Status=${item.status}`,
    );
  }

  // -------------------------------------------------------------
  // 2. COSTING ENGINE TESTS (FIFO & WAC)
  // -------------------------------------------------------------
  console.log("\n--- 2. COSTING ENGINE TESTS ---");
  const testFifoLayers = [
    { id: "t1", productId: "test", qtyRemaining: 10, unitCost: 100, receivedAt: "2026-01-01" },
    { id: "t2", productId: "test", qtyRemaining: 10, unitCost: 300, receivedAt: "2026-01-02" },
  ];
  const fifoRes = consumeCostLayers(testFifoLayers, 10, "fifo", 100);
  const fifoRemainingLayers = testFifoLayers.map((l) => {
    const upd = fifoRes.updatedLayers.find((u) => u.id === l.id);
    return { ...l, qtyRemaining: upd ? upd.qtyRemaining : l.qtyRemaining };
  });
  const fifoRemainingVal = computeLayerValuation(fifoRemainingLayers);
  console.log(
    `FIFO Test (10@100 + 10@300, issue 10): COGS = ${fifoRes.cogsAmount} (Exp: 1000), Remaining Qty = ${fifoRemainingVal.totalQty} (Exp: 10), Value = ${fifoRemainingVal.totalValue} (Exp: 3000)`,
  );

  // WAC calculation
  const avgCostBefore = computeWeightedAverageOnReceipt(8, 100, 5, 200);
  console.log(`WAC Avg Cost for (8@100 + 5@200): ${avgCostBefore.toFixed(4)} (Exp: 138.4615)`);
  const wacRemainingQty = 3;
  const avgCostAfter = computeWeightedAverageOnReceipt(wacRemainingQty, avgCostBefore, 1, 50);
  console.log(
    `WAC after receipt of 1@50: Total Qty = 4, New Avg Cost = ${avgCostAfter.toFixed(4)}, New Valuation = ${(4 * avgCostAfter).toFixed(2)}`,
  );

  // -------------------------------------------------------------
  // 3. AR, AP & VAT RECONCILIATION
  // -------------------------------------------------------------
  console.log("\n--- 3. AR, AP & VAT RECONCILIATION ---");
  const arResult = computeCustomerReceivables(seedCustomers, seedSales, seedVouchers);
  console.log(`AR Total Due: ${arResult.totalDue}`);
  console.log(
    `Customer breakdown:`,
    arResult.rows.map((c) => `${c.customerName}: Outstanding Due=${c.due}`),
  );

  // Check Draft SO-2026-0005
  const so5 = seedSales.find((s) => s.orderNo === "SO-2026-0005");
  const isSo5InAr = arResult.rows.some((c) => c.orders.some((i) => i.orderNo === "SO-2026-0005"));
  console.log(
    `SO-2026-0005 Status: ${so5?.status}, Total: ${so5?.total}, Included in AR: ${isSo5InAr} (Must be false)`,
  );

  const vatResult = computeOutputVatLiability(seedSales);
  console.log(
    `Posted Output VAT: ${vatResult.totalOutputTax} (Expected: 4029), Net Sales: ${vatResult.netSales}, Gross Sales: ${vatResult.grossSales}`,
  );

  const apResult = computeSupplierPayables(seedSuppliers, seedPurchases, seedVouchers);
  console.log(`AP Total Due: ${apResult.totalDue}`);
  console.log(
    `Supplier breakdown:`,
    apResult.rows.map((s) => `${s.supplierName}: Outstanding Due=${s.due}`),
  );

  // -------------------------------------------------------------
  // 4. FINANCIAL STATEMENTS AUDIT (P&L, Balance Sheet, Cash Flow)
  // -------------------------------------------------------------
  console.log("\n--- 4. FINANCIAL STATEMENTS AUDIT ---");
  const pnl = computeProfitAndLoss({
    sales: seedSales,
    stockMovements: seedStockMovements,
    expenses: seedExpenses,
    payroll: seedPayroll,
    vouchers: seedVouchers,
  });
  console.log(
    `P&L: Gross Revenue = ${pnl.revenue}, COGS = ${pnl.cogs}, Gross Profit = ${pnl.grossProfit}, Total Expenses = ${pnl.totalExpenses}, Net Profit = ${pnl.netProfit}`,
  );

  const bs = computeBalanceSheet({
    ledger: seedLedger,
    products: seedProducts,
    costLayers: seedCostLayers,
    customers: seedCustomers,
    suppliers: seedSuppliers,
    sales: seedSales,
    purchases: seedPurchases,
    assets: seedAssets,
    stockMovements: seedStockMovements,
    expenses: seedExpenses,
    vouchers: seedVouchers,
    accounts: seedAccounts,
  });
  console.log(
    `Balance Sheet: Assets = ${bs.totalAssets}, Liabilities = ${bs.totalLiabilities}, Equity = ${bs.totalEquity}, Check (A = L+E): ${bs.isBalanced}, Discrepancy = ${bs.discrepancy}`,
  );

  const cf = computeCashFlow({
    ledger: seedLedger,
    accounts: seedAccounts,
  });
  console.log(
    `Cash Flow: Opening Cash = ${cf.openingCash}, Operating CF = ${cf.netOperating}, Investing CF = ${cf.netInvesting}, Financing CF = ${cf.netFinancing}, Net Movement = ${cf.netCashFlow}, Closing Cash = ${cf.closingCash}, Reconciles = ${cf.reconcilesWithLedger}`,
  );

  const integrity = reconcileFinancialIntegrity({
    products: seedProducts,
    costLayers: seedCostLayers,
    stockMovements: seedStockMovements,
    customers: seedCustomers,
    suppliers: seedSuppliers,
    sales: seedSales,
    purchases: seedPurchases,
    ledger: seedLedger,
    expenses: seedExpenses,
    vouchers: seedVouchers,
    assets: seedAssets,
    accounts: seedAccounts,
  });
  console.log(
    `Integrity Audit: Passed = ${integrity.passed}, Discrepancies Count = ${integrity.messages.length}`,
  );

  // -------------------------------------------------------------
  // 5. SECURITY & RBAC AUDIT
  // -------------------------------------------------------------
  console.log("\n--- 5. SECURITY & RBAC AUDIT ---");
  const lowPrivUsers = [
    { username: "sales1", role: "Sales" },
    { username: "warehouse", role: "Warehouse" },
    { username: "hr1", role: "HR" },
    { username: "delivery1", role: "Delivery" },
  ];

  for (const u of lowPrivUsers) {
    const canLedger = hasPermission(u.role, "accounting.create");
    const canPayroll = hasPermission(u.role, "payroll.create");
    const canUsers = hasPermission(u.role, "users.create");
    const canSettings = hasPermission(u.role, "settings.write");
    console.log(
      `User ${u.username} (${u.role}): Can Ledger = ${canLedger}, Can Payroll = ${canPayroll}, Can Users = ${canUsers}, Can Settings = ${canSettings}`,
    );
  }

  // Password hashing test
  const pass = "insaf123";
  const hashed = hashPassword(pass);
  const verifyValid = verifyPassword(pass, hashed);
  const verifyInvalid = verifyPassword("wrong123", hashed);
  console.log(
    `Password Hashing: Prefix = ${hashed.slice(0, 15)}..., Verify Valid = ${verifyValid}, Verify Invalid = ${verifyInvalid}`,
  );

  // Session Secret test
  try {
    validateSessionSecret(undefined, true);
    console.log("Session Secret in Prod: FAILED TO REJECT");
  } catch (e) {
    console.log("Session Secret in Prod: Correctly Rejected missing secret ->", e.message);
  }

  // Sequence numbering test
  resetSequenceCounter("SO", 2026);
  const seq1 = await getNextSequence(null, "SO", 2026);
  const seq2 = await getNextSequence(null, "SO", 2026);
  console.log(`Sequence Generation: 1st = ${seq1}, 2nd = ${seq2}`);

  console.log("\n==================================================");
  console.log("AUDIT DATA COLLECTION COMPLETED SUCCESSFULLY");
  console.log("==================================================");
}

runAudit().catch(console.error);
