import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  seedCustomers,
  seedSuppliers,
  seedProducts,
  seedCylinders,
  seedMovements,
  seedSales,
  seedDeliveries,
  seedExpenses,
  seedLedger,
  seedPurchases,
  seedStockMovements,
  seedVouchers,
  seedEmployees,
  seedPayroll,
  seedAssets,
  seedCostLayers,
  seedAccounts,
  seedAppUsers,
  seedChartOfAccounts,
} from "@/lib/seed-data";

import { KNOWN_OPENING_STOCKS } from "@/lib/inventory.server";
import {
  computeProfitAndLoss,
  computeBalanceSheet,
  computeCustomerReceivables,
  computeSupplierPayables,
} from "@/lib/accounting-engine";
import { createTodayDateRange } from "@/lib/date-range";
import type { Customer, Product, SalesOrder, Supplier } from "@/types";

describe("Clean State & Demo Data Removal Verification", () => {
  it("1. Verifies that all demo data arrays in seed-data.ts are completely empty (0 records)", () => {
    assert.equal(seedCustomers.length, 0, "Customers must have 0 demo records");
    assert.equal(seedSuppliers.length, 0, "Suppliers must have 0 demo records");
    assert.equal(seedProducts.length, 0, "Products must have 0 demo records");
    assert.equal(seedCylinders.length, 0, "Cylinders must have 0 demo records");
    assert.equal(seedMovements.length, 0, "Movements must have 0 demo records");
    assert.equal(seedSales.length, 0, "Sales orders must have 0 demo records");
    assert.equal(seedDeliveries.length, 0, "Deliveries must have 0 demo records");
    assert.equal(seedExpenses.length, 0, "Expenses must have 0 demo records");
    assert.equal(seedLedger.length, 0, "Ledger entries must have 0 demo records");
    assert.equal(seedPurchases.length, 0, "Purchase orders must have 0 demo records");
    assert.equal(seedStockMovements.length, 0, "Stock movements must have 0 demo records");
    assert.equal(seedVouchers.length, 0, "Vouchers must have 0 demo records");
    assert.equal(seedEmployees.length, 0, "Employees must have 0 demo records");
    assert.equal(seedPayroll.length, 0, "Payroll runs must have 0 demo records");
    assert.equal(seedAssets.length, 0, "Assets must have 0 demo records");
    assert.equal(seedCostLayers.length, 0, "Cost layers must have 0 demo records");
    assert.equal(seedAccounts.length, 0, "Accounts must have 0 dummy bank records");
  });

  it("2. Verifies that essential system data is strictly protected and preserved", () => {
    assert.ok(seedAppUsers.length >= 8, "All 8 system login accounts must be preserved");
    const roles = seedAppUsers.map((u) => u.role);
    assert.ok(roles.includes("Administrator"), "Administrator account must exist");
    assert.ok(roles.includes("Manager"), "Manager account must exist");
    assert.ok(roles.includes("Sales"), "Sales account must exist");
    assert.ok(roles.includes("Warehouse"), "Warehouse account must exist");
    assert.ok(roles.includes("Accounts"), "Accounts account must exist");

    assert.ok(seedChartOfAccounts.length >= 10, "Standard Chart of Accounts must be preserved");
    const coaTypes = new Set(seedChartOfAccounts.map((c) => c.type));
    assert.ok(coaTypes.has("Income"), "Income accounts must exist");
    assert.ok(coaTypes.has("Expense"), "Expense accounts must exist");
    assert.ok(coaTypes.has("Asset"), "Asset accounts must exist");
    assert.ok(coaTypes.has("Liability"), "Liability accounts must exist");
    assert.ok(coaTypes.has("Equity"), "Equity accounts must exist");
  });

  it("3. Verifies that hardcoded opening stock dictionary is completely clean", () => {
    assert.deepEqual(KNOWN_OPENING_STOCKS, {}, "KNOWN_OPENING_STOCKS must be empty");
  });

  it("4. Verifies Dashboard & Accounting Engine calculations start cleanly from zero", () => {
    const range = createTodayDateRange();
    const pnl = computeProfitAndLoss({
      sales: [],
      stockMovements: [],
      expenses: [],
      vouchers: [],
      payroll: [],
      range,
    });

    assert.equal(pnl.revenue, 0, "Revenue must be 0");
    assert.equal(pnl.cogs, 0, "COGS must be 0");
    assert.equal(pnl.grossProfit, 0, "Gross profit must be 0");
    assert.equal(pnl.totalExpenses, 0, "Total expenses must be 0");
    assert.equal(pnl.netProfit, 0, "Net profit must be 0");

    const ar = computeCustomerReceivables([], [], []);
    assert.equal(ar.totalDue, 0, "Customer receivables must be 0");
    assert.equal(ar.totalInvoiced, 0, "Total invoiced must be 0");
    assert.equal(ar.totalCollected, 0, "Total collected must be 0");

    const ap = computeSupplierPayables([], [], []);
    assert.equal(ap.totalDue, 0, "Supplier payables must be 0");
    assert.equal(ap.totalBilled, 0, "Total billed must be 0");
    assert.equal(ap.totalPaid, 0, "Total paid must be 0");

    const bs = computeBalanceSheet({
      products: [],
      customers: [],
      suppliers: [],
      sales: [],
      purchases: [],
      stockMovements: [],
      expenses: [],
      ledger: [],
      vouchers: [],
      costLayers: [],
      payroll: [],
      assets: [],
      asOf: range.to || new Date().toISOString().slice(0, 10),
    });

    assert.equal(bs.inventoryValue, 0, "Inventory asset must be 0");
    assert.equal(bs.ar, 0, "Accounts receivable must be 0");
    assert.equal(bs.ap, 0, "Accounts payable must be 0");
    assert.equal(bs.totalAssets, 0, "Total assets must be 0");
    assert.equal(bs.totalLiabilities, 0, "Total liabilities must be 0");
    assert.equal(bs.isBalanced, true, "Balance sheet must be balanced");
    assert.equal(bs.discrepancy, 0, "Discrepancy must be 0");
  });

  it("5. Verifies dynamic calculation updates as soon as real business records are introduced", () => {
    const realCustomer: Customer = {
      id: "cust-real-001",
      name: "Actual Real Business Ltd",
      phone: "+880 1711 999999",
      address: "Dhaka, Bangladesh",
      creditLimit: 500000,
      openingBalance: 0,
      createdAt: new Date().toISOString(),
    };

    const realProduct: Product = {
      id: "prod-real-001",
      code: "LPG-12KG",
      name: "LPG 12KG Cylinder",
      category: "LPG",
      productType: "cylinder",
      uom: "cyl",
      price: 1450,
      cost: 1200,
      stock: 50,
      createdAt: new Date().toISOString(),
    };

    const realSale: SalesOrder = {
      id: "so-real-001",
      orderNo: "SO-2026-000001",
      customerId: realCustomer.id,
      customerName: realCustomer.name,
      date: new Date().toISOString().slice(0, 10),
      status: "confirmed",
      subtotal: 14500,
      tax: 0,
      discount: 0,
      total: 14500,
      paid: 5000,
      due: 9500,
      items: [
        {
          productId: realProduct.id,
          productName: realProduct.name,
          quantity: 10,
          unitPrice: 1450,
          total: 14500,
          itemType: "cylinder",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    const ar = computeCustomerReceivables([realCustomer], [realSale], []);
    assert.equal(ar.totalDue, 9500, "AR must dynamically calculate real customer due (9,500 ৳)");
    assert.equal(ar.rows.length, 1, "Exactly 1 real customer statement row");
    assert.equal(ar.rows[0].customerName, "Actual Real Business Ltd");

    const range = createTodayDateRange();
    const pnl = computeProfitAndLoss({
      sales: [realSale],
      stockMovements: [],
      expenses: [],
      vouchers: [],
      payroll: [],
      range,
    });
    assert.equal(pnl.revenue, 14500, "P&L must calculate dynamic sales revenue (14,500 ৳)");
  });
});
