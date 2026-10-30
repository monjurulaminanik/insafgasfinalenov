import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertPayrollMonth,
  monthlyPayrollReport,
  payrollAmounts,
  payrollDate,
  planAdvanceSettlement,
  createMonthlyPayrollDrafts,
} from "../src/lib/payroll.ts";
import type { MonthlyPayroll, SalaryAdvance } from "../src/lib/payroll.ts";
import type { Employee } from "../src/types/index.ts";

const run = (extra: Partial<MonthlyPayroll> = {}): MonthlyPayroll => ({
  id: "p1",
  employeeId: "e1",
  employeeName: "Employee",
  month: "2026-01",
  basic: 1000,
  bonus: 100,
  allowance: 50,
  deduction: 150,
  net: 1000,
  status: "draft",
  createdAt: "2026-01-01T00:00:00Z",
  ...extra,
});
const advance = (
  id: string,
  amount: number,
  date = "2026-01-01T00:00:00Z",
  employeeId = "e1",
): SalaryAdvance => ({
  id,
  amount,
  date,
  employeeId,
  employeeName: "Employee",
  paymentMethod: "cash",
});
const date = "2026-01-31T00:00:00Z";

describe("Monthly payroll and advance settlement", () => {
  it("validates months and financial inputs, preserving zero basic salary", () => {
    for (const invalid of ["2026-00", "2026-13", "2026-1", "2026-01-01", ""])
      assert.throws(() => assertPayrollMonth(invalid));
    assert.equal(payrollAmounts({ basic: 0, bonus: 20, allowance: 0, deduction: 0 }).net, 20);
    for (const invalid of [NaN, Infinity, -1])
      assert.throws(() => payrollAmounts({ ...run(), basic: invalid }));
    assert.throws(() => payrollAmounts({ ...run(), deduction: 99999 }));
  });
  it("uses Bangladesh business dates at UTC month boundaries", () => {
    assert.equal(payrollDate("2026-01-31T18:00:00Z"), "2026-02-01");
    assert.throws(() => payrollDate("invalid"));
  });
  it("settles FIFO without reducing earned salary or ordinary deductions", () => {
    const salary = run();
    const plan = planAdvanceSettlement(
      salary,
      [advance("b", 600, "2026-01-02T00:00:00Z"), advance("a", 600)],
      [],
      date,
    );
    assert.deepEqual(plan.advanceSettlements, [
      { advanceId: "a", amount: 600 },
      { advanceId: "b", amount: 400 },
    ]);
    assert.equal(plan.cashPaid, 0);
    assert.equal(plan.outstanding, 200);
    assert.equal(salary.net, 1000);
    assert.equal(salary.deduction, 150);
  });
  it("carries unrecovered advance to another month and never consumes a draft allocation", () => {
    const advances = [advance("a", 1300)];
    const paid = run({
      status: "paid",
      advanceSettlements: [{ advanceId: "a", amount: 1000 }],
      cashPaid: 0,
    });
    const next = run({ id: "p2", month: "2026-02" });
    const plan = planAdvanceSettlement(
      next,
      advances,
      [paid, run({ id: "draft", advanceSettlements: [{ advanceId: "a", amount: 300 }] })],
      "2026-02-28T00:00:00Z",
    );
    assert.equal(plan.advanceRecovered, 300);
    assert.equal(plan.cashPaid, 700);
    assert.equal(plan.outstanding, 0);
  });
  it("supports partial recovery and zero recovery", () => {
    const advances = [advance("a", 500)];
    assert.deepEqual(planAdvanceSettlement(run(), advances, [], date, 200), {
      advanceSettlements: [{ advanceId: "a", amount: 200 }],
      advanceRecovered: 200,
      cashPaid: 800,
      outstanding: 300,
    });
    assert.equal(planAdvanceSettlement(run(), advances, [], date, 0).cashPaid, 1000);
  });
  it("excludes future advances and other employees", () => {
    const plan = planAdvanceSettlement(
      run(),
      [
        advance("future", 500, "2026-02-01T00:00:00Z"),
        advance("other", 800, "2026-01-01T00:00:00Z", "e2"),
      ],
      [],
      date,
    );
    assert.equal(plan.advanceRecovered, 0);
    assert.equal(plan.cashPaid, 1000);
  });
  it("rejects over-recovery, invalid dates, mismatched net, duplicate advance rows and repeated paid runs", () => {
    assert.throws(() => planAdvanceSettlement(run(), [advance("a", 500)], [], date, 501));
    assert.throws(() => planAdvanceSettlement(run(), [advance("a", 2000)], [], date, 1001));
    assert.throws(() => planAdvanceSettlement(run(), [], [], "invalid"));
    assert.throws(() => planAdvanceSettlement(run({ net: 900 }), [], [], date));
    assert.throws(() =>
      planAdvanceSettlement(run(), [advance("a", 500), advance("a", 500)], [], date),
    );
    assert.throws(() => planAdvanceSettlement(run({ status: "paid" }), [], [], date));
  });
  it("does not reuse advances consumed by later-dated payroll when backdating", () => {
    const later = run({
      id: "later",
      month: "2026-02",
      status: "paid",
      paidAt: "2026-02-28T00:00:00Z",
      advanceSettlements: [{ advanceId: "a", amount: 500 }],
    });
    assert.equal(
      planAdvanceSettlement(run(), [advance("a", 500)], [later], date).advanceRecovered,
      0,
    );
  });
  it("detects existing over-settlement rather than hiding corrupt balances", () => {
    assert.throws(() =>
      planAdvanceSettlement(
        run(),
        [advance("a", 100)],
        [run({ status: "paid", advanceSettlements: [{ advanceId: "a", amount: 101 }] })],
        date,
      ),
    );
  });
  it("reports by salary month, separates cash/recovery, and supports legacy paid rows", () => {
    const paid = run({
      status: "paid",
      paidAt: "2026-02-05T00:00:00Z",
      advanceSettlements: [{ advanceId: "a", amount: 300 }],
      cashPaid: 700,
    });
    const legacy = run({ id: "legacy", status: "paid" });
    const report = monthlyPayrollReport(
      [paid, legacy, run({ id: "draft" }), run({ id: "feb", month: "2026-02" })],
      "2026-01",
    );
    assert.equal(report.rows.length, 3);
    assert.deepEqual(report.totals, {
      gross: 3450,
      deduction: 450,
      net: 3000,
      advanceRecovered: 300,
      cashPaid: 1700,
      unpaid: 1000,
    });
  });
  it("keeps decimal settlements balanced and rejects mismatched recorded cash", () => {
    const salary = run({ basic: 0.3, bonus: 0, allowance: 0, deduction: 0, net: 0.3 });
    const plan = planAdvanceSettlement(salary, [advance("a", 0.1)], [], date);
    assert.equal(plan.cashPaid, 0.2);
    assert.throws(() => monthlyPayrollReport([run({ status: "paid", cashPaid: 999 })], "2026-01"));
    assert.throws(() =>
      monthlyPayrollReport([run({ status: "paid", advanceRecovered: 1 })], "2026-01"),
    );
  });
  it("bulk creates eligible employees, skips existing/ineligible rows, and reports partial failures", async () => {
    const employee = (id: string, extra: Partial<Employee> = {}): Employee => ({
      id,
      employeeNo: id,
      name: id,
      phone: "",
      designation: "Staff",
      department: "",
      joiningDate: "2025-01-01",
      salary: 1000,
      status: "active",
      createdAt: "2025-01-01",
      ...extra,
    });
    const calls: string[] = [];
    const result = await createMonthlyPayrollDrafts(
      [
        employee("e1"),
        employee("e2"),
        employee("e3"),
        employee("inactive", { status: "inactive" }),
        employee("future", { joiningDate: "2026-02-01" }),
      ],
      [run()],
      "2026-01",
      async (input) => {
        calls.push(input.employeeId);
        if (input.employeeId === "e2") throw new Error("save failed");
      },
    );
    assert.deepEqual(calls, ["e2", "e3"]);
    assert.deepEqual(result, {
      created: 1,
      skipped: 2,
      failures: [{ employeeName: "e2", message: "save failed" }],
    });
  });
});
