import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Db, MongoClient } from "mongodb";
import { executePayrollTransaction } from "../src/lib/payroll.server.ts";
import type { PayrollCommand } from "../src/lib/payroll.functions.ts";

type Row = Record<string, any>;
/** A transactional test double: serial snapshots and rollback; every DB operation
 * asserts the caller passed its session. No Mongo connection or environment needed. */
function fixture() {
  let state: Record<string, Row[]> = {
    employees: [
      { id: "e1", name: "Employee", status: "active", joiningDate: "2025-01-01T00:00:00Z" },
    ],
  };
  let queue = Promise.resolve();
  let failingCollection = "";
  let ended = 0;
  const session = {
    async withTransaction<T>(work: () => Promise<T>) {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const before = structuredClone(state);
      try {
        return await work();
      } catch (error) {
        state = before;
        throw error;
      } finally {
        release();
      }
    },
    async endSession() {
      ended++;
    },
  };
  const matches = (row: Row, filter: Row) =>
    Object.entries(filter).every(([key, value]) =>
      value && typeof value === "object" && "$ne" in value
        ? row[key] !== value.$ne
        : row[key] === value,
    );
  const check = (options: { session?: unknown }) =>
    assert.equal(options?.session, session, "every read/write must use transaction session");
  const db = {
    collection(name: string) {
      const rows = () => (state[name] ??= []);
      return {
        async findOne(filter: Row, options: Row) {
          check(options);
          return structuredClone(rows().find((row) => matches(row, filter)) ?? null);
        },
        find(filter: Row, options: Row) {
          check(options);
          return {
            async toArray() {
              return structuredClone(rows().filter((row) => matches(row, filter)));
            },
          };
        },
        async findOneAndUpdate(filter: Row, update: Row, options: Row) {
          check(options);
          const row = rows().find((row) => matches(row, filter));
          if (!row) return null;
          for (const [key, value] of Object.entries(update.$inc))
            row[key] = (row[key] ?? 0) + Number(value);
          return structuredClone(row);
        },
        async insertOne(row: Row, options: Row) {
          check(options);
          if (name === failingCollection) throw new Error("injected write failure");
          if (row._id && rows().some((prior) => prior._id === row._id))
            throw new Error("duplicate key");
          rows().push(structuredClone(row));
        },
        async updateOne(filter: Row, update: Row, options: Row) {
          check(options);
          const row = rows().find((row) => matches(row, filter));
          if (row) Object.assign(row, structuredClone(update.$set));
        },
        async deleteOne(filter: Row, options: Row) {
          check(options);
          state[name] = rows().filter((row) => !matches(row, filter));
        },
      };
    },
  } as unknown as Db;
  const client = { startSession: () => session } as unknown as MongoClient;
  return {
    execute: (command: Exclude<PayrollCommand, { action: "advances" }>) =>
      executePayrollTransaction(db, client, command, { username: "tester" }),
    rows: (name: string) => structuredClone(state[name] ?? []),
    fail: (name: string) => {
      failingCollection = name;
    },
    ended: () => ended,
  };
}
const save = {
  action: "save",
  employeeId: "e1",
  month: "2026-01",
  basic: 1000,
  bonus: 0,
  allowance: 0,
  deduction: 0,
} as const;
const advance = {
  action: "advance",
  employeeId: "e1",
  amount: 300,
  date: "2026-01-01T00:00:00Z",
  paymentMethod: "cash",
  requestId: "request-1",
} as const;
const pay = {
  action: "pay",
  id: "payroll-e1-2026-01",
  method: "bank",
  paymentDate: "2026-01-31T18:00:00Z",
  advanceRecovery: 300,
  requestId: "payment-1",
} as const;

