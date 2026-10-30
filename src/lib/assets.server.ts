import type { Db, MongoClient } from "mongodb";
import type { BusinessAsset, JournalLine } from "../types/index.ts";
import {
  AssetValidationError,
  assetMoney,
  validateAssetCommand,
  type AssetCommand,
} from "./assets.ts";
import { toDateInputValue } from "./date-range.ts";

export type AssetResult = { ok: true; asset?: BusinessAsset };
type AssetLine = JournalLine & { assetId?: string };
const clean = (row: any): BusinessAsset => {
  const { _id, ...value } = row;
  return value;
};

export async function executeAssetTransaction(
  db: Db,
  client: MongoClient,
  raw: AssetCommand,
  actor: string,
): Promise<AssetResult> {
  const data = validateAssetCommand(raw);
  const fingerprint = JSON.stringify(data);
  const session = client.startSession();
  const opt = { session };
  try {
    return (await session.withTransaction(async () => {
      const requests = db.collection("assetRequests");
      const previous = await requests.findOne({ id: data.requestId }, opt);
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.actor !== actor)
          throw new AssetValidationError("একই requestId-তে তথ্য পরিবর্তন করা যাবে না");
        return previous.result as AssetResult;
      }
      await requests.insertOne(
        { _id: data.requestId as any, id: data.requestId, fingerprint, actor },
        opt,
      );
      const now = new Date().toISOString();
      const today = toDateInputValue();
      if ("postingDate" in data && data.postingDate > today)
        throw new AssetValidationError("ভবিষ্যতের তারিখে হিসাব পোস্ট করা যাবে না");
      const assets = db.collection("assets");
      let before: BusinessAsset | null = null;
      let asset: BusinessAsset;
      if (data.action === "create") {
        if (data.purchaseDate > data.postingDate)
          throw new AssetValidationError("হিসাবের তারিখ ক্রয়ের আগের হতে পারবে না");
        asset = {
          id: `asset-${data.requestId}`,
          name: data.name,
          category: data.category,
          purchaseDate: data.purchaseDate,
          purchaseCost: data.purchaseCost,
          currentValue: data.currentValue,
          createdAt: now,
          acquisition: data.acquisition,
          accountingStatus: "posted",
          accountingDate: data.postingDate,
          acquisitionVoucherId: `asset-jv-${data.requestId}`,
          revision: 1,
          ...(data.acquisition === "paid" ? { paymentAccount: data.paymentAccount } : {}),
        };
        let credit: { id: string; name: string };
        if (data.acquisition === "paid") {
          const selected = data.paymentAccount!;
          if (selected === "cash" || selected === "bank") credit = { id: selected, name: selected };
          else {
            const account = await db
              .collection("accounts")
              .findOne({ $or: [{ id: selected }, { name: selected }] }, opt);
            if (!account || !["cash", "bank", "mobile"].includes(account.type))
              throw new AssetValidationError("নির্বাচিত cash/bank account পাওয়া যায়নি");
            credit = { id: account.id, name: account.name };
          }
        } else credit = await book(data.acquisition === "opening" ? "capital" : "payable");
        const fixed = await book("fixed");
        await assets.insertOne({ ...asset, _id: asset.id as any }, opt);
        await journal(
          asset,
          data.postingDate,
          [
            assetLine(fixed, asset.currentValue, 0, asset.id),
            assetLine(credit, 0, asset.currentValue),
          ],
          "অধিগ্রহণ",
        );
      } else {
        // All edits, depreciation and adoption contend on the same asset document.
        // Mongo write-conflict retries re-read the updated carrying value.
        const row = await assets.findOneAndUpdate(
          { id: data.id },
          { $inc: { revision: 1 } },
          { ...opt, returnDocument: "after" },
        );
        if (!row) throw new AssetValidationError("সম্পদ পাওয়া যায়নি");
        asset = clean(row);
        before = { ...asset, revision: (asset.revision ?? 1) - 1 };
        if (data.action === "update") {
          asset = { ...asset, name: data.name, category: data.category };
        } else if (data.action === "remove") {
          if (asset.accountingStatus === "posted" || (await linkedJournal(asset.id)))
            throw new AssetValidationError(
              "হিসাবে পোস্ট করা সম্পদ মুছতে পারবেন না; disposal journal প্রয়োজন",
            );
          await assets.deleteOne({ id: asset.id }, opt);
          return await finish({ ok: true }, before, null);
        } else {
          if (assetMoney(asset.currentValue) !== data.expectedValue)
            throw new AssetValidationError("সম্পদের মূল্য অন্য অনুরোধে বদলেছে; নতুন তথ্য লোড করুন");
          if (
            data.postingDate <
            (asset.lastDepreciationDate || asset.accountingDate || asset.purchaseDate.slice(0, 10))
          )
            throw new AssetValidationError("আগের asset posting-এর পূর্বে নতুন হিসাব দেওয়া যাবে না");
          if (data.action === "adopt") {
            if (asset.accountingStatus === "posted" || (await linkedJournal(asset.id)))
              throw new AssetValidationError("সম্পদের acquisition journal ইতিমধ্যে আছে");
            if (asset.currentValue <= 0)
              throw new AssetValidationError(
                "শূন্য মূল্যের legacy asset-এর opening posting প্রয়োজন নেই",
              );
            const fixed = await book("fixed"),
              capital = await book("capital");
            await journal(
              asset,
              data.postingDate,
              [
                assetLine(fixed, asset.currentValue, 0, asset.id),
                assetLine(capital, 0, asset.currentValue),
              ],
              "প্রারম্ভিক মূলধনে অন্তর্ভুক্তি",
            );
            asset = {
              ...asset,
              accountingStatus: "posted",
              acquisition: "opening",
              accountingDate: data.postingDate,
              acquisitionVoucherId: `asset-jv-${data.requestId}`,
            };
          } else {
            if (asset.accountingStatus !== "posted")
              throw new AssetValidationError(
                "পুরোনো registry asset-টি আগে opening capital-এ অন্তর্ভুক্ত করুন; ঐতিহাসিক payment তৈরি হবে না",
              );
            if (data.currentValue >= asset.currentValue)
              throw new AssetValidationError("অবচয়ের পর মূল্য বর্তমান মূল্যের কম হতে হবে");
            const amount = assetMoney(
              Math.round((asset.currentValue - data.currentValue) * 100) / 100,
            );
            const fixed = await book("fixed"),
              expense = await book("depreciation");
            await journal(
              asset,
              data.postingDate,
              [assetLine(expense, amount, 0), assetLine(fixed, 0, amount, asset.id)],
              data.reason,
            );
            asset = {
              ...asset,
              currentValue: data.currentValue,
              lastDepreciationDate: data.postingDate,
            };
          }
        }
        await assets.updateOne({ id: asset.id }, { $set: asset }, opt);
      }
      return await finish({ ok: true, asset }, before, asset);

      async function linkedJournal(id: string) {
        const vouchers = await db.collection("vouchers").find({ type: "journal" }, opt).toArray();
        if (
          vouchers.some(
            (v) =>
              v.assetId === id ||
              v.lines?.some(
                (l: AssetLine) => l.assetId === id || l.notes?.includes(`[asset:${id}]`),
              ),
          )
        )
          return true;
        const entries = await db.collection("ledger").find({ category: "journal" }, opt).toArray();
        return entries.some((e) => e.assetId === id || e.notes?.includes(`[asset:${id}]`));
      }
      async function book(kind: "fixed" | "capital" | "payable" | "depreciation") {
        const specs = {
          fixed: ["Fixed Assets", "Asset"],
          capital: ["Owner Capital", "Equity"],
          payable: ["Asset Purchase Payable", "Liability"],
          depreciation: ["Depreciation Expense", "Expense"],
        } as const;
        const [name, type] = specs[kind];
        const id = `asset-account-${kind}`;
        await db
          .collection("chartOfAccounts")
          .updateOne(
            { id },
            { $setOnInsert: { id, name, type, createdAt: now } },
            { ...opt, upsert: true },
          );
        const account = await db.collection("chartOfAccounts").findOne({ id }, opt);
        if (!account || account.type !== type || account.name !== name)
          throw new AssetValidationError("Asset chart of account পরিবর্তিত; হিসাব যাচাই করুন");
        return { id, name };
      }
      async function journal(
        item: BusinessAsset,
        date: string,
        lines: AssetLine[],
        reason: string,
      ) {
        const id = `asset-jv-${data.requestId}`;
        const total = lines.reduce((sum, l) => sum + l.debit, 0);
        if (total <= 0 || total !== lines.reduce((sum, l) => sum + l.credit, 0))
          throw new AssetValidationError("Asset journal সমান নয়");
        await db
          .collection("vouchers")
          .insertOne(
            {
              _id: id as any,
              id,
              voucherNo: `JV-${data.requestId}`,
              type: "journal",
              date,
              account: lines[0].accountName,
              amount: total,
              assetId: item.id,
              lines,
              notes: `${item.name}: ${reason}`,
              createdAt: now,
            },
            opt,
          );
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          await db
            .collection("ledger")
            .insertOne(
              {
                _id: `${id}-${i}` as any,
                id: `${id}-${i}`,
                date,
                account: line.accountName,
                direction: line.debit > 0 ? "in" : "out",
                amount: line.debit || line.credit,
                category: "journal",
                refType: "voucher",
                refId: id,
                ...(line.assetId ? { assetId: line.assetId } : {}),
                notes: line.notes || `${item.name}: ${reason}`,
              },
              opt,
            );
        }
      }
      async function finish(
        result: AssetResult,
        old: BusinessAsset | null,
        next: BusinessAsset | null,
      ) {
        await db
          .collection("auditLogs")
          .insertOne(
            {
              id: `asset-audit-${data.requestId}`,
              action:
                data.action === "create"
                  ? "CREATE"
                  : data.action === "remove"
                    ? "DELETE"
                    : "UPDATE",
              entityType: "assets",
              entityId: next?.id || old?.id,
              username: actor,
              timestamp: now,
              before: old,
              after: next,
            },
            opt,
          );
        await requests.updateOne({ id: data.requestId }, { $set: { result } }, opt);
        return result;
      }
    })) as AssetResult;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      const prior = await db.collection("assetRequests").findOne({ id: data.requestId }, opt);
      if (prior?.result && prior.fingerprint === fingerprint && prior.actor === actor)
        return prior.result as AssetResult;
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

function assetLine(
  account: { id: string; name: string },
  debit: number,
  credit: number,
  assetId?: string,
): AssetLine {
  return {
    accountId: account.id,
    accountName: account.name,
    debit,
    credit,
    ...(assetId ? { assetId, notes: `[asset:${assetId}]` } : {}),
  };
}
