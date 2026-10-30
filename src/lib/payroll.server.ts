import type { Db, MongoClient } from "mongodb";
import type { PayrollCommand } from "./payroll.functions";
import {
  payrollAmounts,
  planAdvanceSettlement,
  assertPayrollMonth,
  payrollDate,
} from "./payroll.ts";
import type { MonthlyPayroll, SalaryAdvance } from "./payroll.ts";
import { PayrollValidationError } from "./payroll.ts";
import { randomUUID } from "node:crypto";
import type { AuthUser } from "../types/index.ts";

export async function executePayrollTransaction(
  db: Db,
  client: MongoClient,
  data: Exclude<PayrollCommand, { action: "advances" }>,
  actor: Pick<AuthUser, "username">,
) {
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const payroll = db.collection<MonthlyPayroll>("payroll");
      const advances = db.collection<SalaryAdvance & { _id: string }>("salaryAdvances");
      const run =
        "id" in data && data.id ? await payroll.findOne({ id: data.id }, { session }) : null;
      const employeeId = "employeeId" in data ? data.employeeId : run?.employeeId;
      if (!employeeId) throw new PayrollValidationError("বেতন পাওয়া যায়নি");
      // Every mutation for this employee touches the same document. Mongo retries write
      // conflicts, so concurrent drafts/payments cannot reuse the same advance balance.
      const employee = await db
        .collection("employees")
        .findOneAndUpdate(
          { id: employeeId },
          { $inc: { payrollRevision: 1 } },
          { session, returnDocument: "after" },
        );
      if (!employee) throw new PayrollValidationError("কর্মী পাওয়া যায়নি");
      const now = new Date().toISOString();
      if (data.action === "save") {
        assertPayrollMonth(data.month);
        if (data.id && !run) throw new PayrollValidationError("বেতন পাওয়া যায়নি");
        if (run && run.employeeId !== data.employeeId)
          throw new PayrollValidationError("কর্মী পরিবর্তন করা যাবে না");
        if (run && run.status !== "draft")
          throw new PayrollValidationError("শুধু খসড়া বেতন সম্পাদনা করা যাবে");
        if (!run && employee.status !== "active")
          throw new PayrollValidationError("কর্মী সক্রিয় নন");
        if (data.month < payrollDate(String(employee.joiningDate)).slice(0, 7))
          throw new PayrollValidationError("যোগদানের আগের মাসের বেতন তৈরি করা যাবে না");
        const duplicate = await payroll.findOne(
          { employeeId, month: data.month, ...(run ? { id: { $ne: run.id } } : {}) },
          { session },
        );
        if (duplicate) throw new PayrollValidationError("এই মাসের বেতন ইতিমধ্যে তৈরি হয়েছে");
        const { gross: _gross, ...amounts } = payrollAmounts(data);
        const { _id: _mongoId, ...priorFields } = run ?? {};
        const row: MonthlyPayroll = {
          ...priorFields,
          id: run?.id ?? `payroll-${employeeId}-${data.month}`,
          employeeId,
          employeeName: String(employee.name),
          month: data.month,
          ...amounts,
          status: "draft",
          createdAt: run?.createdAt ?? now,
        };
        if (run) await payroll.updateOne({ id: run.id }, { $set: row }, { session });
        else await payroll.insertOne(row, { session });
        await audit(run ? "UPDATE" : "CREATE", row.id, run, row);
        const { _id, ...result } = row as MonthlyPayroll & { _id?: unknown };
        return result;
      }
      if (data.action === "remove") {
        if (!run || run.status !== "draft")
          throw new PayrollValidationError("শুধু খসড়া বেতন মুছতে পারবেন");
        if (
          (await db
            .collection("vouchers")
            .findOne({ refType: "payroll", refId: run.id }, { session })) ||
          (await db
            .collection("ledger")
            .findOne({ refType: "payroll", refId: run.id }, { session }))
        )
          throw new PayrollValidationError("এই বেতনের হিসাব এন্ট্রি আছে; আগে যাচাই করুন");
        await payroll.deleteOne({ id: run.id, status: "draft" }, { session });
        await audit("DELETE", run.id, run, null);
        return { ok: true };
      }
      if (data.action === "advance") {
        const id = `advance-${data.requestId}`;
        const prior = await advances.findOne({ id }, { session });
        if (prior) {
          if (
            prior.employeeId !== employeeId ||
            prior.amount !== data.amount ||
            prior.date !== data.date ||
            prior.paymentMethod !== data.paymentMethod
          )
            throw new PayrollValidationError("অনুরোধের তথ্য বদলে গেছে");
          const { _id, ...result } = prior;
          return result;
        }
        if (employee.status !== "active") throw new PayrollValidationError("কর্মী সক্রিয় নন");
        if (
          Date.parse(data.date) > Date.now() ||
          payrollDate(data.date) < payrollDate(String(employee.joiningDate))
        )
          throw new PayrollValidationError("অগ্রিমের তারিখ সঠিক নয়");
        const row: SalaryAdvance = {
          id,
          employeeId,
          employeeName: String(employee.name),
          date: data.date,
          amount: payrollAmounts({ basic: data.amount, bonus: 0, allowance: 0, deduction: 0 }).net,
          paymentMethod: data.paymentMethod,
        };
        await advances.insertOne({ ...row, _id: id }, { session });
        await postPayment(
          id,
          "salaryAdvance",
          row.amount,
          row.date,
          row.paymentMethod,
          row.employeeName,
        );
        await audit("PAYMENT", id, null, row);
        return row;
      }
      if (!run) throw new PayrollValidationError("বেতন পাওয়া যায়নি");
      if (run.status === "paid") {
        if (run.paymentRequestId !== data.requestId)
          throw new PayrollValidationError("বেতন ইতিমধ্যে পরিশোধিত");
        if (
          run.paymentMethod !== data.method ||
          run.paidAt !== data.paymentDate ||
          run.advanceRecovered !== data.advanceRecovery
        )
          throw new PayrollValidationError("অনুরোধের তথ্য বদলে গেছে");
        const { _id, ...result } = run;
        return result;
      }
      if (Date.parse(data.paymentDate) > Date.now())
        throw new PayrollValidationError("ভবিষ্যতের তারিখে পরিশোধ করা যাবে না");
      if (
        (await db
          .collection("vouchers")
          .findOne({ refType: "payroll", refId: run.id }, { session })) ||
        (await db.collection("ledger").findOne({ refType: "payroll", refId: run.id }, { session }))
      )
        throw new PayrollValidationError("আগের payment এন্ট্রি আছে; হিসাব যাচাই প্রয়োজন");
      const allAdvances = await advances.find({ employeeId }, { session }).toArray();
      const allRuns = await payroll.find({ employeeId }, { session }).toArray();
      // Backdated payments cannot retroactively consume an advance already used later.
      const plan = planAdvanceSettlement(
        run,
        allAdvances,
        allRuns,
        data.paymentDate,
        data.advanceRecovery,
      );
      const { _id: _mongoId, ...priorFields } = run;
      const row = {
        ...priorFields,
        advanceSettlements: plan.advanceSettlements,
        advanceRecovered: plan.advanceRecovered,
        cashPaid: plan.cashPaid,
        status: "paid" as const,
        paidAt: data.paymentDate,
        paymentMethod: data.method,
        paymentRequestId: data.requestId,
      };
      await payroll.updateOne({ id: run.id, status: "draft" }, { $set: row }, { session });
      await postPayment(
        run.id,
        "payroll",
        plan.cashPaid,
        data.paymentDate,
        data.method,
        run.employeeName,
        run.month,
      );
      await audit("PAYROLL", run.id, run, row);
      return row;

      async function audit(action: string, entityId: string, before: unknown, after: unknown) {
        // Mandatory, session-bound and deliberately no catch/in-memory fallback.
        await db.collection("auditLogs").insertOne(
          {
            id: `aud-${randomUUID()}`,
            userId: actor.username,
            username: actor.username,
            action,
            entityType: "payroll",
            entityId,
            before,
            after,
            timestamp: now,
            details: `Payroll ${data.action}`,
          },
          { session },
        );
      }

      async function postPayment(
        refId: string,
        refType: string,
        value: number,
        paidAt: string,
        paymentMethod: string,
        name: string,
        month?: string,
      ) {
        const account =
          paymentMethod === "cheque" || paymentMethod === "mobile" ? "bank" : paymentMethod;
        if (
          account !== "cash" &&
          account !== "bank" &&
          !(await db.collection("accounts").findOne({ name: account }, { session }))
        )
          throw new PayrollValidationError("পরিশোধের account পাওয়া যায়নি");
        const id = `${refType}-${refId}`;
        // Even a fully advance-settled salary gets a zero-cash voucher for its reference.
        await db.collection("vouchers").insertOne(
          {
            id,
            voucherNo: `PV-${id}`,
            type: "payment",
            date: payrollDate(paidAt),
            account,
            amount: value,
            partyType: "employee",
            partyId: employeeId,
            partyName: name,
            refType,
            refId,
            notes: refType === "payroll" ? `Salary ${name} · ${month}` : `Employee advance ${name}`,
            createdAt: now,
          },
          { session },
        );
        if (value > 0)
          await db.collection("ledger").insertOne(
            {
              id,
              date: paidAt,
              account,
              direction: "out",
              amount: value,
              category: refType === "payroll" ? "expense" : "payment",
              refType,
              refId,
              notes:
                refType === "payroll" ? `Salary ${name} · ${month}` : `Employee advance ${name}`,
            },
            { session },
          );
      }
    });
  } finally {
    await session.endSession();
  }
}