describe("Atomic payroll server transaction", () => {
  it("rolls back advance and voucher if ledger insertion fails, and closes session", async () => {
    const f = fixture();
    f.fail("ledger");
    await assert.rejects(f.execute(advance), /injected/);
    for (const name of ["salaryAdvances", "vouchers", "ledger"]) assert.deepEqual(f.rows(name), []);
    assert.equal(f.rows("employees")[0].payrollRevision, undefined);
    assert.equal(f.ended(), 1);
  });
  it("rolls back payroll status and allocation if cash ledger fails", async () => {
    const f = fixture();
    await f.execute(save);
    await f.execute(advance);
    f.fail("ledger");
    await assert.rejects(f.execute(pay), /injected/);
    assert.equal(f.rows("payroll")[0].status, "draft");
    assert.equal(f.rows("payroll")[0].advanceSettlements, undefined);
    assert.equal(f.rows("vouchers").length, 1);
    assert.equal(f.rows("ledger").length, 1);
  });
  it("makes retries idempotent and records cash only once", async () => {
    const f = fixture();
    await f.execute(save);
    await f.execute(advance);
    await f.execute(advance);
    await f.execute(pay);
    await f.execute(pay);
    assert.equal(f.rows("salaryAdvances").length, 1);
    assert.equal(f.rows("ledger").length, 2);
    const salary = f.rows("payroll")[0];
    assert.equal(salary.net, 1000);
    assert.equal(salary.cashPaid, 700);
    assert.equal(salary.advanceRecovered, 300);
    assert.equal(f.rows("vouchers")[1].date, "2026-02-01");
    await assert.rejects(f.execute({ ...pay, requestId: "different-payment" }), /ইতিমধ্যে/);
    for (const changed of [
      { method: "cash" },
      { paymentDate: "2026-01-30T00:00:00Z" },
      { advanceRecovery: 0 },
    ])
      await assert.rejects(f.execute({ ...pay, ...changed }), /বদলে/);
    assert.equal(f.rows("auditLogs").length, 3);
    assert.equal(f.rows("auditLogs")[2].username, "tester");
  });
  it("allows only one employee/month draft under concurrent requests", async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.execute(save), f.execute(save)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(f.rows("payroll").length, 1);
  });
  it("does not allow two months to consume the same advance concurrently", async () => {
    const f = fixture();
    await f.execute(save);
    await f.execute({ ...save, month: "2026-02" });
    await f.execute(advance);
    const results = await Promise.allSettled([
      f.execute(pay),
      f.execute({ ...pay, id: "payroll-e1-2026-02", requestId: "payment-2" }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(f.rows("payroll").filter((row) => row.status === "paid").length, 1);
  });
  it("fully settles with advances without creating zero cash ledger, and locks paid edits/deletes", async () => {
    const f = fixture();
    await f.execute(save);
    await f.execute({ ...advance, amount: 1000 });
    await f.execute({ ...pay, advanceRecovery: 1000 });
    assert.equal(f.rows("ledger").length, 1);
    assert.equal(f.rows("vouchers")[1].amount, 0);
    await assert.rejects(f.execute({ ...save, id: pay.id }), /খসড়া/);
    await assert.rejects(f.execute({ action: "remove", id: pay.id }), /খসড়া/);
  });
  it("rejects changed advance retry payload and rolls back invalid named accounts", async () => {
    const f = fixture();
    await f.execute(advance);
    await assert.rejects(f.execute({ ...advance, amount: 301 }), /বদলে/);
    await assert.rejects(
      f.execute({ ...advance, requestId: "unknown-account", paymentMethod: "unknown" }),
      /account/,
    );
    assert.equal(f.rows("salaryAdvances").length, 1);
  });
  it("audit failure rolls back every advance side effect", async () => {
    const f = fixture();
    f.fail("auditLogs");
    await assert.rejects(f.execute(advance), /injected/);
    for (const name of ["salaryAdvances", "vouchers", "ledger", "auditLogs"])
      assert.deepEqual(f.rows(name), []);
    assert.equal(f.rows("employees")[0].payrollRevision, undefined);
  });
  it("audit failure rolls back payroll payment and preserves its unpaid draft", async () => {
    const f = fixture();
    await f.execute(save);
    await f.execute(advance);
    f.fail("auditLogs");
    await assert.rejects(f.execute(pay), /injected/);
    assert.equal(f.rows("payroll")[0].status, "draft");
    assert.equal(f.rows("vouchers").length, 1);
    assert.equal(f.rows("ledger").length, 1);
    assert.equal(f.rows("auditLogs").length, 2);
  });
});
