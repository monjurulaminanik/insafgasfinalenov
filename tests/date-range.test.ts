import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  EMPTY_DATE_RANGE,
  applyPreset,
  createTodayDateRange,
  filterByDateRange,
  isInDateRange,
  parseRecordTime,
  rangeForPreset,
  toDateInputValue,
} from "../src/lib/date-range.ts";
import { buildPartyStatement, monthKeyOf } from "../src/lib/party-statement.ts";
import { buildStockReport } from "../src/lib/stock-report.ts";
import { computeCashFlow } from "../src/lib/accounting-engine.ts";
import type {
  Customer,
  Employee,
  LedgerEntry,
  PayrollRun,
  Product,
  SalesOrder,
  StockMovement,
  Supplier,
  Voucher,
} from "../src/types/index.ts";

describe("Dhaka reporting calendar", () => {
  const now = new Date("2026-10-29T18:00:00.000Z");
  const today = createTodayDateRange(now);

  it("rolls today at Dhaka midnight, rather than UTC midnight", () => {
    assert.deepEqual(today, { preset: "today", from: "2026-10-30", to: "2026-10-30" });
    assert.equal(toDateInputValue(new Date(now.getTime() - 1)), "2026-10-29");
    assert.notEqual(createTodayDateRange(now), createTodayDateRange(now));
  });

  it("includes both day boundaries and excludes adjacent days", () => {
    assert.equal(isInDateRange("2026-10-29T17:59:59.999Z", today), false);
    assert.equal(isInDateRange("2026-10-29T18:00:00.000Z", today), true);
    assert.equal(isInDateRange("2026-10-30T17:59:59.999Z", today), true);
    assert.equal(isInDateRange("2026-10-30T18:00:00.000Z", today), false);
    assert.equal(isInDateRange("2026-10-30", today), true);
    assert.equal(isInDateRange("2026-10-30T23:59:59.999", today), true);
    assert.equal(isInDateRange("invalid", today), false);
    assert.equal(parseRecordTime("2026-10"), Date.parse("2026-09-30T18:00:00Z"));
  });

  it("calculates week and month presets over year and leap-day boundaries", () => {
    const boundary = new Date("2025-12-31T18:05:00Z");
    assert.deepEqual(rangeForPreset("week", boundary), { from: "2025-12-26", to: "2026-01-01" });
    assert.deepEqual(rangeForPreset("month", boundary), { from: "2026-01-01", to: "2026-01-01" });
    assert.deepEqual(rangeForPreset("week", new Date("2024-03-01T00:00:00Z")), {
      from: "2024-02-24",
      to: "2024-03-01",
    });
  });

  it("preserves custom, open-ended and all-time choices", () => {
    const custom = { preset: "custom" as const, from: "2026-01-01", to: "2026-01-31" };
    assert.deepEqual(applyPreset("custom", custom), custom);
    const rows = [{ date: "2026-01-01" }, { date: "2026-10-30" }, { date: "" }];
    assert.equal(
      filterByDateRange(rows, applyPreset("all"), (r) => r.date),
      rows,
    );
    assert.equal(filterByDateRange(rows, { ...custom, to: "" }, (r) => r.date).length, 2);
    assert.equal(filterByDateRange(rows, { ...custom, from: "" }, (r) => r.date).length, 1);
  });

  for (const timezone of ["UTC", "America/New_York", "Asia/Tokyo", "Asia/Dhaka"]) {
    it(`returns identical SSR/browser dates on a ${timezone} host`, () => {
      const moduleUrl = new URL("../src/lib/date-range.ts", import.meta.url).href;
      const output = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import { createTodayDateRange, isInDateRange, rangeForPreset } from ${JSON.stringify(moduleUrl)};
        const now = new Date("2026-10-31T18:00:00Z");
        const range = createTodayDateRange(now);
        console.log(JSON.stringify([range, rangeForPreset("month", now), isInDateRange("2026-11-01T23:59:59.999", range)]));
      `,
        ],
        { encoding: "utf8", env: { ...process.env, TZ: timezone } },
      );
      assert.deepEqual(JSON.parse(output), [
        { preset: "today", from: "2026-11-01", to: "2026-11-01" },
        { from: "2026-11-01", to: "2026-11-01" },
        true,
      ]);
    });
  }
});

describe("Period activity preserves historical balances", () => {
  const range = createTodayDateRange(new Date("2026-10-30T12:00:00Z"));
  const customer = {
    id: "c",
    name: "Older customer",
    createdAt: "2025-01-01",
    openingBalance: 100,
  } as Customer;
  const sales = [
    { id: "old", customerId: "c", date: "2026-10-28", status: "invoiced", total: 300, paid: 0 },
    {
      id: "today",
      customerId: "c",
      date: "2026-10-30T23:59:59.999+06:00",
      status: "invoiced",
      total: 50,
      paid: 0,
    },
    { id: "future", customerId: "c", date: "2026-11-01", status: "invoiced", total: 20, paid: 0 },
  ] as SalesOrder[];

  it("carries previous customer debt into opening while limiting period invoices", () => {
    const statement = buildPartyStatement({
      kind: "customer",
      party: customer,
      sales,
      vouchers: [],
      range,
    });
    assert.equal(statement.openingBalance, 400);
    assert.equal(statement.periodSales, 50);
    assert.equal(statement.totalDebit, 50);
    assert.equal(statement.closingBalance, 450);
    const lifetime = buildPartyStatement({
      kind: "customer",
      party: customer,
      sales,
      vouchers: [],
      range: EMPTY_DATE_RANGE,
    });
    assert.equal(lifetime.closingBalance, 470);
    const quiet = buildPartyStatement({
      kind: "customer",
      party: customer,
      sales,
      vouchers: [],
      range: { preset: "custom", from: "2026-11-02", to: "2026-11-02" },
    });
    assert.equal(quiet.totalDebit, 0);
    assert.equal(quiet.totalCredit, 0);
    assert.equal(quiet.closingBalance, 470);
  });

  it("keeps inactive suppliers and employees' opening balances", () => {
    const supplier = {
      id: "s",
      name: "Older supplier",
      openingBalance: 500,
      createdAt: "2025-01-01",
    } as Supplier;
    assert.equal(
      buildPartyStatement({ kind: "supplier", party: supplier, purchases: [], vouchers: [], range })
        .closingBalance,
      500,
    );
    const employee = { id: "e", name: "Employee", createdAt: "2025-01-01" } as Employee;
    const payroll = [
      {
        id: "salary",
        employeeId: "e",
        month: "2026-09",
        createdAt: "2026-09-30",
        net: 1000,
        status: "draft",
      },
    ] as PayrollRun[];
    const vouchers = [
      {
        id: "pay",
        partyType: "employee",
        partyId: "e",
        type: "payment",
        amount: 200,
        date: "2026-10-30",
      },
    ] as Voucher[];
    const statement = buildPartyStatement({
      kind: "employee",
      party: employee,
      payroll,
      vouchers,
      range,
    });
    assert.equal(statement.openingBalance, 1000);
    assert.equal(statement.periodPayments, 200);
    assert.equal(statement.closingBalance, 800);
    assert.equal(monthKeyOf("2026-10-31T18:00:00Z"), "2026-11");
  });

  it("retains earlier cash entries needed for cash-flow opening", () => {
    const ledger = [
      { id: "old", date: "2026-10-29", account: "cash", direction: "in", amount: 100 },
      {
        id: "today",
        date: "2026-10-30",
        account: "cash",
        direction: "out",
        amount: 30,
        category: "expense",
        refType: "expense",
      },
    ] as LedgerEntry[];
    const cash = computeCashFlow({ ledger, range });
    assert.equal(cash.openingCash, 100);
    assert.equal(cash.closingCash, 70);
  });

  it("retains stock with no activity today and includes the last millisecond", () => {
    const product = {
      id: "p",
      code: "P",
      name: "Existing stock",
      stock: 8,
      cost: 10,
      createdAt: "2025-01-01",
    } as unknown as Product;
    const movements = [
      { id: "old", productId: "p", date: "2026-10-28", type: "in", quantity: 10, unitCost: 10 },
      {
        id: "today",
        productId: "p",
        date: "2026-10-30T23:59:59.999+06:00",
        type: "out",
        quantity: 2,
        unitCost: 10,
      },
    ] as StockMovement[];
    const report = buildStockReport([product], movements, range)[0];
    assert.equal(report.qtyOut, 2);
    assert.equal(report.inHand, 8);
    const quiet = buildStockReport([product], movements, {
      preset: "custom",
      from: "2026-11-02",
      to: "2026-11-02",
    });
    assert.equal(quiet.length, 1);
    assert.equal(quiet[0].inHand, 8);
  });
});
