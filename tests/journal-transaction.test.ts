import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executeJournalTransaction,
  removeJournalTransaction,
  type JournalInput,
} from "../src/lib/journal.server.ts";
import { assertFinancialCrudWrite } from "../src/lib/financial-write-guards.ts";
import { MemoryDb } from "./helpers/memory-db.ts";

const input: JournalInput = {
  date: "2026-10-30",
  requestId: "d08a0b8c-43b3-4f12-a991-3a186c1dc110",
  lines: [
    { accountId: "rent", accountName: "Rent expense", debit: 500, credit: 0 },
    { accountId: "cash", accountName: "cash", debit: 0, credit: 500 },
  ],
};
const fresh = () =>
  new MemoryDb({ chartOfAccounts: [{ id: "rent", name: "Rent expense", type: "Expense" }] });
const post = (db: MemoryDb, payload = input) =>
  executeJournalTransaction(db, db.client, payload, "tester");

test("journal atomically writes balanced voucher, cash book, expense and audit; replay is safe", async () => {
  const db = fresh();
  const journal = await post(db);
  assert.equal(journal.amount, 500);
  assert.equal(db.rows("ledger").length, 2);
  assert.equal(db.rows("ledger").find((l) => l.account === "cash")?.direction, "out");
  assert.equal(db.rows("auditLogs").length, 1);
  const before = db.snapshot();
  assert.deepEqual(await post(db), journal);
  assert.deepEqual(db.snapshot(), before);
  await assert.rejects(post(db, { ...input, notes: "Changed" }), /তথ্য বদলে/);
  assert.deepEqual(db.snapshot(), before);
});

test("journal rejects unbalanced, unknown-account and malformed-date postings without writes", async () => {
  for (const changed of [
    { ...input, date: "2026-02-31" },
    { ...input, lines: [{ ...input.lines[0], debit: 700 }, input.lines[1]] },
    { ...input, lines: [{ ...input.lines[0], accountId: "missing" }, input.lines[1]] },
  ]) {
    const db = fresh();
    const before = db.snapshot();
    await assert.rejects(post(db, changed));
    assert.deepEqual(db.snapshot(), before);
  }
});

test("journal audit failure rolls back voucher and every ledger line", async () => {
  const db = fresh();
  const before = db.snapshot();
  const collection = db.collection.bind(db);
  db.collection = (name: string) => {
    const result = collection(name);
    if (name === "auditLogs")
      result.insertOne = async () => {
        throw new Error("audit failure");
      };
    return result;
  };
  await assert.rejects(post(db), /audit failure/);
  assert.deepEqual(db.snapshot(), before);
});

test("generic CRUD cannot bypass payroll or alter its immutable financial entries", () => {
  for (const op of ["create", "update", "remove", "claim"]) {
    assert.throws(() => assertFinancialCrudWrite("payroll", op));
    for (const coll of ["vouchers", "ledger"]) {
      assert.throws(() => assertFinancialCrudWrite(coll, op, { refType: "salaryAdvance" }));
      assert.throws(() => assertFinancialCrudWrite(coll, op, undefined, { refType: "payroll" }));
    }
  }
  assert.doesNotThrow(() => assertFinancialCrudWrite("payroll", "list"));
  assert.doesNotThrow(() =>
    assertFinancialCrudWrite("vouchers", "create", { refType: "purchase" }),
  );
  assert.throws(() => assertFinancialCrudWrite("vouchers", "create", { type: "journal" }));
  assert.throws(() =>
    assertFinancialCrudWrite("ledger", "remove", undefined, { category: "journal" }),
  );
});

test("journal removal atomically removes both sides and records audit", async () => {
  const db = fresh();
  const voucher = await post(db);
  await removeJournalTransaction(db, db.client, voucher.id, "tester");
  assert.equal(db.rows("vouchers").length, 0);
  assert.equal(db.rows("ledger").length, 0);
  assert.equal(db.rows("auditLogs").length, 2);
});
