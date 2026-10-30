import { createHash, randomUUID } from "node:crypto";
import type { JournalLine, Voucher } from "../types/index.ts";
import { validateAccountingJournal } from "./accounting-validation.ts";
import { journalAssetId, roundMoney } from "./accounting-engine.ts";

export interface JournalInput {
  date: string;
  notes?: string;
  lines: JournalLine[];
  requestId: string;
}

export async function executeJournalTransaction(
  db: any,
  client: any,
  input: JournalInput,
  username: string,
): Promise<Voucher> {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(Date.parse(input.date)) ||
    new Date(input.date).toISOString().slice(0, 10) !== input.date
  )
    throw new Error("জার্নালের তারিখ সঠিক নয়");
  if (!/^[\w-]{8,100}$/.test(input.requestId || "")) throw new Error("জার্নাল অনুরোধ সঠিক নয়");
  if (
    !Array.isArray(input.lines) ||
    input.lines.length > 100 ||
    !validateAccountingJournal(input.lines)
  )
    throw new Error("জার্নালের debit এবং credit সমান ও সঠিক হতে হবে");
  const id = `journal-${input.requestId}`;
  const request = createHash("sha256")
    .update(JSON.stringify({ date: input.date, notes: input.notes || "", lines: input.lines }))
    .digest("hex");
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const opt = { session };
      const prior = await db.collection("vouchers").findOne({ id }, opt);
      if (prior) {
        if (prior.requestSignature !== request)
          throw new Error("একই জার্নাল অনুরোধের তথ্য বদলে গেছে");
        const { _id, requestSignature, ...row } = prior;
        return row;
      }
      const coa = await db.collection("chartOfAccounts").find({}, opt).toArray();
      const accounts = await db.collection("accounts").find({}, opt).toArray();
      const core = ["cash", "bank", "mobile", "cheque"];
      const lines: JournalLine[] = [];
      for (const line of input.lines) {
        const account =
          coa.find((a: any) => a.id === line.accountId) ||
          accounts.find((a: any) => a.id === line.accountId);
        if (!account && !core.includes(line.accountId))
          throw new Error("জার্নালের হিসাব পাওয়া যায়নি");
        const assetId = journalAssetId(line.notes);
        if (assetId) {
          if (
            !account ||
            account.type !== "Asset" ||
            core.includes(line.accountId) ||
            accounts.some((a: any) => a.id === line.accountId)
          )
            throw new Error("সম্পদ সংযোগ শুধু সম্পদ হিসাবের লাইনে দিন");
          if (!(await db.collection("assets").findOne({ id: assetId }, opt)))
            throw new Error("সংযুক্ত সম্পদ পাওয়া যায়নি");
        }
        lines.push({ ...line, accountName: account?.name || line.accountId });
      }
      const amount = roundMoney(lines.reduce((sum, l) => sum + l.debit, 0));
      const voucher: Voucher = {
        id,
        voucherNo: `JV-${input.requestId}`,
        type: "journal",
        date: input.date,
        account: lines.find((l) => l.debit > 0)!.accountName,
        amount,
        drAccount: lines.find((l) => l.debit > 0)?.accountName,
        crAccount: lines.find((l) => l.credit > 0)?.accountName,
        lines,
        notes: input.notes?.trim(),
        createdAt: new Date().toISOString(),
      };
      await db
        .collection("vouchers")
        .insertOne({ ...voucher, _id: id, requestSignature: request }, opt);
      for (const [index, line] of lines.entries()) {
        await db.collection("ledger").insertOne(
          {
            id: `${id}-${index}`,
            date: input.date,
            account: line.accountName,
            direction: line.debit > 0 ? "in" : "out",
            amount: line.debit || line.credit,
            category: "journal",
            refType: "voucher",
            refId: id,
            notes: line.notes || input.notes || voucher.voucherNo,
          },
          opt,
        );
      }
      await db.collection("auditLogs").insertOne(
        {
          id: randomUUID(),
          userId: username,
          username,
          action: "CREATE",
          entityType: "vouchers",
          entityId: id,
          before: null,
          after: voucher,
          timestamp: new Date().toISOString(),
          details: "Balanced journal posted",
        },
        opt,
      );
      return voucher;
    });
  } finally {
    await session.endSession();
  }
}

export async function removeJournalTransaction(db: any, client: any, id: string, username: string) {
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const opt = { session };
      const voucher = await db.collection("vouchers").findOne({ id }, opt);
      if (!voucher) return { ok: true };
      if (
        voucher.type !== "journal" ||
        voucher.refType === "payroll" ||
        voucher.refType === "salaryAdvance" ||
        voucher.lines?.some((l: JournalLine) => journalAssetId(l.notes))
      ) {
        throw new Error("বেতন বা সম্পদের সংযুক্ত জার্নাল সরাসরি মুছতে পারবেন না");
      }
      await db
        .collection("ledger")
        .deleteMany({ refId: id, refType: "voucher", category: "journal" }, opt);
      await db.collection("vouchers").deleteOne({ id }, opt);
      await db.collection("auditLogs").insertOne(
        {
          id: randomUUID(),
          userId: username,
          username,
          action: "DELETE",
          entityType: "vouchers",
          entityId: id,
          before: voucher,
          after: null,
          timestamp: new Date().toISOString(),
        },
        opt,
      );
      return { ok: true };
    });
  } finally {
    await session.endSession();
  }
}
